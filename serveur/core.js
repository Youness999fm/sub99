// Réponses JSON, erreurs d'API, corps de requête, cookies, adresse du client (port de api/lib/http.php).
import net from 'node:net';
import { nowUtc } from './util.js';

export const MAX_BODY_BYTES = 65536;

/** Erreur d'API : convertie en réponse JSON { ok: false, error, message, ...extra } par le routeur. */
export class ApiError extends Error {
  constructor(status, code, message, extra = {}, headers = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
    this.headers = headers;
  }
}

/** Lève une erreur d'API (le traitement de la route s'arrête). */
export function fail(status, code, message, extra = {}, headers = {}) {
  throw new ApiError(status, code, message, extra, headers);
}

export function failValidation(fields) {
  fail(422, 'validation', 'Certains champs sont invalides.', { fields });
}

/** Réponse de succès : { ok: true, ...data }. À renvoyer par la route : return ok({...}). */
export function ok(data = {}, status = 200) {
  return { status, body: Object.assign({ ok: true }, data, { ok: true }) };
}

export function routeName(c) {
  return c && c.route ? c.route + '.php' : '?';
}

/** Journal sans donnée personnelle : route, code, horodatage. */
export function logEvent(c, code, status) {
  if (status >= 500 || ['too_many_attempts', 'bad_origin', 'invalid_credentials'].includes(code)) {
    console.error('[subito-api] ' + nowUtc() + ' ' + routeName(c) + ' ' + status + ' ' + code);
  }
}

function parserCookies(entete) {
  const jar = {};
  for (const part of String(entete || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) {
      const nom = part.slice(0, i).trim();
      if (!(nom in jar)) jar[nom] = part.slice(i + 1).trim();
    }
  }
  return jar;
}

/**
 * Adresse du client. Derrière Vercel : en-têtes posés (et réécrits) par la plateforme ; ailleurs, et en mode test :
 * l'adresse de la connexion (ces en-têtes pourraient alors être fournis par le client).
 */
function adresseClient(req) {
  let ip = '';
  const h = req.headers || {};
  if (process.env.SUBITO_TEST_MODE !== '1' && (process.env.VERCEL || h['x-vercel-forwarded-for'])) {
    ip = String(h['x-vercel-forwarded-for'] || h['x-real-ip'] || String(h['x-forwarded-for'] || '').split(',')[0] || '').trim();
  } else if (process.env.SUBITO_TEST_MODE === '1' && !process.env.VERCEL && net.isIP(String(h['x-subito-test-ip'] || ''))) {
    // Tests uniquement : simule des clients d'adresses différentes depuis un seul poste.
    ip = String(h['x-subito-test-ip']);
  }
  if (!ip) ip = (req.socket && req.socket.remoteAddress) || '';
  return net.isIP(ip) ? ip : 'unknown';
}

/** Contexte d'une requête, passé à la route. */
export function creerContexte(req) {
  const url = new URL(req.url || '/', 'http://localhost');
  return {
    req,
    method: String(req.method || 'GET').toUpperCase(),
    headers: req.headers || {},
    url,
    query: url.searchParams,
    cookies: parserCookies((req.headers || {}).cookie),
    ip: adresseClient(req),
    route: '',
    setCookies: [],
    responseHeaders: {},
    sessions: {}
  };
}

/** Méthodes acceptées, sinon 405. Renvoie la méthode. */
export function allowMethods(c, methods) {
  if (!methods.includes(c.method)) {
    fail(405, 'method_not_allowed', 'Méthode non autorisée.', {}, { Allow: methods.join(', ') });
  }
  return c.method;
}

async function lireFlux(req, max) {
  const morceaux = [];
  let total = 0;
  for await (const m of req) {
    total += m.length;
    if (total > max) return null;
    morceaux.push(m);
  }
  return Buffer.concat(morceaux).toString('utf8');
}

function profondeur(v, n = 0) {
  if (n > 32) return n;
  if (v !== null && typeof v === 'object') {
    let max = n + 1;
    for (const x of Object.values(v)) max = Math.max(max, profondeur(x, n + 1));
    return max;
  }
  return n;
}

/** Corps JSON d'une requête POST : objet uniquement, 64 Ko au plus. */
export async function readJsonBody(c) {
  const ct = String(c.headers['content-type'] || '');
  const media = ct.split(';')[0].trim().toLowerCase();
  if (media !== 'application/json') fail(415, 'unsupported_media_type', 'Format de requête non pris en charge.');
  const len = c.headers['content-length'];
  if (len !== undefined && len !== '' && (!/^\d+$/.test(String(len)) || Number(len) > MAX_BODY_BYTES)) {
    fail(413, 'payload_too_large', 'Requête trop volumineuse.');
  }
  let brut;
  const deja = c.req.body;
  if (deja !== undefined && deja !== null) {
    // Corps déjà lu par la plateforme (Vercel analyse le JSON).
    brut = Buffer.isBuffer(deja) ? deja.toString('utf8') : (typeof deja === 'string' ? deja : JSON.stringify(deja));
  } else {
    brut = await lireFlux(c.req, MAX_BODY_BYTES);
    if (brut === null) fail(413, 'payload_too_large', 'Requête trop volumineuse.');
  }
  if (Buffer.byteLength(brut) > MAX_BODY_BYTES) fail(413, 'payload_too_large', 'Requête trop volumineuse.');
  const nettoye = brut.replace(/^\s+/, '');
  if (nettoye === '' || nettoye[0] !== '{') fail(400, 'bad_request', 'Requête illisible.');
  let data;
  try { data = JSON.parse(brut); } catch { fail(400, 'bad_request', 'Requête illisible.'); }
  if (data === null || typeof data !== 'object' || Array.isArray(data) || profondeur(data) > 32) {
    fail(400, 'bad_request', 'Requête illisible.');
  }
  return data;
}

export function bodyBool(b, k) {
  return b[k] === true;
}

export function bodyStr(b, k) {
  return typeof b[k] === 'string' ? b[k] : '';
}

const MOIS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const JOURS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const p2 = (n) => String(n).padStart(2, '0');

function dateHttp(epoch) {
  const d = new Date(epoch * 1000);
  return JOURS[d.getUTCDay()] + ', ' + p2(d.getUTCDate()) + ' ' + MOIS[d.getUTCMonth()] + ' ' + d.getUTCFullYear()
    + ' ' + p2(d.getUTCHours()) + ':' + p2(d.getUTCMinutes()) + ':' + p2(d.getUTCSeconds()) + ' GMT';
}

/** Cookie : expires = époque (0 = cookie de session), tous attributs de sécurité posés. */
export function setCookie(c, nom, valeur, { expires = 0, path = '/api/', sameSite = 'Strict', maintenant = 0 } = {}) {
  const securise = process.env.SUBITO_COOKIE_SECURE !== '0';
  let s = nom + '=' + valeur;
  if (expires > 0) {
    s += '; Expires=' + dateHttp(expires);
    s += '; Max-Age=' + Math.max(0, expires - maintenant);
  }
  s += '; Path=' + path;
  if (securise) s += '; Secure';
  s += '; HttpOnly; SameSite=' + sameSite;
  c.setCookies.push(s);
}
