// Vue commerçant (tablette) sur la DEMANDE d'annulation et les tentatives d'ajout/modification côté
// client — complète order-cancel.test.mjs (côté client uniquement). Modèle en vigueur depuis le
// 22/11/2026, rétabli le 24/11/2026 après un aller-retour vers l'annulation directe (le commerçant veut
// VALIDER chaque annulation, pas seulement en être informé après coup) : order_cancel.php dépose une
// DEMANDE (cancel_requested_at posé, statut inchangé), owner_cancel_decide.php tranche (accept ->
// 'cancelled', refuse -> redevient une commande normale). L'alerte (order_addenda kind='cancel' +
// addendum_print_jobs) est créée dès la DEMANDE, pas seulement à la décision — c'est elle qui doit
// remonter côté commerçant. On vérifie ici ce que le commerçant voit réellement via owner_orders.php :
// cancel_requested_at exposé, addenda kind='cancel' avec ticket pending dès la demande, cycle complet
// claim/ack du ticket d'alerte, effet réel d'owner_cancel_decide.php (accept/refuse/rejeu/déjà tranché),
// et le fait qu'un owner_order_decide.php (accepter/refuser/prête) sur une commande déjà annulée (demande
// acceptée) échoue toujours (409 already_decided). On vérifie aussi qu'une tentative d'ajout OU de
// modification (order_addendum_create.php, désactivée en libre-service pour les deux kinds depuis le
// 24/11/2026) ne laisse AUCUNE trace côté commerçant.
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

test("demande d'annulation sur une commande encore 'new' : owner_orders.php montre cancel_requested_at, statut INCHANGÉ, et un addenda kind='cancel' avec ticket pending", async () => {
  const t0 = BASE_EPOCH + 10_000;
  poserHorloge(t0);
  const client = await nouveauClient('ownerview-new@example.test');
  const id = await commander(client);
  poserHorloge(t0 + 5);
  const demande = await client.post('order_cancel.php', { id });
  assert.equal(demande.status, 200, demande.text);
  assert.equal(demande.json.order.status, 'new', "la commande n'est PAS annulée tant que le commerçant n'a pas tranché");
  assert.ok(demande.json.order.cancel_requested_at);

  const vue = await owner.get('owner_orders.php');
  assert.equal(vue.status, 200, vue.text);
  const o = trouverCommande(vue.json, id);
  assert.ok(o, 'la commande doit rester visible côté commerçant');
  assert.equal(o.status, 'new', 'statut toujours "new" : rien ne doit basculer avant la décision du commerçant');
  assert.ok(o.cancel_requested_at, 'cancel_requested_at doit être exposé au commerçant, pour qu\'il sache qu\'une demande est en attente');

  assert.equal(o.addenda.length, 1, 'un seul événement : la demande d\'annulation');
  const a = o.addenda[0];
  assert.equal(a.kind, 'cancel');
  assert.equal(a.items.length, 0, "une demande d'annulation n'a pas de lignes d'articles");
  assert.equal(a.print_pending, true, 'le ticket d\'alerte doit être dû immédiatement, sans délai H-45, dès la DEMANDE');
  assert.equal(a.print_job.status, 'pending');
});

test("demande d'annulation sur une commande déjà 'accepted' : alerte commerçant créée quand même, ticket réclamable/acquittable (même cycle que pour un ajout), et owner_cancel_decide.php accept() annule réellement", async () => {
  const t0 = BASE_EPOCH + 20_000;
  poserHorloge(t0);
  const client = await nouveauClient('ownerview-accepted@example.test');
  const id = await commander(client);
  poserHorloge(t0 + 2);
  assert.equal((await owner.post('owner_order_decide.php', { id, action: 'accept', delay_minutes: 20 })).status, 200);

  poserHorloge(t0 + 100);
  const demande = await client.post('order_cancel.php', { id });
  assert.equal(demande.status, 200, demande.text);
  assert.equal(demande.json.order.status, 'accepted', 'toujours "accepted" : la demande seule ne change rien');

  const avant = await owner.get('owner_orders.php');
  const addendum = trouverCommande(avant.json, id).addenda.find((a) => a.kind === 'cancel');
  assert.ok(addendum, "l'alerte de demande d'annulation doit apparaître même pour une commande déjà acceptée");
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

  // Le commerçant tranche enfin : il accepte l'annulation.
  const decide = await owner.post('owner_cancel_decide.php', { id, action: 'accept' });
  assert.equal(decide.status, 200, decide.text);
  assert.equal(decide.json.order.status, 'cancelled', 'annulée réellement après acceptation du commerçant');
  assert.ok(decide.json.order.cancelled_at);

  const apres = await owner.get('owner_orders.php');
  const commandeApres = trouverCommande(apres.json, id);
  assert.equal(commandeApres.status, 'cancelled');
  const addendumApres = commandeApres.addenda.find((a) => a.kind === 'cancel');
  assert.equal(addendumApres.print_pending, false, 'remis avec succès : plus en attente côté tablette');
});

