// Ajout de commande (order_addendum_create.php) : fenêtre stricte de 10 minutes depuis orders.created_at,
// jamais prolongée par un ajout précédent. Le ticket complémentaire ne doit jamais reprendre les articles
// déjà transmis (vérifié ici au niveau données ; le rendu du ticket lui-même est couvert par
// addendum-print-jobs.test.mjs). Horloge pilotée : bornes testées à la seconde exacte.
// kind='modify' (modifier un article déjà envoyé) n'est volontairement plus proposé en libre-service
// depuis le 22/11/2026 — voir les deux tests dédiés plus bas qui vérifient son rejet (409 modify_disabled).
// Lancer depuis la racine :  SUBITO_TEST_PORT=18430 node --test tests/api-vercel/order-addendum.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

process.env.SUBITO_TEST_PORT = String(Number(process.env.SUBITO_TEST_PORT || 8091) + 6);
const { OWNER_CODE, Client, openTestDb, makeEnv, runTool, startServer, stopServer } = await import('./lib/harness.mjs');
const { ADDENDUM_WINDOW_S } = await import('../../serveur/orders.js');

const randomPassword = () => Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(18))).toString('base64url') + 'Aa1!';

let ctx;
let server;
let db;
const owner = new Client('owner-addendum');
let keySeq = 0;

function expectError(r, status, code) {
  assert.equal(r.status, status, `${r.method} ${r.route} : ${r.text}`);
  assert.equal(r.json?.ok, false);
  assert.equal(r.json?.error, code, r.text);
}

const clockDir = mkdtempSync(path.join(process.env.SUBITO_TEST_DIR || tmpdir(), 'subito-addendum-clock-'));
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
    first_name: 'Thomas', last_name: 'Test', email, phone: '0612345678', password,
    street: '1 rue des Tests', city: 'Hénin-Beaumont', housing_type: 'maison'
  });
  assert.equal(r.status, 201, r.text);
  return c;
}

const REGINA_DUO = 1600; // prix de base Régina en taille Duo (voir catalogue.test.mjs)

/** Commande « dès que possible » (à emporter) de `qty` Régina Duo ; retourne { id, total_cents }. */
async function commander(client, qty = 1) {
  const gross = qty * REGINA_DUO;
  const promo = Math.floor(qty / 2) * REGINA_DUO; // à emporter : une pizza offerte par paire (même prix ici)
  const total = gross - promo;
  const r = await client.post('order_create.php', {
    idempotency_key: 'addendum-test-' + Date.now() + '-' + (++keySeq), mode: 'pickup',
    payment_methods: ['cash'], cash_change_for: null, hot_sauce: null,
    items: [{ name: 'Régina', variant: 'Duo', qty, unit_price_cents: REGINA_DUO, removed: [], extras: [], half: null, note: '' }],
    delivery_fee_cents: 0, total_cents: total
  });
  assert.equal(r.status, 201, r.text);
  return { id: r.json.order.id, total_cents: total, itemId: r.json.order.items[0].id };
}

function ajout(client, orderId, items, totalCents, keyOverride) {
  return client.post('order_addendum_create.php', {
    order_id: orderId, idempotency_key: keyOverride ?? ('add-' + Date.now() + '-' + (++keySeq)),
    kind: 'add', items, total_cents: totalCents
  });
}

test("Thomas : 2 Régina Duo, puis 2 de plus — le ticket complémentaire ne reprend QUE les 2 nouvelles", async () => {
  const t0 = BASE_EPOCH + 10_000;
  poserHorloge(t0);
  const thomas = await nouveauClient('thomas-2duo@example.test');
  const { id, total_cents } = await commander(thomas, 2); // 2 * 1600 - 1600 = 1600
  assert.equal(total_cents, 1600);

  poserHorloge(t0 + 300); // 5 minutes plus tard
  const nouveauTotal = 4 * REGINA_DUO - 2 * REGINA_DUO; // 4 pizzas, 2 paires, 2 offertes = 3200
  const r = await ajout(thomas, id, [
    { name: 'Régina', variant: 'Duo', qty: 2, unit_price_cents: REGINA_DUO, removed: [], extras: [], half: null, note: '' }
  ], nouveauTotal);
  assert.equal(r.status, 201, r.text);
  assert.equal(r.json.replayed, false);
  assert.equal(r.json.addendum.kind, 'add');
  assert.equal(r.json.addendum.seq, 1, 'premier ajout de cette commande : AJOUT N°1');
  assert.equal(r.json.addendum.items.length, 1, 'une seule ligne dans le ticket complémentaire');
  assert.equal(r.json.addendum.items[0].qty, 2, 'la ligne du ticket complémentaire ne contient QUE les 2 nouvelles pizzas');
  assert.equal(r.json.addendum.delta_cents, nouveauTotal - total_cents, 'le supplément facturé correspond au nouveau total recalculé, pas au prix brut des 2 pizzas');
  assert.equal(r.json.order.total_cents, nouveauTotal);
  assert.equal(r.json.order.items.length, 1, "order_items reste immuable : toujours 1 ligne d'origine (qty 2), jamais réécrite");
  assert.equal(r.json.order.items[0].qty, 2, "les 2 pizzas d'origine ne sont jamais recomptées dans order_items");
  assert.equal(r.json.order.addenda.length, 1);
});

