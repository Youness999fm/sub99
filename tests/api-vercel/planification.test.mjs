// Commande planifiée, type Uber Eats (serveur/planification.js + schedule_slots.php + order_create.php).
// Deux fenêtres indépendantes depuis le 21/11 : retrait (18h20-22h30) et livraison (19h-22h, sans marge).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { creneauxDisponibles, creneauValide, FENETRE_RETRAIT, FENETRE_LIVRAISON, DELAI_MIN_MINUTES, JOURS_MAX, PAS_MINUTES } from '../../serveur/planification.js';

// ---------------------------------------------------------------- 1. module pur (dates/créneaux)

test('créneaux disponibles (retrait) : fenêtre fixe 18h20-22h30, pas de 30 min, bornes incluses', () => {
  // Hiver, bien avant l'ouverture : le délai minimum (1h) n'entre pas en jeu, seule la fenêtre compte.
  const maintenant = Math.floor(Date.UTC(2026, 10, 20, 8, 0, 0) / 1000); // 09:00 Paris (UTC+1)
  const jours = creneauxDisponibles('pickup', maintenant);
  assert.equal(jours.length, JOURS_MAX);
  assert.equal(jours[0].date, '2026-11-20');
  assert.equal(jours[0].slots[0].time, '18h30'); // premier multiple de 30 min >= 18h20
  assert.equal(jours[0].slots[0].iso, '2026-11-20T17:30:00Z'); // 18h30 Paris (hiver) = 17h30 UTC
  const dernier = jours[0].slots[jours[0].slots.length - 1];
  assert.equal(dernier.time, '22h30');
  assert.equal(dernier.iso, '2026-11-20T21:30:00Z');
  assert.equal(jours[0].slots.length, 9); // 18h30, 19h00, ..., 22h30 : 9 créneaux de 30 min
});

test('créneaux disponibles (livraison) : fenêtre fixe 19h-22h, sans marge', () => {
  const maintenant = Math.floor(Date.UTC(2026, 10, 20, 8, 0, 0) / 1000); // 09:00 Paris
  const jours = creneauxDisponibles('delivery', maintenant);
  assert.equal(jours.length, JOURS_MAX);
  assert.equal(jours[0].slots[0].time, '19h00');
  assert.equal(jours[0].slots[0].iso, '2026-11-20T18:00:00Z'); // 19h00 Paris (hiver) = 18h00 UTC
  const dernier = jours[0].slots[jours[0].slots.length - 1];
  assert.equal(dernier.time, '22h00');
  assert.equal(jours[0].slots.length, 7); // 19h00, 19h30, ..., 22h00 : 7 créneaux de 30 min
});

test('créneaux disponibles : le délai minimum (1h) masque les créneaux trop proches', () => {
  // 21h50 Paris (hiver) un jour donné : le délai minimum pousse le premier créneau du jour à 22h50 (hors fenêtre) -> aucun créneau ce jour-là.
  const maintenant = Math.floor(Date.UTC(2026, 10, 20, 20, 50, 0) / 1000); // 21h50 Paris
  const jours = creneauxDisponibles('pickup', maintenant);
  assert.equal(jours[0].date, '2026-11-21', 'le 20/11 ne doit plus avoir de créneau (tous sous le délai minimum)');
});

test('créneauValide (retrait) : alignement, délai minimum, fenêtre 18h20-22h30, 7 jours max', () => {
  const maintenant = Math.floor(Date.UTC(2026, 10, 20, 8, 0, 0) / 1000); // 09:00 Paris
  const paris = (h, m, joursPlus = 1) => Math.floor(Date.UTC(2026, 10, 20 + joursPlus, h - 1, m, 0) / 1000); // -1h : hiver UTC+1
  assert.equal(creneauValide(paris(19, 0), 'pickup', maintenant), true, '19h00 demain : dans la fenêtre, aligné, largement au-delà du délai');
  assert.equal(creneauValide(paris(22, 30), 'pickup', maintenant), true, '22h30 inclus');
  assert.equal(creneauValide(paris(22, 31), 'pickup', maintenant), false, 'non aligné sur 30 min');
  assert.equal(creneauValide(paris(18, 0), 'pickup', maintenant), false, 'avant 18h20');
  assert.equal(creneauValide(paris(23, 0), 'pickup', maintenant), false, 'après 22h30');
  assert.equal(creneauValide(paris(20, 0, 0), 'pickup', maintenant), true, 'aujourd’hui 20h00 : largement plus d’1h après 09h00, dans la fenêtre');
  assert.equal(creneauValide(paris(9, 30, 0), 'pickup', maintenant), false, 'aujourd’hui 09h30 : hors fenêtre et moins d’1h après maintenant (09h00)');
  assert.equal(creneauValide(paris(19, 0, JOURS_MAX), 'pickup', maintenant), false, `plus de ${JOURS_MAX} jours à l'avance`);
  assert.equal(creneauValide(NaN, 'pickup', maintenant), false, 'epoch non entier');
});

