// Routeur unique : /api/<nom>.php (ou /api/<nom>) -> serveur/routes/<nom>.js.
// Une seule fonction Vercel (api/[...route].js) sert toutes les routes ; les anciennes adresses en .php du site
// restent valides grâce aux réécritures de vercel.json.
import { ApiError, creerContexte, fail, logEvent } from './core.js';
import { ROUTES } from './routes.js';

/**
 * Origines autorisées : APP_ORIGINS (liste séparée par des virgules) + l'adresse du site elle-même (https).
 * Une requête venue d'un autre site porte une origine différente de l'hôte demandé : elle reste refusée.
 */
function originesAutorisees(c) {
  const liste = String(process.env.APP_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const hote = String(c.headers['x-forwarded-host'] || c.headers.host || '').split(',')[0].trim();
  if (hote) liste.push('https://' + hote);
  return liste;
}

function verifierOrigine(c) {
  if (c.headers.origin !== undefined && !originesAutorisees(c).includes(String(c.headers.origin))) {
    fail(403, 'bad_origin', 'Origine non autorisée.');
  }
}

function envoyer(res, c, status, body, entetes = {}) {
  const json = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  for (const [nom, valeur] of Object.entries({ ...c.responseHeaders, ...entetes })) res.setHeader(nom, valeur);
  if (c.setCookies.length) res.setHeader('Set-Cookie', c.setCookies);
  res.end(json);
}

function nomDeRoute(req) {
  const chemin = new URL(req.url || '/', 'http://localhost').pathname;
  const segments = chemin.split('/').filter(Boolean);
  // Seul /api/<nom> ou /api/<nom>.php est une route : un chemin plus profond ou résolu ailleurs
  // (ex. /api/x/y/z/<nom>, /api/../<nom>.php) ne doit pas atteindre silencieusement la même route.
  if (segments.length !== 2 || segments[0] !== 'api') return '';
  return segments[1].replace(/\.php$/, '');
}

/** Point d'entrée commun : (req, res) de Node / Vercel. */
export async function traiter(req, res) {
  const c = creerContexte(req);
  try {
    verifierOrigine(c);
    const nom = nomDeRoute(req);
    if (!/^[a-z_]+$/.test(nom) || !Object.hasOwn(ROUTES, nom)) {
      fail(404, 'not_found', 'Route inconnue.');
    }
    c.route = nom;
    const r = await ROUTES[nom](c);
    envoyer(res, c, r.status, r.body);
  } catch (e) {
    if (e instanceof ApiError) {
      logEvent(c, e.code, e.status);
      c.setCookies = c.setCookies.slice();
      envoyer(res, c, e.status, Object.assign({ ok: false, error: e.code, message: e.message }, e.extra), e.headers);
      return;
    }
    // Pas de message d'erreur (il peut contenir une valeur saisie) : classe et code SQL seulement.
    console.error('[subito-api] ' + (c.route || '?') + '.php 500 server_error ' + (e && e.constructor ? e.constructor.name : 'Erreur') + ' ' + (e && e.code ? 'code ' + String(e.code) : ''));
    envoyer(res, c, 500, { ok: false, error: 'server_error', message: 'Erreur interne. Réessayez dans un instant.' });
  }
}
