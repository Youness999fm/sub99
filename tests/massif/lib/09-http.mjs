// HTTP brut pour la batterie 09 : requêtes node:http maîtrisées au octet près (en-têtes absents ou faux, corps en morceaux,
// méthodes inhabituelles), une adresse IP simulée neuve par requête (la limitation de débit est par adresse), mesures de durée,
// et vérification systématique de chaque réponse (JSON propre, pas de 5xx, pas de fuite d'information interne).
// Robustesse du client : la machine de test est partagée par de nombreux scripts (ports éphémères Windows épuisés par moments,
// connexions persistantes coupées par le serveur après un refus anticipé) : les échecs de CONNEXION (jamais une réponse du serveur)
// sont rejoués avec une courte attente, et comptés (stats.reessais).
import http from 'node:http';
import { ipFictive } from './clients.mjs';

let cible = { port: 0, origine: '' };
export function viser({ port, origine }) { cible = { port, origine }; }

let ipCompteur = 600000;
/** Adresse IPv4 fictive jamais utilisée par une autre requête de cette batterie. */
export const ipNeuve = () => ipFictive(++ipCompteur);

export const stats = { requetes: 0, parStatut: new Map(), cinqCents: 0, reseau: 0, reessais: 0, ms: [], plusLente: { ms: 0, desc: '' } };

const agentPartage = new http.Agent({ keepAlive: true, maxSockets: 4 });
const UA = 'Mozilla/5.0 (Linux; Android 14) Chrome/130.0 Mobile Safari/537.36';
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

/** Une tentative. Renvoie { status, entetes, texte, json, erreur, reutilise }. */
function tentative({ methode, chemin, entetes, corps, morceaux, ip, cookie, origine, sansAgent, delai }) {
  return new Promise((resolve) => {
    const h = { 'user-agent': UA, 'x-subito-test-ip': ip };
    if (cookie) h.cookie = cookie;
    if (origine === undefined) {
      if (methode !== 'GET' && methode !== 'HEAD') h.origin = cible.origine;
    } else if (origine !== null) h.origin = origine;
    const aCorps = corps !== undefined || morceaux !== undefined;
    if (aCorps && !Object.keys(entetes).some((k) => k.toLowerCase() === 'content-type')) h['content-type'] = 'application/json';
    for (const [k, v] of Object.entries(entetes)) {
      if (v === null) delete h[k.toLowerCase()]; else h[k.toLowerCase()] = v;
    }
    let fini = false;
    let reutilise = false;
    const finir = (r) => { if (!fini) { fini = true; resolve({ reutilise, ...r }); } };
    let req;
    try {
      req = http.request({ host: '127.0.0.1', port: cible.port, method: methode, path: chemin, headers: h, agent: sansAgent ? false : agentPartage }, (res) => {
        const parts = [];
        res.on('data', (d) => parts.push(d));
        res.on('end', () => {
          const texte = Buffer.concat(parts).toString('utf8');
          let json = null;
          try { json = JSON.parse(texte); } catch { /* corps non JSON : contrôlé plus bas */ }
          finir({ status: res.statusCode, entetes: res.headers, texte, json, erreur: null });
        });
        res.on('error', (e) => finir({ status: 0, entetes: {}, texte: '', json: null, erreur: e.code || e.message, recu: true }));
      });
    } catch (e) {
      finir({ status: 0, entetes: {}, texte: '', json: null, erreur: e.code || e.message, local: true });
      return;
    }
    req.on('socket', () => { reutilise = req.reusedSocket === true; });
    req.on('error', (e) => finir({ status: 0, entetes: {}, texte: '', json: null, erreur: e.code || e.message }));
    req.setTimeout(delai, () => req.destroy(Object.assign(new Error('délai dépassé'), { code: 'DELAI' })));
    if (morceaux) {
      (async () => {
        try {
          for (const m of morceaux) { if (!req.write(m)) await new Promise((r) => req.once('drain', r)); }
          req.end();
        } catch { /* la connexion a été coupée : l'erreur est déjà rapportée par req.on('error') */ }
      })();
    } else if (aCorps) req.end(typeof corps === 'string' ? Buffer.from(corps, 'utf8') : corps);
    else req.end();
  });
}

const CONNEXION_TRANSITOIRE = new Set(['EADDRINUSE', 'EADDRNOTAVAIL', 'EMFILE', 'ENOBUFS', 'ECONNREFUSED']);

/**
 * Une requête. Options : methode, chemin, entetes ({ 'Nom': valeur | null pour retirer }), corps (chaîne | Buffer),
 * morceaux (tableau de Buffer : transfert en morceaux, sans Content-Length), ip, cookie, origine (undefined = Origin du site
 * sur les requêtes qui modifient ; null = pas d'Origin ; chaîne = valeur imposée), sansAgent (connexion à part), delai (ms).
 * Renvoie { status, entetes, texte, json, ms, erreur }.
 */
