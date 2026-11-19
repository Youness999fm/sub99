// Aides de la batterie 12 (charge soutenue) : mesures de latence par route, sonde du processus (mémoire, boucle d'événements).
// Rien ici ne touche au produit : le collecteur s'accroche au prototype de ClientIP DANS le processus du script seulement.
import http from 'node:http';
import { performance, monitorEventLoopDelay } from 'node:perf_hooks';
import v8 from 'node:v8';
import vm from 'node:vm';
import { viderReponses } from './env.mjs';

/** Percentile (rang le plus proche) d'un tableau déjà trié par ordre croissant. */
export function percentile(tri, p) {
  if (!tri.length) return NaN;
  const rang = Math.max(1, Math.ceil((p / 100) * tri.length));
  return tri[Math.min(tri.length, rang) - 1];
}

/** « order_status.php?id=3 » -> « order_status ». */
export const nomRoute = (route) => String(route).split('?')[0].replace(/\.php$/, '');

export const arrondi = (x, d = 1) => (Number.isFinite(x) ? Math.round(x * 10 ** d) / 10 ** d : x);
export const mo = (octets) => arrondi(octets / 1048576, 1);

/**
 * Collecteur de mesures : une ligne par requête (route, durée client en ms, statut HTTP, taille de la réponse, phase).
 * statut 0 = erreur réseau (fetch rejeté) : jamais un statut du produit.
 */
export class Collecteur {
  constructor() {
    this.echantillons = [];
    this.phase = 'hors-phase';
  }

  ajouter(route, duree, statut, octets = 0, reessais = 0) {
    this.echantillons.push({ route: nomRoute(route), ms: duree, statut, octets, reessais, phase: this.phase });
  }

  filtrer({ phase = null, route = null } = {}) {
    return this.echantillons.filter((x) => (phase === null || x.phase === phase) && (route === null || x.route === route));
  }

  /** Statistiques d'une liste d'échantillons. */
  static stats(liste) {
    const tri = liste.map((x) => x.ms).sort((a, b) => a - b);
    const n = liste.length;
    const somme = tri.reduce((s, x) => s + x, 0);
    return {
      n,
      ok2xx: liste.filter((x) => x.statut >= 200 && x.statut < 300).length,
      c4xx: liste.filter((x) => x.statut >= 400 && x.statut < 500).length,
      c5xx: liste.filter((x) => x.statut >= 500).length,
      reseau: liste.filter((x) => x.statut === 0).length,
      reessayees: liste.filter((x) => x.reessais > 0).length,
      p50: percentile(tri, 50),
      p95: percentile(tri, 95),
      p99: percentile(tri, 99),
      max: n ? tri[n - 1] : NaN,
      moy: n ? somme / n : NaN,
      octetsMax: liste.reduce((m, x) => Math.max(m, x.octets), 0)
    };
  }

  stat(filtre) {
    return Collecteur.stats(this.filtrer(filtre));
  }

  /** Routes présentes (triées par nombre de requêtes décroissant). */
  routes(filtre = {}) {
    const compte = new Map();
    for (const x of this.filtrer(filtre)) compte.set(x.route, (compte.get(x.route) || 0) + 1);
    return [...compte.entries()].sort((a, b) => b[1] - a[1]).map(([r]) => r);
  }

  /** Tableau texte : une ligne par route + une ligne TOTAL. */
  tableau(titre, filtre = {}) {
    const col = (v, l) => String(v).padStart(l);
    const ent = ['route'.padEnd(26), col('n', 6), col('2xx', 6), col('4xx', 5), col('5xx', 5), col('rés.', 5), col('réess.', 6),
      col('p50', 8), col('p95', 8), col('p99', 8), col('max', 8), col('moy', 8), col('Ko max', 8)].join(' ');
    const lignes = [`${titre}`, ent, '-'.repeat(ent.length)];
    const fmt = (s, nom) => [nom.padEnd(26), col(s.n, 6), col(s.ok2xx, 6), col(s.c4xx, 5), col(s.c5xx, 5), col(s.reseau, 5), col(s.reessayees, 6),
      col(arrondi(s.p50), 8), col(arrondi(s.p95), 8), col(arrondi(s.p99), 8), col(arrondi(s.max), 8), col(arrondi(s.moy), 8),
      col(arrondi(s.octetsMax / 1024, 0), 8)].join(' ');
    for (const r of this.routes(filtre)) lignes.push(fmt(this.stat({ ...filtre, route: r }), r));
    lignes.push('-'.repeat(ent.length), fmt(this.stat(filtre), 'TOTAL (ms ; Ko)'));
    return lignes.join('\n');
  }
}

