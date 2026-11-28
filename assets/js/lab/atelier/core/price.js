/**
 * PriceCalculator — seul endroit où un prix est calculé.
 *
 * Règles reprises de composer.html :
 *   - la base Marguerita est facturée au prix de la taille ;
 *   - sauce tomate / crème fraîche font partie de la Marguerita (0 €) ;
 *   - sauce curry / barbecue sont des suppléments « légumes et sauces » ;
 *   - tout autre ingrédient est un supplément à sa grille (vegetal/premium).
 */

import { getSize, getIngredient, supplementPrice } from '../data/ingredients.js';

/**
 * @returns {{
 *   sizeLabel: string|null, base: number, extrasTotal: number, total: number,
 *   lines: Array<{id:string,label:string,category:string,price:number,included:boolean}>
 * }}
 */
export function computePrice(store) {
  const { state } = store;
  const size = getSize(state.sizeId);
  const base = size ? size.price : 0;

  const lines = store.allSelected().map((id) => {
    const ing = getIngredient(id);
    const price = size ? supplementPrice(ing, size.id) : 0;
    return {
      id: ing.id,
      label: ing.label,
      category: ing.category,
      price,
      included: Boolean(ing.includedInBase)
    };
  });

  const extrasTotal = lines.reduce((sum, line) => sum + line.price, 0);

  return {
    sizeLabel: size ? size.label : null,
    sizeDiameter: size ? size.diameter : null,
    base,
    extrasTotal,
    total: round2(base + extrasTotal),
    lines
  };
}

/** Prix affiché sur une carte de bac, avant sélection. */
export function previewPrice(ingredient, sizeId) {
  if (!ingredient || !sizeId) return null;
  if (ingredient.includedInBase) return 0;
  return supplementPrice(ingredient, sizeId);
}

function round2(value) {
  return Math.round(value * 100) / 100;
}
