// Annulation client (order_cancel.php) : fenêtre stricte de 4 minutes depuis orders.created_at, jamais
// accepted_at, jamais réinitialisée. Horloge pilotée (SUBITO_TEST_CLOCK_FILE) : bornes testées à la seconde
// exacte, jamais une attente réelle. Lancer depuis la racine :  SUBITO_TEST_PORT=18430 node --test tests/api-vercel/order-cancel.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

process.env.SUBITO_TEST_PORT = String(Number(process.env.SUBITO_TEST_PORT || 8091) + 5);
const { OWNER_CODE, Client, openTestDb, makeEnv, runTool, startServer, stopServer } = await import('./lib/harness.mjs');
const { CANCEL_WINDOW_S } = await import('../../serveur/orders.js');

const randomPassword = () => Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(18))).toString('base64url') + 'Aa1!';

let ctx;
let server;
let db;
const owner = new Client('owner-cancel');
let keySeq = 0;

function expectError(r, status, code) {
  assert.equal(r.status, status, `${r.method} ${r.route} : ${r.text}`);
  assert.equal(r.json?.ok, false);
  assert.equal(r.json?.error, code, r.text);
}

const clockDir = mkdtempSync(path.join(process.env.SUBITO_TEST_DIR || tmpdir(), 'subito-cancel-clock-'));
const clockFile = path.join(clockDir, 'horloge.txt');
function poserHorloge(e) { writeFileSync(clockFile, String(e)); }
const BASE_EPOCH = Math.floor(Date.now() / 1000);

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
    first_name: 'Cancel', last_name: 'Test', email, phone: '0612345678', password,
    street: '1 rue des Tests', city: 'Hénin-Beaumont', housing_type: 'maison'
  });
  assert.equal(r.status, 201, r.text);
  return c;
}

/** Commande « dès que possible » (à emporter, simple) ; retourne son id. L'horloge doit déjà être posée. */
async function commander(client) {
  const body = {
    idempotency_key: 'cancel-test-' + Date.now() + '-' + (++keySeq), mode: 'pickup',
    payment_methods: ['cash'], cash_change_for: null, hot_sauce: null,
    items: [{ name: 'Régina', variant: 'Duo', qty: 1, unit_price_cents: 1600, removed: [], extras: [], half: null, note: '' }],
    delivery_fee_cents: 0, total_cents: 1600
  };
  const r = await client.post('order_create.php', body);
  assert.equal(r.status, 201, r.text);
  return r.json.order.id;
}

test('fenêtre à la seconde exacte : 239 s acceptée, 240 s et 241 s refusées (too_late)', async () => {
  const t0 = BASE_EPOCH + 10_000;
  poserHorloge(t0);
  const cust = await nouveauClient('cancel-fenetre@example.test');
  const id1 = await commander(cust);
  poserHorloge(t0 + 239);
  const r1 = await cust.post('order_cancel.php', { id: id1 });
  assert.equal(r1.status, 200, r1.text);
  assert.equal(r1.json.replayed, false);
  assert.equal(r1.json.order.status, 'cancelled');

  poserHorloge(t0);
  const id2 = await commander(cust);
  poserHorloge(t0 + 240);
  expectError(await cust.post('order_cancel.php', { id: id2 }), 409, 'too_late');

  poserHorloge(t0);
  const id3 = await commander(cust);
  poserHorloge(t0 + 241);
  expectError(await cust.post('order_cancel.php', { id: id3 }), 409, 'too_late');
});

test('rejeu : annuler deux fois répond replayed:true la 2e fois, jamais une erreur', async () => {
  const t0 = BASE_EPOCH + 20_000;
  poserHorloge(t0);
  const cust = await nouveauClient('cancel-rejeu@example.test');
  const id = await commander(cust);
  poserHorloge(t0 + 5);
  const r1 = await cust.post('order_cancel.php', { id });
  assert.equal(r1.status, 200, r1.text);
  assert.equal(r1.json.replayed, false);
  // Rejeu dans la fenêtre.
  const r2 = await cust.post('order_cancel.php', { id });
  assert.equal(r2.status, 200, r2.text);
  assert.equal(r2.json.replayed, true);
  assert.equal(r2.json.order.status, 'cancelled');
  // Rejeu hors fenêtre (déjà annulée : jamais too_late pour une opération déjà effectuée).
  poserHorloge(t0 + 300);
  const r3 = await cust.post('order_cancel.php', { id });
  assert.equal(r3.status, 200, r3.text);
  assert.equal(r3.json.replayed, true);
});

test('double-clic concurrent : une seule transition effective, le second appel est un rejeu', async () => {
  const t0 = BASE_EPOCH + 30_000;
  poserHorloge(t0);
  const cust = await nouveauClient('cancel-double-clic@example.test');
  const id = await commander(cust);
  poserHorloge(t0 + 5);
  const [r1, r2] = await Promise.all([cust.post('order_cancel.php', { id }), cust.post('order_cancel.php', { id })]);
  assert.equal(r1.status, 200, r1.text);
  assert.equal(r2.status, 200, r2.text);
  const replayedFlags = [r1.json.replayed, r2.json.replayed].sort();
  assert.deepEqual(replayedFlags, [false, true], 'exactement un replayed:false (la transition) et un replayed:true');
  assert.equal(Number(db.prepare("SELECT COUNT(*) AS n FROM orders WHERE id = ? AND status = 'cancelled'").get(id).n), 1);
});

