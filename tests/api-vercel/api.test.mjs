// Suite de tests de l'API JavaScript (Vercel + Postgres) : mêmes scénarios que tests/api/api.test.mjs (version PHP).
// Lancer depuis la racine du dépôt :  SUBITO_TEST_PORT=18430 node --test tests/api-vercel/api.test.mjs
// Base Postgres en mémoire (PGlite) ; le commerçant se connecte avec le code patron (OWNER_CODE du harnais).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

import {
  ROOT, BASE, ORIGIN, OWNER_CODE, Client, openTestDb, makeEnv, runTool, startServer, stopServer, responses, secretScanText,
} from './lib/harness.mjs';
import { DELIVERY_ZONES } from '../../serveur/util.js';

// Mots de passe de test générés à l'exécution (jamais écrits en clair dans le dépôt).
const randomPassword = () => Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(18))).toString('base64url') + 'Aa1!';
const CUSTOMER_PASSWORD = randomPassword();
const DELAY_MS = 60 * 1000;

let ctx;
let server;
let db;

const anon = new Client('anon');
const ownerA = new Client('ownerA');
const custA = new Client('custA');
const custB = new Client('custB');
const custC = new Client('custC');
const custD = new Client('custD');
const custE = new Client('custE');
const ids = {};

const parisDay = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const pizza = (name, variant, cents, qty = 1) => ({ name, variant, qty, unit_price_cents: cents, removed: [], extras: [], half: null, note: '' });
const product = (name, cents, qty = 1) => ({ name, variant: '', qty, unit_price_cents: cents, removed: [], extras: [], half: null, note: '' });
let keySeq = 0;
const newKey = () => `test-key-${Date.now()}-${++keySeq}`;

function expectError(r, status, code) {
  assert.equal(r.status, status, `${r.method} ${r.route} : ${r.text}`);
  assert.equal(r.json?.ok, false);
  assert.equal(r.json?.error, code, r.text);
  assert.equal(typeof r.json?.message, 'string');
}

async function ownerLogin(client, code = OWNER_CODE, remember = false) {
  return client.post('owner_login.php', { code, remember });
}

before(async () => {
  ctx = makeEnv();
  const inst = await runTool(ctx, 'install.php');
  assert.equal(inst.code, 0, inst.stderr + inst.stdout);
  db = openTestDb(ctx);
  server = await startServer(ctx);
});

after(() => {
  stopServer(server);
  try { db?.close(); } catch { /* déjà fermée */ }
});

// ---------------------------------------------------------------- outils CLI
test('outils CLI : installation idempotente, plus de table owners (code patron)', async () => {
  const again = await runTool(ctx, 'install.php');
  assert.equal(again.code, 0, again.stderr);
  assert.equal(db.prepare("SELECT svalue FROM settings WHERE skey = 'default_delay_minutes'").get().svalue, '30');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM pg_tables WHERE schemaname = 'public' AND tablename = 'owners'").get().n, 0);
});

test('outils CLI : jamais exposés par HTTP', async () => {
  // Adaptation : en PHP un script de api/tools/ répondait 403 ; ici ces outils ne sont pas des routes (404 JSON).
  for (const tool of ['install.php', 'create_owner.php', 'reset_customer.php']) {
    const r = await fetch(BASE + 'tools/' + tool);
    const text = await r.text();
    assert.equal(r.status, 404);
    assert.doesNotMatch(text, /Tables|Propriétaire créé|remplacé/);
  }
});

