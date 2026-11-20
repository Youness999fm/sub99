// Batterie 03 — RÉCEPTION DES COMMANDES côté commerçant, dans la vraie tablette (navigateur réel).
// Ouvre commercant/index.html connecté (cookies du patron injectés), en tablette 768×1024 puis en téléphone 390×844, pendant que
// des commandes de tous les types arrivent par l'API (à emporter / livraison, chaque moyen de paiement, espèces avec billet et appoint,
// tailles, suppléments, retraits, moitié-moitié, remarques longues, caractères spéciaux, plusieurs lignes, promotion, frais, noms longs).
// Pour chaque commande : mode, nom, téléphone, adresse, paiement, articles et modificateurs, promotion, frais, total, heure de réception,
// pastille « Nouvelle », rang dans la file, ordre de la file. Les valeurs attendues sont calculées par le test (règles métier), pas par le site.
//
//   node tests/massif/lancer.mjs tests/massif/03-reception-patron-ui.mjs --timeout=480
//
// Captures d'écran : %TEMP%\subito-massif-captures\03\
import fs from 'node:fs';
import { demarrerSite } from './lib/env.mjs';
import { ClientIP, ipFictive, patronConnecte, enParallele } from './lib/clients.mjs';
import { rng } from './lib/commandes.mjs';
import { avecNavigateur } from './lib/chrome.mjs';
import {
  creerRapport, sleep, coupe, normEsp, eurTest, parseEur, hmsParis, formatsRecu, minutesRecu, reessayer, reseau, decrire,
  SCRIPT_INITIAL, lireTout, LIRE_NOMS_VISIBLES, attendre, taper, capturer, DOSSIER_CAPTURES
} from './lib/03-outils.mjs';
import { construireFixtures } from './lib/03-fixtures.mjs';

const R = creerRapport();
const garde = setTimeout(() => {
  R.controle('script terminé avant le délai interne de 7 min 30', false, 'délai interne dépassé');
  resumer();
  process.exit(1);
}, 450000);

const TABLETTE = { etiq: '768', largeur: 768, hauteur: 1024, nom: 'tablette 768×1024' };
const TELEPHONE = { etiq: '390', largeur: 390, hauteur: 844, nom: 'téléphone 390×844' };
const PAYSAGE = { etiq: '1024', largeur: 1024, hauteur: 768, nom: 'tablette paysage 1024×768' };
const LATENCE_MAX_MS = 12000; // sondage de 4 s + marge (machine chargée par les autres batteries)

const site = await demarrerSite();
let patronApi = null;
let patronNav = null;
let sentinelle = null;
const attendus = []; // commandes « new » attendues dans la file, dans l'ordre d'arrivée : { fix, id, createdAt, tAvant, tApres, api }
const mesures = { latences: [], captures: [], alarme: null, creationMs: 0, signupMs: 0, pagesErreurs: [], noms: {} };

// ------------------------------------------------------------------------------------------------ envoi des commandes
/** Appel d'API avec nouvel essai sur échec réseau local (voir reessayer() : ports éphémères saturés par les autres batteries). */
const api = (client, methode, route, corps) => reessayer(() => (methode === 'GET' ? client.get(route) : client.post(route, corps)));

async function creerClients(fixtures) {
  const t = Date.now();
  const propres = fixtures.filter((fix) => !fix.memeClient);
  await enParallele(propres, 6, async (fix, i) => {
    const num = 7000 + i;
    const c = new ClientIP('ui03-' + num, ipFictive(num));
    const p = fix.profil;
    const email = `ui03-${num}@example.test`;
    const motDePasse = `Essai-ui03-${num}-Aa1!`;
    let rep = await api(c, 'POST', 'customer_signup.php', { first_name: p.prenom, last_name: p.nom, email, phone: p.tel, password: motDePasse, street: p.rue, city: p.ville, housing_type: p.ville ? 'maison' : null });
    // Une première tentative aboutie malgré une coupure de réponse : le compte existe déjà, on s'y connecte.
    if (rep.status === 409) rep = await api(c, 'POST', 'customer_login.php', { email, password: motDePasse });
    if (rep.status !== 201 && rep.status !== 200) throw new Error(`Inscription du client ${fix.id} refusée : ${rep.status} ${rep.text.slice(0, 300)}`);
    const cu = rep.json.customer;
    if (`${cu.first_name} ${cu.last_name}` !== fix.attendu.nom || cu.phone !== fix.attendu.tel) {
      throw new Error(`Profil ${fix.id} altéré à l'inscription : « ${cu.first_name} ${cu.last_name} » / ${cu.phone}`);
    }
    fix.client = c;
  });
  for (const fix of fixtures.filter((x) => x.memeClient)) {
    const ref = fixtures.find((x) => x.id === fix.memeClient);
    if (!ref || !ref.client) throw new Error(`Client de référence ${fix.memeClient} absent pour ${fix.id}`);
    fix.client = ref.client;
  }
  mesures.signupMs = Date.now() - t;
}

async function envoyer(fix) {
  const tAvant = Date.now();
  const rep = await api(fix.client, 'POST', 'order_create.php', fix.body);
  const tApres = Date.now();
  // 201 = créée ; 200 + replayed = la 1re tentative avait abouti malgré la coupure (même clé d'idempotence).
  if ((rep.status !== 201 && !(rep.status === 200 && rep.json && rep.json.replayed === true)) || !rep.json || !rep.json.order) {
    R.controle(`création de la commande ${fix.id} (${fix.titre})`, false, `HTTP ${rep.status} ${rep.text.slice(0, 350)}`);
    return null;
  }
  return { fix, id: rep.json.order.id, createdAt: rep.json.order.created_at, tAvant, tApres, api: rep.json.order };
}

// ------------------------------------------------------------------------------------------------ comparaisons
function ecart(nom, obs, att, diffs) {
  R.champs++;
  if (obs !== att) diffs.push(`${nom} « ${coupe(obs, 110)} » ≠ « ${coupe(att, 110)} »`);
}

function ecartMods(nom, obs, att, diffs) {
  R.champs++;
  const o = (obs || []).map((m) => `${m.cls}|${normEsp(m.texte)}`);
  const a = att.map((m) => `${m.cls}|${normEsp(m.texte)}`);
  if (o.length !== a.length) { diffs.push(`${nom}: ${o.length} modificateurs ≠ ${a.length} attendus`); return; }
  const i = o.findIndex((x, k) => x !== a[k]);
  if (i >= 0) diffs.push(`${nom}[${i}] « ${coupe(o[i], 110)} » ≠ « ${coupe(a[i], 110)} »`);
}

