// Sessions (jeton aléatoire en cookie HttpOnly, seul le SHA-256 est stocké). Port de api/lib/auth.php.
// Différence voulue : le commerçant n'a plus d'e-mail ni de mot de passe, mais un code patron
// (hash bcrypt dans OWNER_CODE_HASH). Il n'y a qu'un propriétaire : OWNER_ID.
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { fail, setCookie } from './core.js';
import { one, exec, insert, estViolationUnique } from './db.js';
import { maintenantEpoch } from './horloge.js';
import { nowUtc, utcAt, utcToEpoch, entreeBcrypt } from './util.js';
import { throttleEnforce, throttleRefund, throttleIpKey } from './throttle.js';

export const OWNER_COOKIE = 'subito_owner';
export const CUSTOMER_COOKIE = 'subito_customer';
export const SESSION_SHORT = 43200; // 12 h
export const SESSION_LONG = 2592000; // 30 jours
export const SESSION_TOUCH_EVERY = 300; // 5 min
export const OWNER_ID = 1;

export function authCookieName(type) {
  return type === 'owner' ? OWNER_COOKIE : CUSTOMER_COOKIE;
}

function authSameSite(type) {
  return type === 'owner' ? 'Strict' : 'Lax';
}

export function newToken() {
  return crypto.randomBytes(32).toString('base64url');
}

