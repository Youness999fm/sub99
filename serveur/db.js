// Accès Postgres (Supabase) : requêtes préparées uniquement, placeholders « ? » convertis en $1, $2…
// Le pilote est interchangeable : pg (production, variable DATABASE_URL) ou PGlite (tests).
import pg from 'pg';

pg.types.setTypeParser(20, (v) => Number(v)); // int8 (count(*)) -> nombre

let pilote = null;

/** Réservé aux tests : installe un autre pilote { query(texte, params), transaction(fn) }. */
export function utiliserPilote(p) {
  pilote = p;
}

function creerPilotePg() {
  const url = process.env.DATABASE_URL;
  if (!url) throw Object.assign(new Error('DATABASE_URL absente'), { code: 'CONFIG_BASE' });
  let chaine = url;
  try {
    // Le pooleur Supabase présente un certificat inconnu de Node ; sslmode de l'URL écraserait l'option ssl.
    const u = new URL(url);
    u.searchParams.delete('sslmode');
    chaine = u.toString();
  } catch { /* chaîne laissée telle quelle */ }
  const pool = new pg.Pool({
    connectionString: chaine,
    ssl: { rejectUnauthorized: false },
    max: 3,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 5000
  });
  pool.on('error', () => { /* connexion inactive coupée : la suivante en rouvre une */ });
  return {
    query: (texte, params) => pool.query(texte, params),
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const r = await fn((texte, params) => client.query(texte, params));
        await client.query('COMMIT');
        return r;
      } catch (e) {
        try { await client.query('ROLLBACK'); } catch { /* connexion déjà perdue */ }
        throw e;
      } finally {
        client.release();
      }
    }
  };
}

function courant() {
  if (!pilote) pilote = creerPilotePg();
  return pilote;
}

/** Convertit les « ? » en $1, $2… (aucun « ? » littéral n'est utilisé dans le SQL de l'application). */
export function convertir(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => '$' + (++i));
}

function aides(query) {
  return {
    /** Première ligne ou null. */
    async one(sql, params = []) {
      const r = await query(convertir(sql), params);
      return r.rows.length ? r.rows[0] : null;
    },
    /** Toutes les lignes. */
    async all(sql, params = []) {
      const r = await query(convertir(sql), params);
      return r.rows;
    },
    /** Nombre de lignes modifiées. */
    async exec(sql, params = []) {
      const r = await query(convertir(sql), params);
      return r.rowCount;
    },
    /** INSERT : renvoie la colonne id (RETURNING id est ajouté). */
    async insert(sql, params = []) {
      const r = await query(convertir(sql) + ' RETURNING id', params);
      return Number(r.rows[0].id);
    }
  };
}

const global = aides((texte, params) => courant().query(texte, params));
export const one = global.one;
export const all = global.all;
export const exec = global.exec;
export const insert = global.insert;

/**
 * Transaction : fn reçoit { one, all, exec, insert } liés à la transaction.
 * À l'intérieur, n'utilisez QUE ces aides (pas celles du module) : une autre connexion ne voit pas la transaction.
 */
export function transaction(fn) {
  return courant().transaction((query) => fn(aides(query)));
}

/** Violation d'unicité (SQLSTATE 23505). */
export function estViolationUnique(e) {
  return Boolean(e) && e.code === '23505';
}

/** Table ou colonne absente (SQLSTATE 42P01 / 42703) : migration pas encore appliquée en prod. */
export function estSchemaAbsent(e) {
  return Boolean(e) && (e.code === '42P01' || e.code === '42703');
}