/** Écran (détail + file + décision) contre l'attendu de la commande. Renvoie la liste des écarts. */
function comparerEcran(snap, rec, rang) {
  const f = rec.fix;
  const a = f.attendu;
  const d = snap.detail;
  const diffs = [];
  const livraison = f.mode === 'delivery';
  const e = (nom, obs, att) => ecart(nom, obs, att, diffs);
  e('rang', d.rang, `Commande ${rang} de la file`);
  e('nom', d.nom, a.nom);
  e('client', d.clientNom, a.nom);
  e('pastille', d.pastille, 'Nouvelle');
  e('pastille.classe', /\bpill-new\b/.test(d.pastilleClasse || ''), true);
  e('mode', (d.mode || '').replace(/^[⌂➜]\s*/u, ''), a.modeTexte);
  const vis = String(d.modeVisuel || '').toUpperCase();
  e('mode(affiché) ' + coupe(vis, 40), livraison ? /LIVRAISON/.test(vis) && !/EMPORTER/.test(vis) : /EMPORTER/.test(vis) && !/LIVRAISON/.test(vis), true);
  e('téléphone', d.clientLignes[0], a.tel);
  e('adresse', d.clientLignes[1] ?? null, a.adresse);
  e('lignes client', d.clientLignes.length, livraison ? 2 : 1);
  e('blocs', JSON.stringify(d.titresBlocs), JSON.stringify(['Client', 'Paiement', 'Articles']));
  e('paiement', normEsp(d.paiement), a.paiement);
  const recus = formatsRecu(rec.tAvant, rec.tApres, Date.now());
  R.champs++;
  if (!recus.includes(normEsp(d.heure))) diffs.push(`heure « ${d.heure} » hors de [${recus.join(' / ')}]`);
  e('nombre d\'articles', d.items.length, a.lignes.length);
  a.lignes.forEach((l, i) => {
    const o = d.items[i] || {};
    e(`art${i + 1}.quantité`, o.qty, l.qty);
    e(`art${i + 1}.titre`, o.titre, l.titre);
    ecartMods(`art${i + 1}.modificateurs`, o.mods, l.mods, diffs);
    e(`art${i + 1}.total`, normEsp(o.total), eurTest(l.total));
  });
  const sp = d.sous.find((s) => s[0] === 'Promotion');
  const sf = d.sous.find((s) => s[0] === 'Frais de livraison');
  e('promotion', sp ? normEsp(sp[1]) : null, a.promo > 0 ? '− ' + eurTest(a.promo) : null);
  e('frais de livraison', sf ? normEsp(sf[1]) : null, a.frais > 0 ? eurTest(a.frais) : null);
  e('lignes de sous-total', d.sous.length, (a.promo > 0 ? 1 : 0) + (a.frais > 0 ? 1 : 0));
  e('libellé du total', d.libelleTotal, 'Total');
  e('total', normEsp(d.total), eurTest(a.total));
  const somme = d.items.reduce((s, it) => s + (parseEur(it.total) ?? NaN), 0);
  const promoEcran = sp ? parseEur(String(sp[1]).replace(/^−\s*/, '')) : 0;
  const fraisEcran = sf ? parseEur(sf[1]) : 0;
  e('cohérence de l\'écran (articles − promotion + frais = total)', somme - promoEcran + fraisEcran, parseEur(d.total));
  e('décision visible', snap.decision.colonneVisible, true);
  e('décision « Accepter » liée à la commande', snap.decision.accepterId, String(rec.id));
  e('décision « Refuser » liée à la commande', snap.decision.refuserId, String(rec.id));
  e('choix du délai fermé', snap.decision.nbDelais, 0);
  const chip = snap.file.chips.find((c) => c.id === String(rec.id));
  e('pastille de file présente', !!chip, true);
  if (chip) {
    const minutes = minutesRecu(rec.tAvant, rec.tApres).map((m) => `${m} · ${eurTest(a.total)}`);
    e('file.nom', chip.titre, a.nom);
    R.champs++;
    if (!minutes.includes(normEsp(chip.sous))) diffs.push(`file.heure·total « ${chip.sous} » hors de [${minutes.join(' / ')}]`);
    e('file.aria', normEsp(chip.aria), `Commande ${rang} de la file, ${a.nom}, ${eurTest(a.total)}`);
    e('file.action', chip.action, 'select');
  }
  e('position dans la file', snap.file.chips.findIndex((c) => c.id === String(rec.id)) + 1, rang);
  e('aucun élément HTML injecté', d.intrus, 0);
  e('script injecté non exécuté', snap.xss, null);
  return diffs;
}

/** Vue API owner_orders contre ce qui a été commandé (permet de savoir si un écart vient de l'API ou de l'écran). */
function comparerApi(o, rec) {
  const f = rec.fix;
  const a = f.attendu;
  const diffs = [];
  const e = (nom, obs, att) => { R.champs++; if (JSON.stringify(obs) !== JSON.stringify(att)) diffs.push(`${nom} ${coupe(JSON.stringify(obs), 90)} ≠ ${coupe(JSON.stringify(att), 90)}`); };
  e('statut', o.status, 'new');
  e('mode', o.mode, f.mode);
  e('nom', o.customer_name, a.nom);
  e('téléphone', o.customer_phone, a.tel);
  e('adresse', o.delivery_address, f.mode === 'delivery' ? { street: f.profil.rue, city: f.profil.ville, housing_type: 'maison' } : null);
  e('moyens de paiement', o.payment_methods, f.paiements);
  e('billet', o.cash_change_for, f.billet);
  e('produits', o.products_cents, a.brut);
  e('promotion', o.promo_cents, a.promo);
  e('frais', o.delivery_fee_cents, a.frais);
  e('total', o.total_cents, a.total);
  e('nombre de lignes', o.items.length, a.lignes.length);
  a.lignes.forEach((l, i) => {
    const it = o.items[i] || {};
    const p = `l${i + 1}.`;
    e(p + 'nom', it.name, l.nomAffiche);
    e(p + 'taille', it.variant, l.taille);
    e(p + 'quantité', it.qty, l.nbQty);
    e(p + 'prix', it.unit_price_cents, l.unite);
    e(p + 'total', it.line_total_cents, l.total);
    e(p + 'retraits', it.removed, l.retraits);
    e(p + 'suppléments', it.extras, l.supplements);
    e(p + 'moitié', it.half, l.moitie);
    e(p + 'remarque', it.note, l.note);
  });
  return diffs;
}

