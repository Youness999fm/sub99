// Batterie 06 : COURSES CRITIQUES ET IDEMPOTENCE (API, rafales). Tout est local : serveur + base Postgres en mémoire (PGlite).
//   node tests/massif/lancer.mjs tests/massif/06-concurrence-idempotence.mjs --timeout=480
// Option : --seulement=A,F,J  (lettres des sections) pour itérer plus vite ; sans option, tout est exécuté.
//
// Sections :
//  A  même clé, même contenu : 5 rafales de 100 requêtes (un client par clé)       Abis mêmes contenus, sérialisations JSON différentes
//  B  même clé, 50 contenus différents ; 40 envois dont la moitié au total falsifié   C  même clé pour deux clients
//  D  200 décisions simultanées sur la même commande (accepter 30 / 40 / refuser / prête), « prête » contre « refuser »
//  E  100 commandes : création, décisions, « prête » et décisions contradictoires simultanées
//  F  inscriptions simultanées avec le même e-mail (casses différentes)             G  30 navigateurs pour un même client
//  H  réponses perdues (le client raccroche) puis renvoi                              I  orage mixte (création + 3 tablettes + suivis)
//  J  limiteurs de débit sous rafale                                                  Z  contrôle final de la base, du journal serveur
import { performance } from 'node:perf_hooks';
import { demarrerSite, reponses } from './lib/env.mjs';
import { ClientIP, creerClients, patronConnecte, corpsInscription, ipFictive } from './lib/clients.mjs';
import { rng, construireCommande } from './lib/commandes.mjs';
import {
  creerRapport, appeler, appelerBrut, rafale, repeter, repartition, texteRepartition, latences, aucune5xx, compter,
  incoherences, suiteValide, analyserDecisions, envoyerEtRaccrocher, demarrerSuivi, serialiserVariante, pause, copierCookies,
  varianteEmail, RETARDS
} from './lib/06-outils.mjs';

const seulement = (process.argv.find((a) => a.startsWith('--seulement=')) || '').slice(12).split(',').filter(Boolean);
const veut = (code) => seulement.length === 0 || seulement.includes(code);

const R = creerRapport();
const mesures = [];
const site = await demarrerSite({ statique: false });
const sql = (texte, ...p) => site.db.prepare(texte).all(...p);
const sql1 = (texte, ...p) => site.db.prepare(texte).get(...p);

// Chien de garde : le script ne dépasse jamais le délai du lanceur (480 s) sans avoir imprimé son résumé.
const garde = setTimeout(() => {
  console.log('FAIL délai global de 450 s dépassé : arrêt du script (résultats partiels ci-dessus)');
  R.etat.fail++;
  R.resume();
  process.exit(1);
}, 450000);
garde.unref();

// ------------------------------------------------------------------ aides communes

const cle = (tag, k) => `idem06-${tag}-${k}`;
const registre = { commandes: new Map(), inscriptions201: 0 };
const ctx = {};
/** Clients dont le nombre de sessions actives attendu n'est pas 1 (un navigateur = une session) : id -> nombre attendu (null = écart déjà signalé). */
const sessionsAttendues = new Map();

function fabriquer(r, client, opts = {}) {
  const { body, totals } = construireCommande(r, { ville: client.ville, ...opts });
  return { body, totals };
}

function noter(rep, client, req) {
  const o = rep.json.order;
  if (!registre.commandes.has(o.id)) {
    registre.commandes.set(o.id, {
      clientId: client.customer.id, cle: req.body.idempotency_key, totals: req.totals, totalReponse: o.total_cents,
      lignes: req.body.items.map((l) => [l.variant, l.qty, l.unit_price_cents])
    });
  }
}

/** Envoie une commande ; mémorise la commande (201 ou rejeu) pour le contrôle final. */
async function envoyerCommande(client, req) {
  const rep = await appeler(client, 'order_create.php', { corps: req.body });
  if ((rep.status === 201 || rep.status === 200) && rep.json && rep.json.order) noter(rep, client, req);
  return rep;
}

function mesure(nom, resultats, ms) {
  const l = latences(resultats);
  const debit = Math.round(resultats.length / (ms / 1000));
  mesures.push({ nom, n: resultats.length, ms: Math.round(ms), debit, ...l });
  R.info(`${nom} : ${resultats.length} requêtes simultanées en ${Math.round(ms)} ms (${debit} req/s), latence p50/p95/max ${l.p50}/${l.p95}/${l.max} ms ; réponses : ${texteRepartition(repartition(resultats))}`);
  const causes = repartition(resultats.filter((x) => x.status === 0), (x) => x.erreurReseau || '?');
  if (Object.keys(causes).length) R.info(`${nom} : erreurs réseau côté client : ${texteRepartition(causes)}`);
}

const ligneBase = (id) => sql1('SELECT * FROM orders WHERE id = ?', id);
const nbLignesBase = (id) => sql1('SELECT COUNT(*) AS n FROM order_items WHERE order_id = ?', id).n;
const ligneSuit = (id) => sql('SELECT variant, qty, unit_price_cents FROM order_items WHERE order_id = ? ORDER BY position', id).map((l) => [l.variant, l.qty, l.unit_price_cents]);
const nbActives = (customerId) => sql1("SELECT COUNT(*) AS n FROM sessions WHERE user_type = 'customer' AND user_id = ? AND revoked_at IS NULL", customerId).n;

/** Jeton de session client valide ? (jarre vierge portant ce seul cookie) */
async function jetonValide(jeton, ip = ipFictive(65000)) {
  const j = new ClientIP('verif', ip);
  j.cookies.set('subito_customer', jeton);
  const x = await appeler(j, 'customer_me.php', { methode: 'GET' });
  return x.status === 200 && x.json && x.json.customer !== null ? x.json.customer.id : null;
}

/** Attend, de façon bornée, que la valeur de compte() cesse de changer (le serveur a fini de traiter les requêtes abandonnées). */
async function attendreStable(compte, { pas = 200, stable = 4, max = 60 } = {}) {
  let v = compte();
  let n = 0;
  for (let i = 0; i < max && n < stable; i++) {
    await pause(pas);
    const w = compte();
    if (w === v) n++; else { n = 0; v = w; }
  }
  return v;
}

/** Crée une commande de retrait pour le client et renvoie son id (le client est un client du pool). */
async function creerSimple(client, graine, opts = {}) {
  const req = fabriquer(rng(graine), client, { mode: 'pickup', ...opts });
  const rep = await envoyerCommande(client, req);
  if (rep.status !== 201) throw new Error(`création de commande impossible : ${rep.status} ${rep.text.slice(0, 200)}`);
  return rep.json.order.id;
}

// ------------------------------------------------------------------ 0. préparation

async function preparer() {
  R.titre('0. Préparation : site local, clients, tablettes');
  const t0 = performance.now();
  const dispo = await appeler(new ClientIP('sonde', ipFictive(64999)), 'availability.php', { methode: 'GET' });
  R.controle('le site local répond (availability.php)', dispo.status === 200, `HTTP ${dispo.status}${dispo.erreurReseau ? ' ' + dispo.erreurReseau : ''}`);
  const NB_POOL = 36;
  const tous = await creerClients(12 + NB_POOL, { debut: 200, villes: true, concurrence: 16, prefixe: 'c06' });
  registre.inscriptions201 += tous.length;
  ctx.A = tous.slice(0, 5);
  ctx.SER = tous[5];
  ctx.B = tous[6];
  ctx.B2 = tous[7];
  ctx.C = tous.slice(8, 12);
  ctx.pool = tous.slice(12);
  ctx.patron = await patronConnecte('10.250.250.250');
  ctx.tablettes = [ctx.patron, await patronConnecte('10.250.250.251'), await patronConnecte('10.250.250.252')];
  R.controle(`${12 + NB_POOL} comptes clients et 3 tablettes créés`, tous.length === 12 + NB_POOL && ctx.tablettes.length === 3, `${tous.length} clients en ${Math.round(performance.now() - t0)} ms`);
}

// ------------------------------------------------------------------ A. même clé, même contenu x100 (x5)

