// Résilience face à une migration pas encore appliquée en production : order_addenda/order_addendum_items
// (ajout/modification) peuvent exister dans serveur/schema.js sans encore exister dans la vraie base
// Supabase (le schéma ne s'applique jamais tout seul au déploiement). Bug réel observé en production le
// 22/11/2026 : orderAddendaByOrder() (appelée par TOUTE réponse de commande, y compris order_create.php)
// n'avait aucune tolérance à l'absence de ces tables, contrairement à print_jobs (voir owner_orders.js) —
// une commande était enregistrée avec succès, mais la réponse plantait (500) juste après, affichée au
// client comme « connexion interrompue » alors que la commande existait bel et bien côté commerçant.
// Ce fichier reproduit l'absence des tables (DROP, jamais un schéma partiel deviné) et vérifie que la
// prise de commande reste utilisable malgré tout.
// Lancer depuis la racine :  SUBITO_TEST_PORT=18430 node --test tests/api-vercel/schema-resilience.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.SUBITO_TEST_PORT = String(Number(process.env.SUBITO_TEST_PORT || 8091) + 8);
const { Client, openTestDb, makeEnv, runTool, startServer, stopServer } = await import('./lib/harness.mjs');

const randomPassword = () => Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(18))).toString('base64url') + 'Aa1!';

let ctx;
let server;
let db;

before(async () => {
  ctx = makeEnv();
  const inst = await runTool(ctx, 'install.php');
  assert.equal(inst.code, 0, inst.stderr + inst.stdout);
  db = openTestDb(ctx);
  // Simule une base de production où la migration de cette mission n'a pas encore été appliquée :
  // les 3 tables neuves n'existent pas du tout (jamais un schéma partiel deviné — un DROP réel).
  db.exec('DROP TABLE order_addendum_items');
  db.exec('DROP TABLE addendum_print_jobs');
  db.exec('DROP TABLE order_addenda');
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
    first_name: 'Resilience', last_name: 'Test', email, phone: '0612345678', password,
    street: '1 rue des Tests', city: 'Hénin-Beaumont', housing_type: 'maison'
  });
  assert.equal(r.status, 201, r.text);
  return c;
}

test("order_create.php réussit encore (201) même si order_addenda/order_addendum_items/addendum_print_jobs n'existent pas", async () => {
  const cust = await nouveauClient('resilience-create@example.test');
  const r = await cust.post('order_create.php', {
    idempotency_key: 'resilience-' + Date.now(), mode: 'pickup',
    payment_methods: ['cash'], cash_change_for: null, hot_sauce: null,
    items: [{ name: 'Régina', variant: 'Duo', qty: 1, unit_price_cents: 1600, removed: [], extras: [], half: null, note: '' }],
    delivery_fee_cents: 0, total_cents: 1600
  });
  assert.equal(r.status, 201, `order_create.php n'a pas dû planter malgré les tables manquantes : ${r.text}`);
  assert.deepEqual(r.json.order.addenda ?? [], [], 'liste vide, pas une erreur, tant que la migration n\'est pas appliquée');
});

test('order_status.php reste consultable malgré les tables manquantes', async () => {
  const cust = await nouveauClient('resilience-status@example.test');
  const created = await cust.post('order_create.php', {
    idempotency_key: 'resilience-status-' + Date.now(), mode: 'pickup',
    payment_methods: ['cash'], cash_change_for: null, hot_sauce: null,
    items: [{ name: 'Régina', variant: 'Duo', qty: 1, unit_price_cents: 1600, removed: [], extras: [], half: null, note: '' }],
    delivery_fee_cents: 0, total_cents: 1600
  });
  assert.equal(created.status, 201, created.text);
  const r = await cust.get('order_status.php?id=' + created.json.order.id);
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.json.order.addenda, []);
});
