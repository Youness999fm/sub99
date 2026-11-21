// Catalogue serveur (api/data/catalogue.json, généré par tools/build-catalogue.mjs à partir des pages).
// Vérifie chaque ligne de commande : article connu, prix unitaire au centime près
// (taille ou prix fixe + suppléments, règle de substitution de cart.js), disponibilités.
// Port de api/lib/catalogue.php.
import { readFileSync } from 'node:fs';
import { availabilityEffective, itemBaseName, unavailablePizzas } from './availability.js';
import { nameKeysIntersect, normName, precleanName } from './util.js';

const CATALOGUE_PAR_DEFAUT = new URL('../api/data/catalogue.json', import.meta.url);

/**
 * Fichier du catalogue : api/data/catalogue.json. Seuls les tests (SUBITO_TEST_MODE=1, hors Vercel) peuvent
 * en désigner un autre par SUBITO_CATALOGUE_PATH (équivalent de la clé « catalogue_path » de la configuration PHP).
 */
function cheminCatalogue() {
  const p = process.env.SUBITO_CATALOGUE_PATH;
  if (typeof p === 'string' && p !== '' && process.env.SUBITO_TEST_MODE === '1' && !process.env.VERCEL) return p;
  return CATALOGUE_PAR_DEFAUT;
}

let cache = { cle: null, data: null };

/** Catalogue chargé une fois par processus (et par fichier). Absent ou invalide : exception (500), jamais de commande sans catalogue. */
export function catalogue() {
  const chemin = cheminCatalogue();
  const cle = String(chemin);
  if (cache.data !== null && cache.cle === cle) return cache.data;
  let brut;
  try {
    brut = readFileSync(chemin, 'utf8');
  } catch {
    throw new Error('Catalogue absent');
  }
  let c;
  try { c = JSON.parse(brut); } catch { c = null; }
  if (c === null || typeof c !== 'object' || Array.isArray(c) || c.schema !== 1
    || !Array.isArray(c.products) || !Array.isArray(c.supplement_groups)) {
    throw new Error('Catalogue invalide');
  }
  cache = { cle, data: c };
  return c;
}

/** normalizeIngredientName() de cart.js : minuscules, astérisque final retiré, espaces coupés. */
export function catalogueSwapKey(name) {
  return String(name).toLowerCase().replace(/\*$/u, '').trim();
}

/** Nom de ligne découpé comme item_base_name() : [base, garniture ou null]. */
export function catalogueSplitName(name) {
  const clean = String(name).replace(/\p{Cf}+/gu, '');
  const m = /\s*[—–]\s*|\s+-\s+/u.exec(clean);
  if (m === null) return [precleanName(clean), null];
  return [precleanName(clean.slice(0, m.index)), precleanName(clean.slice(m.index + m[0].length))];
}

/** Article du catalogue dont le nom de ligne correspond (mêmes clés que la disponibilité, jamais approximatif). */
export function catalogueFind(name, kind) {
  if (name === '') return null;
  for (const p of catalogue().products) {
    if (p.kind === kind && nameKeysIntersect(String(p.line_name), name)) return p;
  }
  return null;
}

/**
 * Index du groupe de suppléments contenant ce nom (casse et astérisque finale sans importance :
 * le propriétaire retire les astérisques de supplements.html, une astérisque résiduelle
 * envoyée par le navigateur reste reconnue), sinon null.
 */
export function catalogueExtraGroup(name) {
  const key = catalogueSwapKey(name);
  const groups = catalogue().supplement_groups;
  for (let gi = 0; gi < groups.length; gi++) {
    for (const n of groups[gi].names) {
      if (catalogueSwapKey(String(n)) === key) return gi;
    }
  }
  return null;
}

/** Clés de disponibilité couvertes par un supplément (son nom, et ses alias : « chèvre » -> « fromage de chèvre »). */
export function catalogueExtraKeys(name) {
  const gi = catalogueExtraGroup(name);
  if (gi === null) return [];
  const g = catalogue().supplement_groups[gi];
  const key = catalogueSwapKey(name);
  for (const n of g.names) {
    if (catalogueSwapKey(String(n)) === key) {
      const alias = g.availability_keys && Object.prototype.hasOwnProperty.call(g.availability_keys, n) ? g.availability_keys[n] : null;
      return (alias ?? [n]).map(String);
    }
  }
  return [];
}

const premiereLettreMajuscule = (s) => {
  const c = Array.from(s);
  return c.length === 0 ? '' : c[0].toUpperCase() + c.slice(1).join('');
};

/**
 * Article d'une ligne validée.
 * Renvoie { product, filler, half, name, half_names } ou { error, name } / { error: 'validation', field }.
 */