async function sectionA() {
  R.titre('A. Même clé, même contenu : 5 rafales de 100 requêtes simultanées (un client par clé)');
  const nouvelles = [];
  const rejeux = [];
  for (let k = 0; k < 5; k++) {
    const c = ctx.A[k];
    const req = fabriquer(rng(6100 + k), c, { mode: k % 2 === 0 ? 'pickup' : 'delivery', cle: cle('a', k) });
    const tag = `A${k + 1} (${req.body.mode}, ${req.body.items.length} lignes, ${req.totals.total_cents} c)`;
    const { resultats, ms } = await rafale(repeter(100, () => envoyerCommande(c, req)));
    mesure(`A${k + 1}`, resultats, ms);
    const nb201 = compter(resultats, (x) => x.status === 201);
    const nbRej = compter(resultats, (x) => x.status === 200 && x.json && x.json.replayed === true);
    R.controle(`${tag} : exactement 1×201 et 99×200 rejoué, rien d'autre`, nb201 === 1 && nbRej === 99, texteRepartition(repartition(resultats)));
    R.controle(`${tag} : aucune erreur 5xx ni réseau`, aucune5xx(resultats), `${compter(resultats, (x) => x.status === 0 || x.status >= 500)} erreur(s)`);
    const avecOrdre = resultats.filter((x) => x.json && x.json.order);
    const ids = new Set(avecOrdre.map((x) => x.json.order.id));
    const drapeauxOk = avecOrdre.every((x) => (x.status === 201 ? x.json.replayed === false : x.json.replayed === true));
    R.controle(`${tag} : même id de commande partout ; replayed=false seulement sur le 201`, ids.size === 1 && drapeauxOk, `ids ${[...ids].join(',')}, drapeaux ${drapeauxOk ? 'cohérents' : 'incohérents'}`);
    const corpsDistincts = new Set(avecOrdre.map((x) => JSON.stringify(x.json.order))).size;
    const totauxOk = avecOrdre.every((x) => x.json.order.total_cents === req.totals.total_cents);
    R.controle(`${tag} : le même ordre est renvoyé à chaque rejeu ; total de la réponse = total calculé (${req.totals.total_cents})`, corpsDistincts === 1 && totauxOk, `${corpsDistincts} version(s) distincte(s) de la commande`);
    const id = [...ids][0];
    const lignes = sql1('SELECT COUNT(*) AS n FROM orders WHERE customer_id = ? AND idempotency_key = ?', c.customer.id, req.body.idempotency_key).n;
    const row = ligneBase(id);
    R.controle(`${tag} : 1 seule ligne en base, ${req.body.items.length} lignes d'articles, total en base = réponse`,
      lignes === 1 && nbLignesBase(id) === req.body.items.length && row && row.total_cents === req.totals.total_cents,
      `${lignes} commande(s), ${nbLignesBase(id)} ligne(s) d'articles, total ${row && row.total_cents}`);
    // Quota d'envoi : une seule commande réelle sur les 20 permises par 10 minutes.
    const thr = sql1('SELECT attempts, locked_until FROM throttle WHERE bucket = ?', 'order_create:customer:' + c.customer.id);
    const suite = fabriquer(rng(6150 + k), c, { mode: 'pickup' });
    const nouv = await envoyerCommande(c, suite);
    const rej = await appeler(c, 'order_create.php', { corps: req.body });
    nouvelles.push(nouv.status);
    rejeux.push(rej.status);
    R.info(`${tag} quota : compteur d'envois = ${thr && thr.attempts} pour 1 commande réellement créée, verrou ${thr && thr.locked_until ? 'posé' : 'non posé'} ; nouvelle commande ensuite : HTTP ${nouv.status} ; rejeu ensuite : HTTP ${rej.status}`);
  }
  R.controle('A. après chaque rafale de doublons, le client peut passer une NOUVELLE commande (1 envoi réel sur 20 permis)',
    nouvelles.every((s) => s === 201), `statuts ${nouvelles.join(' ')} (attendu 5×201)`);
  R.controle('A. un rejeu de la commande déjà créée reste accepté (200) même quand le quota est atteint',
    rejeux.every((s) => s === 200), `statuts ${rejeux.join(' ')} (attendu 5×200)`);
}

// ------------------------------------------------------------------ A bis. sérialisations différentes

async function sectionAbis() {
  R.titre('A bis. Même contenu, JSON sérialisé différemment (ordre des clés, indentation, champ inconnu) : 100 requêtes simultanées');
  const c = ctx.SER;
  const r = rng(6150);
  const req = fabriquer(r, c, { mode: 'delivery', cle: cle('ser', 1) });
  const { resultats, ms } = await rafale(repeter(100, async (i) => {
    const variante = { ...req.body };
    if (i % 3 === 0) variante.champ_inconnu = 'x' + i;
    const rep = await appelerBrut(c, 'order_create.php', serialiserVariante(r, variante, i % 4 === 0 ? 2 : undefined));
    if ((rep.status === 201 || rep.status === 200) && rep.json && rep.json.order) noter(rep, c, req);
    return rep;
  }));
  mesure('A bis', resultats, ms);
  const nb201 = compter(resultats, (x) => x.status === 201);
  const nbRej = compter(resultats, (x) => x.status === 200 && x.json && x.json.replayed === true);
  R.controle('A bis. 1×201 et 99×200 rejoué (même empreinte quel que soit l\'ordre des clés)', nb201 === 1 && nbRej === 99, texteRepartition(repartition(resultats)));
  R.controle('A bis. aucune erreur 5xx', aucune5xx(resultats), `${compter(resultats, (x) => x.status === 0 || x.status >= 500)} erreur(s)`);
  const n = sql1('SELECT COUNT(*) AS n FROM orders WHERE customer_id = ? AND idempotency_key = ?', c.customer.id, req.body.idempotency_key).n;
  R.egal('A bis. une seule commande en base pour la clé', n, 1);
}

// ------------------------------------------------------------------ B. contenus différents, totaux falsifiés

async function sectionB() {
  R.titre('B. Même clé, 50 contenus DIFFÉRENTS simultanés : une seule commande, les autres en conflit');
  const c = ctx.B;
  const r = rng(6200);
  const k = cle('b', 1);
  const contenus = [];
  const vus = new Set();
  while (contenus.length < 50) {
    const req = fabriquer(r, c, { mode: 'pickup', cle: k });
    const empreinte = JSON.stringify([req.body.items, req.body.total_cents]);
    if (vus.has(empreinte)) continue;
    vus.add(empreinte);
    contenus.push(req);
  }
  const { resultats, ms } = await rafale(contenus.map((req) => () => envoyerCommande(c, req)));
  mesure('B', resultats, ms);
  const nb201 = compter(resultats, (x) => x.status === 201);
  const nbConflit = compter(resultats, (x) => x.status === 409 && x.json && x.json.error === 'idempotency_conflict');
  R.controle('B. 1×201 et 49×409 idempotency_conflict, rien d\'autre', nb201 === 1 && nbConflit === 49, texteRepartition(repartition(resultats)));
  R.controle('B. aucune erreur 5xx', aucune5xx(resultats), `${compter(resultats, (x) => x.status === 0 || x.status >= 500)} erreur(s)`);
  const n = sql1('SELECT COUNT(*) AS n FROM orders WHERE customer_id = ? AND idempotency_key = ?', c.customer.id, k).n;
  R.egal('B. une seule commande en base pour la clé', n, 1);
  const iw = resultats.findIndex((x) => x.status === 201);
  if (iw >= 0) {
    const id = resultats[iw].json.order.id;
    const gagnante = contenus[iw];
    R.controle('B. la commande enregistrée est exactement celle du gagnant (lignes, quantités, prix, total)',
      JSON.stringify(ligneSuit(id)) === JSON.stringify(gagnante.body.items.map((l) => [l.variant, l.qty, l.unit_price_cents])) && ligneBase(id).total_cents === gagnante.totals.total_cents,
      `gagnant n°${iw}, ${nbLignesBase(id)} ligne(s), total ${ligneBase(id).total_cents}`);
    const rejeuGagnant = await appeler(c, 'order_create.php', { corps: gagnante.body });
    R.controle('B. renvoyer le contenu du gagnant après la rafale : 200 rejoué (même id)', rejeuGagnant.status === 200 && rejeuGagnant.json.replayed === true && rejeuGagnant.json.order.id === id, cleReponseCourte(rejeuGagnant));
    const perdant = contenus[(iw + 1) % 50];
    const rejeuPerdant = await appeler(c, 'order_create.php', { corps: perdant.body });
    R.controle('B. renvoyer le contenu d\'un perdant : 409 idempotency_conflict', rejeuPerdant.status === 409 && rejeuPerdant.json.error === 'idempotency_conflict', cleReponseCourte(rejeuPerdant));
  } else {
    R.controle('B. un gagnant existe', false, 'aucun 201');
  }
  const fuites = resultats.filter((x) => x.status === 409 && Object.keys(x.json).some((cl) => !['ok', 'error', 'message'].includes(cl)));
  R.controle('B. les réponses 409 ne divulguent aucune donnée de la commande gagnante', fuites.length === 0, `${fuites.length} réponse(s) avec des champs en plus`);

  // B2. 40 envois, même clé : 20 corrects identiques et 20 au total falsifié (l'envoi falsifié ne doit jamais créer de commande)
  R.titre('B2. Même clé : 20 envois corrects identiques et 20 au total falsifié, simultanés');
  const c2 = ctx.B2;
  const valide = fabriquer(rng(6210), c2, { mode: 'pickup', cle: cle('b2', 1) });
  const taches = [];
  for (let i = 0; i < 40; i++) {
    if (i % 2 === 0) taches.push(async () => ({ type: 'valide', rep: await envoyerCommande(c2, valide) }));
    else {
      const faux = { ...valide.body, total_cents: valide.body.total_cents + 100 * (1 + (i % 7)) };
      taches.push(async () => ({ type: 'falsifie', rep: await appeler(c2, 'order_create.php', { corps: faux }) }));
    }
  }
  const res2 = await rafale(taches);
  const reps2 = res2.resultats.map((x) => x.rep);
  mesure('B2', reps2, res2.ms);
  const valides = res2.resultats.filter((x) => x.type === 'valide').map((x) => x.rep);
  const faux = res2.resultats.filter((x) => x.type === 'falsifie').map((x) => x.rep);
  R.controle('B2. les 20 envois corrects : 1×201 et 19×200 rejoué', compter(valides, (x) => x.status === 201) === 1 && compter(valides, (x) => x.status === 200 && x.json.replayed === true) === 19, texteRepartition(repartition(valides)));
  R.controle('B2. les 20 envois falsifiés : tous refusés en 409 (price_mismatch ou idempotency_conflict)', faux.every((x) => x.status === 409 && ['price_mismatch', 'idempotency_conflict'].includes(x.json.error)), texteRepartition(repartition(faux)));
  const id2 = valides.find((x) => x.status === 201).json.order.id;
  const n2 = sql1('SELECT COUNT(*) AS n FROM orders WHERE customer_id = ? AND idempotency_key = ?', c2.customer.id, valide.body.idempotency_key).n;
  R.controle('B2. une seule commande en base, au total correct (jamais le total falsifié)', n2 === 1 && ligneBase(id2).total_cents === valide.totals.total_cents, `${n2} commande(s), total ${ligneBase(id2).total_cents} (attendu ${valide.totals.total_cents})`);
}
const cleReponseCourte = (x) => `HTTP ${x.status}${x.json && x.json.error ? ' ' + x.json.error : ''}${x.json && x.json.replayed !== undefined ? ' replayed=' + x.json.replayed : ''}`;

