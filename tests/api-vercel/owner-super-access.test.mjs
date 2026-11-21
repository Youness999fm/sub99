// Accès supérieur de l'espace patron : code distinct du code commerçant (OWNER_CODE_HASH), lui-même haché
// (SUPER_CODE_HASH), requis en plus de la session owner pour owner_customers.php (fiches clients) et
// owner_recette_clear.php (suppression définitive de la recette du jour). Le reste du contrat de
// owner_customers.php (recherche, pagination, 405/422) est déjà couvert par politique.test.mjs et api.test.mjs.
// Lancer depuis la racine du dépôt :  SUBITO_TEST_PORT=18430 node --test tests/api-vercel/owner-super-access.test.mjs
// Ce fichier prend le port SUBITO_TEST_PORT + 3 (les autres fichiers du dossier tournent en parallèle).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.SUBITO_TEST_PORT = String(Number(process.env.SUBITO_TEST_PORT || 8091) + 3);
const {
  OWNER_CODE, SUPER_CODE, Client, openTestDb, makeEnv, runTool, startServer, stopServer,
} = await import('./lib/harness.mjs');

const randomPassword = () => Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(18))).toString('base64url') + 'Aa1!';
const CUSTOMER_PASSWORD = randomPassword();

let ctx;
let server;
let db;

const anon = new Client('anon');
const owner = new Client('owner');
const cust = new Client('cust');

function expectError(r, status, code) {
  assert.equal(r.status, status, `${r.method} ${r.route} : ${r.text}`);
  assert.equal(r.json?.ok, false);
  assert.equal(r.json?.error, code, r.text);
  assert.equal(typeof r.json?.message, 'string');
}

const signupBody = (over = {}) => ({
  first_name: 'Léo', last_name: 'Démo', email: 'super-leo@example.test', phone: '06 00 00 00 02',
  password: CUSTOMER_PASSWORD, street: '1 rue de l\'exemple', city: 'Rouvroy', ...over,
});
const pizza = (name, variant, cents) => ({ name, variant, qty: 1, unit_price_cents: cents, removed: [], extras: [], half: null, note: '' });
let keySeq = 0;
const orderBody = (over = {}) => ({
  idempotency_key: `super-test-${Date.now()}-${++keySeq}`, mode: 'pickup', payment_methods: [], cash_change_for: null,
  hot_sauce: over.mode === 'delivery' ? true : null,
  items: [pizza('Régina', 'Duo', 1600)], delivery_fee_cents: 0, total_cents: 1600, ...over,
});

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

test('owner_customers.php : authentification et code supérieur', async (t) => {
  await t.test('sans session owner : 401 ; session client : 403', async () => {
    expectError(await anon.post('owner_customers.php', { code: SUPER_CODE, q: '' }), 401, 'unauthorized');
    const su = await cust.post('customer_signup.php', signupBody());
    assert.equal(su.status, 201, su.text);
    expectError(await cust.post('owner_customers.php', { code: SUPER_CODE, q: '' }), 403, 'forbidden');
  });

  await t.test('GET refusé (405)', async () => {
    const r = await owner.post('owner_login.php', { code: OWNER_CODE, remember: false });
    assert.equal(r.status, 200, r.text);
    expectError(await owner.get('owner_customers.php'), 405, 'method_not_allowed');
  });

  await t.test('session owner valide mais code supérieur manquant ou faux : 403 invalid_super_code, jamais déconnecté', async () => {
    expectError(await owner.post('owner_customers.php', { q: '' }), 403, 'invalid_super_code');
    expectError(await owner.post('owner_customers.php', { code: 'pas-le-bon-code', q: '' }), 403, 'invalid_super_code');
    // Un échec de code supérieur ne révoque pas la session owner (contrairement à un 401) :
    const me = await owner.get('owner_me.php');
    assert.equal(me.status, 200, me.text);
  });

  await t.test('code correct : renvoie la fiche du client inscrit plus haut', async () => {
    const r = await owner.post('owner_customers.php', { code: SUPER_CODE, q: 'super-leo' });
    assert.equal(r.status, 200, r.text);
    assert.ok(Array.isArray(r.json.customers));
    assert.equal(r.json.customers.length, 1);
    const c = r.json.customers[0];
    assert.equal(c.email, 'super-leo@example.test');
    assert.equal(c.first_name, 'Léo');
    assert.equal(c.last_name, 'Démo');
    assert.equal(c.phone, '06 00 00 00 02');
  });

  await t.test('q invalide (422) même avec le bon code', async () => {
    const r = await owner.post('owner_customers.php', { code: SUPER_CODE, q: 'x'.repeat(81) });
    expectError(r, 422, 'validation');
  });

  await t.test('trop de tentatives avec un faux code : 429 (verrou par IP)', async () => {
    // Adresse distincte : le verrou est par IP et ne doit pas geler owner_recette_clear.php
    // pour les autres clients (127.0.0.1) testés ensuite dans ce fichier.
    const fresh = new Client('owner-lock');
    fresh.ipParDefaut = '127.0.0.9';
    const l = await fresh.post('owner_login.php', { code: OWNER_CODE, remember: false });
    assert.equal(l.status, 200, l.text);
    let locked = null;
    for (let i = 0; i < 6; i++) {
      const r = await fresh.post('owner_customers.php', { code: 'faux-' + i, q: '' });
      if (r.status === 429) { locked = r; break; }
    }
    assert.ok(locked, 'devrait finir verrouillé après plusieurs échecs');
    expectError(locked, 429, 'too_many_attempts');
  });
});

test('owner_recette_clear.php : suppression définitive de la recette du jour', async (t) => {
  let orderId;

  await t.test('préparation : une commande du jour, acceptée', async () => {
    const r = await cust.post('order_create.php', orderBody());
    assert.equal(r.status, 201, r.text);
    orderId = r.json.order.id;
    const decide = await owner.post('owner_order_decide.php', { id: orderId, action: 'accept', delay_minutes: 20 });
    assert.equal(decide.status, 200, decide.text);
    assert.equal(decide.json.order.status, 'accepted');
  });

  await t.test('sans session owner : 401 ; code manquant : 403 invalid_super_code', async () => {
    expectError(await anon.post('owner_recette_clear.php', { code: SUPER_CODE }), 401, 'unauthorized');
    expectError(await owner.post('owner_recette_clear.php', {}), 403, 'invalid_super_code');
  });

  await t.test('code correct : la commande acceptée disparaît définitivement (orders + order_items)', async () => {
    const r = await owner.post('owner_recette_clear.php', { code: SUPER_CODE });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.deleted, 1, r.text);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM orders WHERE id = ?').get(orderId).n, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM order_items WHERE order_id = ?').get(orderId).n, 0);
    // Elle ne réapparaît nulle part : la file du commerçant ne la voit plus non plus.
    const liste = await owner.get('owner_orders.php');
    assert.ok(!liste.json.orders.some((o) => o.id === orderId));
  });

  await t.test('rien à supprimer : deleted = 0, pas d\'erreur', async () => {
    const r = await owner.post('owner_recette_clear.php', { code: SUPER_CODE });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.deleted, 0, r.text);
  });
});
