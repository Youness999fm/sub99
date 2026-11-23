// Commande planifiée, type Uber Eats (serveur/planification.js + schedule_slots.php + order_create.php).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { creneauxDisponibles, creneauValide, FENETRE_RETRAIT, DELAI_MIN_MINUTES, JOURS_MAX, PAS_MINUTES } from '../../serveur/planification.js';

// ---------------------------------------------------------------- 1. module pur (dates/créneaux)

test('créneaux disponibles : fenêtre fixe 18h20-22h30, pas de 30 min, bornes incluses', () => {
  // Hiver, bien avant l'ouverture : le délai minimum (1h) n'entre pas en jeu, seule la fenêtre compte.
  const maintenant = Math.floor(Date.UTC(2026, 10, 20, 8, 0, 0) / 1000); // 09:00 Paris (UTC+1)
  const jours = creneauxDisponibles(maintenant);
  assert.equal(jours.length, JOURS_MAX);
  assert.equal(jours[0].date, '2026-11-20');
  assert.equal(jours[0].slots[0].time, '18h30'); // premier multiple de 30 min >= 18h20
  assert.equal(jours[0].slots[0].iso, '2026-11-20T17:30:00Z'); // 18h30 Paris (hiver) = 17h30 UTC
  const dernier = jours[0].slots[jours[0].slots.length - 1];
  assert.equal(dernier.time, '22h30');
  assert.equal(dernier.iso, '2026-11-20T21:30:00Z');
  assert.equal(jours[0].slots.length, 9); // 18h30, 19h00, ..., 22h30 : 9 créneaux de 30 min
});

test('créneaux disponibles : le délai minimum (1h) masque les créneaux trop proches', () => {
  // 21h50 Paris (hiver) un jour donné : le délai minimum pousse le premier créneau du jour à 22h50 (hors fenêtre) -> aucun créneau ce jour-là.
  const maintenant = Math.floor(Date.UTC(2026, 10, 20, 20, 50, 0) / 1000); // 21h50 Paris
  const jours = creneauxDisponibles(maintenant);
  assert.equal(jours[0].date, '2026-11-21', 'le 20/11 ne doit plus avoir de créneau (tous sous le délai minimum)');
});

test('créneauValide : alignement, délai minimum, fenêtre 18h20-22h30, 7 jours max', () => {
  const maintenant = Math.floor(Date.UTC(2026, 10, 20, 8, 0, 0) / 1000); // 09:00 Paris
  const paris = (h, m, joursPlus = 1) => Math.floor(Date.UTC(2026, 10, 20 + joursPlus, h - 1, m, 0) / 1000); // -1h : hiver UTC+1
  assert.equal(creneauValide(paris(19, 0), maintenant), true, '19h00 demain : dans la fenêtre, aligné, largement au-delà du délai');
  assert.equal(creneauValide(paris(22, 30), maintenant), true, '22h30 inclus');
  assert.equal(creneauValide(paris(22, 31), maintenant), false, 'non aligné sur 30 min');
  assert.equal(creneauValide(paris(18, 0), maintenant), false, 'avant 18h20');
  assert.equal(creneauValide(paris(23, 0), maintenant), false, 'après 22h30');
  assert.equal(creneauValide(paris(20, 0, 0), maintenant), true, 'aujourd’hui 20h00 : largement plus d’1h après 09h00, dans la fenêtre');
  assert.equal(creneauValide(paris(9, 30, 0), maintenant), false, 'aujourd’hui 09h30 : hors fenêtre et moins d’1h après maintenant (09h00)');
  assert.equal(creneauValide(paris(19, 0, JOURS_MAX), maintenant), false, `plus de ${JOURS_MAX} jours à l'avance`);
  assert.equal(creneauValide(NaN, maintenant), false, 'epoch non entier');
});

test('constantes exposées (type Uber Eats : créneaux 30 min, 7 jours, 1h de délai)', () => {
  assert.equal(PAS_MINUTES, 30);
  assert.equal(JOURS_MAX, 7);
  assert.equal(DELAI_MIN_MINUTES, 60);
  assert.deepEqual(FENETRE_RETRAIT, { debut: 18 * 60 + 20, fin: 22 * 60 + 30 });
});

// ---------------------------------------------------------------- 2. parcours réel (serveur + DB)
// Lancer depuis la racine :  SUBITO_TEST_PORT=18430 node --test tests/api-vercel/planification.test.mjs

// +16 : ce fichier n'avait, par oubli, aucun décalage de port (collision silencieuse avec api.test.mjs
// et les autres fichiers sans décalage — voir fondations.test.mjs/horaires.test.mjs/statut-pret.test.mjs).
process.env.SUBITO_TEST_PORT = String(Number(process.env.SUBITO_TEST_PORT || 8091) + 16);
const { makeEnv, runTool, startServer, stopServer, Client, openTestDb, OWNER_CODE, SUPER_CODE } = await import('./lib/harness.mjs');

let ctx;
let proc;
let db;
let alice;
let owner;

before(async () => {
  ctx = makeEnv();
  assert.equal((await runTool(ctx, 'install.php')).code, 0);
  db = openTestDb(ctx);
  proc = await startServer(ctx);
  alice = new Client('alice-planif');
  const r = await alice.post('customer_signup.php', {
    first_name: 'Test', last_name: 'Planif', email: 'planif@example.test', phone: '06 00 00 00 03',
    password: 'Motdepasse-planifxA1', street: null, city: null
  });
  assert.equal(r.status, 201, r.text);
  owner = new Client('owner-planif');
  assert.equal((await owner.post('owner_login.php', { code: OWNER_CODE, remember: false })).status, 200);
});
after(() => { try { db?.close(); } catch { /* déjà fermée */ } return stopServer(proc); });

