// Suppression d'un client (owner_customer_delete.php, décision du 24/11/2026), accès supérieur uniquement :
// supprimé pour de bon s'il n'a jamais commandé, anonymisé (nom/e-mail/téléphone/adresse effacés, mot de
// passe invalidé, sessions révoquées) s'il a déjà commandé — son historique de commandes, lui, garde sa
// propre copie du nom/téléphone/adresse (order_create.js) et n'est donc jamais perdu.
// Lancer depuis la racine du dépôt :  SUBITO_TEST_PORT=18430 node --test tests/api-vercel/owner-customer-delete.test.mjs
// Ce fichier prend le port SUBITO_TEST_PORT + 7 (les autres fichiers du dossier tournent en parallèle).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.SUBITO_TEST_PORT = String(Number(process.env.SUBITO_TEST_PORT || 8091) + 7);
const { OWNER_CODE, SUPER_CODE, Client, openTestDb, makeEnv, runTool, startServer, stopServer } = await import('./lib/harness.mjs');

let ctx;
let server;
let db;
const owner = new Client('owner-custdel');

function expectError(r, status, code) {
  assert.equal(r.status, status, `${r.method} ${r.route} : ${r.text}`);
  assert.equal(r.json?.ok, false);
  assert.equal(r.json?.error, code, r.text);
}

const randomPassword = () => Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(18))).toString('base64url') + 'Aa1!';

before(async () => {
  ctx = makeEnv();
  assert.equal((await runTool(ctx, 'install.php')).code, 0);
  db = openTestDb(ctx);
  server = await startServer(ctx);
  assert.equal((await owner.post('owner_login.php', { code: OWNER_CODE, remember: false })).status, 200);
});
after(() => { try { db?.close(); } catch { /* déjà fermée */ } return stopServer(server); });

async function nouveauClient(email) {
  const c = new Client('cust-' + email);
  const r = await c.post('customer_signup.php', {
    first_name: 'Test', last_name: 'Delete', email, phone: '06 00 00 00 ' + (email.length % 90),
    password: randomPassword(), street: '1 rue des Tests', city: 'Hénin-Beaumont', housing_type: 'maison'
  });
  assert.equal(r.status, 201, r.text);
  return { client: c, id: r.json.customer.id };
}

test('réservé au code supérieur (session commerçant seule insuffisante)', async () => {
  const { id } = await nouveauClient('custdel-nosup@example.test');
  expectError(await owner.post('owner_customer_delete.php', { id, code: 'faux-code' }), 403, 'invalid_super_code');
  // Toujours là.
  const ligne = db.prepare('SELECT id FROM customers WHERE id = ?').get(id);
  assert.ok(ligne);
});

test('id invalide ou client introuvable', async () => {
  expectError(await owner.post('owner_customer_delete.php', { id: 'abc', code: SUPER_CODE }), 422, 'validation');
  expectError(await owner.post('owner_customer_delete.php', { id: 999999, code: SUPER_CODE }), 404, 'not_found');
});

test('client jamais commandé : supprimé pour de bon', async () => {
  const { id } = await nouveauClient('custdel-jamais@example.test');
  const r = await owner.post('owner_customer_delete.php', { id, code: SUPER_CODE });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.deleted, true);
  assert.equal(r.json.anonymized, false);
  assert.equal(db.prepare('SELECT id FROM customers WHERE id = ?').get(id), undefined);
});

test('client avec au moins une commande : anonymisé, pas supprimé, historique intact', async () => {
  const { client, id } = await nouveauClient('custdel-commande@example.test');
  const order = await client.post('order_create.php', {
    idempotency_key: 'custdel-order-1', mode: 'pickup', payment_methods: [], cash_change_for: null,
    items: [{ name: 'Régina', variant: 'Duo', qty: 1, unit_price_cents: 1600, removed: [], extras: [], half: null, note: '' }],
    delivery_fee_cents: 0, total_cents: 1600
  });
  assert.equal(order.status, 201, order.text);
  const nomOriginal = order.json.order.customer_name;

  const r = await owner.post('owner_customer_delete.php', { id, code: SUPER_CODE });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.deleted, true);
  assert.equal(r.json.anonymized, true);

  // La fiche client existe toujours (contrainte FK orders.customer_id ON DELETE RESTRICT) mais est vidée.
  const ligne = db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
  assert.ok(ligne, 'la fiche doit rester (sinon la commande serait orpheline)');
  assert.equal(ligne.first_name, 'Client');
  assert.equal(ligne.last_name, 'supprimé');
  assert.match(ligne.email, /^client-supprime-/);
  assert.notEqual(ligne.phone, '06 00 00 00 ' + (('custdel-commande@example.test').length % 90));
  assert.equal(ligne.street, null);
  assert.equal(ligne.city, null);
  assert.equal(ligne.housing_type, null);

  // L'historique de la commande garde sa PROPRE copie du nom (prise au moment de la commande) : intact.
  const commandeApres = db.prepare('SELECT customer_first_name, customer_last_name FROM orders WHERE id = ?').get(order.json.order.id);
  assert.equal(`${commandeApres.customer_first_name} ${commandeApres.customer_last_name}`, nomOriginal);

  // Le compte ne peut plus se connecter (mot de passe invalidé) ni être retrouvé par recherche.
  const recherche = await owner.post('owner_customers.php', { code: SUPER_CODE, q: 'custdel-commande' });
  assert.equal(recherche.status, 200, recherche.text);
  assert.equal(recherche.json.customers.find((c) => c.id === id), undefined, 'ne doit plus être retrouvable par son ancien e-mail/nom');
});

test('sessions actives révoquées après suppression/anonymisation', async () => {
  const { client, id } = await nouveauClient('custdel-session@example.test');
  const r = await owner.post('owner_customer_delete.php', { id, code: SUPER_CODE });
  assert.equal(r.status, 200, r.text);
  // Session créée à l'inscription : révoquée, le client ne doit plus pouvoir s'en servir.
  const moi = await client.get('customer_me.php');
  assert.equal(moi.status, 200, moi.text);
  assert.equal(moi.json.customer, null, 'la session doit être révoquée, le client redevient invité');
});
