// Horaires de prise de commande (serveur/horaires.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lireCreneau, creneauActif, commandesOuvertes, minutesParis, libelleHeure } from '../../serveur/horaires.js';

// 17h55 = 1075 minutes depuis minuit, 22h47 = 1367 (ouverture avancée le 25/11/2026).
const RETRAIT = { debut: 17 * 60 + 55, fin: 22 * 60 + 47 };

test('lecture du créneau', () => {
  assert.deepEqual(lireCreneau('17:55-22:47'), RETRAIT);
  assert.deepEqual(lireCreneau('18h30-23h00'), { debut: 1110, fin: 1380 });
  assert.equal(lireCreneau('off'), null);
  assert.deepEqual(lireCreneau('n importe quoi'), RETRAIT, 'valeur invalide : créneau du site');
});

test('créneau actif : Vercel par défaut, local sans contrôle, variable prioritaire', () => {
  assert.equal(creneauActif('pickup', {}), null);
  assert.deepEqual(creneauActif('pickup', { VERCEL: '1' }), RETRAIT);
  assert.equal(creneauActif('pickup', { VERCEL: '1', HORAIRES_COMMANDES: 'off' }), null);
  assert.deepEqual(creneauActif('pickup', { HORAIRES_COMMANDES: '11:00-14:00' }), { debut: 660, fin: 840 });
});

// Livraison (décision du 24/11/2026) : horaire indépendant du retrait, défaut 19h00-22h00, même logique
// Vercel/local/variable que pickup mais sa propre variable d'environnement.
test('créneau actif livraison : indépendant du retrait, défaut 19h-22h, variable dédiée', () => {
  assert.equal(creneauActif('delivery', {}), null, 'local sans contrôle, comme pickup');
  assert.deepEqual(creneauActif('delivery', { VERCEL: '1' }), { debut: 19 * 60, fin: 22 * 60 });
  assert.equal(creneauActif('delivery', { VERCEL: '1', HORAIRES_LIVRAISON_COMMANDES: 'off' }), null);
  assert.deepEqual(creneauActif('delivery', { HORAIRES_LIVRAISON_COMMANDES: '20:00-21:00' }), { debut: 1200, fin: 1260 });
  // La variable du retrait ne doit jamais influencer la livraison, et inversement.
  assert.deepEqual(creneauActif('delivery', { VERCEL: '1', HORAIRES_COMMANDES: '10:00-11:00' }), { debut: 19 * 60, fin: 22 * 60 });
  assert.deepEqual(creneauActif('pickup', { VERCEL: '1', HORAIRES_LIVRAISON_COMMANDES: '10:00-11:00' }), RETRAIT);
});

test('ouvert / fermé, bornes comprises', () => {
  const c = lireCreneau('17:55-22:47');
  assert.equal(commandesOuvertes(c, 17 * 60 + 54), false, 'une minute avant l’ouverture');
  assert.equal(commandesOuvertes(c, 17 * 60 + 55), true, 'à 17h55 pile, le retrait ouvre');
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
const { makeEnv, runTool, startServer, stopServer, Client, openTestDb, OWNER_CODE, SUPER_CODE } = await import('./lib/harness.mjs');

let ctx;
let proc;
let alice;
let bob;
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
  // Client livré (zone Hénin-Beaumont) : pour les tests de livraison ci-dessous, horaire indépendant du retrait.
  bob = new Client('bob-horaires-livraison');
  const rb = await bob.post('customer_signup.php', {
    first_name: 'Test', last_name: 'Livraison', email: 'horaires-livraison@example.test', phone: '06 00 00 00 03',
    password: 'Motdepasse-livraisonxA1', street: '1 rue des Tests', city: 'Hénin-Beaumont', housing_type: 'maison'
  });
  assert.equal(rb.status, 201, rb.text);
});
after(() => { delete process.env.HORAIRES_COMMANDES; delete process.env.HORAIRES_LIVRAISON_COMMANDES; return stopServer(proc); });

