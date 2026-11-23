// Dates, chaînes, constantes métier (port de api/lib/util.php).
import crypto from 'node:crypto';
import { maintenantEpoch } from './horloge.js';

export const DELAY_CHOICES = [10, 20, 30, 40, 50, 60];
// Valeur spéciale envoyée par le commerçant à la place d'un délai : le client est invité à venir
// tout de suite (ex. le restaurant va bientôt fermer). N'est jamais un délai par défaut.
export const DELAY_IMMEDIATE = 0;

/**
 * Texte transmis à bcrypt. bcrypt ne lit que les 72 premiers octets : au-delà, on passe d'abord par SHA-256
 * (64 caractères hexadécimaux), pour qu'aucune partie du mot de passe ou du code ne soit ignorée.
 * Sans effet pour les textes de 72 octets ou moins (les hachages déjà enregistrés restent valides).
 */
export function entreeBcrypt(texte) {
  return Buffer.byteLength(texte) > 72 ? crypto.createHash('sha256').update(texte).digest('hex') : texte;
}

/** Zones de livraison : identiques à DELIVERY_ZONES de assets/js/cart.js (montants en centimes). */
export const DELIVERY_ZONES = {
  'Hénin-Beaumont': { minimum_cents: 1000, fee_cents: 550 },
  'Montigny-en-Gohelle': { minimum_cents: 1500, fee_cents: 550 },
  'Dourges': { minimum_cents: 1500, fee_cents: 550 },
  'Noyelles-Godault': { minimum_cents: 1500, fee_cents: 550 },
  'Courrières': { minimum_cents: 2000, fee_cents: 800 },
  'Billy-Montigny': { minimum_cents: 2000, fee_cents: 800 },
  'Fouquières-lès-Lens': { minimum_cents: 2500, fee_cents: 800 },
  'Rouvroy': { minimum_cents: 2500, fee_cents: 800 }
};

export const FUSEAU = 'Europe/Paris';

/** « 2026-11-19T18:03:12Z » */
export function utcAt(epoch) {
  return new Date(epoch * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function nowUtc() {
  return utcAt(maintenantEpoch());
}

export function utcToEpoch(utc) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z$/.exec(String(utc));
  if (!m) return 0;
  return Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) / 1000);
}

const FORMAT_JOUR = new Intl.DateTimeFormat('en-CA', { timeZone: FUSEAU, year: 'numeric', month: '2-digit', day: '2-digit' });

/** Jour de service courant (AAAA-MM-JJ) en fuseau Europe/Paris. */
export function serviceDay() {
  return FORMAT_JOUR.format(new Date(maintenantEpoch() * 1000));
}

/** Jour de service (AAAA-MM-JJ) de cet epoch précis, en fuseau Europe/Paris — pour une commande planifiée
 * (order_create.js), c'est le jour DEMANDÉ par le client (scheduled_for), jamais le jour où elle a été
 * passée : owner_orders.js filtre les commandes déjà décidées par service_day = aujourd'hui, donc une
 * commande planifiée avec le jour de sa création (et non celui de son créneau) apparaîtrait le jour de la
 * commande (trop tôt) puis disparaîtrait complètement de la vue commerçant le jour venu (plus jamais vue,
 * son ticket resterait orphelin). */
export function serviceDayAt(epoch) {
  return FORMAT_JOUR.format(new Date(epoch * 1000));
}

const FORMAT_DATETIME_PARIS = new Intl.DateTimeFormat('en-CA', {
  timeZone: FUSEAU, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
});

/** Epoch UTC (secondes) de l'instant qui s'affiche « année-mois-jour heure:minute » à Paris (DST-safe). */
export function parisLocalVersEpoch(annee, mois, jour, heure, minute) {
  const naif = Math.floor(Date.UTC(annee, mois - 1, jour, heure, minute, 0) / 1000);
  const parts = {};
  for (const p of FORMAT_DATETIME_PARIS.formatToParts(new Date(naif * 1000))) parts[p.type] = p.value;
  const vu = Math.floor(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), 0) / 1000);
  return naif - (vu - naif);
}

/** Le jour calendaire parisien de cet epoch, décalé de `offsetJours` jours (0 = aujourd'hui). */
export function jourParisDecale(epoch, offsetJours) {
  const [y, m, d] = FORMAT_JOUR.format(new Date(epoch * 1000)).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d) + offsetJours * 86400000);
  return { annee: dt.getUTCFullYear(), mois: dt.getUTCMonth() + 1, jour: dt.getUTCDate() };
}

/** Nombre de caractères (points de code), comme mb_strlen. */
export function strChars(s) {
  return Array.from(String(s)).length;
}

/** Espaces réduits et coupés aux extrémités. */
export function cleanSpaces(s) {
  return String(s).replace(/\s+/gu, ' ').trim();
}

const REMPLACEMENTS = {
  'à': 'a', 'â': 'a', 'ä': 'a', 'á': 'a', 'ã': 'a', 'å': 'a',
  'ç': 'c', 'é': 'e', 'è': 'e', 'ê': 'e', 'ë': 'e',
  'î': 'i', 'ï': 'i', 'í': 'i', 'ì': 'i',
  'ô': 'o', 'ö': 'o', 'ó': 'o', 'ò': 'o', 'õ': 'o',
  'ù': 'u', 'û': 'u', 'ü': 'u', 'ú': 'u', 'ÿ': 'y', 'ñ': 'n',
  'œ': 'oe', 'æ': 'ae',
  '’': "'", '‘': "'", '`': "'", '´': "'"
};

/** Forme de comparaison (même règle que norm() de assets/js/disponibilite.js). */
export function normName(s) {
  let t = String(s).normalize('NFD').replace(/\p{Mn}+/gu, '');
  t = t.toLowerCase();
  t = Array.from(t).map((ch) => (REMPLACEMENTS[ch] !== undefined ? REMPLACEMENTS[ch] : ch)).join('');
  return cleanSpaces(t);
}

/** Caractères de format retirés, espaces réduits, ponctuation finale retirée. */
export function precleanName(s) {
  let t = String(s).replace(/\p{Cf}+/gu, '');
  t = cleanSpaces(t);
  return t.replace(/[\s.,;:!?]+$/u, '');
}

/** Clés d'un nom : complet, et sans parenthèse finale. Correspondance exacte, jamais approximative. */
export function nameKeys(name) {
  const propre = precleanName(name);
  const full = normName(propre);
  const core = normName(precleanName(propre.replace(/\s*\([^()]*\)\s*$/u, '')));
  return core !== '' && core !== full ? [full, core] : [full];
}

export function nameKeysIntersect(a, b) {
  const kb = new Set(nameKeys(b));
  return nameKeys(a).some((k) => kb.has(k));
}

export function isListArray(v) {
  return Array.isArray(v);
}

export function isIntBetween(v, min, max) {
  return Number.isInteger(v) && v >= min && v <= max;
}
