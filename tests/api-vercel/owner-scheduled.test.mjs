// owner_scheduled.php — page dédiée "Programmées cette semaine" (demande du 24/11/2026) : TOUTES les
// commandes programmées à venir, pas encore honorées, quel que soit leur statut (new, en attente de
// décision — ou déjà accepted, acceptée automatiquement hors service, voir order_create.js) ni leur
// service_day (contrairement à owner_orders.php, qui ne montre une commande "accepted" que le jour même —
// voir le correctif du service_day, tests/api-vercel/scheduled-order-auto-accept.test.mjs). Jamais une
// commande déjà honorée (ready/refused/cancelled) ni une commande "dès que possible" (scheduled_for null).
// Lancer depuis la racine :  SUBITO_TEST_PORT=18430 node --test tests/api-vercel/owner-scheduled.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

process.env.SUBITO_TEST_PORT = String(Number(process.env.SUBITO_TEST_PORT || 8091) + 17);
const { OWNER_CODE, Client, makeEnv, runTool, startServer, stopServer } = await import('./lib/harness.mjs');
const { parisLocalVersEpoch, jourParisDecale } = await import('../../serveur/util.js');

let ctx;
let server;
const owner = new Client('owner-scheduled');
let keySeq = 0;

function expectError(r, status, code) {
  assert.equal(r.status, status, `${r.method} ${r.route} : ${r.text}`);
  assert.equal(r.json?.ok, false);
  assert.equal(r.json?.error, code, r.text);
}