// ------------------------------------------------------------------ C. même clé, deux clients

async function sectionC() {
  R.titre('C. Même clé pour deux clients différents : deux commandes (la clé est propre au client)');
  const [a, b, c3, d3] = ctx.C;
  const r = rng(6300);
  const k1 = cle('c', 1);
  const reqA = fabriquer(r, a, { mode: 'pickup', cle: k1 });
  const repA = await envoyerCommande(a, reqA);
  const repB = await envoyerCommande(b, reqA);
  R.controle('C. A puis B envoient la même clé et le même contenu : 201 et 201, ids différents', repA.status === 201 && repB.status === 201 && repA.json.order.id !== repB.json.order.id,
    `A ${cleReponseCourte(repA)} #${repA.json && repA.json.order && repA.json.order.id}, B ${cleReponseCourte(repB)} #${repB.json && repB.json.order && repB.json.order.id}`);
  const rejA = await appeler(a, 'order_create.php', { corps: reqA.body });
  const rejB = await appeler(b, 'order_create.php', { corps: reqA.body });
  R.controle('C. le rejeu de chacun renvoie SA commande', rejA.json.order.id === repA.json.order.id && rejB.json.order.id === repB.json.order.id && rejA.json.replayed && rejB.json.replayed,
    `A #${rejA.json.order.id} B #${rejB.json.order.id}`);
  const k2 = cle('c', 2);
  const reqA2 = fabriquer(r, a, { mode: 'pickup', cle: k2 });
  const reqB2 = fabriquer(r, b, { mode: 'pickup', cle: k2 });
  const [x, y] = await Promise.all([envoyerCommande(a, reqA2), envoyerCommande(b, reqB2)]);
  R.controle('C. même clé, contenus différents, deux clients : pas de conflit (201 et 201)', x.status === 201 && y.status === 201, `${cleReponseCourte(x)} / ${cleReponseCourte(y)}`);

  // Rafale : 2 clients x 50 requêtes, même clé, même contenu, entrelacées
  const k3 = cle('c', 3);
  const req3 = fabriquer(r, c3, { mode: 'pickup', cle: k3 });
  const taches = [];
  for (let i = 0; i < 50; i++) {
    taches.push(async () => ({ client: c3, rep: await envoyerCommande(c3, req3) }));
    taches.push(async () => ({ client: d3, rep: await envoyerCommande(d3, req3) }));
  }
  const { resultats, ms } = await rafale(taches);
  mesure('C (2 clients x 50)', resultats.map((z) => z.rep), ms);
  const nb201 = compter(resultats, (z) => z.rep.status === 201);
  const nbRej = compter(resultats, (z) => z.rep.status === 200 && z.rep.json.replayed === true);
  R.controle('C. 100 requêtes (2 clients x 50, même clé) : exactement 2×201 et 98×200 rejoué', nb201 === 2 && nbRej === 98, texteRepartition(repartition(resultats.map((z) => z.rep))));
  const idsDe = (cl) => new Set(resultats.filter((z) => z.client === cl && z.rep.json && z.rep.json.order).map((z) => z.rep.json.order.id));
  const idsC = idsDe(c3);
  const idsD = idsDe(d3);
  R.controle('C. chaque client ne voit qu\'une seule commande (la sienne) et les deux ids sont différents', idsC.size === 1 && idsD.size === 1 && [...idsC][0] !== [...idsD][0], `client 1 : ${[...idsC]}, client 2 : ${[...idsD]}`);
  const melange = resultats.filter((z) => z.rep.json && z.rep.json.order && z.rep.json.order.customer_name !== `${z.client.customer.first_name} ${z.client.customer.last_name}`);
  R.controle('C. aucune réponse ne montre la commande de l\'autre client (nom du client)', melange.length === 0, `${melange.length} réponse(s) croisée(s)`);
  R.controle('C. aucune erreur 5xx', aucune5xx(resultats.map((z) => z.rep)), `${compter(resultats, (z) => z.rep.status === 0 || z.rep.status >= 500)} erreur(s)`);
  const n = sql1('SELECT COUNT(*) AS n FROM orders WHERE idempotency_key = ?', k3).n;
  R.egal('C. deux commandes en base pour cette clé (une par client)', n, 2);
}

// ------------------------------------------------------------------ D. décisions simultanées sur la même commande

/** Une course : crée une commande, (l'accepte), lance les décisions simultanées, suit côté client, analyse. Renvoie l'analyse. */
async function course(nom, client, graine, initial, actions) {
  const id = await creerSimple(client, graine);
  if (initial.status === 'accepted') {
    const x = await appeler(ctx.patron, 'owner_order_decide.php', { corps: { id, action: 'accept', delay_minutes: initial.delay } });
    if (x.status !== 200) throw new Error('acceptation préalable impossible : ' + x.status);
  }
  const suivi = demarrerSuivi(client, id, 6);
  await pause(30);
  const { resultats, ms } = await rafale(actions.map((a, i) => () => appeler(ctx.tablettes[i % ctx.tablettes.length], 'owner_order_decide.php', { corps: { id, ...a } })));
  await pause(40);
  await suivi.arreter();
  const final = ligneBase(id);
  const analyse = analyserDecisions(actions, resultats, final, initial);
  mesure(nom, resultats, ms);
  const st = analyse.stats;
  const resume = `gagnant ${analyse.premier ? analyse.premier.action + (analyse.premier.delay_minutes ? ' ' + analyse.premier.delay_minutes : '') : 'aucun (départ ' + initial.status + ')'} ; ${st.neufsDepart + st.neufsPrete} transition(s), ${st.rejoues} rejoué(s), ${st.conflits} conflit(s) ; final ${final.status}/${final.delay_minutes}`;
  R.controle(`${nom} : aucune erreur 5xx ni réseau`, aucune5xx(resultats), `${compter(resultats, (x) => x.status === 0 || x.status >= 500)} erreur(s)`);
  R.controle(`${nom} : un seul résultat gagnant, les autres rejoués (200) ou 409 already_decided, état final cohérent avec le gagnant`, analyse.anomalies.length === 0,
    analyse.anomalies.length ? analyse.anomalies.slice(0, 4).join(' ; ') + ` (${analyse.anomalies.length} anomalies)` : resume);
  R.controle(`${nom} : jamais accepted_at ET refused_at ; horodatages cohérents avec le statut`, incoherences(final).length === 0, `${final.status} accepted_at=${final.accepted_at} refused_at=${final.refused_at} prepared_at=${final.prepared_at}`);
  const vue = await appeler(client, `order_status.php?id=${id}`, { methode: 'GET' });
  R.controle(`${nom} : le suivi du client n'a jamais reculé (${suivi.n} sondages : ${[...new Set(suivi.statuts)].join('>')}), sans erreur ni vue incohérente`,
    suiteValide(suivi.statuts) && suivi.erreurs === 0 && suivi.anomalies.length === 0, `${suivi.n} sondages, ${suivi.erreurs} erreur(s), ${suivi.anomalies.length} vue(s) incohérente(s)`);
  R.controle(`${nom} : après la rafale, le client voit exactement l'état de la base`, vue.status === 200 && vue.json.order.status === final.status && vue.json.order.delay_minutes === final.delay_minutes,
    `client ${vue.json && vue.json.order && vue.json.order.status}, base ${final.status}`);
  return { analyse, final, id };
}

const repeterAction = (n, a) => Array.from({ length: n }, () => ({ ...a }));

