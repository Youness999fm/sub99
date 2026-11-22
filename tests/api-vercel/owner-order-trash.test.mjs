// Corbeille des commandes côté commerçant (soft-delete, jamais un vrai DELETE SQL) : owner_order_delete.php,
// owner_order_restore.php, owner_trash.php. Une commande encore "new"/"accepted" ne peut pas être mise à la
// corbeille (elle a encore besoin d'une action) ; une fois à la corbeille, elle disparaît de owner_orders.php
// mais reste visible via owner_trash.php, et peut être restaurée. Les deux routes sont idempotentes.
// Lancer depuis la racine :  SUBITO_TEST_PORT=18430 node --test tests/api-vercel/owner-order-trash.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.SUBITO_TEST_PORT = String(Number(process.env.SUBITO_TEST_PORT || 8091) + 9);
const { OWNER_CODE, Client, makeEnv, runTool, startServer, stopServer } = await import('./lib/harness.mjs');

const randomPassword = () => Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(18))).toString('base64url') + 'Aa1!';

let ctx;
let server;
let owner;
let keySeq = 0;

before(async () => {
  ctx = makeEnv();
  const inst = await runTool(ctx, 'install.php');
  assert.equal(inst.code, 0, inst.stderr + inst.stdout);
  server = await startServer(ctx);
  owner = new Client('owner-trash');
  assert.equal((await owner.post('owner_login.php', { code: OWNER_CODE, remember: false })).status, 200);
});

after(() => stopServer(server));

function expectError(r, status, code) {
  assert.equal(r.status, status, `${r.method} ${r.route} : ${r.text}`);
  assert.equal(r.json?.ok, false);
  assert.equal(r.json?.error, code, r.text);
}

async function nouvelleCommande(email, status) {
  const c = new Client('cust-' + email);
  const password = randomPassword();
  const signup = await c.post('customer_signup.php', {
    first_name: 'Corbeille', last_name: 'Test', email, phone: '0612345678', password,
    street: '1 rue des Tests', city: 'Hénin-Beaumont', housing_type: 'maison'
  });
  assert.equal(signup.status, 201, signup.text);
  const created = await c.post('order_create.php', {
    idempotency_key: 'trash-order-key-' + (++keySeq), mode: 'pickup',
    payment_methods: ['cash'], cash_change_for: null, hot_sauce: null,
    items: [{ name: 'Régina', variant: 'Duo', qty: 1, unit_price_cents: 1600, removed: [], extras: [], half: null, note: '' }],
    delivery_fee_cents: 0, total_cents: 1600
  });
  assert.equal(created.status, 201, created.text);
  const id = created.json.order.id;
  if (status === 'accepted' || status === 'ready') {
    assert.equal((await owner.post('owner_order_decide.php', { id, action: 'accept', delay_minutes: 20 })).status, 200);
  }
  if (status === 'ready') {
    assert.equal((await owner.post('owner_order_decide.php', { id, action: 'ready' })).status, 200);
  }
  if (status === 'refused') {
    assert.equal((await owner.post('owner_order_decide.php', { id, action: 'refuse' })).status, 200);
  }
  return id;
}

test("une commande encore 'new' ne peut pas être mise à la corbeille (409 not_deletable)", async () => {
  const id = await nouvelleCommande('trash-new@example.test', 'new');
  const r = await owner.post('owner_order_delete.php', { id });
  expectError(r, 409, 'not_deletable');
});

test("une commande encore 'accepted' ne peut pas être mise à la corbeille (409 not_deletable)", async () => {
  const id = await nouvelleCommande('trash-accepted@example.test', 'accepted');
  const r = await owner.post('owner_order_delete.php', { id });
  expectError(r, 409, 'not_deletable');
});

test("une commande 'refused' peut être mise à la corbeille, disparaît de owner_orders.php, reste dans owner_trash.php, et peut être restaurée", async () => {
  const id = await nouvelleCommande('trash-refused@example.test', 'refused');

  const del = await owner.post('owner_order_delete.php', { id });
  assert.equal(del.status, 200, del.text);
  assert.equal(del.json.replayed, false);
  assert.equal(typeof del.json.order.deleted_at, 'string');

  // Rejeu : idempotent, pas une erreur.
  const del2 = await owner.post('owner_order_delete.php', { id });
  assert.equal(del2.status, 200, del2.text);
  assert.equal(del2.json.replayed, true);

  const board = await owner.get('owner_orders.php');
  assert.equal(board.status, 200, board.text);
  assert.ok(!board.json.orders.some(o => o.id === id), "la commande supprimée ne doit plus apparaître dans la file du commerçant");

  const trash = await owner.get('owner_trash.php');
  assert.equal(trash.status, 200, trash.text);
  assert.ok(trash.json.orders.some(o => o.id === id), "la commande supprimée doit rester consultable dans la corbeille");

  const restore = await owner.post('owner_order_restore.php', { id });
  assert.equal(restore.status, 200, restore.text);
  assert.equal(restore.json.replayed, false);
  assert.equal(restore.json.order.deleted_at, null);

  const boardAfter = await owner.get('owner_orders.php');
  assert.ok(boardAfter.json.orders.some(o => o.id === id), "la commande restaurée doit réapparaître dans la file du commerçant");

  // Rejeu de la restauration : idempotent, pas une erreur.
  const restore2 = await owner.post('owner_order_restore.php', { id });
  assert.equal(restore2.status, 200, restore2.text);
  assert.equal(restore2.json.replayed, true);
});

test('une commande "ready" (prête, honorée) peut aussi être mise à la corbeille', async () => {
  const id = await nouvelleCommande('trash-ready@example.test', 'ready');
  const r = await owner.post('owner_order_delete.php', { id });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.order.status, 'ready');
  assert.equal(typeof r.json.order.deleted_at, 'string');
});

test('identifiant invalide : 422 ; commande introuvable : 404 ; un client ne peut pas appeler ces routes', async () => {
  expectError(await owner.post('owner_order_delete.php', { id: 'abc' }), 422, 'validation');
  expectError(await owner.post('owner_order_delete.php', { id: 999999 }), 404, 'not_found');
  expectError(await owner.post('owner_order_restore.php', { id: 999999 }), 404, 'not_found');

  const cust = new Client('cust-no-access');
  const password = randomPassword();
  assert.equal((await cust.post('customer_signup.php', {
    first_name: 'Sans', last_name: 'Accès', email: 'trash-no-access@example.test', phone: '0612345678',
    password, street: '1 rue des Tests', city: 'Hénin-Beaumont', housing_type: 'maison'
  })).status, 201);
  const forbidden = await cust.post('owner_order_delete.php', { id: 1 });
  assert.ok(forbidden.status === 401 || forbidden.status === 403, forbidden.text);
  const forbiddenTrash = await cust.get('owner_trash.php');
  assert.ok(forbiddenTrash.status === 401 || forbiddenTrash.status === 403, forbiddenTrash.text);
});
