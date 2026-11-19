// Outils de test de l'API JavaScript (Vercel + Postgres) : serveur HTTP local qui héberge le routeur,
// base Postgres réelle en mémoire (PGlite), client HTTP avec cookies, contrôles automatiques sur toutes les réponses.
// Même interface que tests/api/lib/harness.mjs (version PHP), pour comparer les comportements.
import http from 'node:http';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { creerPiloteTest } from '../../../serveur/outils/pglite-driver.mjs';
import { utiliserPilote, convertir } from '../../../serveur/db.js';
import { traiter } from '../../../serveur/router.js';
import { schemaSql } from '../../../serveur/schema.js';
import { servirStatique } from '../../../serveur/outils/statique.mjs';
import { nowUtc, cleanSpaces, strChars } from '../../../serveur/util.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const PORT = Number(process.env.SUBITO_TEST_PORT || 8091);
export const BASE = `http://127.0.0.1:${PORT}/api/`;
export const ORIGIN = `http://localhost:${PORT}`;

/** Code patron de test : fabriqué pour les tests, sans lien avec un vrai code. */
export const OWNER_CODE = 'code-patron-test-' + crypto.randomBytes(5).toString('hex');

/** Toutes les réponses reçues, pour les contrôles transverses. */
export const responses = [];

export function makeEnv() {
  const base = process.env.SUBITO_TEST_DIR || tmpdir();
  const dir = mkdtempSync(path.join(base, 'subito-api-js-'));
  const pilote = creerPiloteTest();
  return {
    dir,
    driver: 'pg',
    pilote,
    // Variables appliquées à process.env au démarrage du serveur (il tourne dans ce processus).
    env: {
      APP_ORIGINS: `${ORIGIN},http://127.0.0.1:${PORT}`,
      SUBITO_COOKIE_SECURE: '0',
      SUBITO_TEST_MODE: '1',
      OWNER_CODE_HASH: bcrypt.hashSync(OWNER_CODE, 4),
      SESSION_SECRET: crypto.randomBytes(24).toString('hex')
    }
  };
}

function appliquerEnv(ctx) {
  for (const [k, v] of Object.entries(ctx.env)) process.env[k] = v;
}

/** Accès direct et synchrone à la base de test (même interface que node:sqlite : prepare().get/all/run, exec). */
export function openTestDb(ctx) {
  const q = (sql, params) => ctx.pilote.querySync(convertir(sql), params);
  return {
    exec(sql) { if (!/^\s*PRAGMA/i.test(sql)) ctx.pilote.execSync(sql); },
    prepare(sql) {
      return {
        get: (...p) => q(sql, p).rows[0],
        all: (...p) => q(sql, p).rows,
        run: (...p) => ({ changes: q(sql, p).rowCount })
      };
    },
    close() {}
  };
}

/** Outils en ligne de commande, rejoués ici. Renvoie une promesse { code, stdout, stderr }. */
export async function runTool(ctx, tool, args = [], input = '') {
  appliquerEnv(ctx);
  utiliserPilote(ctx.pilote);
  if (tool === 'install.php') return installer(ctx, args);
  if (tool === 'reset_customer.php') {
    // Même règles que api/tools/reset_customer.php : e-mail et mot de passe lus sur l'entrée (une ligne chacun).
    if (args.length > 0) return { code: 1, stdout: '', stderr: 'Aucune option attendue.\n' };
    const lignes = String(input).split('\n').map((l) => l.replace(/\r$/, ''));
    const { resetCustomer } = await import('../../../serveur/outils/reset-customer.mjs');
    return resetCustomer(lignes[0] || '', lignes[1] || '');
  }
  return { code: 1, stdout: '', stderr: 'Outil inconnu : ' + tool + '\n' };
}

/** Équivalent de api/tools/install.php : tables (idempotent), réglage par défaut, recopie des indisponibilités. */
function installer(ctx, args) {
  let source = path.join(ROOT, 'assets', 'data', 'disponibilite.json');
  for (const a of args) {
    if (a.startsWith('--source=')) source = a.slice(9);
    else return { code: 1, stdout: '', stderr: 'Option inconnue : ' + a + '\n' };
  }
  let out = '';
  try {
    for (const sql of schemaSql()) ctx.pilote.execSync(sql);
    out += 'Tables prêtes (pgsql).\n';
    if (!existsSync(source)) return { code: 0, stdout: out + 'Fichier de disponibilité absent : aucune recopie.\n', stderr: '' };
    let data;
    try { data = JSON.parse(readFileSync(source, 'utf8')); } catch { data = null; }
    if (data === null || typeof data !== 'object' || Array.isArray(data)) {
      return { code: 1, stdout: out, stderr: 'Fichier de disponibilité illisible : aucune recopie.\n' };
    }
    let added = 0;
    let kept = 0;
    const now = nowUtc();
    for (const [key, kind] of [['pizzasIndisponibles', 'pizza'], ['ingredientsIndisponibles', 'ingredient']]) {
      const list = data[key];
      if (!Array.isArray(list)) continue;
      for (const brut of list) {
        if (typeof brut !== 'string') continue;
        const name = cleanSpaces(brut);
        if (name === '' || strChars(name) > 120) continue;
        const r = ctx.pilote.querySync(
          "INSERT INTO availability (kind, name, status, service_day, updated_at) VALUES ($1, $2, 'out_manual', NULL, $3) ON CONFLICT (kind, name) DO NOTHING",
          [kind, name, now]
        );
        if (r.rowCount === 1) added++; else kept++;
      }
    }
    return { code: 0, stdout: out + `Indisponibilités recopiées : ${added} ajoutée(s), ${kept} déjà présente(s).\n`, stderr: '' };
  } catch (e) {
    return { code: 1, stdout: out, stderr: "Échec de l'installation : " + e.message + '\n' };
  }
}

/**
 * Démarre le serveur dans ce processus. { statique: true } sert aussi les pages du site (tests de navigateur).
 */
export async function startServer(ctx, { statique = false } = {}) {
  appliquerEnv(ctx);
  utiliserPilote(ctx.pilote);
  let log = '';
  const consoleError = console.error;
  console.error = (...a) => { log += a.map(String).join(' ') + '\n'; };
  ctx.serverLog = () => log;
  const serveur = http.createServer((req, res) => {
    if (statique && !(req.url || '').startsWith('/api/')) servirStatique(req, res);
    else traiter(req, res);
  });
  await new Promise((resolve, reject) => { serveur.once('error', reject); serveur.listen(PORT, '127.0.0.1', resolve); });
  const proc = {
    exitCode: null,
    kill() {
      if (proc.exitCode !== null) return;
      proc.exitCode = 0;
      console.error = consoleError;
      serveur.closeAllConnections();
      serveur.close();
      ctx.pilote.close();
    }
  };
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(BASE + 'availability.php');
      await r.text();
      if (r.status === 200) return proc;
    } catch { /* pas encore prêt */ }
    await new Promise((res) => setTimeout(res, 100));
  }
  proc.kill();
  throw new Error('Le serveur de test ne démarre pas :\n' + log);
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
