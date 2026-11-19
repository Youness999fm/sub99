// Outils de test de l'API PHP : serveur php -S, base SQLite neuve, client HTTP avec cookies,
// contrôles automatiques (pas de secret, pas de HTML) sur toutes les réponses reçues.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
// Port 8091 par défaut ; SUBITO_TEST_PORT si ce port est réservé sur la machine.
export const PORT = Number(process.env.SUBITO_TEST_PORT || 8091);
export const BASE = `http://127.0.0.1:${PORT}/api/`;
export const ORIGIN = `http://localhost:${PORT}`;

// Binaire PHP : SUBITO_PHP (sinon « php » du PATH) ; php.ini : SUBITO_PHP_INI (facultatif).
export const PHP = process.env.SUBITO_PHP || 'php';
export const PHP_INI = process.env.SUBITO_PHP_INI || '';
const phpArgs = (args) => (PHP_INI ? ['-c', PHP_INI, ...args] : args);

/** Toutes les réponses reçues, pour les contrôles transverses. */
export const responses = [];

// MySQL / MariaDB facultatif : si les trois variables sont définies, la configuration de test
// (temporaire, hors dépôt) utilise ce DSN. La base doit être vide ; le harnais ne crée ni ne
// supprime aucune base. Le mot de passe vient de l'environnement, jamais d'un fichier du dépôt.
const MYSQL = (process.env.SUBITO_TEST_MYSQL_DSN && process.env.SUBITO_TEST_MYSQL_USER
  && process.env.SUBITO_TEST_MYSQL_PASSWORD !== undefined)
  ? { dsn: process.env.SUBITO_TEST_MYSQL_DSN, user: process.env.SUBITO_TEST_MYSQL_USER, password: process.env.SUBITO_TEST_MYSQL_PASSWORD }
  : null;

/** Chaîne PHP entre apostrophes (aucune interpolation). */
const phpStr = (s) => (s === null ? 'null' : `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`);

export function makeEnv() {
  const base = process.env.SUBITO_TEST_DIR || tmpdir();
  mkdirSync(base, { recursive: true });
  const dir = mkdtempSync(path.join(base, 'subito-api-'));
  const dbPath = MYSQL ? null : path.join(dir, 'test.sqlite');
  const configPath = path.join(dir, 'config.test.php');
  const db = MYSQL
    ? { dsn: MYSQL.dsn, user: MYSQL.user, password: MYSQL.password }
    : { dsn: 'sqlite:' + dbPath.replace(/\\/g, '/'), user: null, password: null };
  const php = `<?php
return [
    'db' => ['dsn' => ${phpStr(db.dsn)}, 'user' => ${phpStr(db.user)}, 'password' => ${phpStr(db.password)}],
    'app_origins' => [${phpStr(ORIGIN)}],
    'cookie_secure' => false,
    'timezone' => 'Europe/Paris',
];
`;
  writeFileSync(configPath, php);
  return { dir, dbPath, configPath, driver: MYSQL ? 'mysql' : 'sqlite', env: { ...process.env, SUBITO_CONFIG: configPath } };
}

/**
 * Accès direct à la base de test pour les vérifications : node:sqlite pour SQLite ;
 * pour MySQL, même interface (prepare().get/all/run, exec) via PHP + PDO, avec la
 * configuration temporaire (SUBITO_CONFIG).
 */
export function openTestDb(ctx) {
  if (ctx.driver === 'sqlite') return new DatabaseSync(ctx.dbPath);
  const helper = path.join(ctx.dir, 'db-helper.php');
  writeFileSync(helper, `<?php
$c = require getenv('SUBITO_CONFIG');
$pdo = new PDO($c['db']['dsn'], $c['db']['user'], $c['db']['password'], [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC, PDO::ATTR_EMULATE_PREPARES => false]);
$q = json_decode(stream_get_contents(STDIN), true);
$st = $pdo->prepare($q['sql']);
$st->execute($q['params']);
$out = $q['mode'] === 'run' ? ['changes' => $st->rowCount()] : ($q['mode'] === 'one' ? ($st->fetch() ?: null) : $st->fetchAll());
echo json_encode($out);
`);
  const query = (sql, params, mode) => {
    const r = spawnSync(PHP, phpArgs([helper]), { env: ctx.env, input: JSON.stringify({ sql, params, mode }), encoding: 'utf8' });
    if (r.status !== 0) throw new Error('Requête de test MySQL en échec : ' + (r.stderr || r.stdout));
    const v = JSON.parse(r.stdout);
    return v === null ? undefined : v;
  };
  return {
    exec(sql) { if (!/^\s*PRAGMA/i.test(sql)) query(sql, [], 'run'); },
    prepare(sql) {
      return {
        get: (...p) => query(sql, p, 'one'),
        all: (...p) => query(sql, p, 'all'),
        run: (...p) => query(sql, p, 'run'),
      };
    },
    close() {},
  };
}