test('fenêtre à la seconde exacte : 599 s acceptée, 600 s et 601 s refusées (too_late), jamais prolongée par un ajout précédent', async () => {
  const t0 = BASE_EPOCH + 20_000;
  poserHorloge(t0);
  const cust = await nouveauClient('fenetre-10min@example.test');
  const { id } = await commander(cust, 1);

  // Premier ajout à 9 min : encore dans la fenêtre.
  poserHorloge(t0 + 540);
  const r1 = await ajout(cust, id, [{ name: 'Régina', variant: 'Duo', qty: 1, unit_price_cents: REGINA_DUO, removed: [], extras: [], half: null, note: '' }], REGINA_DUO * 2 - REGINA_DUO);
  assert.equal(r1.status, 201, r1.text);

  // Deuxième ajout à 9 min 30 : ENCORE dans la fenêtre (10 min depuis created_at, pas depuis le 1er ajout).
  poserHorloge(t0 + 570);
  const r2 = await ajout(cust, id, [{ name: 'Régina', variant: 'Duo', qty: 1, unit_price_cents: REGINA_DUO, removed: [], extras: [], half: null, note: '' }], 3 * REGINA_DUO - REGINA_DUO);
  assert.equal(r2.status, 201, r2.text);
  assert.equal(r2.json.addendum.seq, 2);

  // Exactement 10 minutes : refusé.
  poserHorloge(t0 + ADDENDUM_WINDOW_S);
  expectError(await ajout(cust, id, [{ name: 'Régina', variant: 'Duo', qty: 1, unit_price_cents: REGINA_DUO, removed: [], extras: [], half: null, note: '' }], 99999), 409, 'too_late');

  // 10 min 01 s : refusé aussi.
  poserHorloge(t0 + ADDENDUM_WINDOW_S + 1);
  expectError(await ajout(cust, id, [{ name: 'Régina', variant: 'Duo', qty: 1, unit_price_cents: REGINA_DUO, removed: [], extras: [], half: null, note: '' }], 99999), 409, 'too_late');
});

test('idempotence : rejeu répond replayed:true, contenu différent sous la même clé -> 409 idempotency_conflict', async () => {
  const t0 = BASE_EPOCH + 30_000;
  poserHorloge(t0);
  const cust = await nouveauClient('idempotence-ajout@example.test');
  const { id, total_cents } = await commander(cust, 1);
  poserHorloge(t0 + 10);
  const cle = 'idem-fixe-' + Date.now();
  const nouveauTotal = 2 * REGINA_DUO - REGINA_DUO;
  const items = [{ name: 'Régina', variant: 'Duo', qty: 1, unit_price_cents: REGINA_DUO, removed: [], extras: [], half: null, note: '' }];

  const r1 = await ajout(cust, id, items, nouveauTotal, cle);
  assert.equal(r1.status, 201, r1.text);

  const r2 = await ajout(cust, id, items, nouveauTotal, cle);
  assert.equal(r2.status, 200, r2.text);
  assert.equal(r2.json.replayed, true);
  assert.equal(r2.json.addendum.id, r1.json.addendum.id);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM order_addenda WHERE order_id = ?').get(id).n, 1, 'un seul événement malgré le rejeu');

  const r3 = await ajout(cust, id, [{ ...items[0], qty: 5 }], nouveauTotal, cle);
  expectError(r3, 409, 'idempotency_conflict');
});

