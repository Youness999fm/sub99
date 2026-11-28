/**
 * PizzaLayerRenderer — où chaque morceau se pose.
 *
 * Deux exigences contradictoires : avoir l'air naturel (pas de grille) et
 * rester crédible (pas de tas, pas de morceau à moitié sur la croûte). On
 * utilise l'échantillonnage « best candidate » de Mitchell : pour chaque
 * morceau on tire N positions au hasard et on garde celle qui est la plus
 * éloignée de tout ce qui est déjà posé. Résultat : une répartition
 * quasi-uniforme sans alignement visible, et stable car l'aléatoire est semé
 * par l'identifiant de l'ingrédient.
 */

import { createRng, range, intRange } from '../core/random.js';
import { getSize } from '../data/ingredients.js';

/** Rayon de la pizza de référence (le canvas travaille dans ce repère). */
export const BASE_RADIUS = 420;
/** Part du rayon réellement garnie : le reste, c'est le bourrelet. */
export const TOPPING_RATIO = 0.845;
/** Taille de référence des densités déclarées dans ingredients.js. */
const REFERENCE_SCALE = 0.76;
/**
 * À l'échelle strictement réaliste (une rondelle de chorizo = 10 % du diamètre
 * d'une Quatro) la garniture se lit comme une poussière de points. On
 * l'agrandit d'un tiers : c'est la licence de tous les visuels de pizza, et
 * c'est ce qui rend l'image appétissante.
 */
const ART_BOOST = 1.35;

/**
 * Nombre de morceaux pour une taille donnée. La surface varie comme le carré
 * de l'échelle : une XXL reçoit donc nettement plus de garniture qu'une Solo,
 * ce qui conserve la même densité à l'écran.
 */
export function pieceCount(ingredient, sizeId) {
  const size = getSize(sizeId);
  const base = (ingredient.piece && ingredient.piece.count) || 8;
  if (!size) return base;
  const factor = Math.pow(size.scale / REFERENCE_SCALE, 2);
  return Math.max(3, Math.round(base * factor));
}

/**
 * @param {object} ingredient
 * @param {string} sizeId
 * @param {Array<{x:number,y:number,r:number}>} occupied
 *        Morceaux déjà posés par les autres ingrédients — partagé par le
 *        canvas pour que les calques ne se superposent pas bêtement.
 * @returns {Array<{x:number,y:number,rot:number,scale:number,shapeId:string}>}
 */
export function placePieces(ingredient, sizeId, occupied) {
  const conf = ingredient.piece || {};
  const shapes = (ingredient.art && ingredient.art.shapes) || [];
  if (!shapes.length) return [];

  const size = getSize(sizeId);
  const sizeScale = size ? size.scale : REFERENCE_SCALE;
  // Les morceaux gardent une taille constante à l'écran : on compense donc
  // la mise à l'échelle du groupe pizza.
  const pieceScale = ((conf.scale || 1) * ART_BOOST) / sizeScale;
  const pieceRadius = (conf.radius || 30) * pieceScale;

  const area = BASE_RADIUS * TOPPING_RATIO - pieceRadius * 0.45;
  const count = pieceCount(ingredient, sizeId);
  const rng = createRng('place-' + ingredient.id + '-' + sizeId);
  const jitter = conf.jitter == null ? 0.9 : conf.jitter;
  const out = [];

  for (let i = 0; i < count; i += 1) {
    const candidates = 12;
    let best = null;
    let bestScore = -1;
    for (let c = 0; c < candidates; c += 1) {
      // sqrt() sur le rayon : répartition uniforme en surface, sinon tout
      // s'agglutine au centre.
      const angle = rng() * Math.PI * 2;
      const radial = Math.sqrt(rng()) * jitter;
      const x = Math.cos(angle) * area * radial;
      const y = Math.sin(angle) * area * radial;
      const score = nearestDistance(x, y, occupied, out);
      if (score > bestScore) {
        bestScore = score;
        best = { x, y };
      }
    }
    if (!best) continue;
    out.push({
      x: round(best.x),
      y: round(best.y),
      r: pieceRadius,
      rot: round(range(rng, -(conf.rotate || 0), conf.rotate || 0)),
      scale: round(pieceScale * range(rng, 0.9, 1.1)),
      shapeId: shapes[intRange(rng, 0, shapes.length - 1)]
    });
  }

  return out;
}

function nearestDistance(x, y, occupied, pending) {
  let min = Infinity;
  for (let i = 0; i < occupied.length; i += 1) {
    const d = dist(x, y, occupied[i]);
    if (d < min) min = d;
  }
  for (let i = 0; i < pending.length; i += 1) {
    const d = dist(x, y, pending[i]);
    if (d < min) min = d;
  }
  return min;
}

function dist(x, y, p) {
  const dx = x - p.x;
  const dy = y - p.y;
  // On soustrait les rayons : deux gros morceaux doivent s'éviter davantage
  // que deux câpres.
  return Math.sqrt(dx * dx + dy * dy) - (p.r || 0) * 0.5;
}

/**
 * Ordre d'empilement des calques : c'est exactement l'ordre du parcours, donc
 * la pizza finie « raconte » la préparation (sauce dessous, fromages dessus).
 */
export const LAYER_ORDER = ['sauce', 'mozzarella', 'viandes', 'legumes', 'fromages'];

function round(n) {
  return Math.round(n * 10) / 10;
}
