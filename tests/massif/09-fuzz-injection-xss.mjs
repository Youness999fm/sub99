// Batterie 09 — ENTRÉES MALVEILLANTES : fuzz de tous les POST, injection SQL, XSS (API puis navigateur Chrome réel).
//   node tests/massif/lancer.mjs tests/massif/09-fuzz-injection-xss.mjs --timeout=480
// Phases : A fuzz de tous les POST (JSON invalide, types faux, tailles, Content-Type, méthodes, origines, Unicode, NUL)
//          B injection SQL dans chaque champ texte (tables intactes, données renvoyées telles quelles, recherche client)
//          C clients et commandes XSS créés par l'API (texte stocké = texte saisi)
//          D navigateur : tablette du patron, suivi client, Mon compte, panier réel, redirections ; rien ne s'exécute.
// Tout est local (serveur lancé par ce script, base Postgres en mémoire) ; l'horloge du serveur est figée (pas de dépendance à
// l'heure du jour) ; adresses IP simulées neuves à chaque requête ; mots de passe et codes fabriqués par le script.
import { demarrerSite } from './lib/env.mjs';
import { creerClients, patronConnecte, ClientIP, ipFictive } from './lib/clients.mjs';
import { rng, lignePizza, construireCommande, produits } from './lib/commandes.mjs';
import { avecNavigateur } from './lib/chrome.mjs';
import { controle, detail, info, phase, bilan, visible, dureeS } from './lib/09-verifs.mjs';
import { viser, requete, api, apiBrut, apiGet, problemes, mesures, ipNeuve, stats } from './lib/09-http.mjs';
import {
  nbCar, nettoyerNom, nettoyerRue, nettoyerNote, trimJs, SQLI, SQLI_TEMPS, EMAILS_PIEGES, XSS_CLIENTS, TEXTES_UNICODE, jsonDeTaille, profond, profondObjets,
  JSON_INVALIDES, CORPS_VIDES, JSON_NON_OBJETS, TYPES_MIME_REFUSES, TYPES_MIME_ACCEPTES, CORPS_POLLUTION, ORIGINES_FAUSSES
} from './lib/09-charges.mjs';

const arg = process.argv.find((a) => a.startsWith('--phases='));
const PHASES = (arg ? arg.slice(9) : 'ABCD').toUpperCase();

process.on('uncaughtException', (e) => { controle('exception non rattrapée dans le processus (serveur ou test)', false, String((e && e.stack) || e).slice(0, 500)); });
process.on('unhandledRejection', (e) => { controle('promesse rejetée non rattrapée (serveur ou test)', false, String((e && e.stack) || e).slice(0, 500)); });

// Horloge du serveur figée à l'heure du lancement : le jour de service ne peut pas changer pendant le test (minuit à Paris).
const HORLOGE = Math.floor(Date.now() / 1000);
const site = await demarrerSite({ horloge: HORLOGE });
viser({ port: site.port, origine: site.origine });

// ---------- Aides communes ----------
const TABLES = ['customers', 'sessions', 'orders', 'order_items', 'availability', 'settings', 'throttle'];
const compterTables = () => Object.fromEntries(TABLES.map((t) => [t, Number(site.db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n)]));
const schemaBase = () => JSON.stringify(site.db.prepare(
  "SELECT table_name, column_name, data_type, character_maximum_length, is_nullable FROM information_schema.columns WHERE table_schema = 'public' ORDER BY table_name, ordinal_position").all());
const ligneClient = (email) => site.db.prepare('SELECT * FROM customers WHERE email = ?').get(email);
const copie = (o) => JSON.parse(JSON.stringify(o));
const serialiser = (o) => JSON.stringify(o).replace(/"__INF__"/g, '1e999');
const prototypeIntact = () => ({}).polluted === undefined && !Object.prototype.hasOwnProperty.call(Object.prototype, 'polluted');

function avec(base, chemin, valeur) {
  const c = copie(base);
  let o = c;
  for (let i = 0; i < chemin.length - 1; i++) o = o[chemin[i]];
  o[chemin[chemin.length - 1]] = valeur;
  return c;
}
function sans(base, chemin) {
  const c = copie(base);
  let o = c;
  for (let i = 0; i < chemin.length - 1; i++) o = o[chemin[i]];
  delete o[chemin[chemin.length - 1]];
  return c;
}

/** Exécute des cas un à un ; un seul contrôle résume le lot ; les écarts sont détaillés sous la ligne. */
async function lot(nom, cas, verifier, { max = 6 } = {}) {
  const echecs = [];
  const statuts = new Map();
  for (const c of cas) {
    const r = await c.appel();
    statuts.set(r.status, (statuts.get(r.status) || 0) + 1);
    const pb = problemes(r, c.optionsProblemes);
    const v = verifier ? verifier(r, c) : null;
    if (pb.length || v) echecs.push({ lib: c.lib, status: r.status, texte: [...pb, v].filter(Boolean).join(' ; '), corps: String(r.texte).slice(0, 140) });
  }
  const resume = [...statuts.entries()].sort((a, b) => a[0] - b[0]).map(([s, n]) => `${s}×${n}`).join(' ');
  controle(`${nom} (${cas.length} variantes)`, echecs.length === 0, echecs.length ? `${echecs.length} écart(s) ; statuts ${resume}` : `statuts ${resume}`);
  for (const e of echecs.slice(0, max)) detail(`${e.lib} → ${e.status} : ${e.texte} | ${e.corps}`);
  return { echecs, statuts };
}
const cas = (lib, appel, extra = {}) => ({ lib, appel, ...extra });

const attendu400 = (r) => (r.status === 400 && r.json && r.json.error === 'bad_request' ? null : 'attendu 400 bad_request');
/** 422 validation dont fields contient le champ (ou, avec une expression régulière, un champ qui lui correspond). */
const attenduValidation = (champ) => (r) => {
  const cles = r.json && r.json.fields && typeof r.json.fields === 'object' ? Object.keys(r.json.fields) : [];
  const present = champ instanceof RegExp ? cles.some((k) => champ.test(k)) : cles.includes(champ);
  return r.status === 422 && r.json && r.json.error === 'validation' && present ? null : `attendu 422 validation avec fields.${champ instanceof RegExp ? champ.source : champ} (reçu ${r.status} ${r.json && r.json.error} ${cles.join(',')})`;
};

/** Compare les nombres de lignes avant/après : seules les variations prévues sont admises (clients, commandes, lignes, disponibilités). */
function etatIntact(nom, avant, apres, attendus = {}) {
  const ecarts = [];
  for (const t of ['customers', 'orders', 'order_items', 'availability']) {
    const d = apres[t] - avant[t];
    const prevu = attendus[t] ?? 0;
    if (d !== prevu) ecarts.push(`${t} ${d >= 0 ? '+' : ''}${d} (prévu ${prevu >= 0 ? '+' : ''}${prevu})`);
  }
  controle(`${nom} · rien n'est enregistré à tort`, ecarts.length === 0, ecarts.length ? ecarts.join(', ') : `clients ${avant.customers}→${apres.customers}, commandes ${avant.orders}→${apres.orders}, lignes ${avant.order_items}→${apres.order_items}, dispos ${avant.availability}→${apres.availability}`);
}

let nSeq = 0;
const suffixe = () => (++nSeq).toString(36).padStart(5, '0');
const cleOrdre = (p = 'fz') => `${p}-${suffixe()}-aaaa`;

const PRODUITS = produits();
const REGINA = PRODUITS.pizzas.find((p) => p.name === 'Régina');
function commandeRetrait(opts = {}) {
  const r = rng(opts.graine ?? 77);
  const ligne = lignePizza(r, { produit: REGINA, taille: opts.taille || 'Duo', qty: opts.qty || 1, extras: opts.extras ?? 0, retraits: opts.retraits ?? 0, moitie: opts.moitie ?? false, note: opts.note ?? '' });
  return construireCommande(r, { mode: 'pickup', lignes: [ligne], cle: opts.cle || cleOrdre() }).body;
}
function commandeLivraison(client, opts = {}) {
  const r = rng(opts.graine ?? 78);
  const l1 = lignePizza(r, { produit: REGINA, taille: 'Duo', qty: 1, extras: 0, retraits: 0, moitie: false, note: opts.note ?? '' });
  const l2 = lignePizza(r, { produit: REGINA, taille: 'Duo', qty: 1, extras: 0, retraits: 0, moitie: false, note: '' });
  return construireCommande(r, { mode: 'delivery', ville: client.ville, lignes: [l1, l2], paiements: opts.paiements || ['cash', 'card'], billet: 50, cle: opts.cle || cleOrdre() }).body;
}
const baseInscription = () => ({ first_name: 'Fuzz', last_name: 'Test', email: `fz-${suffixe()}@example.test`, phone: '0612345678', password: 'Fuzz-pass-1234!', street: '1 rue du Test', city: 'Dourges' });

