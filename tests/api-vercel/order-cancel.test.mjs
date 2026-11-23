// Annulation client (order_cancel.php) : décision du 22/11/2026, le client ne fait que DÉPOSER une demande
// (cancel_requested_at) — la commande n'est réellement annulée que si le commerçant la valide
// (owner_cancel_decide.php, kind='accept'). Fenêtre stricte de 4 minutes depuis orders.created_at, jamais
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

test('fenêtre à la seconde exacte : 239 s dépose la demande, 240 s et 241 s refusées (too_late)', async () => {
  const t0 = BASE_EPOCH + 10_000;
  poserHorloge(t0);
  const cust = await nouveauClient('cancel-fenetre@example.test');
  const id1 = await commander(cust);
  poserHorloge(t0 + 239);
  const r1 = await cust.post('order_cancel.php', { id: id1 });
  assert.equal(r1.status, 200, r1.text);
  assert.equal(r1.json.replayed, false);
  assert.equal(r1.json.order.status, 'new', 'la commande n\'est PAS annulée toute seule, seulement une demande déposée');
  assert.equal(typeof r1.json.order.cancel_requested_at, 'string');

  poserHorloge(t0);
  const id2 = await commander(cust);
  poserHorloge(t0 + 240);
  expectError(await cust.post('order_cancel.php', { id: id2 }), 409, 'too_late');

  poserHorloge(t0);
  const id3 = await commander(cust);
  poserHorloge(t0 + 241);
  expectError(await cust.post('order_cancel.php', { id: id3 }), 409, 'too_late');
});

test('rejeu : demander deux fois répond replayed:true la 2e fois, jamais une erreur, jamais une 2e demande', async () => {
  const t0 = BASE_EPOCH + 20_000;
  poserHorloge(t0);
  const cust = await nouveauClient('cancel-rejeu@example.test');
  const id = await commander(cust);
  poserHorloge(t0 + 5);
  const r1 = await cust.post('order_cancel.php', { id });
  assert.equal(r1.status, 200, r1.text);
  assert.equal(r1.json.replayed, false);
  // Rejeu dans la fenêtre : toujours en attente, pas une nouvelle demande.
  const r2 = await cust.post('order_cancel.php', { id });
  assert.equal(r2.status, 200, r2.text);
  assert.equal(r2.json.replayed, true);
  assert.equal(r2.json.order.cancel_requested_at, r1.json.order.cancel_requested_at);
  // Rejeu hors fenêtre (demande déjà déposée : jamais too_late pour une opération déjà effectuée).
  poserHorloge(t0 + 300);
  const r3 = await cust.post('order_cancel.php', { id });
  assert.equal(r3.status, 200, r3.text);
  assert.equal(r3.json.replayed, true);
});

test('double-clic concurrent : une seule demande déposée, le second appel est un rejeu', async () => {
  const t0 = BASE_EPOCH + 30_000;
  poserHorloge(t0);
  const cust = await nouveauClient('cancel-double-clic@example.test');
  const id = await commander(cust);
  poserHorloge(t0 + 5);
  const [r1, r2] = await Promise.all([cust.post('order_cancel.php', { id }), cust.post('order_cancel.php', { id })]);
  assert.equal(r1.status, 200, r1.text);
  assert.equal(r2.status, 200, r2.text);
  const replayedFlags = [r1.json.replayed, r2.json.replayed].sort();
  assert.deepEqual(replayedFlags, [false, true], 'exactement un replayed:false (la demande) et un replayed:true');
  assert.equal(Number(db.prepare("SELECT COUNT(*) AS n FROM orders WHERE id = ? AND cancel_requested_at IS NOT NULL").get(id).n), 1);
  // Un seul événement d'alerte malgré les deux appels.
  assert.equal(Number(db.prepare("SELECT COUNT(*) AS n FROM order_addenda WHERE order_id = ? AND kind = 'cancel'").get(id).n), 1);
});

test('déjà accepté : demande déposée dans la fenêtre, commande PAS encore annulée, alerte commerçant créée', async () => {
  const t0 = BASE_EPOCH + 40_000;
  poserHorloge(t0);
  const cust = await nouveauClient('cancel-accepte@example.test');
  const id = await commander(cust);
  poserHorloge(t0 + 2);
  assert.equal((await owner.post('owner_order_decide.php', { id, action: 'accept', delay_minutes: 20 })).status, 200);

  poserHorloge(t0 + 100);
  const r = await cust.post('order_cancel.php', { id });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.order.status, 'accepted', 'reste "accepted" tant que le commerçant n\'a pas validé');
  assert.equal(typeof r.json.order.cancel_requested_at, 'string');

  const addendum = db.prepare("SELECT * FROM order_addenda WHERE order_id = ? AND kind = 'cancel'").get(id);
  assert.ok(addendum, 'un événement order_addenda de type cancel doit exister');
  assert.equal(addendum.seq, 1);
  const job = db.prepare('SELECT * FROM addendum_print_jobs WHERE addendum_id = ?').get(addendum.id);
  assert.ok(job, 'une tâche addendum_print_jobs doit être créée pour alerter le commerçant');
  assert.equal(job.status, 'pending');
});

test("pas encore accepté (status new) : alerte commerçant créée quand même (la validation est désormais toujours requise)", async () => {
  const t0 = BASE_EPOCH + 50_000;
  poserHorloge(t0);
  const cust = await nouveauClient('cancel-new@example.test');
  const id = await commander(cust);
  poserHorloge(t0 + 2);
  const r = await cust.post('order_cancel.php', { id });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.order.status, 'new');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM order_addenda WHERE order_id = ?").get(id).n, 1,
    "une alerte est créée même sur une commande encore 'new' : le commerçant doit toujours valider");
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

