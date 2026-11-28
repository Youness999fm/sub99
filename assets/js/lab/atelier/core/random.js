/**
 * Aléatoire déterministe.
 *
 * Toute la mise en scène (position des morceaux sur la pizza, bulles de la
 * croûte, mouchetures du chorizo, remplissage des bacs) doit être stable : si
 * on retire puis remet un ingrédient, il doit retomber exactement au même
 * endroit, sinon la pizza « saute » à chaque clic. On n'utilise donc jamais
 * Math.random() au rendu, seulement ce générateur semé par l'identifiant.
 */

/** Hash de chaîne 32 bits (FNV-1a), pour transformer un id en graine. */
export function hashSeed(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** PRNG mulberry32 : rapide, bien distribué, suffisant pour du décor. */
export function createRng(seed) {
  let a = typeof seed === 'string' ? hashSeed(seed) : seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Flottant dans [min, max[. */
export function range(rng, min, max) {
  return min + rng() * (max - min);
}

/** Entier dans [min, max]. */
export function intRange(rng, min, max) {
  return Math.floor(min + rng() * (max - min + 1));
}

/** Élément d'un tableau. */
export function pick(rng, list) {
  return list[Math.floor(rng() * list.length)];
}