async function sectionD() {
  R.titre('D. 200 décisions simultanées sur la MÊME commande (accepter 30 / accepter 40 / refuser / prête, 50 de chaque)');
  const r = rng(6400);
  const gagnants = [];
  for (let i = 0; i < 6; i++) {
    let actions = r.melanger([...repeterAction(50, { action: 'accept', delay_minutes: 30 }), ...repeterAction(50, { action: 'accept', delay_minutes: 40 }),
      ...repeterAction(50, { action: 'refuse' }), ...repeterAction(50, { action: 'ready' })]);
    // Les trois premières courses placent volontairement un gagnant différent en tête (accepter 30, accepter 40, refuser).
    const tete = [{ action: 'accept', delay_minutes: 30 }, { action: 'accept', delay_minutes: 40 }, { action: 'refuse' }][i];
    if (tete) {
      const j = actions.findIndex((a) => a.action === tete.action && a.delay_minutes === tete.delay_minutes);
      [actions[0], actions[j]] = [actions[j], actions[0]];
    }
    const { analyse, final } = await course(`D${i + 1} (200 mélangées)`, ctx.pool[i], 6410 + i, { status: 'new' }, actions);
    gagnants.push(`${analyse.premier ? analyse.premier.action + (analyse.premier.delay_minutes ? analyse.premier.delay_minutes : '') : '-'}→${final.status}`);
  }
  R.info(`D gagnants observés sur 6 courses : ${gagnants.join(', ')}`);

  R.titre('D bis. « prête » en course avec « refuser » et autres duels (100 contre 100)');
  const r2 = rng(6450);
  await course('D7 prête contre refuser (commande nouvelle)', ctx.pool[6], 6451, { status: 'new' },
    r2.melanger([...repeterAction(100, { action: 'ready' }), ...repeterAction(100, { action: 'refuse' })]));
  await course('D8 prête contre refuser (commande acceptée à 20 min)', ctx.pool[7], 6452, { status: 'accepted', delay: 20 },
    r2.melanger([...repeterAction(100, { action: 'ready' }), ...repeterAction(100, { action: 'refuse' })]));
  await course('D9 accepter 30 contre accepter 40 (commande nouvelle)', ctx.pool[8], 6453, { status: 'new' },
    r2.melanger([...repeterAction(100, { action: 'accept', delay_minutes: 30 }), ...repeterAction(100, { action: 'accept', delay_minutes: 40 })]));
  await course('D10 prête contre accepter 50 (commande nouvelle)', ctx.pool[9], 6454, { status: 'new' },
    r2.melanger([...repeterAction(100, { action: 'ready' }), ...repeterAction(100, { action: 'accept', delay_minutes: 50 })]));
  await course('D11 accepter 60 contre refuser sur commande acceptée à 60 min', ctx.pool[10], 6455, { status: 'accepted', delay: 60 },
    r2.melanger([...repeterAction(100, { action: 'accept', delay_minutes: 60 }), ...repeterAction(100, { action: 'refuse' })]));
}

// ------------------------------------------------------------------ E. 100 commandes différentes

async function sectionE() {
  R.titre('E. 100 commandes différentes : création, décisions, « prête » et décisions contradictoires simultanées');
  const clients = ctx.pool.slice(11, 21); // 10 clients
  const r = rng(6500);
  const taches = [];
  clients.forEach((c) => {
    for (let j = 0; j < 10; j++) {
      const req = fabriquer(r, c, { mode: j % 2 === 0 ? 'pickup' : 'delivery', cle: cle('e', c.num * 100 + j) });
      taches.push(async () => ({ c, req, rep: await envoyerCommande(c, req) }));
    }
  });
  const crea = await rafale(taches);
  const reps = crea.resultats.map((z) => z.rep);
  mesure('E1 création de 100 commandes (10 clients x 10)', reps, crea.ms);
  R.controle('E1. 100 commandes créées en rafale : 100×201, aucune erreur', compter(reps, (x) => x.status === 201) === 100, texteRepartition(repartition(reps)));
  const ids = crea.resultats.map((z) => z.rep.json && z.rep.json.order && z.rep.json.order.id);
  R.controle('E1. 100 identifiants distincts, total de chaque réponse = total calculé par le serveur',
    new Set(ids).size === 100 && crea.resultats.every((z) => z.rep.json && z.rep.json.order && z.rep.json.order.total_cents === z.req.totals.total_cents),
    `${new Set(ids).size} ids distincts, ${compter(crea.resultats, (z) => !(z.rep.json && z.rep.json.order && z.rep.json.order.total_cents === z.req.totals.total_cents))} total(aux) différent(s)`);
  const commandes = crea.resultats.map((z, i) => ({ id: ids[i], c: z.c, req: z.req }));

  // E2 : 100 décisions simultanées, une par commande (30 % de refus, sinon acceptation avec un délai tiré au sort)
  const r2 = rng(6510);
  const plan = commandes.map(() => (r2.vrai(0.3) ? { action: 'refuse' } : { action: 'accept', delay_minutes: r2.choix(RETARDS) }));
  const dec = await rafale(commandes.map((o, i) => () => appeler(ctx.tablettes[i % 3], 'owner_order_decide.php', { corps: { id: o.id, ...plan[i] } })));
  mesure('E2 100 décisions, 100 commandes', dec.resultats, dec.ms);
  R.controle('E2. 100 décisions simultanées : 100×200 neuf (aucun rejeu, aucun conflit)', compter(dec.resultats, (x) => x.status === 200 && x.json.replayed === false) === 100, texteRepartition(repartition(dec.resultats)));
  let ecarts = 0;
  const exemples = [];
  commandes.forEach((o, i) => {
    const row = ligneBase(o.id);
    const attendu = plan[i].action === 'refuse' ? 'refused' : 'accepted';
    const bon = row.status === attendu && (attendu === 'refused' || row.delay_minutes === plan[i].delay_minutes) && incoherences(row).length === 0;
    if (!bon) { ecarts++; if (exemples.length < 3) exemples.push(`#${o.id} attendu ${attendu}/${plan[i].delay_minutes}, base ${row.status}/${row.delay_minutes}`); }
  });
  const nbRefus = plan.filter((p) => p.action === 'refuse').length;
  R.controle('E2. chaque commande est dans l\'état de SA décision (statut, délai, horodatages), aucune décision perdue ni croisée', ecarts === 0, ecarts ? exemples.join(' ; ') : `${100 - nbRefus} acceptées, ${nbRefus} refusées, 0 écart`);
  const vues = await rafale(commandes.map((o) => () => appeler(o.c, `order_status.php?id=${o.id}`, { methode: 'GET' })));
  const ecartVue = vues.resultats.filter((x, i) => x.status !== 200 || x.json.order.status !== ligneBase(commandes[i].id).status).length;
  R.controle('E2. chaque client voit l\'état de sa propre commande (100 suivis simultanés)', ecartVue === 0, `${ecartVue} écart(s)`);

  // E3 : 100 « prête » simultanés (acceptées -> prête ; refusées -> 409)
  const pretes = await rafale(commandes.map((o, i) => () => appeler(ctx.tablettes[(i + 1) % 3], 'owner_order_decide.php', { corps: { id: o.id, action: 'ready' } })));
  mesure('E3 100 « prête »', pretes.resultats, pretes.ms);
  const okPrete = pretes.resultats.every((x, i) => (plan[i].action === 'refuse'
    ? x.status === 409 && x.json.error === 'already_decided' && x.json.status === 'refused'
    : x.status === 200 && x.json.replayed === false && x.json.order.status === 'ready' && x.json.order.delay_minutes === plan[i].delay_minutes && incoherences(x.json.order).length === 0));
  R.controle(`E3. « prête » : ${100 - nbRefus}×200 neuf pour les acceptées, ${nbRefus}×409 already_decided (refused) pour les refusées`, okPrete, texteRepartition(repartition(pretes.resultats)));
  const nbPretes = sql1("SELECT COUNT(*) AS n FROM orders WHERE id IN (" + commandes.map((o) => o.id).join(',') + ") AND status = 'ready' AND prepared_at IS NOT NULL").n;
  R.egal('E3. en base, autant de commandes « ready » que de commandes acceptées', nbPretes, 100 - nbRefus);

  // E4 : décisions contradictoires simultanées, 50 nouvelles commandes x 4 décisions, toutes mélangées
  const clients4 = ctx.pool.slice(21, 26); // 5 clients x 10 commandes (limite de 20 envois par 10 minutes et par client)
  const cmd4 = [];
  for (const c of clients4) for (let j = 0; j < 10; j++) cmd4.push({ c, id: await creerSimple(c, 6520 + c.num * 20 + j, { cle: cle('e4', c.num * 100 + j) }) });
  const r4 = rng(6530);
  const lot = [];
  for (const o of cmd4) {
    for (const a of [{ action: 'accept', delay_minutes: 30 }, { action: 'accept', delay_minutes: 40 }, { action: 'refuse' }, { action: 'ready' }]) lot.push({ o, a });
  }
  const mel = r4.melanger(lot);
  const res4 = await rafale(mel.map(({ o, a }, i) => () => appeler(ctx.tablettes[i % 3], 'owner_order_decide.php', { corps: { id: o.id, ...a } })));
  mesure('E4 200 décisions contradictoires sur 50 commandes', res4.resultats, res4.ms);
  R.controle('E4. aucune erreur 5xx ni réseau', aucune5xx(res4.resultats), `${compter(res4.resultats, (x) => x.status === 0 || x.status >= 500)} erreur(s)`);
  let mauvaises = 0;
  const gag = new Map();
  const detail = [];
  for (const o of cmd4) {
    const actions = [];
    const reponsesO = [];
    mel.forEach(({ o: oo, a }, i) => { if (oo === o) { actions.push(a); reponsesO.push(res4.resultats[i]); } });
    const final = ligneBase(o.id);
    const an = analyserDecisions(actions, reponsesO, final, { status: 'new' });
    gag.set(final.status, (gag.get(final.status) || 0) + 1);
    if (an.anomalies.length) { mauvaises++; if (detail.length < 3) detail.push(`#${o.id} ${an.anomalies[0]}`); }
  }
  R.controle('E4. 50 commandes x 4 décisions contradictoires : chacune a un seul gagnant et un état final cohérent', mauvaises === 0,
    mauvaises ? `${mauvaises} commande(s) incohérente(s) : ${detail.join(' ; ')}` : `états finaux ${[...gag.entries()].map(([k, n]) => n + '×' + k).join(', ')}`);
}

// ------------------------------------------------------------------ F. inscriptions simultanées, même e-mail