async function verifierApi(nom, recs) {
  const rep = await api(patronApi, 'GET', 'owner_orders.php');
  if (rep.status !== 200) { R.controle(`${nom} : API owner_orders`, false, `HTTP ${rep.status}`); return; }
  const nouvelles = rep.json.orders.filter((o) => o.status === 'new');
  const ids = nouvelles.map((o) => String(o.id)).join(',');
  const att = attendus.map((r) => String(r.id)).join(',');
  R.controle(`${nom} : API owner_orders renvoie les ${attendus.length} commandes en attente dans l'ordre d'arrivée`, ids === att, ids === att ? `${nouvelles.length} commandes` : `reçu ${coupe(ids, 120)} ≠ attendu ${coupe(att, 120)}`);
  const parId = new Map(nouvelles.map((o) => [o.id, o]));
  const diffs = [];
  for (const rec of recs) {
    const o = parId.get(rec.id);
    if (!o) { diffs.push(`${rec.fix.id}: absente de l'API`); continue; }
    for (const d of comparerApi(o, rec)) diffs.push(`${rec.fix.id} ${d}`);
  }
  R.controle(`${nom} : l'API restitue exactement ce qui a été commandé (${recs.length} commandes, tous champs)`, diffs.length === 0, diffs.length ? diffs.slice(0, 4).join(' | ') : `${recs.length} commandes identiques`);
}

// ------------------------------------------------------------------------------------------------ pilotage de la page
async function ouvrir(nav, vp) {
  const page = await nav.ouvrirPage('about:blank', { cookies: patronNav, largeur: vp.largeur, hauteur: vp.hauteur, mobile: true });
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: SCRIPT_INITIAL });
  try { await page.send('Page.bringToFront'); } catch { /* ignoré */ }
  await page.navigate(`${site.base}/commercant/index.html`);
  const pret = await attendre(page,
    "document.getElementById('main') && !document.getElementById('main').hidden && document.getElementById('queue') && document.getElementById('queue').textContent.indexOf('Chargement') === -1", 20000, 100);
  sentinelle = await page.evaluate('window.__sentinelle');
  return { page, pret };
}

const attendreFile = (page, n, ms = 25000) => attendre(page, `document.querySelectorAll('#queue .qchip').length === ${n}`, ms, 100);
const selection = (page) => page.evaluate("(() => { const b = document.querySelector('#queue .qchip.is-on'); return b ? b.dataset.id : null; })()");

function nomsAnnonces(annonces) {
  const noms = [];
  for (const a of annonces) {
    let m;
    if ((m = /^Nouvelle commande de ([\s\S]+)$/.exec(a.texte))) noms.push(m[1]);
    else if ((m = /^(\d+) nouvelles commandes : ([\s\S]+)$/.exec(a.texte))) {
      const l = m[2].split(', ');
      if (l.length !== Number(m[1])) noms.push('?décompte:' + a.texte);
      noms.push(...l);
    } else noms.push('?inconnu:' + a.texte);
  }
  return noms;
}

function nouvelAgregat(vp) {
  return {
    vp, n: 0, taps: [], actifs: [], ordre: [], doublons: 0, reseau: 0, recharge: 0, debord: [], tronques: [], reessais: 0, tailles: [], latences: [], petitsBoutons: [],
    ordreAttendu: () => attendus.map((r) => String(r.id)).join(',')
  };
}

/** Toucher la pastille de la commande, attendre qu'elle soit active, comparer tout l'écran à l'attendu. */
async function verifierCommande(page, rec, vp, agg, { silencieux = false } = {}) {
  const f = rec.fix;
  const sel = `#queue .qchip[data-id="${rec.id}"]`;
  const cond = `(() => { const b = document.querySelector('#queue .qchip.is-on'); return !!b && b.dataset.id === '${rec.id}'; })()`;
  let tap = await taper(page, sel);
  if (!tap.ok) agg.taps.push(`${f.id}: ${tap.introuvable ? 'pastille introuvable' : 'recouverte par ' + tap.couvertPar}`);
  let att = await attendre(page, cond, 3000, 30);
  if (!att.ok && tap.ok) { agg.reessais++; tap = await taper(page, sel); att = await attendre(page, cond, 3000, 30); }
  if (tap.ok) agg.tailles.push(tap.tailleTouch);
  const snap = await page.evaluate(lireTout(vp.largeur));
  const rang = attendus.findIndex((r) => r.id === rec.id) + 1;
  const diffs = comparerEcran(snap, rec, rang);
  agg.n++;
  const actifs = snap.file.chips.filter((c) => c.actif);
  if (actifs.length !== 1) agg.actifs.push(`${f.id}: ${actifs.length} pastilles actives`);
  if (snap.file.chips.map((c) => c.id).join(',') !== agg.ordreAttendu()) agg.ordre.push(f.id);
  agg.doublons += snap.file.doublons;
  if (snap.reseauPerdu) agg.reseau++;
  if (snap.sentinelle !== sentinelle) agg.recharge++;
  const db = snap.debordement;
  if (db.scrollWidth > vp.largeur || db.nbHors > 0) agg.debord.push(`${f.id} « ${coupe(f.attendu.nom, 24)} » : largeur de page ${db.scrollWidth} px, ${db.nbHors} élément(s) hors écran, ex. ${db.hors[0] || '-'}`);
  if (db.tronques.length) agg.tronques.push(`${f.id}: ${db.tronques.join(', ')}`);
  for (const [w, h] of snap.decision.boutons) if (w < 44 || h < 44) agg.petitsBoutons.push(`${f.id}: ${w}×${h}`);
  const d = snap.detail;
  const resume = `rang ${rang} · ${coupe(d.nom, 40)} · ${d.paiement} · ${d.items.length} art. · ${snap.detail.sous.length ? d.sous.map((s) => normEsp(s.join(' '))).join(' ; ') + ' · ' : ''}total ${normEsp(d.total)} · ${normEsp(d.heure)}`;
  if (!silencieux) R.controle(`[${vp.etiq}] ${f.id} ${f.titre}`, diffs.length === 0, diffs.length ? diffs.slice(0, 5).join(' | ') + (diffs.length > 5 ? ` | … (${diffs.length} écarts)` : '') : resume);
  return { snap, diffs };
}

