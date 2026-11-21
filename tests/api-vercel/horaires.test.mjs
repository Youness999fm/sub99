// Horaires de prise de commande (serveur/horaires.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lireCreneau, creneauActif, commandesOuvertes, minutesParis, libelleHeure } from '../../serveur/horaires.js';

test('lecture du créneau', () => {
  assert.deepEqual(lireCreneau('18:00-22:47'), { debut: 1080, fin: 1367 });
  assert.deepEqual(lireCreneau('18h30-23h00'), { debut: 1110, fin: 1380 });
  assert.equal(lireCreneau('off'), null);
  assert.deepEqual(lireCreneau('n importe quoi'), { debut: 1080, fin: 1367 }, 'valeur invalide : créneau du site');
});

test('créneau actif (restaurant) : Vercel par défaut, local sans contrôle, variable prioritaire', () => {
  assert.equal(creneauActif('restaurant', {}), null);
  assert.deepEqual(creneauActif('restaurant', { VERCEL: '1' }), { debut: 1080, fin: 1367 });
  assert.equal(creneauActif('restaurant', { VERCEL: '1', HORAIRES_COMMANDES: 'off' }), null);
  assert.deepEqual(creneauActif('restaurant', { HORAIRES_COMMANDES: '11:00-14:00' }), { debut: 660, fin: 840 });
});

test('créneau actif (livraison) : son propre défaut (19h-22h) et sa propre variable', () => {
  assert.equal(creneauActif('delivery', {}), null);
  assert.deepEqual(creneauActif('delivery', { VERCEL: '1' }), { debut: 19 * 60, fin: 22 * 60 });
  assert.equal(creneauActif('delivery', { VERCEL: '1', HORAIRES_LIVRAISON: 'off' }), null);
  assert.deepEqual(creneauActif('delivery', { HORAIRES_LIVRAISON: '11:00-14:00' }), { debut: 660, fin: 840 });
  // HORAIRES_COMMANDES ne doit jamais affecter le canal livraison, et vice-versa.
  assert.deepEqual(creneauActif('delivery', { VERCEL: '1', HORAIRES_COMMANDES: 'off' }), { debut: 19 * 60, fin: 22 * 60 });
});

test('ouvert / fermé, bornes comprises', () => {
  const c = lireCreneau('18:00-22:47');
  assert.equal(commandesOuvertes(c, 17 * 60 + 59), false);
  assert.equal(commandesOuvertes(c, 18 * 60), true);
  assert.equal(commandesOuvertes(c, 22 * 60 + 46), true);
  assert.equal(commandesOuvertes(c, 22 * 60 + 47), false);
  assert.equal(commandesOuvertes(null, 3 * 60), true);
  const nuit = lireCreneau('22:00-02:00');
  assert.equal(commandesOuvertes(nuit, 23 * 60), true);
  assert.equal(commandesOuvertes(nuit, 60), true);
  assert.equal(commandesOuvertes(nuit, 12 * 60), false);
});

test('heure de Paris (hiver UTC+1, été UTC+2)', () => {
  assert.equal(minutesParis(Date.UTC(2026, 10, 19, 17, 0) / 1000), 18 * 60); // 17:00 UTC = 18:00 Paris en novembre
  assert.equal(minutesParis(Date.UTC(2026, 6, 1, 16, 0) / 1000), 18 * 60); // 16:00 UTC = 18:00 Paris en juillet
  assert.equal(libelleHeure(1367), '22h47');
});

// Parcours réel : order_create refuse hors créneau (422 closed), accepte avec « off ».
import { before, after } from 'node:test';
import { makeEnv, runTool, startServer, stopServer, Client } from './lib/harness.mjs';

let ctx;
let proc;
let alice;
before(async () => {
  ctx = makeEnv();
  assert.equal((await runTool(ctx, 'install.php')).code, 0);
  proc = await startServer(ctx);
  alice = new Client('alice-horaires');
  const r = await alice.post('customer_signup.php', {
    first_name: 'Test', last_name: 'Horaires', email: 'horaires@example.test', phone: '06 00 00 00 02',
    password: 'Motdepasse-horairesxA1', street: null, city: null
  });
  assert.equal(r.status, 201, r.text);
});
after(() => { delete process.env.HORAIRES_COMMANDES; return stopServer(proc); });

const corps = (cle) => ({
  idempotency_key: cle, mode: 'pickup', payment_methods: [], cash_change_for: null,
  items: [{ name: 'Régina', variant: 'Duo', qty: 1, unit_price_cents: 1600, removed: [], extras: [], half: null, note: '' }],
  delivery_fee_cents: 0, total_cents: 1600
});

test('order_create : fermé hors créneau, ouvert avec « off »', async () => {
  // Créneau d'une minute, douze heures après maintenant : forcément fermé.
  const m = (minutesParis() + 720) % 1440;
  const hhmm = (x) => String(Math.floor(x / 60)).padStart(2, '0') + ':' + String(x % 60).padStart(2, '0');
  process.env.HORAIRES_COMMANDES = hhmm(m) + '-' + hhmm((m + 1) % 1440);
  const ferme = await alice.post('order_create.php', corps('horaires-1'));
  assert.equal(ferme.status, 422, ferme.text);
  assert.equal(ferme.json.error, 'closed');
  assert.equal(ferme.json.opens_at, String(Math.floor(m / 60)) + 'h' + String(m % 60).padStart(2, '0'));
  assert.match(ferme.json.closes_at, /^[0-9]{1,2}h[0-9]{2}$/);

  process.env.HORAIRES_COMMANDES = 'off';
  const ouvert = await alice.post('order_create.php', corps('horaires-2'));
  assert.equal(ouvert.status, 201, ouvert.text);
});
