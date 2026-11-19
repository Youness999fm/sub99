// Aides de la batterie 07 (sécurité : accès, sessions, cookies, origine, méthodes, fuites).
// Rien ici ne touche le produit : uniquement des clients HTTP (fetch, node:http, socket TCP), un bilan PASS/FAIL
// et des détecteurs de fuite appliqués à TOUTES les réponses reçues.
import http from 'node:http';
import net from 'node:net';
import { PORT, ORIGIN, reponses } from './env.mjs';
import { ipFictive } from './clients.mjs';
import { secretScanText } from '../../api-vercel/lib/harness.mjs';

export const UA = 'Mozilla/5.0 (Linux; Android 14) Chrome/130.0 Mobile Safari/537.36';
export const HOTE = `127.0.0.1:${PORT}`;
export const BASE_API = `http://${HOTE}/api/`;
export const ORIGINE_OK = ORIGIN; // http://localhost:PORT (dans APP_ORIGINS du site de test)

// ------------------------------------------------------------------ bilan
export const bilan = { pass: 0, fail: 0, echecs: [], requetes: 0, tcp: 0, reconnexions: 0 };

// ------------------------------------------------------------------ robustesse de l'environnement de test
// La machine de test partage ses ports éphémères entre de nombreuses batteries : il arrive que connect() échoue
// (EADDRINUSE, EADDRNOTAVAIL) avant même que la requête soit envoyée. On réessaie alors (aucun risque de doublon :
// rien n'a été émis). Les autres erreurs réseau sont rendues telles quelles. S'applique aussi aux clients du harnais.
const CODES_CONNEXION = new Set(['EADDRINUSE', 'EADDRNOTAVAIL', 'ENOBUFS']);
const fetchOriginal = globalThis.fetch;
globalThis.fetch = async function fetchTolerant(...args) {
  for (let essai = 0; ; essai++) {
    try {
      return await fetchOriginal(...args);
    } catch (e) {
      const code = e && e.cause && e.cause.code;
      if (essai < 80 && CODES_CONNEXION.has(code)) { bilan.reconnexions++; await new Promise((r) => setTimeout(r, 150 + Math.min(essai, 20) * 25)); continue; }
      throw e;
    }
  }
};

/** Une ligne PASS ou FAIL par contrôle, avec la valeur observée. */
export function controle(nom, ok, observe = '') {
  const o = court(observe, 420); // une seule ligne : le lanceur groupé compte les lignes commençant par PASS / FAIL
  if (ok) {
    bilan.pass++;
    console.log(`PASS ${nom}${o !== '' ? ' | ' + o : ''}`);
  } else {
    bilan.fail++;
    bilan.echecs.push(nom);
    console.log(`FAIL ${nom} | observé : ${o}`);
  }
  return ok;
}
export const info = (texte) => console.log('INFO ' + court(texte, 600));
export const section = (titre) => console.log(`\n== ${titre} ==`);
export function court(s, n = 160) { const t = String(s).replace(/\s+/g, ' '); return t.length > n ? t.slice(0, n) + '…' : t; }
export const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------ adresses IP simulées
let nIp = 0;
/** Adresse fictive neuve (10.30.x.x) : chaque sonde a son propre seau de limitation de débit. */
export const ipSonde = () => ipFictive(2_000_000 + (++nIp));

// ------------------------------------------------------------------ réponses normalisées
function normaliser(status, headers, text, route, methode) {
  let json = null;
  try { json = JSON.parse(text); } catch { /* pas du JSON */ }
  const r = {
    status, headers, text, json, route, method: methode,
    setCookies: headers.getSetCookie ? headers.getSetCookie() : []
  };
  reponses.push(r);
  bilan.requetes++;
  return r;
}