/** Une vague de commandes qui arrivent pendant que la page est ouverte, puis vérification de chacune. */
async function vague(page, vp, agg, nom, fixtures, { rafale = false, stabilite = false, autoSelection = false, rejeux = [], verifier = true } = {}) {
  const selAvant = stabilite ? await selection(page) : null;
  const detailAvant = stabilite ? (await page.evaluate(lireTout(0))).detail.nom : null;
  const iAnn = await page.evaluate('window.__annonces.length');
  const t0 = Date.now();
  let recs = [];
  if (rafale) {
    recs = (await Promise.all(fixtures.map((fix) => envoyer(fix)))).filter(Boolean)
      .sort((x, y) => (x.createdAt < y.createdAt ? -1 : x.createdAt > y.createdAt ? 1 : x.id - y.id));
  } else {
    for (const fix of fixtures) { const rec = await envoyer(fix); if (rec) recs.push(rec); }
  }
  const tFin = Date.now();
  mesures.creationMs += tFin - t0;
  R.controle(`${nom} : ${fixtures.length} commandes envoyées à l'API (201)${rafale ? ' en rafale simultanée' : ''}`, recs.length === fixtures.length, `${recs.length} créées en ${tFin - t0} ms`);
  attendus.push(...recs);

  for (const id of rejeux) {
    const rec = recs.find((r) => r.fix.id === id);
    if (!rec) continue;
    const rep = await api(rec.fix.client, 'POST', 'order_create.php', rec.fix.body);
    R.controle(`${nom} : renvoi du même envoi ${id} = rejeu sans doublon`, rep.status === 200 && rep.json.replayed === true && rep.json.order.id === rec.id, `HTTP ${rep.status}, replayed=${rep.json && rep.json.replayed}, n° ${rep.json && rep.json.order && rep.json.order.id} (attendu ${rec.id})`);
  }

  const att = await attendreFile(page, attendus.length);
  mesures.latences.push(att.ms);
  agg.latences.push(att.ms);
  R.controle(`${nom} : la file passe à ${attendus.length} commande(s) sans recharger la page (délai ${att.ms} ms, sondage de 4 s, limite 12 s)`, att.ok && att.ms <= LATENCE_MAX_MS,
    att.ok ? `${att.ms} ms` : `file incomplète après ${att.ms} ms : ${await page.evaluate("document.querySelectorAll('#queue .qchip').length")} au lieu de ${attendus.length}`);
  const tArrivee = Date.now();
  await sleep(350);
  const annonces = (await page.evaluate('window.__annonces')).slice(iAnn);
  const vus = nomsAnnonces(annonces).sort();
  const voulus = recs.map((r) => r.fix.attendu.nom).sort();
  R.controle(`${nom} : chaque arrivée est annoncée une seule fois dans la zone vocale #live`, JSON.stringify(vus) === JSON.stringify(voulus),
    `${annonces.length} annonce(s) : « ${coupe(annonces.map((a) => a.texte).join(' // '), 160)} »`);
  if (recs.length === 1) {
    R.controle(`${nom} : texte exact de l'annonce d'une commande`, annonces.length === 1 && annonces[0].texte === `Nouvelle commande de ${recs[0].fix.attendu.nom}`, annonces[0] ? annonces[0].texte : '(aucune annonce)');
  }

  if (autoSelection) {
    const s = await page.evaluate(lireTout(vp.largeur));
    const actifs = s.file.chips.filter((c) => c.actif).map((c) => c.id);
    const premier = attendus[0];
    R.controle(`${nom} : la première commande est sélectionnée automatiquement, sans toucher`, actifs.length === 1 && actifs[0] === String(premier.id) && s.detail.nom === premier.fix.attendu.nom && s.detail.rang === 'Commande 1 de la file',
      `active ${JSON.stringify(actifs)} (attendu ${premier.id}), détail « ${coupe(s.detail.nom, 40)} », ${s.detail.rang}`);
  }
  if (stabilite) {
    const s = await page.evaluate(lireTout(vp.largeur));
    const actifs = s.file.chips.filter((c) => c.actif).map((c) => c.id);
    R.controle(`${nom} : l'arrivée de nouvelles commandes ne déplace pas la sélection en cours`, actifs.length === 1 && actifs[0] === selAvant && s.detail.nom === detailAvant,
      `avant ${selAvant} « ${coupe(detailAvant, 30)} », après ${JSON.stringify(actifs)} « ${coupe(s.detail.nom, 30)} »`);
  }
  await verifierApi(nom, recs);
  if (verifier) for (const rec of recs) await verifierCommande(page, rec, vp, agg);
  return { recs, tArrivee };
}

function resumeAgregats(agg, { verbe = 'clics' } = {}) {
  const v = agg.vp;
  const p = `[${v.etiq}]`;
  const lat = agg.latences.length ? `max ${Math.max(...agg.latences)} ms` : 'aucune';
  R.controle(`${p} ${agg.n} ${verbe} : chaque pastille de la file est atteignable au toucher (rien ne la recouvre)`, agg.taps.length === 0, agg.taps.length ? agg.taps.slice(0, 4).join(' | ') : `${agg.n}/${agg.n} touchers reçus, ${agg.reessais} nouvel(s) essai(s)`);
  R.controle(`${p} une seule pastille active après chaque toucher (${agg.n} vérifications)`, agg.actifs.length === 0, agg.actifs.slice(0, 4).join(' | ') || 'toujours exactement une');
  R.controle(`${p} l'ordre de la file (arrivée) est conservé après chaque toucher (${agg.n} vérifications)`, agg.ordre.length === 0, agg.ordre.slice(0, 6).join(', ') || 'ordre identique à l\'arrivée');
  R.controle(`${p} aucune commande en double dans la file`, agg.doublons === 0, `${agg.doublons} doublon(s)`);
  R.controle(`${p} la page n'a jamais été rechargée (sentinelle intacte)`, agg.recharge === 0, `${agg.recharge} lecture(s) avec une autre sentinelle`);
  R.controle(`${p} le bandeau « Connexion perdue » n'est jamais apparu`, agg.reseau === 0, `${agg.reseau} lecture(s)`);
  R.controle(`${p} aucun débordement horizontal de la page (largeur ${v.largeur} px, ${agg.n} commandes affichées)`, agg.debord.length === 0, agg.debord.length ? `${agg.debord.length} commande(s) : ${agg.debord.slice(0, 3).join(' | ')}` : 'largeur de page conforme');
  R.controle(`${p} aucun texte tronqué (overflow caché) dans le détail de la commande`, agg.tronques.length === 0, agg.tronques.slice(0, 3).join(' | ') || 'aucun');
  R.controle(`${p} délai d'apparition des nouvelles commandes ≤ 12 s (${lat})`, agg.latences.every((x) => x <= LATENCE_MAX_MS), `délais : ${agg.latences.join(', ')} ms`);
  const tailleMin = agg.tailles.length ? Math.min(...agg.tailles.flat()) : 0;
  R.controle(`${p} cibles tactiles : pastilles de la file ≥ 44 px (min ${tailleMin} px) et boutons de décision ≥ 44 px`, tailleMin >= 44 && agg.petitsBoutons.length === 0, agg.petitsBoutons.slice(0, 3).join(' | ') || `${agg.tailles.length} pastilles mesurées`);
}