test('déjà accepté : annulation toujours autorisée dans la fenêtre, alerte commerçant créée (order_addenda + addendum_print_jobs)', async () => {
  const t0 = BASE_EPOCH + 40_000;
  poserHorloge(t0);
  const cust = await nouveauClient('cancel-accepte@example.test');
  const id = await commander(cust);
  poserHorloge(t0 + 2);
  assert.equal((await owner.post('owner_order_decide.php', { id, action: 'accept', delay_minutes: 20 })).status, 200);

  poserHorloge(t0 + 100);
  const r = await cust.post('order_cancel.php', { id });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.order.status, 'cancelled');

  const addendum = db.prepare("SELECT * FROM order_addenda WHERE order_id = ? AND kind = 'cancel'").get(id);
  assert.ok(addendum, 'un événement order_addenda de type cancel doit exister');
  assert.equal(addendum.seq, 1);
  const job = db.prepare('SELECT * FROM addendum_print_jobs WHERE addendum_id = ?').get(addendum.id);
  assert.ok(job, 'une tâche addendum_print_jobs doit être créée pour alerter le commerçant');
  assert.equal(job.status, 'pending');
});

test('pas encore accepté (status new) : annulée sans alerte commerçant (rien à interrompre)', async () => {
  const t0 = BASE_EPOCH + 50_000;
  poserHorloge(t0);
  const cust = await nouveauClient('cancel-new@example.test');
  const id = await commander(cust);
  poserHorloge(t0 + 2);
  const r = await cust.post('order_cancel.php', { id });
  assert.equal(r.status, 200, r.text);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM order_addenda WHERE order_id = ?").get(id).n, 0, 'aucune alerte nécessaire : le commerçant ne l\'avait jamais vue');
});

test('statuts non annulables : ready et refused -> 409 not_cancellable, même dans la fenêtre', async () => {
  const t0 = BASE_EPOCH + 60_000;
  poserHorloge(t0);
  const cust = await nouveauClient('cancel-ready@example.test');
  const idReady = await commander(cust);
  poserHorloge(t0 + 1);
  assert.equal((await owner.post('owner_order_decide.php', { id: idReady, action: 'accept', delay_minutes: 0 })).status, 200);
  assert.equal((await owner.post('owner_order_decide.php', { id: idReady, action: 'ready' })).status, 200);
  poserHorloge(t0 + 2);
  expectError(await cust.post('order_cancel.php', { id: idReady }), 409, 'not_cancellable');

  const idRefused = await commander(cust);
  poserHorloge(t0 + 3);
  assert.equal((await owner.post('owner_order_decide.php', { id: idRefused, action: 'refuse' })).status, 200);
  expectError(await cust.post('order_cancel.php', { id: idRefused }), 409, 'not_cancellable');
});

test("isolation : un autre client ne peut pas annuler la commande d'un client différent", async () => {
  const t0 = BASE_EPOCH + 70_000;
  poserHorloge(t0);
  const custA = await nouveauClient('cancel-a@example.test');
  const custB = await nouveauClient('cancel-b@example.test');
  const id = await commander(custA);
  poserHorloge(t0 + 2);
  expectError(await custB.post('order_cancel.php', { id }), 404, 'not_found');
});

test('validation : identifiant manquant/invalide -> 422 ; GET -> 405 ; sans session -> 401', async () => {
  const anon = new Client('cancel-anon');
  expectError(await anon.post('order_cancel.php', { id: 1 }), 401, 'unauthorized');
  const cust = await nouveauClient('cancel-validation@example.test');
  expectError(await cust.post('order_cancel.php', {}), 422, 'validation');
  expectError(await cust.post('order_cancel.php', { id: -1 }), 422, 'validation');
  expectError(await cust.post('order_cancel.php', { id: 'x' }), 422, 'validation');
  const getResp = await cust.request('GET', 'order_cancel.php');
  assert.equal(getResp.status, 405);
});

test('champs exposés par order_status/order_create : cancel_eligible_until et can_cancel cohérents', async () => {
  const t0 = BASE_EPOCH + 80_000;
  poserHorloge(t0);
  const cust = await nouveauClient('cancel-champs@example.test');
  const id = await commander(cust);
  poserHorloge(t0 + 10);
  const r = await cust.get('order_status.php?id=' + id);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.order.can_cancel, true);
  assert.equal(r.json.order.cancel_eligible_until, new Date((t0 + CANCEL_WINDOW_S) * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z'));
  poserHorloge(t0 + CANCEL_WINDOW_S);
  const r2 = await cust.get('order_status.php?id=' + id);
  assert.equal(r2.json.order.can_cancel, false, 'exactement à CANCEL_WINDOW_S : plus annulable');
});