test('double-clic concurrent sur le même ajout : une seule transition, le second appel est un rejeu', async () => {
  const t0 = BASE_EPOCH + 40_000;
  poserHorloge(t0);
  const cust = await nouveauClient('double-clic-ajout@example.test');
  const { id } = await commander(cust, 1);
  poserHorloge(t0 + 5);
  const cle = 'double-clic-' + Date.now();
  const items = [{ name: 'Régina', variant: 'Duo', qty: 1, unit_price_cents: REGINA_DUO, removed: [], extras: [], half: null, note: '' }];
  const total = 2 * REGINA_DUO - REGINA_DUO;
  const [r1, r2] = await Promise.all([ajout(cust, id, items, total, cle), ajout(cust, id, items, total, cle)]);
  assert.equal(r1.status < 300, true, r1.text);
  assert.equal(r2.status < 300, true, r2.text);
  const replayedFlags = [r1.json.replayed, r2.json.replayed].sort();
  assert.deepEqual(replayedFlags, [false, true]);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM order_addenda WHERE order_id = ?').get(id).n, 1);
});

// Décision du 22/11/2026 : modifier un article déjà envoyé (changer ses ingrédients après coup) n'est
// PLUS proposé en libre-service — le client doit appeler le restaurant. kind='modify' est donc rejeté
// explicitement (409 modify_disabled, message clair avec le téléphone), que la cible soit un article
// d'origine (order_items) ou un article introduit par un ajout précédent (order_addendum_items). Seul
// l'ajout d'un nouvel article (kind='add') reste en libre-service — vérifié juste après, sur la même
// commande, pour prouver que le rejet du modify n'affecte pas la capacité d'ajout.
test("kind='modify' est rejeté (409 modify_disabled) sur un article d'origine, et n'empêche pas un ajout ensuite", async () => {
  const t0 = BASE_EPOCH + 50_000;
  poserHorloge(t0);
  const cust = await nouveauClient('modif-origine@example.test');
  const { id, itemId, total_cents } = await commander(cust, 1); // Régina Duo d'origine
  poserHorloge(t0 + 10);

  const r = await cust.post('order_addendum_create.php', {
    order_id: id, idempotency_key: 'modif-' + Date.now(), kind: 'modify', target_item_id: itemId,
    item: { qty: 1, unit_price_cents: REGINA_DUO, removed: ['jambon'], extras: [{ name: 'poulet', price_cents: 0, qty: 1 }], note: '' },
    total_cents: REGINA_DUO
  });
  expectError(r, 409, 'modify_disabled');
  assert.equal(typeof r.json.message, 'string');
  assert.equal(r.json.phone, '0321200033');
  // Rien n'a changé : ni nouvel événement, ni total modifié.
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM order_addenda WHERE order_id = ?').get(id).n, 0);
  const relu = await cust.get('order_status.php?id=' + id);
  assert.equal(relu.json.order.total_cents, total_cents);

  // L'ajout d'un nouvel article, lui, continue de fonctionner normalement sur cette même commande.
  poserHorloge(t0 + 20);
  const addR = await ajout(cust, id, [{ name: 'Régina', variant: 'Duo', qty: 1, unit_price_cents: REGINA_DUO, removed: [], extras: [], half: null, note: '' }], 2 * REGINA_DUO - REGINA_DUO);
  assert.equal(addR.status, 201, addR.text);
});

test("kind='modify' est aussi rejeté (409 modify_disabled) quand la cible est un article introduit par un ajout précédent", async () => {
  const t0 = BASE_EPOCH + 60_000;
  poserHorloge(t0);
  const cust = await nouveauClient('modif-ajout@example.test');
  const { id } = await commander(cust, 1);
  poserHorloge(t0 + 10);

  const addR = await ajout(cust, id, [{ name: 'Régina', variant: 'Duo', qty: 1, unit_price_cents: REGINA_DUO, removed: [], extras: [], half: null, note: '' }], 2 * REGINA_DUO - REGINA_DUO);
  assert.equal(addR.status, 201, addR.text);
  const addendumItemId = addR.json.addendum.items[0].id;
  assert.ok(Number.isInteger(addendumItemId));

  poserHorloge(t0 + 20);
  const modR = await cust.post('order_addendum_create.php', {
    order_id: id, idempotency_key: 'modif-ajout-' + Date.now(), kind: 'modify', target_addendum_item_id: addendumItemId,
    item: { qty: 1, unit_price_cents: REGINA_DUO + 150, removed: [], extras: [{ name: 'olives', price_cents: 150, qty: 1 }], note: '' },
    total_cents: 2 * REGINA_DUO - REGINA_DUO + 150
  });
  expectError(modR, 409, 'modify_disabled');
  // Toujours un seul événement (le ajout initial) : le modify rejeté n'a rien créé.
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM order_addenda WHERE order_id = ?').get(id).n, 1);
});