async function sectionF() {
  R.titre('F. Inscriptions simultanées avec le même e-mail (casses et espaces différents), 40 adresses IP distinctes');
  for (let w = 0; w < 2; w++) {
    const base = `race06-${w}@example.test`;
    const taches = repeter(40, async (i) => {
      const c = new ClientIP('f' + i, ipFictive(1000 + w * 100 + i));
      const corps = corpsInscription(1000 + i, { prefixe: 'race06' });
      corps.email = varianteEmail(base, i);
      corps.password = `Pw-f06-${w}-${i}-Zz9!`;
      return { corps, c, rep: await appeler(c, 'customer_signup.php', { corps }) };
    });
    const { resultats, ms } = await rafale(taches);
    const reps = resultats.map((z) => z.rep);
    mesure(`F${w + 1}`, reps, ms);
    const gagnants = resultats.filter((z) => z.rep.status === 201);
    const nb409 = compter(reps, (x) => x.status === 409 && x.json && x.json.error === 'email_taken');
    registre.inscriptions201 += gagnants.length;
    R.controle(`F${w + 1}. 40 inscriptions du même e-mail : exactement 1×201 et 39×409 email_taken`, gagnants.length === 1 && nb409 === 39, texteRepartition(repartition(reps)));
    R.controle(`F${w + 1}. aucune erreur 5xx ; aucun cookie de session sur les 409`, aucune5xx(reps) && reps.filter((x) => x.status === 409).every((x) => x.setCookies.length === 0),
      `${compter(reps, (x) => x.status >= 500 || x.status === 0)} erreur(s), ${reps.filter((x) => x.status === 409 && x.setCookies.length).length} cookie(s) sur 409`);
    const comptes = sql('SELECT id, email FROM customers WHERE lower(btrim(email)) = ?', base);
    R.controle(`F${w + 1}. un seul compte en base, e-mail enregistré en minuscules sans espaces`, comptes.length === 1 && comptes[0].email === base, `${comptes.length} compte(s) : ${JSON.stringify(comptes.map((c) => c.email))}`);
    if (comptes.length !== 1 || gagnants.length !== 1) continue;
    const gagnant = gagnants[0];
    R.controle(`F${w + 1}. le compte renvoyé au gagnant est le compte en base ; une seule session client créée`,
      gagnant.rep.json.customer.id === comptes[0].id && gagnant.rep.json.customer.email === base && nbActives(comptes[0].id) === 1 && sql1("SELECT COUNT(*) AS n FROM sessions WHERE user_type = 'customer' AND user_id = ?", comptes[0].id).n === 1,
      `compte #${comptes[0].id}, ${nbActives(comptes[0].id)} session(s) active(s)`);
    // Le mot de passe du gagnant (et lui seul) ouvre le compte ; aucun perdant n'a écrasé le mot de passe.
    const test = new ClientIP('f-ok', ipFictive(1090 + w));
    const ok = await appeler(test, 'customer_login.php', { corps: { email: base.toUpperCase(), password: gagnant.corps.password } });
    sessionsAttendues.set(comptes[0].id, 1 + (ok.status === 200 ? 1 : 0)); // inscription + cette connexion de contrôle (autre navigateur)
    const perdants = resultats.filter((z) => z.rep.status === 409).slice(0, 6);
    const refus = [];
    for (const [k, p] of perdants.entries()) refus.push((await appeler(new ClientIP('f-ko' + k, ipFictive(1190 + w * 10 + k)), 'customer_login.php', { corps: { email: base, password: p.corps.password } })).status);
    R.controle(`F${w + 1}. le mot de passe du gagnant ouvre le compte (e-mail saisi en majuscules) ; ceux de 6 perdants sont refusés (401)`,
      ok.status === 200 && refus.every((s) => s === 401), `gagnant ${ok.status}, perdants ${refus.join(' ')}`);
  }
}

// ------------------------------------------------------------------ G. 30 navigateurs, même client

async function sectionG() {
  R.titre('G. Connexions simultanées du même client depuis 30 navigateurs (comportement documenté : une session active par navigateur)');
  const [u] = await creerClients(1, { debut: 300, villes: false, prefixe: 'nav06' });
  registre.inscriptions201++;
  const nav = repeter(30, (i) => new ClientIP('nav' + i, ipFictive(3000 + i))).map((f) => f());
  const { resultats, ms } = await rafale(nav.map((n) => () => appeler(n, 'customer_login.php', { corps: { email: u.email, password: u.password } })));
  mesure('G1 30 navigateurs', resultats, ms);
  R.controle('G1. 30 connexions simultanées du même client : 30×200, aucune erreur 5xx', compter(resultats, (x) => x.status === 200) === 30, texteRepartition(repartition(resultats)));
  const jetons = nav.map((n) => n.cookies.get('subito_customer'));
  const valides = [];
  for (const j of jetons) valides.push(await jetonValide(j));
  R.controle('G1. 30 jetons distincts, tous valides et tous au nom du bon client', new Set(jetons).size === 30 && valides.every((v) => v === u.customer.id), `${new Set(jetons).size} jetons distincts, ${valides.filter((v) => v === u.customer.id).length} valides`);
  const actives = nbActives(u.customer.id);
  R.controle('G1. une session active par navigateur : 31 en base (1 inscription + 30 navigateurs), aucune de perdue ni de dupliquée', actives === 31, `${actives} session(s) active(s)`);
  const dupl = sql1("SELECT COUNT(*) - COUNT(DISTINCT token_hash) AS n FROM sessions WHERE user_type = 'customer' AND user_id = ?", u.customer.id).n;
  R.egal('G1. aucune empreinte de jeton en double', dupl, 0);

  // Déconnexion d'un navigateur : les autres ne sont pas touchés.
  const sortie = await appeler(nav[5], 'customer_logout.php', { corps: {} });
  const apres = [];
  for (const j of jetons) apres.push(await jetonValide(j));
  R.controle('G1. la déconnexion d\'un navigateur n\'invalide que son propre jeton (29 autres valides)', sortie.status === 200 && apres[5] === null && apres.filter((v) => v === u.customer.id).length === 29, `${apres.filter((v) => v === u.customer.id).length} valides, jeton 5 ${apres[5] === null ? 'révoqué' : 'encore valide'}`);

  // Reconnexions successives (séquentielles) du même navigateur : une seule session reste valide, les précédentes sont révoquées.
  const jetonsSucc = [];
  for (let i = 0; i < 5; i++) {
    await appeler(nav[6], 'customer_login.php', { corps: { email: u.email, password: u.password } });
    jetonsSucc.push(nav[6].cookies.get('subito_customer'));
  }
  const etatSucc = [];
  for (const j of jetonsSucc) etatSucc.push(await jetonValide(j));
  R.controle('G1. 5 reconnexions successives du même navigateur : seul le dernier jeton est valide', etatSucc.slice(0, 4).every((v) => v === null) && etatSucc[4] === u.customer.id, etatSucc.map((v) => (v === null ? 'révoqué' : 'valide')).join(' '));
  sessionsAttendues.set(u.customer.id, 30); // 31 - 1 déconnexion ; les 5 reconnexions remplacent la session précédente
  R.egal('G1. sessions actives après déconnexion et reconnexions : 30 (un navigateur = une session)', nbActives(u.customer.id), 30);

  // Même adresse IP pour les 30 (réseau partagé) : mesure, aucune erreur 5xx.
  const [v] = await creerClients(1, { debut: 301, villes: false, prefixe: 'nat06' });
  registre.inscriptions201++;
  const nat = await rafale(repeter(30, (i) => appeler(new ClientIP('nat' + i, ipFictive(3050)), 'customer_login.php', { corps: { email: v.email, password: v.password } })));
  mesure('G2 30 navigateurs derrière UNE adresse IP', nat.resultats, nat.ms);
  R.controle('G2. 30 connexions légitimes depuis la même adresse : aucune erreur 5xx', aucune5xx(nat.resultats), texteRepartition(repartition(nat.resultats)));
  const bons = compter(nat.resultats, (x) => x.status === 200);
  R.info(`G2 connexions légitimes acceptées derrière une même IP : ${bons}/30 (les autres : ${texteRepartition(repartition(nat.resultats.filter((x) => x.status !== 200)))})`);
  sessionsAttendues.set(v.customer.id, 1 + bons); // 1 session d'inscription + 1 par navigateur connecté

  // Même navigateur (même cookie) : 30 connexions simultanées. Une seule session devrait rester valide pour ce navigateur.
  for (let tour = 0; tour < 2; tour++) {
    const [w] = await creerClients(1, { debut: 310 + tour, villes: false, prefixe: 'mono06' });
    registre.inscriptions201++;
    const navig = new ClientIP('mono' + tour, ipFictive(3100 + tour));
    await appeler(navig, 'customer_login.php', { corps: { email: w.email, password: w.password } });
    const jeton0 = navig.cookies.get('subito_customer');
    const copies = repeter(30, (i) => new ClientIP('copie' + i, ipFictive(3200 + tour * 40 + i))).map((f) => copierCookies(navig, f()));
    const rr = await rafale(copies.map((j) => () => appeler(j, 'customer_login.php', { corps: { email: w.email, password: w.password } })));
    mesure(`G3.${tour + 1} même navigateur x30`, rr.resultats, rr.ms);
    R.controle(`G3.${tour + 1}. 30 connexions simultanées du MÊME navigateur : 30×200, aucune erreur 5xx`, compter(rr.resultats, (x) => x.status === 200) === 30, texteRepartition(repartition(rr.resultats)));
    const emis = copies.map((j) => j.cookies.get('subito_customer'));
    const etat = [];
    for (const j of emis) etat.push(await jetonValide(j));
    const nbValides = etat.filter((x) => x === w.customer.id).length;
    R.controle(`G3.${tour + 1}. l'ancien jeton du navigateur est révoqué`, (await jetonValide(jeton0)) === null, 'jeton initial révoqué');
    R.controle(`G3.${tour + 1}. une seule session active par navigateur : au plus 1 des 30 jetons émis reste valide`, nbValides <= 1, `${nbValides} jeton(s) valide(s) sur ${new Set(emis).size} émis`);
    sessionsAttendues.set(w.customer.id, null);
  }
}

