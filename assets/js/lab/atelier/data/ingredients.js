/**
 * Atelier « Compose ta pizza » — données mockées.
 *
 * PROTOTYPE ISOLÉ : ce fichier ne lit rien du catalogue réel et n'est importé
 * par aucune page de production. Tous les tarifs sont recopiés depuis
 * composer.html pour que le prototype dise la vérité, mais la source de vérité
 * reste le site. Au moment de l'intégration, ce module est le SEUL point à
 * remplacer par le vrai catalogue (voir lab/README.md).
 */

/* ------------------------------------------------------------------ tailles */

/**
 * `scale` = échelle visuelle de la pizza dans le canvas. Volontairement
 * compressée par rapport aux diamètres réels (26 → 50 cm) : à l'échelle exacte
 * la Solo deviendrait minuscule à l'écran. L'écart reste nettement lisible.
 */
export const SIZES = [
  { id: 'solo',   label: 'Solo',   diameter: '26 cm',   cm: 26,   price: 9.00,  scale: 0.66, parts: '1 personne' },
  { id: 'duo',    label: 'Duo',    diameter: '31,5 cm', cm: 31.5, price: 13.00, scale: 0.76, parts: '2 personnes' },
  { id: 'quatro', label: 'Quatro', diameter: '40 cm',   cm: 40,   price: 17.50, scale: 0.89, parts: '3 à 4 personnes' },
  { id: 'xxl',    label: 'XXL',    diameter: '50 cm',   cm: 50,   price: 25.50, scale: 1.00, parts: '5 personnes et +' }
];

/**
 * Grilles de suppléments par taille (identiques à composer.html).
 *   vegetal = légumes et sauces
 *   premium = viandes, poissons et fromages
 */
export const SUPPLEMENT_RATES = {
  vegetal: { solo: 1.00, duo: 1.50, quatro: 2.50, xxl: 3.50 },
  premium: { solo: 1.50, duo: 2.00, quatro: 3.00, xxl: 4.00 }
};

export const RATE_LABELS = {
  vegetal: 'Légumes et sauces',
  premium: 'Viandes, poissons et fromages'
};

/* -------------------------------------------------------------------- étapes */

export const STEPS = [
  {
    id: 'taille',
    short: 'Taille',
    title: 'Choisissez la taille',
    help: 'Le diamètre de la pâte s’adapte immédiatement. Le prix affiché est celui de la base Marguerita.',
    kind: 'size'
  },
  {
    id: 'base',
    short: 'Base',
    title: 'La sauce',
    help: 'Une seule sauce de base. Tomate et crème fraîche sont incluses dans la Marguerita, les deux autres sont comptées en supplément.',
    kind: 'single',
    category: 'base'
  },
  {
    id: 'viandes',
    short: 'Viandes',
    title: 'Les viandes',
    help: 'Autant de viandes que vous voulez : chacune est ajoutée sur la pizza et facturée au tarif viandes.',
    kind: 'multi',
    category: 'viandes'
  },
  {
    id: 'legumes',
    short: 'Légumes',
    title: 'Les légumes',
    help: 'Touchez un bac pour en verser sur la pizza, touchez-le à nouveau pour le retirer.',
    kind: 'multi',
    category: 'legumes'
  },
  {
    id: 'fromages',
    short: 'Fromages',
    title: 'Les fromages',
    help: 'Les fromages supplémentaires viennent par-dessus — la mozzarella de la Marguerita est déjà là.',
    kind: 'multi',
    category: 'fromages'
  },
  {
    id: 'final',
    short: 'Final',
    title: 'Votre pizza',
    help: 'Voici votre composition complète.',
    kind: 'recap'
  }
];

/* --------------------------------------------------------------- ingrédients */

/**
 * Champs d'un ingrédient :
 *   id, label      — identité ; `label` est le libellé métier du site.
 *   category       — étape d'appartenance (base|viandes|legumes|fromages).
 *   rate           — grille tarifaire (vegetal|premium), null si inclus.
 *   includedInBase — vrai pour les deux sauces de la Marguerita.
 *   art            — identifiants des formes SVG (voir render/svg-defs.js).
 *   piece          — rendu sur la pizza : nombre de morceaux de référence
 *                    (taille Duo), variantes de forme, rotation, échelle.
 *   available      — permet de préparer un ingrédient sans l'exposer (anchois,
 *                    thon : prévus par la grille tarifaire du site mais pas
 *                    encore dessinés — l'architecture les accepte tels quels).
 */