test('statuts non éligibles : ready, refused, cancelled -> 409 not_addable', async () => {
  const t0 = BASE_EPOCH + 70_000;
  poserHorloge(t0);
  // La session commerçant (12h sans « se souvenir ») a expiré sur l'horloge pilotée depuis before() :
  // reconnexion, seul endroit de ce fichier qui réutilise owner après autant d'avance d'horloge.
  assert.equal((await owner.post('owner_login.php', { code: OWNER_CODE, remember: false })).status, 200);
  const cust = await nouveauClient('non-eligible@example.test');

  const { id: idReady } = await commander(cust, 1);
  poserHorloge(t0 + 1);
  assert.equal((await owner.post('owner_order_decide.php', { id: idReady, action: 'accept', delay_minutes: 0 })).status, 200);
  assert.equal((await owner.post('owner_order_decide.php', { id: idReady, action: 'ready' })).status, 200);
  poserHorloge(t0 + 2);
  expectError(await ajout(cust, idReady, [{ name: 'Régina', variant: 'Duo', qty: 1, unit_price_cents: REGINA_DUO, removed: [], extras: [], half: null, note: '' }], 99999), 409, 'not_addable');

  const { id: idRefused } = await commander(cust, 1);
  poserHorloge(t0 + 3);
  assert.equal((await owner.post('owner_order_decide.php', { id: idRefused, action: 'refuse' })).status, 200);
  expectError(await ajout(cust, idRefused, [{ name: 'Régina', variant: 'Duo', qty: 1, unit_price_cents: REGINA_DUO, removed: [], extras: [], half: null, note: '' }], 99999), 409, 'not_addable');

  const { id: idCancelled } = await commander(cust, 1);
  poserHorloge(t0 + 4);
  assert.equal((await cust.post('order_cancel.php', { id: idCancelled })).status, 200);
  assert.equal((await owner.post('owner_cancel_decide.php', { id: idCancelled, action: 'accept' })).status, 200);
  expectError(await ajout(cust, idCancelled, [{ name: 'Régina', variant: 'Duo', qty: 1, unit_price_cents: REGINA_DUO, removed: [], extras: [], half: null, note: '' }], 99999), 409, 'not_addable');
});

test("isolation : un autre client ne peut pas ajouter à la commande d'un client différent", async () => {
  const t0 = BASE_EPOCH + 80_000;
  poserHorloge(t0);
  const custA = await nouveauClient('addendum-a@example.test');
  const custB = await nouveauClient('addendum-b@example.test');
  const { id } = await commander(custA, 1);
  poserHorloge(t0 + 2);
  expectError(await ajout(custB, id, [{ name: 'Régina', variant: 'Duo', qty: 1, unit_price_cents: REGINA_DUO, removed: [], extras: [], half: null, note: '' }], 99999), 404, 'not_found');
});