// ------------------------------------------------------------------------------------------------ noms tronqués, comptes modifiés
async function mesurerNomsVisibles(page, vp) {
  const noms = await page.evaluate(LIRE_NOMS_VISIBLES);
  const tronques = noms.filter((n) => n.tronque);
  const parVisible = new Map();
  for (const n of tronques) { if (!parVisible.has(n.visible)) parVisible.set(n.visible, []); parVisible.get(n.visible).push(n); }
  const collisions = [...parVisible.values()].filter((g) => new Set(g.map((x) => x.complet)).size > 1);
  const dures = [];
  for (const g of collisions) {
    const parSous = new Map();
    for (const n of g) { const k = normEsp(n.sous); if (!parSous.has(k)) parSous.set(k, []); parSous.get(k).push(n); }
    for (const [k, l] of parSous) if (new Set(l.map((x) => x.complet)).size > 1) dures.push(`« ${l[0].visible} » ${k} : ${l.map((x) => x.complet).join(' / ')}`);
  }
  const exemple = collisions[0] ? `ex. « ${collisions[0][0].visible} » = ${collisions[0].slice(0, 3).map((x) => x.complet).join(' / ')}` : 'aucune';
  mesures.noms[vp.etiq] = { total: noms.length, tronques: tronques.length, largeur: noms[0] ? noms[0].largeur : null, collisions: collisions.length, dures: dures.length };
  R.info(`[${vp.etiq}] noms de clients coupés par « … » dans la file : ${tronques.length}/${noms.length} pastilles (largeur du nom ${noms[0] ? noms[0].largeur : '?'} px) ; ${collisions.length} nom(s) visible(s) partagé(s) par des clients différents, ${exemple}`);
  R.controle(`[${vp.etiq}] deux clients différents ne sont jamais indiscernables dans la file (même nom visible, même heure, même total)`, dures.length === 0, dures.slice(0, 3).join(' | ') || `${collisions.length} nom(s) visible(s) partagé(s), toujours distingués par l'heure ou le total`);
}

/** Le client modifie son compte APRÈS avoir commandé : la commande garde le nom, le téléphone et l'adresse d'origine. */
async function modifierComptes() {
  const sorties = [];
  const p01 = attendus.find((r) => r.fix.id === 'P01');
  const d01 = attendus.find((r) => r.fix.id === 'D01');
  if (p01) {
    const r1 = await api(p01.fix.client, 'POST', 'customer_update_profile.php', { first_name: 'Nouveau', last_name: 'Nom-Changé', phone: '06 99 99 99 99' });
    sorties.push({ rec: p01, statuts: [r1.status], interdits: ['Nom-Changé', '06 99 99 99 99'] });
  }
  if (d01) {
    const r2 = await api(d01.fix.client, 'POST', 'customer_update_profile.php', { first_name: 'Autre', last_name: 'Identité', phone: '07 88 88 88 88' });
    const r3 = await api(d01.fix.client, 'POST', 'customer_update_address.php', { street: '99 rue du Déménagement', city: 'Rouvroy', housing_type: 'maison' });
    sorties.push({ rec: d01, statuts: [r2.status, r3.status], interdits: ['Identité', '07 88 88 88 88', 'Déménagement'] });
  }
  return sorties;
}

async function verifierComptesModifies(page, vp, agg, modifs) {
  const ecarts = [];
  for (const m of modifs) {
    if (m.statuts.some((x) => x !== 200)) ecarts.push(`${m.rec.fix.id}: modification du compte refusée ${m.statuts.join('/')}`);
    const { diffs } = await verifierCommande(page, m.rec, vp, agg, { silencieux: true });
    for (const d of diffs) ecarts.push(`${m.rec.fix.id} ${d}`);
    const texte = await page.evaluate('document.body.innerText');
    for (const interdit of m.interdits) if (texte.includes(interdit)) ecarts.push(`${m.rec.fix.id}: l'écran affiche « ${interdit} » (donnée du compte modifié)`);
  }
  R.controle("[768] un compte modifié après la commande ne change pas la commande affichée (nom, téléphone, adresse d'origine)", modifs.length === 2 && ecarts.length === 0, ecarts.slice(0, 3).join(' | ') || `${modifs.length} commandes relues après modification du compte`);
}

// ------------------------------------------------------------------------------------------------ alerte sonore (faux AudioContext)
function grouperBips(ts) {
  const tri = [...ts].sort((a, b) => a - b);
  const bips = [];
  for (const t of tri) if (!bips.length || t - bips[bips.length - 1] > 200) bips.push(t);
  return bips;
}

async function testerAlarme(page, tArrivee) {
  const lire = () => page.evaluate('window.__bips.slice()');
  let dernierNb = -1;
  let dernierChangement = Date.now();
  const limite = tArrivee + 55000;
  let finParSilence = false;
  for (;;) {
    const ts = await lire();
    if (ts.length !== dernierNb) { dernierNb = ts.length; dernierChangement = Date.now(); }
    if (Date.now() - dernierChangement > 4200) { finParSilence = true; break; }
    if (Date.now() > limite) break;
    await sleep(400);
  }
  const depuis = (await lire()).filter((t) => t >= tArrivee - 2500);
  const bips = grouperBips(depuis);
  const dernier = bips.length ? bips[bips.length - 1] - tArrivee : null;
  const ecarts = bips.slice(1).map((t, i) => t - bips[i]).sort((a, b) => a - b);
  const mediane = ecarts.length ? ecarts[Math.floor(ecarts.length / 2)] : null;
  mesures.alarme = { bips: bips.length, dureeMs: dernier, medianeMs: mediane };
  R.controle('[768] l\'alerte sonore se déclenche dès l\'arrivée des commandes', bips.length > 0 && bips[0] - tArrivee <= 2000, `premier bip à ${bips.length ? bips[0] - tArrivee : '?'} ms de l'arrivée`);
  R.controle('[768] l\'alerte sonore bipe toutes les ~1,8 s', mediane !== null && mediane >= 1500 && mediane <= 2300, `écart médian entre bips : ${mediane} ms (${bips.length} bips)`);
  R.controle('[768] l\'alerte sonore s\'arrête seule après ~30 s sans nouvelle commande', finParSilence && dernier !== null && dernier >= 24000 && dernier <= 36000, `dernier bip ${dernier} ms après l'arrivée ; arrêt constaté par silence : ${finParSilence}`);
  R.controle('[768] nombre de bips pendant l\'alerte plausible (14 à 22)', bips.length >= 14 && bips.length <= 22, `${bips.length} bips`);
}

// ------------------------------------------------------------------------------------------------ phases
const COURT = process.argv.includes('--court');