// ---------------------------------------------------------------- 1. propriétaire
test('1. accès propriétaire et sessions', async (t) => {
  await t.test('401 sans session', async () => {
    expectError(await anon.get('owner_me.php'), 401, 'unauthorized');
    expectError(await anon.get('owner_orders.php'), 401, 'unauthorized');
  });

  await t.test('mauvais code : 401 générique', async () => {
    const r = await ownerLogin(new Client('x'), 'mauvais-code-patron');
    expectError(r, 401, 'invalid_credentials');
    assert.equal(r.json.message, 'Code incorrect.');
    assert.equal(r.setCookies.length, 0);
  });

  await t.test('code vide, absent ou non textuel : 401, sans cookie', async () => {
    // Le test précédent a compté un échec : le compteur repart de zéro (5 refus de suite verrouilleraient l'adresse).
    db.prepare("DELETE FROM throttle WHERE bucket = 'owner_login:ip:127.0.0.1'").run();
    for (const body of [{ code: '' }, {}, { code: 12345 }, { code: ['x'] }, { email: 'patron@example.test', password: 'x' }]) {
      const r = await new Client('y').post('owner_login.php', body);
      expectError(r, 401, 'invalid_credentials');
      assert.equal(r.setCookies.length, 0);
    }
    // Rien n'a été écrit pour ces refus : aucune session propriétaire.
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sessions WHERE user_type = 'owner'").get().n, 0);
    // Ces refus comptent dans la limitation : remise à zéro pour ne pas gêner les tests suivants.
    db.prepare("DELETE FROM throttle WHERE bucket = 'owner_login:ip:127.0.0.1'").run();
  });

  await t.test('connexion, owner_me, cookie', async () => {
    const r = await ownerLogin(ownerA, OWNER_CODE, true);
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.json.owner, { remember: true });
    const sc = r.setCookies.find((c) => c.startsWith('subito_owner='));
    assert.ok(sc, 'cookie subito_owner');
    assert.match(sc, /HttpOnly/i);
    assert.match(sc, /SameSite=Strict/i);
    assert.match(sc, /path=\/api\//i);
    assert.match(sc, /Max-Age=2592000/i);
    assert.doesNotMatch(sc, /Secure/i);
    const me = await ownerA.get('owner_me.php');
    assert.equal(me.status, 200);
    // Plus d'e-mail côté commerçant (code patron) : seulement remember et session_id.
    assert.deepEqual(Object.keys(me.json.owner).sort(), ['remember', 'session_id']);
    assert.equal(me.json.owner.remember, true);
    assert.equal(typeof me.json.owner.session_id, 'number');
    ids.ownerASession = me.json.owner.session_id;
    // Seul le SHA-256 est stocké.
    const token = ownerA.cookies.get('subito_owner');
    const row = db.prepare('SELECT token_hash FROM sessions WHERE id = ?').get(ids.ownerASession);
    assert.equal(row.token_hash, createHash('sha256').update(token).digest('hex'));
  });

  await t.test('cookie de session sans Max-Age quand remember = false', async () => {
    const b = new Client('b');
    const r = await ownerLogin(b, OWNER_CODE, false);
    assert.equal(r.status, 200);
    const sc = r.setCookies.find((c) => c.startsWith('subito_owner='));
    assert.doesNotMatch(sc, /Max-Age|Expires/i);
    const rev = await b.post('owner_logout.php', {});
    assert.equal(rev.status, 200);
  });

  await t.test('liste des sessions et révocation des autres', async () => {
    const b = new Client('ownerB');
    const c = new Client('ownerC');
    assert.equal((await ownerLogin(b)).status, 200);
    assert.equal((await ownerLogin(c, OWNER_CODE, true)).status, 200);
    const list = await ownerA.get('owner_sessions.php');
    assert.equal(list.status, 200);
    assert.equal(list.json.sessions.length, 3);
    assert.equal(list.json.sessions.filter((s) => s.current).length, 1);
    assert.equal(list.json.sessions.find((s) => s.current).id, ids.ownerASession);
    assert.equal(list.json.sessions[0].device, 'Chrome · Android');
    for (const s of list.json.sessions) {
      assert.match(s.expires_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    }
    const rev = await ownerA.post('owner_sessions_revoke.php', { scope: 'others' });
    assert.equal(rev.status, 200);
    assert.equal(rev.json.revoked, 2);
    expectError(await b.get('owner_me.php'), 401, 'unauthorized');
    expectError(await c.get('owner_me.php'), 401, 'unauthorized');
    assert.equal((await ownerA.get('owner_me.php')).status, 200);
    assert.equal((await ownerA.get('owner_sessions.php')).json.sessions.length, 1);
    expectError(await ownerA.post('owner_sessions_revoke.php', { scope: 'tout' }), 422, 'validation');
  });

  await t.test('owner_logout', async () => {
    const d = new Client('ownerD');
    assert.equal((await ownerLogin(d)).status, 200);
    const r = await d.post('owner_logout.php', {});
    assert.equal(r.status, 200);
    assert.deepEqual(r.json, { ok: true });
    assert.ok(r.setCookies.some((c) => /^subito_owner=;/.test(c) || /^subito_owner=deleted/.test(c)), 'cookie effacé');
    assert.equal(d.cookies.has('subito_owner'), false);
    expectError(await d.get('owner_me.php'), 401, 'unauthorized');
    expectError(await d.post('owner_logout.php', {}), 401, 'unauthorized');
  });
});

// ---------------------------------------------------------------- 2. clients
const signupBody = (over = {}) => ({
  first_name: 'Léo', last_name: 'Démo', email: 'leo@example.test', phone: '06 00 00 00 01',
  password: CUSTOMER_PASSWORD, street: '1 rue de l\'exemple', city: 'Rouvroy', ...over,
});

test('2. comptes clients', async (t) => {
  await t.test('inscription refusée : téléphone, e-mail, mot de passe, ville', async () => {
    const cases = [
      [{ phone: '12ab' }, 'phone'],
      [{ phone: '0600' }, 'phone'],
      [{ email: 'pas-un-email' }, 'email'],
      [{ password: '7caract' }, 'password'],
      [{ city: 'Lille' }, 'city'],
      [{ first_name: '' }, 'first_name'],
    ];
    for (const [over, field] of cases) {
      const r = await new Client('v').post('customer_signup.php', signupBody(over));
      expectError(r, 422, 'validation');
      assert.ok(r.json.fields[field], `champ ${field} : ${r.text}`);
      assert.equal(r.setCookies.length, 0);
    }
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM customers').get().n, 0);
  });

  await t.test('inscription, email_taken', async () => {
    const r = await custA.post('customer_signup.php', signupBody({ email: 'Leo@Example.test' }));
    assert.equal(r.status, 201, r.text);
    assert.deepEqual(Object.keys(r.json.customer).sort(), ['city', 'email', 'first_name', 'id', 'last_name', 'phone', 'street']);
    assert.equal(r.json.customer.email, 'leo@example.test');
    ids.custA = r.json.customer.id;
    const sc = r.setCookies.find((c) => c.startsWith('subito_customer='));
    assert.match(sc, /SameSite=Lax/i);
    assert.match(sc, /HttpOnly/i);
    assert.match(sc, /path=\/api\//i);
    const dup = await new Client('dup').post('customer_signup.php', signupBody({ email: 'LEO@example.test' }));
    expectError(dup, 409, 'email_taken');
  });

  await t.test('customer_me invité = null, connecté = fiche', async () => {
    const g = await anon.get('customer_me.php');
    assert.equal(g.status, 200);
    assert.deepEqual(g.json, { ok: true, customer: null });
    const m = await custA.get('customer_me.php');
    assert.equal(m.json.customer.id, ids.custA);
  });

  await t.test('déconnexion puis connexion', async () => {
    const out = await custA.post('customer_logout.php', {});
    assert.equal(out.status, 200);
    assert.equal((await custA.get('customer_me.php')).json.customer, null);
    expectError(await custA.post('customer_login.php', { email: 'leo@example.test', password: 'faux-mot-de-passe' }), 401, 'invalid_credentials');
    const ok = await custA.post('customer_login.php', { email: 'LEO@example.test', password: CUSTOMER_PASSWORD });
    assert.equal(ok.status, 200, ok.text);
    assert.equal(ok.json.customer.id, ids.custA);
    assert.equal((await custA.get('customer_me.php')).json.customer.id, ids.custA);
    // Déconnexion sans session : toujours 200.
    assert.equal((await new Client('z').post('customer_logout.php', {})).status, 200);
  });

  await t.test('deux connexions successives : la première session est révoquée', async () => {
    const first = new Client('copie');
    for (const [k, v] of custA.cookies) first.cookies.set(k, v);
    assert.equal((await first.get('customer_orders.php')).status, 200);
    const again = await custA.post('customer_login.php', { email: 'leo@example.test', password: CUSTOMER_PASSWORD });
    assert.equal(again.status, 200, again.text);
    expectError(await first.get('customer_orders.php'), 401, 'unauthorized');
    assert.equal((await custA.get('customer_orders.php')).status, 200);
  });

  await t.test('mise à jour d\'adresse', async () => {
    const bad = await custA.post('customer_update_address.php', { street: '2 rue', city: 'Lille' });
    expectError(bad, 422, 'validation');
    assert.ok(bad.json.fields.city);
    const r = await custA.post('customer_update_address.php', { street: '3 place de la mairie', city: 'Hénin-Beaumont' });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.customer.city, 'Hénin-Beaumont');
    assert.equal(r.json.customer.street, '3 place de la mairie');
    expectError(await anon.post('customer_update_address.php', { street: '', city: '' }), 401, 'unauthorized');
  });

  await t.test('autres comptes', async () => {
    const b = await custB.post('customer_signup.php', signupBody({ email: 'bea@example.test', first_name: 'Béa', city: 'Dourges' }));
    assert.equal(b.status, 201, b.text);
    ids.custB = b.json.customer.id;
    const c = await custC.post('customer_signup.php', signupBody({ email: 'carl@example.test', first_name: 'Carl', last_name: 'Calcul' }));
    assert.equal(c.status, 201, c.text);
    ids.custC = c.json.customer.id;
    const d = await custD.post('customer_signup.php', signupBody({ email: 'dina@example.test', first_name: 'Dina', street: '', city: '' }));
    assert.equal(d.status, 201, d.text);
    assert.equal(d.json.customer.city, null);
    ids.custD = d.json.customer.id;
  });

  await t.test('un client reçoit 403 sur toutes les routes owner_*', async () => {
    const gets = ['owner_me.php', 'owner_sessions.php', 'owner_orders.php', 'owner_availability.php', 'owner_settings.php'];
    for (const g of gets) expectError(await custA.get(g), 403, 'forbidden');
    const posts = [
      ['owner_customers.php', { q: '' }],
      ['owner_logout.php', {}],
      ['owner_sessions_revoke.php', { scope: 'all' }],
      ['owner_order_decide.php', { id: 1, action: 'refuse' }],
      ['owner_availability.php', { kind: 'pizza', name: 'Reine', status: 'out_manual' }],
      ['owner_settings.php', { default_delay_minutes: 20 }],
    ];
    for (const [route, body] of posts) expectError(await custA.post(route, body), 403, 'forbidden');
    // Le propriétaire est toujours connecté et rien n'a changé.
    assert.equal((await ownerA.get('owner_me.php')).status, 200);
    assert.equal((await ownerA.get('owner_settings.php')).json.default_delay_minutes, 30);
  });
});

// ---------------------------------------------------------------- 3. commandes
const orderBody = (over = {}) => ({
  idempotency_key: newKey(), mode: 'pickup', payment_methods: [], cash_change_for: null,
  items: [pizza('Régina', 'Duo', 1600)], delivery_fee_cents: 0, total_cents: 1600, ...over,
});
const countOrders = () => db.prepare('SELECT COUNT(*) AS n FROM orders').get().n;

test('3. création de commande', async (t) => {
  await t.test('sans session : 401', async () => {
    expectError(await anon.post('order_create.php', orderBody()), 401, 'unauthorized');
    expectError(await ownerA.post('order_create.php', orderBody()), 403, 'forbidden');
  });

  await t.test('promo à emporter (la moins chère offerte)', async () => {
    const body = orderBody({ items: [pizza('Régina', 'Duo', 1600), pizza('4 Saisons', 'Solo', 1100)], total_cents: 1600 });
    const r = await custC.post('order_create.php', body);
    assert.equal(r.status, 201, r.text);
    assert.equal(r.json.replayed, false);
    const o = r.json.order;
    assert.equal(o.products_cents, 2700);
    assert.equal(o.promo_cents, 1100);
    assert.equal(o.delivery_fee_cents, 0);
    assert.equal(o.total_cents, 1600);
    assert.equal(o.status, 'new');
    assert.equal(o.mode, 'pickup');
    assert.equal(o.delivery_address, null);
    assert.deepEqual(o.payment_methods, []);
    assert.equal(o.cash_change_for, null);
    assert.equal(o.ready_at, null);
    assert.equal(o.service_day, parisDay());
    assert.equal(o.customer_name, 'Carl Calcul');
    assert.equal(o.items.length, 2);
    assert.equal(o.items[0].line_total_cents, 1600);
    assert.equal('customer_phone' in o, false);
    ids.orderC1 = o.id;
  });

  await t.test('promo livraison (moitié prix, arrondi par paire)', async () => {
    // Prix du catalogue (tous multiples de 50 centimes) : l'arrondi d'un prix impair n'est plus
    // atteignable par HTTP ; il est vérifié directement sur compute_order_totals (catalogue.test.mjs).
    const items = [pizza('Carnivora', 'Quatro', 2300), pizza('Régina', 'Duo', 1600), pizza('Kebab', 'Duo', 1600), pizza('Neptune', 'Solo', 1100)];
    // Paires (2300, 1600) → 800 ; (1600, 1100) → 550. Total 6600 − 1350 = 5250.
    const r = await custC.post('order_create.php', orderBody({ mode: 'delivery', payment_methods: ['card'], items, total_cents: 5250 }));
    assert.equal(r.status, 201, r.text);
    assert.equal(r.json.order.promo_cents, 1350);
    assert.equal(r.json.order.total_cents, 5250);
    assert.equal(r.json.order.delivery_fee_cents, 0);
    assert.deepEqual(r.json.order.delivery_address, { street: '1 rue de l\'exemple', city: 'Rouvroy' });
    assert.deepEqual(r.json.order.payment_methods, ['card']);
  });

  await t.test('frais de livraison seulement sans pizza', async () => {
    const body = orderBody({ mode: 'delivery', payment_methods: ['cash', 'card'], cash_change_for: 50, items: [product('Dessert Calzone Nutella', 650, 4)], delivery_fee_cents: 800, total_cents: 3400 });
    const r = await custC.post('order_create.php', body);
    assert.equal(r.status, 201, r.text);
    assert.equal(r.json.order.delivery_fee_cents, 800);
    assert.equal(r.json.order.total_cents, 3400);
    assert.equal(r.json.order.cash_change_for, 50);
    // Avec une pizza : pas de frais, un envoi qui en compte est refusé.
    const withPizza = await custC.post('order_create.php', orderBody({ mode: 'delivery', payment_methods: ['card'], items: [product('Dessert Calzone Nutella', 650, 2), pizza('Régina', 'XXL', 3300)], delivery_fee_cents: 800, total_cents: 5400 }));
    expectError(withPizza, 409, 'price_mismatch');
    assert.equal(withPizza.json.server_delivery_fee_cents, 0);
    assert.equal(withPizza.json.server_total_cents, 4600);
  });

  await t.test('minimum non atteint', async () => {
    const r = await custC.post('order_create.php', orderBody({ mode: 'delivery', payment_methods: ['card'], total_cents: 1600 }));
    expectError(r, 422, 'minimum_not_reached');
    assert.equal(r.json.minimum_cents, 2500);
    assert.equal(r.json.products_after_promo_cents, 1600);
  });

  await t.test('price_mismatch sans rien enregistrer', async () => {
    const before = countOrders();
    const r = await custC.post('order_create.php', orderBody({ total_cents: 999 }));
    expectError(r, 409, 'price_mismatch');
    assert.deepEqual(
      [r.json.server_products_cents, r.json.server_promo_cents, r.json.server_delivery_fee_cents, r.json.server_total_cents],
      [1600, 0, 0, 1600],
    );
    assert.equal(countOrders(), before);
  });

  await t.test('espèces sans billet : validation', async () => {
    const r = await custC.post('order_create.php', orderBody({ mode: 'delivery', payment_methods: ['cash'], cash_change_for: null, items: [pizza('Régina', 'XXL', 3300)], total_cents: 3300 }));
    expectError(r, 422, 'validation');
    assert.ok(r.json.fields.cash_change_for);
    const none = await custC.post('order_create.php', orderBody({ mode: 'delivery', payment_methods: [], items: [pizza('Régina', 'XXL', 3300)], total_cents: 3300 }));
    expectError(none, 422, 'validation');
    assert.ok(none.json.fields.payment_methods);
  });

  await t.test('panier vide, lignes invalides', async () => {
    expectError(await custA.post('order_create.php', orderBody({ items: [], total_cents: 0 })), 422, 'empty_cart');
    const bad = await custA.post('order_create.php', orderBody({ items: [{ ...pizza('X', 'Géante', 1200) }] }));
    expectError(bad, 422, 'validation');
    assert.ok(bad.json.fields['items[0].variant']);
    expectError(await custA.post('order_create.php', orderBody({ idempotency_key: 'court' })), 422, 'validation');
  });

  await t.test('idempotence : rejeu et conflit', async () => {
    const body = orderBody();
    const first = await custA.post('order_create.php', body);
    assert.equal(first.status, 201, first.text);
    ids.orderA1 = first.json.order.id;
    const again = await custA.post('order_create.php', body);
    assert.equal(again.status, 200, again.text);
    assert.equal(again.json.replayed, true);
    assert.equal(again.json.order.id, ids.orderA1);
    const n = db.prepare('SELECT COUNT(*) AS n FROM orders WHERE customer_id = ? AND idempotency_key = ?').get(ids.custA, body.idempotency_key).n;
    assert.equal(n, 1);
    const conflict = await custA.post('order_create.php', { ...body, items: [pizza('4 Saisons', 'Duo', 1600)], total_cents: 1600 });
    expectError(conflict, 409, 'idempotency_conflict');
  });

  await t.test('deux envois simultanés, même clé : une seule commande', async () => {
    const body = orderBody({ items: [pizza('Kebab', 'Duo', 1600)], total_cents: 1600 });
    const [r1, r2] = await Promise.all([custA.post('order_create.php', body), custA.post('order_create.php', body)]);
    assert.deepEqual([r1.status, r2.status].sort(), [200, 201], r1.text + r2.text);
    assert.equal(r1.json.order.id, r2.json.order.id);
    const n = db.prepare('SELECT COUNT(*) AS n FROM orders WHERE idempotency_key = ?').get(body.idempotency_key).n;
    assert.equal(n, 1);
  });

  await t.test('pizza indisponible : 422 unavailable_items', async () => {
    const set = await ownerA.post('owner_availability.php', { kind: 'pizza', name: 'Calzone (soufflée)', status: 'out_today' });
    assert.equal(set.status, 200, set.text);
    const before = countOrders();
    const r = await custA.post('order_create.php', orderBody({ items: [pizza('CALZONE (Soufflee) — Thon', 'Duo', 1600)], total_cents: 1600 }));
    expectError(r, 422, 'unavailable_items');
    assert.deepEqual(r.json.unavailable, ['CALZONE (Soufflee)']);
    assert.equal(countOrders(), before);
    // « Calzone » seul vaut pour « Calzone (soufflée) ».
    const r2 = await custA.post('order_create.php', orderBody({ items: [pizza('Calzone — Jambon', 'Solo', 1100)], total_cents: 1100 }));
    expectError(r2, 422, 'unavailable_items');
    assert.equal((await ownerA.post('owner_availability.php', { kind: 'pizza', name: 'Calzone (soufflée)', status: 'available' })).status, 200);
  });

  await t.test('rupture : normalisation des noms, sans correspondance approximative', async () => {
    const su = await custE.post('customer_signup.php', signupBody({ email: 'emma@example.test', first_name: 'Emma' }));
    assert.equal(su.status, 201, su.text);
    ids.custE = su.json.customer.id;
    assert.equal((await ownerA.post('owner_availability.php', { kind: 'pizza', name: 'Calzone (soufflée)', status: 'out_today' })).status, 200);
    const before = countOrders();
    // La garniture est obligatoire au catalogue : chaque variante porte donc une garniture.
    for (const name of ['Calzone—Thon', 'Calzone – Thon', 'Calzone - Thon', 'Calzone. — Thon', 'Calzone​ — Thon', 'Calzone​ — Jambon', 'calzone (SOUFFLÉE) ! — thon']) {
      const r = await custE.post('order_create.php', orderBody({ items: [pizza(name, 'Duo', 1600)], total_cents: 1600 }));
      expectError(r, 422, 'unavailable_items');
    }
    assert.equal(countOrders(), before);
    // Aucune correspondance approximative : « La Calzone » n'est pas la Calzone (ni en rupture, ni à la carte).
    const la = await custE.post('order_create.php', orderBody({ items: [pizza('La Calzone — Thon', 'Duo', 1600)], total_cents: 1600 }));
    expectError(la, 422, 'unknown_item');
    assert.equal(countOrders(), before);
  });

  await t.test('« Calzone » available supprime « Calzone (soufflée) »', async () => {
    const r = await ownerA.post('owner_availability.php', { kind: 'pizza', name: 'Calzone', status: 'available' });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.out.some((e) => e.name === 'Calzone (soufflée)'), false);
    const ok = await custE.post('order_create.php', orderBody({ items: [pizza('Calzone (soufflée) — Thon', 'Duo', 1600)], total_cents: 1600 }));
    assert.equal(ok.status, 201, ok.text);
  });

  await t.test('adresse hors zone ou absente : 422 address_required', async () => {
    const body = orderBody({ mode: 'delivery', payment_methods: ['card'], items: [pizza('Régina', 'XXL', 3300)], total_cents: 3300 });
    expectError(await custD.post('order_create.php', body), 422, 'address_required');
    db.prepare("UPDATE customers SET street = '9 rue loin', city = 'Lille' WHERE id = ?").run(ids.custD);
    expectError(await custD.post('order_create.php', { ...body, idempotency_key: newKey() }), 422, 'address_required');
  });

  await t.test('téléphone absent : 422 profile_incomplete', async () => {
    db.prepare("UPDATE customers SET phone = '' WHERE id = ?").run(ids.custD);
    expectError(await custD.post('order_create.php', orderBody()), 422, 'profile_incomplete');
  });

  await t.test('cloisonnement entre clients', async () => {
    const own = await custB.post('order_create.php', orderBody({ items: [pizza('Régina', 'Solo', 1100)], total_cents: 1100 }));
    assert.equal(own.status, 201, own.text);
    ids.orderB1 = own.json.order.id;
    expectError(await custB.get(`order_status.php?id=${ids.orderA1}`), 404, 'not_found');
    expectError(await custB.get('order_status.php?id=999999'), 404, 'not_found');
    expectError(await custB.get('order_status.php?id=abc'), 404, 'not_found');
    const listB = await custB.get('customer_orders.php');
    assert.equal(listB.status, 200);
    assert.deepEqual(listB.json.orders.map((o) => o.id), [ids.orderB1]);
    const listA = await custA.get('customer_orders.php');
    const mine = db.prepare('SELECT id FROM orders WHERE customer_id = ? ORDER BY created_at DESC, id DESC').all(ids.custA).map((r) => r.id);
    assert.deepEqual(listA.json.orders.map((o) => o.id), mine);
    assert.ok(!listA.json.orders.some((o) => o.id === ids.orderB1));
    const st = await custA.get(`order_status.php?id=${ids.orderA1}`);
    assert.equal(st.status, 200);
    assert.match(st.json.server_now, /Z$/);
    expectError(await anon.get(`order_status.php?id=${ids.orderA1}`), 401, 'unauthorized');
  });
});