/**
 * Erreurs de connexion LOCALES : la connexion TCP n'a jamais été établie, donc rien n'a été envoyé au serveur (aucun risque de
 * doublon, même pour un POST). Ce sont des limites du poste de test (Windows de bureau), pas des réponses du produit :
 *  - ECONNREFUSED : la file d'attente d'acceptation d'un serveur d'écoute est plafonnée à ~200 connexions sous Windows de bureau ;
 *    au-delà, le système refuse aussitôt (Linux met en attente et le client se reconnecte tout seul) ;
 *  - EADDRINUSE / EADDRNOTAVAIL : plus de port éphémère libre (16 384 ports partagés par tous les programmes de la machine,
 *    chaque connexion fermée en garde un ~2 min en TIME_WAIT) ;
 *  - UND_ERR_CONNECT_TIMEOUT : connexion non établie dans le délai.
 */
const ERREURS_CONNEXION_LOCALES = new Set(['ECONNREFUSED', 'EADDRINUSE', 'EADDRNOTAVAIL', 'UND_ERR_CONNECT_TIMEOUT']);

/**
 * Mesure chaque requête du prototype ClientIP (appels get / post compris) : la durée va de l'envoi à la lecture complète de la
 * réponse (reconnexions comprises). Une erreur réseau est comptée (statut 0) et renvoyée sous forme de réponse factice, jamais
 * levée : les scénarios (pages de suivi, patron) continuent comme un navigateur qui réessaie.
 * Une erreur de connexion locale (voir ci-dessus) est reprise jusqu'à `reessaisConnexion` fois (attente de 20 ms à 250 ms) et
 * comptée dans etat.parCode ; seules les requêtes qui épuisent leurs reprises ou échouent autrement comptent comme erreurs réseau.
 */
export function instrumenter(ClientIP, collecteur, { reessaisConnexion = 60 } = {}) {
  const originale = ClientIP.prototype.request;
  const etat = { refus: 0, abandons: 0, parCode: {}, restaurer: () => { ClientIP.prototype.request = originale; } };
  ClientIP.prototype.request = async function requeteMesuree(methode, route, opts) {
    const t0 = performance.now();
    let reessais = 0;
    for (;;) {
      try {
        const r = await originale.call(this, methode, route, opts);
        collecteur.ajouter(route, performance.now() - t0, r.status, r.text ? r.text.length : 0, reessais);
        return r;
      } catch (e) {
        const code = e && e.cause ? e.cause.code : undefined;
        if (ERREURS_CONNEXION_LOCALES.has(code)) {
          etat.parCode[code] = (etat.parCode[code] || 0) + 1;
          if (reessais < reessaisConnexion) {
            reessais++;
            etat.refus++;
            await new Promise((fin) => setTimeout(fin, Math.min(250, 20 * reessais) + (etat.refus % 25)));
            continue;
          }
          etat.abandons++;
        }
        collecteur.ajouter(route, performance.now() - t0, 0, 0, reessais);
        const cause = e && e.cause ? (e.cause.code || e.cause.message || String(e.cause)) : String(e && e.message ? e.message : e);
        return { status: 0, headers: new Headers(), text: '', json: null, setCookies: [], route, method: methode, erreurReseau: cause };
      }
    }
  };
  return etat;
}

/**
 * À appeler AVANT demarrerSite() : le serveur de test garde les connexions inactives `ms` millisecondes (5 s par défaut dans Node)
 * comme le font un navigateur ou un CDN. Sans cela, un sondage toutes les 4-5 s rouvrirait une connexion à chaque fois : des
 * milliers de connexions fermées en quelques minutes saturent les ports éphémères de Windows (partagés avec les autres batteries).
 * Ne change que le serveur de test de CE processus.
 */
export function prolongerKeepAliveServeur(ms = 65000) {
  const originale = http.createServer;
  http.createServer = function createServerKeepAlive(...args) {
    const s = originale.apply(this, args);
    s.keepAliveTimeout = ms;
    s.headersTimeout = ms + 5000;
    return s;
  };
  return () => { http.createServer = originale; };
}

