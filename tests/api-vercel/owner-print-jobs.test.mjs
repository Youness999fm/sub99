// Impression de préparation H-45 des commandes planifiées (SBT-005) : print_jobs, owner_print_claim.php,
// owner_print_ack.php, et leur reflet dans owner_orders.php (print_job, print_due). Horloge pilotée
// (SUBITO_TEST_CLOCK_FILE) : jamais une attente réelle de 45 minutes.
// Lancer depuis la racine du dépôt :  SUBITO_TEST_PORT=18430 node --test tests/api-vercel/owner-print-jobs.test.mjs
// Ce fichier prend le port SUBITO_TEST_PORT + 4 (les autres fichiers du dossier tournent en parallèle).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

process.env.SUBITO_TEST_PORT = String(Number(process.env.SUBITO_TEST_PORT || 8091) + 4);
const {
  OWNER_CODE, Client, openTestDb, makeEnv, runTool, startServer, stopServer,
} = await import('./lib/harness.mjs');
const { PRINT_LEAD_MINUTES, PRINT_MAX_ATTEMPTS, PRINT_CLAIM_TIMEOUT_S } = await import('../../serveur/impression.js');
const { parisLocalVersEpoch, jourParisDecale } = await import('../../serveur/util.js');

const randomPassword = () => Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(18))).toString('base64url') + 'Aa1!';

let ctx;
let server;
let db;
const owner = new Client('owner-print');
let keySeq = 0;

function expectError(r, status, code) {
  assert.equal(r.status, status, `${r.method} ${r.route} : ${r.text}`);
  assert.equal(r.json?.ok, false);
  assert.equal(r.json?.error, code, r.text);
}