// ---------------------------------------------------------------- 4. décisions
test('4. décisions du propriétaire', async (t) => {
  await t.test('owner_orders voit la nouvelle commande', async () => {
    const r = await ownerA.get('owner_orders.php');
    assert.equal(r.status, 200);
    const o = r.json.orders.find((x) => x.id === ids.orderA1);
    assert.ok(o, 'commande présente');
    assert.equal(o.customer_id, ids.custA);
    assert.equal(o.customer_phone, '06 00 00 00 01');
    assert.equal(o.customer_email, 'leo@example.test');
    const created = r.json.orders.map((x) => x.created_at);
    assert.deepEqual([...created].sort(), created);
  });

  await t.test('accepter, rejouer, refuser après accepter', async () => {
    const bad = await ownerA.post('owner_order_decide.php', { id: ids.orderA1, action: 'accept', delay_minutes: 25 });
    expectError(bad, 422, 'validation');
    assert.ok(bad.json.fields.delay_minutes);
    expectError(await ownerA.post('owner_order_decide.php', { id: ids.orderA1, action: 'accept' }), 422, 'validation');
    const ok = await ownerA.post('owner_order_decide.php', { id: ids.orderA1, action: 'accept', delay_minutes: 30 });
    assert.equal(ok.status, 200, ok.text);
    assert.equal(ok.json.replayed, false);
    assert.equal(ok.json.order.status, 'accepted');
    assert.equal(ok.json.order.delay_minutes, 30);
    assert.equal(Date.parse(ok.json.order.ready_at) - Date.parse(ok.json.order.accepted_at), 30 * DELAY_MS);
    const again = await ownerA.post('owner_order_decide.php', { id: ids.orderA1, action: 'accept', delay_minutes: 30 });
    assert.equal(again.status, 200);
    assert.equal(again.json.replayed, true);
    assert.equal(again.json.order.accepted_at, ok.json.order.accepted_at);
    const refuse = await ownerA.post('owner_order_decide.php', { id: ids.orderA1, action: 'refuse' });
    expectError(refuse, 409, 'already_decided');
    assert.equal(refuse.json.status, 'accepted');
    assert.equal(refuse.json.delay_minutes, 30);
    expectError(await ownerA.post('owner_order_decide.php', { id: ids.orderA1, action: 'accept', delay_minutes: 40 }), 409, 'already_decided');
    expectError(await ownerA.post('owner_order_decide.php', { id: 999999, action: 'refuse' }), 404, 'not_found');
  });

  await t.test('refus puis refus rejoué', async () => {
    const r = await ownerA.post('owner_order_decide.php', { id: ids.orderB1, action: 'refuse' });
    assert.equal(r.status, 200);
    assert.equal(r.json.order.status, 'refused');
    assert.match(r.json.order.refused_at, /Z$/);
    const again = await ownerA.post('owner_order_decide.php', { id: ids.orderB1, action: 'refuse' });
    assert.equal(again.json.replayed, true);
  });

  await t.test('le client voit ready_at = accepted_at + délai', async () => {
    const st = await custA.get(`order_status.php?id=${ids.orderA1}`);
    assert.equal(st.status, 200);
    const o = st.json.order;
    assert.equal(o.status, 'accepted');
    assert.equal(o.delay_minutes, 30);
    assert.equal(Date.parse(o.ready_at) - Date.parse(o.accepted_at), 30 * DELAY_MS);
    assert.equal('customer_email' in o, false);
    const list = await custA.get('customer_orders.php');
    assert.equal(list.json.orders.find((x) => x.id === ids.orderA1).ready_at, o.ready_at);
  });

  await t.test('fiches clients', async () => {
    expectError(await ownerA.get('owner_customers.php?q=calc'), 405, 'method_not_allowed');
    const all = await ownerA.post('owner_customers.php', {});
    assert.equal(all.status, 200);
    assert.equal(all.json.customers.length, 5);
    const a = all.json.customers.find((c) => c.id === ids.custA);
    assert.match(a.created_at, /Z$/);
    assert.match(a.last_order_at, /Z$/);
    assert.equal(all.json.customers.find((c) => c.id === ids.custD).last_order_at, null);
    const q = await ownerA.post('owner_customers.php', { q: 'calc' });
    assert.deepEqual(q.json.customers.map((c) => c.id), [ids.custC]);
    const pct = await ownerA.post('owner_customers.php', { q: '%' });
    assert.equal(pct.json.customers.length, 0);
    expectError(await ownerA.post('owner_customers.php', { q: 'x'.repeat(81) }), 422, 'validation');
  });
});

