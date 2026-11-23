// order_addendum_create.php — décision du 24/11/2026 : ajouter un article à une commande déjà passée
// n'est plus proposé en libre-service (voir serveur/routes/order_addendum_create.js), rejoignant
// kind='modify' (désactivé depuis le 22/11/2026, pour une raison différente — modifier un article déjà
// envoyé). Les deux kinds répondent maintenant 409 addendum_disabled, avec un message clair et le
// téléphone, jamais une erreur de validation générique — pour qu'un client resté sur une ancienne version
// du site le temps que la mise à jour se propage voie un message compréhensible. Ne touche plus jamais la
// base (aucun order_addenda, aucun order_addendum_items, aucun addendum_print_jobs, aucun total modifié).
// Lancer depuis la racine :  SUBITO_TEST_PORT=18430 node --test tests/api-vercel/order-addendum.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.SUBITO_TEST_PORT = String(Number(process.env.SUBITO_TEST_PORT || 8091) + 6);
const { Client, openTestDb, makeEnv, runTool, startServer, stopServer } = await import('./lib/harness.mjs');

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
    first_name: 'Addendum', last_name: 'Disabled', email, phone: '0612345678', password,
    street: '1 rue des Tests', city: 'Hénin-Beaumont', housing_type: 'maison'
  });
  assert.equal(r.status, 201, r.text);
  return c;
}

async function commander(client) {
  const r = await client.post('order_create.php', {
    idempotency_key: 'addendum-disabled-' + Date.now() + '-' + (++keySeq), mode: 'pickup',
    payment_methods: ['cash'], cash_change_for: null, hot_sauce: null,
    items: [{ name: 'Régina', variant: 'Duo', qty: 1, unit_price_cents: 1600, removed: [], extras: [], half: null, note: '' }],
    delivery_fee_cents: 0, total_cents: 1600
  });
  assert.equal(r.status, 201, r.text);
  return r.json.order.id;
}

for (const kind of ['add', 'modify']) {
  test(`order_addendum_create.php (kind='${kind}') répond toujours 409 addendum_disabled, avec le téléphone, sans rien enregistrer`, async () => {
    const cust = await nouveauClient(`addendum-disabled-${kind}@example.test`);
    const id = await commander(cust);
    const r = await cust.post('order_addendum_create.php', {
      order_id: id, idempotency_key: 'addendum-disabled-' + kind + '-' + Date.now(), kind,
      items: [{ name: 'Régina', variant: 'Duo', qty: 1, unit_price_cents: 1600, removed: [], extras: [], half: null, note: '' }],
      total_cents: 3200
    });
    expectError(r, 409, 'addendum_disabled');
    assert.equal(r.json.phone, '0321200033');
    assert.ok(r.json.message.toLowerCase().includes('appeler'), r.json.message);

    const n = Number(db.prepare('SELECT COUNT(*) AS n FROM order_addenda WHERE order_id = ?').get(id).n);
    assert.equal(n, 0, 'aucun order_addenda ne doit avoir été créé');
    const total = db.prepare('SELECT total_cents FROM orders WHERE id = ?').get(id).total_cents;
    assert.equal(Number(total), 1600, 'le total de la commande ne doit jamais changer');
  });
}

test('order_addendum_create.php : validation (champs manquants/invalides), méthode, authentification', async () => {
  const anon = new Client('addendum-disabled-anon');
  expectError(await anon.post('order_addendum_create.php', { order_id: 1, idempotency_key: 'x'.repeat(10), kind: 'add', items: [], total_cents: 0 }), 401, 'unauthorized');
  const cust = await nouveauClient('addendum-disabled-validation@example.test');
  expectError(await cust.post('order_addendum_create.php', {}), 422, 'validation');
  expectError(await cust.post('order_addendum_create.php', { order_id: -1, idempotency_key: 'x'.repeat(10), kind: 'add', total_cents: 0 }), 422, 'validation');
  expectError(await cust.post('order_addendum_create.php', { order_id: 1, idempotency_key: 'trop court', kind: 'add', total_cents: 0 }), 422, 'validation');
  expectError(await cust.post('order_addendum_create.php', { order_id: 1, idempotency_key: 'x'.repeat(10), kind: 'cancel', total_cents: 0 }), 422, 'validation');
  const getResp = await cust.request('GET', 'order_addendum_create.php');
  assert.equal(getResp.status, 405);
});