// ------------------------------------------------------------------ H. réponses perdues

async function sectionH() {
  R.titre('H. Réponses perdues : le client raccroche juste après l\'envoi, puis renvoie avec la même clé');
  const clients = ctx.pool.slice(26, 30);
  const r = rng(6800);
  const reqs = [];
  clients.forEach((c, k) => {
    for (let j = 0; j < 10; j++) reqs.push({ c, req: fabriquer(r, c, { mode: j % 2 ? 'delivery' : 'pickup', cle: cle('h', k * 100 + j) }) });
  });
  const avant = sql1('SELECT COUNT(*) AS n FROM orders').n;
  const t0 = performance.now();
  await Promise.all(reqs.map(({ c, req }) => envoyerEtRaccrocher(c, 'order_create.php', req.body)));
  const apresAbandon = await attendreStable(() => sql1('SELECT COUNT(*) AS n FROM orders').n);
  const crees = apresAbandon - avant;
  R.info(`H : ${reqs.length} envois abandonnés après l'envoi complet ; le serveur a quand même créé ${crees} commande(s) en ${Math.round(performance.now() - t0)} ms`);
  const doubles = sql1('SELECT COUNT(*) AS n FROM (SELECT customer_id, idempotency_key FROM orders GROUP BY 1, 2 HAVING COUNT(*) > 1) t').n;
  R.egal('H. aucun doublon créé par les envois abandonnés', doubles, 0);
  const renvoi = await rafale(reqs.map(({ c, req }) => () => envoyerCommande(c, req)));
  mesure('H renvoi des 40 envois', renvoi.resultats, renvoi.ms);
  const n201 = compter(renvoi.resultats, (x) => x.status === 201);
  const nRej = compter(renvoi.resultats, (x) => x.status === 200 && x.json.replayed === true);
  R.controle('H. le renvoi avec la même clé ne perd aucune commande : 200 rejoué si déjà créée, 201 sinon (jamais d\'erreur)', n201 + nRej === 40, `${n201}×201, ${nRej}×200 rejoué (${crees} commandes créées par les envois abandonnés)`);
  const total = sql1('SELECT COUNT(*) AS n FROM orders').n - avant;
  R.egal('H. exactement une commande par clé au final (40)', total, 40);

  // Décisions abandonnées : le patron raccroche juste après « accepter », puis renvoie.
  const c = ctx.pool[30];
  const ids = [];
  for (let i = 0; i < 12; i++) ids.push(await creerSimple(c, 6850 + i, { cle: cle('h2', i) }));
  await Promise.all(ids.map((id) => envoyerEtRaccrocher(ctx.patron, 'owner_order_decide.php', { id, action: 'accept', delay_minutes: 30 })));
  await attendreStable(() => sql1("SELECT COUNT(*) AS n FROM orders WHERE status = 'accepted' AND customer_id = ?", c.customer.id).n);
  const dejaAcceptees = sql1("SELECT COUNT(*) AS n FROM orders WHERE status = 'accepted' AND customer_id = ?", c.customer.id).n;
  const rs = await rafale(ids.map((id) => () => appeler(ctx.patron, 'owner_order_decide.php', { corps: { id, action: 'accept', delay_minutes: 30 } })));
  const rejoues = compter(rs.resultats, (x) => x.status === 200 && x.json.replayed === true);
  const neufs = compter(rs.resultats, (x) => x.status === 200 && x.json.replayed === false);
  R.controle('H. acceptations abandonnées puis renvoyées : les 12 renvois répondent 200 (rejoué si déjà traité), jamais de 409 ni de 5xx', rs.resultats.every((x) => x.status === 200) && rejoues + neufs === 12,
    `${dejaAcceptees} déjà acceptées avant le renvoi ; renvoi : ${neufs}×neuf, ${rejoues}×rejoué`);
  const finals = sql(`SELECT status, delay_minutes FROM orders WHERE id IN (${ids.join(',')})`);
  R.controle('H. état final : 12 commandes « accepted » à 30 minutes', finals.length === 12 && finals.every((f) => f.status === 'accepted' && f.delay_minutes === 30), `${finals.filter((f) => f.status === 'accepted' && f.delay_minutes === 30).length}/12`);
}

// ------------------------------------------------------------------ I. orage mixte

async function sectionI() {
  R.titre('I. Orage mixte : 50 commandes créées en rafale pendant que 3 tablettes interrogent et acceptent, et que les clients suivent');
  const clients = ctx.pool.slice(31, 36); // 5 x 10 commandes
  const ids = new Set(clients.map((c) => c.customer.id));
  const arret = { fin: false };
  const decisions = [];
  const sansLigne = new Set();
  const anomalies = [];
  let erreursTablette = 0;
  const acceptees = new Set();
  const sondeTablette = async (t, k) => {
    while (!arret.fin) {
      const l = await appeler(t, 'owner_orders.php', { methode: 'GET' });
      if (l.status !== 200) erreursTablette++;
      else {
        for (const o of l.json.orders) {
          if (!ids.has(o.customer_id)) continue;
          if (o.items.length === 0) sansLigne.add(o.id);
          for (const m of incoherences(o)) anomalies.push(`#${o.id} ${m}`);
          if (o.status === 'new' && o.id % 3 === k) {
            const d = await appeler(t, 'owner_order_decide.php', { corps: { id: o.id, action: 'accept', delay_minutes: RETARDS[o.id % 5] } });
            decisions.push(d);
            if (d.status === 200) acceptees.add(o.id);
          }
        }
      }
      await pause(60);
    }
  };
  const suivis = new Map(); // client -> id commande -> statuts vus
  let erreursSuivi = 0;
  const sondeClient = async (c) => {
    while (!arret.fin) {
      const l = await appeler(c, 'customer_orders.php', { methode: 'GET' });
      if (l.status !== 200) erreursSuivi++;
      else {
        for (const o of l.json.orders) {
          if (o.items.length === 0) sansLigne.add(o.id);
          for (const m of incoherences(o)) anomalies.push(`suivi #${o.id} ${m}`);
          const cleS = `${c.customer.id}:${o.id}`;
          if (!suivis.has(cleS)) suivis.set(cleS, []);
          suivis.get(cleS).push(o.status);
        }
      }
      await pause(100);
    }
  };
  const fond =[...ctx.tablettes.map((t, k) => sondeTablette(t, k)), ...clients.map((c) => sondeClient(c))];
  const r = rng(6900);
  const taches = [];
  clients.forEach((c) => { for (let j = 0; j < 10; j++) { const req = fabriquer(r, c, { mode: j % 2 === 0 ? 'pickup' : 'delivery', cle: cle('i', c.num * 100 + j) }); taches.push(() => envoyerCommande(c, req)); } });
  const { resultats, ms } = await rafale(taches);
  mesure('I création de 50 commandes sous surveillance', resultats, ms);
  for (let i = 0; i < 300 && acceptees.size < 50; i++) await pause(100);
  await pause(120);
  arret.fin = true;
  await Promise.all(fond);
  R.controle('I. 50 commandes créées : 50×201', compter(resultats, (x) => x.status === 201) === 50, texteRepartition(repartition(resultats)));
  R.controle('I. les 3 tablettes ont accepté chacune « leurs » commandes : 50 acceptées, toutes en 200, sans 5xx', acceptees.size === 50 && decisions.every((d) => d.status === 200) && erreursTablette === 0,
    `${acceptees.size} acceptées, ${decisions.length} décisions (${texteRepartition(repartition(decisions))}), ${erreursTablette} sondage(s) en erreur`);
  R.controle('I. une commande n\'est jamais visible sans ses lignes, ni dans un état incohérent (tablettes et clients)', sansLigne.size === 0 && anomalies.length === 0, `${sansLigne.size} sans ligne, ${anomalies.length} incohérence(s) ${anomalies.slice(0, 2).join(' ; ')}`);
  const reculs = [...suivis.entries()].filter(([, s]) => !suiteValide(s)).length;
  R.controle('I. le suivi de chaque client ne recule jamais (new -> accepted)', reculs === 0 && erreursSuivi === 0, `${suivis.size} suivis, ${reculs} recul(s), ${erreursSuivi} sondage(s) en erreur`);
  const idsOrdres = resultats.filter((x) => x.json && x.json.order).map((x) => x.json.order.id);
  const faux = sql(`SELECT id FROM orders WHERE id IN (${idsOrdres.join(',')}) AND (status <> 'accepted' OR delay_minutes IS NULL)`).length;
  R.egal('I. en base, les 50 commandes sont acceptées avec un délai', faux, 0);
}

// ------------------------------------------------------------------ J. limiteurs sous rafale