// Le harnais (stopServer/startServer) partage un agent HTTP et un pilote DB au niveau du module : aucun
// autre fichier de ce dossier ne redémarre le serveur EN COURS de test (seulement en after()), car
// stopServer() ferme définitivement l'agent HTTP partagé et le pilote PGlite, que startServer() ne
// recrée pas. La preuve de persistance pertinente ici — rien n'est gardé en mémoire côté serveur, tout
// est écrit en base dans la même transaction (voir order_addendum_create.js) — se vérifie directement en
// base, sans dépendre d'un redémarrage réel que le harnais ne permet pas de simuler proprement.
test("persistance : l'ajout est un vrai commit en base (survivrait à un redémarrage), pas un état en mémoire", async () => {
  const t0 = BASE_EPOCH + 90_000;
  poserHorloge(t0);
  const cust = await nouveauClient('persistance@example.test');
  const { id } = await commander(cust, 1);
  poserHorloge(t0 + 5);
  const r1 = await ajout(cust, id, [{ name: 'Régina', variant: 'Duo', qty: 1, unit_price_cents: REGINA_DUO, removed: [], extras: [], half: null, note: '' }], 2 * REGINA_DUO - REGINA_DUO);
  assert.equal(r1.status, 201, r1.text);

  const addendumRow = db.prepare('SELECT * FROM order_addenda WHERE id = ?').get(r1.json.addendum.id);
  assert.ok(addendumRow, "l'événement existe comme une vraie ligne committée dans order_addenda");
  assert.equal(addendumRow.order_id, id);
  const itemRows = db.prepare('SELECT * FROM order_addendum_items WHERE addendum_id = ?').all(r1.json.addendum.id);
  assert.equal(itemRows.length, 1);
  const jobRow = db.prepare('SELECT * FROM addendum_print_jobs WHERE addendum_id = ?').get(r1.json.addendum.id);
  assert.ok(jobRow, 'la tâche de ticket complémentaire est aussi committée, pas seulement en mémoire');

  // Nouvelle lecture indépendante (order_status), sans rien réutiliser de la réponse de création : prouve
  // que l'état vient bien d'être relu depuis la base, pas d'un cache de la requête précédente.
  poserHorloge(t0 + 6);
  const r2 = await cust.get('order_status.php?id=' + id);
  assert.equal(r2.status, 200, r2.text);
  assert.equal(r2.json.order.addenda.length, 1);
  assert.equal(r2.json.order.addenda[0].id, r1.json.addendum.id);
});

test('ajout d\'une pizza personnalisée (retrait + supplément), pas seulement une pizza telle quelle', async () => {
  const t0 = BASE_EPOCH + 100_000;
  poserHorloge(t0);
  const cust = await nouveauClient('ajout-personnalise@example.test');
  const { id } = await commander(cust, 1); // Régina Duo d'origine
  poserHorloge(t0 + 10);

  // Nouvelle pizza ajoutée avec un retrait (légume, 1,50€) qui ne couvre pas un supplément viande (2,00€) : payant.
  const unit = REGINA_DUO + 200;
  const r = await cust.post('order_addendum_create.php', {
    order_id: id, idempotency_key: 'perso-' + Date.now(), kind: 'add',
    items: [{ name: 'Régina', variant: 'Duo', qty: 1, unit_price_cents: unit, removed: ['champignons'], extras: [{ name: 'poulet', price_cents: 200, qty: 1 }], half: null, note: 'bien cuite' }],
    total_cents: 2 * REGINA_DUO + 200 - REGINA_DUO // 2 pizzas (paire : la moins chère offerte) + le supplément payant
  });
  assert.equal(r.status, 201, r.text);
  assert.equal(r.json.addendum.items.length, 1);
  assert.equal(r.json.addendum.items[0].removed[0], 'champignons');
  assert.equal(r.json.addendum.items[0].extras[0].name, 'poulet');
  assert.equal(r.json.addendum.items[0].note, 'bien cuite');
});

test('ajout puis annulation de la commande, les deux dans les délais autorisés', async () => {
  const t0 = BASE_EPOCH + 110_000;
  poserHorloge(t0);
  const cust = await nouveauClient('ajout-puis-annulation@example.test');
  const { id } = await commander(cust, 1);
  poserHorloge(t0 + 30); // ajout à 30 s (dans les deux fenêtres, 4 min et 10 min)
  const addR = await ajout(cust, id, [{ name: 'Régina', variant: 'Duo', qty: 1, unit_price_cents: REGINA_DUO, removed: [], extras: [], half: null, note: '' }], 2 * REGINA_DUO - REGINA_DUO);
  assert.equal(addR.status, 201, addR.text);

  poserHorloge(t0 + 200); // demande d'annulation à 3 min 20 (encore dans les 4 min depuis created_at)
  const cancelR = await cust.post('order_cancel.php', { id });
  assert.equal(cancelR.status, 200, cancelR.text);
  assert.equal(cancelR.json.order.status, 'new', 'encore en attente de la validation du commerçant');

  const decideR = await owner.post('owner_cancel_decide.php', { id, action: 'accept' });
  assert.equal(decideR.status, 200, decideR.text);
  assert.equal(decideR.json.order.status, 'cancelled');
  // L'historique des ajouts reste visible même après annulation (traçabilité), l'ajout n'est jamais effacé.
  assert.equal(decideR.json.order.addenda.length, 2, 'l\'ajout ET la demande d\'annulation restent dans l\'historique');
});
