// Batterie 07 : CONTRÔLE D'ACCÈS ET SESSIONS (API, usage abusif).
//   node tests/massif/lancer.mjs tests/massif/07-securite-acces.mjs --timeout=480
//
// Phase A (site de test normal, SUBITO_COOKIE_SECURE=0) : IDOR sur les commandes, séparation patron / client,
//   cookies falsifiés, sessions révoquées, origine (anti-CSRF), méthodes, routes inconnues, entrées pathologiques,
//   rafales d'identités simultanées, force brute simultanée, attributs des cookies, stockage, journal.
// Phase B (second site, env SUBITO_COOKIE_SECURE='1', horloge pilotée) : drapeau Secure, durées 12 h / 30 j,
//   expiration et renouvellement glissant, confiance dans l'adresse IP (en-têtes de test inertes hors mode test).
// Final : toutes les réponses reçues sont balayées (secretScanText + motifs propres), le journal serveur contrôlé.
// Aucune requête hors de la machine ; mots de passe et code patron sont fabriqués par les scripts ; graines fixes.
import { readdirSync } from 'node:fs';
import crypto from 'node:crypto';
import { demarrerSite, reponses, OWNER_CODE, PORT } from './lib/env.mjs';
import { creerClients, patronConnecte, enParallele, ClientIP, ipFictive, corpsInscription } from './lib/clients.mjs';
import { rng, construireCommande } from './lib/commandes.mjs';
import {
  bilan, controle, info, section, court, attendre, appel, http1, requeteBrute, jetonFictif, FORME_JETON,
  analyserSetCookie, problemesCookie, problemesFuite, jetonDeSetCookie, estErreur, ipSonde, ORIGINE_OK, HOTE
} from './lib/07-aides.mjs';

const t0 = Date.now();
const garde = setTimeout(() => { console.log('FAIL garde-fou : plus de 7 minutes écoulées, arrêt du script'); process.exit(1); }, 7 * 60 * 1000);