export function runTool(ctx, tool, args = [], input = '') {
  const r = spawnSync(PHP, phpArgs([path.join(ROOT, 'api', 'tools', tool), ...args]), {
    env: ctx.env, input, encoding: 'utf8', cwd: ROOT,
  });
  return { code: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

export async function startServer(ctx) {
  const proc = spawn(PHP, phpArgs(['-S', `127.0.0.1:${PORT}`, '-t', ROOT]), {
    env: ctx.env, cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  proc.stdout.on('data', (d) => { log += d; });
  proc.stderr.on('data', (d) => { log += d; });
  ctx.serverLog = () => log;
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(BASE + 'availability.php');
      await r.text();
      if (r.status === 200) return proc;
    } catch { /* pas encore prêt */ }
    await new Promise((res) => setTimeout(res, 100));
  }
  proc.kill();
  throw new Error('Le serveur PHP ne démarre pas :\n' + log);
}

export function stopServer(proc) {
  if (proc && proc.exitCode === null) proc.kill();
}

/** Client HTTP avec boîte à cookies (comme un navigateur, Origin envoyé sur les POST). */
export class Client {
  constructor(name) {
    this.name = name;
    this.cookies = new Map();
    this.lastSetCookies = [];
  }

  cookieHeader() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  storeCookies(headers) {
    this.lastSetCookies = headers.getSetCookie();
    for (const sc of this.lastSetCookies) {
      const [pair, ...attrs] = sc.split(';');
      const eq = pair.indexOf('=');
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      const expAttr = attrs.find((a) => /^\s*expires=/i.test(a));
      const maxAge = attrs.find((a) => /^\s*max-age=/i.test(a));
      const expired = (maxAge && Number(maxAge.split('=')[1]) <= 0)
        || (expAttr && Date.parse(expAttr.split('=')[1]) < Date.now());
      if (value === '' || value === 'deleted' || expired) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  async request(method, route, { body, raw, headers = {}, origin } = {}) {
    const h = { 'User-Agent': 'Mozilla/5.0 (Linux; Android 14) Chrome/130.0 Mobile Safari/537.36', ...headers };
    if (this.cookies.size) h.Cookie = this.cookieHeader();
    if (origin !== undefined) {
      if (origin !== null) h.Origin = origin;
    } else if (method !== 'GET') {
      h.Origin = ORIGIN;
    }
    let payload;
    if (raw !== undefined) payload = raw;
    else if (body !== undefined) {
      payload = JSON.stringify(body);
      if (!Object.keys(h).some((k) => k.toLowerCase() === 'content-type')) h['Content-Type'] = 'application/json';
    }
    const res = await fetch(BASE + route, { method, headers: h, body: payload, redirect: 'manual' });
    const text = await res.text();
    this.storeCookies(res.headers);
    let json = null;
    try { json = JSON.parse(text); } catch { /* contrôlé plus bas */ }
    const r = { status: res.status, headers: res.headers, text, json, setCookies: this.lastSetCookies, route, method };
    responses.push(r);
    return r;
  }

  get(route, opts) { return this.request('GET', route, opts); }
  post(route, body, opts = {}) { return this.request('POST', route, { body, ...opts }); }
}

/**
 * Corps à contrôler pour les secrets : les clés de `fields` d'une erreur `validation`
 * sont des noms de champs de formulaire (« password ») et sont remplacées.
 */
export function secretScanText(r) {
  if (r.json && r.json.error === 'validation' && r.json.fields && typeof r.json.fields === 'object') {
    const copy = { ...r.json, fields: Object.values(r.json.fields) };
    return JSON.stringify(copy);
  }
  return r.text;
}