export function catalogueResolveLine(it) {
  const unknown = { error: 'unknown_item', name: it.name };
  const isPizza = it.variant !== '';
  const [base, rest] = catalogueSplitName(it.name);
  const p = catalogueFind(base, isPizza ? 'pizza' : 'product');
  if (p === null) return unknown;
  const aChoix = p.choice !== null && typeof p.choice === 'object';
  // Choix écrit dans le nom après « — » : garniture de la calzone (obligatoire),
  // base de la pizza à composer (facultative : le navigateur ne la transmet pas encore).
  let filler = null;
  if (aChoix && (rest === null || rest === '') && !p.choice.required) {
    // pas de choix transmis : accepté (la disponibilité exige alors au moins une option)
  } else if (aChoix) {
    if (rest === null || rest === '') return unknown;
    for (const opt of p.choice.options) {
      if (normName(String(opt)) === normName(rest)) {
        filler = String(opt);
        break;
      }
    }
    if (filler === null) return unknown;
  } else if (rest !== null) {
    return unknown;
  }
  if (!p.orderable) return { error: 'unpriced_item', name: it.name };
  const prixTaille = isPizza && p.prices_by_size ? p.prices_by_size[it.variant] : null;
  if (isPizza && !Number.isInteger(prixTaille)) return { error: 'unpriced_item', name: it.name };
  // Moitié-moitié (décision du propriétaire, 19/11/2026) : à partir de Duo, jamais en Solo,
  // jamais sur la calzone (ni sur un article sans moitié-moitié) -> 422 validation, champ items[i].half.
  // Première moitié = la pizza de la ligne ; deuxième = une pizza proposable en moitié.
  let half = null;
  if (it.half !== null && it.half !== undefined && typeof it.half === 'object') {
    if (it.variant === 'Solo' || !p.half_allowed) return { error: 'validation', field: 'half' };
    if (!nameKeysIntersect(String(p.line_name), it.half.flavor1)) return unknown;
    const h = catalogueFind(itemBaseName(it.half.flavor2), 'pizza');
    if (h === null || !h.half_flavor) return { error: 'unknown_item', name: it.half.flavor2 };
    half = h;
  }
  // Suppléments : seulement sur une pizza, et seulement ceux de supplements.html.
  for (const ex of it.extras) {
    if (!isPizza || catalogueExtraGroup(ex.name) === null) return { error: 'unknown_item', name: ex.name };
  }
  // Retraits : ingrédients fixes de la fiche, choix retenu (garniture, base), ou ingrédients
  // de la deuxième moitié (le navigateur les propose aussi).
  const allowed = new Set();
  for (const ing of p.ingredients) allowed.add(normName(String(ing)));
  if (filler !== null) allowed.add(normName(filler));
  if (half !== null) for (const ing of half.ingredients) allowed.add(normName(String(ing)));
  for (const ing of it.removed) {
    if (!allowed.has(normName(ing))) return { error: 'validation', field: 'removed' };
  }
  // Nom canonique (celui du catalogue), enregistré sur le ticket.
  let canonical = String(p.line_name);
  if (filler !== null) canonical += ' — ' + premiereLettreMajuscule(filler);
  const halfNames = half === null ? null : { flavor1: String(p.name), flavor2: String(half.name) };
  return { product: p, filler, half, name: canonical, half_names: halfNames };
}

/** Lignes avec les noms du catalogue (nom de ligne, moitiés) ; lignes déjà vérifiées par verifyLinePrices(). */
export function catalogueCanonicalItems(items) {
  return items.map((it) => {
    const r = catalogueResolveLine(it);
    return r.error ? { ...it } : { ...it, name: r.name, half: r.half_names, category: String(r.product.category) };
  });
}

/**
 * Prix unitaire attendu d'une ligne résolue, et prix attendu de chaque supplément.
 * Règle de substitution reprise de applySwapDiscount() (cart.js) : chaque ingrédient retiré
 * d'un groupe rend gratuit le premier supplément suivant du même groupe ; un retrait ne
 * couvre qu'un supplément (la ligne entière, quelle que soit sa quantité, comme cart.js).
 * Seuls comptent les retraits d'ingrédients réellement présents sur la pizza (ou sa deuxième
 * moitié), une fois chacun : le navigateur ne peut pas en envoyer d'autres.
 */
export function catalogueExpectedLine(it, r) {
  const p = r.product;
  if (p.kind !== 'pizza') return { unit_cents: Number(p.price_cents), extras: [] };
  const variant = it.variant;
  const groups = catalogue().supplement_groups;
  const groupOf = new Map();
  groups.forEach((g, gi) => {
    for (const n of g.names) groupOf.set(catalogueSwapKey(String(n)), gi);
  });
  // Crédits : retraits d'ingrédients fixes de la fiche (ou de la deuxième moitié), une fois
  // chacun — exactement les puces « Sans » que propose le navigateur.
  const present = new Set();
  for (const ing of p.ingredients) present.add(normName(String(ing)));
  if (r.half !== null) for (const ing of r.half.ingredients) present.add(normName(String(ing)));
  const credits = groups.map(() => 0);
  const counted = new Set();
  for (const ing of it.removed) {
    const k = normName(ing);
    if (!present.has(k) || counted.has(k)) continue;
    counted.add(k);
    const gi = groupOf.get(catalogueSwapKey(ing));
    if (gi !== undefined) credits[gi]++;
  }
  let unit = Number(p.prices_by_size[variant]);
  const extras = [];
  for (const ex of it.extras) {
    let price = Number(groups[catalogueExtraGroup(ex.name)].prices_by_size[variant]);
    const gi = groupOf.get(catalogueSwapKey(ex.name));
    if (gi !== undefined && credits[gi] > 0) {
      credits[gi]--;
      price = 0;
    }
    extras.push(price);
    unit += price * ex.qty;
  }
  return { unit_cents: unit, extras };
}