export async function requete({ methode = 'POST', chemin, entetes = {}, corps, morceaux, ip, cookie, origine, sansAgent = false, delai = 40000 } = {}) {
  const debut = performance.now();
  const adresse = ip || ipNeuve();
  let r;
  for (let essai = 0; ; essai++) {
    r = await tentative({ methode, chemin, entetes, corps, morceaux, ip: adresse, cookie, origine, sansAgent, delai });
    if (r.status !== 0 || essai >= 6) break;
    const transitoire = CONNEXION_TRANSITOIRE.has(r.erreur) || (r.erreur === 'ECONNRESET' && r.reutilise && !r.recu);
    if (!transitoire) break;
    stats.reessais++;
    await attendre(r.erreur === 'ECONNRESET' ? 0 : Math.min(2000, 100 * 2 ** essai));
  }
  r.ms = performance.now() - debut;
  stats.requetes++;
  stats.ms.push(r.ms);
  stats.parStatut.set(r.status, (stats.parStatut.get(r.status) || 0) + 1);
  if (r.status >= 500) stats.cinqCents++;
  if (r.status === 0) stats.reseau++;
  if (r.ms > stats.plusLente.ms) stats.plusLente = { ms: r.ms, desc: `${methode} ${chemin}` };
  return r;
}

const cheminApi = (route, query) => '/api/' + route + '.php' + (query ? '?' + query : '');

/** POST d'un objet JSON. */
export const api = (route, objet, opts = {}) => requete({ chemin: cheminApi(route), corps: JSON.stringify(objet), ...opts });
/** POST d'un corps brut (chaîne ou Buffer), tel quel. */
export const apiBrut = (route, brut, opts = {}) => requete({ chemin: cheminApi(route), corps: brut, ...opts });
/** GET. */
export const apiGet = (route, opts = {}) => requete({ methode: 'GET', chemin: cheminApi(route, opts.query), ...opts });

const MOTIFS_FUITE_TEXTE = [
  [/\$2[aby]\$\d\d\$[./A-Za-z0-9]{20,}/, 'empreinte bcrypt'],
  [/\n\s+at\s+\S+\s+\(.*:\d+:\d+\)/, 'trace d\'appel'],
  [/[A-Za-z]:\\\\|[A-Za-z]:\\[A-Za-z]|node_modules|\/serveur\/|\.mjs\b/, 'chemin de fichier'],
  [/postgres|pglite|sqlstate|syntax error at or near|invalid byte sequence|relation "|violates|duplicate key|pg_catalog/i, 'message de base de données']
];
const MOTIF_SQL_MESSAGE = /\b(select|insert\s+into|update\s+\S+\s+set|delete\s+from|drop\s+table)\b/i;

/** Liste des anomalies d'une réponse (vide = propre). */
export function problemes(r, { json = true } = {}) {
  const p = [];
  if (r.erreur) return ['erreur réseau : ' + r.erreur];
  if (r.status >= 500) p.push('statut ' + r.status);
  if (json) {
    const ct = String(r.entetes['content-type'] || '');
    if (!/^application\/json\b/i.test(ct)) p.push('content-type « ' + ct + ' »');
    if (r.json === null || typeof r.json !== 'object') p.push('corps non JSON');
    else if (r.status >= 400) {
      if (r.json.ok !== false) p.push('ok != false');
      if (typeof r.json.error !== 'string' || r.json.error === '') p.push('error absent');
      if (typeof r.json.message !== 'string' || r.json.message === '') p.push('message absent');
    }
    if (String(r.entetes['x-content-type-options'] || '').toLowerCase() !== 'nosniff') p.push('X-Content-Type-Options absent');
    if (!/no-store/i.test(String(r.entetes['cache-control'] || ''))) p.push('Cache-Control sans no-store');
  }
  if (r.json && typeof r.json === 'object') {
    // La saisie renvoyée telle quelle (nom d'article refusé…) n'est pas une fuite : elle est retirée avant l'analyse.
    const copie = { ...r.json };
    delete copie.name; delete copie.unavailable; delete copie.unavailable_ingredients;
    const texte = JSON.stringify(copie);
    for (const [re, nom] of MOTIFS_FUITE_TEXTE) if (re.test(texte)) p.push('fuite : ' + nom);
    const messages = [r.json.error, r.json.message, ...(r.json.fields && typeof r.json.fields === 'object' ? Object.values(r.json.fields) : [])]
      .filter((x) => typeof x === 'string').join(' | ');
    if (MOTIF_SQL_MESSAGE.test(messages)) p.push('fuite : SQL dans un message');
  }
  return p;
}

/** Mesures de durée des requêtes de la batterie. */
export function mesures() {
  const t = [...stats.ms].sort((a, b) => a - b);
  const q = (x) => (t.length ? t[Math.min(t.length - 1, Math.floor(t.length * x))] : 0);
  return {
    requetes: stats.requetes, cinqCents: stats.cinqCents, reseau: stats.reseau, reessais: stats.reessais,
    p50: Math.round(q(0.5)), p95: Math.round(q(0.95)), max: Math.round(t.length ? t[t.length - 1] : 0), plusLente: stats.plusLente.desc,
    statuts: Object.fromEntries([...stats.parStatut.entries()].sort((a, b) => a[0] - b[0]))
  };
}