test("owner_cancel_decide.php refuse() : la demande s'efface, la commande continue normalement, et le client peut redéposer une demande ensuite", async () => {
  const t0 = BASE_EPOCH + 30_000;
  poserHorloge(t0);
  const client = await nouveauClient('ownerview-refuse@example.test');
  const id = await commander(client);
  poserHorloge(t0 + 2);
  assert.equal((await client.post('order_cancel.php', { id })).status, 200);

  const refuse = await owner.post('owner_cancel_decide.php', { id, action: 'refuse' });
  assert.equal(refuse.status, 200, refuse.text);
  assert.equal(refuse.json.order.status, 'new', 'la commande continue normalement');
  assert.equal(refuse.json.order.cancel_requested_at, null, 'la demande est effacée, pas juste masquée');

  const vue = await owner.get('owner_orders.php');
  const o = trouverCommande(vue.json, id);
  assert.equal(o.cancel_requested_at, null);
  assert.equal(o.status, 'new');

  // Rejeu du refuse : déjà tranchée dans le même sens -> replayed:true, jamais une erreur.
  const refuseRejeu = await owner.post('owner_cancel_decide.php', { id, action: 'refuse' });
  assert.equal(refuseRejeu.status, 200, refuseRejeu.text);
  assert.equal(refuseRejeu.json.replayed, true);

  // Le client peut redéposer une demande (cancel_requested_at est bien NULL, pas bloqué pour toujours).
  poserHorloge(t0 + 3);
  const redemande = await client.post('order_cancel.php', { id });
  assert.equal(redemande.status, 200, redemande.text);
  assert.ok(redemande.json.order.cancel_requested_at, 'une nouvelle demande doit être possible après un refus');
});

test("owner_cancel_decide.php sans demande en attente : accept() refuse (409 already_decided, rien à accepter), refuse() répond 200 replayed:true (déjà dans l'état visé, jamais une erreur)", async () => {
  const t0 = BASE_EPOCH + 40_000;
  poserHorloge(t0);
  const client = await nouveauClient('ownerview-nopending@example.test');
  const id = await commander(client);
  poserHorloge(t0 + 1);

  expectError(await owner.post('owner_cancel_decide.php', { id, action: 'accept' }), 409, 'already_decided');

  const refuse = await owner.post('owner_cancel_decide.php', { id, action: 'refuse' });
  assert.equal(refuse.status, 200, refuse.text);
  assert.equal(refuse.json.replayed, true);
  assert.equal(refuse.json.order.status, 'new');
});

test("owner_order_decide.php sur une commande dont l'annulation a été acceptée : accepter/refuser/marquer prête échouent toujours (409 already_decided), jamais un changement silencieux de statut", async () => {
  const t0 = BASE_EPOCH + 50_000;
  poserHorloge(t0);
  const client = await nouveauClient('ownerview-decide-cancelled@example.test');
  const id = await commander(client);
  poserHorloge(t0 + 1);
  assert.equal((await client.post('order_cancel.php', { id })).status, 200);
  assert.equal((await owner.post('owner_cancel_decide.php', { id, action: 'accept' })).status, 200);

  const r1 = await owner.post('owner_order_decide.php', { id, action: 'accept', delay_minutes: 0 });
  assert.equal(r1.status, 409, r1.text);
  assert.equal(r1.json.error, 'already_decided');
  assert.equal((await db.prepare('SELECT status FROM orders WHERE id = ?').get(id)).status, 'cancelled',
    'le statut en base ne doit JAMAIS basculer sur accepted après ce refus');

  const r2 = await owner.post('owner_order_decide.php', { id, action: 'refuse' });
  assert.equal(r2.status, 409, r2.text);
  assert.equal(r2.json.error, 'already_decided');
});

test("une tentative d'ajout OU de modification (order_addendum_create.php, désactivée en libre-service "
  + "depuis le 24/11/2026 pour les deux kinds) ne laisse AUCUNE trace côté commerçant : ni addenda, ni "
  + "ticket complémentaire, ni changement de statut — seule l'annulation (order_cancel.php) reste active", async () => {
  const t0 = BASE_EPOCH + 60_000;
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
  assert.equal(modif.json.error, 'addendum_disabled');

  const ajout = await client.post('order_addendum_create.php', {
    order_id: id, idempotency_key: 'ownerview-ajout-' + Date.now(), kind: 'add',
    items: [{ name: 'Régina', variant: 'Duo', qty: 1, unit_price_cents: REGINA_DUO, removed: [], extras: [], half: null, note: '' }],
    total_cents: 3200
  });
  assert.equal(ajout.status, 409, ajout.text);
  assert.equal(ajout.json.error, 'addendum_disabled');

  const apres = await owner.get('owner_orders.php');
  const apresOrder = trouverCommande(apres.json, id);
  assert.equal(apresOrder.status, 'new', "le statut de la commande n'a pas bougé");
  assert.equal(apresOrder.addenda.length, 0, "ni la modification ni l'ajout rejetés ne doivent créer d'order_addenda");
  assert.equal(
    Number(db.prepare('SELECT COUNT(*) AS n FROM addendum_print_jobs WHERE addendum_id IN (SELECT id FROM order_addenda WHERE order_id = ?)').get(id).n),
    0,
    'aucun ticket complémentaire ne doit avoir été créé pour une tentative rejetée'
  );

  // Preuve que ce n'est pas une panne générale du serveur : une vraie demande d'annulation, elle, passe
  // toujours et apparaît immédiatement côté commerçant (seule order_addendum_create.php est désactivée).
  const annulation = await client.post('order_cancel.php', { id });
  assert.equal(annulation.status, 200, annulation.text);
  const finalVue = await owner.get('owner_orders.php');
  const finalOrder = trouverCommande(finalVue.json, id);
  assert.equal(finalOrder.addenda.length, 1, "la demande d'annulation, elle, apparaît");
  assert.equal(finalOrder.addenda[0].kind, 'cancel');
});