const MESSAGES_CHAMP = {
  half: 'Moitié-moitié possible à partir de la taille Duo, jamais sur la calzone.',
  removed: 'Ingrédient retiré absent de ce produit.'
};

/**
 * Vérifie toutes les lignes contre le catalogue. `mode` (pickup / delivery) n'intervient pas :
 * le prix unitaire est le même dans les deux modes (la promotion est calculée ensuite).
 * Renvoie null si tout est conforme, sinon l'erreur { error, …données }.
 */
export function verifyLinePrices(items, mode) { // eslint-disable-line no-unused-vars
  const resolved = [];
  for (let i = 0; i < items.length; i++) {
    const r = catalogueResolveLine(items[i]);
    if (r.error === 'validation') return { error: 'validation', fields: { [`items[${i}].${r.field}`]: MESSAGES_CHAMP[r.field] } };
    if (r.error) return r;
    resolved.push(r);
  }
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const exp = catalogueExpectedLine(it, resolved[i]);
    let ok = exp.unit_cents === it.unit_price_cents;
    it.extras.forEach((ex, k) => {
      if (ex.price_cents !== exp.extras[k]) ok = false;
    });
    if (!ok) {
      return {
        error: 'price_mismatch_line',
        index: i,
        name: it.name,
        expected_unit_cents: exp.unit_cents,
        sent_unit_cents: it.unit_price_cents
      };
    }
  }
  return null;
}

/**
 * Noms indisponibles parmi les lignes : pizzas (kind = pizza, règle existante), produits
 * (kind = product), ingrédients (kind = ingredient) fixes, garniture choisie et suppléments.
 * Un ingrédient fixe en rupture bloque la ligne même s'il est retiré (même règle que la carte).
 * Renvoie { unavailable, ingredients } : `ingredients` = ingrédients en rupture qui ont bloqué une ligne,
 * noms tels qu'enregistrés dans availability, en minuscules (comme dans le menu), sans doublon.
 */
export async function checkAvailabilityLines(items) {
  const out = new Set();
  for (const n of await unavailablePizzas(items)) out.add(n);
  const ingredients = new Map();
  const products = [];
  for (const e of await availabilityEffective()) {
    if (e.kind === 'ingredient') {
      ingredients.set(normName(precleanName(e.name)), precleanName(e.name).toLowerCase());
    } else if (e.kind === 'product') {
      products.push(e.name);
    }
  }
  if (ingredients.size === 0 && products.length === 0) return { unavailable: [...out], ingredients: [] };

  const hits = new Set();
  const isOut = (ing) => {
    const k = normName(precleanName(ing));
    if (!ingredients.has(k)) return false;
    hits.add(ingredients.get(k));
    return true;
  };
  for (const it of items) {
    const r = catalogueResolveLine(it);
    if (r.error) continue;
    const p = r.product;
    const base = itemBaseName(it.name);
    if (p.kind === 'product') {
      for (const name of products) {
        if (nameKeysIntersect(name, String(p.line_name)) || nameKeysIntersect(name, String(p.name))) out.add(base);
      }
    }
    if (ingredients.size === 0) continue;
    // Ingrédients de disponibilité : liste de l'espace commerçant (MENU de commercant.js).
    for (const ing of p.availability.fixed) {
      if (isOut(String(ing))) out.add(base);
    }
    if (r.half !== null) {
      for (const ing of r.half.availability.fixed) {
        if (isOut(String(ing))) out.add(itemBaseName(it.half.flavor2));
      }
    }
    const options = p.availability.choice;
    if (r.filler !== null) {
      if (isOut(r.filler)) out.add(precleanName(it.name));
    } else if (Array.isArray(options) && options.length > 0) {
      // Choix non transmis (base de la pizza à composer) : au moins une option disponible.
      const left = options.filter((o) => !ingredients.has(normName(precleanName(String(o)))));
      if (left.length === 0) {
        for (const o of options) isOut(String(o));
        out.add(base);
      }
    }
    for (const ex of it.extras) {
      for (const key of catalogueExtraKeys(ex.name)) {
        if (isOut(key)) out.add(String(ex.name).replace(/\*$/u, '').trim());
      }
    }
  }
  return { unavailable: [...out], ingredients: [...hits].map(String) };
}