test('créneauValide (livraison) : fenêtre 19h-22h, sans marge', () => {
  const maintenant = Math.floor(Date.UTC(2026, 10, 20, 8, 0, 0) / 1000); // 09:00 Paris
  const paris = (h, m, joursPlus = 1) => Math.floor(Date.UTC(2026, 10, 20 + joursPlus, h - 1, m, 0) / 1000);
  assert.equal(creneauValide(paris(19, 0), 'delivery', maintenant), true, '19h00 inclus pour la livraison');
  assert.equal(creneauValide(paris(22, 0), 'delivery', maintenant), true, '22h00 inclus');
  assert.equal(creneauValide(paris(22, 30), 'delivery', maintenant), false, '22h30 valide pour le retrait mais pas pour la livraison');
  assert.equal(creneauValide(paris(18, 30), 'delivery', maintenant), false, '18h30 valide pour le retrait mais avant l’ouverture de la livraison');
});

test('constantes exposées (type Uber Eats : créneaux 30 min, 7 jours, 1h de délai)', () => {
  assert.equal(PAS_MINUTES, 30);
  assert.equal(JOURS_MAX, 7);
  assert.equal(DELAI_MIN_MINUTES, 60);
  assert.deepEqual(FENETRE_RETRAIT, { debut: 18 * 60 + 20, fin: 22 * 60 + 30 });
  assert.deepEqual(FENETRE_LIVRAISON, { debut: 19 * 60, fin: 22 * 60 });
});

// ---------------------------------------------------------------- 2. parcours réel (serveur + DB)

import { makeEnv, runTool, startServer, stopServer, Client, openTestDb, OWNER_CODE, SUPER_CODE } from './lib/harness.mjs';

let ctx;
let proc;
let db;
let alice;
let bob; // livraison, adresse Hénin-Beaumont déjà en zone
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

  bob = new Client('bob-planif-livraison');
  const rb = await bob.post('customer_signup.php', {
    first_name: 'Bob', last_name: 'Livraison', email: 'planif-livraison@example.test', phone: '06 00 00 00 04',
    password: 'Motdepasse-planifxA1', street: '1 rue de test', city: 'Hénin-Beaumont', housing_type: 'maison'
  });
  assert.equal(rb.status, 201, rb.text);

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

const corpsLivraison = (cle, scheduled_for) => ({
  idempotency_key: cle, mode: 'delivery', payment_methods: ['card'], cash_change_for: null, hot_sauce: true,
  items: [{ name: 'Régina', variant: 'Duo', qty: 1, unit_price_cents: 1600, removed: [], extras: [], half: null, note: '' }],
  delivery_fee_cents: 0, total_cents: 1600, scheduled_for: scheduled_for ?? null
});

test('schedule_slots.php : public, par mode, créneaux propres à chaque fenêtre', async () => {
  const anon = new Client('anon-planif');
  const r = await anon.get('schedule_slots.php');
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.ok, undefined); // comme availability.php : pas de clé « ok »
  assert.equal(r.json.min_lead_minutes, 60);
  assert.equal(r.json.max_days, 7);
  assert.equal(r.json.step_minutes, 30);
  for (const mode of ['pickup', 'delivery']) {
    assert.equal(typeof r.json[mode].immediate_open, 'boolean');
    assert.ok(Array.isArray(r.json[mode].days) && r.json[mode].days.length > 0, mode);
    for (const jour of r.json[mode].days) {
      assert.match(jour.date, /^\d{4}-\d{2}-\d{2}$/);
      for (const s of jour.slots) {
        assert.match(s.time, /^\d{1,2}h\d{2}$/);
        assert.ok(Date.parse(s.iso) > 0);
      }
    }
  }
  // Les fenêtres sont bien distinctes : un créneau de retrait à 18h30 n'existe jamais côté livraison.
  const pickupTimes = new Set(r.json.pickup.days[0].slots.map((s) => s.time));
  const deliveryTimes = new Set(r.json.delivery.days[0].slots.map((s) => s.time));
  assert.ok(pickupTimes.has('18h30') && !deliveryTimes.has('18h30'));
  assert.ok(deliveryTimes.has('19h00') && deliveryTimes.has('22h00') && !deliveryTimes.has('22h30'));
});

test('order_create : commande programmée acceptée sur un créneau réellement proposé (retrait)', async () => {
  const r0 = await alice.get('schedule_slots.php');
  const slot = r0.json.pickup.days[1].slots[0]; // 2e jour : jamais affecté par le délai minimum
  const r = await alice.post('order_create.php', corps('planif-ok', slot.iso));
  assert.equal(r.status, 201, r.text);
  assert.equal(r.json.order.scheduled_for, slot.iso);
  assert.equal(r.json.order.status, 'new');
});

test('order_create : commande programmée acceptée sur un créneau réellement proposé (livraison)', async () => {
  const r0 = await bob.get('schedule_slots.php');
  const slot = r0.json.delivery.days[1].slots[0];
  const r = await bob.post('order_create.php', corpsLivraison('planif-livraison-ok', slot.iso));
  assert.equal(r.status, 201, r.text);
  assert.equal(r.json.order.scheduled_for, slot.iso);
});

