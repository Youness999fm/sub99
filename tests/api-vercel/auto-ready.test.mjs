// Transition automatique « accepted » -> « ready » dès que le délai annoncé au client est dépassé
// (décision du 24/11/2026 : plus besoin de cliquer "Marquer prête" commande par commande — voir
// autoReadyOverdueOrders, serveur/orders.js, appelée depuis owner_orders.php et order_status.php).
// Lancer depuis la racine :  SUBITO_TEST_PORT=18430 node --test tests/api-vercel/auto-ready.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.SUBITO_TEST_PORT = String(Number(process.env.SUBITO_TEST_PORT || 8091) + 18);
const { OWNER_CODE, Client, openTestDb, makeEnv, runTool, startServer, stopServer } = await import('./lib/harness.mjs');
const { nowUtc, utcAt, utcToEpoch } = await import('../../serveur/util.js');

let ctx;
let server;
let db;
const owner = new Client('owner-autoready');
let keySeq = 0;

before(async () => {
  ctx = makeEnv();
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
  const r = await c.post('customer_signup.php', {
    first_name: 'Auto', last_name: 'Ready', email, phone: '0612345678', password: 'TestAutoReady99!xzQ',
    street: '1 rue des Tests', city: 'Hénin-Beaumont', housing_type: 'maison'
  });
  assert.equal(r.status, 201, r.text);
  return c;
}

async function commander(client) {
  const r = await client.post('order_create.php', {
    idempotency_key: 'autoready-' + Date.now() + '-' + (++keySeq), mode: 'pickup',
    payment_methods: ['cash'], cash_change_for: null, hot_sauce: null,
    items: [{ name: 'Régina', variant: 'Duo', qty: 1, unit_price_cents: 1600, removed: [], extras: [], half: null, note: '' }],
    delivery_fee_cents: 0, total_cents: 1600
  });
  assert.equal(r.status, 201, r.text);
  return r.json.order.id;
}

/** Recule accepted_at pour que ready_at (accepted_at + delay) tombe `secondesDansLePasse` s avant maintenant. */
function reculerAcceptedAt(id, delayMinutes, secondesDansLePasse) {
  const accepteA = utcAt(utcToEpoch(nowUtc()) - delayMinutes * 60 - secondesDansLePasse);
  db.prepare('UPDATE orders SET accepted_at = ? WHERE id = ?').run(accepteA, id);
}

test('owner_orders.php marque automatiquement "ready" une commande acceptée dont le délai est dépassé, '
  + 'prepared_at posé, visible dans CETTE même réponse (pas besoin d\'un second sondage)', async () => {
  const cust = await nouveauClient('autoready-owner@example.test');
  const id = await commander(cust);
  assert.equal((await owner.post('owner_order_decide.php', { id, action: 'accept', delay_minutes: 10 })).status, 200);
  reculerAcceptedAt(id, 10, 5); // délai de 10 min dépassé depuis 5 s

  const liste = await owner.get('owner_orders.php');
  assert.equal(liste.status, 200, liste.text);
  const vue = liste.json.orders.find((o) => o.id === id);
  assert.ok(vue, 'commande absente de owner_orders.php');
  assert.equal(vue.status, 'ready', 'doit déjà être "ready" dans CETTE réponse, sans second appel');
  assert.ok(vue.prepared_at, 'prepared_at doit être posé');

  const ligne = db.prepare('SELECT status, prepared_at FROM orders WHERE id = ?').get(id);
  assert.equal(ligne.status, 'ready');
  assert.ok(ligne.prepared_at);
});

test('order_status.php (suivi client) marque automatiquement "ready" lui aussi, même sans sondage '
  + 'préalable côté commerçant', async () => {
  const cust = await nouveauClient('autoready-client@example.test');
  const id = await commander(cust);
  assert.equal((await owner.post('owner_order_decide.php', { id, action: 'accept', delay_minutes: 20 })).status, 200);
  reculerAcceptedAt(id, 20, 1); // délai de 20 min dépassé depuis 1 s, personne n'a encore sondé owner_orders.php

  const suivi = await cust.get('order_status.php?id=' + id);
  assert.equal(suivi.status, 200, suivi.text);
  assert.equal(suivi.json.order.status, 'ready', 'le client doit être prévenu automatiquement, sans dépendre de la tablette');
  assert.ok(suivi.json.order.prepared_at);
});

test('jamais pour delay_minutes = 0 ("venez vite" n\'a pas d\'échéance à dépasser)', async () => {
  const cust = await nouveauClient('autoready-venezvite@example.test');
  const id = await commander(cust);
  assert.equal((await owner.post('owner_order_decide.php', { id, action: 'accept', delay_minutes: 0 })).status, 200);
  // Recule quand même accepted_at très loin dans le passé : si le garde-fou delay=0 avait un trou, ça sortirait.
  db.prepare('UPDATE orders SET accepted_at = ? WHERE id = ?').run(utcAt(utcToEpoch(nowUtc()) - 3600), id);

  const liste = await owner.get('owner_orders.php');
  const vue = liste.json.orders.find((o) => o.id === id);
  assert.equal(vue.status, 'accepted', 'delay_minutes=0 ne doit jamais être auto-marquée prête');
});

test('jamais pour une commande déjà prête, refusée ou annulée (rejeu sans effet, pas d\'erreur)', async () => {
  const cust = await nouveauClient('autoready-dejapret@example.test');
  const id = await commander(cust);
  assert.equal((await owner.post('owner_order_decide.php', { id, action: 'accept', delay_minutes: 10 })).status, 200);
  assert.equal((await owner.post('owner_order_decide.php', { id, action: 'ready' })).status, 200);
  const preparedAvant = (await owner.get('owner_orders.php')).json.orders.find((o) => o.id === id).prepared_at;
  reculerAcceptedAt(id, 10, 5);

  const liste = await owner.get('owner_orders.php');
  const vue = liste.json.orders.find((o) => o.id === id);
  assert.equal(vue.status, 'ready');
  assert.equal(vue.prepared_at, preparedAvant, 'prepared_at ne doit pas être réécrit par la transition automatique');
});

test('commande planifiée (SBT-003) : jamais « prête » avant l\'heure demandée, même délai dépassé '
  + '(bug réel trouvé le 24/11/2026 en production : une commande planifiée acceptée automatiquement '
  + 'restaurant fermé reçoit un délai compté depuis l\'acceptation, qui peut être des heures avant le créneau)', async () => {
  const cust = await nouveauClient('autoready-planifiee@example.test');
  const id = await commander(cust);
  assert.equal((await owner.post('owner_order_decide.php', { id, action: 'accept', delay_minutes: 10 })).status, 200);
  reculerAcceptedAt(id, 10, 5); // délai de 10 min dépassé depuis 5 s, comme le 1er test
  const dansDeuxHeures = utcAt(utcToEpoch(nowUtc()) + 7200);
  db.prepare('UPDATE orders SET scheduled_for = ? WHERE id = ?').run(dansDeuxHeures, id);

  const avant = await owner.get('owner_orders.php');
  const vueAvant = avant.json.orders.find((o) => o.id === id);
  assert.equal(vueAvant.status, 'accepted', 'délai dépassé mais créneau dans 2h : ne doit PAS encore être "prête"');
  assert.equal(vueAvant.prepared_at, null);

  // Le créneau arrive : désormais, le même délai dépassé doit bien déclencher la transition.
  const ilYABref = utcAt(utcToEpoch(nowUtc()) - 1);
  db.prepare('UPDATE orders SET scheduled_for = ? WHERE id = ?').run(ilYABref, id);
  const apres = await owner.get('owner_orders.php');
  const vueApres = apres.json.orders.find((o) => o.id === id);
  assert.equal(vueApres.status, 'ready', 'créneau passé + délai dépassé : doit maintenant être "prête"');
  assert.ok(vueApres.prepared_at);
});

test('toujours « accepted » tant que le délai n\'est pas dépassé', async () => {
  const cust = await nouveauClient('autoready-pasencore@example.test');
  const id = await commander(cust);
  assert.equal((await owner.post('owner_order_decide.php', { id, action: 'accept', delay_minutes: 30 })).status, 200);

  const liste = await owner.get('owner_orders.php');
  const vue = liste.json.orders.find((o) => o.id === id);
  assert.equal(vue.status, 'accepted');
  assert.equal(vue.prepared_at, null);
});