// ---------------------------------------------------------------- 5. disponibilités
test('5. disponibilités', async (t) => {
  const pub = async () => (await anon.get('availability.php')).json;

  await t.test('out_today, out_manual, available', async () => {
    const a = await ownerA.post('owner_availability.php', { kind: 'pizza', name: '  Margherita  ', status: 'out_today' });
    assert.equal(a.status, 200, a.text);
    assert.deepEqual(a.json.out, [{ kind: 'pizza', name: 'Margherita', status: 'out_today', service_day: parisDay() }]);
    const b = await ownerA.post('owner_availability.php', { kind: 'ingredient', name: 'saumon', status: 'out_manual' });
    assert.ok(b.json.out.some((e) => e.name === 'saumon' && e.status === 'out_manual' && e.service_day === null));
    const c = await ownerA.post('owner_availability.php', { kind: 'product', name: 'Tiramisu', status: 'out_manual' });
    assert.equal(c.json.out.length, 3);
    let p = await pub();
    assert.deepEqual(Object.keys(p).sort(), ['ingredientsIndisponibles', 'misAJourLe', 'pizzasIndisponibles']);
    assert.deepEqual(p.pizzasIndisponibles, ['Margherita']);
    assert.deepEqual(p.ingredientsIndisponibles, ['saumon']);
    assert.equal(p.misAJourLe, parisDay());
    // Bascule out_today → out_manual sur la même entrée.
    const d = await ownerA.post('owner_availability.php', { kind: 'pizza', name: 'Margherita', status: 'out_manual' });
    assert.equal(d.json.out.find((e) => e.name === 'Margherita').status, 'out_manual');
    const e = await ownerA.post('owner_availability.php', { kind: 'pizza', name: 'Margherita', status: 'available' });
    assert.equal(e.json.out.some((x) => x.name === 'Margherita'), false);
    p = await pub();
    assert.deepEqual(p.pizzasIndisponibles, []);
    const g = await ownerA.get('owner_availability.php');
    assert.equal(g.json.out.length, 2);
    expectError(await ownerA.post('owner_availability.php', { kind: 'boisson', name: 'Coca', status: 'out_today' }), 422, 'validation');
    expectError(await ownerA.post('owner_availability.php', { kind: 'pizza', name: 'x'.repeat(121), status: 'out_today' }), 422, 'validation');
  });

  await t.test('out_today d\'un autre jour : sans effet', async () => {
    db.prepare("INSERT INTO availability (kind, name, status, service_day, updated_at) VALUES ('pizza', 'Napolitaine', 'out_today', '2000-01-01', '2000-01-01T10:00:00Z')").run();
    const p = await pub();
    assert.equal(p.pizzasIndisponibles.includes('Napolitaine'), false);
    const g = await ownerA.get('owner_availability.php');
    assert.equal(g.json.out.some((x) => x.name === 'Napolitaine'), false);
    const r = await custA.post('order_create.php', orderBody({ items: [pizza('Napolitaine', 'Duo', 1600)] }));
    assert.equal(r.status, 201, r.text);
  });
});