function expectError(r, status, code) {
  assert.equal(r.status, status, `${r.method} ${r.route} : ${r.text}`);
  assert.equal(r.json?.ok, false);
  assert.equal(r.json?.error, code, r.text);
}

const corps = (cle, scheduled_for) => ({
  idempotency_key: cle, mode: 'pickup', payment_methods: [], cash_change_for: null,
  items: [{ name: 'Régina', variant: 'Duo', qty: 1, unit_price_cents: 1600, removed: [], extras: [], half: null, note: '' }],
  delivery_fee_cents: 0, total_cents: 1600, scheduled_for: scheduled_for ?? null
});

test('schedule_slots.php : public, forme attendue, créneaux de 30 min dans 18h20-22h30', async () => {
  const anon = new Client('anon-planif');
  const r = await anon.get('schedule_slots.php');
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.ok, undefined); // comme availability.php : pas de clé « ok »
  assert.equal(r.json.immediate_open, true);
  assert.equal(r.json.min_lead_minutes, 60);
  assert.equal(r.json.max_days, 7);
  assert.equal(r.json.step_minutes, 30);
  assert.ok(Array.isArray(r.json.days) && r.json.days.length > 0);
  for (const jour of r.json.days) {
    assert.match(jour.date, /^\d{4}-\d{2}-\d{2}$/);
    for (const s of jour.slots) {
      assert.match(s.time, /^\d{1,2}h\d{2}$/);
      assert.ok(Date.parse(s.iso) > 0);
    }
  }
});

test('order_create : commande programmée acceptée sur un créneau réellement proposé', async () => {
  const r0 = await alice.get('schedule_slots.php');
  const slot = r0.json.days[1].slots[0]; // 2e jour : jamais affecté par le délai minimum
  const r = await alice.post('order_create.php', corps('planif-ok', slot.iso));
  assert.equal(r.status, 201, r.text);
  assert.equal(r.json.order.scheduled_for, slot.iso);
  assert.equal(r.json.order.status, 'new');
});

test('order_create : créneau non aligné, trop proche, trop lointain ou hors fenêtre -> 422 invalid_schedule', async () => {
  const r0 = await alice.get('schedule_slots.php');
  const slot = r0.json.days[1].slots[0];
  const dateAlignee = new Date(slot.iso);

  const nonAligne = new Date(dateAlignee.getTime() + 7 * 60000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  expectError(await alice.post('order_create.php', corps('planif-nonaligne', nonAligne)), 422, 'invalid_schedule');

  const dansUneMinute = new Date(Date.now() + 60000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  expectError(await alice.post('order_create.php', corps('planif-trop-tot', dansUneMinute)), 422, 'invalid_schedule');

  const dansHuitJours = new Date(Date.now() + 8 * 86400000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  expectError(await alice.post('order_create.php', corps('planif-trop-loin', dansHuitJours)), 422, 'invalid_schedule');

  // Même jour, même heure que le créneau valide mais hors fenêtre (10h00 au lieu de l'heure choisie) : construit à partir
  // de la date du créneau valide pour rester dans les 7 jours, juste en dehors de 18h20-22h30.
  const horsFenetre = new Date(dateAlignee);
  horsFenetre.setUTCHours(9, 0, 0, 0); // 10h00 Paris (hiver)
  expectError(await alice.post('order_create.php', corps('planif-hors-fenetre', horsFenetre.toISOString().replace(/\.\d{3}Z$/, 'Z'))), 422, 'invalid_schedule');
});

test('fermeture manuelle (accès supérieur, FORCE_CLOSED) : bloque « dès que possible », jamais les commandes programmées (SBT-003)', async () => {
  const close = await owner.post('owner_open_mode.php', { mode: 'closed', code: SUPER_CODE });
  assert.equal(close.status, 200, close.text);
  assert.equal(close.json.mode, 'closed');
  assert.equal(close.json.ouvert, false);
  try {
    // schedule_slots.php continue de proposer de vrais créneaux : seule une commande « dès que possible » est bloquée.
    const slots = await alice.get('schedule_slots.php');
    assert.equal(slots.json.immediate_open, false);
    assert.ok(Array.isArray(slots.json.days) && slots.json.days.length > 0, 'les créneaux restent proposés, restaurant fermé');

    const immediat = corps('planif-ferme-immediat', null);
    expectError(await alice.post('order_create.php', immediat), 422, 'closed');

    const slot = slots.json.days[1].slots[0];
    const r = await alice.post('order_create.php', corps('planif-ferme-programmee', slot.iso));
    assert.equal(r.status, 201, r.text); // une commande planifiée reste acceptée même fermé
  } finally {
    const reopen = await owner.post('owner_open_mode.php', { mode: 'auto', code: SUPER_CODE });
    assert.equal(reopen.json.mode, 'auto');
  }
});

test('owner_open_mode.php : POST réservé au code supérieur (le code commerçant seul ne suffit pas)', async () => {
  const sansCode = await owner.post('owner_open_mode.php', { mode: 'closed', code: 'faux-code' });
  assert.equal(sansCode.status, 403, sansCode.text);
  assert.equal(sansCode.json.error, 'invalid_super_code');
  const get = await owner.get('owner_open_mode.php'); // la LECTURE ne demande pas le code supérieur
  assert.equal(get.status, 200, get.text);
  assert.equal(get.json.mode, 'auto');
});