const clockDir = mkdtempSync(path.join(process.env.SUBITO_TEST_DIR || tmpdir(), 'subito-owner-scheduled-clock-'));
const clockFile = path.join(clockDir, 'horloge.txt');
function poserHorloge(e) { writeFileSync(clockFile, String(e)); }
const isoDe = (e) => new Date(e * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');

const MAINTENANT = Math.floor(Date.now() / 1000);

before(async () => {
  ctx = makeEnv();
  ctx.env.SUBITO_TEST_CLOCK_FILE = clockFile;
  poserHorloge(MAINTENANT);
  const inst = await runTool(ctx, 'install.php');
  assert.equal(inst.code, 0, inst.stderr + inst.stdout);
  server = await startServer(ctx);
  assert.equal((await owner.post('owner_login.php', { code: OWNER_CODE, remember: true })).status, 200);
});

after(() => {
  delete process.env.HORAIRES_COMMANDES;
  stopServer(server);
});

async function nouveauClient(email) {
  const c = new Client('cust-' + email);
  const r = await c.post('customer_signup.php', {
    first_name: 'Sched', last_name: 'Test', email, phone: '0612345678', password: 'TestScheduled99!xzQ',
    street: '1 rue des Tests', city: 'Hénin-Beaumont', housing_type: 'maison'
  });
  assert.equal(r.status, 201, r.text);
  return c;
}

function commanderPlanifiee(client, cle, scheduledIso) {
  return client.post('order_create.php', {
    idempotency_key: cle, mode: 'pickup', payment_methods: ['cash'], cash_change_for: null, hot_sauce: null,
    items: [{ name: 'Régina', variant: 'Duo', qty: 1, unit_price_cents: 1600, removed: [], extras: [], half: null, note: '' }],
    delivery_fee_cents: 0, total_cents: 1600, scheduled_for: scheduledIso
  });
}

function commanderImmediate(client, cle) {
  return client.post('order_create.php', {
    idempotency_key: cle, mode: 'pickup', payment_methods: ['cash'], cash_change_for: null, hot_sauce: null,
    items: [{ name: 'Régina', variant: 'Duo', qty: 1, unit_price_cents: 1600, removed: [], extras: [], half: null, note: '' }],
    delivery_fee_cents: 0, total_cents: 1600
  });
}

test("expose les commandes programmées à venir, qu'elles soient en attente ou déjà acceptées automatiquement, "
  + "jamais une commande immédiate ni une commande déjà honorée", async () => {
  process.env.HORAIRES_COMMANDES = '00:00-23:59'; // ouvert : une programmée reste "new", en attente de décision
  poserHorloge(MAINTENANT);
  const client = await nouveauClient('sched-' + Date.now() + '@example.test');

  const demain = jourParisDecale(MAINTENANT, 1);
  const apresDemain = jourParisDecale(MAINTENANT, 3);
  const slot1 = parisLocalVersEpoch(demain.annee, demain.mois, demain.jour, 20, 0);
  const slot2 = parisLocalVersEpoch(apresDemain.annee, apresDemain.mois, apresDemain.jour, 19, 30);

  const r1 = await commanderPlanifiee(client, 'sched-pending-' + (++keySeq), isoDe(slot1));
  assert.equal(r1.status, 201, r1.text);
  assert.equal(r1.json.order.status, 'new');
  const idEnAttente = r1.json.order.id;

  // Acceptée automatiquement : déposée hors service (créneau de test très restreint).
  process.env.HORAIRES_COMMANDES = '06:00-06:01';
  const r2 = await commanderPlanifiee(client, 'sched-accepted-' + (++keySeq), isoDe(slot2));
  assert.equal(r2.status, 201, r2.text);
  assert.equal(r2.json.order.status, 'accepted');
  const idAcceptee = r2.json.order.id;

  // Commande immédiate (jamais programmée) : ne doit jamais apparaître ici.
  process.env.HORAIRES_COMMANDES = '00:00-23:59';
  const rImmediate = await commanderImmediate(client, 'sched-immediate-' + (++keySeq));
  assert.equal(rImmediate.status, 201, rImmediate.text);
  const idImmediate = rImmediate.json.order.id;

  const vue = await owner.get('owner_scheduled.php');
  assert.equal(vue.status, 200, vue.text);
  const ids = vue.json.orders.map((o) => o.id);
  assert.ok(ids.includes(idEnAttente), "la commande programmée en attente de décision doit apparaître");
  assert.ok(ids.includes(idAcceptee), "la commande programmée déjà acceptée automatiquement doit apparaître aussi");
  assert.ok(!ids.includes(idImmediate), "une commande immédiate (pas programmée) ne doit jamais apparaître ici");

  // Ordre chronologique par créneau (le plus proche d'abord).
  const iEnAttente = ids.indexOf(idEnAttente);
  const iAcceptee = ids.indexOf(idAcceptee);
  assert.ok(iEnAttente < iAcceptee, 'triée par scheduled_for croissant');

  const vueEnAttente = vue.json.orders.find((o) => o.id === idEnAttente);
  assert.equal(vueEnAttente.status, 'new');
  assert.equal(vueEnAttente.scheduled_for, isoDe(slot1));
  const vueAcceptee = vue.json.orders.find((o) => o.id === idAcceptee);
  assert.equal(vueAcceptee.status, 'accepted');
});

test("une commande programmée déjà honorée (prête) ou refusée n'apparaît plus", async () => {
  process.env.HORAIRES_COMMANDES = '00:00-23:59';
  poserHorloge(MAINTENANT);
  const client = await nouveauClient('sched-honoree-' + Date.now() + '@example.test');
  const demain = jourParisDecale(MAINTENANT, 1);
  const slot = parisLocalVersEpoch(demain.annee, demain.mois, demain.jour, 20, 0);
  const r = await commanderPlanifiee(client, 'sched-honoree-1-' + (++keySeq), isoDe(slot));
  assert.equal(r.status, 201, r.text);
  const id = r.json.order.id;

  assert.equal((await owner.post('owner_order_decide.php', { id, action: 'refuse' })).status, 200);
  const vue = await owner.get('owner_scheduled.php');
  assert.ok(!vue.json.orders.some((o) => o.id === id), "une commande refusée ne doit plus apparaître dans les commandes programmées à venir");
});

test('authentification : 401 sans session, 405 hors GET', async () => {
  const anon = new Client('sched-anon');
  expectError(await anon.get('owner_scheduled.php'), 401, 'unauthorized');
  const postResp = await owner.post('owner_scheduled.php', {});
  assert.equal(postResp.status, 405);
});
