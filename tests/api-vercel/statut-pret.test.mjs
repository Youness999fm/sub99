// Statut « prête » : accepted -> ready par le commerçant, visible par le client (suivi et compte), sans doublon ni retour arrière.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, openTestDb, runTool, startServer, stopServer, Client, OWNER_CODE } from './lib/harness.mjs';

let ctx;
let proc;
let db;
let owner;
let alice;
let bob;
let seq = 0;

const pizza = (name, variant, cents, qty = 1) => ({ name, variant, qty, unit_price_cents: cents, removed: [], extras: [], half: null, note: '' });
const orderBody = () => ({
  idempotency_key: `pret-${Date.now()}-${++seq}`, mode: 'pickup', payment_methods: [], cash_change_for: null,
  items: [pizza('Régina', 'Duo', 1600)], delivery_fee_cents: 0, total_cents: 1600
});
const signup = (email) => ({ first_name: 'Test', last_name: email.split('@')[0], email, phone: '06 00 00 00 01', password: 'Motdepasse-' + email.length + 'xA', street: null, city: null });

async function creerCommande(client = alice) {
  const r = await client.post('order_create.php', orderBody());
  assert.equal(r.status, 201, r.text);
  return r.json.order.id;
}
const decider = (id, action, delay) => owner.post('owner_order_decide.php', { id, action, ...(delay ? { delay_minutes: delay } : {}) });

before(async () => {
  ctx = makeEnv();
  assert.equal((await runTool(ctx, 'install.php')).code, 0);
  proc = await startServer(ctx);
  db = openTestDb(ctx);
  owner = new Client('patron');
  alice = new Client('alice');
  bob = new Client('bob');
  assert.equal((await owner.post('owner_login.php', { code: OWNER_CODE, remember: false })).status, 200);
  assert.equal((await alice.post('customer_signup.php', signup('alice@example.test'))).status, 201);
  assert.equal((await bob.post('customer_signup.php', signup('bob@example.test'))).status, 201);
});
after(() => stopServer(proc));

test('accepted -> ready : le client voit « ready » et l\'heure de préparation, la liste du compte aussi', async () => {
  const id = await creerCommande();
  assert.equal((await decider(id, 'accept', 30)).status, 200);
  const avant = await alice.get('order_status.php?id=' + id);
  assert.equal(avant.json.order.status, 'accepted');
  assert.equal(avant.json.order.prepared_at, null);

  const r = await decider(id, 'ready');
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.replayed, false);
  assert.equal(r.json.order.status, 'ready');
  assert.match(r.json.order.prepared_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  assert.ok(r.json.order.ready_at, 'l\'heure prévue (estimation) reste présente');
  assert.equal(r.json.order.delay_minutes, 30);

  const apres = await alice.get('order_status.php?id=' + id);
  assert.equal(apres.json.order.status, 'ready');
  assert.equal(apres.json.order.prepared_at, r.json.order.prepared_at);
  const liste = await alice.get('customer_orders.php');
  assert.equal(liste.json.orders.find((o) => o.id === id).status, 'ready');
  const cote = await owner.get('owner_orders.php');
  assert.equal(cote.json.orders.find((o) => o.id === id).status, 'ready');
});

test('un renvoi de « prête » est sans effet ; l\'heure de préparation ne change pas', async () => {
  const id = await creerCommande();
  await decider(id, 'accept', 20);
  const un = await decider(id, 'ready');
  const deux = await decider(id, 'ready');
  assert.equal(deux.status, 200);
  assert.equal(deux.json.replayed, true);
  assert.equal(deux.json.order.prepared_at, un.json.order.prepared_at);
  // Renvoi de l'acceptation identique après « prête » : encore un rejeu, jamais un retour en arrière.
  const accept = await decider(id, 'accept', 20);
  assert.equal(accept.status, 200);
  assert.equal(accept.json.replayed, true);
  assert.equal(accept.json.order.status, 'ready');
});

test('transitions interdites : prête avant acceptation, après refus, refus ou autre délai après prête', async () => {
  const neuve = await creerCommande();
  let r = await decider(neuve, 'ready');
  assert.equal(r.status, 409);
  assert.equal(r.json.error, 'already_decided');
  assert.equal(r.json.status, 'new');

  const refusee = await creerCommande();
  await decider(refusee, 'refuse');
  r = await decider(refusee, 'ready');
  assert.equal(r.status, 409);
  assert.equal(r.json.status, 'refused');

  const prete = await creerCommande();
  await decider(prete, 'accept', 40);
  await decider(prete, 'ready');
  r = await decider(prete, 'refuse');
  assert.equal(r.status, 409);
  assert.equal(r.json.status, 'ready');
  r = await decider(prete, 'accept', 60);
  assert.equal(r.status, 409);
  assert.equal(db.prepare('SELECT status, delay_minutes FROM orders WHERE id = ?').get(prete).status, 'ready');
  assert.equal(db.prepare('SELECT delay_minutes FROM orders WHERE id = ?').get(prete).delay_minutes, 40);
});

test('validation et droits', async () => {
  const id = await creerCommande();
  await decider(id, 'accept', 30);
  assert.equal((await owner.post('owner_order_decide.php', { id, action: 'terminee' })).status, 422);
  assert.equal((await decider(99999999, 'ready')).status, 404);
  assert.equal((await new Client('anon').post('owner_order_decide.php', { id, action: 'ready' })).status, 401);
  assert.equal((await alice.post('owner_order_decide.php', { id, action: 'ready' })).status, 403);
  assert.equal(db.prepare('SELECT status FROM orders WHERE id = ?').get(id).status, 'accepted');
});

test('un autre client ne voit pas la commande prête d\'autrui', async () => {
  const id = await creerCommande(alice);
  await decider(id, 'accept', 30);
  await decider(id, 'ready');
  assert.equal((await bob.get('order_status.php?id=' + id)).status, 404);
  assert.ok(!(await bob.get('customer_orders.php')).json.orders.some((o) => o.id === id));
});

test('30 « prête » simultanés : une seule transition, les autres sont des rejeux', async () => {
  const id = await creerCommande();
  await decider(id, 'accept', 30);
  const rs = await Promise.all(Array.from({ length: 30 }, () => decider(id, 'ready')));
  assert.ok(rs.every((r) => r.status === 200), 'aucune erreur');
  assert.equal(rs.filter((r) => r.json.replayed === false).length, 1);
  assert.equal(new Set(rs.map((r) => r.json.order.prepared_at)).size, 1);
});