// Heure serveur figée à demain 11 h UTC (midi à Paris) : même jour de service quel que soit le moment du lancement,
// et toujours dans le futur pour la boîte à cookies du harnais (qui jette les cookies dont l'Expires est passé).
const maintenant = new Date();
const T0 = Math.floor(Date.UTC(maintenant.getUTCFullYear(), maintenant.getUTCMonth(), maintenant.getUTCDate() + 1, 11, 0, 0) / 1000);
const utc = (epoch) => new Date(epoch * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');

const registre = [];          // tous les clients créés (mots de passe : secrets connus pour le balayage final)
const secretsBase = new Set(); // empreintes lues en base (hash bcrypt, token_hash, payload_hash) pour le balayage final
const mesures = {};
let journalA = '';
let journalB = '';

const enteteCle = (r) => ['content-type', 'cache-control', 'x-content-type-options', 'content-length'].map((h) => r.headers.get(h)).join('|');
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const autreCar = (ch) => ALPHABET[(ALPHABET.indexOf(ch) + 7) % 64];
const pct = (t) => [...t].map((ch) => '%' + ch.charCodeAt(0).toString(16).padStart(2, '0')).join('');
const compte = (tab, f) => tab.filter(f).length;
const hash256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

/** Variantes d'un vrai jeton qui ne doivent JAMAIS être acceptées. */
function mutations(t) {
  const m = [
    ['+1 caractère (44)', t + 'A'], ['−1 caractère (42)', t.slice(0, 42)], ['caractère préfixé', 'A' + t],
    ['rotation d\'un caractère', t.slice(1) + t[0]], ['inversé', [...t].reverse().join('')], ['doublé (86)', t + t],
    ['entre guillemets', `"${t}"`], ['terminé par =', t + '='], ['encodé en %XX', pct(t)],
    ['1er caractère changé', autreCar(t[0]) + t.slice(1)], ['21e caractère changé', t.slice(0, 21) + autreCar(t[21]) + t.slice(22)],
    ['dernier caractère changé', t.slice(0, 42) + autreCar(t[42])], ['majuscules', t.toUpperCase()], ['minuscules', t.toLowerCase()]
  ];
  // Malléabilité base64 : le dernier caractère ne porte que 4 bits utiles ; les 3 autres décodent les mêmes octets.
  const base = ALPHABET.indexOf(t[42]) & ~3;
  for (let k = 0; k < 4; k++) {
    const ch = ALPHABET[base + k];
    if (ch !== t[42]) m.push([`dernier caractère équivalent en base64 (${ch})`, t.slice(0, 42) + ch]);
  }
  return m.filter(([, v]) => v !== t);
}

// =====================================================================================================================
//                                                    PHASE A
// =====================================================================================================================
async function phaseA() {
  const site = await demarrerSite({ statique: false, horloge: T0 });
  const rows = (sql, ...p) => site.db.prepare(sql).all(...p);
  const un = (sql, ...p) => site.db.prepare(sql).get(...p);
  /** Photo de la base : comparer avant / après pour prouver qu'un refus n'a eu AUCUN effet. */
  const instantane = () => JSON.stringify({
    clients: rows('SELECT id, email, first_name, last_name, phone, street, city, updated_at FROM customers ORDER BY id'),
    commandes: rows('SELECT id, customer_id, status, delay_minutes, accepted_at, refused_at, prepared_at FROM orders ORDER BY id'),
    sessions: rows('SELECT id, user_type, user_id, revoked_at FROM sessions ORDER BY id'),
    dispo: rows('SELECT kind, name, status FROM availability ORDER BY id'),
    reglages: rows("SELECT skey, svalue FROM settings WHERE skey = 'default_delay_minutes'")
  });
  const nouveauClient = async (num) => { const [c] = await creerClients(1, { debut: num, prefixe: 'sec07' }); registre.push(c); return c; };

  try {
    // ------------------------------------------------------------------------------------------------ 0. préparation
    section('0. Préparation : 20 comptes, 60 commandes (retrait et livraison), décisions du patron');
    const NB = 20;
    const clients = await creerClients(NB, { prefixe: 'sec07', concurrence: 10 });
    registre.push(...clients);
    const patron = await patronConnecte('10.250.250.250');
    const cookiePatron = patron.cookieHeader();
    const r0 = rng(7007);
    const plan = [];
    for (const c of clients) {
      ['pickup', 'delivery', 'pickup'].forEach((mode, k) => {
        const { body } = construireCommande(r0, { mode, ville: c.ville, cle: `sec07-${c.num}-${k}` });
        body.items.forEach((it, j) => { it.note = `NOTE-${c.num}-${k}-${j}`; }); // marqueur unique : toute fuite se repère
        plan.push({ c, k, mode, body });
      });
    }
    const creations = await enParallele(plan, 10, async (p) => ({ ...p, rep: await p.c.post('order_create.php', p.body) }));
    const refusees = creations.filter((x) => x.rep.status !== 201);
    controle('0.1 20 comptes créés et 60 commandes (retrait et livraison) acceptées', clients.length === NB && refusees.length === 0 && creations.length === 60,
      `${creations.length - refusees.length}/60 commandes en 201 ; refus : ${refusees.slice(0, 2).map((x) => x.rep.status + ' ' + court(x.rep.text, 80)).join(' ; ') || 'aucun'}`);
    const etats = new Map();
    await enParallele(creations, 10, async (x) => {
      const id = x.rep.json.order.id;
      x.id = id;
      const m = id % 4;
      if (m === 0) { await patron.post('owner_order_decide.php', { id, action: 'accept', delay_minutes: 20 }); etats.set(id, 'accepted'); }
      else if (m === 1) { await patron.post('owner_order_decide.php', { id, action: 'refuse' }); etats.set(id, 'refused'); }
      else if (m === 2) { await patron.post('owner_order_decide.php', { id, action: 'accept', delay_minutes: 30 }); await patron.post('owner_order_decide.php', { id, action: 'ready' }); etats.set(id, 'ready'); }
      else etats.set(id, 'new');
    });
    const parEtat = (e) => [...etats].filter(([, v]) => v === e).map(([id]) => id).sort((a, b) => a - b);
    const idsNew = parEtat('new');
    const [idNew, idNew2, idNew3, idNew4] = idsNew;
    const verifEtats = rows('SELECT id, status FROM orders');
    controle('0.2 commandes réparties sur les 4 statuts (new, accepted, ready, refused)',
      verifEtats.every((o) => etats.get(Number(o.id)) === o.status) && idsNew.length >= 4,
      ['new', 'accepted', 'ready', 'refused'].map((e) => `${e}:${parEtat(e).length}`).join(' '));

    // ------------------------------------------------------------------------------------------------ 1. IDOR
    section('1. IDOR : un client ne lit, ne devine et n\'énumère jamais les commandes d\'un autre');
    const verite = new Map(rows('SELECT id, customer_id FROM orders').map((o) => [Number(o.id), Number(o.customer_id)]));
    const idMax = Math.max(...verite.keys());
    const borne = idMax + 25;
    const plage = Array.from({ length: borne }, (_, i) => i + 1);
    const inconnue = await clients[0].get(`order_status.php?id=${idMax + 1000}`);
    const TEXTE404 = inconnue.text;
    const ENTETES404 = enteteCle(inconnue);
    controle('1.0 identifiant inexistant : 404 not_found canonique', estErreur(inconnue, 404, 'not_found') && inconnue.json.message === 'Commande introuvable.', court(inconnue.text));

    let n200 = 0, n404 = 0, nIdor = 0;
    for (const c of clients) {
      const reps = await enParallele(plage, 25, (id) => c.get(`order_status.php?id=${id}`));
      nIdor += reps.length;
      const mauvais = [];
      let marqueursEtrangers = 0;
      reps.forEach((rep, k) => {
        const id = k + 1;
        if (verite.get(id) === c.customer.id) {
          const o = rep.json && rep.json.order;
          const propre = rep.status === 200 && o && o.id === id && !('customer_phone' in o) && !('customer_email' in o) && !('customer_id' in o)
            && o.items.length > 0 && o.items.every((it) => it.note.startsWith(`NOTE-${c.num}-`));
          if (propre) n200++; else mauvais.push(`id ${id} (propre) → ${rep.status} ${court(rep.text, 70)}`);
        } else if (rep.status === 404 && rep.text === TEXTE404 && enteteCle(rep) === ENTETES404) n404++;
        else mauvais.push(`id ${id} (autrui ou inexistant) → ${rep.status} ${court(rep.text, 70)}`);
        for (const m of rep.text.matchAll(/NOTE-(\d+)-/g)) if (Number(m[1]) !== c.num) marqueursEtrangers++;
      });
      const miens = compte([...verite], ([, cid]) => cid === c.customer.id);
      controle(`1.1 client ${c.num} : 200 sur ses ${miens} commandes, 404 strictement identique sur les ${borne - miens} autres identifiants`,
        mauvais.length === 0 && marqueursEtrangers === 0, mauvais.slice(0, 3).join(' ; ') || `${borne} identifiants testés (1 à ${borne})`);
    }
    controle('1.1b bilan de l\'énumération : toutes les commandes lues une seule fois par leur propriétaire', n200 === 60 && n404 === NB * borne - 60,
      `${nIdor} requêtes order_status : ${n200} × 200 (attendu 60), ${n404} × 404 identiques (attendu ${NB * borne - 60})`);
    mesures.idor = { requetes: nIdor, ok200: n200, ko404: n404, identifiants: borne };

    // customer_orders : seulement les siennes
    const listes = await enParallele(clients, 10, (c) => c.get('customer_orders.php'));
    const ecartsListe = [];
    clients.forEach((c, i) => {
      const rep = listes[i];
      const attendus = [...verite].filter(([, cid]) => cid === c.customer.id).map(([id]) => id).sort((a, b) => a - b);
      const recus = rep.json && Array.isArray(rep.json.orders) ? rep.json.orders.map((o) => o.id).sort((a, b) => a - b) : null;
      const etrangers = [...rep.text.matchAll(/NOTE-(\d+)-/g)].filter((m) => Number(m[1]) !== c.num).length;
      const cles = rep.json && rep.json.orders ? rep.json.orders.some((o) => 'customer_phone' in o || 'customer_email' in o || 'customer_id' in o) : true;
      if (rep.status !== 200 || JSON.stringify(recus) !== JSON.stringify(attendus) || etrangers > 0 || cles) ecartsListe.push(`client ${c.num} : ${rep.status} ids=${JSON.stringify(recus)} attendu=${JSON.stringify(attendus)} étrangers=${etrangers}`);
    });
    controle('1.2 customer_orders : chacun des 20 clients ne reçoit que ses propres commandes (aucune donnée patron, aucun marqueur étranger)', ecartsListe.length === 0, ecartsListe.slice(0, 2).join(' ; ') || '20 listes de 3 commandes');
    const A = clients[0];
    const B = clients[1];
    const idA = [...verite].find(([, cid]) => cid === A.customer.id)[0];
    const idB = [...verite].find(([, cid]) => cid === B.customer.id)[0];
    const listeSeule = await A.get('customer_orders.php');
    const listeParam = await A.get(`customer_orders.php?customer_id=${B.customer.id}&id=${idB}&email=${encodeURIComponent(B.email)}&user=${B.customer.id}`);
    controle('1.2b customer_orders ignore les paramètres d\'URL (customer_id, id, email) : même liste que sans paramètres', listeParam.status === 200 && listeParam.text === listeSeule.text, `${listeParam.status}`);
    const meParam = await A.get(`customer_me.php?id=${B.customer.id}&email=${encodeURIComponent(B.email)}`);
    controle('1.2c customer_me ignore les paramètres d\'URL : renvoie toujours le client connecté', meParam.status === 200 && meParam.json.customer.id === A.customer.id, `id ${meParam.json && meParam.json.customer && meParam.json.customer.id}`);

    // identifiants pathologiques
    const invalides = ['', '0', '-1', '%2B5', '5.0', '5e0', '0x5', '05', '00000000005', 'abc', 'NaN', 'null', 'true', '5%20', '%205', '%EF%BC%95', '%D9%A5',
      '5%0A', '5%00', '2147483648', '4294967296', '99999999999', '1111111111', '2147483647', '1%3B2', '1%2C2', '1%20OR%201%3D1', '1\'%20OR%20\'1\'%3D\'1',
      '1%3B%20DROP%20TABLE%20orders', '1%2F**%2FOR%2F**%2F1%3D1', '1)--', '(1)', '%5B1%5D', '%7B%22%24gt%22%3A0%7D', '5%25', '%25', '%zz', '9'.repeat(400)];
    const repsInv = await enParallele(invalides, 8, (v) => A.get(`order_status.php?id=${v}`));
    const ecInv = repsInv.map((rep, i) => ({ rep, v: invalides[i] })).filter(({ rep }) => !(rep.status === 404 && rep.text === TEXTE404));
    controle(`1.3 ${invalides.length} identifiants invalides ou pièges (négatifs, flottants, hexa, Unicode, SQL, 400 chiffres…) : tous 404 identiques, aucun 5xx`, ecInv.length === 0,
      ecInv.slice(0, 3).map(({ rep, v }) => `id=${court(v, 20)} → ${rep.status}`).join(' ; ') || `${invalides.length} valeurs`);
    const idxMissing = await A.get('order_status.php');
    const idxArr = await A.get(`order_status.php?id[]=${idB}`);
    const idxCase = await A.get(`order_status.php?ID=${idA}`);
    controle('1.3b paramètre absent, id[]=, ID= (casse) : 404 identique', [idxMissing, idxArr, idxCase].every((x) => x.status === 404 && x.text === TEXTE404), [idxMissing, idxArr, idxCase].map((x) => x.status).join('/'));
    const pollu = [
      [`id=${idA}&id=${idB}`, 404], [`id=${idB}&id=${idA}`, 200], [`id=${idB}&id=abc`, 404], [`id=${idA}&id=`, 404],
      [`id=${idB}%26id%3D${idA}`, 404], [`id=${idB}&ID=${idA}`, 404], [`id=${idB}#${idA}`, 404]
    ];
    const ecPol = [];
    for (const [q, attendu] of pollu) {
      const rep = await A.get(`order_status.php?${q}`);
      const etranger = rep.json && rep.json.order && rep.json.order.id === idB;
      if (rep.status !== attendu || etranger) ecPol.push(`?${q} → ${rep.status}`);
    }
    controle('1.3c paramètre répété (la dernière valeur l\'emporte) : jamais la commande d\'autrui', ecPol.length === 0, ecPol.join(' ; ') || `${pollu.length} combinaisons`);
    // chemin de type REST : pas de route /order_status/<id>
    const rest = await Promise.all([`order_status.php/${idA}`, `order_status/${idA}`, `orders/${idA}`].map((p) => A.get(p)));
    controle('1.3d identifiant dans le chemin (order_status.php/<id>, orders/<id>) : jamais servi', rest.every((x) => x.status === 404 && x.json && x.json.error === 'not_found' && !/NOTE-/.test(x.text)), rest.map((x) => x.status).join('/'));

    // sans cookie / cookie patron seul : énumération impossible (401 / 403 pour tous les identifiants, existants ou non)
    const repsAnon = await enParallele(plage, 25, (id) => appel('GET', `order_status.php?id=${id}`));
    const repsPat = await enParallele(plage, 25, (id) => appel('GET', `order_status.php?id=${id}`, { cookie: cookiePatron }));
    controle(`1.4 sans cookie : ${borne} identifiants → 401 identique pour tous (aucune différence entre commande existante et inexistante)`,
      repsAnon.every((x) => estErreur(x, 401, 'unauthorized') && x.text === repsAnon[0].text), `${compte(repsAnon, (x) => x.status === 401)}/${borne} en 401`);
    controle(`1.5 cookie patron seul : ${borne} identifiants → 403 identique pour tous`,
      repsPat.every((x) => estErreur(x, 403, 'forbidden') && x.text === repsPat[0].text), `${compte(repsPat, (x) => x.status === 403)}/${borne} en 403`);
    mesures.idorAnon = repsAnon.length + repsPat.length;

    // clés d'idempotence : l'espace est propre à chaque client (pas de rejeu ni de conflit qui révèle la commande d'autrui)
    const pA = creations.find((x) => x.c.num === A.num && x.mode === 'pickup' && x.k === 0);
    const pA2 = creations.find((x) => x.c.num === A.num && x.mode === 'pickup' && x.k === 2);
    const avantA = (await A.get(`order_status.php?id=${pA.id}`)).text;
    const b1 = await B.post('order_create.php', pA.body); // même clé, même corps que la commande de A
    const diff = construireCommande(rng(777), { mode: 'pickup', cle: pA2.body.idempotency_key }).body;
    const b2 = await B.post('order_create.php', diff); // même clé que A, corps différent
    const lig1 = b1.json && b1.json.order ? un('SELECT customer_id FROM orders WHERE id = ?', b1.json.order.id) : null;
    const lig2 = b2.json && b2.json.order ? un('SELECT customer_id FROM orders WHERE id = ?', b2.json.order.id) : null;
    controle('1.6 B envoie la clé et le corps d\'une commande de A : nouvelle commande à B (201, replayed:false), jamais la commande de A ni un conflit',
      b1.status === 201 && b1.json.replayed === false && b1.json.order.id !== pA.id && lig1 && Number(lig1.customer_id) === B.customer.id, `${b1.status} replayed=${b1.json && b1.json.replayed}`);
    controle('1.6b B envoie la clé de A avec un corps différent : 201 (pas de 409 idempotency_conflict qui révélerait la clé de A)',
      b2.status === 201 && b2.json.replayed === false && lig2 && Number(lig2.customer_id) === B.customer.id, `${b2.status} ${court(b2.text, 80)}`);
    controle('1.6c la commande de A est intacte après ces envois', (await A.get(`order_status.php?id=${pA.id}`)).text === avantA, 'identique');

    // affectation de masse : champs superflus ignorés, jamais pris pour un autre client
    const cMA = await nouveauClient(101);
    const corpsMA = {
      ...construireCommande(rng(555), { mode: 'pickup', cle: 'sec07-ma-0001' }).body,
      customer_id: B.customer.id, status: 'accepted', id: 1, delay_minutes: 20, service_day: '1999-01-01', accepted_at: '2000-01-01T00:00:00Z', prepared_at: '2000-01-01T00:00:00Z'
    };
    const ma = await cMA.post('order_create.php', corpsMA);
    const ligMA = ma.json && ma.json.order ? un('SELECT customer_id, status, delay_minutes, service_day, accepted_at FROM orders WHERE id = ?', ma.json.order.id) : null;
    controle('1.7 order_create avec customer_id, status, id, delay_minutes, service_day imposés : champs ignorés (commande à son auteur, statut new)',
      ma.status === 201 && ligMA && Number(ligMA.customer_id) === cMA.customer.id && ligMA.status === 'new' && ligMA.delay_minutes === null && ligMA.service_day !== '1999-01-01' && ligMA.accepted_at === null,
      ligMA ? JSON.stringify(ligMA) : `${ma.status} ${court(ma.text, 100)}`);
    const avantB = JSON.stringify(un('SELECT * FROM customers WHERE id = ?', B.customer.id));
    const mp = await cMA.post('customer_update_profile.php', {
      first_name: 'Mass', last_name: 'Assign', phone: '06 12 34 56 78', id: B.customer.id, customer_id: B.customer.id, email: 'pirate-sec07@example.test',
      password: 'Pirate-0000-aA!', password_hash: '$2a$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ01234', city: 'Rouvroy', street: '1 rue Pirate'
    });
    const ad = await cMA.post('customer_update_address.php', { street: '2 rue Pirate', city: 'Dourges', id: B.customer.id, customer_id: B.customer.id });
    const apresB = JSON.stringify(un('SELECT * FROM customers WHERE id = ?', B.customer.id));
    const ancien = await new ClientIP('ancien-mdp', ipSonde()).post('customer_login.php', { email: cMA.email, password: cMA.password });
    const nouveau = await new ClientIP('nouveau-mdp', ipSonde()).post('customer_login.php', { email: cMA.email, password: 'Pirate-0000-aA!' });
    const pirate = await new ClientIP('email-pirate', ipSonde()).post('customer_login.php', { email: 'pirate-sec07@example.test', password: cMA.password });
    controle('1.8 profil et adresse avec id, customer_id, email, password, password_hash superflus : seul le client connecté est modifié, e-mail et mot de passe inchangés',
      mp.status === 200 && mp.json.customer.id === cMA.customer.id && mp.json.customer.email === cMA.email && ad.status === 200 && ad.json.customer.id === cMA.customer.id
      && apresB === avantB && ancien.status === 200 && nouveau.status === 401 && pirate.status === 401,
      `profil ${mp.status}, adresse ${ad.status}, B ${apresB === avantB ? 'intact' : 'MODIFIÉ'}, ancien mdp ${ancien.status}, nouveau mdp ${nouveau.status}, e-mail pirate ${pirate.status}`);

    // ------------------------------------------------------------------------------------------------ 2. rôles
    section('2. Séparation des rôles : routes patron (cookie client → 403, sans cookie → 401) et routes client (cookie patron → 403)');
    const cookieCust = clients[2].cookieHeader();
    const ROUTES_PATRON = [
      { m: 'GET', route: 'owner_me.php' }, { m: 'GET', route: 'owner_orders.php' }, { m: 'GET', route: 'owner_sessions.php' },
      { m: 'GET', route: 'owner_settings.php' }, { m: 'GET', route: 'owner_availability.php' },
      { m: 'POST', route: 'owner_settings.php', corps: { default_delay_minutes: 60 } },
      { m: 'POST', route: 'owner_availability.php', corps: { kind: 'pizza', name: 'Margherita', status: 'out_manual' } },
      { m: 'POST', route: 'owner_customers.php', corps: { q: '' } },
      { m: 'POST', route: 'owner_order_decide.php', corps: { id: idNew, action: 'refuse' } },
      { m: 'POST', route: 'owner_sessions_revoke.php', corps: { scope: 'all' } },
      { m: 'POST', route: 'owner_logout.php', corps: {} }
    ];
    const ROUTES_CLIENT = [
      { m: 'GET', route: 'customer_orders.php' }, { m: 'GET', route: `order_status.php?id=${idNew}` },
      { m: 'POST', route: 'order_create.php', corps: { ...construireCommande(rng(31), { mode: 'pickup', cle: 'sec07-role-0001' }).body } },
      { m: 'POST', route: 'customer_update_profile.php', corps: { first_name: 'Role', last_name: 'Role', phone: '06 00 00 00 31' } },
      { m: 'POST', route: 'customer_update_address.php', corps: { street: '1 rue du Rôle', city: 'Rouvroy' } }
    ];
    const avantRoles = instantane();
    for (const s of ROUTES_PATRON) {
      const [rc, ra] = [await appel(s.m, s.route, { cookie: cookieCust, corps: s.corps }), await appel(s.m, s.route, { corps: s.corps })];
      controle(`2.1 ${s.m} ${s.route} (${s.corps ? JSON.stringify(s.corps).slice(0, 30) : 'sans corps'}) : cookie client → 403 forbidden, sans cookie → 401 unauthorized`,
        estErreur(rc, 403, 'forbidden') && estErreur(ra, 401, 'unauthorized') && rc.setCookies.length === 0 && ra.setCookies.length === 0, `client ${rc.status} ${rc.json && rc.json.error}, anonyme ${ra.status} ${ra.json && ra.json.error}`);
    }
    for (const s of ROUTES_CLIENT) {
      const [rp, ra] = [await appel(s.m, s.route, { cookie: cookiePatron, corps: s.corps }), await appel(s.m, s.route, { corps: s.corps })];
      controle(`2.2 ${s.m} ${s.route.replace(/\?.*/, '')} : cookie patron → 403 forbidden, sans cookie → 401 unauthorized`,
        estErreur(rp, 403, 'forbidden') && estErreur(ra, 401, 'unauthorized') && rp.setCookies.length === 0, `patron ${rp.status} ${rp.json && rp.json.error}, anonyme ${ra.status} ${ra.json && ra.json.error}`);
    }
    controle('2.3 aucun refus de la section 2 n\'a eu d\'effet en base (statuts, réglages, ruptures, sessions, profils, commandes identiques)', instantane() === avantRoles, 'photo avant = photo après');
    const guest = [await appel('GET', 'customer_me.php'), await appel('GET', 'customer_me.php', { cookie: cookiePatron })];
    controle('2.4 customer_me : invité ou patron seul → 200 avec customer:null (jamais 401 ni 403)', guest.every((x) => x.status === 200 && x.json.customer === null), guest.map((x) => x.status).join('/'));
    const outPatron = await appel('POST', 'customer_logout.php', { cookie: cookiePatron, corps: {} });
    const patronVivant = await appel('GET', 'owner_me.php', { cookie: cookiePatron });
    controle('2.5 customer_logout avec un cookie patron : 200 mais la session patron n\'est PAS révoquée', outPatron.status === 200 && patronVivant.status === 200, `logout ${outPatron.status}, owner_me ensuite ${patronVivant.status}`);
    const clientAvant = await appel('GET', 'customer_orders.php', { cookie: cookieCust });
    const outClient = await appel('POST', 'owner_logout.php', { cookie: cookieCust, corps: {} });
    const clientApres = await appel('GET', 'customer_orders.php', { cookie: cookieCust });
    controle('2.6 owner_logout avec un cookie client : 403 et la session client reste valide', estErreur(outClient, 403, 'forbidden') && clientAvant.status === 200 && clientApres.status === 200, `${outClient.status}, avant ${clientAvant.status}, après ${clientApres.status}`);
    const deux = `${cookieCust}; ${cookiePatron}`;
    const [d1, d2, d3] = [await appel('GET', 'owner_me.php', { cookie: deux }), await appel('GET', 'customer_orders.php', { cookie: deux }), await appel('GET', 'owner_sessions.php', { cookie: deux })];
    controle('2.7 navigateur portant les deux cookies : chaque famille de routes utilise son propre cookie (owner_me, customer_orders, owner_sessions → 200)', d1.status === 200 && d2.status === 200 && d3.status === 200, `${d1.status}/${d2.status}/${d3.status}`);
    const sess = await appel('GET', 'owner_sessions.php', { cookie: cookiePatron });
    controle('2.8 owner_sessions ne liste que des sessions patron (aucune des 20+ sessions clients), libellé d\'appareil sans User-Agent brut',
      sess.status === 200 && sess.json.sessions.every((s) => /^[\p{L} ]+ · [\p{L} ]+$/u.test(s.device)) && sess.json.sessions.length === compte(rows("SELECT id FROM sessions WHERE user_type = 'owner' AND revoked_at IS NULL"), () => true),
      `${sess.json && sess.json.sessions.length} sessions patron, appareils : ${[...new Set(sess.json.sessions.map((s) => s.device))].join(', ')}`);

    // ------------------------------------------------------------------------------------------------ 3. cookies falsifiés
    section('3. Cookies falsifiés : jeton inconnu, trop long, caractères nuls, répétés, 100 cookies, jetons échangés');
    let nForge = 0;
    const corpsCommandeValide = construireCommande(rng(4242), { mode: 'pickup', cle: 'forge-base-0' }).body;
    const SONDES = [
      { role: 'client', m: 'GET', route: () => 'customer_orders.php' },
      { role: 'client', m: 'GET', route: () => `order_status.php?id=${idNew}` },
      { role: 'client', m: 'POST', route: () => 'order_create.php', corps: () => ({ ...corpsCommandeValide, idempotency_key: `forge-${++nForge}-zz` }) },
      { role: 'client', m: 'POST', route: () => 'customer_update_profile.php', corps: () => ({ first_name: 'Forge', last_name: 'Forge', phone: '06 00 00 00 42' }) },
      { role: 'client', m: 'POST', route: () => 'customer_update_address.php', corps: () => ({ street: '1 rue Forgée', city: 'Rouvroy' }) },
      { role: 'invite', m: 'GET', route: () => 'customer_me.php' },
      { role: 'patron', m: 'GET', route: () => 'owner_me.php' },
      { role: 'patron', m: 'GET', route: () => 'owner_orders.php' },
      { role: 'patron', m: 'GET', route: () => 'owner_sessions.php' },
      { role: 'patron', m: 'GET', route: () => 'owner_settings.php' },
      { role: 'patron', m: 'GET', route: () => 'owner_availability.php' },
      { role: 'patron', m: 'POST', route: () => 'owner_settings.php', corps: () => ({ default_delay_minutes: 60 }) },
      { role: 'patron', m: 'POST', route: () => 'owner_availability.php', corps: () => ({ kind: 'pizza', name: 'Forgée', status: 'out_manual' }) },
      { role: 'patron', m: 'POST', route: () => 'owner_customers.php', corps: () => ({ q: '' }) },
      { role: 'patron', m: 'POST', route: () => 'owner_order_decide.php', corps: () => ({ id: idNew, action: 'refuse' }) },
      { role: 'patron', m: 'POST', route: () => 'owner_sessions_revoke.php', corps: () => ({ scope: 'all' }) },
      { role: 'patron', m: 'POST', route: () => 'owner_logout.php', corps: () => ({}) }
    ];
    const SONDES_CLIENT = SONDES.filter((s) => s.role !== 'patron');
    /** Toutes les sondes : chacune doit être refusée (401) ; customer_me répond « invité ». Renvoie la liste des écarts. */
    async function ecartsRejet(cookie, sondes = SONDES) {
      const ecarts = [];
      const reps = await enParallele(sondes, 6, async (s) => ({ s, rep: await appel(s.m, s.route(), { cookie, corps: s.corps ? s.corps() : undefined }) }));
      for (const { s, rep } of reps) {
        const bon = s.role === 'invite' ? rep.status === 200 && rep.json && rep.json.customer === null : estErreur(rep, 401, 'unauthorized') && rep.setCookies.length === 0;
        if (!bon) ecarts.push(`${s.m} ${s.route().replace(/\?.*/, '')} → ${rep.status} ${court(rep.text, 60)}`);
      }
      return ecarts;
    }
    const cF = await nouveauClient(104);
    const pF = await patronConnecte(ipSonde());
    const tokC = cF.cookies.get('subito_customer');
    const tokP = pF.cookies.get('subito_owner');
    const avantForge = instantane();
    const nbSessionsAvant = Number(un('SELECT COUNT(*) AS n FROM sessions').n);
    // contrôle positif : les vrais jetons, eux, sont acceptés (sinon les refus ne prouveraient rien)
    const valides = `subito_customer=${tokC}; subito_owner=${tokP}`;
    const posit = await Promise.all(['customer_orders.php', 'owner_me.php', 'owner_orders.php', 'owner_sessions.php', 'owner_settings.php', 'owner_availability.php'].map((r) => appel('GET', r, { cookie: valides })));
    const meValide = await appel('GET', 'customer_me.php', { cookie: valides });
    controle('3.0 contrôle positif : les vrais jetons (client et patron) sont acceptés par les 6 routes de lecture', posit.every((x) => x.status === 200) && meValide.json.customer && meValide.json.customer.id === cF.customer.id, posit.map((x) => x.status).join('/'));

    const r3 = rng(3003);
    const nul = 'A'.repeat(43);
    const duo = (v) => `subito_customer=${v}; subito_owner=${v}`;
    const generiques = [
      ['43 × A (bonne longueur, inconnu)', nul], ['43 × 0', '0'.repeat(43)], ['43 × tiret', '-'.repeat(43)], ['43 × souligné', '_'.repeat(43)],
      ...[1, 2, 3, 4, 5].map((i) => [`aléatoire de 43 caractères n°${i}`, jetonFictif(r3)]),
      ['valeur vide', ''], ['1 caractère', 'A'], ['42 caractères', 'A'.repeat(42)], ['44 caractères', 'A'.repeat(44)], ['64 caractères (taille d\'un SHA-256)', 'a'.repeat(64)],
      ['86 caractères', 'A'.repeat(86)], ['128 caractères', 'A'.repeat(128)], ['1 024 caractères', 'A'.repeat(1024)], ['4 000 caractères', 'A'.repeat(4000)], ['7 000 caractères', 'A'.repeat(7000)],
      ['base64 standard (+ et /)', 'A'.repeat(41) + '+/'], ['base64 avec rembourrage =', 'A'.repeat(42) + '='], ['espace au milieu', 'A'.repeat(20) + ' ' + 'A'.repeat(22)],
      ['injection SQL', '\' OR \'1\'=\'1\' --'], ['injection SQL empilée', '1\'; DROP TABLE sessions; --'], ['balise HTML', '<script>alert(1)</script>'], ['objet JSON', '{"$ne":null}'],
      ['traversée de chemin', '../../etc/passwd'], ['%00 encodé', '%00'], ['gabarit ${7*7}', '${7*7}'], ['gabarit {{7*7}}', '{{7*7}}'], ['emoji encodé', '%F0%9F%8D%95'],
      ['null', 'null'], ['undefined', 'undefined'], ['true', 'true'], ['[object Object]', '[object Object]'], ['NaN', 'NaN'], ['hash du vrai jeton (SHA-256 hex)', hash256(tokC)]
    ];
    for (const [nom, v] of generiques) {
      const ec = await ecartsRejet(duo(v));
      controle(`3.1 cookie « ${nom} » (customer et owner) : ${SONDES.length} routes → 401, aucun cookie posé`, ec.length === 0, ec.slice(0, 2).join(' ; ') || `${SONDES.length} sondes refusées`);
    }
    // variantes d'un VRAI jeton
    const mc = mutations(tokC);
    const mp2 = mutations(tokP);
    for (let i = 0; i < mc.length; i++) {
      const ec = await ecartsRejet(`subito_customer=${mc[i][1]}; subito_owner=${mp2[i] ? mp2[i][1] : mp2[0][1]}`);
      controle(`3.2 vrai jeton altéré (${mc[i][0]}) : ${SONDES.length} routes → 401`, ec.length === 0, ec.slice(0, 2).join(' ; ') || `${SONDES.length} sondes refusées`);
    }
    // jetons échangés : celui du patron dans le nom du client et inversement
    const sw = await ecartsRejet(`subito_customer=${tokP}; subito_owner=${tokC}`);
    controle('3.3 jeton du patron dans le cookie client ET jeton du client dans le cookie patron : 401 partout', sw.length === 0, sw.slice(0, 2).join(' ; ') || 'tout refusé');
    const swC = await ecartsRejet(`subito_customer=${tokP}`, SONDES_CLIENT);
    const swO = await ecartsRejet(`subito_owner=${tokC}`, SONDES.filter((s) => s.role === 'patron'));
    controle('3.3b jeton du patron seul sous le nom client / jeton du client seul sous le nom patron : 401 partout', swC.length === 0 && swO.length === 0, [...swC, ...swO].slice(0, 2).join(' ; ') || 'tout refusé');
    const dbl = `subito_customer=${tokP}; subito_owner=${tokP}`;
    const repDbl = await enParallele(SONDES_CLIENT.filter((s) => s.role === 'client'), 5, (s) => appel(s.m, s.route(), { cookie: dbl, corps: s.corps ? s.corps() : undefined }));
    controle('3.3c jeton patron valide dans les deux cookies : les routes client répondent 403 (jamais un accès client)', repDbl.every((x) => estErreur(x, 403, 'forbidden')), repDbl.map((x) => x.status).join('/'));
    // structure du en-tête Cookie
    const structurels = [
      ['noms seuls sans « = »', 'subito_customer; subito_owner'], ['« =valeur » sans nom', `=${tokC}; =${tokP}`], ['points-virgules seuls', ';;;;;'],
      ['noms voisins (subito_customer2)', `subito_customer2=${tokC}; subito_owner2=${tokP}`], ['noms en majuscules', `SUBITO_CUSTOMER=${tokC}; SUBITO_OWNER=${tokP}`],
      ['préfixe de nom (xsubito_customer)', `xsubito_customer=${tokC}; xsubito_owner=${tokP}`], ['noms en tableau (subito_customer[]=)', `subito_customer[]=${tokC}; subito_owner[]=${tokP}`],
      ['noms magiques (__proto__, constructor, toString)', `__proto__=${tokC}; constructor=${tokP}; toString=x; hasOwnProperty=y; valueOf=z`]
    ];
    for (const [nom, v] of structurels) {
      const ec = await ecartsRejet(v);
      controle(`3.4 en-tête Cookie ${nom} : jamais authentifié (401 partout)`, ec.length === 0, ec.slice(0, 2).join(' ; ') || `${SONDES.length} sondes refusées`);
    }
    // valeurs répétées et 100 cookies
    const bidon = jetonFictif(r3);
    const cent = Array.from({ length: 100 }, (_, i) => `x${i}=v${i}`);
    const mille = Array.from({ length: 1000 }, (_, i) => `c${i}=${i}`);
    const rep100 = Array.from({ length: 100 }, () => `subito_customer=${jetonFictif(r3)}`);
    const rep100o = Array.from({ length: 100 }, () => `subito_owner=${jetonFictif(r3)}`);
    const repetes = [
      ['nom répété, valeur bidon en PREMIER puis le vrai jeton', `subito_customer=${bidon}; subito_customer=${tokC}; subito_owner=${bidon}; subito_owner=${tokP}`],
      ['nom répété 100 fois (bidons) puis le vrai jeton', `${rep100.join('; ')}; subito_customer=${tokC}; ${rep100o.join('; ')}; subito_owner=${tokP}`],
      ['100 cookies sans le vrai jeton', cent.join('; ')], ['1 000 cookies sans le vrai jeton', mille.join('; ')],
      ['100 cookies bidons dont subito_customer et subito_owner (inconnus)', [...cent, `subito_customer=${bidon}`, `subito_owner=${bidon}`].join('; ')]
    ];
    for (const [nom, v] of repetes) {
      const ec = await ecartsRejet(v);
      controle(`3.5 ${nom} : 401 partout (la première valeur d'un nom répété l'emporte)`, ec.length === 0, ec.slice(0, 2).join(' ; ') || `${SONDES.length} sondes refusées`);
    }
    const acceptes = [
      ['vrai jeton en PREMIER puis un bidon (première valeur gagnante)', `subito_customer=${tokC}; subito_customer=${bidon}; subito_owner=${tokP}; subito_owner=${bidon}`],
      ['vrai jeton au milieu de 100 cookies', [...cent.slice(0, 50), `subito_customer=${tokC}`, `subito_owner=${tokP}`, ...cent.slice(50)].join('; ')],
      ['vrai jeton au milieu de 1 000 cookies', [...mille.slice(0, 500), `subito_customer=${tokC}`, `subito_owner=${tokP}`, ...mille.slice(500)].join('; ')]
    ];
    for (const [nom, v] of acceptes) {
      const reps = await Promise.all(['customer_orders.php', 'owner_me.php'].map((r) => appel('GET', r, { cookie: v })));
      controle(`3.6 ${nom} : les vrais jetons restent reconnus (200)`, reps.every((x) => x.status === 200), reps.map((x) => x.status).join('/'));
    }
    info('Comportement documenté : pour un nom de cookie répété, la PREMIÈRE valeur est retenue (serveur/core.js parserCookies) ; les autres sont ignorées.');
    // octets pathologiques (impossibles à envoyer par fetch) : socket brute
    const brutCas = [
      ['octet NUL en fin de valeur', Buffer.from(`Cookie: subito_customer=${tokC}\x00`, 'latin1')],
      ['octet NUL en début de valeur', Buffer.from(`Cookie: subito_customer=\x00${tokC}`, 'latin1')],
      ['octet NUL dans le nom du cookie', Buffer.from(`Cookie: subito\x00_customer=${tokC}`, 'latin1')],
      ['octet NUL au milieu du jeton', Buffer.from(`Cookie: subito_customer=${tokC.slice(0, 20)}\x00${tokC.slice(20)}`, 'latin1')],
      ['octets UTF-8 (é) dans la valeur', Buffer.from(`Cookie: subito_customer=${tokC.slice(0, 40)}Ã©${tokC.slice(40)}`, 'latin1')],
      ['caractère de contrôle 0x01', Buffer.from(`Cookie: subito_customer=${tokC}\x01`, 'latin1')],
      ['retour chariot isolé (0x0d)', Buffer.from(`Cookie: subito_customer=${tokC}\rX-Injecte: 1`, 'latin1')],
      ['tabulation dans la valeur', Buffer.from(`Cookie: subito_customer=${tokC.slice(0, 20)}\t${tokC.slice(20)}`, 'latin1')]
    ];
    for (const [nom, ligne] of brutCas) {
      const [rc, rp] = [await requeteBrute('GET /api/customer_orders.php HTTP/1.1', [ligne]), await requeteBrute('GET /api/owner_me.php HTTP/1.1', [Buffer.from(ligne.toString('latin1').replace('subito_customer', 'subito_owner').replace(tokC, tokP), 'latin1')])];
      controle(`3.7 ${nom} : jamais authentifié (400 du serveur HTTP ou 401), aucun 5xx`, [rc, rp].every((x) => x.status === 400 || x.status === 401), `customer_orders ${rc.status} (${rc.raison}), owner_me ${rp.status} (${rp.raison})`);
    }
    const geant = await requeteBrute('GET /api/customer_orders.php HTTP/1.1', ['Cookie: x=' + 'a'.repeat(20000)]);
    const vivant = await appel('GET', 'availability.php');
    controle('3.8 en-tête Cookie de 20 000 octets : refusé par le serveur HTTP (4xx), le serveur reste debout', geant.status >= 400 && geant.status < 500 && vivant.status === 200, `géant ${geant.status}, ensuite availability ${vivant.status}`);
    // aucun effet : pas de session créée, aucune commande, rien modifié
    controle('3.9 après tous ces jetons falsifiés : aucune session créée, aucune commande ni profil modifié (base identique)', instantane() === avantForge && Number(un('SELECT COUNT(*) AS n FROM sessions').n) === nbSessionsAvant,
      `sessions ${nbSessionsAvant} → ${un('SELECT COUNT(*) AS n FROM sessions').n}`);
    mesures.cookies = { variantes: generiques.length + mc.length + structurels.length + repetes.length + acceptes.length + brutCas.length + 6, sondesParVariante: SONDES.length };

    // ------------------------------------------------------------------------------------------------ 4a. sessions client révoquées
    section('4. Sessions révoquées : le jeton d\'une session révoquée est rejeté partout');
    const statutClient = async (tok) => (await appel('GET', 'customer_orders.php', { cookie: `subito_customer=${tok}` })).status;
    const k1 = await nouveauClient(110);
    const tk1 = k1.cookies.get('subito_customer');
    const avantLo = await statutClient(tk1);
    const lo = await k1.post('customer_logout.php', {});
    controle('4.1 customer_logout : session valable avant (200), cookie effacé proprement (Max-Age=0, mêmes Path / SameSite / HttpOnly), jeton rejeté partout après',
      avantLo === 200 && lo.status === 200 && lo.setCookies.length === 1 && problemesCookie(lo.setCookies[0], { nom: 'subito_customer', sameSite: 'Lax', secure: false, efface: true }).length === 0 && (await ecartsRejet(`subito_customer=${tk1}`)).length === 0,
      `avant ${avantLo}, logout ${lo.status}, ${lo.setCookies.map((s) => court(s, 90)).join(' | ')}`);
    // reconnexion dans le même navigateur : l'ancienne session est révoquée
    const k2 = await nouveauClient(111);
    const t21 = k2.cookies.get('subito_customer');
    const lg2 = await k2.post('customer_login.php', { email: k2.email, password: k2.password });
    const t22 = k2.cookies.get('subito_customer');
    controle('4.2 connexion dans le même navigateur : l\'ancienne session est révoquée (401 partout), la nouvelle fonctionne',
      lg2.status === 200 && t21 !== t22 && FORME_JETON.test(t22) && (await ecartsRejet(`subito_customer=${t21}`)).length === 0 && (await statutClient(t22)) === 200,
      `login ${lg2.status}, ancien jeton ${await statutClient(t21)}, nouveau ${await statutClient(t22)}`);
    const autre = new ClientIP('autre-navigateur', ipSonde());
    const lg3 = await autre.post('customer_login.php', { email: k2.email, password: k2.password });
    controle('4.3 connexion depuis un AUTRE navigateur (sans cookie) : l\'autre session reste valable (une session active par navigateur, pas par compte)',
      lg3.status === 200 && (await statutClient(t22)) === 200 && (await statutClient(autre.cookies.get('subito_customer'))) === 200, 'deux sessions simultanées');
    // connexion à un autre compte dans le même navigateur
    const k3 = await nouveauClient(112);
    const k4 = await nouveauClient(113);
    const t31 = k3.cookies.get('subito_customer');
    const lg4 = await k3.post('customer_login.php', { email: k4.email, password: k4.password });
    controle('4.4 navigateur du compte A qui se connecte au compte B : le jeton de A est révoqué et ne donne jamais accès à B',
      lg4.status === 200 && lg4.json.customer.id === k4.customer.id && (await ecartsRejet(`subito_customer=${t31}`)).length === 0, `login B ${lg4.status}, jeton A ${await statutClient(t31)}`);
    // inscription alors qu'on est connecté
    const k5 = await nouveauClient(114);
    const t51 = k5.cookies.get('subito_customer');
    const sg = await k5.post('customer_signup.php', corpsInscription(115, { ville: 'Rouvroy', prefixe: 'sec07' }));
    const t52 = k5.cookies.get('subito_customer');
    const ancienApresSignup = await statutClient(t51);
    controle('4.5 inscription d\'un nouveau compte dans un navigateur déjà connecté : l\'ancienne session est révoquée (une seule session client par navigateur)',
      sg.status === 201 && t51 !== t52 && ancienApresSignup === 401, `signup ${sg.status}, ancien jeton encore ${ancienApresSignup} (attendu 401)`);
    // fixation de session
    const fixe = jetonFictif(r3);
    const kf = await nouveauClient(116);
    const fx = await appel('POST', 'customer_login.php', { cookie: `subito_customer=${fixe}`, corps: { email: kf.email, password: kf.password } });
    const apresFx = jetonDeSetCookie(fx.setCookies, 'subito_customer');
    controle('4.6 fixation de session : un cookie imposé avant la connexion n\'est jamais repris ; le serveur émet un jeton neuf et le jeton imposé reste inutilisable',
      fx.status === 200 && apresFx && apresFx !== fixe && FORME_JETON.test(apresFx) && (await statutClient(fixe)) === 401 && (await statutClient(apresFx)) === 200, `jeton imposé → ${await statutClient(fixe)}, jeton émis ${apresFx ? 'neuf' : 'absent'}`);
    // réponses de connexion : aucune différence entre e-mail inconnu et mauvais mot de passe
    const lgInconnu = await appel('POST', 'customer_login.php', { corps: { email: 'inconnu-sec07@example.test', password: 'Mauvais-1234-aA!' } });
    const lgMauvais = await appel('POST', 'customer_login.php', { corps: { email: clients[4].email, password: 'Mauvais-1234-aA!' } });
    controle('4.7 connexion refusée : e-mail inconnu et mauvais mot de passe donnent exactement la même réponse (aucune énumération de comptes par la connexion)',
      estErreur(lgInconnu, 401, 'invalid_credentials') && lgInconnu.text === lgMauvais.text && lgInconnu.setCookies.length === 0 && lgMauvais.setCookies.length === 0, court(lgInconnu.text, 90));
    // unicité et forme des jetons
    const jetons = new Set();
    for (const r of reponses) for (const sc of r.setCookies) { const c = analyserSetCookie(sc); if (/^subito_(owner|customer)$/.test(c.nom) && c.valeur !== '') jetons.add(c.valeur); }
    const jetonsListe = [...jetons];
    const compteCar = new Map();
    for (const t of jetonsListe) for (const ch of t) compteCar.set(ch, (compteCar.get(ch) || 0) + 1);
    const moy = (jetonsListe.length * 43) / 64;
    const ecartMax = Math.max(...[...compteCar.values()].map((v) => Math.abs(v - moy) / moy));
    controle(`4.8 ${jetonsListe.length} jetons émis : tous distincts, 43 caractères base64url, répartition des caractères sans biais grossier`,
      jetonsListe.every((t) => FORME_JETON.test(t)) && compteCar.size === 64 && ecartMax < 0.5, `distincts ${jetons.size}, caractères distincts ${compteCar.size}, écart maximal à la moyenne ${(ecartMax * 100).toFixed(0)} %`);
    mesures.jetons = jetonsListe.length;

    // ------------------------------------------------------------------------------------------------ 5. origine
    section('5. Origine (anti-CSRF) : toute écriture venant d\'une origine étrangère est refusée, sur CHAQUE route POST');
    const cX = await nouveauClient(102);
    const pX = await patronConnecte(ipSonde());
    const pX2 = await patronConnecte(ipSonde());
    const pX3 = await patronConnecte(ipSonde());
    const cookieCX = cX.cookieHeader();
    const cookiePX = pX.cookieHeader();
    const bodyCmdX = (cle) => ({ ...construireCommande(rng(909), { mode: 'pickup', cle }).body });
    let nCle = 0;
    const POSTS = [
      ['customer_signup.php', '', () => corpsInscription(700 + (++nCle), { ville: 'Rouvroy', prefixe: 'sec07o' })],
      ['customer_login.php', '', () => ({ email: cX.email, password: cX.password })],
      ['customer_logout.php', cookieCX, () => ({})],
      ['customer_update_address.php', cookieCX, () => ({ street: '9 rue Pirate', city: 'Rouvroy' })],
      ['customer_update_profile.php', cookieCX, () => ({ first_name: 'Pirate', last_name: 'Pirate', phone: '06 99 99 99 99' })],
      ['order_create.php', cookieCX, () => bodyCmdX(`orig-${++nCle}-aa`)],
      ['owner_login.php', '', () => ({ code: OWNER_CODE, remember: true })],
      ['owner_logout.php', cookiePX, () => ({})],
      ['owner_sessions_revoke.php', cookiePX, () => ({ scope: 'others' })],
      ['owner_settings.php', cookiePX, () => ({ default_delay_minutes: 60 })],
      ['owner_availability.php', cookiePX, () => ({ kind: 'pizza', name: 'Pizza Pirate', status: 'out_manual' })],
      ['owner_customers.php', cookiePX, () => ({ q: 'sec07' })],
      ['owner_order_decide.php', cookiePX, () => ({ id: idNew2, action: 'refuse' })]
    ];
    const etrangeres = [
      'https://evil.example', 'http://evil.example', 'https://evil.example:8443', 'null', `http://localhost:${PORT}.evil.example`, `http://localhost:${PORT}@evil.example`,
      `http://evil.example#http://localhost:${PORT}`, `https://localhost:${PORT}`, 'http://localhost', `http://localhost:${PORT + 1}`, `HTTP://LOCALHOST:${PORT}`,
      `http://localhost:${PORT}/`, `http://[::1]:${PORT}`, 'chrome-extension://abcdefghijklmnop', 'file://', 'about:blank', '*'
    ];
    for (const [route, cookie, corps] of POSTS) {
      const avant = instantane();
      const reps = await enParallele(etrangeres, 6, (o) => appel('POST', route, { cookie, origin: o, corps: corps() }));
      const ec = reps.map((rep, i) => ({ rep, o: etrangeres[i] })).filter(({ rep }) => !(estErreur(rep, 403, 'bad_origin') && rep.json.message === 'Origine non autorisée.' && rep.setCookies.length === 0));
      controle(`5.1 POST ${route} (cookie ${cookie ? (cookie.includes('owner') ? 'patron' : 'client') : 'aucun'}, corps valide) avec ${etrangeres.length} origines étrangères → 403 bad_origin, aucun cookie posé`,
        ec.length === 0, ec.slice(0, 2).map(({ rep, o }) => `Origin ${o} → ${rep.status} ${court(rep.text, 60)}`).join(' ; ') || `${etrangeres.length}/${etrangeres.length} refusées`);
      controle(`5.2 POST ${route} : aucun effet en base après ces ${etrangeres.length} refus (comptes, commandes, statuts, sessions, réglages, ruptures)`, instantane() === avant, 'base identique');
    }
    const survie = [await appel('GET', 'owner_me.php', { cookie: cookiePX }), await appel('GET', 'owner_me.php', { cookie: pX2.cookieHeader() }), await appel('GET', 'customer_orders.php', { cookie: cookieCX })];
    controle('5.3 après les refus : sessions patron (logout, revoke others visés) et client (logout visé) toujours valides', survie.every((x) => x.status === 200), survie.map((x) => x.status).join('/'));
    // origines acceptées
    const bonnes = [`http://localhost:${PORT}`, `http://127.0.0.1:${PORT}`, `https://${HOTE}`];
    const repBon = await Promise.all(bonnes.map((o) => appel('POST', 'owner_settings.php', { cookie: cookiePX, origin: o, corps: { default_delay_minutes: 30 } })));
    controle('5.4 origines propres au site (APP_ORIGINS : localhost, 127.0.0.1 ; https://<hôte demandé>) : acceptées', repBon.every((x) => x.status === 200), repBon.map((x) => x.status).join('/'));
    // en-tête répété
    const dup1 = await http1({ methode: 'POST', chemin: '/api/owner_settings.php', entetes: { Origin: [`http://localhost:${PORT}`, 'https://evil.example'], 'Content-Type': 'application/json', Cookie: cookiePX }, corps: JSON.stringify({ default_delay_minutes: 60 }) });
    const dup2 = await http1({ methode: 'POST', chemin: '/api/owner_settings.php', entetes: { Origin: ['https://evil.example', `http://localhost:${PORT}`], 'Content-Type': 'application/json', Cookie: cookiePX }, corps: JSON.stringify({ default_delay_minutes: 60 }) });
    const vide = await http1({ methode: 'POST', chemin: '/api/owner_settings.php', entetes: { Origin: '', 'Content-Type': 'application/json', Cookie: cookiePX }, corps: JSON.stringify({ default_delay_minutes: 60 }) });
    controle('5.5 en-tête Origin répété (propre + étranger, dans les deux ordres) ou vide : 403 bad_origin',
      [dup1, dup2, vide].every((x) => estErreur(x, 403, 'bad_origin')), [dup1, dup2, vide].map((x) => x.status).join('/'));
    controle('5.5b le réglage du délai n\'a pas bougé (toujours 30)', Number(un("SELECT svalue FROM settings WHERE skey = 'default_delay_minutes'").svalue) === 30, 'default_delay_minutes = 30');
    // GET et autres méthodes : l'origine est vérifiée avant tout (même pour une route publique ou inconnue)
    const getsEtr = await Promise.all(['availability.php', 'customer_me.php', 'owner_me.php', 'order_status.php?id=1', 'nexiste_pas.php'].map((r) => appel('GET', r, { origin: 'https://evil.example', cookie: cookiePX })));
    const autresEtr = await Promise.all(['HEAD', 'OPTIONS', 'PUT', 'DELETE'].map((m) => appel(m, 'owner_me.php', { origin: 'https://evil.example', cookie: cookiePX })));
    controle('5.6 GET (publics, protégés, route inconnue) avec une origine étrangère : 403 bad_origin (l\'origine est contrôlée avant la route et l\'authentification)', getsEtr.every((x) => estErreur(x, 403, 'bad_origin')), getsEtr.map((x) => x.status).join('/'));
    controle('5.6b HEAD, OPTIONS, PUT, DELETE avec une origine étrangère : 403 bad_origin (HEAD : sans corps)', autresEtr.every((x) => x.status === 403 && (x.method === 'HEAD' ? x.text === '' : x.json.error === 'bad_origin')), autresEtr.map((x) => x.status).join('/'));
    // types de contenu « formulaire » : repli de défense en profondeur contre une requête inter-sites sans Origin
    const formes = ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x', 'application/jsonx', 'text/json', ''];
    const repForm = await enParallele(formes, 6, (ct) => appel('POST', 'owner_settings.php', { cookie: cookiePX, origin: null, brut: JSON.stringify({ default_delay_minutes: 60 }), headers: ct === '' ? { 'Content-Type': '' } : { 'Content-Type': ct } }));
    controle('5.7 sans en-tête Origin, corps JSON envoyé avec un type « formulaire » (text/plain, urlencoded, multipart, jsonx, text/json, vide) : 415, rien n\'est exécuté',
      repForm.every((x) => x.status === 415 || x.status === 400) && Number(un("SELECT svalue FROM settings WHERE skey = 'default_delay_minutes'").svalue) === 30, repForm.map((x) => x.status).join('/'));
    // sans en-tête Origin : comportement documenté (accepté)
    const sansOrigine = [];
    const SANS = [
      ['customer_signup.php', '', () => corpsInscription(800 + (++nCle), { ville: 'Rouvroy', prefixe: 'sec07o' }), 201],
      ['customer_login.php', '', () => ({ email: cX.email, password: cX.password }), 200],
      ['owner_login.php', '', () => ({ code: OWNER_CODE, remember: false }), 200],
      ['customer_update_profile.php', cookieCX, () => ({ first_name: 'Sans', last_name: 'Origine', phone: '06 01 02 03 04' }), 200],
      ['customer_update_address.php', cookieCX, () => ({ street: '3 rue Sans', city: 'Dourges' }), 200],
      ['order_create.php', cookieCX, () => bodyCmdX(`sans-${++nCle}-aa`), 201],
      ['owner_settings.php', cookiePX, () => ({ default_delay_minutes: 30 }), 200],
      ['owner_availability.php', cookiePX, () => ({ kind: 'pizza', name: 'Pizza Sans Origine', status: 'out_manual' }), 200],
      ['owner_customers.php', cookiePX, () => ({ q: 'sec07' }), 200],
      ['owner_order_decide.php', cookiePX, () => ({ id: idNew3, action: 'refuse' }), 200],
      ['owner_sessions_revoke.php', cookiePX, () => ({}), 422],
      ['owner_logout.php', pX3.cookieHeader(), () => ({}), 200]
    ];
    for (const [route, cookie, corps, attendu] of SANS) {
      const rep = await appel('POST', route, { cookie, origin: null, corps: corps() });
      sansOrigine.push(`${route.replace('.php', '')} ${rep.status}`);
      controle(`5.8 POST ${route} SANS en-tête Origin : accepté, traité normalement (${attendu}) — comportement documenté`, rep.status === attendu && !(rep.json && rep.json.error === 'bad_origin'), `${rep.status} ${court(rep.text, 70)}`);
    }
    await appel('POST', 'owner_availability.php', { cookie: cookiePX, corps: { kind: 'pizza', name: 'Pizza Sans Origine', status: 'available' } });
    const lgOut = await appel('POST', 'customer_logout.php', { cookie: cookieCX, origin: null, corps: {} });
    controle('5.8b POST customer_logout SANS en-tête Origin : accepté (200) — comportement documenté', lgOut.status === 200, `${lgOut.status}`);
    info('Comportement documenté : une écriture sans en-tête Origin est acceptée (clients non navigateurs). Défenses de repli : Content-Type application/json obligatoire (415 sinon, voir 5.7), cookies SameSite Strict (patron) / Lax (client).');
    // Origine déduite de l'hôte : information
    const xfh = await appel('POST', 'owner_settings.php', { cookie: pX2.cookieHeader(), origin: 'https://pirate.example', headers: { 'X-Forwarded-Host': 'pirate.example' }, corps: { default_delay_minutes: 30 } });
    info(`Observation : une origine https://<hôte> est acceptée si l'hôte vient de X-Forwarded-Host (essai avec « pirate.example » → ${xfh.status}). Non exploitable par un navigateur (en-tête non forgeable sans préalable CORS) et réécrit par Vercel ; non vérifiable ici (pas de Vercel réel).`);
    mesures.origine = { routesPost: POSTS.length, originesEtrangeres: etrangeres.length };

    // ------------------------------------------------------------------------------------------------ 6. méthodes
    section('6. Méthodes : chaque route avec GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS — jamais de 5xx, 405 avec Allow cohérent');
    const ROUTES = [
      ['availability', ['GET']], ['customer_me', ['GET']], ['customer_orders', ['GET']], ['order_status', ['GET']],
      ['owner_me', ['GET']], ['owner_orders', ['GET']], ['owner_sessions', ['GET']],
      ['customer_signup', ['POST']], ['customer_login', ['POST']], ['customer_logout', ['POST']],
      ['customer_update_address', ['POST']], ['customer_update_profile', ['POST']],
      ['owner_login', ['POST']], ['owner_logout', ['POST']], ['owner_sessions_revoke', ['POST']],
      ['owner_customers', ['POST']], ['owner_order_decide', ['POST']], ['order_create', ['POST']],
      ['owner_settings', ['GET', 'POST']], ['owner_availability', ['GET', 'POST']]
    ];
    const fichiersRoutes = readdirSync(new URL('../../serveur/routes/', import.meta.url)).filter((f) => f.endsWith('.js')).map((f) => f.slice(0, -3)).sort();
    controle(`6.0 la matrice couvre exactement les ${fichiersRoutes.length} routes du dossier serveur/routes`, JSON.stringify(fichiersRoutes) === JSON.stringify(ROUTES.map(([n]) => n).sort()), fichiersRoutes.length + ' routes : ' + fichiersRoutes.filter((f) => !ROUTES.some(([n]) => n === f)).join(',') + ' non couvertes');
    const METHODES = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'];
    const sansCorps = (m) => ['GET', 'HEAD', 'OPTIONS'].includes(m);
    const cM = await nouveauClient(103);
    const pM = await patronConnecte(ipSonde());
    const cookieMix = `${cM.cookieHeader()}; ${pM.cookieHeader()}`;
    const DANGER = {
      customer_signup: () => corpsInscription(900 + (++nCle), { ville: 'Rouvroy', prefixe: 'sec07m' }), customer_login: () => ({ email: cM.email, password: cM.password }),
      customer_logout: () => ({}), customer_update_address: () => ({ street: '1 rue Danger', city: 'Rouvroy' }), customer_update_profile: () => ({ first_name: 'Danger', last_name: 'Danger', phone: '06 66 66 66 66' }),
      owner_login: () => ({ code: OWNER_CODE }), owner_logout: () => ({}), owner_sessions_revoke: () => ({ scope: 'all' }), owner_customers: () => ({ q: '' }),
      owner_order_decide: () => ({ id: idNew4, action: 'refuse' }), order_create: () => bodyCmdX(`meth-${++nCle}-aa`), owner_settings: () => ({ default_delay_minutes: 60 }),
      owner_availability: () => ({ kind: 'pizza', name: 'Pizza Danger', status: 'out_manual' })
    };
    const avantMeth = instantane();
    const tokensMeth = [cM.cookies.get('subito_customer'), pM.cookies.get('subito_owner')];
    let n405 = 0;
    for (const [nom, permises] of ROUTES) {
      const ecarts = [];
      for (const m of METHODES.filter((x) => !permises.includes(x))) {
        const corps = sansCorps(m) ? undefined : (DANGER[nom] ? DANGER[nom]() : {});
        const rep = await appel(m, `${nom}.php`, { cookie: cookieMix, corps });
        n405++;
        const bon = rep.status === 405 && rep.headers.get('allow') === permises.join(', ') && rep.setCookies.length === 0 && rep.headers.get('cache-control') === 'no-store'
          && (m === 'HEAD' ? rep.text === '' : rep.json && rep.json.error === 'method_not_allowed' && rep.json.ok === false);
        if (!bon) ecarts.push(`${m} → ${rep.status} Allow=${rep.headers.get('allow')} ${court(rep.text, 50)}`);
      }
      controle(`6.1 ${nom}.php : les ${METHODES.length - permises.length} méthodes non prévues → 405, Allow: ${permises.join(', ')}, aucun effet (valeur dangereuse envoyée avec de vrais cookies)`, ecarts.length === 0, ecarts.slice(0, 2).join(' ; ') || 'conforme');
    }
    const apresMeth = await Promise.all([appel('GET', 'owner_me.php', { cookie: cookieMix }), appel('GET', 'customer_orders.php', { cookie: cookieMix })]);
    controle('6.2 après les 5xx potentiels : sessions patron et client toujours valides, base identique (aucun 405 n\'a exécuté d\'action)', apresMeth.every((x) => x.status === 200) && instantane() === avantMeth && tokensMeth.every(Boolean), `sessions ${apresMeth.map((x) => x.status).join('/')}`);
    // méthodes prévues : jamais de 405 ni de 5xx
    const ATTENDU_ANON = {
      'availability.php:GET': 200, 'customer_me.php:GET': 200, 'customer_orders.php:GET': 401, 'order_status.php:GET': 401, 'owner_me.php:GET': 401, 'owner_orders.php:GET': 401, 'owner_sessions.php:GET': 401,
      'customer_signup.php:POST': 422, 'customer_login.php:POST': 401, 'customer_logout.php:POST': 200, 'customer_update_address.php:POST': 401, 'customer_update_profile.php:POST': 401,
      'owner_login.php:POST': 401, 'owner_logout.php:POST': 401, 'owner_sessions_revoke.php:POST': 401, 'owner_customers.php:POST': 401, 'owner_order_decide.php:POST': 401, 'order_create.php:POST': 401,
      'owner_settings.php:GET': 401, 'owner_settings.php:POST': 401, 'owner_availability.php:GET': 401, 'owner_availability.php:POST': 401
    };
    const ecAnon = [];
    for (const [nom, permises] of ROUTES) for (const m of permises) {
      const rep = await appel(m, `${nom}.php`, { corps: sansCorps(m) ? undefined : {} });
      if (rep.status !== ATTENDU_ANON[`${nom}.php:${m}`]) ecAnon.push(`${m} ${nom} → ${rep.status} (attendu ${ATTENDU_ANON[`${nom}.php:${m}`]})`);
    }
    controle(`6.3 méthodes prévues sans cookie (corps {}) : ${Object.keys(ATTENDU_ANON).length} combinaisons route/méthode au statut attendu (200, 401 ou 422), jamais 405 ni 5xx`, ecAnon.length === 0, ecAnon.slice(0, 3).join(' ; ') || 'conforme');
    // identités authentifiées, routes autorisées et non autorisées : jamais de 5xx
    const cM2 = await nouveauClient(105);
    const pM2 = await patronConnecte(ipSonde());
    const identites = [['client', () => cM2.cookieHeader()], ['patron', () => pM2.cookieHeader()]];
    const nonLogout = ROUTES.filter(([n]) => !/logout/.test(n)).concat(ROUTES.filter(([n]) => /logout/.test(n)));
    for (const [qui, cookie] of identites) {
      const ec = [];
      let n = 0;
      for (const [nom, permises] of nonLogout) for (const m of METHODES) {
        const rep = await appel(m, `${nom}.php${nom === 'order_status' ? '?id=1' : ''}`, { cookie: cookie(), corps: sansCorps(m) ? undefined : {} });
        n++;
        const prevu = permises.includes(m);
        if (rep.status >= 500 || (prevu && rep.status === 405) || (!prevu && rep.status !== 405)) ec.push(`${m} ${nom} → ${rep.status} ${court(rep.text, 50)}`);
      }
      controle(`6.4 identité ${qui} : ${n} requêtes (20 routes × 7 méthodes, valeurs {}) : 405 exactement pour les méthodes non prévues, jamais de 5xx`, ec.length === 0, ec.slice(0, 3).join(' ; ') || 'conforme');
    }
    const sansPhp = await Promise.all(ROUTES.map(async ([nom, permises]) => {
      const m = METHODES.find((x) => !permises.includes(x) && !['HEAD'].includes(x));
      const rep = await appel(m, nom, { cookie: cookieMix, corps: sansCorps(m) ? undefined : {} });
      return { nom, m, rep, permises };
    }));
    controle('6.5 mêmes routes sans extension .php (/api/<nom>) : 405 et Allow identiques', sansPhp.every((x) => x.rep.status === 405 && x.rep.headers.get('allow') === x.permises.join(', ')), `${compte(sansPhp, (x) => x.rep.status === 405)}/20`);
    const tunnel = await Promise.all([appel('GET', 'owner_login.php', { headers: { 'X-HTTP-Method-Override': 'POST' } }), appel('GET', 'owner_login.php?_method=POST'),
      appel('POST', 'availability.php', { headers: { 'X-HTTP-Method-Override': 'GET' }, corps: {} }), appel('GET', 'customer_logout.php', { cookie: cookieMix, headers: { 'X-Method-Override': 'POST' } })]);
    controle('6.6 X-HTTP-Method-Override, X-Method-Override, ?_method= : ignorés (405 comme sans l\'en-tête)', tunnel.every((x) => x.status === 405), tunnel.map((x) => x.status).join('/'));
    // méthodes exotiques
    const trace = await http1({ methode: 'TRACE', chemin: '/api/owner_me.php', entetes: { Cookie: cookieMix } });
    const propfind = await requeteBrute('PROPFIND /api/owner_me.php HTTP/1.1', [`Cookie: ${cookiePX}`]);
    const inconnue2 = await requeteBrute('FOO /api/owner_me.php HTTP/1.1', []);
    const minuscule = await requeteBrute('get /api/availability.php HTTP/1.1', []);
    controle('6.7 TRACE, PROPFIND, méthode inconnue (FOO) et « get » en minuscules : jamais de 5xx, jamais de réflexion de l\'en-tête Cookie',
      [trace, propfind, inconnue2, minuscule].every((x) => x.status > 0 && x.status < 500) && !/subito_(owner|customer)=/.test(trace.text) && !/subito_(owner|customer)=/.test(propfind.texte),
      `TRACE ${trace.status}, PROPFIND ${propfind.status}, FOO ${inconnue2.status}, get ${minuscule.status}`);
    mesures.methodes = { disallowed: n405, matrice: ROUTES.length * METHODES.length };

    // ------------------------------------------------------------------------------------------------ 7. routes inconnues
    section('7. Routes inconnues et noms pathologiques (.., %2e%2e, très longs, Unicode, noms réservés Windows) : 404 JSON propre');
    const ROUTE_404 = (r) => r.status === 404 && r.json && r.json.ok === false && r.json.error === 'not_found' && r.json.message === 'Route inconnue.' && r.headers.get('content-type') === 'application/json; charset=utf-8';
    const groupes404 = {
      'noms simples inconnus': ['/api/nexiste_pas.php', '/api/nexiste_pas', '/api/', '/api', '/api/.php', '/api/owner', '/api/customer', '/api/index.php', '/api/config.php', '/api/install.php', '/api/tools/install.php',
        '/api/lib/auth.php', '/api/.env', '/api/.git/config', '/api/_dbtest.php', '/api/_phpinfo.php', '/api/routes', '/api/serveur', '/api/package.json'],
      'variantes d\'une vraie route (casse, extension, suffixe)': ['/api/OWNER_ME.php', '/api/Owner_Me', '/api/owner-me.php', '/api/owner_me.PHP', '/api/owner_me.php.bak', '/api/owner_me.php~', '/api/owner_me.js', '/api/owner_me.mjs', '/api/owner_me.php.',
        '/api/owner_me.php;', '/api/owner_me;x=1', '/api/owner_me%00', '/api/owner_me.php%00.png', '/api/owner_me%2ephp', '/api/owner%5fme.php', '/api/owner_me.php%20', '/api/owner_me%09', '/api/owner_m%65.php', '/api/owner_me.php%2f', '/api/owner_me.php%5c'],
      'traversée de chemin (.., %2e%2e, séparateurs encodés, doubles encodages)': ['/api/../serveur/db.js', '/api/../serveur/db', '/api/..%2fserveur%2fdb', '/api/%2e%2e/serveur/db', '/api/%2e%2e%2fserveur%2fdb', '/api/..%5cserveur%5cdb',
        '/api/....//serveur/db', '/api/..;/serveur/db', '/api/routes/../../serveur/db', '/api/%252e%252e/serveur/db', '/api/.%2e/serveur/db', '/api/%2e./serveur/db', '/api/../../../../etc/passwd',
        '/api/..%c0%afserveur', '/api/%c0%ae%c0%ae/serveur/db', '/api/routes/owner_me.js', '/api/..\\serveur\\db', '/api/..%2f..%2f..%2f..%2fetc%2fpasswd', '/api/%2e%2e/%2e%2e/%2e%2e/etc/passwd', '/api/routes%2fowner_me'],
      'Unicode et caractères exotiques': ['/api/é.php', '/api/%C3%A9', '/api/%E6%97%A5%E6%9C%AC%E8%AA%9E', '/api/%F0%9F%8D%95', '/api/%E2%80%AEeman_rewo', '/api/%EF%BC%A1', '/api/%C0%AF', '/api/%FF%FE', '/api/%E2%80%8Bowner_me', '/api/owner_me%C2%A0',
        '/api/%CE%91', '/api/owner_me%EF%BC%8Ephp', '/api/%ED%A0%80', '/api/a%00b', '/api/%0d%0aSet-Cookie:%20x=1'],
      'noms très longs (dans la limite des en-têtes)': [`/api/${'a'.repeat(300)}`, `/api/${'a_'.repeat(500)}`, `/api/${'a'.repeat(8000)}.php`, `/api/${'x'.repeat(14000)}`, `/api/${'%2e'.repeat(2000)}`, `/api/${'..%2f'.repeat(2000)}`, `/api/${'a/'.repeat(3000)}owner_zzz`],
      'noms réservés Windows (con, nul, aux, prn)': ['/api/con', '/api/nul', '/api/aux', '/api/prn', '/api/con.php', '/api/nul.php', '/api/aux.php', '/api/prn.php']
    };
    for (const [nom, chemins] of Object.entries(groupes404)) {
      const reps = await enParallele(chemins, 6, (c) => http1({ methode: 'GET', chemin: c }));
      const ec = reps.map((rep, i) => ({ rep, c: chemins[i] })).filter(({ rep }) => !ROUTE_404(rep));
      controle(`7.1 ${nom} (${chemins.length} chemins) : 404 JSON { error: not_found, message: Route inconnue. }, jamais de 5xx ni de contenu de fichier`,
        ec.length === 0, ec.slice(0, 3).map(({ rep, c }) => `${court(c, 50)} → ${rep.status || rep.erreur} ${court(rep.text, 50)}`).join(' ; ') || `${chemins.length}/${chemins.length} en 404`);
    }
    // chemins qui se résolvent encore sur une vraie route : seul le DERNIER segment compte
    const alias = ['/api/x/availability.php', '/api/x/y/z/availability', '/api/../availability.php', '/api/%2e%2e/availability.php', '/api/routes/availability', '/api/%2e%2e%2favailability.php'];
    const repAlias = await enParallele(alias, 6, (c) => http1({ methode: 'GET', chemin: c }));
    for (let i = 0; i < alias.length; i++) {
      controle(`7.2 chemin non canonique ${alias[i]} : 404 (une route ne répond qu'à /api/<nom> ou /api/<nom>.php)`, ROUTE_404(repAlias[i]), `${repAlias[i].status} ${court(repAlias[i].text, 60)}`);
    }
    const aliasAuth = await Promise.all(['/api/x/owner_me.php', '/api/%2e%2e/owner_me.php'].map((c) => http1({ methode: 'GET', chemin: c, entetes: { Cookie: cookiePX } })));
    controle('7.2b une route protégée n\'est jamais servie sous un chemin non canonique, même avec un cookie patron valide', aliasAuth.every((x) => x.status === 404), aliasAuth.map((x) => x.status).join('/'));
    const trop = await Promise.all([`/api/${'a'.repeat(20000)}`, `/api/?${'q=1&'.repeat(6000)}`].map((c) => http1({ methode: 'GET', chemin: c })));
    const apresLong = await appel('GET', 'availability.php');
    controle('7.3 chemin ou requête de 20 000+ octets : refusé par le serveur HTTP (4xx, jamais 5xx), le serveur reste debout', trop.every((x) => x.status === 0 || (x.status >= 400 && x.status < 500)) && apresLong.status === 200, `${trop.map((x) => x.status || x.erreur).join('/')}, ensuite availability ${apresLong.status}`);
    const nulChemin = await requeteBrute('GET /api/owner_me\u0000.php HTTP/1.1', []);
    const espace = await requeteBrute('GET /api/owner me.php HTTP/1.1', []);
    controle('7.4 octet NUL ou espace dans le chemin de la requête : 400 du serveur HTTP, jamais 5xx', [nulChemin, espace].every((x) => x.status >= 400 && x.status < 500), `NUL ${nulChemin.status}, espace ${espace.status}`);
    const corpsSources = await Promise.all(['/api/../serveur/router.js', '/api/..%2fserveur%2frouter.js', '/api/routes/owner_login.js'].map((c) => http1({ methode: 'GET', chemin: c })));
    controle('7.5 aucun code source servi par les chemins de traversée (pas de « import », « export », « function » dans les réponses)', corpsSources.every((x) => !/\bimport\b|\bexport\b|function\s*\(|=>/.test(x.text)), corpsSources.map((x) => x.status).join('/'));

    // ------------------------------------------------------------------------------------------------ 8. entrées pathologiques
    section('8. Entrées pathologiques (NUL, substituts isolés, imbrication, __proto__) : jamais de 5xx, jamais de fuite dans l\'erreur');
    const NUL = '\u0000';
    const cNul = await nouveauClient(106);
    const cNulCookie = cNul.cookieHeader();
    const bodyBase = construireCommande(rng(606), { mode: 'pickup', cle: 'nul-base-00' }).body;
    let nNul = 0;
    const cle = () => `nul-${++nNul}-zz`;
    const casNul = [
      ['inscription : rue avec NUL (ville valide)', 'customer_signup.php', '', () => ({ ...corpsInscription(950 + (++nCle), { ville: 'Rouvroy', prefixe: 'sec07n' }), street: `1 rue${NUL}X` })],
      ['inscription : prénom avec NUL', 'customer_signup.php', '', () => ({ ...corpsInscription(950 + (++nCle), { ville: 'Rouvroy', prefixe: 'sec07n' }), first_name: `Jean${NUL}Luc` })],
      ['inscription : mot de passe avec NUL', 'customer_signup.php', '', () => ({ ...corpsInscription(950 + (++nCle), { ville: 'Rouvroy', prefixe: 'sec07n' }), password: `Mdp${NUL}1234-aA!` })],
      ['inscription : e-mail avec NUL', 'customer_signup.php', '', () => ({ ...corpsInscription(950 + (++nCle), { ville: 'Rouvroy', prefixe: 'sec07n' }), email: `nul${NUL}@example.test` })],
      ['inscription : rue avec substituts isolés (\\ud800)', 'customer_signup.php', '', () => ({ ...corpsInscription(950 + (++nCle), { ville: 'Rouvroy', prefixe: 'sec07n' }), street: '1 rue \ud800 X' })],
      ['adresse : rue avec NUL', 'customer_update_address.php', cNulCookie, () => ({ street: `1 rue${NUL}X`, city: 'Rouvroy' })],
      ['adresse : ville avec NUL', 'customer_update_address.php', cNulCookie, () => ({ street: '1 rue X', city: `Rouvroy${NUL}` })],
      ['profil : nom avec NUL', 'customer_update_profile.php', cNulCookie, () => ({ first_name: 'Jean', last_name: `Du${NUL}pont`, phone: '06 11 22 33 44' })],
      ['profil : téléphone avec NUL', 'customer_update_profile.php', cNulCookie, () => ({ first_name: 'Jean', last_name: 'Dupont', phone: `06 11 22 33${NUL}44` })],
      ['commande : remarque avec NUL', 'order_create.php', cNulCookie, () => ({ ...bodyBase, idempotency_key: cle(), items: bodyBase.items.map((it) => ({ ...it, note: `a${NUL}b` })) })],
      ['commande : nom d\'article avec NUL', 'order_create.php', cNulCookie, () => ({ ...bodyBase, idempotency_key: cle(), items: bodyBase.items.map((it) => ({ ...it, name: it.name + NUL })) })],
      ['commande : ingrédient retiré avec NUL', 'order_create.php', cNulCookie, () => ({ ...bodyBase, idempotency_key: cle(), items: bodyBase.items.map((it) => ({ ...it, removed: [`a${NUL}`] })) })],
      ['commande : supplément avec NUL', 'order_create.php', cNulCookie, () => ({ ...bodyBase, idempotency_key: cle(), items: bodyBase.items.map((it) => ({ ...it, extras: [{ name: `a${NUL}`, price_cents: 0, qty: 1 }] })) })],
      ['commande : moitié-moitié avec NUL', 'order_create.php', cNulCookie, () => ({ ...bodyBase, idempotency_key: cle(), items: bodyBase.items.map((it) => ({ ...it, half: { flavor1: `a${NUL}`, flavor2: 'b' } })) })],
      ['commande : clé d\'idempotence avec NUL', 'order_create.php', cNulCookie, () => ({ ...bodyBase, idempotency_key: `abcdefgh${NUL}ij` })],
      ['connexion client : e-mail avec NUL', 'customer_login.php', '', () => ({ email: `a${NUL}@example.test`, password: 'x'.repeat(12) })],
      ['connexion client : mot de passe avec NUL', 'customer_login.php', '', () => ({ email: cNul.email, password: `a${NUL}b` })],
      ['connexion patron : code avec NUL', 'owner_login.php', '', () => ({ code: `a${NUL}b` })],
      ['patron : recherche clients avec NUL', 'owner_customers.php', cookiePX, () => ({ q: `a${NUL}b` })],
      ['patron : rupture avec NUL dans le nom', 'owner_availability.php', cookiePX, () => ({ kind: 'pizza', name: `a${NUL}b`, status: 'out_manual' })],
      ['patron : recherche clients avec \\ et %_', 'owner_customers.php', cookiePX, () => ({ q: '\\%_!\\\\' })],
      ['patron : décision avec id 2^31', 'owner_order_decide.php', cookiePX, () => ({ id: 2147483648, action: 'refuse' })],
      ['patron : décision avec id 1e308', 'owner_order_decide.php', cookiePX, () => ({ id: 1e308, action: 'refuse' })],
      ['patron : décision avec id texte', 'owner_order_decide.php', cookiePX, () => ({ id: '1 OR 1=1', action: 'refuse' })]
    ];
    const resNul = [];
    for (const [nom, route, cookie, corps] of casNul) {
      const rep = await appel('POST', route, { cookie, corps: corps() });
      resNul.push({ nom, rep });
      const fuite = problemesFuite(rep);
      controle(`8.1 ${nom} : ni 5xx ni fuite`, rep.status < 500 && fuite.length === 0, `${rep.status} ${court(rep.text, 80)}${fuite.length ? ' ; fuite : ' + fuite.join(', ') : ''}`);
    }
    const profond = '{"a":'.repeat(5000) + '1' + '}'.repeat(5000);
    const protoCorps = '{"__proto__":{"admin":true},"constructor":{"prototype":{"owner":true}},"items":[{"__proto__":{"qty":99}}],"idempotency_key":"proto-00001","mode":"pickup","payment_methods":[],"delivery_fee_cents":0,"total_cents":1}';
    const bom = '﻿{"scope":"all"}';
    const gros = JSON.stringify({ q: 'x'.repeat(60000) });
    const pathos = [
      ['JSON imbriqué sur 5 000 niveaux (corps de 30 Ko)', 'owner_customers.php', cookiePX, profond], ['clés __proto__ et constructor', 'order_create.php', cNulCookie, protoCorps],
      ['corps JSON précédé d\'un BOM', 'owner_sessions_revoke.php', cookiePX, bom], ['chaîne de 60 000 caractères', 'owner_customers.php', cookiePX, gros],
      ['corps tableau []', 'owner_customers.php', cookiePX, '[]'], ['corps « null »', 'owner_customers.php', cookiePX, 'null'], ['corps vide', 'owner_customers.php', cookiePX, ''],
      ['corps non JSON', 'owner_customers.php', cookiePX, '{q: test'], ['corps UTF-8 invalide', 'owner_customers.php', cookiePX, Buffer.from([0x7b, 0x22, 0x71, 0x22, 0x3a, 0x22, 0xff, 0xfe, 0x22, 0x7d])]
    ];
    for (const [nom, route, cookie, brut] of pathos) {
      const rep = await appel('POST', route, { cookie, brut });
      const fuite = problemesFuite(rep);
      controle(`8.2 ${nom} : erreur propre (4xx), jamais de 5xx ni de fuite`, rep.status >= 200 && rep.status < 500 && fuite.length === 0 && rep.json !== null, `${rep.status} ${court(rep.text, 80)}`);
    }
    const trop64 = await appel('POST', 'owner_customers.php', { cookie: cookiePX, brut: JSON.stringify({ q: 'x'.repeat(70000) }) });
    const lenMenteur = await http1({ methode: 'POST', chemin: '/api/owner_customers.php', entetes: { Origin: ORIGINE_OK, 'Content-Type': 'application/json', Cookie: cookiePX, 'Content-Length': '99999999' }, corps: '{}' });
    controle('8.3 corps de 70 Ko : 413 payload_too_large ; en-tête Content-Length annonçant 99 999 999 : jamais de 5xx', estErreur(trop64, 413, 'payload_too_large') && (lenMenteur.status === 413 || lenMenteur.status === 0 || (lenMenteur.status >= 400 && lenMenteur.status < 500)), `${trop64.status}, Content-Length menteur ${lenMenteur.status || lenMenteur.erreur}`);
    // une erreur 500 (si elle se produit) ne doit rien révéler : on regarde le journal de la section
    const cinqCents = resNul.filter((x) => x.rep.status >= 500);
    if (cinqCents.length) info(`${cinqCents.length} réponse(s) 5xx dans cette section : ${cinqCents.map((x) => x.nom + ' → ' + x.rep.status).join(' ; ')}`);

    // ------------------------------------------------------------------------------------------------ 9. identités simultanées
    section('9. Rafale d\'identités simultanées : aucune réponse ne mélange deux clients');
    const verite9 = new Map(rows('SELECT id, customer_id FROM orders').map((o) => [Number(o.id), Number(o.customer_id)]));
    const nbParClient = new Map();
    for (const [, cid] of verite9) nbParClient.set(cid, (nbParClient.get(cid) || 0) + 1);
    const jobs = Array.from({ length: 900 }, (_, i) => ({ c: clients[(i * 7) % NB], genre: i % 3, i }));
    const ecMix = [];
    await enParallele(jobs, 60, async ({ c, genre, i }) => {
      if (genre === 0) {
        const rep = await c.get('customer_me.php');
        if (!(rep.status === 200 && rep.json.customer && rep.json.customer.id === c.customer.id && rep.json.customer.email === c.email)) ecMix.push(`#${i} customer_me client ${c.num} → ${court(rep.text, 80)}`);
      } else if (genre === 1) {
        const rep = await c.get('customer_orders.php');
        const mauvais = !(rep.status === 200 && rep.json.orders.length === nbParClient.get(c.customer.id) && rep.json.orders.every((o) => verite9.get(o.id) === c.customer.id));
        if (mauvais) ecMix.push(`#${i} customer_orders client ${c.num} → ${court(rep.text, 80)}`);
      } else {
        const autre = clients[(i * 7 + 1 + (i % (NB - 1))) % NB];
        const idEtranger = [...verite9].find(([, cid]) => cid === autre.customer.id)[0];
        const rep = await c.get(`order_status.php?id=${idEtranger}`);
        if (!(rep.status === 404 && rep.text === TEXTE404)) ecMix.push(`#${i} order_status client ${c.num} → commande ${idEtranger} de ${autre.num} : ${rep.status}`);
      }
    });
    controle('9.1 900 requêtes (60 simultanées) de 20 clients : customer_me, customer_orders et order_status d\'autrui — chaque réponse correspond à son demandeur, jamais de mélange', ecMix.length === 0, ecMix.slice(0, 2).join(' ; ') || '900/900 réponses cohérentes');
    const melange = await enParallele(Array.from({ length: 300 }, (_, i) => i), 40, async (i) => {
      const c = clients[i % NB];
      const cookie = i % 2 === 0 ? c.cookieHeader() : `${c.cookieHeader()}; ${cookiePatron}`;
      const [a, b] = await Promise.all([appel('GET', 'customer_me.php', { cookie }), appel('GET', 'owner_me.php', { cookie })]);
      return { c, i, a, b };
    });
    const ecMel = melange.filter(({ c, i, a, b }) => !(a.json.customer.id === c.customer.id && (i % 2 === 0 ? estErreur(b, 401, 'unauthorized') : b.status === 200)));
    controle('9.2 300 paires simultanées client seul / client + patron : le client voit toujours son propre compte, le patron n\'est reconnu que s\'il présente son cookie', ecMel.length === 0, ecMel.slice(0, 2).map(({ c, i, a, b }) => `#${i} client ${c.num} ${a.status}/${b.status}`).join(' ; ') || '600 requêtes cohérentes');
    mesures.rafale = 900 + 600;

    // ------------------------------------------------------------------------------------------------ 10. force brute simultanée
    section('10. Force brute en rafale : la limite de 5 échecs par IP tient-elle quand les tentatives arrivent TOUTES EN MÊME TEMPS ?');
    const rafaleOwner = [];
    for (let essai = 1; essai <= 3; essai++) {
      const ip = ipSonde();
      const rafale = await Promise.all(Array.from({ length: 40 }, (_, k) => appel('POST', 'owner_login.php', { ip, corps: { code: `mauvais-code-${essai}-${k}` } })));
      const evalues = compte(rafale, (x) => x.status === 401);
      const bloques = compte(rafale, (x) => x.status === 429);
      const apres = await appel('POST', 'owner_login.php', { ip, corps: { code: OWNER_CODE } });
      rafaleOwner.push(evalues);
      controle(`10.${essai}a 40 codes patron faux envoyés en même temps depuis UNE adresse (essai ${essai}) : au plus 5 sont évalués (401), les autres bloqués (429)`, evalues <= 5 && evalues + bloques === 40, `${evalues} évalués (401), ${bloques} bloqués (429)`);
      controle(`10.${essai}b ensuite, même le BON code est refusé depuis cette adresse (429, aucun cookie)`, estErreur(apres, 429, 'too_many_attempts') && apres.setCookies.length === 0, `${apres.status} ${apres.json && apres.json.error}`);
    }
    const rafaleClient = [];
    for (let essai = 1; essai <= 2; essai++) {
      const ip = ipSonde();
      const victime = clients[5 + essai].email;
      const rafale = await Promise.all(Array.from({ length: 30 }, (_, k) => appel('POST', 'customer_login.php', { ip, corps: { email: victime, password: `Mauvais-${essai}-${k}-aA1!` } })));
      const evalues = compte(rafale, (x) => x.status === 401);
      rafaleClient.push(evalues);
      controle(`10.${3 + essai} 30 mots de passe faux simultanés sur un compte client depuis UNE adresse (essai ${essai}) : au plus 5 évalués (401)`, evalues <= 5 && evalues + compte(rafale, (x) => x.status === 429) === 30, `${evalues} évalués (401), ${compte(rafale, (x) => x.status === 429)} bloqués (429)`);
    }
    mesures.forceBrute = { owner: rafaleOwner, client: rafaleClient };
    // les en-têtes d'adresse forgés ne contournent pas la limite (X-Forwarded-For, X-Real-IP, x-subito-test-ip invalide)
    const spoof = [];
    for (let k = 0; k < 7; k++) {
      spoof.push(await appel('POST', 'owner_login.php', {
        headers: { 'x-subito-test-ip': 'pas-une-ip', 'X-Forwarded-For': `203.0.113.${k + 1}`, 'X-Real-IP': `198.51.100.${k + 1}`, 'X-Vercel-Forwarded-For': `192.0.2.${k + 1}`, Forwarded: `for=203.0.113.${k + 9}` },
        corps: { code: 'faux-' + k }
      }));
    }
    controle('10.6 7 codes faux avec X-Forwarded-For / X-Real-IP / X-Vercel-Forwarded-For / Forwarded différents à chaque essai (adresse de test invalide) : verrouillés dès le 6e (l\'adresse reste celle de la connexion)',
      spoof.slice(0, 5).every((x) => x.status === 401) && spoof.slice(5).every((x) => x.status === 429), spoof.map((x) => x.status).join('/'));
    site.db.prepare("DELETE FROM throttle WHERE bucket = 'owner_login:ip:127.0.0.1'").run();

    // ------------------------------------------------------------------------------------------------ 11. attributs des cookies (HTTP simple)
    section('11. Attributs des cookies de session (site de test en HTTP : Secure absent, tout le reste imposé)');
    const lPatronCourt = await appel('POST', 'owner_login.php', { corps: { code: OWNER_CODE, remember: false } });
    const lPatronLong = await appel('POST', 'owner_login.php', { corps: { code: OWNER_CODE, remember: true } });
    const insc = await appel('POST', 'customer_signup.php', { corps: corpsInscription(400, { ville: 'Rouvroy', prefixe: 'sec07' }) });
    const conn = await appel('POST', 'customer_login.php', { corps: { email: 'sec07-400@example.test', password: 'Essai-sec07-400-Aa1!' } });
    const jeu = [
      ['patron, « rester connecté » décoché', lPatronCourt, { nom: 'subito_owner', sameSite: 'Strict', secure: false, persistant: false }],
      ['patron, « rester connecté » coché', lPatronLong, { nom: 'subito_owner', sameSite: 'Strict', secure: false, persistant: true }],
      ['client, inscription', insc, { nom: 'subito_customer', sameSite: 'Lax', secure: false, persistant: true }],
      ['client, connexion', conn, { nom: 'subito_customer', sameSite: 'Lax', secure: false, persistant: true }]
    ];
    for (const [nom, rep, att] of jeu) {
      const pb = rep.setCookies.length === 1 ? problemesCookie(rep.setCookies[0], att) : [`${rep.setCookies.length} Set-Cookie (attendu 1) : ${rep.status} ${court(rep.text, 60)}`];
      controle(`11.1 ${nom} : un seul Set-Cookie, ${att.nom}, ${att.persistant ? 'Max-Age=2592000 (30 j)' : 'cookie de session sans Max-Age'}, Path=/api/, HttpOnly, SameSite=${att.sameSite}, pas de Domain, Secure absent (HTTP)`, pb.length === 0, pb.join(' ; ') || court(rep.setCookies[0], 140));
    }
    const dureeBase = (id) => { const s = un('SELECT created_at, expires_at FROM sessions WHERE token_hash = ?', hash256(id)); return s ? Math.round((Date.parse(s.expires_at) - Date.parse(s.created_at)) / 1000) : null; };
    const dB = [dureeBase(jetonDeSetCookie(lPatronCourt.setCookies, 'subito_owner')), dureeBase(jetonDeSetCookie(lPatronLong.setCookies, 'subito_owner')), dureeBase(jetonDeSetCookie(insc.setCookies, 'subito_customer'))];
    controle('11.2 durée de vie côté serveur : patron sans « rester connecté » 12 h (43 200 s), patron avec 30 j, client 30 j (2 592 000 s)', dB[0] === 43200 && dB[1] === 2592000 && dB[2] === 2592000, `${dB.join(' / ')} secondes`);
    const refus = await appel('POST', 'owner_login.php', { corps: { code: 'faux', remember: true } });
    const refus2 = await appel('POST', 'customer_login.php', { corps: { email: 'sec07-400@example.test', password: 'faux-faux-faux' } });
    controle('11.3 connexions refusées (401) : aucun Set-Cookie', refus.status === 401 && refus2.status === 401 && refus.setCookies.length === 0 && refus2.setCookies.length === 0, `${refus.status}/${refus2.status}`);
    const sessTous = rows('SELECT token_hash, user_type, user_id, remember FROM sessions');
    const pbType = sessTous.filter((s) => (s.user_type === 'owner') !== (Number(s.user_id) === 1 && s.user_type === 'owner') || !['owner', 'customer'].includes(s.user_type));
    controle('11.4 toutes les sessions en base : type owner ou customer, les sessions patron ont user_id = 1', pbType.length === 0, `${sessTous.length} sessions`);

    // ------------------------------------------------------------------------------------------------ 4b. sessions patron révoquées (en dernier : « others » et « all » coupent aussi les autres sessions patron)
    section('4b. Sessions patron : déconnexion, révocation des autres, révocation de toutes — jeton rejeté partout ensuite');
    const o1 = await patronConnecte(ipSonde(), false);
    const to1 = o1.cookies.get('subito_owner');
    const avant1 = await appel('GET', 'owner_me.php', { cookie: `subito_owner=${to1}` });
    const out1 = await o1.post('owner_logout.php', {});
    controle('4.9 owner_logout : cookie effacé (Max-Age=0, Path, HttpOnly, SameSite=Strict), puis le jeton est rejeté sur les 17 routes (401)',
      avant1.status === 200 && out1.status === 200 && out1.setCookies.length === 1 && problemesCookie(out1.setCookies[0], { nom: 'subito_owner', sameSite: 'Strict', secure: false, efface: true }).length === 0 && (await ecartsRejet(`subito_owner=${to1}`)).length === 0,
      `avant ${avant1.status}, logout ${out1.status}, ${out1.setCookies.map((s) => court(s, 90)).join(' | ')}`);
    const sA = await patronConnecte(ipSonde(), false);
    const sB = await patronConnecte(ipSonde(), true);
    const sC = await patronConnecte(ipSonde(), false);
    const [tA, tB, tC] = [sA, sB, sC].map((s) => s.cookies.get('subito_owner'));
    const nowUtcA = utc(T0);
    const autresActives = Number(un("SELECT COUNT(*) AS n FROM sessions WHERE user_type = 'owner' AND revoked_at IS NULL AND expires_at > ?", nowUtcA).n) - 1;
    const rvO = await sA.post('owner_sessions_revoke.php', { scope: 'others' });
    const apresOthers = await Promise.all([tA, tB, tC, patron.cookies.get('subito_owner'), pX.cookies.get('subito_owner'), pM.cookies.get('subito_owner')].map((t) => appel('GET', 'owner_me.php', { cookie: `subito_owner=${t}` })));
    const liste1 = await sA.get('owner_sessions.php');
    controle(`4.10 owner_sessions_revoke {scope:"others"} : ${autresActives} autres sessions patron révoquées, la courante survit, toutes les autres → 401 sur toutes les routes`,
      rvO.status === 200 && rvO.json.revoked === autresActives && rvO.json.logged_out === undefined && apresOthers[0].status === 200 && apresOthers.slice(1).every((x) => x.status === 401)
      && (await ecartsRejet(`subito_owner=${tB}`)).length === 0 && (await ecartsRejet(`subito_owner=${tC}`)).length === 0,
      `revoked ${rvO.json && rvO.json.revoked} (attendu ${autresActives}), statuts ${apresOthers.map((x) => x.status).join('/')}`);
    controle('4.10b owner_sessions ensuite : une seule session active, marquée current', liste1.status === 200 && liste1.json.sessions.length === 1 && liste1.json.sessions[0].current === true, `${liste1.json && liste1.json.sessions.length} session(s)`);
    const rvAll = await sA.post('owner_sessions_revoke.php', { scope: 'all' });
    const apresAll = await appel('GET', 'owner_me.php', { cookie: `subito_owner=${tA}` });
    controle('4.11 owner_sessions_revoke {scope:"all"} : logged_out:true, cookie effacé dans la réponse, jeton de la session courante rejeté partout ensuite',
      rvAll.status === 200 && rvAll.json.logged_out === true && rvAll.json.revoked === 1 && rvAll.setCookies.length === 1 && problemesCookie(rvAll.setCookies[0], { nom: 'subito_owner', sameSite: 'Strict', secure: false, efface: true }).length === 0 && apresAll.status === 401 && (await ecartsRejet(`subito_owner=${tA}`)).length === 0,
      `revoked ${rvAll.json && rvAll.json.revoked}, logged_out ${rvAll.json && rvAll.json.logged_out}, ensuite ${apresAll.status}`);
    const rvBad = await Promise.all(['', 'tous', 'ALL', ['all'], 1, null, { x: 1 }].map(async (scope) => {
      const s = await patronConnecte(ipSonde());
      const rep = await s.post('owner_sessions_revoke.php', { scope });
      const vivant = await s.get('owner_me.php');
      return { rep, vivant };
    }));
    controle('4.12 owner_sessions_revoke avec un scope invalide (vide, « tous », « ALL », tableau, nombre, null, objet) : 422 validation et AUCUNE session révoquée', rvBad.every(({ rep, vivant }) => rep.status === 422 && rep.json.error === 'validation' && vivant.status === 200), rvBad.map(({ rep }) => rep.status).join('/'));
    const login2 = await patronConnecte(ipSonde());
    const second = await patronConnecte(ipSonde());
    const premiere = await login2.get('owner_me.php');
    info(`Comportement documenté : une nouvelle connexion patron ne révoque PAS les sessions précédentes (plusieurs appareils possibles, listés par owner_sessions) ; la première session reste valable : ${premiere.status}. Seule la reconnexion CLIENT dans le même navigateur révoque l'ancienne session (4.2).`);
    controle('4.13 deux connexions patron successives : sessions distinctes (jetons et identifiants différents)', login2.cookies.get('subito_owner') !== second.cookies.get('subito_owner') && (await login2.get('owner_me.php')).json.owner.session_id !== (await second.get('owner_me.php')).json.owner.session_id, 'deux sessions');

    // ------------------------------------------------------------------------------------------------ 12. stockage et balayage
    section('12. Stockage en base : jamais de jeton ni de mot de passe en clair');
    const clients12 = rows('SELECT id, email, password_hash FROM customers');
    controle('12.1 mots de passe clients : hash bcrypt (coût ≥ 10), jamais le mot de passe', clients12.every((c) => /^\$2[aby]\$(\d\d)\$/.test(c.password_hash) && Number(c.password_hash.slice(4, 6)) >= 10) && !registre.some((c) => clients12.some((r) => r.password_hash.includes(c.password))), `${clients12.length} comptes`);
    controle('12.2 jetons de session : seul le SHA-256 (64 hex minuscules) est stocké, jamais le jeton', sessTous.every((s) => /^[0-9a-f]{64}$/.test(s.token_hash)), `${rows('SELECT id FROM sessions').length} sessions`);
    const dump = JSON.stringify(['customers', 'sessions', 'orders', 'order_items', 'settings', 'throttle', 'availability'].map((t) => rows(`SELECT * FROM ${t}`)));
    const jetonsEnBase = [...jetons].filter((t) => dump.includes(t));
    const mdpEnBase = registre.filter((c) => dump.includes(c.password));
    controle('12.3 balayage complet de la base (7 tables) : aucun des jetons émis, aucun mot de passe client, pas le code patron', jetonsEnBase.length === 0 && mdpEnBase.length === 0 && !dump.includes(OWNER_CODE), `${jetons.size} jetons et ${registre.length} mots de passe cherchés dans ${Math.round(dump.length / 1024)} Ko`);
    for (const r of rows('SELECT password_hash FROM customers')) secretsBase.add(r.password_hash);
    for (const r of rows('SELECT token_hash FROM sessions')) secretsBase.add(r.token_hash);
    for (const r of rows('SELECT payload_hash FROM orders')) secretsBase.add(r.payload_hash);
    const hd = un("SELECT svalue FROM settings WHERE skey = 'login_dummy_hash'");
    if (hd) secretsBase.add(hd.svalue);
    controle('12.4 aucune table ne contient de colonne « password », « token » en clair (colonnes : hash uniquement)', !rows("SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND (column_name ILIKE '%password%' AND column_name <> 'password_hash' OR column_name ILIKE '%token%' AND column_name <> 'token_hash')").length, 'colonnes : password_hash, token_hash');
  } finally {
    journalA = site.journal();
    site.arreter();
  }
}

// =====================================================================================================================
//                                                    PHASE B
// =====================================================================================================================
async function phaseB() {
  console.log('\n######## PHASE B : second site (SUBITO_COOKIE_SECURE=1, horloge pilotée) ########');
  let site;
  for (let essai = 0; essai < 12 && !site; essai++) {
    try { site = await demarrerSite({ statique: false, horloge: T0, env: { SUBITO_COOKIE_SECURE: '1' } }); } catch (e) {
      if (essai === 11) throw e;
      await attendre(400);
    }
  }
  const rows = (sql, ...p) => site.db.prepare(sql).all(...p);
  const un = (sql, ...p) => site.db.prepare(sql).get(...p);
  const hash = (s) => hash256(s);
  try {
    // ---------------------------------------------------------------------------------------------- B1. Secure
    section('B1. Drapeau Secure : posé quand SUBITO_COOKIE_SECURE vaut \'1\', absent, vide, « false » ; seule la valeur \'0\' le retire');
    controle('B1.0 le second site tourne bien avec SUBITO_COOKIE_SECURE = \'1\'', process.env.SUBITO_COOKIE_SECURE === '1', `valeur : ${process.env.SUBITO_COOKIE_SECURE}`);
    const cas = [
      ['patron, sans « rester connecté »', () => appel('POST', 'owner_login.php', { corps: { code: OWNER_CODE, remember: false } }), { nom: 'subito_owner', sameSite: 'Strict', persistant: false }],
      ['patron, avec « rester connecté »', () => appel('POST', 'owner_login.php', { corps: { code: OWNER_CODE, remember: true } }), { nom: 'subito_owner', sameSite: 'Strict', persistant: true }],
      ['client, inscription', () => appel('POST', 'customer_signup.php', { corps: corpsInscription(500 + (++cas.n), { ville: 'Rouvroy', prefixe: 'sec07b' }) }), { nom: 'subito_customer', sameSite: 'Lax', persistant: true }]
    ];
    cas.n = 0;
    for (const [nom, f, att] of cas) {
      const rep = await f();
      const pb = rep.setCookies.length === 1 ? problemesCookie(rep.setCookies[0], { ...att, secure: true, maintenant: T0 }) : [`${rep.setCookies.length} Set-Cookie`];
      controle(`B1.1 ${nom} : Secure + HttpOnly + SameSite=${att.sameSite} + Path=/api/ + ${att.persistant ? 'Max-Age=2592000, Expires = maintenant + 30 j' : 'sans Max-Age'}`, pb.length === 0, pb.join(' ; ') || court(rep.setCookies[0], 150));
    }
    const [c1, c2] = await creerClients(2, { debut: 520, prefixe: 'sec07b' });
    registre.push(c1, c2);
    const conn = await appel('POST', 'customer_login.php', { corps: { email: c1.email, password: c1.password } });
    controle('B1.2 client, connexion : mêmes attributs, Secure présent', conn.setCookies.length === 1 && problemesCookie(conn.setCookies[0], { nom: 'subito_customer', sameSite: 'Lax', secure: true, persistant: true, maintenant: T0 }).length === 0, court(conn.setCookies[0] || '', 150));
    const pS = await patronConnecte(ipSonde(), true);
    const lo1 = await c2.post('customer_logout.php', {});
    const lo2 = await pS.post('owner_logout.php', {});
    controle('B1.3 cookies effacés (customer_logout, owner_logout) : Secure + HttpOnly + même SameSite et même Path que le cookie posé, Max-Age=0',
      problemesCookie(lo1.setCookies[0], { nom: 'subito_customer', sameSite: 'Lax', secure: true, efface: true }).length === 0 && problemesCookie(lo2.setCookies[0], { nom: 'subito_owner', sameSite: 'Strict', secure: true, efface: true }).length === 0,
      `${court(lo1.setCookies[0], 110)} | ${court(lo2.setCookies[0], 110)}`);
    const pS2 = await patronConnecte(ipSonde());
    const rvAll = await pS2.post('owner_sessions_revoke.php', { scope: 'all' });
    controle('B1.4 owner_sessions_revoke {scope:"all"} : cookie effacé avec Secure', rvAll.setCookies.length === 1 && problemesCookie(rvAll.setCookies[0], { nom: 'subito_owner', sameSite: 'Strict', secure: true, efface: true }).length === 0, court(rvAll.setCookies[0] || '', 130));
    // autres valeurs de la variable : seule '0' retire Secure (échec sûr)
    const valeurs = [['non définie', undefined, true], ['chaîne vide', '', true], ['false', 'false', true], ['no', 'no', true], ['00', '00', true], [' 0', ' 0', true], ['1', '1', true], ['0', '0', false]];
    for (const [nom, v, secure] of valeurs) {
      if (v === undefined) delete process.env.SUBITO_COOKIE_SECURE; else process.env.SUBITO_COOKIE_SECURE = v;
      const rep = await appel('POST', 'owner_login.php', { corps: { code: OWNER_CODE, remember: false } });
      const pb = rep.setCookies.length === 1 ? problemesCookie(rep.setCookies[0], { nom: 'subito_owner', sameSite: 'Strict', secure, persistant: false }) : ['pas de Set-Cookie'];
      controle(`B1.5 SUBITO_COOKIE_SECURE ${nom} : Secure ${secure ? 'présent' : 'absent'}${secure ? ' (échec sûr : seule la valeur exacte \'0\' le retire)' : ''}`, pb.length === 0, pb.join(' ; ') || court(rep.setCookies[0], 110));
    }
    process.env.SUBITO_COOKIE_SECURE = '1';

    // ---------------------------------------------------------------------------------------------- B2. durées et expiration
    section('B2. Durée des sessions (horloge serveur pilotée) : 12 h sans « rester connecté », 30 j sinon, expiration exacte, renouvellement glissant');
    const nouveauxClients = await creerClients(8, { debut: 530, prefixe: 'sec07b' });
    registre.push(...nouveauxClients);
    const oc = [];
    for (let i = 0; i < 6; i++) oc.push(await patronConnecte(ipSonde(), false));
    const ol = [];
    for (let i = 0; i < 3; i++) ol.push(await patronConnecte(ipSonde(), true));
    const jeton = (c, n) => c.cookies.get(n);
    const lignes = rows('SELECT created_at, expires_at, user_type, remember FROM sessions WHERE revoked_at IS NULL');
    const ecartDuree = lignes.filter((s) => {
      const d = (Date.parse(s.expires_at) - Date.parse(s.created_at)) / 1000;
      return d !== (s.user_type === 'owner' && Number(s.remember) === 0 ? 43200 : 2592000);
    });
    controle('B2.0 durée de vie en base de toutes les sessions actives : patron sans « rester connecté » = 43 200 s (12 h), toutes les autres = 2 592 000 s (30 j)', ecartDuree.length === 0 && lignes.length > 10, `${lignes.length} sessions contrôlées`);
    const sondeC = (c, extra = {}) => appel('GET', 'customer_orders.php', { cookie: c.cookieHeader(), ...extra });
    const sondeO = (c) => appel('GET', 'owner_me.php', { cookie: c.cookieHeader() });
    const idsExpirees = [];
    const resultats = [];
    const rec = (nom, ok, obs) => { resultats.push({ nom, ok, obs }); };
    const evenements = [
      [T0 + 100, 'client : < 5 min d\'activité → 200, pas de renouvellement du cookie', async () => { const r = await sondeC(nouveauxClients[0]); return [r.status === 200 && r.setCookies.length === 0, `${r.status}, Set-Cookie ${r.setCookies.length}`]; }],
      [T0 + 300, 'client : ≥ 5 min d\'inactivité → 200 et cookie RENOUVELÉ (même jeton, Max-Age 2 592 000, Secure)', async () => { const r = await sondeC(nouveauxClients[1]); const c = r.setCookies[0] && analyserSetCookie(r.setCookies[0]); return [r.status === 200 && r.setCookies.length === 1 && c.valeur === jeton(nouveauxClients[1], 'subito_customer') && problemesCookie(r.setCookies[0], { nom: 'subito_customer', sameSite: 'Lax', secure: true, persistant: true, maintenant: T0 + 300 }).length === 0, `${r.status}, ${court(r.setCookies[0] || '', 100)}`]; }],
      [T0 + 300, 'patron « rester connecté » : renouvellement du cookie après 5 min (Max-Age 2 592 000)', async () => { const r = await sondeO(ol[0]); return [r.status === 200 && r.setCookies.length === 1 && problemesCookie(r.setCookies[0], { nom: 'subito_owner', sameSite: 'Strict', secure: true, persistant: true, maintenant: T0 + 300 }).length === 0, `${r.status}, ${court(r.setCookies[0] || '', 100)}`]; }],
      [T0 + 300, 'patron sans « rester connecté » : pas de cookie renouvelé (cookie de session), session prolongée côté serveur', async () => { const r = await sondeO(oc[0]); return [r.status === 200 && r.setCookies.length === 0, `${r.status}, Set-Cookie ${r.setCookies.length}`]; }],
      [T0 + 43199, 'patron 12 h : à 43 199 s → encore valide (200)', async () => { const r = await sondeO(oc[1]); return [r.status === 200, `${r.status}`]; }],
      [T0 + 43200, 'patron 12 h : à 43 200 s → expirée (401, partout)', async () => { idsExpirees.push(oc[2]); const r = await sondeO(oc[2]); return [estErreur(r, 401, 'unauthorized') && (await ecartsExpire(oc[2], 'subito_owner')).length === 0, `${r.status}`]; }],
      [T0 + 43201, 'patron 12 h : à 43 201 s → expirée (401)', async () => { idsExpirees.push(oc[3]); const r = await sondeO(oc[3]); return [r.status === 401, `${r.status}`]; }],
      [T0 + 40000, 'patron 12 h, usage régulier : actif à 40 000 s (prolongation glissante)', async () => { const r = await sondeO(oc[4]); return [r.status === 200, `${r.status}`]; }],
      [T0 + 80000, 'patron 12 h, usage régulier : encore actif à 80 000 s (> 12 h après la connexion)', async () => { const r = await sondeO(oc[4]); return [r.status === 200, `${r.status}`]; }],
      [T0 + 123200, 'patron 12 h : 12 h exactement après la dernière activité (123 200 s) → expirée', async () => { idsExpirees.push(oc[4]); const r = await sondeO(oc[4]); return [r.status === 401, `${r.status}`]; }],
      [T0 + 2592000 - 1, 'client : à 30 j − 1 s → valide (200)', async () => { const r = await sondeC(nouveauxClients[2]); return [r.status === 200, `${r.status}`]; }],
      [T0 + 2592000 - 1, 'patron « rester connecté » : à 30 j − 1 s → valide (200)', async () => { const r = await sondeO(ol[1]); return [r.status === 200, `${r.status}`]; }],
      [T0 + 2592000, 'client : à 30 j exactement → expirée (401, partout)', async () => { idsExpirees.push(nouveauxClients[3]); const r = await sondeC(nouveauxClients[3]); const m = await appel('GET', 'customer_me.php', { cookie: nouveauxClients[3].cookieHeader() }); return [estErreur(r, 401, 'unauthorized') && m.json.customer === null, `${r.status}, customer_me ${m.json && m.json.customer}`]; }],
      [T0 + 2592000, 'patron « rester connecté » : à 30 j exactement → expirée (401)', async () => { idsExpirees.push(ol[2]); const r = await sondeO(ol[2]); return [r.status === 401, `${r.status}`]; }],
      [T0 + 2592001, 'client : à 30 j + 1 s → expirée (401)', async () => { idsExpirees.push(nouveauxClients[4]); const r = await sondeC(nouveauxClients[4]); return [r.status === 401, `${r.status}`]; }],
      [T0 + 2600000, 'client expiré : se reconnecter avec l\'ancien cookie crée une session neuve (l\'ancienne ne ressuscite pas)', async () => { const k = nouveauxClients[5]; const anc = jeton(k, 'subito_customer'); const l = await k.post('customer_login.php', { email: k.email, password: k.password }); const n = jeton(k, 'subito_customer'); return [l.status === 200 && n !== anc && (await sondeC(k)).status === 200 && (await appel('GET', 'customer_orders.php', { cookie: `subito_customer=${anc}` })).status === 401, `login ${l.status}, ancien jeton ${(await appel('GET', 'customer_orders.php', { cookie: `subito_customer=${anc}` })).status}`]; }]
    ];
    async function ecartsExpire(c, nom) {
      const ec = [];
      for (const [m, route, corps] of [['GET', 'owner_orders.php'], ['GET', 'owner_sessions.php'], ['GET', 'owner_settings.php'], ['POST', 'owner_customers.php', { q: '' }], ['POST', 'owner_sessions_revoke.php', { scope: 'all' }]]) {
        const rep = await appel(m, route, { cookie: `${nom}=${jeton(c, nom)}`, corps });
        if (!estErreur(rep, 401, 'unauthorized')) ec.push(`${route} → ${rep.status}`);
      }
      return ec;
    }
    evenements.sort((a, b) => a[0] - b[0]);
    for (const [t, nom, f] of evenements) {
      site.fixerHeure(t);
      const [ok, obs] = await f();
      rec(nom, ok, `t = T0 + ${t - T0} s : ${obs}`);
    }
    for (const x of resultats) controle(`B2.1 ${x.nom}`, x.ok, x.obs);
    // liste des sessions : les sessions expirées n'y figurent plus
    const frais = await patronConnecte(ipSonde());
    const liste = await frais.get('owner_sessions.php');
    const expireesIds = idsExpirees.filter((c) => c.cookies.get('subito_owner')).map((c) => un('SELECT id FROM sessions WHERE token_hash = ?', hash(c.cookies.get('subito_owner'))).id);
    controle('B2.2 owner_sessions après les expirations : aucune session expirée n\'est listée (seules les sessions encore valides)', liste.status === 200 && expireesIds.length >= 4 && !liste.json.sessions.some((s) => expireesIds.includes(s.id)) && liste.json.sessions.every((s) => Date.parse(s.expires_at) > (T0 + 2600000) * 1000),
      `${liste.json && liste.json.sessions.length} sessions listées, ${expireesIds.length} expirées exclues`);

    // ---------------------------------------------------------------------------------------------- B3. confiance dans l'adresse IP
    section('B3. Adresse IP : les en-têtes de test et de proxy ne servent jamais à contourner la limitation (hors mode test : inertes)');
    site.fixerHeure(T0 + 2700000);
    const purger = () => site.db.prepare("DELETE FROM throttle WHERE bucket LIKE 'owner_login:ip:%'").run();
    purger();
    const entetesForges = (k) => ({ 'x-subito-test-ip': `10.9.9.${k + 1}`, 'X-Forwarded-For': `203.0.113.${k + 1}`, 'X-Real-IP': `198.51.100.${k + 1}`, Forwarded: `for=192.0.2.${k + 1}` });
    // mode test (SUBITO_TEST_MODE=1) : x-subito-test-ip choisit l'adresse (outil de test), les autres en-têtes sont ignorés
    const modeTest = [];
    for (let k = 0; k < 7; k++) modeTest.push(await appel('POST', 'owner_login.php', { headers: { ...entetesForges(k), 'x-subito-test-ip': '10.9.9.1' }, corps: { code: 'faux-' + k } }));
    controle('B3.1 mode test : x-subito-test-ip identique + X-Forwarded-For / X-Real-IP / X-Vercel-Forwarded-For variables → même adresse : 6e tentative verrouillée (429)', modeTest.slice(0, 5).every((x) => x.status === 401) && modeTest.slice(5).every((x) => x.status === 429), modeTest.map((x) => x.status).join('/'));
    purger();
    // hors mode test (production simulée) : x-subito-test-ip est ignoré, l'adresse est celle de la connexion
    process.env.SUBITO_TEST_MODE = '0';
    try {
      const prod = [];
      for (let k = 0; k < 7; k++) prod.push(await appel('POST', 'owner_login.php', { headers: entetesForges(k), corps: { code: 'faux-' + k } }));
      controle('B3.2 hors mode test (SUBITO_TEST_MODE ≠ 1) : x-subito-test-ip (adresse différente à chaque essai), X-Forwarded-For, X-Real-IP, Forwarded sans effet hors Vercel → adresse = celle de la connexion, 6e tentative verrouillée (429)',
        prod.slice(0, 5).every((x) => x.status === 401) && prod.slice(5).every((x) => x.status === 429), prod.map((x) => x.status).join('/'));
      const bucketsProd = rows("SELECT bucket FROM throttle WHERE bucket LIKE 'owner_login:ip:%'").map((b) => b.bucket);
      controle('B3.3 hors mode test : un seul seau de limitation (127.0.0.1), aucun seau créé à partir des adresses forgées', bucketsProd.length === 1 && bucketsProd[0] === 'owner_login:ip:127.0.0.1', bucketsProd.join(', '));
      purger();
      const vercel = [];
      for (let k = 0; k < 7; k++) vercel.push(await appel('POST', 'owner_login.php', { headers: { 'X-Vercel-Forwarded-For': `192.0.2.${k + 1}` }, corps: { code: 'faux-' + k } }));
      info(`Observation : hors Vercel (variable VERCEL absente), l'en-tête x-vercel-forwarded-for est cru tel quel par serveur/core.js adresseClient (7 codes faux avec 7 valeurs différentes → statuts ${vercel.map((x) => x.status).join('/')}). Sans danger sur Vercel, qui pose et réécrit cet en-tête ; non vérifiable ici.`);
    } finally {
      process.env.SUBITO_TEST_MODE = '1';
      purger();
    }
  } finally {
    journalB = site.journal();
    for (const r of rows('SELECT password_hash FROM customers')) secretsBase.add(r.password_hash);
    for (const r of rows('SELECT token_hash FROM sessions')) secretsBase.add(r.token_hash);
    site.arreter();
  }
}

// =====================================================================================================================
//                                           BALAYAGE FINAL ET JOURNAL
// =====================================================================================================================
function balayageFinal() {
  section('13. Balayage de TOUTES les réponses reçues (secretScanText du harnais + motifs propres) et contrôle du journal serveur');
  const jetons = new Set();
  for (const r of reponses) for (const sc of r.setCookies) { const c = analyserSetCookie(sc); if (/^subito_(owner|customer)$/.test(c.nom) && c.valeur !== '') jetons.add(c.valeur); }
  const secrets = [...jetons, ...secretsBase, OWNER_CODE, ...registre.map((c) => c.password), 'Pirate-0000-aA!'];
  const problemes = [];
  let nCorps = 0;
  for (const r of reponses) {
    nCorps++;
    for (const p of problemesFuite(r, secrets)) problemes.push(`${r.method} ${court(r.route, 50)} → ${r.status} : ${p}`);
  }
  controle(`13.1 ${nCorps} réponses balayées : aucun hash de mot de passe, jeton de session, empreinte, trace de pile, SQL, chemin de fichier, numéro de version, en-tête révélateur ni en-tête CORS`, problemes.length === 0, problemes.slice(0, 4).join(' ; ') || `${nCorps} réponses, ${jetons.size} jetons et ${secrets.length - jetons.size} autres secrets recherchés`);
  const nonApp = [];
  const sansEntetes = [];
  const sansOk = [];
  for (const r of reponses) {
    const ct = r.headers.get('content-type') || '';
    if (!ct.startsWith('application/json')) { if (!(r.method === 'HEAD' && r.status === 405) && !(r.status >= 400 && r.status < 500 && r.json === null)) nonApp.push(`${r.method} ${court(r.route, 40)} → ${r.status} ${ct}`); continue; }
    if (ct !== 'application/json; charset=utf-8' || r.headers.get('cache-control') !== 'no-store' || r.headers.get('x-content-type-options') !== 'nosniff') sansEntetes.push(`${r.method} ${court(r.route, 40)} → ${r.status}`);
    if (r.json && typeof r.json.ok !== 'boolean' && !/availability\.php/.test(r.route)) sansOk.push(`${r.method} ${court(r.route, 40)} → ${court(r.text, 40)}`);
  }
  const sansJsonHead = reponses.filter((r) => r.method === 'HEAD' && r.status === 405).every((r) => r.headers.get('cache-control') === 'no-store' && r.headers.get('x-content-type-options') === 'nosniff');
  controle('13.2 chaque réponse de l\'API est du JSON UTF-8 avec Cache-Control: no-store et X-Content-Type-Options: nosniff (y compris erreurs 401, 403, 404, 405, 422, 429)', nonApp.length === 0 && sansEntetes.length === 0 && sansJsonHead, [...nonApp, ...sansEntetes].slice(0, 3).join(' ; ') || `${nCorps} réponses`);
  controle('13.3 chaque réponse JSON porte un booléen « ok » (sauf availability, public par conception)', sansOk.length === 0, sansOk.slice(0, 3).join(' ; ') || 'conforme');
  const cinq = reponses.filter((r) => r.status >= 500);
  controle('13.4 aucune réponse 5xx sur l\'ensemble de la batterie', cinq.length === 0, cinq.slice(0, 4).map((r) => `${r.method} ${court(r.route, 40)} → ${r.status}`).join(' ; ') || `0 sur ${nCorps}`);
  const parStatut = {};
  for (const r of reponses) parStatut[r.status] = (parStatut[r.status] || 0) + 1;
  mesures.statuts = parStatut;
  mesures.reponses = nCorps;
  // journal du serveur
  const sensibles = [...registre.flatMap((c) => [c.email, c.password, c.customer && c.customer.phone]), OWNER_CODE, 'NOTE-', 'Massif', 'rue des Tests', 'Rouvroy', 'Pirate', '@example.test', ...[...jetons], ...secretsBase].filter(Boolean);
  const FORME = /^\[subito-api\] (?:\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z (?:\?|[a-z_]+\.php) \d{3} [a-z_]+|[a-z_?]+\.php 500 server_error \w+(?: code \w+)? ?)$/;
  for (const [nom, journal] of [['A (site HTTP)', journalA], ['B (site Secure=1)', journalB]]) {
    const lignes = journal.split('\n').filter(Boolean);
    const hors = lignes.filter((l) => !FORME.test(l));
    const fuites = lignes.filter((l) => sensibles.some((s) => l.includes(s)));
    const types = {};
    for (const l of lignes) { const m = /\s(\d{3}) ([a-z_]+)$/.exec(l); if (m) types[m[1] + ' ' + m[2]] = (types[m[1] + ' ' + m[2]] || 0) + 1; }
    controle(`13.5 journal du site ${nom} : ${lignes.length} lignes, toutes au format « route, code, horodatage » — aucune donnée de commande ni de client (e-mail, téléphone, nom, adresse, remarque, mot de passe, code patron, jeton)`, hors.length === 0 && fuites.length === 0, `${JSON.stringify(types)}${hors.length ? ' ; hors format : ' + court(hors[0], 100) : ''}${fuites.length ? ' ; FUITE : ' + court(fuites[0], 100) : ''}`);
    controle(`13.6 journal du site ${nom} : aucune ligne « 500 server_error »`, !lignes.some((l) => / 500 server_error/.test(l)), `${compte(lignes, (l) => / 500 server_error/.test(l))} ligne(s) 500`);
  }
  mesures.journal = { A: journalA.split('\n').filter(Boolean).length, B: journalB.split('\n').filter(Boolean).length };
}

// =====================================================================================================================
let code = 0;
try {
  await phaseA();
  await phaseB();
  balayageFinal();
} catch (e) {
  console.log('FAIL exception non prévue du script : ' + court(e && e.stack ? e.stack : e, 900) + (e && e.cause ? ' | cause : ' + court(e.cause.stack || e.cause.message || e.cause.code || e.cause, 500) : ''));
  bilan.fail++;
  bilan.echecs.push('exception du script');
}
clearTimeout(garde);
const duree = (Date.now() - t0) / 1000;
console.log('\n== MESURES ==');
console.log(`INFO requêtes HTTP : ${bilan.requetes} (+ ${bilan.tcp} sockets brutes) en ${duree.toFixed(1)} s ; connexions retentées (ports éphémères de la machine saturés) : ${bilan.reconnexions} ; réponses par statut : ${JSON.stringify(mesures.statuts || {})}`);
console.log(`INFO IDOR : ${JSON.stringify(mesures.idor || {})} ; sans cookie / patron seul : ${mesures.idorAnon || 0} requêtes`);
console.log(`INFO cookies falsifiés : ${JSON.stringify(mesures.cookies || {})} ; jetons émis distincts : ${mesures.jetons || 0}`);
console.log(`INFO origine : ${JSON.stringify(mesures.origine || {})} ; méthodes : ${JSON.stringify(mesures.methodes || {})} ; rafales : ${mesures.rafale || 0} requêtes`);
console.log(`INFO force brute en rafale (nombre de tentatives réellement évaluées sur 40 / 30 envoyées) : ${JSON.stringify(mesures.forceBrute || {})}`);
console.log(`INFO journal serveur : ${JSON.stringify(mesures.journal || {})}`);
console.log(`\nRÉSUMÉ : ${bilan.pass + bilan.fail} contrôles, ${bilan.pass} PASS, ${bilan.fail} FAIL, ${duree.toFixed(1)} s`);
if (bilan.fail) console.log('ÉCHECS : ' + bilan.echecs.join(' || '));
await new Promise((r) => process.stdout.write('', r));
process.exit(bilan.fail ? 1 : 0);