test("isolation : un autre client ne peut pas demander l'annulation de la commande d'un client différent", async () => {
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

// ---------------------------------------------------------------- owner_cancel_decide.php (validation)

test('owner_cancel_decide accept : la commande passe réellement à "cancelled", can_cancel redevient faux', async () => {
  const t0 = BASE_EPOCH + 90_000;
  poserHorloge(t0);
  const cust = await nouveauClient('cancel-decide-accept@example.test');
  const id = await commander(cust);
  poserHorloge(t0 + 2);
  assert.equal((await cust.post('order_cancel.php', { id })).status, 200);

  const decide = await owner.post('owner_cancel_decide.php', { id, action: 'accept' });
  assert.equal(decide.status, 200, decide.text);
  assert.equal(decide.json.replayed, false);
  assert.equal(decide.json.order.status, 'cancelled');
  assert.equal(decide.json.order.cancelled_at !== null, true);

  // Relecture indépendante côté client : bien annulée pour de vrai.
  const relu = await cust.get('order_status.php?id=' + id);
  assert.equal(relu.json.order.status, 'cancelled');
  assert.equal(relu.json.order.cancel_requested_at, null);
});

test('owner_cancel_decide refuse : la commande continue normalement, la demande disparaît, le client voit '
  + 'un message d\'excuse (cancel_refused_at) jusqu\'à une nouvelle demande', async () => {
  const t0 = BASE_EPOCH + 100_000;
  poserHorloge(t0);
  const cust = await nouveauClient('cancel-decide-refuse@example.test');
  const id = await commander(cust);
  poserHorloge(t0 + 2);
  assert.equal((await owner.post('owner_order_decide.php', { id, action: 'accept', delay_minutes: 20 })).status, 200);
  poserHorloge(t0 + 10);
  assert.equal((await cust.post('order_cancel.php', { id })).status, 200);

  const decide = await owner.post('owner_cancel_decide.php', { id, action: 'refuse' });
  assert.equal(decide.status, 200, decide.text);
  assert.equal(decide.json.replayed, false);
  assert.equal(decide.json.order.status, 'accepted', 'la commande continue, jamais annulée');
  assert.equal(decide.json.order.cancel_requested_at, null);
  assert.ok(decide.json.order.cancel_refused_at, 'cancel_refused_at doit être posé par le refus');

  // Le client voit le refus (cancel_refused_at) tant qu'il n'a pas redemandé.
  const vueClient = await cust.get('order_status.php?id=' + id);
  assert.equal(vueClient.status, 200, vueClient.text);
  assert.ok(vueClient.json.order.cancel_refused_at, 'le client doit voir pourquoi le refus a eu lieu');

  // Le client peut redemander l'annulation après un refus (nouvelle demande, pas un rejeu de l'ancienne) ;
  // cancel_refused_at disparaît alors (le message d'excuse ne doit plus s'afficher sur une demande en cours).
  poserHorloge(t0 + 20);
  const r2 = await cust.post('order_cancel.php', { id });
  assert.equal(r2.status, 200, r2.text);
  assert.equal(r2.json.replayed, false, 'une vraie nouvelle demande, pas un rejeu de la précédente (refusée)');
  assert.equal(r2.json.order.cancel_refused_at, null, 'le refus précédent ne doit plus être affiché pendant une nouvelle demande');
});

test('owner_cancel_decide : rejeu idempotent (accept puis accept = replayed:true), already_decided si contradictoire', async () => {
  const t0 = BASE_EPOCH + 110_000;
  poserHorloge(t0);
  const cust = await nouveauClient('cancel-decide-rejeu@example.test');
  const id = await commander(cust);
  poserHorloge(t0 + 2);
  assert.equal((await cust.post('order_cancel.php', { id })).status, 200);

  const a1 = await owner.post('owner_cancel_decide.php', { id, action: 'accept' });
  assert.equal(a1.status, 200, a1.text);
  assert.equal(a1.json.replayed, false);
  const a2 = await owner.post('owner_cancel_decide.php', { id, action: 'accept' });
  assert.equal(a2.status, 200, a2.text);
  assert.equal(a2.json.replayed, true);

  // Refuser une commande déjà réellement annulée : la demande n'existe plus, 409 already_decided.
  expectError(await owner.post('owner_cancel_decide.php', { id, action: 'refuse' }), 409, 'already_decided');
});

test("owner_cancel_decide : sans demande en attente -> 409 already_decided ; sans session owner -> 401 ; session client -> 403 ; commande introuvable -> 404", async () => {
  const t0 = BASE_EPOCH + 120_000;
  poserHorloge(t0);
  const cust = await nouveauClient('cancel-decide-aucune@example.test');
  const id = await commander(cust);
  poserHorloge(t0 + 2);
  // Aucune demande n'a été déposée : rien à trancher.
  expectError(await owner.post('owner_cancel_decide.php', { id, action: 'accept' }), 409, 'already_decided');

  expectError(await new Client('cancel-decide-anon').post('owner_cancel_decide.php', { id, action: 'accept' }), 401, 'unauthorized');
  expectError(await cust.post('owner_cancel_decide.php', { id, action: 'accept' }), 403, 'forbidden');
  expectError(await owner.post('owner_cancel_decide.php', { id: 999999, action: 'accept' }), 404, 'not_found');
  expectError(await owner.post('owner_cancel_decide.php', { id, action: 'autre' }), 422, 'validation');
});
