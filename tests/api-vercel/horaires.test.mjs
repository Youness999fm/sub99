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

test('créneau actif : Vercel par défaut, local sans contrôle, variable prioritaire', () => {
  assert.equal(creneauActif({}), null);
  assert.deepEqual(creneauActif({ VERCEL: '1' }), { debut: 1080, fin: 1367 });
  assert.equal(creneauActif({ VERCEL: '1', HORAIRES_COMMANDES: 'off' }), null);
  assert.deepEqual(creneauActif({ HORAIRES_COMMANDES: '11:00-14:00' }), { debut: 660, fin: 840 });
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
// Lancer depuis la racine :  SUBITO_TEST_PORT=18430 node --test tests/api-vercel/horaires.test.mjs
import { before, after } from 'node:test';
// +14 : ce fichier n'avait, par oubli, aucun décalage de port (collision silencieuse avec les autres
// fichiers de ce dossier qui n'en avaient pas non plus — voir fondations.test.mjs/statut-pret.test.mjs).
process.env.SUBITO_TEST_PORT = String(Number(process.env.SUBITO_TEST_PORT || 8091) + 14);
const { makeEnv, runTool, startServer, stopServer, Client } = await import('./lib/harness.mjs');

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