/**
 * À appeler APRÈS demarrerSite() (le répartiteur HTTP global existe alors) : toutes les requêtes `fetch` de ce processus passent
 * par un répartiteur à connexions réutilisées, limité à `connexions` connexions TCP simultanées vers le serveur. Les requêtes
 * en excès attendent leur tour dans le client (comme dans un navigateur ou derrière un CDN) au lieu d'ouvrir mille connexions
 * que le poste de test ne sait pas accepter (voir ERREURS_CONNEXION_LOCALES).
 */
export function limiterConnexions(connexions = 128, ms = 65000) {
  const global = globalThis[Symbol.for('undici.globalDispatcher.1')];
  if (!global || typeof global.constructor !== 'function') throw new Error('Répartiteur HTTP global introuvable');
  const Agent = global.constructor;
  const agent = new Agent({ connections: connexions, keepAliveTimeout: ms, keepAliveMaxTimeout: 600000 });
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = (url, init = {}) => fetchOriginal(url, { dispatcher: agent, ...init });
  return { agent, connexions, restaurer: () => { globalThis.fetch = fetchOriginal; } };
}

/** Fonction gc() du moteur si on peut l'exposer à l'exécution (sinon null) : pour mesurer la mémoire utile après nettoyage. */
export function obtenirGc() {
  try {
    v8.setFlagsFromString('--expose-gc');
    const gc = vm.runInNewContext('gc');
    return typeof gc === 'function' ? gc : null;
  } catch {
    return null;
  }
}

const RESOLUTION_MS = 10;

/**
 * Sonde du processus : mémoire (rss, tas) échantillonnée toutes les 500 ms, retard de la boucle d'événements
 * (monitorEventLoopDelay, par phase), utilisation de la boucle. Vide aussi le tampon `reponses` du harnais
 * (il garderait toutes les réponses en mémoire et fausserait la mesure).
 */
export class Sonde {
  constructor() {
    this.serie = [];
    this.marques = [];
    this.h = null;
    this.timer = null;
    this.eluPrec = null;
    this.gc = obtenirGc();
  }

  demarrer() {
    this.h = monitorEventLoopDelay({ resolution: RESOLUTION_MS });
    this.h.enable();
    this.eluPrec = performance.eventLoopUtilization();
    this.timer = setInterval(() => {
      const m = process.memoryUsage();
      this.serie.push({ t: performance.now(), rss: m.rss, tas: m.heapUsed });
      viderReponses();
    }, 500);
    this.timer.unref();
  }

  arreter() {
    if (this.timer) clearInterval(this.timer);
    if (this.h) this.h.disable();
  }

  /** Instantané nommé (avec nettoyage mémoire préalable si demandé et possible). */
  marque(nom, { nettoyer = false } = {}) {
    if (nettoyer && this.gc) this.gc();
    const m = process.memoryUsage();
    const entree = { nom, t: performance.now(), rss: m.rss, tas: m.heapUsed, externe: m.external, tampons: m.arrayBuffers };
    this.marques.push(entree);
    return entree;
  }

  /** Maximum de rss observé entre deux instants (performance.now()). */
  rssMax(depuis = 0, jusqua = Infinity) {
    return this.serie.filter((x) => x.t >= depuis && x.t <= jusqua).reduce((m, x) => Math.max(m, x.rss), 0);
  }

  tasMax(depuis = 0, jusqua = Infinity) {
    return this.serie.filter((x) => x.t >= depuis && x.t <= jusqua).reduce((m, x) => Math.max(m, x.tas), 0);
  }

  /** Retard de la boucle depuis le dernier appel (valeurs en ms, valeur brute du moniteur : au repos ≈ une résolution de minuterie). */
  bouclePhase() {
    const h = this.h;
    const ms = (ns) => ns / 1e6;
    const elu = performance.eventLoopUtilization(this.eluPrec);
    this.eluPrec = performance.eventLoopUtilization();
    const r = {
      n: h.count,
      moy: ms(h.mean),
      p50: ms(h.percentile(50)),
      p99: ms(h.percentile(99)),
      max: ms(h.max),
      utilisation: elu.utilization
    };
    h.reset();
    return r;
  }
}
