// Dates, chaînes, constantes métier (port de api/lib/util.php).
import { maintenantEpoch } from './horloge.js';

export const DELAY_CHOICES = [20, 30, 40, 50, 60];

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