// ---------------------------------------------------------------- 6. réglages
test('6. réglages', async () => {
  const g = await ownerA.get('owner_settings.php');
  assert.deepEqual(g.json, { ok: true, default_delay_minutes: 30, store_open: true });
  const p = await ownerA.post('owner_settings.php', { default_delay_minutes: 40 });
  assert.deepEqual(p.json, { ok: true, default_delay_minutes: 40, store_open: true });
  assert.equal((await ownerA.get('owner_settings.php')).json.default_delay_minutes, 40);
  expectError(await ownerA.post('owner_settings.php', { default_delay_minutes: 45 }), 422, 'validation');
  expectError(await ownerA.post('owner_settings.php', { default_delay_minutes: '40' }), 422, 'validation');
  assert.equal((await ownerA.get('owner_settings.php')).json.default_delay_minutes, 40);

  // Bouton ouvert/fermé : fermeture manuelle, prioritaire sur l'horaire (créneau « off » dans ces tests).
  expectError(await ownerA.post('owner_settings.php', { store_open: 'oui' }), 422, 'validation');
  const closed = await ownerA.post('owner_settings.php', { store_open: false });
  assert.deepEqual(closed.json, { ok: true, default_delay_minutes: 40, store_open: false });
  assert.equal((await ownerA.get('owner_settings.php')).json.store_open, false);
  expectError(await custA.post('order_create.php', orderBody({ items: [pizza('Régina', 'Duo', 1600)] })), 422, 'closed');
  const reopened = await ownerA.post('owner_settings.php', { store_open: true });
  assert.equal(reopened.json.store_open, true);
  const r = await custA.post('order_create.php', orderBody({ items: [pizza('Régina', 'Duo', 1600)] }));
  assert.equal(r.status, 201, r.text);
});