async function sectionJ() {
  R.titre('J. Limiteurs de débit sous rafale : le contrôle du verrou et le compteur ne sont pas atomiques');
  const bornes = { patron: 5, client: 5, inscription: 10, commande: 20 };
  for (let rep = 0; rep < 2; rep++) {
    const n = rep + 1;
    const base = 60000 + rep * 100;

    // J1. code patron : 8 essais séquentiels, puis 40 essais simultanés (39 faux + le bon au milieu) depuis une autre adresse
    const seq = [];
    for (let i = 0; i < 8; i++) seq.push((await appeler(new ClientIP('p', ipFictive(base + 1)), 'owner_login.php', { corps: { code: 'faux-code-' + i } })).status);
    R.egal(`J1.${n} code patron, essais séquentiels (limite 5) : 5×401 puis verrou 429`, seq, [401, 401, 401, 401, 401, 429, 429, 429]);
    const pos = 24;
    const rP = await rafale(repeter(40, (i) => appeler(new ClientIP('pp' + i, ipFictive(base + 2)), 'owner_login.php', { corps: { code: i === pos ? site.codePatron : 'faux-' + i, remember: false } })));
    mesure(`J1.${n} 40 essais simultanés de code patron`, rP.resultats, rP.ms);
    const evalues = compter(rP.resultats, (x) => x.status === 401 || x.status === 200);
    R.controle(`J1.${n} code patron : au plus ${bornes.patron} essais évalués sur 40 simultanés (le reste en 429), aucune 5xx`, evalues <= bornes.patron && aucune5xx(rP.resultats), `${evalues} essais évalués, ${compter(rP.resultats, (x) => x.status === 429)}×429`);
    R.controle(`J1.${n} code patron : le bon code noyé au milieu de 40 essais simultanés est refusé (429)`, rP.resultats[pos].status === 429, `le bon code reçoit HTTP ${rP.resultats[pos].status}`);
    const apresP = await appeler(new ClientIP('pa', ipFictive(base + 2)), 'owner_login.php', { corps: { code: site.codePatron } });
    R.controle(`J1.${n} code patron : après la rafale, l'adresse est bien verrouillée (429)`, apresP.status === 429, `HTTP ${apresP.status}`);

    // J2. connexion client : même schéma
    const [v] = await creerClients(1, { debut: base + 10, villes: false, prefixe: 'lim06' });
    registre.inscriptions201++;
    const seqC = [];
    for (let i = 0; i < 8; i++) seqC.push((await appeler(new ClientIP('c', ipFictive(base + 11)), 'customer_login.php', { corps: { email: v.email, password: 'faux-mdp-' + i } })).status);
    R.egal(`J2.${n} connexion client, échecs séquentiels (limite 5) : 5×401 puis verrou 429`, seqC, [401, 401, 401, 401, 401, 429, 429, 429]);
    const rC = await rafale(repeter(40, (i) => appeler(new ClientIP('cc' + i, ipFictive(base + 12)), 'customer_login.php', { corps: { email: v.email, password: i === pos ? v.password : 'faux-mdp-' + i } })));
    mesure(`J2.${n} 40 connexions simultanées (39 fausses + la bonne)`, rC.resultats, rC.ms);
    const evalC = compter(rC.resultats, (x) => x.status === 401 || x.status === 200);
    R.controle(`J2.${n} connexion client : au plus ${bornes.client} mots de passe évalués sur 40 simultanés, aucune 5xx`, evalC <= bornes.client && aucune5xx(rC.resultats), `${evalC} mots de passe évalués, ${compter(rC.resultats, (x) => x.status === 429)}×429`);
    R.controle(`J2.${n} connexion client : le bon mot de passe noyé au milieu de 40 essais simultanés est refusé (429)`, rC.resultats[pos].status === 429, `le bon mot de passe reçoit HTTP ${rC.resultats[pos].status}`);
    sessionsAttendues.set(v.customer.id, 1 + compter(rC.resultats, (x) => x.status === 200)); // une session par connexion réussie

    // J3. inscriptions : 12 séquentielles (limite 10 par heure et par adresse), puis 30 simultanées depuis une autre adresse
    const seqS = [];
    for (let i = 0; i < 12; i++) {
      const rs = await appeler(new ClientIP('s', ipFictive(base + 21)), 'customer_signup.php', { corps: corpsInscription(base * 10 + i, { prefixe: 'lim06s' }) });
      seqS.push(rs.status);
      if (rs.status === 201) registre.inscriptions201++;
    }
    R.egal(`J3.${n} inscriptions séquentielles (limite 10 par heure) : 10×201 puis 2×429`, seqS, [201, 201, 201, 201, 201, 201, 201, 201, 201, 201, 429, 429]);
    const rI = await rafale(repeter(30, (i) => appeler(new ClientIP('si' + i, ipFictive(base + 22)), 'customer_signup.php', { corps: corpsInscription(base * 10 + 100 + i, { prefixe: 'lim06p' }) })));
    mesure(`J3.${n} 30 inscriptions simultanées depuis une adresse`, rI.resultats, rI.ms);
    const creesI = compter(rI.resultats, (x) => x.status === 201);
    registre.inscriptions201 += creesI;
    R.controle(`J3.${n} inscriptions : au plus ${bornes.inscription} comptes créés sur 30 simultanés (limite par adresse), aucune 5xx`, creesI <= bornes.inscription && aucune5xx(rI.resultats), `${creesI} comptes créés, ${compter(rI.resultats, (x) => x.status === 429)}×429`);

    // J4. commandes : 22 séquentielles (limite 20 par 10 min), puis 60 distinctes simultanées d'un autre client
    const [c1, c2] = await creerClients(2, { debut: base + 30, villes: true, prefixe: 'lim06o' });
    registre.inscriptions201 += 2;
    const rr = rng(7000 + rep);
    const seqO = [];
    for (let i = 0; i < 22; i++) seqO.push((await envoyerCommande(c1, fabriquer(rr, c1, { mode: 'pickup' }))).status);
    R.egal(`J4.${n} commandes séquentielles d'un client (limite 20 par 10 min) : 20×201 puis 2×429`, [seqO.filter((s) => s === 201).length, seqO.filter((s) => s === 429).length], [20, 2]);
    const rO = await rafale(repeter(60, () => envoyerCommande(c2, fabriquer(rr, c2, { mode: 'pickup' }))));
    mesure(`J4.${n} 60 commandes distinctes simultanées d'un client`, rO.resultats, rO.ms);
    const creesO = compter(rO.resultats, (x) => x.status === 201);
    R.controle(`J4.${n} commandes : au plus ${bornes.commande} commandes créées sur 60 envois distincts simultanés d'un client, aucune 5xx`, creesO <= bornes.commande && aucune5xx(rO.resultats), `${creesO} commandes créées, ${compter(rO.resultats, (x) => x.status === 429)}×429`);
    const thr = sql1('SELECT attempts, locked_until FROM throttle WHERE bucket = ?', 'order_create:customer:' + c2.customer.id);
    R.info(`J4.${n} compteur d'envois du client après la rafale : ${thr && thr.attempts} (limite ${bornes.commande}), verrou ${thr && thr.locked_until ? 'posé' : 'non posé'}`);
    // Le verrou est propre au client : un autre client n'est pas affecté.
    const autre = await envoyerCommande(ctx.pool[0], fabriquer(rr, ctx.pool[0], { mode: 'pickup' }));
    R.controle(`J4.${n} le verrou d'un client n'affecte pas les autres clients`, autre.status === 201, cleReponseCourte(autre));
  }
}

// ------------------------------------------------------------------ Z. contrôle final

