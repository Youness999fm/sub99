// Vue commerçant (tablette) sur l'annulation ET la tentative de modification côté client — complète
// order-cancel.test.mjs (coté client uniquement) et addendum-print-jobs.test.mjs (ticket complémentaire
// générique, testé seulement avec kind='add'). Ici on vérifie ce que le commerçant voit réellement via
// owner_orders.php : statut 'cancelled', addenda kind='cancel', cycle complet claim/ack du ticket d'alerte,
// et le fait qu'un owner_order_decide.php (accepter/refuser/prête) sur une commande annulée échoue toujours
// (409 already_decided) au lieu de la faire glisser silencieusement dans un autre statut. On vérifie aussi
// que kind='modify' (désactivé en libre-service depuis le 22/11/2026) ne laisse AUCUNE trace côté commerçant
// (ni addenda, ni ticket) puisqu'il est rejeté avant toute écriture.
// Horloge pilotée (SUBITO_TEST_CLOCK_FILE) : bornes testées à la seconde exacte, jamais une attente réelle.
// Lancer depuis la racine :  SUBITO_TEST_PORT=18430 node --test tests/api-vercel/owner-cancel-view.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// +9 est déjà pris par owner-order-trash.test.mjs ET scheduled-order-auto-accept.test.mjs (collision
// préexistante entre ces deux-là, voir le correctif apporté à scheduled-order-auto-accept.test.mjs) ;
// +11 est libre (vérifié dans tous les fichiers de ce dossier au moment de l'écriture de ce fichier).
process.env.SUBITO_TEST_PORT = String(Number(process.env.SUBITO_TEST_PORT || 8091) + 11);
const { OWNER_CODE, Client, openTestDb, makeEnv, runTool, startServer, stopServer } = await import('./lib/harness.mjs');

const randomPassword = () => Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(18))).toString('base64url') + 'Aa1!';

let ctx;
let server;
let db;
const owner = new Client('owner-cancel-view');
let keySeq = 0;

function expectError(r, status, code) {
  assert.equal(r.status, status, `${r.method} ${r.route} : ${r.text}`);
  assert.equal(r.json?.ok, false);
  assert.equal(r.json?.error, code, r.text);
}

const clockDir = mkdtempSync(path.join(process.env.SUBITO_TEST_DIR || tmpdir(), 'subito-owner-cancel-view-clock-'));
const clockFile = path.join(clockDir, 'horloge.txt');
function poserHorloge(e) { writeFileSync(clockFile, String(e)); }
const BASE_EPOCH = Math.floor(Date.now() / 1000);
const REGINA_DUO = 1600;

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
    first_name: 'OwnerView', last_name: 'Test', email, phone: '0612345678', password,
    street: '1 rue des Tests', city: 'Hénin-Beaumont', housing_type: 'maison'
  });
  assert.equal(r.status, 201, r.text);
  return c;
}

async function commander(client) {
  const r = await client.post('order_create.php', {
    idempotency_key: 'owner-cancel-view-' + Date.now() + '-' + (++keySeq), mode: 'pickup',
    payment_methods: ['cash'], cash_change_for: null, hot_sauce: null,
    items: [{ name: 'Régina', variant: 'Duo', qty: 1, unit_price_cents: REGINA_DUO, removed: [], extras: [], half: null, note: '' }],
    delivery_fee_cents: 0, total_cents: REGINA_DUO
  });
  assert.equal(r.status, 201, r.text);
  return r.json.order.id;
}

function trouverCommande(ownerOrdersJson, orderId) {
  return ownerOrdersJson.orders.find((o) => o.id === orderId);
}

