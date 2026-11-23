// order_cancel.php — décision du 24/11/2026 : annuler une commande déjà passée n'est plus proposé en
// libre-service (voir serveur/routes/order_cancel.js). La route répond toujours 409 cancel_disabled avec
// un message clair et le téléphone, jamais une erreur de validation générique — pour qu'un client resté
// sur une ancienne version du site le temps que la mise à jour se propage voie un message compréhensible
// plutôt qu'un échec muet. Ne touche plus jamais la base (aucune colonne, aucun order_addenda).
// Lancer depuis la racine :  SUBITO_TEST_PORT=18430 node --test tests/api-vercel/order-cancel.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.SUBITO_TEST_PORT = String(Number(process.env.SUBITO_TEST_PORT || 8091) + 5);
const { OWNER_CODE, Client, openTestDb, makeEnv, runTool, startServer, stopServer } = await import('./lib/harness.mjs');

const randomPassword = () => Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(18))).toString('base64url') + 'Aa1!';

let ctx;
let server;
let db;
let keySeq = 0;

function expectError(r, status, code) {
  assert.equal(r.status, status, `${r.method} ${r.route} : ${r.text}`);
  assert.equal(r.json?.ok, false);
  assert.equal(r.json?.error, code, r.text);
}

before(async () => {
  ctx = makeEnv();
  const inst = await runTool(ctx, 'install.php');
  assert.equal(inst.code, 0, inst.stderr + inst.stdout);
  db = openTestDb(ctx);
  server = await startServer(ctx);
});

after(() => {
  stopServer(server);
  try { db?.close(); } catch { /* déjà fermée */ }
});

async function nouveauClient(email) {
  const c = new Client('cust-' + email);
  const password = randomPassword();
  const r = await c.post('customer_signup.php', {
    first_name: 'Cancel', last_name: 'Disabled', email, phone: '0612345678', password,
    street: '1 rue des Tests', city: 'Hénin-Beaumont', housing_type: 'maison'
  });
  assert.equal(r.status, 201, r.text);
  return c;
}

async function commander(client) {
  const body = {
    idempotency_key: 'cancel-disabled-' + Date.now() + '-' + (++keySeq), mode: 'pickup',
    payment_methods: ['cash'], cash_change_for: null, hot_sauce: null,
    items: [{ name: 'Régina', variant: 'Duo', qty: 1, unit_price_cents: 1600, removed: [], extras: [], half: null, note: '' }],
    delivery_fee_cents: 0, total_cents: 1600
  };
  const r = await client.post('order_create.php', body);
  assert.equal(r.status, 201, r.text);
  return r.json.order.id;
}

test('order_cancel.php répond toujours 409 cancel_disabled, avec le téléphone, sans toucher la commande', async () => {
  const cust = await nouveauClient('cancel-disabled-1@example.test');
  const id = await commander(cust);
  const r = await cust.post('order_cancel.php', { id });
  expectError(r, 409, 'cancel_disabled');
  assert.equal(r.json.phone, '0321200033');
  assert.ok(r.json.message.toLowerCase().includes('appeler'), r.json.message);

  const row = db.prepare('SELECT status, cancel_requested_at, cancelled_at FROM orders WHERE id = ?').get(id);
  assert.equal(row.status, 'new', 'le statut ne doit jamais bouger');
  assert.equal(row.cancel_requested_at, null);
  assert.equal(row.cancelled_at, null);
});

test('order_cancel.php : 409 même sur une commande déjà acceptée, ou demandée par un autre client que celui qui l\'a passée', async () => {
  const cust = await nouveauClient('cancel-disabled-2@example.test');
  const id = await commander(cust);

  const owner = new Client('owner-cancel-disabled');
  assert.equal((await owner.post('owner_login.php', { code: OWNER_CODE, remember: false })).status, 200);
  assert.equal((await owner.post('owner_order_decide.php', { id, action: 'accept', delay_minutes: 20 })).status, 200);

  expectError(await cust.post('order_cancel.php', { id }), 409, 'cancel_disabled');

  const autre = await nouveauClient('cancel-disabled-autre@example.test');
  // La route est désactivée pour tout le monde, sans exception : même un autre client (qui n'est pas
  // propriétaire de cette commande) reçoit le même 409, jamais un 404 qui confirmerait son existence.
  expectError(await autre.post('order_cancel.php', { id }), 409, 'cancel_disabled');
});

test('order_cancel.php : validation (identifiant manquant/invalide), méthode, authentification', async () => {
  const anon = new Client('cancel-disabled-anon');
  expectError(await anon.post('order_cancel.php', { id: 1 }), 401, 'unauthorized');
  const cust = await nouveauClient('cancel-disabled-validation@example.test');
  expectError(await cust.post('order_cancel.php', {}), 422, 'validation');
  expectError(await cust.post('order_cancel.php', { id: -1 }), 422, 'validation');
  expectError(await cust.post('order_cancel.php', { id: 'x' }), 422, 'validation');
  const getResp = await cust.request('GET', 'order_cancel.php');
  assert.equal(getResp.status, 405);
});