async function phaseTablette(nav, groupes) {
  const vp = TABLETTE;
  const agg = nouvelAgregat(vp);
  const { page, pret } = await ouvrir(nav, vp);
  R.controle('[768] la page commerçant s\'ouvre connectée (cookies injectés) et affiche l\'application', pret.ok, pret.ok ? `ouverte en ${pret.ms} ms` : 'application non affichée (écran de connexion ?)');
  if (!pret.ok) { await page.fermer(); return; }
  const visible = await page.evaluate('document.visibilityState');
  R.info(`onglet tablette : visibilité « ${visible} », ${vp.largeur}×${vp.hauteur}`);

  // --- état vide
  await sleep(1300);
  const s0 = await page.evaluate(lireTout(vp.largeur));
  R.controle('[768] file vide : message « Aucune commande en attente. »', s0.file.n === 0 && s0.file.texteVide === 'Aucune commande en attente.', `${s0.file.n} pastille(s), « ${s0.file.texteVide} »`);
  R.controle('[768] détail vide : « En attente de commande »', s0.detail.vide && /En attente de commande/.test(s0.detail.texteVide || ''), `« ${s0.detail.texteVide} »`);
  R.controle('[768] colonne de décision masquée tant qu\'aucune commande n\'est sélectionnée', s0.decision.colonneVisible === false, `visible=${s0.decision.colonneVisible}`);
  const titre = await page.evaluate('document.title');
  R.controle('[768] titre de l\'onglet', titre === 'Espace commerçant — Subito Pizza', titre);
  const bips0 = await page.evaluate('window.__bips.length');
  R.controle('[768] aucune alerte sonore tant que la file est vide', bips0 === 0, `${bips0} bip(s)`);
  const h1 = (await page.evaluate("document.getElementById('clock').textContent"));
  await sleep(1200);
  const h2 = (await page.evaluate("document.getElementById('clock').textContent"));
  const sec = (t) => { const m = /^(\d{2}):(\d{2}):(\d{2})$/.exec(t); return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null; };
  const ref = sec(hmsParis(new Date()));
  const ecartH = sec(h2) === null ? null : Math.min(Math.abs(sec(h2) - ref), 86400 - Math.abs(sec(h2) - ref));
  R.controle('[768] l\'horloge affiche HH:MM:SS, avance seule et donne l\'heure de Paris (±3 s)', sec(h1) !== null && h1 !== h2 && ecartH !== null && ecartH <= 3, `${h1} puis ${h2}, écart avec Paris ${ecartH} s`);
  const c1 = await capturer(page, '01-tablette-file-vide.png', { pleinePage: false });
  mesures.captures.push(c1);

  // --- V1 : à emporter (la première commande seule : sélection automatique)
  const V1 = groupes.V1;
  await vague(page, vp, agg, 'V1a (1re commande)', [V1[0]], { autoSelection: true });
  const bipsA = await page.evaluate('window.__bips.length');
  R.controle('[768] la 1re commande fait sonner l\'alerte (bip émis)', bipsA > 0, `${bipsA} oscillateur(s) créés`);
  await vague(page, vp, agg, 'V1 à emporter', V1.slice(1), { stabilite: true, rejeux: ['P03', 'P05', 'P09'] });
  const p15 = attendus.find((r) => r.fix.id === 'P15');
  if (p15) { await verifierCommande(page, p15, vp, agg, { silencieux: true }); mesures.captures.push(await capturer(page, '03-tablette-modificateurs.png')); }

  // --- V2 : livraison × moyens de paiement
  await vague(page, vp, agg, 'V2 livraison × paiements', groupes.V2, { stabilite: true });
  // --- V3 : frais par ville et promotions en livraison
  const modifs = await modifierComptes();
  await vague(page, vp, agg, 'V3 frais et promotions', groupes.V3);
  await verifierComptesModifies(page, vp, agg, modifs);
  const r03 = attendus.find((r) => r.fix.id === 'R03');
  if (r03) { await verifierCommande(page, r03, vp, agg, { silencieux: true }); mesures.captures.push(await capturer(page, '02-tablette-livraison-especes-promo.png')); }
  // --- V4 : caractères spéciaux et noms longs
  await vague(page, vp, agg, 'V4 caractères spéciaux et noms longs', groupes.V4);
  // --- V5 : extrêmes
  await vague(page, vp, agg, 'V5 extrêmes (40 lignes, 60 pizzas, 20 suppléments)', groupes.V5);

  // --- V6 : rafale de 25 commandes simultanées
  const v6 = await vague(page, vp, agg, 'V6 rafale', groupes.V6, { rafale: true });
  const tArrivee6 = v6.tArrivee;
  await mesurerNomsVisibles(page, vp);
  R.controle(`[768] ${attendus.length} commandes en attente : toutes présentes dans la file`, (await page.evaluate("document.querySelectorAll('#queue .qchip').length")) === attendus.length, `${attendus.length} attendues`);
  await taper(page, `#queue .qchip[data-id="${attendus[0].id}"]`);
  mesures.captures.push(await capturer(page, '04-tablette-file-longue.png'));

  // --- Changer de commande pendant le choix du délai : le choix ne doit pas suivre sur l'autre commande
  const A = attendus[2];
  const B = attendus[3];
  await verifierCommande(page, A, vp, agg, { silencieux: true });
  await taper(page, '#decision [data-action="accept"]');
  await attendre(page, "document.querySelectorAll('#decision [data-action=\"delay\"]').length === 7", 3000, 40);
  const choix = await page.evaluate(lireTout(0));
  R.controle('[768] « Accepter » ouvre le choix du délai (7 durées) pour la commande affichée', choix.decision.nbDelais === 7 && choix.decision.confirmerId === String(A.id), `${choix.decision.nbDelais} durées, confirmer → ${choix.decision.confirmerId} (attendu ${A.id})`);
  await taper(page, `#queue .qchip[data-id="${B.id}"]`);
  await attendre(page, `document.querySelector('#queue .qchip.is-on') && document.querySelector('#queue .qchip.is-on').dataset.id === '${B.id}'`, 3000, 40);
  const apres = await page.evaluate(lireTout(0));
  R.controle('[768] changer de commande pendant le choix du délai referme ce choix et lie « Accepter » à la nouvelle commande', apres.decision.nbDelais === 0 && apres.decision.accepterId === String(B.id) && apres.decision.confirmerId === null,
    `${apres.decision.nbDelais} durées, accepter → ${apres.decision.accepterId} (attendu ${B.id}), confirmer → ${apres.decision.confirmerId}`);

  // --- Alerte sonore : durée, rythme, arrêt, réveil, coupure
  await testerAlarme(page, tArrivee6);
  const a01 = await vague(page, vp, agg, 'V8 commande d\'appoint', groupes.V8, { verifier: true });
  const apresReveil = await page.evaluate('window.__bips.length');
  R.controle('[768] une nouvelle commande réveille l\'alerte sonore après son arrêt', apresReveil > 0 && grouperBips((await page.evaluate('window.__bips.slice()')).filter((t) => t >= a01.tArrivee - 2500)).length >= 1, `${apresReveil} oscillateurs au total`);
  await sleep(2200);
  await taper(page, '[data-action="sound-toggle"]');
  await attendre(page, "document.getElementById('sound-btn').textContent === 'Réactiver le son'", 2000, 40);
  const etiquette = await page.evaluate("document.getElementById('sound-btn').textContent");
  const n1 = await page.evaluate('window.__bips.length');
  await sleep(4200);
  const n2 = await page.evaluate('window.__bips.length');
  R.controle('[768] « Couper le son » arrête immédiatement l\'alerte et change le libellé du bouton', etiquette === 'Réactiver le son' && n2 === n1, `libellé « ${etiquette} », bips ${n1} → ${n2} en 4,2 s`);
  await taper(page, '[data-action="sound-toggle"]');
  await attendre(page, "document.getElementById('sound-btn').textContent === 'Couper le son'", 2000, 40);
  await sleep(600);
  const n3 = await page.evaluate('window.__bips.length');
  R.controle('[768] « Réactiver le son » relance l\'alerte tant qu\'une commande attend', n3 > n2, `bips ${n2} → ${n3}`);

  resumeAgregats(agg);
  R.controle('[768] aucune erreur JavaScript dans la page (exceptions, console.error)', page.erreurs.length === 0, page.erreurs.slice(0, 3).join(' | ') || 'aucune');
  mesures.pagesErreurs.push(...page.erreurs);
  await page.fermer();
}