// Horloge pilotée : un seul fichier pour tout le fichier de test, avancée explicitement entre les étapes.
const clockDir = mkdtempSync(path.join(process.env.SUBITO_TEST_DIR || tmpdir(), 'subito-print-clock-'));
const clockFile = path.join(clockDir, 'horloge.txt');
function poserHorloge(e) { writeFileSync(clockFile, String(e)); }
const isoDe = (e) => new Date(e * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');

// Créneau de retrait toujours valide, quelle que soit l'heure réelle d'exécution des tests : demain 20h00
// Paris (dans la fenêtre 18h20-22h30, alignée sur l'heure, largement sous les 7 jours maximum).
const demain = jourParisDecale(Math.floor(Date.now() / 1000), 1);
const SCHEDULED_EPOCH = parisLocalVersEpoch(demain.annee, demain.mois, demain.jour, 20, 0);
const SCHEDULED_ISO = isoDe(SCHEDULED_EPOCH);
// « Maintenant » par défaut pour les commandes de ce fichier : 6 h avant le créneau — largement avant la
// fenêtre H-45 (45 min avant), largement au-delà du délai minimum de programmation (1 h).
const AVANT_EPOCH = SCHEDULED_EPOCH - 6 * 3600;
const DUE_EPOCH = SCHEDULED_EPOCH - PRINT_LEAD_MINUTES * 60;

before(async () => {
  ctx = makeEnv();
  ctx.env.SUBITO_TEST_CLOCK_FILE = clockFile;
  poserHorloge(AVANT_EPOCH);
  const inst = await runTool(ctx, 'install.php');
  assert.equal(inst.code, 0, inst.stderr + inst.stdout);
  db = openTestDb(ctx);
  server = await startServer(ctx);
  assert.equal((await owner.post('owner_login.php', { code: OWNER_CODE, remember: false })).status, 200);
});

after(() => {
  stopServer(server);
  try { db?.close(); } catch { /* déjà fermée */ }
});

/** Crée un client livré (adresse en zone), et renvoie son Client HTTP connecté. */
async function nouveauClient(email) {
  const c = new Client('cust-' + email);
  const password = randomPassword();
  const r = await c.post('customer_signup.php', {
    first_name: 'Print', last_name: 'Test', email, phone: '0612345678', password,
    street: '1 rue des Tests', city: 'Hénin-Beaumont', housing_type: 'maison'
  });
  assert.equal(r.status, 201, r.text);
  return c;
}

/** Commande planifiée (livraison, avec pizza pour rester simple) pour le créneau partagé SCHEDULED_ISO. */
async function commanderPlanifiee(client) {
  const body = {
    idempotency_key: 'print-job-' + Date.now() + '-' + (++keySeq),
    mode: 'delivery', payment_methods: ['card'], cash_change_for: null, hot_sauce: true,
    items: [{ name: 'Régina', variant: 'Duo', qty: 1, unit_price_cents: 1600, removed: [], extras: [], half: null, note: '' }],
    delivery_fee_cents: 0, total_cents: 1600, scheduled_for: SCHEDULED_ISO
  };
  const r = await client.post('order_create.php', body);
  assert.equal(r.status, 201, r.text);
  return r.json.order.id;
}

function commandeDansOwnerOrders(rep, id) {
  return rep.json.orders.find((o) => o.id === id);
}

test('acceptation d\'une commande planifiée crée la tâche d\'impression (print_due_at = scheduled_for - 45 min)', async () => {
  poserHorloge(AVANT_EPOCH);
  const client = await nouveauClient('printjob1@example.test');
  const id = await commanderPlanifiee(client);

  const accept = await owner.post('owner_order_decide.php', { id, action: 'accept', delay_minutes: 30 });
  assert.equal(accept.status, 200, accept.text);

  const liste = await owner.get('owner_orders.php');
  const vue = commandeDansOwnerOrders(liste, id);
  assert.ok(vue, 'commande absente de owner_orders.php');
  assert.equal(vue.print_due, false, 'pas encore due (6 h avant, délai H-45)');
  assert.ok(vue.print_job, 'print_job absent');
  assert.equal(vue.print_job.status, 'pending');
  assert.equal(vue.print_job.attempts, 0);
  assert.equal(vue.print_job.print_due_at, isoDe(DUE_EPOCH));
});

test('commande immédiate (non planifiée) : aucune tâche d\'impression créée', async () => {
  poserHorloge(AVANT_EPOCH);
  const client = await nouveauClient('printjob-immediat@example.test');
  const body = {
    idempotency_key: 'print-immediat-' + Date.now(),
    mode: 'pickup', payment_methods: [], cash_change_for: null, hot_sauce: null,
    items: [{ name: 'Régina', variant: 'Duo', qty: 1, unit_price_cents: 1600, removed: [], extras: [], half: null, note: '' }],
    delivery_fee_cents: 0, total_cents: 1600, scheduled_for: null
  };
  const r = await client.post('order_create.php', body);
  assert.equal(r.status, 201, r.text);
  const id = r.json.order.id;
  await owner.post('owner_order_decide.php', { id, action: 'accept', delay_minutes: 30 });
  const liste = await owner.get('owner_orders.php');
  const vue = commandeDansOwnerOrders(liste, id);
  assert.equal(vue.print_job, null);
  assert.equal(vue.print_due, false);
});

test('rejeu de l\'acceptation (même commande planifiée) : la tâche n\'est pas dupliquée (contrainte unique)', async () => {
  poserHorloge(AVANT_EPOCH);
  const client = await nouveauClient('printjob-rejeu@example.test');
  const id = await commanderPlanifiee(client);
  const a1 = await owner.post('owner_order_decide.php', { id, action: 'accept', delay_minutes: 30 });
  assert.equal(a1.status, 200);
  const a2 = await owner.post('owner_order_decide.php', { id, action: 'accept', delay_minutes: 30 });
  assert.equal(a2.status, 200);
  assert.equal(a2.json.replayed, true);
  const n = db.prepare('SELECT COUNT(*) AS n FROM print_jobs WHERE order_id = ?').get(id).n;
  assert.equal(Number(n), 1, 'une seule tâche malgré le rejeu');
});

test('cycle complet : due -> réclamée -> remise réussie (dispatched), plus due ensuite', async () => {
  poserHorloge(AVANT_EPOCH);
  const client = await nouveauClient('printjob-cycle@example.test');
  const id = await commanderPlanifiee(client);
  await owner.post('owner_order_decide.php', { id, action: 'accept', delay_minutes: 30 });

  // Avant l'heure : rien à réclamer.
  const tropTot = await owner.post('owner_print_claim.php', { id, device: 'tablette-test' });
  assert.equal(tropTot.status, 200, tropTot.text);
  assert.equal(tropTot.json.claimed, false);

  // On avance l'horloge jusqu'à l'échéance H-45.
  poserHorloge(DUE_EPOCH);
  const liste = await owner.get('owner_orders.php');
  assert.equal(commandeDansOwnerOrders(liste, id).print_due, true);

  const claim = await owner.post('owner_print_claim.php', { id, device: 'tablette-test' });
  assert.equal(claim.status, 200, claim.text);
  assert.equal(claim.json.claimed, true);
  assert.equal(claim.json.job.status, 'claimed');
  assert.equal(claim.json.job.attempts, 1);

  // Une 2e tablette qui sonde au même instant n'obtient rien (réclamation atomique, invariant I9).
  const concurrent = await owner.post('owner_print_claim.php', { id, device: 'tablette-2' });
  assert.equal(concurrent.json.claimed, false);

  const ack = await owner.post('owner_print_ack.php', { id, outcome: 'dispatched' });
  assert.equal(ack.status, 200, ack.text);
  assert.equal(ack.json.status, 'dispatched');

  const apres = await owner.get('owner_orders.php');
  const vueApres = commandeDansOwnerOrders(apres, id);
  assert.equal(vueApres.print_job.status, 'dispatched');
  assert.equal(vueApres.print_due, false, 'une tâche remise avec succès ne redevient jamais due');

  // Plus réclamable (déjà dispatched).
  const reclaim = await owner.post('owner_print_claim.php', { id, device: 'tablette-test' });
  assert.equal(reclaim.json.claimed, false);
});

test('échec signalé : nouvel essai automatique jusqu\'au plafond, puis failed définitif (réimpression manuelle ensuite)', async () => {
  poserHorloge(AVANT_EPOCH);
  const client = await nouveauClient('printjob-echec@example.test');
  const id = await commanderPlanifiee(client);
  await owner.post('owner_order_decide.php', { id, action: 'accept', delay_minutes: 30 });
  poserHorloge(DUE_EPOCH);

  for (let essai = 1; essai <= PRINT_MAX_ATTEMPTS; essai++) {
    const claim = await owner.post('owner_print_claim.php', { id, device: 'tablette-test' });
    assert.equal(claim.json.claimed, true, `essai ${essai} : devrait être réclamable`);
    assert.equal(claim.json.job.attempts, essai);
    const ack = await owner.post('owner_print_ack.php', { id, outcome: 'failed', error: 'imprimante hors ligne' });
    const dernier = essai === PRINT_MAX_ATTEMPTS;
    assert.equal(ack.json.status, dernier ? 'failed' : 'pending', `essai ${essai}`);
  }
  // Après le plafond : plus réclamable automatiquement.
  const apresPlafond = await owner.post('owner_print_claim.php', { id, device: 'tablette-test' });
  assert.equal(apresPlafond.json.claimed, false);
  const vue = commandeDansOwnerOrders(await owner.get('owner_orders.php'), id);
  assert.equal(vue.print_job.status, 'failed');
  assert.equal(vue.print_job.last_error, 'imprimante hors ligne');
});

test('tablette disparue en plein envoi (résultat jamais revenu) : la tâche « claimed » bloquée part en '
  + '"failed" en UNE SEULE fois, jamais réclamable à nouveau automatiquement (décision du 23/11/2026 : un '
  + 'silence ne prouve pas un échec, le ticket a pu être réellement imprimé — rejouer la réclamation enverrait '
  + 'un second envoi RÉEL à l\'imprimante)', async () => {
  poserHorloge(AVANT_EPOCH);
  const client = await nouveauClient('printjob-bloque@example.test');
  const id = await commanderPlanifiee(client);
  await owner.post('owner_order_decide.php', { id, action: 'accept', delay_minutes: 30 });
  poserHorloge(DUE_EPOCH);

  const claim = await owner.post('owner_print_claim.php', { id, device: 'tablette-perdue' });
  assert.equal(claim.json.claimed, true);
  assert.equal(claim.json.job.attempts, 1);
  // Jamais d'accusé de réception (tablette éteinte). On avance l'horloge au-delà du délai de blocage.
  poserHorloge(DUE_EPOCH + PRINT_CLAIM_TIMEOUT_S + 5);

  const relance = await owner.post('owner_print_claim.php', { id, device: 'autre-tablette' });
  assert.equal(relance.json.claimed, false, 'jamais réclamable à nouveau après un timeout silencieux, même une seule fois');
  const vue = commandeDansOwnerOrders(await owner.get('owner_orders.php'), id);
  assert.equal(vue.print_job.status, 'failed');
  assert.equal(vue.print_job.attempts, 1, 'une seule tentative réelle : le ticket n\'est jamais réimprimé automatiquement');
  assert.equal(vue.print_job.last_error, 'appareil sans réponse (délai écoulé)');
});

test('BUG RÉEL DU 22/11/2026, PUIS RÉCIDIVE EN PRODUCTION LE 23/11/2026 (commande #94, 64 tentatives malgré '
  + 'le plafond) : un appareil qui ne confirme jamais la réception (ni succès ni échec, ex. bridge natif qui '
  + 'ne rappelle jamais) ne doit plus JAMAIS réimprimer le même ticket — même une seule fois de plus — après '
  + 'le premier timeout silencieux ; compter les tentatives s\'étant avéré insuffisant à deux reprises, la '
  + 'tâche part directement en "failed" dès le premier timeout, sans dépendre du plafond', async () => {
  poserHorloge(AVANT_EPOCH);
  const client = await nouveauClient('printjob-boucle@example.test');
  const id = await commanderPlanifiee(client);
  await owner.post('owner_order_decide.php', { id, action: 'accept', delay_minutes: 30 });
  poserHorloge(DUE_EPOCH);

  const claim = await owner.post('owner_print_claim.php', { id, device: 'tablette-muette' });
  assert.equal(claim.json.claimed, true);
  assert.equal(claim.json.job.attempts, 1);
  // Jamais d'accusé de réception (ni dispatched, ni failed) : seul le délai de blocage fait avancer les choses.
  poserHorloge(DUE_EPOCH + PRINT_CLAIM_TIMEOUT_S + 5);

  const apresTimeout = await owner.post('owner_print_claim.php', { id, device: 'tablette-muette' });
  assert.equal(apresTimeout.json.claimed, false, 'jamais réclamable après le premier timeout silencieux, pas besoin d\'atteindre le plafond');
  const vue = commandeDansOwnerOrders(await owner.get('owner_orders.php'), id);
  assert.equal(vue.print_job.status, 'failed');
  assert.equal(vue.print_job.attempts, 1, 'jamais réimprimé plusieurs fois — même l\'ancien plafond de 5 n\'est plus pertinent ici');
  assert.equal(vue.print_job.last_error, 'appareil sans réponse (délai écoulé)');

  // Preuve supplémentaire : même bien plus tard, un sondage tardif ne relance rien (y compris simulant
  // l'intervalle de ~64 tentatives observé en production le 23/11/2026).
  poserHorloge(DUE_EPOCH + PRINT_CLAIM_TIMEOUT_S * 64);
  const bienPlusTard = await owner.post('owner_print_claim.php', { id, device: 'tablette-muette' });
  assert.equal(bienPlusTard.json.claimed, false);
  const vueFinale = commandeDansOwnerOrders(await owner.get('owner_orders.php'), id);
  assert.equal(vueFinale.print_job.status, 'failed');
  assert.equal(vueFinale.print_job.attempts, 1);
});

// DEUXIÈME boucle constatée en production le 22/11/2026 malgré le correctif ci-dessus (commande #94,
// 64 tentatives) : cause exacte non reproduite localement malgré de nombreux essais. Filet de sécurité
// indépendant ajouté dans reclamer() (serveur/impression.js) : la réclamation elle-même refuse désormais
// tout job dont les tentatives ont déjà atteint le plafond, MÊME SI la ligne est encore "pending" en base
// pour une raison imprévue — ce test force artificiellement cet état (impossible à produire autrement via
// l'API) pour vérifier que ce filet fonctionne indépendamment de reclasserClaimsBloques().
test('filet de sécurité indépendant : une tâche "pending" avec déjà le plafond de tentatives (état anormal, '
  + 'jamais produit par l\'API elle-même) n\'est quand même jamais réclamée au-delà du plafond', async () => {
  poserHorloge(AVANT_EPOCH);
  const client = await nouveauClient('printjob-garde-fou@example.test');
  const id = await commanderPlanifiee(client);
  await owner.post('owner_order_decide.php', { id, action: 'accept', delay_minutes: 30 });
  poserHorloge(DUE_EPOCH);
  // État anormal forcé directement en base (impossible via l'API normale) : "pending" avec déjà le plafond.
  db.prepare('UPDATE print_jobs SET attempts = ? WHERE order_id = ?').run(PRINT_MAX_ATTEMPTS, id);
  const claim = await owner.post('owner_print_claim.php', { id, device: 'tablette-test' });
  assert.equal(claim.json.claimed, false, 'le plafond doit bloquer la réclamation même si le statut est encore "pending"');
  const vue = commandeDansOwnerOrders(await owner.get('owner_orders.php'), id);
  assert.equal(vue.print_job.attempts, PRINT_MAX_ATTEMPTS, 'jamais incrémenté au-delà du plafond');
});

test('owner_print_claim.php / owner_print_ack.php : authentification et validation', async () => {
  const anon = new Client('anon-print');
  expectError(await anon.post('owner_print_claim.php', { id: 1 }), 401, 'unauthorized');
  expectError(await anon.post('owner_print_ack.php', { id: 1, outcome: 'dispatched' }), 401, 'unauthorized');
  expectError(await owner.post('owner_print_claim.php', { id: 'x' }), 422, 'validation');
  expectError(await owner.post('owner_print_ack.php', { id: 1, outcome: 'imprime' }), 422, 'validation');
  const inconnue = await owner.post('owner_print_claim.php', { id: 999999 });
  assert.equal(inconnue.status, 200);
  assert.equal(inconnue.json.claimed, false);
});