// ---------------------------------------------------------------- 7. format
test('7. format des requêtes', async () => {
  const c = new Client('fmt');
  expectError(await c.request('POST', 'customer_login.php', { raw: '{"email":"a@b.c","password":"x"}', headers: { 'Content-Type': 'text/plain' } }), 415, 'unsupported_media_type');
  expectError(await c.request('POST', 'customer_login.php', { raw: 'email=a' , headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }), 415, 'unsupported_media_type');
  expectError(await c.get('availability.php', { origin: 'http://evil.example' }), 403, 'bad_origin');
  expectError(await c.post('customer_login.php', { email: 'a@b.c', password: 'x' }, { origin: ORIGIN + '.evil.example' }), 403, 'bad_origin');
  expectError(await c.post('customer_signup.php', { first_name: 'x'.repeat(70000) }), 413, 'payload_too_large');
  expectError(await c.request('POST', 'customer_login.php', { raw: '{"email": ', headers: { 'Content-Type': 'application/json' } }), 400, 'bad_request');
  expectError(await c.request('POST', 'customer_login.php', { raw: '[1,2]', headers: { 'Content-Type': 'application/json' } }), 400, 'bad_request');
  expectError(await c.request('POST', 'customer_login.php', { raw: '', headers: { 'Content-Type': 'application/json' } }), 400, 'bad_request');
  const deep = '{"a":' + '['.repeat(40) + ']'.repeat(40) + '}';
  expectError(await c.request('POST', 'customer_login.php', { raw: deep, headers: { 'Content-Type': 'application/json; charset=utf-8' } }), 400, 'bad_request');
  for (const route of ['order_create.php', 'customer_logout.php', 'owner_login.php', 'owner_order_decide.php', 'customer_signup.php']) {
    expectError(await c.get(route), 405, 'method_not_allowed');
  }
  expectError(await c.post('availability.php', {}), 405, 'method_not_allowed');
  expectError(await c.request('PUT', 'owner_settings.php', { body: {} }), 405, 'method_not_allowed');
  // Origine autorisée exacte : acceptée.
  assert.equal((await c.get('customer_me.php', { origin: ORIGIN })).status, 200);
});