async function phaseTelephone(nav, groupes) {
  const vp = TELEPHONE;
  const agg = nouvelAgregat(vp);
  const { page, pret } = await ouvrir(nav, vp);
  R.controle('[390] la page commerçant s\'ouvre connectée sur téléphone', pret.ok, pret.ok ? `ouverte en ${pret.ms} ms` : 'application non affichée');
  if (!pret.ok) { await page.fermer(); return; }
  const visible = await page.evaluate('document.visibilityState');
  R.info(`onglet téléphone : visibilité « ${visible} », ${vp.largeur}×${vp.hauteur}`);
  const att = await attendreFile(page, attendus.length);
  R.controle(`[390] au chargement, les ${attendus.length} commandes en attente sont toutes dans la file`, att.ok, `${await page.evaluate("document.querySelectorAll('#queue .qchip').length")} pastilles`);
  const s = await page.evaluate(lireTout(vp.largeur));
  const premier = attendus[0];
  const actifs = s.file.chips.filter((c) => c.actif).map((c) => c.id);
  R.controle('[390] au chargement, la première commande (la plus ancienne) est sélectionnée automatiquement', actifs.length === 1 && actifs[0] === String(premier.id) && s.detail.nom === premier.fix.attendu.nom && s.detail.rang === 'Commande 1 de la file',
    `active ${JSON.stringify(actifs)} (attendu ${premier.id}), « ${coupe(s.detail.nom, 40)} », ${s.detail.rang}`);
  R.controle('[390] l\'ordre de la file au chargement est l\'ordre d\'arrivée', s.file.chips.map((c) => c.id).join(',') === attendus.map((r) => String(r.id)).join(','), `${s.file.n} pastilles`);
  const ann0 = await page.evaluate('window.__annonces.length');
  R.controle('[390] aucune annonce vocale pour les commandes déjà présentes au chargement', ann0 === 0, `${ann0} annonce(s)`);
  await mesurerNomsVisibles(page, vp);

  // Arrivées pendant l'affichage sur téléphone
  await vague(page, vp, agg, 'V7 arrivées sur téléphone', groupes.V7, { stabilite: true });

  // Toutes les commandes, dans un ordre mélangé (graine fixe), au toucher
  const ordre = rng(2026).melanger(attendus.filter((r) => !groupes.V7.includes(r.fix)));
  for (const rec of ordre) {
    await verifierCommande(page, rec, vp, agg);
    if (rec.fix.id === 'R03') mesures.captures.push(await capturer(page, '05-telephone-livraison-promo.png'));
    if (rec.fix.id === 'L02') mesures.captures.push(await capturer(page, '06-telephone-nom-long.png'));
  }

  // --- La commande sélectionnée disparaît de la file (décision par l'API) : la sélection retombe sur la première
  const milieu = attendus[9];
  await taper(page, `#queue .qchip[data-id="${milieu.id}"]`);
  await attendre(page, `document.querySelector('#queue .qchip.is-on') && document.querySelector('#queue .qchip.is-on').dataset.id === '${milieu.id}'`, 3000, 40);
  const t1 = Date.now();
  const rep = await api(patronApi, 'POST', 'owner_order_decide.php', { id: milieu.id, action: 'accept', delay_minutes: 20 });
  attendus.splice(9, 1);
  const dispar = await attendre(page, `!document.querySelector('#queue .qchip[data-id="${milieu.id}"]')`, 12000, 100);
  const s2 = await page.evaluate(lireTout(vp.largeur));
  const nouveauPremier = attendus[0];
  const act2 = s2.file.chips.filter((c) => c.actif).map((c) => c.id);
  R.controle('[390] la commande acceptée par l\'API quitte la file sans recharger (≤ 12 s)', rep.status === 200 && dispar.ok && Date.now() - t1 <= LATENCE_MAX_MS && s2.file.n === attendus.length, `HTTP ${rep.status}, disparue après ${Date.now() - t1} ms, ${s2.file.n} pastilles (attendu ${attendus.length})`);
  R.controle('[390] la sélection de la commande disparue retombe sur la première de la file, rang 1', act2.length === 1 && act2[0] === String(nouveauPremier.id) && s2.detail.nom === nouveauPremier.fix.attendu.nom && s2.detail.rang === 'Commande 1 de la file',
    `active ${JSON.stringify(act2)} (attendu ${nouveauPremier.id}), « ${coupe(s2.detail.nom, 40)} », ${s2.detail.rang}`);
  R.controle('[390] les autres commandes gardent leur ordre d\'arrivée après le départ de l\'une d\'elles', s2.file.chips.map((c) => c.id).join(',') === attendus.map((r) => String(r.id)).join(','), `${s2.file.n} pastilles`);
  const rep2 = await api(patronApi, 'POST', 'owner_order_decide.php', { id: attendus[0].id, action: 'refuse' });
  const refusee = attendus.shift();
  const dispar2 = await attendre(page, `!document.querySelector('#queue .qchip[data-id="${refusee.id}"]')`, 12000, 100);
  await attendre(page, `document.querySelector('#queue .qchip.is-on') && document.querySelector('#queue .qchip.is-on').dataset.id === '${attendus[0].id}'`, 3000, 40);
  const s3 = await page.evaluate(lireTout(vp.largeur));
  R.controle('[390] une commande refusée par l\'API quitte la file ; la sélection passe à la nouvelle première (rang 1)', rep2.status === 200 && dispar2.ok && s3.detail.nom === attendus[0].fix.attendu.nom && s3.detail.rang === 'Commande 1 de la file' && s3.file.n === attendus.length,
    `HTTP ${rep2.status}, ${s3.file.n} pastilles (attendu ${attendus.length}), « ${coupe(s3.detail.nom, 40)} », ${s3.detail.rang}`);

  resumeAgregats(agg);
  R.controle('[390] aucune erreur JavaScript dans la page (exceptions, console.error)', page.erreurs.length === 0, page.erreurs.slice(0, 3).join(' | ') || 'aucune');
  mesures.pagesErreurs.push(...page.erreurs);
  await page.fermer();
}