export function sha256(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

export function sessionLifetime(type, remember) {
  return type === 'owner' && !remember ? SESSION_SHORT : SESSION_LONG;
}

export function setAuthCookie(c, type, token, persistent) {
  const maintenant = maintenantEpoch();
  setCookie(c, authCookieName(type), token, {
    expires: persistent ? maintenant + SESSION_LONG : 0,
    maintenant,
    sameSite: authSameSite(type)
  });
}

export function clearAuthCookie(c, type) {
  setCookie(c, authCookieName(type), '', { expires: 1, maintenant: maintenantEpoch(), sameSite: authSameSite(type) });
}

/** Libellé court de l'appareil, tiré du User-Agent (« Chrome · Android »). */
export function deviceLabel(c) {
  const ua = String(c.headers['user-agent'] || '').toLowerCase();
  let browser = 'Navigateur';
  for (const [needle, label] of [['edg/', 'Edge'], ['opr/', 'Opera'], ['samsungbrowser', 'Samsung Internet'], ['firefox/', 'Firefox'],
    ['crios', 'Chrome'], ['chrome/', 'Chrome'], ['safari/', 'Safari']]) {
    if (ua.includes(needle)) { browser = label; break; }
  }
  let os = 'appareil inconnu';
  for (const [needle, label] of [['android', 'Android'], ['iphone', 'iPhone'], ['ipad', 'iPad'], ['windows', 'Windows'],
    ['mac os x', 'Mac'], ['cros', 'ChromeOS'], ['linux', 'Linux']]) {
    if (ua.includes(needle)) { os = label; break; }
  }
  return (browser + ' · ' + os).slice(0, 120);
}

/** Crée une session, pose le cookie, renvoie l'id de session. */
export async function createSession(c, type, userId, remember) {
  const token = newToken();
  const now = maintenantEpoch();
  const id = await insert(
    `INSERT INTO sessions (token_hash, user_type, user_id, remember, created_at, last_seen_at, expires_at, revoked_at, device)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
    [sha256(token), type, userId, remember ? 1 : 0, utcAt(now), utcAt(now), utcAt(now + sessionLifetime(type, remember)), deviceLabel(c)]
  );
  setAuthCookie(c, type, token, type === 'customer' || remember);
  c.sessions[type] = undefined;
  return id;
}

/** Session valide du rôle demandé (non révoquée, non expirée), ou null. Prolonge l'expiration (glissante). */
export async function currentSession(c, type) {
  if (c.sessions[type] !== undefined) return c.sessions[type];
  const token = c.cookies[authCookieName(type)];
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) return (c.sessions[type] = null);
  const row = await one('SELECT * FROM sessions WHERE token_hash = ? AND user_type = ?', [sha256(token), type]);
  const now = maintenantEpoch();
  if (row === null || row.revoked_at !== null || utcToEpoch(row.expires_at) <= now) return (c.sessions[type] = null);
  if (utcToEpoch(row.last_seen_at) <= now - SESSION_TOUCH_EVERY) {
    const remember = Number(row.remember) === 1;
    const exp = utcAt(now + sessionLifetime(type, remember));
    const n = await exec('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ? AND revoked_at IS NULL', [utcAt(now), exp, Number(row.id)]);
    if (n === 1) {
      row.last_seen_at = utcAt(now);
      row.expires_at = exp;
      if (type === 'customer' || remember) setAuthCookie(c, type, token, true);
    }
  }
  return (c.sessions[type] = row);
}

/**
 * Hachage factice pour une connexion avec un e-mail inconnu : un seul compare, comme pour un compte existant.
 * Créé une fois (valeur aléatoire), gardé dans `settings`, jamais codé en dur.
 */
let dummyHash = null;
export async function dummyPasswordHash() {
  if (dummyHash !== null) return dummyHash;
  const row = await one('SELECT svalue FROM settings WHERE skey = ?', ['login_dummy_hash']);
  if (row !== null && String(row.svalue).startsWith('$')) return (dummyHash = String(row.svalue));
  const hash = await bcrypt.hash(crypto.randomBytes(16).toString('hex'), 10);
  try {
    await exec('INSERT INTO settings (skey, svalue) VALUES (?, ?)', ['login_dummy_hash', hash]);
  } catch (e) {
    if (!estViolationUnique(e)) throw e;
  }
  return (dummyHash = hash);
}

/**
 * Code « accès supérieur » (espace patron) : PIN distinct du code de connexion, haché dans SUPER_CODE_HASH.
 * Un échec répond 403 (jamais 401) pour ne jamais déclencher la déconnexion du commerçant déjà identifié.
 * Verrou par IP, comme owner_login : 5 tentatives / 15 min.
 */
export async function requireSuperCode(c, code) {
  const hash = process.env.SUPER_CODE_HASH;
  if (!hash) throw Object.assign(new Error('SUPER_CODE_HASH absente'), { code: 'CONFIG_CODE' });

  const bucket = 'owner_super:ip:' + throttleIpKey(c.ip);
  await throttleEnforce(bucket, 5, 900, 900);

  const valid = typeof code === 'string' && code !== '' && Buffer.byteLength(code) <= 4096
    && (await bcrypt.compare(entreeBcrypt(code), hash));
  if (!valid) fail(403, 'invalid_super_code', 'Code incorrect.');

  await throttleRefund(bucket, 5);
}

export async function revokeSession(id) {
  await exec('UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL', [nowUtc(), id]);
}

/** Propriétaire connecté, sinon 403 (session client) ou 401. Renvoie [session, owner]. */
export async function requireOwner(c) {
  const s = await currentSession(c, 'owner');
  if (s !== null && Number(s.user_id) === OWNER_ID) return [s, { id: OWNER_ID }];
  if ((await currentSession(c, 'customer')) !== null) fail(403, 'forbidden', 'Accès réservé au commerçant.');
  fail(401, 'unauthorized', 'Connexion requise.');
}

/** Client connecté, sinon 403 (session propriétaire seule) ou 401. Renvoie [session, customer]. */
export async function requireCustomer(c) {
  const r = await optionalCustomer(c);
  if (r !== null) return r;
  if ((await currentSession(c, 'owner')) !== null) fail(403, 'forbidden', 'Accès réservé aux clients.');
  fail(401, 'unauthorized', 'Connexion requise.');
}

export async function optionalCustomer(c) {
  const s = await currentSession(c, 'customer');
  if (s === null) return null;
  const cust = await one('SELECT * FROM customers WHERE id = ?', [Number(s.user_id)]);
  return cust === null ? null : [s, cust];
}