test('order_create : un créneau de retrait valide n’est pas valide pour une commande livraison (fenêtres indépendantes)', async () => {
  const r0 = await bob.get('schedule_slots.php');
  const slotRetraitSeul = r0.json.pickup.days[1].slots.find((s) => !r0.json.delivery.days[1].slots.some((d) => d.iso === s.iso));
  assert.ok(slotRetraitSeul, 'il doit exister un créneau propre au retrait (ex. 18h30)');
  expectError(await bob.post('order_create.php', corpsLivraison('planif-mauvais-canal', slotRetraitSeul.iso)), 422, 'invalid_schedule');
});

test('order_create : créneau non aligné, trop proche, trop lointain ou hors fenêtre -> 422 invalid_schedule', async () => {
  const r0 = await alice.get('schedule_slots.php');
  const slot = r0.json.pickup.days[1].slots[0];
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

test('fermeture manuelle du restaurant (FORCE_CLOSED) : bloque le retrait « dès que possible », jamais les commandes programmées (SBT-003), et n’affecte pas la livraison', async () => {
  const close = await owner.post('owner_open_mode.php', { canal: 'restaurant', mode: 'closed', code: SUPER_CODE });
  assert.equal(close.status, 200, close.text);
  assert.equal(close.json.restaurant.mode, 'closed');
  assert.equal(close.json.restaurant.ouvert, false);
  try {
    // schedule_slots.php continue de proposer de vrais créneaux : seule une commande « dès que possible » est bloquée.
    const slots = await alice.get('schedule_slots.php');
    assert.equal(slots.json.pickup.immediate_open, false);
    assert.equal(slots.json.delivery.immediate_open, true, 'la livraison n’est pas affectée par la fermeture du restaurant');
    assert.ok(Array.isArray(slots.json.pickup.days) && slots.json.pickup.days.length > 0, 'les créneaux de retrait restent proposés, restaurant fermé');

    const immediat = corps('planif-ferme-immediat', null);
    expectError(await alice.post('order_create.php', immediat), 422, 'closed');

    const slot = slots.json.pickup.days[1].slots[0];
    const r = await alice.post('order_create.php', corps('planif-ferme-programmee', slot.iso));
    assert.equal(r.status, 201, r.text); // une commande planifiée reste acceptée même fermé

    // La livraison « dès que possible » fonctionne toujours, restaurant fermé.
    const slotsLivr = await bob.get('schedule_slots.php');
    const livrImmediat = corpsLivraison('planif-ferme-livraison-immediat', null);
    const rl = await bob.post('order_create.php', livrImmediat);
    assert.equal(rl.status, 201, rl.text);
  } finally {
    const reopen = await owner.post('owner_open_mode.php', { canal: 'restaurant', mode: 'auto', code: SUPER_CODE });
    assert.equal(reopen.json.restaurant.mode, 'auto');
  }
});

test('fermeture manuelle de la livraison (FORCE_CLOSED) : bloque la livraison « dès que possible », jamais le retrait', async () => {
  const close = await owner.post('owner_open_mode.php', { canal: 'delivery', mode: 'closed', code: SUPER_CODE });
  assert.equal(close.status, 200, close.text);
  assert.equal(close.json.delivery.mode, 'closed');
  assert.equal(close.json.delivery.ouvert, false);
  try {
    const slots = await bob.get('schedule_slots.php');
    assert.equal(slots.json.delivery.immediate_open, false);
    assert.equal(slots.json.pickup.immediate_open, true, 'le retrait n’est pas affecté par la fermeture de la livraison');

    expectError(await bob.post('order_create.php', corpsLivraison('planif-livr-fermee-immediat', null)), 422, 'closed');

    const r = await alice.post('order_create.php', corps('planif-livr-fermee-retrait-ok', null));
    assert.equal(r.status, 201, r.text, 'le retrait « dès que possible » fonctionne toujours, livraison fermée');
  } finally {
    const reopen = await owner.post('owner_open_mode.php', { canal: 'delivery', mode: 'auto', code: SUPER_CODE });
    assert.equal(reopen.json.delivery.mode, 'auto');
  }
});

test('owner_open_mode.php : POST réservé au code supérieur (le code commerçant seul ne suffit pas), canal invalide rejeté', async () => {
  const sansCode = await owner.post('owner_open_mode.php', { canal: 'restaurant', mode: 'closed', code: 'faux-code' });
  assert.equal(sansCode.status, 403, sansCode.text);
  assert.equal(sansCode.json.error, 'invalid_super_code');
  const mauvaisCanal = await owner.post('owner_open_mode.php', { canal: 'cuisine', mode: 'closed', code: SUPER_CODE });
  assert.equal(mauvaisCanal.status, 422, mauvaisCanal.text);
  assert.equal(mauvaisCanal.json.error, 'validation');
  const get = await owner.get('owner_open_mode.php'); // la LECTURE ne demande pas le code supérieur
  assert.equal(get.status, 200, get.text);
  assert.equal(get.json.restaurant.mode, 'auto');
  assert.equal(get.json.delivery.mode, 'auto');
});