test("annulation d'une commande encore 'new' : owner_orders.php montre status='cancelled', cancelled_at, et un addenda kind='cancel' avec ticket pending", async () => {
  const t0 = BASE_EPOCH + 10_000;
  poserHorloge(t0);
  const client = await nouveauClient('ownerview-new@example.test');
  const id = await commander(client);
  poserHorloge(t0 + 5);
  const cancel = await client.post('order_cancel.php', { id });
  assert.equal(cancel.status, 200, cancel.text);
  assert.equal(cancel.json.order.status, 'cancelled');

  const vue = await owner.get('owner_orders.php');
  assert.equal(vue.status, 200, vue.text);
  const o = trouverCommande(vue.json, id);
  assert.ok(o, "la commande annulée doit rester visible côté commerçant (service_day = aujourd'hui)");
  assert.equal(o.status, 'cancelled');
  assert.ok(o.cancelled_at, 'cancelled_at doit être exposé au commerçant');

  assert.equal(o.addenda.length, 1, 'un seul événement : le cancel');
  const a = o.addenda[0];
  assert.equal(a.kind, 'cancel');
  assert.equal(a.items.length, 0, "un cancel n'a pas de lignes d'articles");
  assert.equal(a.print_pending, true, 'le ticket d\'alerte doit être dû immédiatement, sans délai H-45');
  assert.equal(a.print_job.status, 'pending');
});

test("annulation d'une commande déjà 'accepted' : toujours annulée, alerte commerçant créée quand même, et le ticket est réclamable/acquittable (même cycle que pour un ajout)", async () => {
  const t0 = BASE_EPOCH + 20_000;
  poserHorloge(t0);
  const client = await nouveauClient('ownerview-accepted@example.test');
  const id = await commander(client);
  poserHorloge(t0 + 2);
  assert.equal((await owner.post('owner_order_decide.php', { id, action: 'accept', delay_minutes: 20 })).status, 200);

  poserHorloge(t0 + 100);
  const cancel = await client.post('order_cancel.php', { id });
  assert.equal(cancel.status, 200, cancel.text);
  assert.equal(cancel.json.order.status, 'cancelled', 'annulée directement même déjà acceptée');

  const avant = await owner.get('owner_orders.php');
  const addendum = trouverCommande(avant.json, id).addenda.find((a) => a.kind === 'cancel');
  assert.ok(addendum, "l'alerte d'annulation doit apparaître même pour une commande déjà acceptée");
  assert.equal(addendum.print_pending, true);

  const claim = await owner.post('owner_addendum_print_claim.php', { id: addendum.id, device: 'tablette-test' });
  assert.equal(claim.status, 200, claim.text);
  assert.equal(claim.json.claimed, true);
  assert.equal(claim.json.job.status, 'claimed');

  // Une 2e tablette qui sonde au même instant n'obtient rien (réclamation atomique, même garantie que pour un ajout).
  const concurrent = await owner.post('owner_addendum_print_claim.php', { id: addendum.id, device: 'tablette-2' });
  assert.equal(concurrent.json.claimed, false);

  const ack = await owner.post('owner_addendum_print_ack.php', { id: addendum.id, outcome: 'dispatched' });
  assert.equal(ack.status, 200, ack.text);
  assert.equal(ack.json.status, 'dispatched');

  const apres = await owner.get('owner_orders.php');
  const addendumApres = trouverCommande(apres.json, id).addenda.find((a) => a.kind === 'cancel');
  assert.equal(addendumApres.print_pending, false, 'remis avec succès : plus en attente côté tablette');
  assert.equal(addendumApres.print_job.status, 'dispatched');
});

