// GET availability — disponibilités publiques (mêmes clés que assets/data/disponibilite.json).
import { allowMethods } from '../core.js';
import { availabilityEffective } from '../availability.js';
import { serviceDay } from '../util.js';

export default async function availability(c) {
  allowMethods(c, ['GET']);
  const pizzas = [];
  const ingredients = [];
  for (const e of await availabilityEffective()) {
    if (e.kind === 'pizza') pizzas.push(e.name);
    else if (e.kind === 'ingredient') ingredients.push(e.name);
    // kind = product : jamais dans la réponse publique.
  }
  // Exactement les clés de assets/data/disponibilite.json (pas de clé « ok » : disponibilite.js signale toute clé inconnue).
  return { status: 200, body: { misAJourLe: serviceDay(), pizzasIndisponibles: pizzas, ingredientsIndisponibles: ingredients } };
}