const corps = (cle) => ({
  idempotency_key: cle, mode: 'pickup', payment_methods: [], cash_change_for: null,
  items: [{ name: 'Régina', variant: 'Duo', qty: 1, unit_price_cents: 1600, removed: [], extras: [], half: null, note: '' }],
  delivery_fee_cents: 0, total_cents: 1600
});
const corpsLivraison = (cle) => ({
  idempotency_key: cle, mode: 'delivery', payment_methods: ['cash'], cash_change_for: 0, hot_sauce: false,
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

// Livraison (décision du 24/11/2026) : son propre horaire (HORAIRES_LIVRAISON_COMMANDES), totalement
// indépendant de celui du retrait — fermer l'un n'affecte jamais l'autre, dans les deux sens.
test('order_create : la livraison a son propre horaire, indépendant du retrait', async () => {
  const m = (minutesParis() + 720) % 1440;
  const hhmm = (x) => String(Math.floor(x / 60)).padStart(2, '0') + ':' + String(x % 60).padStart(2, '0');
  const creneauFerme = hhmm(m) + '-' + hhmm((m + 1) % 1440);

  // Livraison fermée (son propre horaire), retrait grand ouvert ("off") : le retrait ne doit pas en pâtir.
  process.env.HORAIRES_LIVRAISON_COMMANDES = creneauFerme;
  process.env.HORAIRES_COMMANDES = 'off';
  const livraisonFermee = await bob.post('order_create.php', corpsLivraison('horaires-liv-1'));
  assert.equal(livraisonFermee.status, 422, livraisonFermee.text);
  assert.equal(livraisonFermee.json.error, 'closed');
  const retraitToujoursOuvert = await bob.post('order_create.php', corps('horaires-liv-2'));
  assert.equal(retraitToujoursOuvert.status, 201, retraitToujoursOuvert.text, 'le retrait doit rester ouvert malgré la livraison fermée');

  // Et inversement : retrait fermé (son propre horaire), livraison grand ouverte ("off").
  process.env.HORAIRES_COMMANDES = creneauFerme;
  process.env.HORAIRES_LIVRAISON_COMMANDES = 'off';
  const retraitFerme = await bob.post('order_create.php', corps('horaires-liv-3'));
  assert.equal(retraitFerme.status, 422, retraitFerme.text);
  assert.equal(retraitFerme.json.error, 'closed');
  const livraisonToujoursOuverte = await bob.post('order_create.php', corpsLivraison('horaires-liv-4'));
  assert.equal(livraisonToujoursOuverte.status, 201, livraisonToujoursOuverte.text, 'la livraison doit rester ouverte malgré le retrait fermé');
});

// BUG RÉEL (signalé par le commerçant le 25/11/2026) : une fermeture/ouverture forcée dont la ligne
// d'expiration manque en base restait active POUR TOUJOURS — l'horaire automatique ne reprenait jamais
// la main et seul le code supérieur pouvait rouvrir. Les employés ne l'ont pas : le restaurant restait
// fermé aux commandes en ligne tant que le patron n'intervenait pas. Voir lireBascule (serveur/horaires.js).
test('bascule forcée sans expiration : l’horaire automatique reprend la main tout seul', async () => {
  delete process.env.HORAIRES_COMMANDES;
  process.env.HORAIRES_COMMANDES = '00:00-23:59'; // horaire actif : il existe donc une prochaine transition
  const patron = new Client('patron-bascule');
  assert.equal((await patron.post('owner_login.php', { code: OWNER_CODE, remember: false })).status, 200);

  // Fermeture forcée en règle, puis on simule l'état cassé : l'expiration disparaît de la base.
  const pose = await patron.post('owner_open_mode.php', { service: 'pickup', mode: 'closed', code: SUPER_CODE });
  assert.equal(pose.status, 200, pose.text);
  assert.equal(pose.json.mode, 'closed');
  assert.notEqual(pose.json.expires_at, null, 'une bascule posée normalement a toujours une expiration');

  const db = openTestDb(ctx);
  try {
    db.prepare("DELETE FROM settings WHERE skey = 'open_mode_expires_at'").run();
    assert.equal(db.prepare("SELECT svalue FROM settings WHERE skey = 'open_mode_expires_at'").get(), undefined);

    // Relecture : l'expiration manquante doit être rattrapée (et réécrite en base), pas ignorée.
    const relu = await patron.get('owner_open_mode.php?service=pickup');
    assert.equal(relu.status, 200, relu.text);
    assert.notEqual(relu.json.expires_at, null, 'sans ce rattrapage, la fermeture forcée ne s’arrêterait jamais');
    assert.equal(relu.json.expires_at, relu.json.prochaine_transition, 'elle doit expirer à la prochaine transition automatique');

    const ligne = db.prepare("SELECT svalue FROM settings WHERE skey = 'open_mode_expires_at'").get();
    assert.ok(ligne && /^\d+$/.test(ligne.svalue), 'la réparation doit être écrite en base, pas refaite à chaque lecture');
  } finally {
    db.close();
    await patron.post('owner_open_mode.php', { service: 'pickup', mode: 'auto', code: SUPER_CODE });
    delete process.env.HORAIRES_COMMANDES;
  }
});
