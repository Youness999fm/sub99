// Ticket complémentaire (ajout/modification/annulation) : addendum_print_jobs, owner_addendum_print_claim.php,
// owner_addendum_print_ack.php — même cycle de vie que print_jobs (owner-print-jobs.test.mjs), miroir
// volontaire pour garantir qu'aucun comportement ne diverge, mais DÛ IMMÉDIATEMENT (pas de délai H-45).
// Horloge pilotée (SUBITO_TEST_CLOCK_FILE) : jamais une attente réelle de 120 s pour le reclassement.
// Lancer depuis la racine du dépôt :  SUBITO_TEST_PORT=18430 node --test tests/api-vercel/addendum-print-jobs.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

process.env.SUBITO_TEST_PORT = String(Number(process.env.SUBITO_TEST_PORT || 8091) + 7);
const { OWNER_CODE, Client, openTestDb, makeEnv, runTool, startServer, stopServer } = await import('./lib/harness.mjs');
const { PRINT_MAX_ATTEMPTS, PRINT_CLAIM_TIMEOUT_S } = await import('../../serveur/impression.js');

const randomPassword = () => Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(18))).toString('base64url') + 'Aa1!';

let ctx;
let server;
let db;
const owner = new Client('owner-addendum-print');
let keySeq = 0;

function expectError(r, status, code) {
  assert.equal(r.status, status, `${r.method} ${r.route} : ${r.text}`);
  assert.equal(r.json?.ok, false);
  assert.equal(r.json?.error, code, r.text);
}

const clockDir = mkdtempSync(path.join(process.env.SUBITO_TEST_DIR || tmpdir(), 'subito-addendum-print-clock-'));
const clockFile = path.join(clockDir, 'horloge.txt');
function poserHorloge(e) { writeFileSync(clockFile, String(e)); }
const BASE_EPOCH = Math.floor(Date.now() / 1000);
const REGINA_DUO = 1600;