test("owner_order_decide.php sur une commande déjà annulée : accepter/refuser/marquer prête échouent toujours (409 already_decided), jamais un changement silencieux de statut", async () => {
  // Cas 1 : commande encore 'new' au moment de l'annulation -> accepter/refuser échouent.
  let t0 = BASE_EPOCH + 30_000;
  poserHorloge(t0);
  let client = await nouveauClient('ownerview-decide-new@example.test');
  let id = await commander(client);
  poserHorloge(t0 + 1);
  assert.equal((await client.post('order_cancel.php', { id })).status, 200);

  let r = await owner.post('owner_order_decide.php', { id, action: 'accept', delay_minutes: 0 });
  assert.equal(r.status, 409, r.text);
  assert.equal(r.json.error, 'already_decided');
  assert.equal(r.json.status, 'cancelled');
  assert.equal((await db.prepare('SELECT status FROM orders WHERE id = ?').get(id)).status, 'cancelled',
    'le statut en base ne doit JAMAIS basculer sur accepted après ce refus');

  r = await owner.post('owner_order_decide.php', { id, action: 'refuse' });
  assert.equal(r.status, 409, r.text);
  assert.equal(r.json.error, 'already_decided');
  assert.equal(r.json.status, 'cancelled');

  // Cas 2 : commande déjà 'accepted' puis annulée -> même l'action 'ready' (qui attend 'accepted') échoue.
  t0 = BASE_EPOCH + 40_000;
  poserHorloge(t0);
  client = await nouveauClient('ownerview-decide-accepted@example.test');
  id = await commander(client);
  poserHorloge(t0 + 1);
  assert.equal((await owner.post('owner_order_decide.php', { id, action: 'accept', delay_minutes: 10 })).status, 200);
  poserHorloge(t0 + 2);
  assert.equal((await client.post('order_cancel.php', { id })).status, 200);

  r = await owner.post('owner_order_decide.php', { id, action: 'ready' });
  assert.equal(r.status, 409, r.text);
  assert.equal(r.json.error, 'already_decided');
  assert.equal(r.json.status, 'cancelled');
  assert.equal((await db.prepare('SELECT status FROM orders WHERE id = ?').get(id)).status, 'cancelled',
    "le statut en base ne doit JAMAIS basculer sur 'ready' après ce refus");
});

test("une tentative de modification (kind='modify', désactivée en libre-service) ne laisse AUCUNE trace côté commerçant : ni addenda, ni ticket complémentaire, ni changement de statut", async () => {
  const t0 = BASE_EPOCH + 50_000;
  poserHorloge(t0);
  const client = await nouveauClient('ownerview-modify@example.test');
  const id = await commander(client);
  poserHorloge(t0 + 2);

  const avant = await owner.get('owner_orders.php');
  const avantOrder = trouverCommande(avant.json, id);
  assert.equal(avantOrder.addenda.length, 0, 'aucun événement avant la tentative');

  const itemId = avantOrder.items[0].id;
  const modif = await client.post('order_addendum_create.php', {
    order_id: id, idempotency_key: 'ownerview-modif-' + Date.now(), kind: 'modify', target_item_id: itemId,
    items: [{ name: 'Régina', variant: 'Duo', qty: 1, unit_price_cents: REGINA_DUO, removed: ['Olives'], extras: [], half: null, note: '' }],
    total_cents: 0
  });
  assert.equal(modif.status, 409, modif.text);
  assert.equal(modif.json.error, 'modify_disabled');

  const apres = await owner.get('owner_orders.php');
  const apresOrder = trouverCommande(apres.json, id);
  assert.equal(apresOrder.status, 'new', "le statut de la commande n'a pas bougé");
  assert.equal(apresOrder.addenda.length, 0, "une tentative de modification rejetée ne doit créer aucun order_addenda");
  assert.equal(
    Number(db.prepare('SELECT COUNT(*) AS n FROM addendum_print_jobs WHERE addendum_id IN (SELECT id FROM order_addenda WHERE order_id = ?)').get(id).n),
    0,
    'aucun ticket complémentaire ne doit avoir été créé pour une modification refusée'
  );

  // Preuve que ce n'est pas une panne générale de order_addendum_create.php : un vrai ajout, lui, passe et
  // apparaît immédiatement côté commerçant.
  const ajout = await client.post('order_addendum_create.php', {
    order_id: id, idempotency_key: 'ownerview-ajout-apres-modif-' + Date.now(), kind: 'add',
    items: [{ name: 'Régina', variant: 'Duo', qty: 1, unit_price_cents: REGINA_DUO, removed: [], extras: [], half: null, note: '' }],
    total_cents: REGINA_DUO
  });
  assert.equal(ajout.status, 201, ajout.text);
  const finalVue = await owner.get('owner_orders.php');
  const finalOrder = trouverCommande(finalVue.json, id);
  assert.equal(finalOrder.addenda.length, 1, 'le vrai ajout, lui, apparaît');
  assert.equal(finalOrder.addenda[0].kind, 'add');
});