async function sectionZ() {
  R.titre('Z. Contrôle final de la base, du journal serveur et des réponses');
  await attendreStable(() => sql1('SELECT COUNT(*) AS n FROM orders').n, { pas: 150, stable: 3, max: 20 });

  const uniques = new Set(sql("SELECT conname FROM pg_constraint WHERE contype = 'u' AND conname LIKE 'uq\_%'").map((c) => c.conname));
  R.controle('Z1. contraintes d\'unicité présentes (clé d\'envoi par client, e-mail, empreinte de jeton)', ['uq_orders_idem', 'uq_customers_email', 'uq_sessions_token'].every((n) => uniques.has(n)), [...uniques].join(', '));
  R.egal('Z2. aucun doublon (client, clé d\'envoi) dans orders', sql('SELECT customer_id, idempotency_key FROM orders GROUP BY 1, 2 HAVING COUNT(*) > 1').length, 0);
  R.egal('Z2. aucun doublon d\'e-mail (casse et espaces ignorés) dans customers', sql('SELECT lower(btrim(email)) AS e FROM customers GROUP BY 1 HAVING COUNT(*) > 1').length, 0);
  R.egal('Z2. tous les e-mails sont enregistrés en minuscules, sans espace parasite', sql1('SELECT COUNT(*) AS n FROM customers WHERE email <> lower(btrim(email))').n, 0);
  R.egal('Z2. aucune empreinte de jeton de session en double', sql('SELECT token_hash FROM sessions GROUP BY 1 HAVING COUNT(*) > 1').length, 0);

  R.egal('Z3. aucune ligne d\'article orpheline (order_items sans commande)', sql1('SELECT COUNT(*) AS n FROM order_items i WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.id = i.order_id)').n, 0);
  R.egal('Z3. aucune commande sans lignes d\'articles', sql1('SELECT COUNT(*) AS n FROM orders o WHERE NOT EXISTS (SELECT 1 FROM order_items i WHERE i.order_id = o.id)').n, 0);
  R.egal('Z3. positions d\'articles uniques et consécutives dans chaque commande', sql1('SELECT COUNT(*) AS n FROM (SELECT order_id FROM order_items GROUP BY order_id HAVING COUNT(*) <> COUNT(DISTINCT position) OR MIN(position) <> 0 OR MAX(position) <> COUNT(*) - 1) t').n, 0);
  R.egal('Z3. aucune commande ni session rattachée à un client inexistant',
    sql1('SELECT COUNT(*) AS n FROM orders o WHERE NOT EXISTS (SELECT 1 FROM customers c WHERE c.id = o.customer_id)').n + sql1("SELECT COUNT(*) AS n FROM sessions s WHERE s.user_type = 'customer' AND NOT EXISTS (SELECT 1 FROM customers c WHERE c.id = s.user_id)").n, 0);

  R.egal('Z4. total = produits - promotion + frais pour toutes les commandes', sql1('SELECT COUNT(*) AS n FROM orders WHERE total_cents <> products_cents - promo_cents + delivery_fee_cents').n, 0);
  R.egal('Z4. produits = somme des lignes ; ligne = prix unitaire x quantité', sql1('SELECT COUNT(*) AS n FROM orders o WHERE products_cents <> (SELECT COALESCE(SUM(line_total_cents), 0) FROM order_items i WHERE i.order_id = o.id)').n
    + sql1('SELECT COUNT(*) AS n FROM order_items WHERE line_total_cents <> unit_price_cents * qty').n, 0);

  // Commande par commande : base = réponse = calcul serveur de référence, lignes identiques à l'envoi
  const lignesParCommande = new Map();
  for (const l of sql('SELECT order_id, variant, qty, unit_price_cents FROM order_items ORDER BY order_id, position')) {
    if (!lignesParCommande.has(l.order_id)) lignesParCommande.set(l.order_id, []);
    lignesParCommande.get(l.order_id).push([l.variant, l.qty, l.unit_price_cents]);
  }
  const rows = new Map(sql('SELECT * FROM orders').map((o) => [o.id, o]));
  let ecartTotal = 0;
  let ecartLignes = 0;
  let ecartClient = 0;
  let manquantes = 0;
  const exemples = [];
  for (const [id, reg] of registre.commandes) {
    const o = rows.get(id);
    if (!o) { manquantes++; continue; }
    if (!(o.total_cents === reg.totalReponse && o.total_cents === reg.totals.total_cents && o.products_cents === reg.totals.products_cents && o.promo_cents === reg.totals.promo_cents && o.delivery_fee_cents === reg.totals.delivery_fee_cents)) {
      ecartTotal++;
      if (exemples.length < 3) exemples.push(`#${id} base ${o.total_cents}, réponse ${reg.totalReponse}, calcul ${reg.totals.total_cents}`);
    }
    if (JSON.stringify(lignesParCommande.get(id)) !== JSON.stringify(reg.lignes)) ecartLignes++;
    if (o.customer_id !== reg.clientId || o.idempotency_key !== reg.cle) ecartClient++;
  }
  R.controle(`Z5. ${registre.commandes.size} commandes : total en base = total de la réponse = total calculé (produits, promotion, frais)`, ecartTotal === 0 && manquantes === 0, `${ecartTotal} écart(s), ${manquantes} absente(s) de la base ${exemples.join(' ; ')}`);
  R.controle('Z5. lignes d\'articles en base identiques à l\'envoi (variante, quantité, prix) pour chaque commande', ecartLignes === 0, `${ecartLignes} commande(s) différente(s)`);
  R.controle('Z5. chaque commande appartient au bon client avec la bonne clé d\'envoi', ecartClient === 0, `${ecartClient} écart(s)`);
  const fantomes = [...rows.keys()].filter((id) => !registre.commandes.has(id));
  R.controle('Z6. aucune commande fantôme : toutes les commandes en base ont été renvoyées à un client (aucune créée sans réponse)', fantomes.length === 0 && rows.size === registre.commandes.size, `${rows.size} commandes en base, ${registre.commandes.size} connues par les réponses, ${fantomes.length} fantôme(s)`);
  const incoh = [...rows.values()].filter((o) => incoherences(o).length > 0);
  R.controle(`Z7. statut et horodatages cohérents pour les ${rows.size} commandes (jamais accepted_at ET refused_at)`, incoh.length === 0, `${incoh.length} incohérente(s)`);
  const statuts = sql('SELECT status, COUNT(*) AS n FROM orders GROUP BY status ORDER BY status').map((s) => `${s.n}×${s.status}`).join(', ');
  R.info(`Z7 répartition des statuts : ${statuts}`);

  const nbClients = sql1('SELECT COUNT(*) AS n FROM customers').n;
  R.controle('Z8. aucun compte fantôme : autant de comptes en base que d\'inscriptions réussies (201)', nbClients === registre.inscriptions201, `${nbClients} comptes, ${registre.inscriptions201} inscriptions 201`);
  const parClient = new Map(sql("SELECT user_id, COUNT(*) AS n FROM sessions WHERE user_type = 'customer' AND revoked_at IS NULL GROUP BY user_id").map((s) => [s.user_id, s.n]));
  const clientsEcart = [];
  for (const c of sql('SELECT id FROM customers')) {
    const attendu = sessionsAttendues.has(c.id) ? sessionsAttendues.get(c.id) : 1;
    if (attendu !== null && (parClient.get(c.id) || 0) !== attendu) clientsEcart.push(`#${c.id}:${parClient.get(c.id) || 0}≠${attendu}`);
  }
  R.controle('Z9. une seule session client active par client (un navigateur = une session ; 30 pour le client des 30 navigateurs)', clientsEcart.length === 0, clientsEcart.length ? clientsEcart.slice(0, 5).join(' ') : `${nbClients - [...sessionsAttendues.keys()].length} clients à 1 session`);
  const multi = [...sessionsAttendues.entries()].filter(([, v]) => v === null).map(([id]) => `#${id}:${parClient.get(id) || 0}`);
  R.info(`Z9 clients des scénarios de connexions simultanées (écarts déjà jugés en section G) : ${multi.join(' ')}`);
  R.egal('Z10. aucun compteur de limitation de débit négatif', sql1('SELECT COUNT(*) AS n FROM throttle WHERE attempts < 0').n, 0);

  const journal = site.journal();
  const lignes = journal.split('\n').filter(Boolean);
  const attendues = /^\[subito-api\] \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z [a-z_]+\.php (401|403|429) (invalid_credentials|too_many_attempts|bad_origin)$/;
  const inattendues = lignes.filter((l) => !attendues.test(l));
  R.controle(`Z11. journal serveur : ${lignes.length} lignes, toutes de la forme « route, code, horodatage » (401/429), aucune erreur 500`, inattendues.length === 0, inattendues.length ? inattendues.slice(0, 3).join(' | ') : 'aucune ligne inattendue');
  const secrets = lignes.filter((l) => /@example\.test|Essai-|Pw-f06|idem06-|faux-mdp|faux-code|code-patron-test|subito_customer|[A-Za-z0-9_-]{43}/.test(l));
  R.controle('Z11. journal serveur : aucun e-mail, mot de passe, code patron, jeton ni clé d\'envoi', secrets.length === 0, `${secrets.length} ligne(s) suspecte(s)`);
  const bilan = { total: reponses.length, cinqXX: reponses.filter((x) => x.status >= 500).length };
  R.controle(`Z12. sur ${bilan.total} requêtes envoyées pendant toute la batterie : aucune erreur 5xx`, bilan.cinqXX === 0, `${bilan.cinqXX} réponse(s) 5xx`);
  const hist = {};
  for (const x of reponses) hist[x.status] = (hist[x.status] || 0) + 1;
  R.info(`Z12 histogramme des statuts HTTP : ${Object.entries(hist).sort((a, b) => b[1] - a[1]).map(([s, n]) => `${n}×${s}`).join(', ')}`);
}

// ------------------------------------------------------------------ exécution

const sections = [
  ['0', 'préparation', preparer], ['A', 'A', sectionA], ['Abis', 'A bis', sectionAbis], ['B', 'B', sectionB], ['C', 'C', sectionC], ['D', 'D', sectionD],
  ['E', 'E', sectionE], ['F', 'F', sectionF], ['G', 'G', sectionG], ['H', 'H', sectionH], ['I', 'I', sectionI], ['J', 'J', sectionJ], ['Z', 'Z', sectionZ]
];
console.log(`Batterie 06 · courses critiques et idempotence · port ${site.port} · Node ${process.version}${seulement.length ? ' · sections ' + seulement.join(',') : ''}`);
try {
  for (const [code, nom, fn] of sections) {
    if (code !== '0' && code !== 'Z' && !veut(code) && !veut(code.replace(/(\d+|bis)$/, ''))) continue;
    const t0 = performance.now();
    try {
      await fn();
    } catch (e) {
      R.controle(`section ${nom} : le script s'exécute sans exception`, false, String((e && e.stack) || e).split('\n').slice(0, 4).join(' / '));
    }
    R.info(`section ${nom} terminée en ${Math.round(performance.now() - t0)} ms`);
  }
} finally {
  const bilan = R.resume();
  console.log('MESURES ' + JSON.stringify(mesures));
  console.log('RESULTAT ' + JSON.stringify(bilan));
  site.arreter();
  clearTimeout(garde);
  process.exit(bilan.echoues ? 1 : 0);
}