/** Requête fetch sur /api/<route> avec cookie, origine et adresse IP choisis (origin: undefined = origine valide sur les écritures, null = aucun en-tête). */
export async function appel(methode, route, { cookie = '', origin = undefined, headers = {}, corps = undefined, brut = undefined, contentType = undefined, ip = undefined, timeout = 20000 } = {}) {
  const h = { 'User-Agent': UA, 'x-subito-test-ip': ip || ipSonde(), ...headers };
  if (cookie !== '') h.Cookie = cookie;
  if (origin === undefined) {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(methode)) h.Origin = ORIGINE_OK;
  } else if (origin !== null) {
    h.Origin = origin;
  }
  let charge;
  if (brut !== undefined) charge = brut;
  else if (corps !== undefined) charge = JSON.stringify(corps);
  if (charge !== undefined && !Object.keys(h).some((k) => k.toLowerCase() === 'content-type')) h['Content-Type'] = contentType || 'application/json';
  const res = await fetch(BASE_API + route, { method: methode, headers: h, body: charge, redirect: 'manual', signal: AbortSignal.timeout(timeout) });
  const text = await res.text();
  return normaliser(res.status, res.headers, text, route, methode);
}

/** Requête node:http avec chemin BRUT (« .. » et « %2e%2e » non normalisés), en-têtes répétables (valeur tableau). */
export async function http1(options) {
  for (let essai = 0; ; essai++) {
    const r = await http1Une(options);
    if (r.status === 0 && CODES_CONNEXION.has(r.erreur) && essai < 80) { bilan.reconnexions++; await attendre(150 + Math.min(essai, 20) * 25); continue; }
    return r;
  }
}

function http1Une({ methode = 'GET', chemin, entetes = {}, corps, timeout = 15000, ip = undefined, noter = true }) {
  return new Promise((resolve) => {
    const h = { 'user-agent': UA, 'x-subito-test-ip': ip || ipSonde(), ...entetes };
    if (h['x-subito-test-ip'] === null) delete h['x-subito-test-ip'];
    let req;
    try {
      req = http.request({ host: '127.0.0.1', port: PORT, method: methode, path: chemin, headers: h, agent: false }, (res) => {
        const morceaux = [];
        res.on('data', (d) => morceaux.push(d));
        res.on('end', () => {
          const text = Buffer.concat(morceaux).toString('utf8');
          const hs = new Headers();
          for (let i = 0; i < res.rawHeaders.length; i += 2) hs.append(res.rawHeaders[i], res.rawHeaders[i + 1]);
          let json = null;
          try { json = JSON.parse(text); } catch { /* pas du JSON */ }
          const r = { status: res.statusCode, headers: hs, text, json, route: chemin, method: methode, setCookies: hs.getSetCookie() };
          if (noter) { reponses.push(r); bilan.requetes++; }
          resolve(r);
        });
        res.on('error', (e) => resolve({ status: 0, erreur: e.code || e.message, headers: new Headers(), text: '', json: null, setCookies: [], route: chemin, method: methode }));
      });
    } catch (e) {
      resolve({ status: 0, erreur: e.code || e.message, headers: new Headers(), text: '', json: null, setCookies: [], route: chemin, method: methode });
      return;
    }
    req.setTimeout(timeout, () => req.destroy(new Error('délai dépassé')));
    req.on('error', (e) => resolve({ status: 0, erreur: e.code || e.message, headers: new Headers(), text: '', json: null, setCookies: [], route: chemin, method: methode }));
    if (corps !== undefined) req.write(corps);
    req.end();
  });
}

/** Octets bruts sur une socket TCP (NUL, octets hauts, méthode inconnue…). Renvoie { status, texte (latin1), raison }. */
export async function tcpBrut(octets, options = {}) {
  bilan.tcp++;
  for (let essai = 0; ; essai++) {
    const r = await tcpBrutUne(octets, options);
    if (r.status === 0 && /EADDRINUSE|EADDRNOTAVAIL|ENOBUFS/.test(r.raison) && essai < 80) { bilan.reconnexions++; await attendre(150 + Math.min(essai, 20) * 25); continue; }
    return r;
  }
}

function tcpBrutUne(octets, { timeout = 8000 } = {}) {
  return new Promise((resolve) => {
    const sock = net.connect({ host: '127.0.0.1', port: PORT });
    const morceaux = [];
    let fini = false;
    let minuteur = null;
    const clore = (raison) => {
      if (fini) return;
      fini = true;
      clearTimeout(minuteur);
      sock.destroy();
      const texte = Buffer.concat(morceaux).toString('latin1');
      const m = /^HTTP\/1\.[01] (\d{3})/.exec(texte);
      resolve({ status: m ? Number(m[1]) : 0, texte, raison });
    };
    sock.on('connect', () => sock.write(octets));
    sock.on('data', (d) => morceaux.push(d));
    sock.on('end', () => clore('fin'));
    sock.on('close', () => clore('fermée'));
    sock.on('error', (e) => clore('erreur ' + (e.code || e.message)));
    minuteur = setTimeout(() => clore('délai'), timeout);
  });
}

