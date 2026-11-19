// Fondations de l'API JavaScript : routeur, base Postgres (PGlite), schéma, origine, 404, 405, limitation, horloge.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, openTestDb, runTool, startServer, stopServer, Client, ORIGIN } from './lib/harness.mjs';
import { one, insert, transaction, estViolationUnique } from '../../serveur/db.js';
import { throttleHit, throttleLocked, throttleIpKey } from '../../serveur/throttle.js';
import { serviceDay, utcAt, utcToEpoch, nameKeys } from '../../serveur/util.js';

let ctx;
let proc;
before(async () => {
  ctx = makeEnv();
  const inst = await runTool(ctx, 'install.php');
  assert.equal(inst.code, 0, inst.stderr);
  proc = await startServer(ctx);
});
after(() => stopServer(proc));

test('la route publique availability répond avec les clés attendues', async () => {
  const r = await new Client('x').get('availability.php');
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.json), ['misAJourLe', 'pizzasIndisponibles', 'ingredientsIndisponibles']);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal((await new Client('x').get('availability')).status, 200, 'sans extension aussi');
});

test('routes inconnues, méthodes et origines refusées', async () => {
  const c = new Client('x');
  const inconnue = await c.get('nexiste_pas.php');
  assert.equal(inconnue.status, 404);
  assert.equal(inconnue.json.error, 'not_found');
  assert.equal((await c.get('..%2Fdb.php')).status, 404);
  const post = await c.post('availability.php', {});
  assert.equal(post.status, 405);
  assert.equal(post.headers.get('allow'), 'GET');
  const etranger = await c.get('availability.php', { origin: 'https://pirate.example' });
  assert.equal(etranger.status, 403);
  assert.equal(etranger.json.error, 'bad_origin');
  assert.equal((await c.get('availability.php', { origin: ORIGIN })).status, 200);
});

test('le schéma est créé et reste idempotent ; la sécurité par ligne est active', async () => {
  const again = await runTool(ctx, 'install.php');
  assert.equal(again.code, 0);
  const db = openTestDb(ctx);
  const tables = db.prepare("select tablename, rowsecurity from pg_tables where schemaname = 'public' order by tablename").all();
  assert.deepEqual(tables.map((t) => t.tablename), ['availability', 'customers', 'order_items', 'orders', 'sessions', 'settings', 'throttle']);
  assert.ok(tables.every((t) => t.rowsecurity === true), 'RLS activée sur chaque table');
  assert.equal(db.prepare("select svalue from settings where skey = ?").get('default_delay_minutes').svalue, '30');
});

test('requêtes préparées, insert, unicité et transaction (annulation)', async () => {
  const now = utcAt(1700000000);
  const id = await insert('INSERT INTO customers (email, password_hash, first_name, last_name, phone, street, city, created_at, updated_at, last_login_at) VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?, NULL)',
    ['a@example.test', 'x', 'A', 'B', '0611223344', now, now]);
  assert.ok(id > 0);
  await assert.rejects(
    insert('INSERT INTO customers (email, password_hash, first_name, last_name, phone, street, city, created_at, updated_at, last_login_at) VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?, NULL)',
      ['a@example.test', 'x', 'A', 'B', '0611223344', now, now]),
    (e) => estViolationUnique(e)
  );
  await assert.rejects(transaction(async (t) => {
    await t.exec("UPDATE customers SET first_name = 'Z' WHERE id = ?", [id]);
    throw new Error('annule');
  }), /annule/);
  assert.equal((await one('SELECT first_name FROM customers WHERE id = ?', [id])).first_name, 'A');
  await transaction(async (t) => { await t.exec("UPDATE customers SET first_name = 'Y' WHERE id = ?", [id]); });
  assert.equal((await one('SELECT first_name FROM customers WHERE id = ?', [id])).first_name, 'Y');
});

test('limitation de débit : verrou au seuil, fenêtre, adresses IPv6', async () => {
  for (let i = 0; i < 4; i++) await throttleHit('t:a', 5, 900, 900);
  assert.equal(await throttleLocked('t:a'), 0);
  await throttleHit('t:a', 5, 900, 900);
  assert.ok(await throttleLocked('t:a') > 0);
  assert.equal(throttleIpKey('203.0.113.7'), '203.0.113.7');
  assert.equal(throttleIpKey('::ffff:203.0.113.7'), '203.0.113.7');
  assert.equal(throttleIpKey('2001:db8:1:2:aaaa:bbbb:cccc:dddd'), '2001:0db8:0001:0002::/64');
  assert.equal(throttleIpKey('pas une ip'), 'unknown');
});

test('jour de service parisien, dates UTC, noms normalisés', () => {
  assert.equal(utcToEpoch(utcAt(1700000000)), 1700000000);
  assert.match(serviceDay(), /^\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual(nameKeys('Calzone (soufflée)'), ['calzone (soufflee)', 'calzone']);
  assert.deepEqual(nameKeys('  Chèvre-Miel. '), ['chevre-miel']);
});
