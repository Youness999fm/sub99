// Commande planifiée déposée HORS SERVICE (décision du 22/11/2026) : le commerçant n'est pas là pour
// l'accepter lui-même, donc order_create.php l'accepte automatiquement ; le ticket ne sort qu'une seule
// fois, exactement à l'ouverture du jour demandé par le client (jamais un compte à rebours H-45 avant
// l'heure de retrait, réservé aux commandes acceptées par le commerçant lui-même pendant le service).
// Lancer depuis la racine :  SUBITO_TEST_PORT=18438 node --test tests/api-vercel/scheduled-order-auto-accept.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

process.env.SUBITO_TEST_PORT = String(Number(process.env.SUBITO_TEST_PORT || 8091) + 9);
const { Client, openTestDb, makeEnv, runTool, startServer, stopServer } = await import('./lib/harness.mjs');
const { parisLocalVersEpoch, jourParisDecale } = await import('../../serveur/util.js');

let ctx;
let server;
let db;
let keySeq = 0;

const clockDir = mkdtempSync(path.join(process.env.SUBITO_TEST_DIR || tmpdir(), 'subito-auto-accept-clock-'));
const clockFile = path.join(clockDir, 'horloge.txt');
function poserHorloge(e) { writeFileSync(clockFile, String(e)); }
const isoDe = (e) => new Date(e * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');

// Créneau de retrait dans la fenêtre fixe 18h20-22h30 (indépendante de HORAIRES_COMMANDES), demain à 20h00.
const demain = jourParisDecale(Math.floor(Date.now() / 1000), 1);
const SCHEDULED_EPOCH = parisLocalVersEpoch(demain.annee, demain.mois, demain.jour, 20, 0);
const SCHEDULED_ISO = isoDe(SCHEDULED_EPOCH);
// « Maintenant » : 6h avant le créneau choisi, largement avant (délai minimum 1h, fenêtre 7 jours).
const AVANT_EPOCH = SCHEDULED_EPOCH - 6 * 3600;

before(async () => {
  ctx = makeEnv();
  ctx.env.SUBITO_TEST_CLOCK_FILE = clockFile;
  poserHorloge(AVANT_EPOCH);
  const inst = await runTool(ctx, 'install.php');
  assert.equal(inst.code, 0, inst.stderr + inst.stdout);
  db = openTestDb(ctx);
  server = await startServer(ctx);
});

after(() => {
  delete process.env.HORAIRES_COMMANDES;
  stopServer(server);
  try { db?.close(); } catch { /* déjà fermée */ }
});

async function nouveauClient(email) {
  const c = new Client('cust-' + email);
  const r = await c.post('customer_signup.php', {
    first_name: 'AutoAccept', last_name: 'Test', email, phone: '0612345678', password: 'TestAutoAccept99!xzQ',
    street: '1 rue des Tests', city: 'Hénin-Beaumont', housing_type: 'maison'
  });
  assert.equal(r.status, 201, r.text);
  return c;
}

function commanderPlanifiee(client, cle) {
  return client.post('order_create.php', {
    idempotency_key: cle, mode: 'pickup', payment_methods: ['cash'], cash_change_for: null, hot_sauce: null,
    items: [{ name: 'Régina', variant: 'Duo', qty: 1, unit_price_cents: 1600, removed: [], extras: [], half: null, note: '' }],
    delivery_fee_cents: 0, total_cents: 1600, scheduled_for: SCHEDULED_ISO
  });
}

test('commande planifiée déposée HORS service (HORAIRES_COMMANDES ne couvre pas « maintenant ») : '
  + 'acceptée automatiquement, ticket dû à l\'ouverture du jour demandé (pas H-45 avant le retrait)', async () => {
  // Fenêtre d'une minute, douze heures après maintenant : forcément fermé à l'instant de la commande.
  process.env.HORAIRES_COMMANDES = '06:00-06:01';
  poserHorloge(AVANT_EPOCH);
  const client = await nouveauClient('auto-accept-ferme@example.test');
  const r = await commanderPlanifiee(client, 'auto-accept-ferme-1');
  assert.equal(r.status, 201, r.text);
  assert.equal(r.json.order.status, 'accepted', 'acceptée automatiquement, personne au comptoir pour le faire');
  assert.ok(r.json.order.accepted_at, 'accepted_at posé');
  assert.ok(Number.isInteger(r.json.order.delay_minutes), 'un délai par défaut est annoncé au client');

  const row = db.prepare('SELECT * FROM print_jobs WHERE order_id = ?').get(r.json.order.id);
  assert.ok(row, 'la tâche d\'impression doit exister tout de suite (pas seulement à l\'acceptation manuelle)');
  // Ouverture du jour demandé (demain) à 06:00 (créneau de test), jamais scheduled_for - 45 min (H-45).
  const ouvertureAttendue = parisLocalVersEpoch(demain.annee, demain.mois, demain.jour, 6, 0);
  assert.equal(row.print_due_at, isoDe(ouvertureAttendue));
  assert.notEqual(row.print_due_at, isoDe(SCHEDULED_EPOCH - 45 * 60), 'jamais le calcul H-45 pour une acceptation automatique');
});

test('commande planifiée déposée PENDANT le service (HORAIRES_COMMANDES couvre « maintenant ») : '
  + 'reste "new", aucune tâche d\'impression avant une acceptation manuelle du commerçant (comportement inchangé)', async () => {
  process.env.HORAIRES_COMMANDES = '00:00-23:59';
  poserHorloge(AVANT_EPOCH);
  const client = await nouveauClient('auto-accept-ouvert@example.test');
  const r = await commanderPlanifiee(client, 'auto-accept-ouvert-1');
  assert.equal(r.status, 201, r.text);
  assert.equal(r.json.order.status, 'new', 'le commerçant est là, il doit décider lui-même');
  assert.equal(r.json.order.accepted_at, null);
  const row = db.prepare('SELECT * FROM print_jobs WHERE order_id = ?').get(r.json.order.id);
  assert.equal(row, undefined, 'aucune tâche tant que le commerçant n\'a pas accepté lui-même');
});
