// Schéma SQL à coller dans Supabase et purge quotidienne : exécutés sur un vrai Postgres (PGlite).
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { schemaSql, PURGE_SQL } from '../../serveur/schema.js';

const FORMAT = `'YYYY-MM-DD"T"HH24:MI:SS"Z"'`;
let db;

before(async () => {
  db = new PGlite();
  for (const sql of schemaSql()) await db.exec(sql);
  await db.exec(`INSERT INTO customers (email, password_hash, first_name, last_name, phone, created_at, updated_at)
                 VALUES ('a@example.test', 'x', 'A', 'B', '0611223344', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`);
});

async function commande(cle, decalageSql) {
  // created_at = maintenant décalé, au format texte UTC des colonnes.
  const r = await db.query(
    `INSERT INTO orders (customer_id, idempotency_key, payload_hash, status, mode, customer_first_name, customer_last_name,
       customer_phone, customer_email, payment_methods, products_cents, promo_cents, delivery_fee_cents, total_cents, created_at, service_day)
     VALUES (1, $1, $2, 'new', 'pickup', 'A', 'B', '0611223344', 'a@example.test', '[]', 1000, 0, 0, 1000,
       to_char((now() ${decalageSql}) at time zone 'UTC', ${FORMAT}), '2026-01-01') RETURNING id`,
    [cle, 'h'.repeat(64)]
  );
  const id = r.rows[0].id;
  await db.query(`INSERT INTO order_items (order_id, position, name, variant, qty, unit_price_cents, line_total_cents, removed_json, extras_json, note)
                  VALUES ($1, 0, 'Margherita', 'Senior', 1, 1000, 1000, '[]', '[]', '')`, [id]);
  return id;
}

test('la purge supprime les commandes d\'avant aujourd\'hui (heure de Paris) et leurs lignes, rien d\'autre', async () => {
  const hier = await commande('hier', "- interval '30 hours'");
  const avantHier = await commande('avant-hier', "- interval '55 hours'");
  const maintenant = await commande('maintenant', '');
  const dansUneHeure = await commande('futur', "+ interval '1 hour'");
  // Session expirée / valide.
  await db.exec(`INSERT INTO sessions (token_hash, user_type, user_id, remember, created_at, last_seen_at, expires_at, device)
    VALUES ('${'a'.repeat(64)}', 'customer', 1, 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z', 'x'),
           ('${'b'.repeat(64)}', 'customer', 1, 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', '2099-01-01T00:00:00Z', 'x')`);

  for (const sql of PURGE_SQL) await db.exec(sql);

  const restantes = (await db.query('SELECT id FROM orders ORDER BY id')).rows.map((r) => r.id);
  assert.ok(!restantes.includes(hier) && !restantes.includes(avantHier), 'commandes d\'hier supprimées');
  assert.ok(restantes.includes(maintenant) && restantes.includes(dansUneHeure), 'commandes du jour conservées');
  const lignes = (await db.query('SELECT order_id FROM order_items')).rows.map((r) => r.order_id);
  assert.deepEqual(lignes.sort(), [maintenant, dansUneHeure].sort(), 'les lignes suivent leur commande');
  assert.equal((await db.query('SELECT count(*)::int AS n FROM customers')).rows[0].n, 1, 'les comptes clients sont conservés');
  const sessions = (await db.query('SELECT token_hash FROM sessions')).rows.map((r) => r.token_hash.trim());
  assert.deepEqual(sessions, ['b'.repeat(64)], 'seule la session expirée est supprimée');
});

test('la coupure est bien minuit à Paris (heure d\'été et d\'hiver)', async () => {
  const r = await db.query(`SELECT
    to_char((date_trunc('day', TIMESTAMPTZ '2026-07-14 21:30:00+00' at time zone 'Europe/Paris') at time zone 'Europe/Paris') at time zone 'UTC', ${FORMAT}) AS ete,
    to_char((date_trunc('day', TIMESTAMPTZ '2026-11-19 22:30:00+00' at time zone 'Europe/Paris') at time zone 'Europe/Paris') at time zone 'UTC', ${FORMAT}) AS hiver`);
  assert.equal(r.rows[0].ete, '2026-07-13T22:00:00Z');
  assert.equal(r.rows[0].hiver, '2026-11-18T23:00:00Z');
});

test('supabase/001_schema.sql contient le schéma et la purge actuels (aucun écart avec serveur/schema.js)', () => {
  const fichier = readFileSync(new URL('../../supabase/001_schema.sql', import.meta.url), 'utf8');
  for (const sql of schemaSql()) assert.ok(fichier.includes(sql + ';'), 'instruction absente : ' + sql.slice(0, 60));
  for (const sql of PURGE_SQL) assert.ok(fichier.includes(sql + ';'), 'purge absente : ' + sql.slice(0, 60));
  assert.match(fichier, /cron\.schedule/);
  assert.equal((fichier.match(/ENABLE ROW LEVEL SECURITY/g) || []).length, 11);
});

test('le script du fichier SQL (hors planification pg_cron) s\'exécute tel quel, deux fois de suite', async () => {
  const fichier = readFileSync(new URL('../../supabase/001_schema.sql', import.meta.url), 'utf8');
  assert.ok(fichier.includes('create extension if not exists pg_cron'), 'extension pg_cron activée par le script');
  const sansCron = fichier.slice(0, fichier.indexOf('-- ==== PLANIFICATION (pg_cron) ===='));
  assert.ok(sansCron.length > 500 && !/cron\./.test(sansCron), 'la partie hors planification ne touche pas à pg_cron');
  const neuf = new PGlite();
  await neuf.exec(sansCron);
  await neuf.exec(sansCron);
  const t = await neuf.query("select count(*)::int as n from pg_tables where schemaname = 'public'");
  assert.equal(t.rows[0].n, 11);
});
