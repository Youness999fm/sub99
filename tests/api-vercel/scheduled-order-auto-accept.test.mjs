// Commande planifiée déposée HORS SERVICE (décision du 22/11/2026) : le commerçant n'est pas là pour
// l'accepter lui-même, donc order_create.php l'accepte automatiquement ; le ticket ne sort qu'une seule
// fois, exactement à l'ouverture du jour demandé par le client (jamais un compte à rebours H-45 avant
// l'heure de retrait, réservé aux commandes acceptées par le commerçant lui-même pendant le service).
// Lancer depuis la racine :  SUBITO_TEST_PORT=18430 node --test tests/api-vercel/scheduled-order-auto-accept.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// +9 collisionnait avec owner-order-trash.test.mjs (qui possède légitimement ce décalage) : deux serveurs
// HTTP de test sur le même port quand node --test lance les fichiers en parallèle, source d'un blocage
// silencieux plutôt qu'une erreur claire. +12 est libre (voir owner-cancel-view.test.mjs, qui prend +11).
process.env.SUBITO_TEST_PORT = String(Number(process.env.SUBITO_TEST_PORT || 8091) + 12);
const { OWNER_CODE, Client, openTestDb, makeEnv, runTool, startServer, stopServer } = await import('./lib/harness.mjs');
const { parisLocalVersEpoch, jourParisDecale, serviceDayAt } = await import('../../serveur/util.js');

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

// BUG RÉEL corrigé le 24/11/2026 : service_day était systématiquement celui du jour de la CRÉATION de la
// commande (serviceDay(), appelée sans argument), jamais celui du créneau demandé. owner_orders.js ne
// montre une commande déjà "accepted" (jamais "new") que si service_day = aujourd'hui — une commande
// planifiée acceptée automatiquement restait donc visible le jour de la commande (trop tôt, avant même
// l'ouverture du jour demandé) puis disparaissait DÉFINITIVEMENT de la vue commerçant le jour venu (plus
// jamais incluse dans owner_orders.php, son ticket pourtant "dû" restait orphelin, jamais réclamable).
test("commande planifiée 2 jours à l'avance, acceptée automatiquement le jour de la commande : "
  + "service_day est celui du CRÉNEAU demandé, pas celui de la création — invisible côté commerçant le "
  + "jour de la commande, visible et réclamable le jour demandé", async () => {
  process.env.HORAIRES_COMMANDES = '06:00-06:01';
  // Jour de la CRÉATION : 2 jours avant le créneau demandé (jamais relatif à « maintenant » réel, pour ne
  // jamais dépendre de l'heure à laquelle cette suite tourne) — sans ambiguïté un jour calendaire différent
  // du créneau, contrairement à AVANT_EPOCH (6 h avant, le même jour que le créneau la plupart du temps).
  const avantHier = jourParisDecale(SCHEDULED_EPOCH, -2);
  const creationEpoch = parisLocalVersEpoch(avantHier.annee, avantHier.mois, avantHier.jour, 10, 0);
  poserHorloge(creationEpoch);
  const owner = new Client('owner-auto-accept-service-day');
  // remember:true (session longue, 30 jours) : le test avance l'horloge de 2 jours pour atteindre le jour
  // demandé, largement au-delà des 12h d'une session courte (remember:false) — sans quoi la session
  // expirerait avant même d'avoir pu vérifier la réapparition de la commande.
  assert.equal((await owner.post('owner_login.php', { code: OWNER_CODE, remember: true })).status, 200);
  const client = await nouveauClient('auto-accept-service-day@example.test');
  const r = await commanderPlanifiee(client, 'auto-accept-service-day-1');
  assert.equal(r.status, 201, r.text);
  const id = r.json.order.id;
  assert.equal(r.json.order.status, 'accepted');
  assert.equal(r.json.order.service_day, `${demain.annee}-${String(demain.mois).padStart(2, '0')}-${String(demain.jour).padStart(2, '0')}`,
    "service_day doit être celui du créneau demandé, jamais celui du jour de la commande");

  // Le jour de la commande : ne doit PAS apparaître côté commerçant, bien trop tôt — service_day (le jour
  // du créneau) ne correspond pas à ce jour-là, et le statut n'est plus "new" (déjà accepté automatiquement).
  const vueJourCommande = await owner.get('owner_orders.php');
  assert.ok(!vueJourCommande.json.orders.some((o) => o.id === id),
    "une commande planifiée 2 jours à l'avance ne doit pas apparaître côté commerçant le jour de la commande");

  // Le jour demandé, à l'heure d'ouverture (créneau de test 06:00) : doit apparaître, et son ticket doit
  // être réclamable — sinon il resterait orphelin pour toujours (le vrai bug avant correctif).
  const ouvertureDemain = parisLocalVersEpoch(demain.annee, demain.mois, demain.jour, 6, 0);
  poserHorloge(ouvertureDemain);
  const vueDemain = await owner.get('owner_orders.php');
  const commandeDemain = vueDemain.json.orders.find((o) => o.id === id);
  assert.ok(commandeDemain, "la commande doit redevenir visible côté commerçant le jour demandé — plus jamais orpheline");
  assert.equal(commandeDemain.service_day, serviceDayAt(ouvertureDemain));
  const addendum = commandeDemain.print_job;
  assert.ok(addendum, 'la tâche d\'impression doit toujours exister');
  assert.equal(addendum.status, 'pending');
  assert.ok(commandeDemain.print_due, 'le ticket doit être dû à ce moment précis (ouverture du jour demandé)');
  const claim = await owner.post('owner_print_claim.php', { id, device: 'tablette-test' });
  assert.equal(claim.status, 200, claim.text);
  assert.equal(claim.json.claimed, true, 'le ticket doit rester réellement réclamable le jour demandé');
});