// ---------------------------------------------------------------- outils : réinstallation et réinitialisation
test('install.php recopie le JSON de disponibilité sans écraser', async () => {
  assert.equal((await ownerA.post('owner_availability.php', { kind: 'pizza', name: 'Reine', status: 'out_today' })).status, 200);
  const src = path.join(ctx.dir, 'disponibilite.test.json');
  const content = JSON.stringify({ misAJourLe: '2026-11-19', pizzasIndisponibles: ['Reine', 'Quatre fromages', 7], ingredientsIndisponibles: ['anchois', 'saumon'] });
  writeFileSync(src, content);
  const r = await runTool(ctx, 'install.php', ['--source=' + src]);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /2 ajoutée\(s\), 2 déjà présente\(s\)/);
  const rows = db.prepare('SELECT kind, name, status FROM availability ORDER BY kind, name').all().map((x) => `${x.kind}:${x.name}:${x.status}`);
  assert.ok(rows.includes('pizza:Reine:out_today'), 'ligne existante non écrasée');
  assert.ok(rows.includes('pizza:Quatre fromages:out_manual'));
  assert.ok(rows.includes('ingredient:anchois:out_manual'));
  assert.equal(readFileSync(src, 'utf8'), content, 'source non modifiée');
  const again = await runTool(ctx, 'install.php', ['--source=' + src]);
  assert.match(again.stdout, /0 ajoutée\(s\)/);
  const p = (await anon.get('availability.php')).json;
  assert.deepEqual(p.pizzasIndisponibles.sort(), ['Quatre fromages', 'Reine']);
});

test('1b. révocation de toutes les sessions, réinitialisation, verrou', async (t) => {
  await t.test('scope all : la session courante aussi', async () => {
    const e = new Client('ownerE');
    const f = new Client('ownerF');
    assert.equal((await ownerLogin(e)).status, 200);
    assert.equal((await ownerLogin(f)).status, 200);
    const r = await e.post('owner_sessions_revoke.php', { scope: 'all' });
    assert.equal(r.status, 200);
    assert.equal(r.json.logged_out, true);
    assert.equal(r.json.revoked, 3); // E, F et A
    assert.equal(e.cookies.has('subito_owner'), false);
    expectError(await e.get('owner_me.php'), 401, 'unauthorized');
    expectError(await f.get('owner_me.php'), 401, 'unauthorized');
    expectError(await ownerA.get('owner_me.php'), 401, 'unauthorized');
  });

  // Remplace « create_owner --reset-password » (plus d'outil : le code patron est OWNER_CODE_HASH) :
  // un mauvais code ne crée aucune session et n'en révoque aucune ; le bon code en crée une neuve.
  await t.test('mauvais code : aucune session créée ni révoquée ; bon code : session neuve', async () => {
    const g = new Client('ownerG');
    assert.equal((await ownerLogin(g)).status, 200);
    const actives = () => db.prepare("SELECT COUNT(*) AS n FROM sessions WHERE user_type = 'owner' AND revoked_at IS NULL").get().n;
    const avant = actives();
    expectError(await ownerLogin(new Client('h'), 'ancien-code-patron'), 401, 'invalid_credentials');
    assert.equal(actives(), avant);
    assert.equal((await g.get('owner_me.php')).status, 200);
    const g2 = new Client('ownerG2');
    assert.equal((await ownerLogin(g2, OWNER_CODE)).status, 200);
    assert.equal(actives(), avant + 1);
    assert.equal((await g2.post('owner_logout.php', {})).status, 200);
    assert.equal((await g.post('owner_logout.php', {})).status, 200);
    // Un échec compté ici : remise à zéro, le test suivant part d'un état connu.
    db.prepare("DELETE FROM throttle WHERE bucket = 'owner_login:ip:127.0.0.1'").run();
  });

  await t.test('un succès ne remet pas le compteur de tentatives à zéro (et ne compte pas)', async () => {
    const bucket = 'owner_login:ip:127.0.0.1';
    const attempts = () => Number(db.prepare('SELECT attempts FROM throttle WHERE bucket = ?').get(bucket)?.attempts ?? 0);
    const x = new Client('presque');
    const start = attempts(); // échecs déjà comptés plus haut dans ce fichier (fenêtre de 15 min)
    assert.ok(start < 4, `échecs déjà comptés : ${start}`);
    expectError(await ownerLogin(x, 'mauvais-0'), 401, 'invalid_credentials');
    assert.equal(attempts(), start + 1);
    assert.equal((await ownerLogin(x, OWNER_CODE)).status, 200);
    assert.equal(attempts(), start + 1, 'la réussite ne remet pas le compteur à zéro');
    for (let i = 1; attempts() < 4; i++) expectError(await ownerLogin(x, 'mauvais-' + i), 401, 'invalid_credentials');
    assert.equal((await ownerLogin(x, OWNER_CODE)).status, 200);
    assert.equal(attempts(), 4);
    expectError(await ownerLogin(x, 'mauvais-5'), 401, 'invalid_credentials'); // 5e échec : verrou
    expectError(await ownerLogin(x, OWNER_CODE), 429, 'too_many_attempts');
    // État connu pour le test suivant (le verrou expirerait seul après 15 minutes).
    db.prepare('DELETE FROM throttle WHERE bucket = ?').run(bucket);
  });

  await t.test('6 tentatives avec mauvais code : 429 à la 6e', async () => {
    const x = new Client('attaquant');
    for (let i = 1; i <= 5; i++) expectError(await ownerLogin(x, 'mauvais-' + i), 401, 'invalid_credentials');
    const sixth = await ownerLogin(x, 'mauvais-6');
    expectError(sixth, 429, 'too_many_attempts');
    const locked = await ownerLogin(x, OWNER_CODE);
    expectError(locked, 429, 'too_many_attempts');
    assert.ok(locked.json.retry_after_seconds > 0 && locked.json.retry_after_seconds <= 900);
    assert.equal(locked.setCookies.length, 0);
  });
});