export const INGREDIENTS = [
  /* -- sauces ------------------------------------------------------------- */
  {
    id: 'sauce-tomate', label: 'Sauce tomate', category: 'base', rate: 'vegetal',
    includedInBase: true, note: 'Incluse dans la Marguerita',
    sauce: { fill: 'atg-sauce-tomate', pool: 'atg-pool-tomate', ink: '#9E2214' },
    art: { tray: 'pool' }
  },
  {
    id: 'sauce-creme', label: 'Crème fraîche', category: 'base', rate: 'vegetal',
    includedInBase: true, note: 'Incluse dans la Marguerita',
    sauce: { fill: 'atg-sauce-creme', pool: 'atg-pool-creme', ink: '#8A7A56' },
    art: { tray: 'pool' }
  },
  {
    id: 'sauce-curry', label: 'Sauce curry', category: 'base', rate: 'vegetal',
    note: 'Parfum indien, légèrement relevé',
    sauce: { fill: 'atg-sauce-curry', pool: 'atg-pool-curry', ink: '#A96A10' },
    art: { tray: 'pool' }
  },
  {
    id: 'sauce-barbecue', label: 'Sauce barbecue', category: 'base', rate: 'vegetal',
    note: 'Fumée, ambrée, sucrée-salée',
    sauce: { fill: 'atg-sauce-bbq', pool: 'atg-pool-bbq', ink: '#7E3310' },
    art: { tray: 'pool' }
  },

  /* -- viandes ------------------------------------------------------------ */
  {
    id: 'viande-hachee', label: 'Viande hachée', category: 'viandes', rate: 'premium',
    art: { shapes: ['atl-hachee-a', 'atl-hachee-b'], trayScale: 1.3, trayCount: 9 },
    piece: { count: 11, scale: 1, rotate: 180, jitter: 0.95, radius: 28 }
  },
  {
    id: 'mortadelle', label: 'Mortadelle', category: 'viandes', rate: 'premium',
    art: { shapes: ['atl-mortadelle'], trayScale: 0.95, trayCount: 5 },
    piece: { count: 6, scale: 1, rotate: 180, jitter: 0.8, radius: 60 }
  },
  {
    id: 'merguez', label: 'Merguez', category: 'viandes', rate: 'premium',
    art: { shapes: ['atl-merguez'], trayScale: 1.0, trayCount: 6 },
    piece: { count: 9, scale: 1, rotate: 180, jitter: 0.9, radius: 44 }
  },
  {
    id: 'chorizo', label: 'Chorizo', category: 'viandes', rate: 'premium',
    art: { shapes: ['atl-chorizo'], trayScale: 1.0, trayCount: 6 },
    piece: { count: 8, scale: 1, rotate: 180, jitter: 0.85, radius: 52 }
  },
  {
    id: 'kebab', label: 'Kebab', category: 'viandes', rate: 'premium',
    art: { shapes: ['atl-kebab-a', 'atl-kebab-b'], trayScale: 1.2, trayCount: 8 },
    piece: { count: 10, scale: 1, rotate: 180, jitter: 0.92, radius: 40 }
  },
  {
    id: 'jambon', label: 'Jambon', category: 'viandes', rate: 'premium',
    art: { shapes: ['atl-jambon'], trayScale: 1.0, trayCount: 5 },
    piece: { count: 6, scale: 1, rotate: 180, jitter: 0.8, radius: 62 }
  },
  {
    id: 'lardons', label: 'Lardons', category: 'viandes', rate: 'premium',
    art: { shapes: ['atl-lardon'], trayScale: 1.6, trayCount: 12 },
    piece: { count: 14, scale: 1, rotate: 180, jitter: 0.95, radius: 30 }
  },
  {
    id: 'poulet', label: 'Poulet', category: 'viandes', rate: 'premium',
    art: { shapes: ['atl-poulet-a', 'atl-poulet-b'], trayScale: 1.3, trayCount: 8 },
    piece: { count: 9, scale: 1, rotate: 180, jitter: 0.9, radius: 42 }
  },
  /* Prévus par la grille du site, pas encore dessinés — n'apparaissent pas. */
  { id: 'anchois', label: 'Anchois', category: 'viandes', rate: 'premium', available: false },
  { id: 'thon',    label: 'Thon',    category: 'viandes', rate: 'premium', available: false },

  /* -- légumes ------------------------------------------------------------ */
  {
    id: 'champignons', label: 'Champignons', category: 'legumes', rate: 'vegetal',
    art: { shapes: ['atl-champignon-a', 'atl-champignon-b'], trayScale: 1.3, trayCount: 9 },
    piece: { count: 11, scale: 1, rotate: 180, jitter: 0.92, radius: 34 }
  },
  {
    id: 'artichauts', label: 'Artichauts', category: 'legumes', rate: 'vegetal',
    art: { shapes: ['atl-artichaut'], trayScale: 1.3, trayCount: 7 },
    piece: { count: 7, scale: 1, rotate: 180, jitter: 0.85, radius: 44 }
  },
  {
    id: 'poivrons', label: 'Poivrons', category: 'legumes', rate: 'vegetal',
    art: { shapes: ['atl-poivron-rouge', 'atl-poivron-vert'], trayScale: 1.3, trayCount: 9 },
    piece: { count: 11, scale: 1, rotate: 180, jitter: 0.92, radius: 38 }
  },
  {
    id: 'oignons', label: 'Oignons', category: 'legumes', rate: 'vegetal',
    art: { shapes: ['atl-oignon'], trayScale: 1.3, trayCount: 9 },
    piece: { count: 10, scale: 1, rotate: 180, jitter: 0.95, radius: 36 }
  },
  {
    id: 'capres', label: 'Câpres', category: 'legumes', rate: 'vegetal',
    art: { shapes: ['atl-capre'], trayScale: 2.2, trayCount: 14 },
    piece: { count: 16, scale: 1, rotate: 180, jitter: 1, radius: 18 }
  },
  {
    id: 'olives', label: 'Olives', category: 'legumes', rate: 'vegetal',
    art: { shapes: ['atl-olive'], trayScale: 1.5, trayCount: 10 },
    piece: { count: 13, scale: 1, rotate: 180, jitter: 0.95, radius: 26 }
  },

  /* -- fromages ----------------------------------------------------------- */
  {
    id: 'parmesan', label: 'Parmesan', category: 'fromages', rate: 'premium',
    effect: 'rape',
    art: { shapes: ['atl-parmesan-a', 'atl-parmesan-b'], trayScale: 2.4, trayCount: 18 },
    piece: { count: 30, scale: 1, rotate: 180, jitter: 1, radius: 14 }
  },
  {
    id: 'brie', label: 'Brie', category: 'fromages', rate: 'premium',
    art: { shapes: ['atl-brie'], trayScale: 1.2, trayCount: 6 },
    piece: { count: 7, scale: 1, rotate: 180, jitter: 0.85, radius: 42 }
  },
  {
    id: 'chevre', label: 'Chèvre', category: 'fromages', rate: 'premium',
    art: { shapes: ['atl-chevre'], trayScale: 1.2, trayCount: 6 },
    piece: { count: 6, scale: 1, rotate: 180, jitter: 0.88, radius: 44 }
  },
  {
    id: 'bleu', label: 'Bleu', category: 'fromages', rate: 'premium',
    art: { shapes: ['atl-bleu-a', 'atl-bleu-b'], trayScale: 1.5, trayCount: 10 },
    piece: { count: 13, scale: 1, rotate: 180, jitter: 0.98, radius: 24 }
  },
  {
    id: 'reblochon', label: 'Reblochon', category: 'fromages', rate: 'premium',
    art: { shapes: ['atl-reblochon'], trayScale: 1.3, trayCount: 6 },
    piece: { count: 7, scale: 1, rotate: 180, jitter: 0.85, radius: 42 }
  }
];

/** Fromage de base de la Marguerita : offert, posé juste après la sauce. */
export const BASE_CHEESE = {
  id: 'mozzarella',
  label: 'Mozzarella',
  note: 'Fromage de la Marguerita — inclus'
};

/* ------------------------------------------------------------------- helpers */

const BY_ID = new Map(INGREDIENTS.map((ing) => [ing.id, ing]));

export function getIngredient(id) {
  return BY_ID.get(id) || null;
}

export function ingredientsOfCategory(category) {
  return INGREDIENTS.filter((ing) => ing.category === category && ing.available !== false);
}

export function getSize(id) {
  return SIZES.find((s) => s.id === id) || null;
}

/** Prix d'un ingrédient pour une taille donnée (0 si inclus dans la base). */
export function supplementPrice(ingredient, sizeId) {
  if (!ingredient || !sizeId) return 0;
  if (ingredient.includedInBase) return 0;
  const grid = SUPPLEMENT_RATES[ingredient.rate];
  return grid ? grid[sizeId] || 0 : 0;
}

export function formatPrice(value) {
  return value.toFixed(2).replace('.', ',') + ' €';
}