/** Requête HTTP/1.1 écrite à la main (chaîne ou Buffer pour le milieu), « Connection: close ». */
export function requeteBrute(ligneRequete, enteteLignes = [], { ip = ipSonde() } = {}) {
  const tete = Buffer.concat([
    Buffer.from(ligneRequete + `\r\nHost: ${HOTE}\r\nx-subito-test-ip: ${ip}\r\nConnection: close\r\n`, 'latin1'),
    ...enteteLignes.map((l) => (Buffer.isBuffer(l) ? Buffer.concat([l, Buffer.from('\r\n')]) : Buffer.from(l + '\r\n', 'latin1'))),
    Buffer.from('\r\n')
  ]);
  return tcpBrut(tete);
}

// ------------------------------------------------------------------ cookies
const BASE64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
/** Jeton fictif de 43 caractères (même forme qu'un vrai jeton), tiré d'un générateur à graine. */
export function jetonFictif(r) {
  let s = '';
  for (let i = 0; i < 43; i++) s += BASE64URL[Math.floor(r() * 64)];
  return s;
}
export const FORME_JETON = /^[A-Za-z0-9_-]{43}$/;

/** Analyse « nom=valeur; Attribut; Attribut=valeur ». */
export function analyserSetCookie(sc) {
  const [paire, ...attrs] = String(sc).split(';').map((s) => s.trim());
  const eq = paire.indexOf('=');
  const a = new Map();
  for (const x of attrs) {
    const i = x.indexOf('=');
    if (i < 0) a.set(x.toLowerCase(), true);
    else a.set(x.slice(0, i).toLowerCase(), x.slice(i + 1));
  }
  return { nom: paire.slice(0, eq), valeur: paire.slice(eq + 1), attrs: a, brut: String(sc) };
}

/**
 * Contrôle les attributs d'un Set-Cookie de session. attendu : { nom, sameSite, secure, persistant (true/false), efface, maintenant (epoch serveur, facultatif) }.
 * Renvoie la liste des problèmes (vide si tout est conforme).
 */
export function problemesCookie(sc, attendu) {
  const p = [];
  const c = analyserSetCookie(sc);
  if (c.nom !== attendu.nom) p.push(`nom ${c.nom} ≠ ${attendu.nom}`);
  if (attendu.efface) {
    if (c.valeur !== '') p.push('valeur non vide pour un cookie effacé');
    if (String(c.attrs.get('max-age')) !== '0') p.push('Max-Age ≠ 0 : ' + c.attrs.get('max-age'));
    const exp = Date.parse(String(c.attrs.get('expires') || ''));
    if (!(exp < Date.now())) p.push('Expires pas dans le passé : ' + c.attrs.get('expires'));
  } else {
    if (!FORME_JETON.test(c.valeur)) p.push('valeur de forme inattendue (' + c.valeur.length + ' car.)');
    if (attendu.persistant) {
      if (String(c.attrs.get('max-age')) !== '2592000') p.push('Max-Age ≠ 2592000 : ' + c.attrs.get('max-age'));
      const exp = Date.parse(String(c.attrs.get('expires') || ''));
      if (!(exp > Date.now())) p.push('Expires invalide : ' + c.attrs.get('expires'));
      if (attendu.maintenant !== undefined && Math.abs(exp / 1000 - (attendu.maintenant + 2592000)) > 1) p.push(`Expires ${c.attrs.get('expires')} ≠ maintenant + 30 j`);
    } else if (c.attrs.has('max-age') || c.attrs.has('expires')) {
      p.push('cookie de session attendu (ni Max-Age ni Expires) : ' + c.brut);
    }
  }
  if (c.attrs.get('path') !== '/api/') p.push('Path ≠ /api/ : ' + c.attrs.get('path'));
  if (!c.attrs.has('httponly')) p.push('HttpOnly absent');
  if (String(c.attrs.get('samesite')).toLowerCase() !== attendu.sameSite.toLowerCase()) p.push(`SameSite ${c.attrs.get('samesite')} ≠ ${attendu.sameSite}`);
  if (c.attrs.has('secure') !== attendu.secure) p.push(`Secure ${c.attrs.has('secure') ? 'présent' : 'absent'} (attendu : ${attendu.secure ? 'présent' : 'absent'})`);
  if (c.attrs.has('domain')) p.push('attribut Domain présent (le cookie doit rester propre à l\'hôte)');
  return p;
}