// ---------------------------------------------------------------- réinitialisation client
test('reset_customer.php : nouveau mot de passe, sessions révoquées', async () => {
  const newPassword = randomPassword();
  assert.equal((await custB.get('customer_orders.php')).status, 200);
  const bad = await runTool(ctx, 'reset_customer.php', [], `bea@example.test\ncourt\n`);
  assert.notEqual(bad.code, 0);
  const unknown = await runTool(ctx, 'reset_customer.php', [], `personne@example.test\n${newPassword}\n`);
  assert.notEqual(unknown.code, 0);
  const r = await runTool(ctx, 'reset_customer.php', [], `bea@example.test\n${newPassword}\n`);
  assert.equal(r.code, 0, r.stderr);
  assert.equal((r.stdout + r.stderr).includes(newPassword), false, 'mot de passe jamais affiché');
  expectError(await custB.get('customer_orders.php'), 401, 'unauthorized');
  expectError(await new Client('b1').post('customer_login.php', { email: 'bea@example.test', password: CUSTOMER_PASSWORD }), 401, 'invalid_credentials');
  assert.equal((await new Client('b2').post('customer_login.php', { email: 'bea@example.test', password: newPassword })).status, 200);
});

// ---------------------------------------------------------------- SUBITO_CONFIG hors CLI
test('horloge de test ignorée hors mode test et sur Vercel (équivalent de « SUBITO_CONFIG ignorée hors CLI »)', async () => {
  // Adaptation : le test PHP (php-cgi) n'a pas d'objet en JavaScript ; l'équivalent est de montrer que le fichier
  // d'horloge de test n'est lu qu'avec SUBITO_TEST_MODE=1 et jamais sur Vercel.
  const { maintenantEpoch } = await import('../../serveur/horloge.js');
  const fichier = path.join(ctx.dir, 'horloge-ignoree.txt');
  writeFileSync(fichier, '1000');
  const sauve = {
    f: process.env.SUBITO_TEST_CLOCK_FILE, m: process.env.SUBITO_TEST_MODE, v: process.env.VERCEL,
  };
  const restaurer = (k, v) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; };
  try {
    process.env.SUBITO_TEST_CLOCK_FILE = fichier;
    process.env.SUBITO_TEST_MODE = '1';
    delete process.env.VERCEL;
    assert.equal(maintenantEpoch(), 1000, 'lue en mode test');
    delete process.env.SUBITO_TEST_MODE;
    assert.ok(maintenantEpoch() > 1e9, 'ignorée sans SUBITO_TEST_MODE');
    process.env.SUBITO_TEST_MODE = '1';
    process.env.VERCEL = '1';
    assert.ok(maintenantEpoch() > 1e9, 'ignorée sur Vercel');
  } finally {
    restaurer('SUBITO_TEST_CLOCK_FILE', sauve.f);
    restaurer('SUBITO_TEST_MODE', sauve.m);
    restaurer('VERCEL', sauve.v);
  }
});

// ---------------------------------------------------------------- zones
test('zones de livraison identiques à cart.js', () => {
  const js = readFileSync(path.join(ROOT, 'assets', 'js', 'cart.js'), 'utf8');
  const block = js.match(/const DELIVERY_ZONES = \[([\s\S]*?)\];/)[1];
  const jsZones = [...block.matchAll(/city:\s*"([^"]+)",\s*minimum:\s*([\d.]+),\s*fee:\s*([\d.]+)/g)]
    .map((m) => [m[1], Math.round(Number(m[2]) * 100), Math.round(Number(m[3]) * 100)]);
  // Version JavaScript de l'API : serveur/util.js (même ordre et mêmes montants que la version PHP).
  const apiZones = Object.entries(DELIVERY_ZONES).map(([ville, z]) => [ville, z.minimum_cents, z.fee_cents]);
  assert.equal(jsZones.length, 8);
  assert.deepEqual(apiZones, jsZones);
});

// ---------------------------------------------------------------- 8 et 9. contrôles transverses
test('8. aucun secret dans les réponses', () => {
  assert.ok(responses.length > 100, `réponses contrôlées : ${responses.length}`);
  for (const r of responses) {
    const body = secretScanText(r).toLowerCase();
    for (const word of ['password', 'password_hash', 'token', 'token_hash']) {
      assert.equal(body.includes(word), false, `${r.method} ${r.route} contient « ${word} » : ${r.text.slice(0, 200)}`);
    }
  }
});

test('9. toutes les réponses sont du JSON (jamais de HTML)', () => {
  for (const r of responses) {
    const ct = r.headers.get('content-type') || '';
    assert.match(ct, /^application\/json; charset=utf-8$/i, `${r.method} ${r.route} → ${ct}`);
    assert.equal(r.headers.get('cache-control'), 'no-store', `${r.route}`);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff', `${r.route}`);
    // availability.php (succès) : mêmes clés que disponibilite.json, sans « ok ».
    const publicAvailability = r.route === 'availability.php' && r.status === 200;
    if (publicAvailability) assert.ok(r.json && !('ok' in r.json), r.text.slice(0, 200));
    else assert.ok(r.json && typeof r.json.ok === 'boolean', `${r.method} ${r.route} : ${r.text.slice(0, 200)}`);
    assert.doesNotMatch(r.text, /<html|<br|<b>|<!doctype/i);
    if (r.status >= 400) assert.equal(r.json.ok, false);
  }
  assert.doesNotMatch(ctx.serverLog(), /Fatal error|Warning:|Notice:|Deprecated:| 500 server_error/);
});