// ---------- Acteurs ----------
let clients = [];
let patron = null;
let clientSansAdresse = null;
const cookieClient = (i) => clients[i % clients.length].cookieHeader();
let rotation = 0;
/** Prochain client du lot (la limitation de création de commande est par client : 20 envois en 10 minutes). */
const clientSuivant = () => clients[(rotation++) % clients.length];

try {
  phase('0 · Mise en place');
  const t0 = Date.now();
  clients = await creerClients(24, { debut: 1, villes: true, concurrence: 6 });
  clientSansAdresse = (await creerClients(1, { debut: 901, villes: false, prefixe: 'noaddr' }))[0];
  patron = await patronConnecte(ipFictive(250250));
  controle('mise en place : 25 clients et le patron connectés', clients.length === 24 && Boolean(clientSansAdresse.customer) && patron.cookies.has('subito_owner'), `${Date.now() - t0} ms ; horloge serveur figée à ${new Date(HORLOGE * 1000).toISOString()}`);
  const schemaInitial = schemaBase();
  const etatInitial = compterTables();
  info(`base au départ : ${JSON.stringify(etatInitial)}`);

  // =====================================================================================================================
  if (PHASES.includes('A')) {
    phase('A · Fuzz de tous les POST');
    const POST_SEULS = ['customer_signup', 'customer_login', 'customer_logout', 'customer_update_address', 'customer_update_profile', 'order_create',
      'owner_login', 'owner_logout', 'owner_order_decide', 'owner_customers', 'owner_sessions_revoke'];
    const POST_ET_GET = ['owner_settings', 'owner_availability'];
    const ROUTES_POST = [...POST_SEULS, ...POST_ET_GET];
    const avantA = compterTables();

    // ---- A1 : batterie générique (anonyme) sur les 13 routes qui acceptent un POST ----
    for (const route of ROUTES_POST) {
      const P = `A1 · ${route}`;
      const brut = (corps, opts) => () => apiBrut(route, corps, opts);
      await lot(`${P} · JSON invalide`, JSON_INVALIDES.map((b) => cas(b, brut(Buffer.from(b, 'utf8')))), attendu400);
      await lot(`${P} · corps vide ou blanc`, CORPS_VIDES.map((b) => cas(b, brut(Buffer.from(b, 'utf8')))), attendu400);
      await lot(`${P} · JSON qui n'est pas un objet`, JSON_NON_OBJETS.map((b) => cas(b, brut(Buffer.from(b, 'utf8')))), attendu400);
      const imbrications = [];
      for (const n of [31, 32, 33, 40, 200, 20000]) imbrications.push(cas(`tableaux ×${n}`, brut(profond(n)), { refuse: n >= 32 }));
      for (const n of [30, 31, 32, 40, 3000]) imbrications.push(cas(`objets ×${n}`, brut(profondObjets(n)), { refuse: n >= 32 }));
      await lot(`${P} · imbrication (profondeur 31 admise, 32 et plus refusée)`, imbrications, (r, c) => (c.refuse ? attendu400(r) : null));
      const tailles = [
        cas('64 Ko exactement (65 536 octets)', brut(jsonDeTaille(65536)), { admis: true }),
        cas('65 537 octets', brut(jsonDeTaille(65537))),
        cas('65 Ko (66 560 octets)', brut(jsonDeTaille(66560))),
        cas('1 Mo', brut(jsonDeTaille(1048576))),
        cas('70 Ko en morceaux (sans Content-Length)', () => requete({ chemin: `/api/${route}.php`, morceaux: (() => { const b = Buffer.from(jsonDeTaille(70000)); return [b.subarray(0, 25000), b.subarray(25000, 50000), b.subarray(50000)]; })() })),
        cas('200 Ko en morceaux (sans Content-Length)', () => requete({ chemin: `/api/${route}.php`, morceaux: (() => { const b = Buffer.from(jsonDeTaille(200000)); const m = []; for (let i = 0; i < b.length; i += 16384) m.push(b.subarray(i, i + 16384)); return m; })() }))
      ];
      await lot(`${P} · tailles (64 Ko admis, 65 Ko et plus : 413)`, tailles, (r, c) => (c.admis
        ? (r.status === 413 ? 'refusé à tort (413) à 64 Ko exactement' : null)
        : (r.status === 413 && r.json && r.json.error === 'payload_too_large' ? null : 'attendu 413 payload_too_large')));
      const mimes = [
        ...TYPES_MIME_REFUSES.map((m) => cas('Content-Type ' + (m === null ? '(absent)' : `« ${m} »`), () => requete({ chemin: `/api/${route}.php`, corps: '{}', entetes: { 'Content-Type': m } }), { refuse: true })),
        ...TYPES_MIME_ACCEPTES.map((m) => cas(`Content-Type « ${m} » (accepté)`, () => requete({ chemin: `/api/${route}.php`, corps: '{}', entetes: { 'Content-Type': m } }), { refuse: false }))
      ];
      await lot(`${P} · Content-Type absent ou faux : 415 ; JSON valide admis`, mimes, (r, c) => (c.refuse
        ? (r.status === 415 && r.json && r.json.error === 'unsupported_media_type' ? null : 'attendu 415 unsupported_media_type')
        : (r.status === 415 ? 'refusé à tort (415)' : null)));
      const autorisees = POST_ET_GET.includes(route) ? ['GET', 'POST'] : ['POST'];
      const methodes = ['GET', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD', 'PROPFIND'].filter((m) => !autorisees.includes(m));
      await lot(`${P} · autres méthodes HTTP : 405 et en-tête Allow`, methodes.map((m) => cas(m, () => requete({ methode: m, chemin: `/api/${route}.php`, corps: m === 'PUT' || m === 'PATCH' || m === 'PROPFIND' ? '{}' : undefined }),
        { optionsProblemes: { json: m !== 'HEAD' } })),
      (r) => (r.status === 405 && autorisees.every((a) => String(r.entetes.allow || '').includes(a)) ? null : `attendu 405 avec Allow ${autorisees.join(', ')} (reçu « ${r.entetes.allow} »)`));
      await lot(`${P} · Origin étranger : 403 bad_origin`, ORIGINES_FAUSSES(site.origine).map((o) => cas(`Origin « ${o} »`, () => requete({ chemin: `/api/${route}.php`, corps: '{}', origine: o }))),
        (r) => (r.status === 403 && r.json && r.json.error === 'bad_origin' ? null : 'attendu 403 bad_origin'));
      await lot(`${P} · clés dangereuses (__proto__, constructor…)`, CORPS_POLLUTION.map((b) => cas(b, brut(b))));
    }
    controle('A1 · prototype d\'Object intact après les clés __proto__ / constructor', prototypeIntact(), `({}).polluted = ${({}).polluted}`);

    // Routes qui n'acceptent que GET : un POST doit répondre 405.
    const GET_SEULS = ['customer_me', 'customer_orders', 'order_status', 'owner_me', 'owner_orders', 'owner_sessions', 'availability'];
    await lot('A1 · routes en lecture seule : POST refusé (405, Allow: GET)', GET_SEULS.map((r) => cas(r, () => api(r, {}))),
      (r) => (r.status === 405 && /GET/.test(String(r.entetes.allow || '')) ? null : 'attendu 405 Allow GET'));

    // Chemins inconnus ou piégés : toujours une réponse JSON 404, jamais une erreur.
    const CHEMINS_404 = ['/api/', '/api/nope', '/api/customer_login.php.php', '/api/CUSTOMER_LOGIN', '/api/customer_login%00', '/api/..%2fserveur%2fcore', '/api/customer_login.php%2f..',
      '/api/customer_login.php;x', '/api/' + 'a'.repeat(3000), '/api/%2e%2e/%2e%2e/etc/passwd', '/api/%00', '/api/%', '/api/%zz', '/api/..\\..\\x', '/api/customer_login.php/extra',
      '/api/customer-login', '/api/customer_login.json', "/api/'%3B%20DROP%20TABLE%20orders%3B--", '/api/customer_login.php%0d%0aSet-Cookie:x=1', '/api/%E2%80%AEcustomer_login', '/api/customer_login%E2%80%8B'];
    await lot('A1 · chemins inconnus ou piégés : 404 JSON', CHEMINS_404.map((c) => cas(c.slice(0, 50), () => requete({ methode: 'GET', chemin: c }))),
      (r) => (r.status === 404 && r.json && r.json.error === 'not_found' ? null : 'attendu 404 not_found'));
    await lot('A1 · chemins qui se résolvent vers une route : jamais d\'erreur', ['/api/x/../customer_login', '/api/customer_login/', '/api/customer_login.php?' + 'q=1&'.repeat(1500), '/api/./customer_login.php'].map((c) => cas(c.slice(0, 50), () => requete({ chemin: c, corps: '{}' }))), null);

    // Cookies de session piégés : un visiteur, jamais une erreur.
    const COOKIES = ["subito_customer=' OR 1=1--", 'subito_customer=' + 'A'.repeat(43), '__proto__=x; subito_customer=' + 'A'.repeat(43), 'subito_customer=' + 'A'.repeat(8000),
      'a=b; ; ;=; =x; subito_customer', 'subito_owner=' + 'B'.repeat(43), 'subito_customer=' + '%00'.repeat(20), 'subito_customer=\'; DROP TABLE sessions;--', 'constructor=1; toString=2; subito_customer=' + 'C'.repeat(43)];
    await lot('A1 · cookies de session piégés (customer_me : visiteur)', COOKIES.map((c) => cas(c.slice(0, 40), () => requete({ methode: 'GET', chemin: '/api/customer_me.php', cookie: c }))),
      (r) => (r.status === 200 && r.json && r.json.customer === null ? null : 'attendu 200 customer:null'));
    await lot('A1 · cookies de session piégés (owner_me : 401)', COOKIES.map((c) => cas(c.slice(0, 40), () => requete({ methode: 'GET', chemin: '/api/owner_me.php', cookie: c }))),
      (r) => (r.status === 401 ? null : 'attendu 401'));

    // Contrôle d'accès croisé avec un corps valide mais vide.
    const cookieClientSeul = clients[0].cookieHeader();
    const cookiePatronSeul = patron.cookieHeader();
    const ROUTES_CLIENT = ['customer_update_address', 'customer_update_profile', 'order_create'];
    const ROUTES_PATRON = ['owner_logout', 'owner_order_decide', 'owner_settings', 'owner_availability', 'owner_customers', 'owner_sessions_revoke'];
    await lot('A1 · sans session : 401 sur les routes réservées', [...ROUTES_CLIENT, ...ROUTES_PATRON].map((r) => cas(r, () => api(r, {}))), (r) => (r.status === 401 && r.json.error === 'unauthorized' ? null : 'attendu 401 unauthorized'));
    await lot('A1 · session du patron sur une route client : 403', ROUTES_CLIENT.map((r) => cas(r, () => api(r, {}, { cookie: cookiePatronSeul }))), (r) => (r.status === 403 && r.json.error === 'forbidden' ? null : 'attendu 403 forbidden'));
    await lot('A1 · session client sur une route patron : 403', ROUTES_PATRON.map((r) => cas(r, () => api(r, {}, { cookie: cookieClientSeul }))), (r) => (r.status === 403 && r.json.error === 'forbidden' ? null : 'attendu 403 forbidden'));

    // ---- A2 : types faux champ par champ (session valide, corps de référence + une seule valeur fausse) ----
    const TEXTE_OBLIGATOIRE = [null, true, false, 0, -1, 1.5, 1e21, '__INF__', [], {}, [1], ['a'], { a: 1 }, { a: { b: { c: 1 } } }, '', ' ', '\t\n ', 'x'.repeat(10000), '🍕'.repeat(3000),
      'x'.repeat(61), '🍕'.repeat(61), '\u202e\u200b', '\u0000', '\u0000\u0000 \u0001'];
    const TEXTE_FACULTATIF = [true, false, 0, -1, 1.5, '__INF__', [], {}, [1], ['a'], { a: 1 }, 'x'.repeat(151), 'x'.repeat(10000), '🍕'.repeat(151), '𝒳'.repeat(151), '🍕'.repeat(3000)];
    const EMAILS_FAUX = [null, true, 0, [], {}, '', ' ', 'plain', 'a@b', '@x.test', 'a@.test', 'a..b@x.test', '.a@x.test', 'a.@x.test', 'a b@x.test', 'a@x .test', '<a@x.test>', '"quoted"@x.test', 'é@x.test',
      'a@é.test', 'a@x_y.test', 'a@-x.test', 'a@x-.test', 'a'.repeat(200) + '@x.test', 'a@' + 'b'.repeat(64) + '.test', 'a@x.test,b@x.test', 'a@x.test;b@x.test', 'a(b)@x.test', 'a\\@x.test', 'a@x.test\u0000', '\u0000',
      'x'.repeat(10000), '🍕@x.test', "a@x.test'; DROP TABLE customers;--", '<script>@x.test', 'a@x.test<b>'];
    const TELEPHONES_FAUX = [null, true, 0, [], {}, '', ' ', '1234567', '0612345678a', '06 12 34 56 7', '+'.repeat(9), '0'.repeat(21), '((((((((()))))))))', '0612345678; DROP TABLE x', 'abcdefgh', '٠٦١٢٣٤٥٦٧٨',
      '０６１２３４５６７８', '06-12-34-56-78\u0000', 'x'.repeat(10000), "0612345678' OR '1'='1", '<b>0612345678</b>'];
    const MOTS_DE_PASSE_FAUX = [null, true, 0, [], {}, '', 'abc', 'x'.repeat(7), 'x'.repeat(201), '🍕'.repeat(51), 'é'.repeat(101), ['abcdefgh'], { a: 'abcdefgh' }, 'x'.repeat(10000)];
    const VILLES_FAUSSES = [true, false, 0, -1, 1.5, [], {}, [1], ['a'], { a: 1 }, 'Paris', 'dourges', 'DOURGES', 'Dourges ,', 'Hénin Beaumont', "Dourges'; DROP TABLE orders;--", 'Dourges\u0000', 'x'.repeat(10000),
      'Hénin-Beaumont\u202e', '__proto__', 'constructor', 'toString', 'hasOwnProperty', '<script>window.__pwn=1</script>'];

    const mutations = (base, table, extraAttendu = {}) => {
      const sortie = [];
      for (const [champ, valeurs] of table) {
        for (const v of valeurs) {
          const lib = `${champ} = ${typeof v === 'string' && v.length > 40 ? visible(v.slice(0, 20)) + `…(${nbCar(v)} car.)` : visible(v, 40)}`;
          sortie.push({ lib, corps: serialiser(avec(base(), [champ], v)), champ, valeur: v });
        }
      }
      return sortie;
    };

    // customer_signup
    {
      const avant = compterTables();
      const tout = mutations(baseInscription, [['first_name', TEXTE_OBLIGATOIRE], ['last_name', TEXTE_OBLIGATOIRE], ['email', EMAILS_FAUX], ['phone', TELEPHONES_FAUX], ['password', MOTS_DE_PASSE_FAUX],
        ['street', TEXTE_FACULTATIF], ['city', VILLES_FAUSSES]]);
      // Le NUL dans la rue est traité à part (contrôles A3 : il révèle une erreur 500).
      const retenus = tout.filter((c) => !(c.champ === 'street' && /\u0000/.test(String(c.valeur))));
      let n201 = 0;
      await lot('A2 · customer_signup · types et valeurs fausses, un champ à la fois', retenus.map((c) => cas(c.lib, async () => { const r = await apiBrut('customer_signup', c.corps); if (r.status === 201) n201++; return r; }, { champ: c.champ })),
        (r, c) => attenduValidation(c.champ)(r));
      etatIntact('A2 · customer_signup', avant, compterTables(), { customers: n201 });
      const manquants = ['first_name', 'last_name', 'email', 'phone', 'password'].map((k) => cas(`${k} absent`, () => apiBrut('customer_signup', serialiser(sans(baseInscription(), [k]))), { champ: k }));
      await lot('A2 · customer_signup · champ obligatoire absent', manquants, (r, c) => attenduValidation(c.champ)(r));
    }

    // customer_login : jamais de 422, toujours 401, aucun cookie
    {
      const e = clients[3];
      const faux = [];
      for (const v of [null, true, false, 0, 1.5, [], {}, ['x'], { a: 1 }, '', ' ', 'x'.repeat(10000), '🍕'.repeat(2000), '\u0000x', "' OR 1=1--", '<script>window.__pwn=1</script>', e.email.toUpperCase() + 'x']) {
        faux.push(cas(`email = ${visible(v, 30)}`, () => api('customer_login', { email: v, password: e.password })));
        faux.push(cas(`mot de passe = ${visible(v, 30)}`, () => api('customer_login', { email: e.email, password: v })));
      }
      faux.push(cas('corps sans champ', () => api('customer_login', {})));
      const retenus = faux.filter((c) => !/\\u0000x/.test(c.lib) || /mot de passe/.test(c.lib));
      await lot('A2 · customer_login · valeurs fausses : 401 invalid_credentials, aucun cookie', retenus,
        (r) => ((r.status === 401 && r.json && r.json.error === 'invalid_credentials' && !r.entetes['set-cookie']) ? null : 'attendu 401 invalid_credentials sans cookie'));
    }

    // customer_update_profile / customer_update_address (session client)
    {
      const c = clients[5];
      const avant = compterTables();
      const baseProfil = () => ({ first_name: 'Fz', last_name: 'Tz', phone: '0612345678' });
      const tp = mutations(baseProfil, [['first_name', TEXTE_OBLIGATOIRE], ['last_name', TEXTE_OBLIGATOIRE], ['phone', TELEPHONES_FAUX]]);
      await lot('A2 · customer_update_profile · types et valeurs fausses, un champ à la fois', tp.map((m) => cas(m.lib, () => apiBrut('customer_update_profile', m.corps, { cookie: c.cookieHeader() }), { champ: m.champ })),
        (r, k) => attenduValidation(k.champ)(r));
      const baseAdresse = () => ({ street: '2 rue du Test', city: 'Dourges' });
      const ta = mutations(baseAdresse, [['street', TEXTE_FACULTATIF.filter((v) => !/\u0000/.test(String(v)))], ['city', VILLES_FAUSSES]]);
      await lot('A2 · customer_update_address · types et valeurs fausses, un champ à la fois', ta.map((m) => cas(m.lib, () => apiBrut('customer_update_address', m.corps, { cookie: c.cookieHeader() }), { champ: m.champ })),
        (r, k) => attenduValidation(k.champ)(r));
      etatIntact('A2 · customer_update_profile / address', avant, compterTables());
      const apres = ligneClient(c.email);
      controle('A2 · le compte n\'a pas changé après toutes les mises à jour refusées', apres.first_name === c.customer.first_name && apres.last_name === c.customer.last_name && apres.phone === c.customer.phone && apres.street === c.customer.street && apres.city === c.customer.city,
        `${apres.first_name} ${apres.last_name} · ${apres.phone} · ${apres.street}, ${apres.city}`);
      // Champs interdits : ignorés (affectation de masse).
      const r = await api('customer_update_profile', { first_name: 'Masse', last_name: 'Ignoree', phone: '0612345678', email: 'pirate@example.test', password: 'Pirate-0000!', id: 99999, created_at: '2000-01-01T00:00:00Z' }, { cookie: c.cookieHeader() });
      const ligne = ligneClient(c.email);
      controle('A2 · customer_update_profile ignore e-mail, mot de passe, id et dates envoyés en plus', r.status === 200 && ligne.email === c.email && Number(ligne.id) === Number(c.customer.id) && ligne.created_at !== '2000-01-01T00:00:00Z', `statut ${r.status} ; e-mail ${ligne.email} ; id ${ligne.id}`);
      const connexion = await api('customer_login', { email: c.email, password: c.password });
      controle('A2 · le mot de passe d\'origine fonctionne toujours (pas d\'affectation de masse)', connexion.status === 200, `statut ${connexion.status}`);
      await api('customer_update_profile', { first_name: c.customer.first_name, last_name: c.customer.last_name, phone: c.customer.phone }, { cookie: c.cookieHeader() });
    }

    // order_create : une valeur fausse à la fois sur un corps de référence
    {
      const c = clients[7];
      const cookie = () => c.cookieHeader();
      const avant = compterTables();
      const B = () => commandeRetrait({ cle: cleOrdre() });
      const BD = () => commandeLivraison(c, { cle: cleOrdre() });
      const tout = [];
      const ajouter = (base, chemin, valeurs, champ, mode = 'validation') => {
        for (const v of valeurs) {
          tout.push({ lib: `${chemin.join('.')} = ${typeof v === 'string' && v.length > 40 ? visible(v.slice(0, 20)) + `…(${nbCar(v)} car.)` : visible(v, 40)}`, corps: serialiser(avec(base(), chemin, v)), champ, mode });
        }
      };
      ajouter(B, ['idempotency_key'], [null, 123, true, [], {}, '', 'short', 'x'.repeat(65), 'a'.repeat(10000), 'bad key with spaces', "key'; DROP TABLE orders;--", 'éééééééé', 'a\u0000bcdefgh', '--------\n', 'abcdefg\u00a0', '<script>1</script>'], 'idempotency_key');
      ajouter(B, ['mode'], [null, 1, true, [], {}, 'PICKUP', 'Pickup', ' pickup', 'delivery ', 'pickup\u0000', 'x'.repeat(10000), 'both', 'à emporter'], 'mode');
      ajouter(B, ['payment_methods'], [null, 'card', 1, true, { a: 1 }], 'payment_methods');
      ajouter(BD, ['payment_methods'], [null, 'card', 1, true, { a: 1 }, [1], [null], [['card']], ['CARD'], ['card '], ['x'], [], {}, ['card', 'cash', 'bitcoin'], ["card'; DROP TABLE orders;--"], ['\u0000']], 'payment_methods');
      ajouter(BD, ['cash_change_for'], [null, 5, 15, 101, -10, '20', 20.5, true, [20], {}, 1e21], 'cash_change_for');
      ajouter(B, ['items'], [null, 'x', 1, true, { a: 1 }], 'items');
      ajouter(B, ['delivery_fee_cents'], [null, -1, 1.5, '0', true, [], {}, 10000001, 1e21], 'delivery_fee_cents');
      ajouter(B, ['total_cents'], [null, -1, 1.5, '0', true, [], {}, 10000001, 1e21], 'total_cents');
      const L = (f) => `items[0].${f}`;
      ajouter(B, ['items', 0, 'name'], [null, 1, true, [], {}, '', ' ', 'x'.repeat(121), 'x'.repeat(10000), '\u0000', '🍕'.repeat(121)], L('name'));
      ajouter(B, ['items', 0, 'variant'], [1, true, [], {}, 'solo', 'SOLO', 'Solo ', 'XL', 'Duo\u0000', 'x'.repeat(100), "Duo'; DROP TABLE orders;--"], L('variant'));
      ajouter(B, ['items', 0, 'qty'], [null, 0, -1, 21, 1.5, '1', true, [], {}, 1e21], L('qty'));
      ajouter(B, ['items', 0, 'unit_price_cents'], [null, 0, -1, 50001, 1.5, '1600', true, [], {}, 1e21], L('unit_price_cents'));
      ajouter(B, ['items', 0, 'removed'], ['x', 1, true, { a: 1 }, [1], [null], [[]], ['a'.repeat(61)], Array.from({ length: 21 }, () => 'a')], L('removed'));
      ajouter(B, ['items', 0, 'extras'], ['x', 1, true, { a: 1 }, [1], [null], [{}], [{ name: 1 }], [{ name: 'x' }], Array.from({ length: 21 }, () => ({ name: 'x', price_cents: 0, qty: 1 })),
        [{ name: 'Champignons', price_cents: 100, qty: 2 }], [{ name: 'Champignons', price_cents: -1, qty: 1 }], [{ name: 'Champignons', price_cents: 100, qty: 1 }, { name: 'champignons*', price_cents: 100, qty: 1 }]], /^items\[0\]\.extras/);
      ajouter(B, ['items', 0, 'half'], ['x', 1, true, [], [1], {}, { flavor1: 1 }, { flavor1: 'a' }, { flavor1: 'a', flavor2: 1 }, { flavor1: 'x'.repeat(121), flavor2: 'y' }], L('half'));
      ajouter(B, ['items', 0, 'note'], [1, true, [], {}, 'x'.repeat(301), 'x'.repeat(10000), 'a\u0000b', '🍕'.repeat(301)], L('note'));
      // items : liste invalide ou lignes invalides (le champ fautif est items ou items[0]…)
      const itemsFaux = [[[]], [null], [1], ['x'], [true], [[1]], Array.from({ length: 41 }, () => copie(B().items[0])), Array.from({ length: 4 }, () => ({ ...copie(B().items[0]), qty: 16 }))];
      for (const v of itemsFaux) tout.push({ lib: `items = ${visible(v, 50)}`, corps: serialiser(avec(B(), ['items'], v)), champ: /^items/, mode: 'validation' });
      for (const k of ['idempotency_key', 'mode', 'payment_methods', 'items', 'delivery_fee_cents', 'total_cents']) tout.push({ lib: `${k} absent`, corps: serialiser(sans(B(), [k])), champ: k, mode: 'validation' });

      const verifier = (r, k) => attenduValidation(k.champ)(r);
      let nOrdresCrees = 0;
      await lot('A2 · order_create · types et valeurs fausses, un champ à la fois', tout.map((k) => cas(k.lib, async () => {
        const r = await apiBrut('order_create', k.corps, { cookie: cookie() });
        if (r.status === 201) nOrdresCrees++;
        return r;
      }, { champ: k.champ, mode: k.mode })), verifier, { max: 10 });
      // items vide : code empty_cart
      const rVide = await apiBrut('order_create', serialiser(avec(B(), ['items'], [])), { cookie: cookie() });
      controle('A2 · order_create · panier vide : 422 empty_cart', rVide.status === 422 && rVide.json.error === 'empty_cart', `${rVide.status} ${rVide.json && rVide.json.error}`);
      etatIntact('A2 · order_create', avant, compterTables(), { orders: nOrdresCrees, order_items: nOrdresCrees });
      // Validations sémantiques (corps de forme valide)
      const sem = [
        cas('total faux de 1 centime', () => apiBrut('order_create', serialiser({ ...B(), total_cents: B().total_cents + 1 }), { cookie: cookie() }), { code: 'price_mismatch', statut: 409 }),
        cas('frais de livraison en retrait', () => apiBrut('order_create', serialiser({ ...B(), delivery_fee_cents: 550 }), { cookie: cookie() }), { code: 'price_mismatch', statut: 409 }),
        cas('prix unitaire faux de 1 centime', () => { const b = B(); b.items[0].unit_price_cents += 1; return apiBrut('order_create', serialiser(b), { cookie: cookie() }); }, { code: 'price_mismatch_line', statut: 422 }),
        cas('article hors carte', () => { const b = B(); b.items[0].name = 'Pizza inventée'; return apiBrut('order_create', serialiser(b), { cookie: cookie() }); }, { code: 'unknown_item', statut: 422 }),
        cas('livraison sans adresse', () => apiBrut('order_create', serialiser(commandeLivraison({ ville: 'Dourges' })), { cookie: clientSansAdresse.cookieHeader() }), { code: 'address_required', statut: 422 })
      ];
      await lot('A2 · order_create · erreurs métier : code et statut attendus', sem, (r, k) => (r.status === k.statut && r.json && r.json.error === k.code ? null : `attendu ${k.statut} ${k.code}`));
      // Rejeu : même clé et même corps = 200 replayed ; même clé et corps différent = 409.
      const rejeu = B();
      const r1 = await apiBrut('order_create', serialiser(rejeu), { cookie: clients[8].cookieHeader() });
      const r2 = await apiBrut('order_create', serialiser(rejeu), { cookie: clients[8].cookieHeader() });
      const modif = { ...rejeu, items: [{ ...rejeu.items[0], qty: 2 }], total_cents: rejeu.total_cents * 2 };
      const r3 = await apiBrut('order_create', serialiser(modif), { cookie: clients[8].cookieHeader() });
      controle('A2 · order_create · rejeu identique : 200 replayed (une seule commande) ; corps différent : 409 idempotency_conflict',
        r1.status === 201 && r2.status === 200 && r2.json.replayed === true && r2.json.order.id === r1.json.order.id && r3.status === 409 && r3.json.error === 'idempotency_conflict', `${r1.status} / ${r2.status} / ${r3.status}`);
    }

    // owner_login, owner_settings, owner_availability, owner_customers, owner_order_decide
    {
      const ch = [];
      for (const v of [null, true, false, 0, 1.5, [], {}, ['x'], { a: 1 }, '', ' ', 'x'.repeat(10000), '🍕'.repeat(2000), '\u0000', 'x'.repeat(4097), "' OR 1=1--", '<script>window.__pwn=1</script>', site.codePatron + ' ', site.codePatron.toUpperCase()]) {
        ch.push(cas(`code = ${visible(v, 30)}`, () => api('owner_login', { code: v, remember: true })));
      }
      ch.push(cas('code absent', () => api('owner_login', { remember: true })));
      await lot('A2 · owner_login · codes faux : 401 invalid_credentials, aucun cookie', ch, (r) => ((r.status === 401 && r.json && r.json.error === 'invalid_credentials' && !r.entetes['set-cookie']) ? null : 'attendu 401 sans cookie'));
      const rem = [];
      for (const v of ['true', 1, 'yes', [], {}, null]) rem.push(cas(`remember = ${visible(v, 20)}`, () => api('owner_login', { code: site.codePatron, remember: v })));
      await lot('A2 · owner_login · remember non booléen : connexion sans « rester connecté »', rem, (r) => (r.status === 200 && r.json.owner && r.json.owner.remember === false ? null : 'attendu 200 remember:false'));

      const cookie = patron.cookieHeader();
      const avant = compterTables();
      const mdelai = [null, '30', 25, 0, -20, 20.5, true, [], {}, '__INF__', 1e21, [30], { a: 30 }, 70, 19];
      await lot('A2 · owner_settings · délais faux : 422', mdelai.map((v) => cas(`default_delay_minutes = ${visible(v, 20)}`, () => apiBrut('owner_settings', serialiser({ default_delay_minutes: v }), { cookie }))), attenduValidation('default_delay_minutes'));
      const bons = [20, 30, 40, 50, 60].map((d) => cas(`délai ${d}`, () => api('owner_settings', { default_delay_minutes: d }, { cookie }), { d }));
      await lot('A2 · owner_settings · délais valides : 200 et valeur renvoyée', bons, (r, k) => (r.status === 200 && r.json.default_delay_minutes === k.d ? null : `attendu 200 ${k.d}`));
      await api('owner_settings', { default_delay_minutes: 30 }, { cookie });

      const baseDispo = () => ({ kind: 'ingredient', status: 'out_today', name: 'zz-fuzz-' + suffixe() });
      const dispoFausse = [
        ...[null, true, 0, [], {}, 'Pizza', 'PIZZA', 'ingredient ', '', 'x'.repeat(10000), "pizza'; DROP TABLE availability;--"].map((v) => ({ lib: `kind = ${visible(v, 30)}`, corps: serialiser(avec(baseDispo(), ['kind'], v)), champ: 'kind' })),
        ...[null, true, 0, [], {}, 'Available', 'out', 'out_now', '', 'out_today ', ['available'], "available'; DROP TABLE availability;--"].map((v) => ({ lib: `status = ${visible(v, 30)}`, corps: serialiser(avec(baseDispo(), ['status'], v)), champ: 'status' })),
        ...[null, true, 0, [], {}, '', ' ', '\t\n', 'x'.repeat(121), 'x'.repeat(10000), '🍕'.repeat(121)].map((v) => ({ lib: `name = ${visible(typeof v === 'string' ? v.slice(0, 20) : v, 30)}`, corps: serialiser(avec(baseDispo(), ['name'], v)), champ: 'name' }))
      ];
      await lot('A2 · owner_availability · types et valeurs fausses, un champ à la fois', dispoFausse.map((k) => cas(k.lib, () => apiBrut('owner_availability', k.corps, { cookie }), { champ: k.champ })), (r, k) => attenduValidation(k.champ)(r));
      const bonsNoms = ['zz-a', 'q'.repeat(120), '🍕'.repeat(120), "zz L'ail & l'oignon", 'zz <b>gras</b>', 'zz a\u202eb'];
      const dispoEcarts = [];
      for (const nom of bonsNoms) {
        const out = await api('owner_availability', { kind: 'ingredient', status: 'out_manual', name: nom }, { cookie });
        const present = out.json && Array.isArray(out.json.out) && out.json.out.some((e) => e.kind === 'ingredient' && e.name === nom);
        const rem = await api('owner_availability', { kind: 'ingredient', status: 'available', name: nom }, { cookie });
        const reste = rem.json && Array.isArray(rem.json.out) && rem.json.out.some((e) => e.name === nom);
        if (out.status !== 200 || !present || rem.status !== 200 || reste) dispoEcarts.push(`${visible(nom, 24)} : rupture ${out.status}/${present}, remise ${rem.status}/${reste}`);
      }
      controle(`A2 · owner_availability · noms valides (jusqu'à 120 caractères, emoji, HTML, U+202E) : rupture renvoyée telle quelle puis retirée (${bonsNoms.length})`, dispoEcarts.length === 0, dispoEcarts.join(' | ') || 'aller-retour exact');
      etatIntact('A2 · owner_settings / owner_availability', avant, compterTables());

      const dq = [null, true, 0, [], {}, ['a'], { a: 1 }, 'x'.repeat(81), 'x'.repeat(10000), '🍕'.repeat(81)];
      await lot('A2 · owner_customers · q faux : 422', dq.map((v) => cas(`q = ${visible(typeof v === 'string' ? v.slice(0, 20) : v, 30)}`, () => apiBrut('owner_customers', serialiser({ code: site.codeSuperieur, q: v }), { cookie }))),
        (r, k) => (/^q = null/.test(k.lib) ? (r.status === 200 ? null : 'attendu 200 (q:null = pas de recherche)') : attenduValidation('q')(r)));
      await lot('A2 · owner_customers · q valides : 200', [cas('q absent', () => api('owner_customers', { code: site.codeSuperieur }, { cookie })), cas('q = 80 caractères', () => api('owner_customers', { code: site.codeSuperieur, q: 'x'.repeat(80) }, { cookie })),
        cas('q = 80 emoji', () => api('owner_customers', { code: site.codeSuperieur, q: '🍕'.repeat(80) }, { cookie })), cas('q = espaces', () => api('owner_customers', { code: site.codeSuperieur, q: '     ' }, { cookie }))], (r) => (r.status === 200 && Array.isArray(r.json.customers) ? null : 'attendu 200'));

      // owner_order_decide : une commande « new » dédiée
      const cmd = await apiBrut('order_create', serialiser(commandeRetrait({ cle: cleOrdre() })), { cookie: clients[9].cookieHeader() });
      const idCmd = cmd.json.order.id;
      const baseDec = () => ({ id: idCmd, action: 'accept', delay_minutes: 30 });
      const decFausse = [
        ...[null, '1', 0, -1, 1.5, true, [], {}, '__INF__', 1e21, [idCmd], { a: 1 }, 'x'].map((v) => ({ lib: `id = ${visible(v, 20)}`, corps: serialiser(avec(baseDec(), ['id'], v)), champ: 'id' })),
        ...[null, 1, 'ACCEPT', 'accept ', 'x', [], {}, 'accept\u0000', "accept'; DROP TABLE orders;--", ['accept']].map((v) => ({ lib: `action = ${visible(v, 20)}`, corps: serialiser(avec(baseDec(), ['action'], v)), champ: 'action' })),
        ...[null, 25, 0, 20.5, '20', 60.0001, [], true, 1e21, -20, 70].map((v) => ({ lib: `delay_minutes = ${visible(v, 20)}`, corps: serialiser(avec(baseDec(), ['delay_minutes'], v)), champ: 'delay_minutes' }))
      ];
      await lot('A2 · owner_order_decide · id, action, délai faux : 422', decFausse.map((k) => cas(k.lib, () => apiBrut('owner_order_decide', k.corps, { cookie }), { champ: k.champ })), (r, k) => attenduValidation(k.champ)(r));
      const absents = [2147483648, 2147483647, 9007199254740993, 999999999, 1e308].map((id) => cas(`id inexistant ${id}`, () => api('owner_order_decide', { id, action: 'refuse' }, { cookie })));
      await lot('A2 · owner_order_decide · identifiant hors plage ou inexistant : 404, jamais 500', absents, (r) => (r.status === 404 && r.json.error === 'not_found' ? null : 'attendu 404 not_found'));
      const pret = await api('owner_order_decide', { id: idCmd, action: 'ready' }, { cookie });
      controle('A2 · owner_order_decide · « prête » sur une commande non acceptée : 409 already_decided', pret.status === 409 && pret.json.error === 'already_decided', `${pret.status} ${pret.json.error}`);
      const sc = await lot('A2 · owner_order_decide · décisions valides refaites à l\'identique : rejeu 200', [
        cas('accepter', () => api('owner_order_decide', { id: idCmd, action: 'accept', delay_minutes: 30 }, { cookie }), { statut: 200 }),
        cas('accepter à nouveau (même délai)', () => api('owner_order_decide', { id: idCmd, action: 'accept', delay_minutes: 30 }, { cookie }), { statut: 200 }),
        cas('refuser une commande acceptée', () => api('owner_order_decide', { id: idCmd, action: 'refuse' }, { cookie }), { statut: 409 })
      ], (r, k) => (r.status === k.statut ? null : `attendu ${k.statut}`));
      etatIntact('A2 · owner_order_decide', avant, compterTables(), { orders: 1, order_items: cmd.json.order.items.length });
    }

    // customer_logout / owner_logout / owner_sessions_revoke (valeurs valides = révocation) : sessions jetables
    {
      const jetable = async () => { const p = await patronConnecte(ipNeuve()); return p; };
      const pj = await jetable();
      await lot('A2 · owner_sessions_revoke · scope faux : 422', [null, true, 0, [], {}, 'ALL', 'all ', 'other', "others'; DROP TABLE sessions;--", '', ['all']].map((v) => cas(`scope = ${visible(v, 20)}`, () => apiBrut('owner_sessions_revoke', serialiser({ scope: v }), { cookie: pj.cookieHeader() }))), attenduValidation('scope'));
      const lg = await lot('A2 · logouts : corps quelconques acceptés (200), session révoquée', [
        cas('customer_logout {}', () => api('customer_logout', {}, { cookie: clients[10].cookieHeader() })),
        cas('customer_logout avec champs quelconques', () => api('customer_logout', { a: [1, 2, { b: null }], '__proto__x': 1 }, { cookie: clients[11].cookieHeader() })),
        cas('customer_logout sans session', () => api('customer_logout', {}))
      ], (r) => (r.status === 200 && r.json.ok === true ? null : 'attendu 200'));
      const meApres = await apiGet('customer_me', { cookie: clients[10].cookieHeader() });
      controle('A2 · après customer_logout, la session client est bien révoquée', meApres.status === 200 && meApres.json.customer === null, `customer_me → ${meApres.status} ${JSON.stringify(meApres.json && meApres.json.customer)}`);
      for (const i of [10, 11]) await clients[i].post('customer_login.php', { email: clients[i].email, password: clients[i].password });
      const pl = await jetable();
      const lo = await api('owner_logout', { x: 1 }, { cookie: pl.cookieHeader() });
      const apresLogout = await apiGet('owner_me', { cookie: pl.cookieHeader() });
      controle('A2 · owner_logout : 200 puis session révoquée (owner_me : 401)', lo.status === 200 && apresLogout.status === 401, `${lo.status} puis ${apresLogout.status}`);
      const pa = await jetable();
      const pb = await jetable();
      const rev = await api('owner_sessions_revoke', { scope: 'others' }, { cookie: pa.cookieHeader() });
      const encoreB = await apiGet('owner_me', { cookie: pb.cookieHeader() });
      const encoreA = await apiGet('owner_me', { cookie: pa.cookieHeader() });
      controle('A2 · owner_sessions_revoke « others » : les autres sessions sont révoquées, celle-ci reste', rev.status === 200 && encoreB.status === 401 && encoreA.status === 200, `${rev.status} ; autre session ${encoreB.status} ; cette session ${encoreA.status}`);
      const rev2 = await api('owner_sessions_revoke', { scope: 'all' }, { cookie: pa.cookieHeader() });
      const finA = await apiGet('owner_me', { cookie: pa.cookieHeader() });
      controle('A2 · owner_sessions_revoke « all » : toutes les sessions sont révoquées', rev2.status === 200 && rev2.json.logged_out === true && finA.status === 401, `${rev2.status} ; ensuite ${finA.status}`);
      patron = await patronConnecte(ipFictive(250251));
    }

    // ---- A3 : le caractère NUL dans chaque champ texte (Postgres le refuse : il ne doit jamais produire un 500) ----
    const cinqAvantA3 = stats.cinqCents;
    {
      const NUL = [
        ['customer_signup · rue', () => api('customer_signup', { ...baseInscription(), street: '12 rue\u0000Test' })],
        ['customer_login · e-mail', () => api('customer_login', { email: 'a\u0000b@example.test', password: 'Fuzz-pass-1234!' })],
        ['customer_update_address · rue', () => api('customer_update_address', { street: 'a\u0000b', city: 'Dourges' }, { cookie: clients[12].cookieHeader() })],
        ['owner_customers · q (recherche)', () => api('owner_customers', { q: 'a\u0000b' }, { cookie: patron.cookieHeader() })],
        ['owner_availability · nom (rupture)', () => api('owner_availability', { kind: 'ingredient', status: 'out_manual', name: 'a\u0000b' }, { cookie: patron.cookieHeader() })],
        ['owner_availability · nom (remise en dispo)', () => api('owner_availability', { kind: 'ingredient', status: 'available', name: 'a\u0000b' }, { cookie: patron.cookieHeader() })]
      ];
      for (const [lib, appel] of NUL) {
        const essais = [];
        for (let k = 0; k < 3; k++) essais.push(await appel());
        const statuts = essais.map((r) => r.status);
        const ok = essais.every((r) => r.status < 500 && r.json && typeof r.json === 'object');
        controle(`A3 · NUL (U+0000) dans ${lib} : réponse 4xx/2xx JSON, jamais 5xx (3 essais)`, ok, `statuts ${statuts.join(', ')}${ok ? '' : ' · ' + visible(essais[0].texte, 100)}`);
      }
      const RESISTANTS = [
        ['customer_signup · prénom', () => api('customer_signup', { ...baseInscription(), first_name: 'A\u0000x' })],
        ['customer_signup · mot de passe', () => api('customer_signup', { ...baseInscription(), password: 'Abcdefgh\u00001!' })],
        ['customer_update_profile · prénom', () => api('customer_update_profile', { first_name: 'a\u0000b', last_name: 'z', phone: '0612345678' }, { cookie: clients[13].cookieHeader() })],
        ['order_create · remarque', () => api('order_create', commandeRetrait({ note: 'x\u0000y' }), { cookie: clientSuivant().cookieHeader() })],
        ['order_create · nom d\'article', () => { const b = commandeRetrait(); b.items[0].name = 'Régina\u0000x'; return api('order_create', b, { cookie: clientSuivant().cookieHeader() }); }],
        ['order_create · supplément', () => { const b = commandeRetrait(); b.items[0].extras = [{ name: 'Cham\u0000pignons', price_cents: 150, qty: 1 }]; return api('order_create', b, { cookie: clientSuivant().cookieHeader() }); }],
        ['order_create · retrait', () => { const b = commandeRetrait(); b.items[0].removed = ['fro\u0000mage']; return api('order_create', b, { cookie: clientSuivant().cookieHeader() }); }],
        ['order_create · moitié', () => { const b = commandeRetrait({ moitie: true }); b.items[0].half = { flavor1: 'Régina', flavor2: 'Kebab\u0000' }; return api('order_create', b, { cookie: clientSuivant().cookieHeader() }); }],
        ['order_create · clé d\'envoi', () => { const b = commandeRetrait(); b.idempotency_key = 'abcdefgh\u0000'; return api('order_create', b, { cookie: clientSuivant().cookieHeader() }); }],
        ['owner_login · code', () => api('owner_login', { code: 'abc\u0000def' })],
        ['customer_login · mot de passe', () => api('customer_login', { email: clients[3].email, password: 'a\u0000b' })]
      ];
      for (const [lib, appel] of RESISTANTS) {
        const essais = [await appel(), await appel()];
        const ok = essais.every((r) => r.status < 500 && r.json && typeof r.json === 'object');
        controle(`A3 · NUL (U+0000) dans ${lib} : pas de 5xx (2 essais)`, ok, `statuts ${essais.map((r) => r.status).join(', ')}`);
      }
      const apres = await apiGet('availability');
      controle('A3 · le serveur répond normalement après les erreurs précédentes', apres.status === 200 && Array.isArray(apres.json.pizzasIndisponibles), `availability → ${apres.status}`);
    }
    const cinqA3 = stats.cinqCents - cinqAvantA3;

    // ---- A4 : Unicode (emoji, droite à gauche, caractères de format, substituts isolés) : aller-retour exact ----
    {
      let nCrees = 0;
      const ecarts = [];
      for (const t of TEXTES_UNICODE) {
        const email = `uni-${suffixe()}@example.test`;
        const corps = { first_name: t, last_name: 'Uni' + 'x', email, phone: '0612345678', password: 'Fuzz-pass-1234!', street: t, city: 'Dourges' };
        const r = await api('customer_signup', corps);
        const attenduNom = nettoyerNom(t);
        if (attenduNom === '') {
          if (r.status !== 422) ecarts.push(`${visible(t, 20)} : prénom vide après nettoyage, attendu 422, reçu ${r.status}`);
          continue;
        }
        if (r.status !== 201) { ecarts.push(`${visible(t, 20)} : attendu 201, reçu ${r.status} ${visible(r.texte, 80)}`); continue; }
        nCrees++;
        const ligne = ligneClient(email);
        const attenduRue = nettoyerRue(t) === '' ? null : nettoyerRue(t);
        if (r.json.customer.first_name !== attenduNom || ligne.first_name !== attenduNom) ecarts.push(`${visible(t, 20)} : prénom ${visible(ligne.first_name, 30)} au lieu de ${visible(attenduNom, 30)}`);
        if (r.json.customer.street !== attenduRue || ligne.street !== attenduRue) ecarts.push(`${visible(t, 20)} : rue ${visible(ligne.street, 30)} au lieu de ${visible(attenduRue, 30)}`);
      }
      controle(`A4 · Unicode : prénom et rue stockés et renvoyés comme documenté (${TEXTES_UNICODE.length} textes : emoji, RTL, U+202E, combinants, substituts isolés)`, ecarts.length === 0, ecarts.length ? ecarts.slice(0, 3).join(' | ') : `${nCrees} comptes créés, valeurs identiques à la saisie normalisée`);
      for (const e of ecarts.slice(0, 5)) detail(e);
      // Bornes de longueur en points de code (pas en unités UTF-16 ni en octets)
      const bornes = [
        ['prénom de 60 caractères ASCII', { first_name: 'x'.repeat(60) }, 201], ['prénom de 60 emoji (120 unités UTF-16, 240 octets)', { first_name: '🍕'.repeat(60) }, 201], ['prénom de 61 emoji', { first_name: '🍕'.repeat(61) }, 422],
        ['nom de 60 caractères astraux', { last_name: '𝒳'.repeat(60) }, 201], ['nom de 61 caractères', { last_name: 'y'.repeat(61) }, 422],
        ['rue de 150 emoji', { street: '🍕'.repeat(150) }, 201], ['rue de 151 emoji', { street: '🍕'.repeat(151) }, 422], ['rue de 150 caractères ASCII', { street: 'r'.repeat(150) }, 201],
        ['mot de passe de 200 octets', { password: 'p'.repeat(200) }, 201], ['mot de passe de 201 octets', { password: 'p'.repeat(201) }, 422], ['mot de passe de 8 octets', { password: 'p'.repeat(8) }, 201], ['mot de passe de 7 octets', { password: 'p'.repeat(7) }, 422],
        ['mot de passe de 50 emoji (200 octets)', { password: '🍕'.repeat(50) }, 201],
        ['e-mail de 190 octets', { email: 'e'.repeat(190 - '@example.test'.length) + '@example.test' }, 201], ['e-mail de 191 octets', { email: 'e'.repeat(191 - '@example.test'.length) + '@example.test' }, 422],
        ['e-mail en majuscules (normalisé en minuscules)', { email: 'MAJ-' + suffixe() + '@EXAMPLE.TEST' }, 201], ['e-mail avec espaces autour (coupés)', { email: '  esp-' + suffixe() + '@example.test  ' }, 201],
        ['téléphone de 20 octets', { phone: '+33 6 12 34 56 78 90' }, 201], ['téléphone de 21 octets', { phone: '+33 6 12 34 56 78 901' }, 422],
        ['ville sans rue (adresse sans rue)', { street: '' }, 201], ['rue et ville nulles', { street: null, city: null }, 201]
      ];
      const retours = [];
      for (const [lib, patch, statutAttendu] of bornes) {
        const corps = { ...baseInscription(), ...patch };
        const r = await api('customer_signup', corps);
        let bon = r.status === statutAttendu;
        let extra = '';
        if (bon && statutAttendu === 201) {
          const ligne = ligneClient(r.json.customer.email);
          if (patch.first_name !== undefined && ligne.first_name !== patch.first_name) { bon = false; extra = 'prénom stocké différent'; }
          if (patch.last_name !== undefined && ligne.last_name !== patch.last_name) { bon = false; extra = 'nom stocké différent'; }
          if (patch.street && patch.street !== '' && ligne.street !== patch.street) { bon = false; extra = 'rue stockée différente'; }
          if (patch.password !== undefined) {
            const co = await api('customer_login', { email: corps.email, password: patch.password });
            if (co.status !== 200) { bon = false; extra = 'connexion impossible avec ce mot de passe : ' + co.status; }
          }
        }
        retours.push({ lib, bon, statut: r.status, extra });
      }
      const mauvais = retours.filter((x) => !x.bon);
      controle(`A4 · bornes de longueur en points de code (${bornes.length} cas : 60/61, 150/151, 190/191 octets, 200/201 octets…)`, mauvais.length === 0, mauvais.length ? mauvais.map((x) => `${x.lib} → ${x.statut} ${x.extra}`).join(' | ') : 'toutes conformes');
      // E-mails piégés : aller-retour exact et connexion avec le même e-mail
      const ecartsMail = [];
      for (const e of EMAILS_PIEGES) {
        const corps = { ...baseInscription(), email: e, password: 'Piege-pass-9876!' };
        const r = await api('customer_signup', corps);
        if (r.status !== 201) { ecartsMail.push(`${visible(e, 40)} : inscription ${r.status}`); continue; }
        const ligne = ligneClient(e.toLowerCase());
        if (!ligne || r.json.customer.email !== e.toLowerCase()) { ecartsMail.push(`${visible(e, 40)} : e-mail stocké ${visible(ligne && ligne.email, 40)}`); continue; }
        const co = await api('customer_login', { email: e, password: 'Piege-pass-9876!' });
        if (co.status !== 200 || co.json.customer.email !== e.toLowerCase()) ecartsMail.push(`${visible(e, 40)} : connexion ${co.status}`);
        const autre = await api('customer_login', { email: e.replace(/[%_]/g, 'X') + 'z', password: 'Piege-pass-9876!' });
        if (autre.status !== 401) ecartsMail.push(`${visible(e, 40)} : connexion avec un e-mail voisin (jokers) ${autre.status}`);
      }
      controle(`A4 · e-mails valides mais piégés (apostrophes, %, _, --, /**/, guillemets simples) : inscription, relecture et connexion exactes (${EMAILS_PIEGES.length})`, ecartsMail.length === 0, ecartsMail.length ? ecartsMail.slice(0, 3).join(' | ') : 'aller-retour exact');
      for (const e of ecartsMail.slice(0, 4)) detail(e);
      const doublon = await api('customer_signup', { ...baseInscription(), email: EMAILS_PIEGES[0].toUpperCase() });
      controle('A4 · e-mail déjà pris (autre casse) : 409 email_taken', doublon.status === 409 && doublon.json.error === 'email_taken', `${doublon.status} ${doublon.json && doublon.json.error}`);
    }

    // ---- A5 : corps volumineux et pire cas de calcul : le serveur reste rapide ----
    {
      const lourd = commandeRetrait();
      lourd.items = Array.from({ length: 40 }, () => ({ ...copie(commandeRetrait().items[0]), removed: Array.from({ length: 10 }, () => 'x'.repeat(30)), extras: Array.from({ length: 10 }, (_, k) => ({ name: 'Champignons ' + k, price_cents: 100, qty: 1 })), note: ' '.repeat(100) + 'n' }));
      const corps = serialiser(lourd);
      const t = performance.now();
      const r = await apiBrut('order_create', corps, { cookie: clientSuivant().cookieHeader() });
      const ms = Math.round(performance.now() - t);
      controle('A5 · pire cas de validation (40 lignes × 10 retraits × 10 suppléments, ' + Math.round(corps.length / 1024) + ' Ko) : 4xx JSON en moins de 2 s', r.status >= 400 && r.status < 500 && r.json && ms < 2000, `${r.status} ${r.json && r.json.error} en ${ms} ms`);
      const espaces = serialiser(avec(commandeRetrait(), ['items', 0, 'note'], ' '.repeat(60000) + 'x'));
      const t2 = performance.now();
      const r2 = await apiBrut('order_create', espaces, { cookie: clientSuivant().cookieHeader() });
      const ms2 = Math.round(performance.now() - t2);
      const noteStockee = r2.json && r2.json.order && r2.json.order.items && r2.json.order.items[0].note;
      controle('A5 · remarque de 60 000 espaces suivie d\'une lettre (rognage avant la limite de 300) : réponse JSON en moins de 2 s, remarque stockée « x »', r2.status < 500 && ms2 < 2000 && (r2.status !== 201 || noteStockee === 'x'), `${r2.status} en ${ms2} ms ; remarque stockée ${visible(noteStockee, 20)}`);
      const t3 = performance.now();
      const r3 = await api('customer_signup', { ...baseInscription(), first_name: ' '.repeat(20000) + 'a'.repeat(30) + '\u200b'.repeat(1000), last_name: '\u0000'.repeat(3000) + 'b' });
      const ms3 = Math.round(performance.now() - t3);
      controle('A5 · prénom de 20 000 espaces + 1 000 caractères de format, nom de 3 000 NUL : réponse JSON en moins de 2 s', r3.status < 500 && ms3 < 2000 && r3.json !== null, `${r3.status} en ${ms3} ms`);
      const t4 = performance.now();
      const r4 = await api('customer_signup', { ...baseInscription(), email: 'a@' + 'a-'.repeat(60) + '!' + 'b.'.repeat(30) + 'c' });
      const ms4 = Math.round(performance.now() - t4);
      controle('A5 · e-mail pathologique pour l\'expression régulière : 422 en moins de 1 s', r4.status === 422 && ms4 < 1000, `${r4.status} en ${ms4} ms`);
    }

    // ---- A6 : bilan du fuzz ----
    const apresA = compterTables();
    const reste = apresA.customers - avantA.customers;
    info(`après A : ${JSON.stringify(apresA)} (clients créés pendant A : ${reste})`);
    const patronApres = await patronConnecte(ipNeuve());
    const clientApres = await api('customer_login', { email: clients[4].email, password: clients[4].password });
    controle('A6 · après tout le fuzz, le patron et un client se connectent normalement (aucun verrou injustifié)', patronApres.cookies.has('subito_owner') && clientApres.status === 200, `patron ${patronApres.cookies.has('subito_owner')} ; client ${clientApres.status}`);
    const m = mesures();
    controle('A6 · aucune réponse 5xx dans tout le fuzz en dehors du caractère NUL (contrôles A3)', stats.cinqCents - cinqA3 === 0, `${m.requetes} requêtes ; 5xx hors A3 : ${stats.cinqCents - cinqA3} ; 5xx dans A3 : ${cinqA3} ; erreurs réseau ${m.reseau}`);
    controle('A6 · aucune erreur réseau (connexion coupée, délai dépassé) pendant le fuzz', m.reseau === 0, `${m.reseau} sur ${m.requetes} requêtes`);
    info(`latences : p50 ${m.p50} ms, p95 ${m.p95} ms, max ${m.max} ms (${m.plusLente})`);
  }

  // =====================================================================================================================
  if (PHASES.includes('B')) {
    const { phaseSql } = await import('./lib/09-phase-b.mjs');
    await phaseSql({ site, clients, patron: () => patron, compterTables, schemaBase, schemaInitial, ligneClient, clientSuivant, commandeRetrait, commandeLivraison, baseInscription, cleOrdre, suffixe, etatIntact, lot, cas, avec, serialiser });
  }

  // =====================================================================================================================
  let donneesXss = null;
  if (PHASES.includes('C') || PHASES.includes('D')) {
    const { phaseXssApi } = await import('./lib/09-phase-c.mjs');
    donneesXss = await phaseXssApi({ site, clients, patron: () => patron, compterTables, ligneClient, commandeRetrait, commandeLivraison, cleOrdre, suffixe, serialiser, avec, lot, cas, etatIntact });
  }

  if (PHASES.includes('D')) {
    phase('D · Navigateur : XSS, tablette, suivi, compte, panier');
    const debutD = Date.now();
    const { phaseNavigateur } = await import('./lib/09-phase-d.mjs');
    await avecNavigateur(async (nav) => {
      controle('D0 · navigateur Chrome headless obtenu (3 navigateurs au plus sur la machine)', true, `${nav.version} après ${Date.now() - debutD} ms d'attente`);
      await phaseNavigateur({ nav, site, donnees: donneesXss, patron: () => patron, clients, compterTables, ligneClient, cleOrdre, commandeRetrait, commandeLivraison, serialiser, HORLOGE });
    }, { pagesMax: 4 });
  }

  // ---------- Bilan transversal ----------
  phase('Z · Bilan transversal');
  const journal = site.journal();
  const lignes = journal.split('\n').filter(Boolean);
  const formatOk = lignes.every((l) => /^\[subito-api\] (?:\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z )?\S+ \d{3} \S+(?: \S+(?: code \S+)?)?\s*$/.test(l));
  const marqueurs = ['__pwn', 'DROP TABLE', 'onerror', 'OR 1=1', 'onload', '<script', 'Fuzz', 'example.test', '0612345678', 'Pass', 'password', 'UNION', '202E'];
  const fuites = marqueurs.filter((m) => journal.includes(m));
  controle('Z · journal serveur : aucune donnée saisie (nom, e-mail, téléphone, charge d\'attaque, mot de passe)', fuites.length === 0 && formatOk, `${lignes.length} lignes ; marqueurs trouvés : ${fuites.join(', ') || 'aucun'} ; format conforme : ${formatOk}`);
  if (!formatOk) detail('lignes hors format : ' + lignes.filter((l) => !/^\[subito-api\]/.test(l)).slice(0, 3).join(' | '));
  const nb500 = lignes.filter((l) => / 500 server_error/.test(l)).length;
  controle('Z · chaque réponse 5xx observée correspond à une ligne « 500 server_error » du journal (pas de panne silencieuse)', nb500 >= stats.cinqCents, `${stats.cinqCents} réponses 5xx reçues, ${nb500} lignes 500 dans le journal`);
  controle('Z · prototype d\'Object toujours intact à la fin', prototypeIntact(), `({}).polluted = ${({}).polluted}`);
  const m = mesures();
  info(`mesures HTTP de la batterie : ${JSON.stringify(m)}`);
} finally {
  try { site.arreter(); } catch { /* déjà arrêté */ }
}
const code = bilan();
process.exit(code);