before(async () => {
  ctx = makeEnv();
  ctx.env.SUBITO_TEST_CLOCK_FILE = clockFile;
  poserHorloge(BASE_EPOCH);
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

async function nouveauClient(email) {
  const c = new Client('cust-' + email);
  const password = randomPassword();
  const r = await c.post('customer_signup.php', {
    first_name: 'Addendum', last_name: 'Print', email, phone: '0612345678', password,
    street: '1 rue des Tests', city: 'Hénin-Beaumont', housing_type: 'maison'
  });
  assert.equal(r.status, 201, r.text);
  return c;
}

async function commander(client) {
  const r = await client.post('order_create.php', {
    idempotency_key: 'addendum-print-' + Date.now() + '-' + (++keySeq), mode: 'pickup',
    payment_methods: ['cash'], cash_change_for: null, hot_sauce: null,
    items: [{ name: 'Régina', variant: 'Duo', qty: 1, unit_price_cents: REGINA_DUO, removed: [], extras: [], half: null, note: '' }],
    delivery_fee_cents: 0, total_cents: REGINA_DUO
  });
  assert.equal(r.status, 201, r.text);
  return r.json.order.id;
}

/** Ajoute une pizza à la commande ; retourne l'id de l'addenda créé (et sa tâche d'impression, due immédiatement). */
async function ajouterPizza(client, orderId) {
  const r = await client.post('order_addendum_create.php', {
    order_id: orderId, idempotency_key: 'addendum-print-add-' + Date.now() + '-' + (++keySeq), kind: 'add',
    items: [{ name: 'Régina', variant: 'Duo', qty: 1, unit_price_cents: REGINA_DUO, removed: [], extras: [], half: null, note: '' }],
    total_cents: 2 * REGINA_DUO - REGINA_DUO
  });
  assert.equal(r.status, 201, r.text);
  return r.json.addendum.id;
}

test("un ajout crée immédiatement une tâche d'impression pending (jamais de délai H-45)", async () => {
  poserHorloge(BASE_EPOCH + 10_000);
  const client = await nouveauClient('addprint1@example.test');
  const orderId = await commander(client);
  const addendumId = await ajouterPizza(client, orderId);

  const job = db.prepare('SELECT * FROM addendum_print_jobs WHERE addendum_id = ?').get(addendumId);
  assert.ok(job, 'tâche absente');
  assert.equal(job.status, 'pending');
  assert.equal(Number(job.attempts), 0);

  // Due tout de suite, sans avancer l'horloge : contrairement à print_jobs, pas de print_due_at à atteindre.
  const claim = await owner.post('owner_addendum_print_claim.php', { id: addendumId, device: 'tablette-test' });
  assert.equal(claim.status, 200, claim.text);
  assert.equal(claim.json.claimed, true);
  assert.equal(claim.json.job.status, 'claimed');
  assert.equal(claim.json.job.attempts, 1);
});

test("rejeu de l'ajout (même idempotency_key) : la tâche n'est pas dupliquée", async () => {
  poserHorloge(BASE_EPOCH + 20_000);
  const client = await nouveauClient('addprint-rejeu@example.test');
  const orderId = await commander(client);
  const cle = 'addendum-print-fixe-' + Date.now();
  const body = {
    order_id: orderId, idempotency_key: cle, kind: 'add',
    items: [{ name: 'Régina', variant: 'Duo', qty: 1, unit_price_cents: REGINA_DUO, removed: [], extras: [], half: null, note: '' }],
    total_cents: 2 * REGINA_DUO - REGINA_DUO
  };
  const a1 = await client.post('order_addendum_create.php', body);
  assert.equal(a1.status, 201, a1.text);
  const a2 = await client.post('order_addendum_create.php', body);
  assert.equal(a2.status, 200);
  assert.equal(a2.json.replayed, true);
  const n = db.prepare('SELECT COUNT(*) AS n FROM addendum_print_jobs WHERE addendum_id = ?').get(a1.json.addendum.id).n;
  assert.equal(Number(n), 1, 'une seule tâche malgré le rejeu');
});

test('cycle complet : réclamée -> remise réussie (dispatched), plus réclamable ensuite', async () => {
  poserHorloge(BASE_EPOCH + 30_000);
  const client = await nouveauClient('addprint-cycle@example.test');
  const orderId = await commander(client);
  const addendumId = await ajouterPizza(client, orderId);

  const claim = await owner.post('owner_addendum_print_claim.php', { id: addendumId, device: 'tablette-test' });
  assert.equal(claim.json.claimed, true);
  assert.equal(claim.json.job.attempts, 1);

  // Une 2e tablette qui sonde au même instant n'obtient rien (réclamation atomique, même garantie I9 que print_jobs).
  const concurrent = await owner.post('owner_addendum_print_claim.php', { id: addendumId, device: 'tablette-2' });
  assert.equal(concurrent.json.claimed, false);

  const ack = await owner.post('owner_addendum_print_ack.php', { id: addendumId, outcome: 'dispatched' });
  assert.equal(ack.status, 200, ack.text);
  assert.equal(ack.json.status, 'dispatched');

  const reclaim = await owner.post('owner_addendum_print_claim.php', { id: addendumId, device: 'tablette-test' });
  assert.equal(reclaim.json.claimed, false, 'plus réclamable (déjà dispatched)');
});

test("échec signalé : nouvel essai automatique jusqu'au plafond, puis failed définitif", async () => {
  poserHorloge(BASE_EPOCH + 40_000);
  const client = await nouveauClient('addprint-echec@example.test');
  const orderId = await commander(client);
  const addendumId = await ajouterPizza(client, orderId);

  for (let essai = 1; essai <= PRINT_MAX_ATTEMPTS; essai++) {
    const claim = await owner.post('owner_addendum_print_claim.php', { id: addendumId, device: 'tablette-test' });
    assert.equal(claim.json.claimed, true, `essai ${essai} : devrait être réclamable`);
    assert.equal(claim.json.job.attempts, essai);
    const ack = await owner.post('owner_addendum_print_ack.php', { id: addendumId, outcome: 'failed', error: 'imprimante hors ligne' });
    const dernier = essai === PRINT_MAX_ATTEMPTS;
    assert.equal(ack.json.status, dernier ? 'failed' : 'pending', `essai ${essai}`);
  }
  const apresPlafond = await owner.post('owner_addendum_print_claim.php', { id: addendumId, device: 'tablette-test' });
  assert.equal(apresPlafond.json.claimed, false);
  const job = db.prepare('SELECT * FROM addendum_print_jobs WHERE addendum_id = ?').get(addendumId);
  assert.equal(job.status, 'failed');
  assert.equal(job.last_error, 'imprimante hors ligne');
});

test('tablette disparue en plein envoi : la tâche « claimed » bloquée redevient pending (même règle que print_jobs, 120 s)', async () => {
  const t0 = BASE_EPOCH + 50_000;
  poserHorloge(t0);
  const client = await nouveauClient('addprint-bloque@example.test');
  const orderId = await commander(client);
  const addendumId = await ajouterPizza(client, orderId);

  const claim = await owner.post('owner_addendum_print_claim.php', { id: addendumId, device: 'tablette-perdue' });
  assert.equal(claim.json.claimed, true);
  // Jamais d'accusé de réception (tablette éteinte). On avance l'horloge au-delà du délai de blocage.
  poserHorloge(t0 + PRINT_CLAIM_TIMEOUT_S + 5);

  const relance = await owner.post('owner_addendum_print_claim.php', { id: addendumId, device: 'autre-tablette' });
  assert.equal(relance.json.claimed, true, 'redevenue réclamable après le délai de blocage');
  assert.equal(relance.json.job.attempts, 2);
});

test("le ticket complémentaire d'un ajout ne contient JAMAIS les articles déjà transmis (contenu exact du ticket)", async () => {
  poserHorloge(BASE_EPOCH + 60_000);
  const client = await nouveauClient('addprint-contenu@example.test');
  const orderId = await commander(client); // 1 Régina Duo d'origine
  const addR = await client.post('order_addendum_create.php', {
    order_id: orderId, idempotency_key: 'addendum-print-contenu-' + Date.now(), kind: 'add',
    items: [
      { name: 'Régina', variant: 'Duo', qty: 1, unit_price_cents: REGINA_DUO, removed: [], extras: [], half: null, note: '' },
      { name: '3 Jambons', variant: 'Duo', qty: 1, unit_price_cents: REGINA_DUO, removed: [], extras: [], half: null, note: '' }
    ],
    total_cents: 3 * REGINA_DUO - REGINA_DUO
  });
  assert.equal(addR.status, 201, addR.text);
  assert.equal(addR.json.addendum.items.length, 2, "le ticket complémentaire contient les 2 NOUVEAUX articles");
  const noms = addR.json.addendum.items.map((it) => it.name).sort();
  assert.deepEqual(noms, ['3 Jambons', 'Régina'].sort());
  // order.items (ce qui a déjà été transmis au commerçant à l'origine) reste à 1 ligne, jamais mélangé avec l'ajout.
  assert.equal(addR.json.order.items.length, 1, "order_items (déjà transmis) n'est jamais réécrit par un ajout");
});

test('owner_orders.php expose print_pending par addenda (tablette) : true tant que non réclamé/remis, false ensuite', async () => {
  poserHorloge(BASE_EPOCH + 70_000);
  const client = await nouveauClient('addprint-ownerorders@example.test');
  const orderId = await commander(client);
  const addendumId = await ajouterPizza(client, orderId);

  const avant = await owner.get('owner_orders.php');
  const ordreAvant = avant.json.orders.find((o) => o.id === orderId);
  assert.ok(ordreAvant, 'commande absente de owner_orders.php');
  const addendaAvant = ordreAvant.addenda.find((a) => a.id === addendumId);
  assert.ok(addendaAvant, 'addenda absent de la vue owner_orders.php');
  assert.equal(addendaAvant.print_pending, true, 'due dès la création, sans délai H-45');
  assert.equal(addendaAvant.print_job.status, 'pending');

  await owner.post('owner_addendum_print_claim.php', { id: addendumId, device: 'tablette-test' });
  await owner.post('owner_addendum_print_ack.php', { id: addendumId, outcome: 'dispatched' });

  const apres = await owner.get('owner_orders.php');
  const addendaApres = apres.json.orders.find((o) => o.id === orderId).addenda.find((a) => a.id === addendumId);
  assert.equal(addendaApres.print_pending, false, 'remis avec succès : plus en attente');
  assert.equal(addendaApres.print_job.status, 'dispatched');
});

test('owner_addendum_print_claim.php / owner_addendum_print_ack.php : authentification et validation', async () => {
  const anon = new Client('anon-addendum-print');
  expectError(await anon.post('owner_addendum_print_claim.php', { id: 1 }), 401, 'unauthorized');
  expectError(await anon.post('owner_addendum_print_ack.php', { id: 1, outcome: 'dispatched' }), 401, 'unauthorized');
  expectError(await owner.post('owner_addendum_print_claim.php', { id: 'x' }), 422, 'validation');
  expectError(await owner.post('owner_addendum_print_ack.php', { id: 1, outcome: 'imprime' }), 422, 'validation');
  const inconnue = await owner.post('owner_addendum_print_claim.php', { id: 999999 });
  assert.equal(inconnue.status, 200);
  assert.equal(inconnue.json.claimed, false);
});