/** Tablette en paysage (1024×768) : mise en page à deux colonnes, vérification d'un échantillon de commandes difficiles. */
async function phasePaysage(nav) {
  const vp = PAYSAGE;
  const agg = nouvelAgregat(vp);
  const { page, pret } = await ouvrir(nav, vp);
  R.controle("[1024] la page commerçant s'ouvre connectée en paysage", pret.ok, pret.ok ? `ouverte en ${pret.ms} ms` : 'application non affichée');
  if (!pret.ok) { await page.fermer(); return; }
  const att = await attendreFile(page, attendus.length);
  R.controle(`[1024] au chargement, les ${attendus.length} commandes en attente sont toutes dans la file`, att.ok, `${await page.evaluate("document.querySelectorAll('#queue .qchip').length")} pastilles`);
  const ids = ['P09', 'P15', 'P16', 'D11', 'R03', 'R05', 'S02', 'S07', 'L01', 'L02', 'L03', 'L04', 'X01', 'X02', 'X03', 'M01', 'M02', 'T03'];
  for (const id of ids) {
    const rec = attendus.find((r) => r.fix.id === id);
    if (!rec) continue;
    await verifierCommande(page, rec, vp, agg);
    if (id === 'R03') mesures.captures.push(await capturer(page, '07-tablette-paysage.png'));
  }
  await mesurerNomsVisibles(page, vp);
  resumeAgregats(agg, { verbe: 'touchers' });
  R.controle('[1024] aucune erreur JavaScript dans la page (exceptions, console.error)', page.erreurs.length === 0, page.erreurs.slice(0, 3).join(' | ') || 'aucune');
  mesures.pagesErreurs.push(...page.erreurs);
  await page.fermer();
}

function resumer() {
  const duree = Math.round((Date.now() - R.debut) / 1000);
  console.log('');
  console.log(`RÉSUMÉ  ${R.controles} contrôles : ${R.reussis} PASS, ${R.echoues} FAIL · ${R.champs} champs comparés · ${duree} s`);
  if (R.echecs.length) { console.log('ÉCHECS :'); for (const e of R.echecs) console.log(`  - ${e.nom} — ${coupe(e.observe, 300)}`); }
  const lat = mesures.latences;
  console.log(`MESURES  créations API ${mesures.creationMs} ms · inscriptions ${mesures.signupMs} ms · délais d'apparition (ms) ${lat.join(', ')}${lat.length ? ` (max ${Math.max(...lat)})` : ''}`);
  if (mesures.alarme) console.log(`MESURES  alerte sonore : ${mesures.alarme.bips} bips, dernier à ${mesures.alarme.dureeMs} ms, écart médian ${mesures.alarme.medianeMs} ms`);
  console.log(`CAPTURES  ${DOSSIER_CAPTURES} : ${mesures.captures.map((c) => `${c.fichier.split(/[\\/]/).pop()} (${c.octets} o)`).join(', ')}`);
}

// ------------------------------------------------------------------------------------------------ programme
let code = 1;
try {
  patronApi = await reessayer(() => patronConnecte('10.250.250.250'));
  patronNav = await reessayer(() => patronConnecte('10.250.250.251'));
  const { liste } = construireFixtures();
  const groupes = {};
  for (const f of liste) (groupes[f.vague] ||= []).push(f);
  R.info(`${liste.length} commandes préparées : ${Object.entries(groupes).map(([k, v]) => `${k}=${v.length}`).join(' ')}`);
  if (COURT) {
    const garder = new Set(['R03', 'L02', 'D11', 'M01', 'M02', 'S07', 'X03']);
    for (const k of Object.keys(groupes)) if (!['V1', 'V7', 'V8'].includes(k)) groupes[k] = groupes[k].filter((f, i) => i < 3 || garder.has(f.id));
  }
  const utilises = Object.values(groupes).flat();
  await creerClients(utilises);
  R.info(`${utilises.length} clients inscrits en ${mesures.signupMs} ms`);
  try {
    await avecNavigateur(async (nav) => {
      R.info('navigateur : ' + nav.version);
      try { await phaseTablette(nav, groupes); } catch (e) { R.controle('phase tablette terminée sans exception', false, e && e.stack ? e.stack.split('\n').slice(0, 4).join(' / ') : String(e)); }
      try { await phaseTelephone(nav, groupes); } catch (e) { R.controle('phase téléphone terminée sans exception', false, e && e.stack ? e.stack.split('\n').slice(0, 4).join(' / ') : String(e)); }
      try { await phasePaysage(nav); } catch (e) { R.controle('phase paysage terminée sans exception', false, e && e.stack ? e.stack.split('\n').slice(0, 4).join(' / ') : String(e)); }
    }, { pagesMax: 2 });
  } catch (e) {
    R.controle('navigateur lancé et fermé proprement', false, e && e.stack ? e.stack.split('\n').slice(0, 3).join(' / ') : String(e));
  }
  // --- Contrôles finaux
  const captures = fs.existsSync(DOSSIER_CAPTURES) ? fs.readdirSync(DOSSIER_CAPTURES).filter((f) => f.endsWith('.png')) : [];
  const gros = mesures.captures.filter((c) => c.octets > 8000).length;
  R.controle(`6 captures d'écran clés (et 1 en paysage) enregistrées dans ${DOSSIER_CAPTURES}`, captures.length >= 6 && gros >= 6, `${captures.length} fichier(s) : ${captures.join(', ')} ; ${gros} de plus de 8 ko`);
  const journal = site.journal().trim();
  R.controle('journal du serveur : aucune erreur 500', !/server_error|\b500\b/.test(journal), journal || '(vide)');
  try {
    const n = Number(site.db.prepare('SELECT COUNT(*) AS n FROM orders').get().n);
    const cles = Number(site.db.prepare('SELECT COUNT(DISTINCT idempotency_key) AS n FROM orders').get().n);
    const attendu = Object.values(groupes).flat().length;
    R.controle('base : une seule ligne par commande envoyée, aucun doublon (rejeux compris)', n === attendu && cles === attendu, `${n} commandes en base, ${cles} clés distinctes, ${attendu} envoyées`);
    const par = Object.fromEntries(site.db.prepare('SELECT status, COUNT(*) AS n FROM orders GROUP BY status').all().map((r) => [r.status, Number(r.n)]));
    R.controle("base : afficher les commandes ne modifie rien (seules 1 acceptée et 1 refusée par l'API, le reste est « new »)", par.new === attendus.length && par.accepted === 1 && par.refused === 1 && !par.ready, `${JSON.stringify(par)} (attendu new=${attendus.length})`);
  } catch (e) { R.controle('lecture de la base', false, String(e)); }
  code = R.echoues === 0 ? 0 : 1;
} catch (e) {
  R.controle('exécution du scénario sans exception', false, e && e.stack ? e.stack.split('\n').slice(0, 5).join(' / ') : String(e));
} finally {
  site.arreter();
}
clearTimeout(garde);
resumer();
await new Promise((r) => process.stdout.write('', r));
process.exit(code);