// ------------------------------------------------------------------ détecteurs de fuite
/** Motifs qui ne doivent apparaître dans AUCUN corps de réponse. */
export const MOTIFS_FUITE = [
  ['hash bcrypt', /\$2[abxy]?\$\d{2}\$[./A-Za-z0-9]{40,}/],
  ['empreinte sha-256 (64 hex)', /\b[0-9a-f]{64}\b/i],
  ['trace de pile', /\n\s+at\s+\S|\bat\s+(?:async\s+)?[\w$.<>[\]]+\s*\((?:file:|node:|[A-Za-z]:[\\/]|\/)|node:internal|\.m?js:\d+:\d+|[\\/]node_modules[\\/]/],
  ['nom d\'erreur JavaScript', /\b(?:TypeError|ReferenceError|SyntaxError|RangeError|EvalError|URIError|AggregateError)\b|\bError:/],
  ['SQL', /\b(?:SELECT\s+[\w*"]|INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|CREATE\s+TABLE|ALTER\s+TABLE|DROP\s+TABLE|WHERE\s+\w|ORDER\s+BY|VALUES\s*\()/i],
  ['message de base de données', /syntax error at|relation "|column "|violates|duplicate key|invalid byte sequence|pg_catalog|SQLSTATE|\bpglite\b|\bpostgres(?:ql)?\b|\bsupabase\b/i],
  ['paramètre SQL ($1)', /\$\d+\b/],
  ['chemin de fichier', /[A-Za-z]:[\\/](?:Users|Windows|Program|Desktop)|[\\/]Users[\\/]|[\\/](?:home|var|opt|usr|tmp|srv|app|vercel|task)[\\/]|\bserveur[\\/]|\bsub99\b|\.(?:mjs|cjs|js|ts|php)\b/i],
  ['numéro de version', /\bNode(?:\.js)?\s*v?\d+\.\d+|\bv\d+\.\d+\.\d+\b|\b(?:express|undici|llhttp|bcryptjs?|pglite)[ /@]v?\d/i]
];

/** En-têtes de réponse qui ne doivent pas exister (ou pas contenir de version). */
const ENTETES_INTERDITS = ['x-powered-by', 'server', 'via', 'x-runtime', 'x-aspnet-version'];

/** Problèmes d'une réponse : fuites de secrets (connus ou par motif), en-têtes révélateurs, CORS ouvert. */
export function problemesFuite(r, secretsConnus = []) {
  const p = [];
  const corps = secretScanText(r);
  for (const [nom, re] of MOTIFS_FUITE) {
    const m = re.exec(corps);
    if (m) p.push(`${nom} : « ${court(m[0], 60)} »`);
  }
  const bas = corps.toLowerCase();
  for (const mot of ['password', 'token']) if (bas.includes(mot)) p.push(`mot « ${mot} » dans le corps`);
  for (const s of secretsConnus) if (s && corps.includes(s)) p.push(`secret connu dans le corps : ${court(s, 12)}…`);
  for (const nom of ENTETES_INTERDITS) {
    const v = r.headers.get(nom);
    if (v !== null && v !== undefined) p.push(`en-tête ${nom}: ${court(v, 40)}`);
  }
  for (const [nom] of r.headers) if (nom.toLowerCase().startsWith('access-control-')) p.push(`en-tête CORS ${nom}`);
  return p;
}

/** Cookie de session (partie « nom=valeur ») d'une liste de Set-Cookie, ou null. */
export function jetonDeSetCookie(setCookies, nom) {
  for (const sc of setCookies) {
    const c = analyserSetCookie(sc);
    if (c.nom === nom && c.valeur !== '') return c.valeur;
  }
  return null;
}

/** Corps JSON d'erreur canonique du produit : { ok:false, error, message }. */
export const estErreur = (r, status, code) => r.status === status && r.json !== null && r.json.ok === false && r.json.error === code && typeof r.json.message === 'string';
