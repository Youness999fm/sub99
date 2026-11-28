/**
 * Manifeste des ressources photographiques de L'Atelier Subito.
 *
 * C'est le contrat entre la production d'images (lab/assets-brief/) et le
 * moteur. Une entrée décrit : où le fichier doit se trouver, quelles
 * dimensions il doit avoir, et — pour les aliments — quelle taille réelle il
 * représente en millimètres.
 *
 * Tant qu'un fichier manque, le moteur affiche « ASSET MANQUANT ». Il ne
 * fabrique jamais de substitut qui prétendrait au photoréalisme.
 */

/* --------------------------------------------------------------- échelle */

/**
 * Ancre de calibration physique : tout le reste se mesure par rapport au
 * diamètre de la pâte. C'est ce qui garantit le §50 — une rondelle de chèvre
 * ne grossit pas sur une XXL, il y en a simplement plus.
 */
export const DOUGH_MM = { solo: 260, duo: 315, quatro: 400, xxl: 500 };

/** Part du diamètre réellement garnie (le reste est le bourrelet). */
export const TOPPING_RATIO = 0.84;

/* ------------------------------------------------------------ ingrédients */

/**
 * `mm` = plus grande dimension réelle d'un morceau.
 * ⚠ Estimations à remplacer par des mesures faites sur les vrais produits de
 * Subito Pizza (voir lab/assets-brief/README.md §5).
 */
export const FOOD = [
  // id,               catégorie,   mm,  geste de dépôt
  ['viande-hachee',    'viandes',   10,  'poignee'],
  ['mortadelle',       'viandes',   45,  'main'],
  ['merguez',          'viandes',   26,  'main'],
  ['chorizo',          'viandes',   45,  'main'],
  ['kebab',            'viandes',   50,  'pince'],
  ['jambon',           'viandes',   55,  'main'],
  ['lardons',          'viandes',   20,  'poignee'],
  ['poulet',           'viandes',   30,  'pince'],
  ['anchois',          'viandes',   50,  'main'],
  ['thon',             'viandes',   16,  'cuillere'],

  ['champignons',      'legumes',   36,  'poignee'],
  ['artichauts',       'legumes',   42,  'main'],
  ['poivrons',         'legumes',   48,  'poignee'],
  ['oignons',          'legumes',   52,  'poignee'],
  ['capres',           'legumes',    9,  'cuillere'],
  ['olives',           'legumes',   22,  'poignee'],

  ['fromage-base',     'base',      45,  'poignee'],
  ['parmesan',         'fromages',  14,  'rape'],
  ['brie',             'fromages',  36,  'main'],
  ['chevre',           'fromages',  45,  'main'],
  ['bleu',             'fromages',  20,  'poignee'],
  ['reblochon',        'fromages',  36,  'main']
].map(([id, category, mm, gesture]) => ({ id, category, mm, gesture }));

export const SAUCES = ['tomate', 'creme', 'curry', 'barbecue'];

export const SIZE_IDS = ['solo', 'duo', 'quatro', 'xxl'];

/* ------------------------------------------------- manifeste des fichiers */

const BASE = 'assets/img/lab/atelier/';

/** Planche d'ingrédient : grille de cellules carrées découpée par le moteur. */
const SHEET_GRID = { cols: 4, rows: 3, cell: 256 };

function entry(kind, id, path, expect, extra) {
  return Object.assign({ kind, id, path: BASE + path, expect }, extra || {});
}

export const MANIFEST = [
  /* ---- vague 1 --------------------------------------------------------- */
  entry('scene', 'worktop', 'scene/worktop.jpg', { minW: 1920, minH: 800, alpha: false }, {
    wave: 1,
    label: 'Plan de travail inox'
  }),

  ...SIZE_IDS.map((size) =>
    entry('dough', size, `dough/dough-${size}.png`, { w: 1024, h: 1024, alpha: true }, {
      wave: 1,
      mm: DOUGH_MM[size],
      label: `Pâte ${size}`
    })
  ),

  ...SAUCES.map((sauce) =>
    entry('sauce-texture', sauce, `sauce/texture-${sauce}.jpg`, { minW: 1000, minH: 1000, alpha: false }, {
      wave: 1,
      label: `Texture sauce ${sauce}`
    })
  ),

  ...SAUCES.map((sauce) =>
    entry('pan', `sauce-${sauce}`, `pan/pan-sauce-${sauce}.png`, { w: 1024, h: 768, alpha: true }, {
      wave: 1,
      label: `Bac sauce ${sauce}`
    })
  ),

  entry('tool', 'ladle', 'tool/ladle.png', { w: 512, h: 1024, alpha: true }, {
    wave: 1,
    label: 'Louche'
  }),
  entry('tool', 'ladle-bowl-mask', 'tool/ladle-bowl-mask.png', { w: 512, h: 1024, alpha: true }, {
    wave: 1,
    label: 'Masque du creux de louche',
    note: 'Fait à la main à partir de ladle.png, pas généré.'
  }),

  /* ---- vague 2 --------------------------------------------------------- */
  ...FOOD.map((food) =>
    entry('pan', food.id, `pan/pan-${food.id}.png`, { w: 1024, h: 768, alpha: true }, {
      wave: 2,
      label: `Bac ${food.id}`,
      category: food.category
    })
  ),

  ...FOOD.map((food) =>
    entry('sheet', food.id, `sheet/${food.id}.png`, { w: 1024, h: 768, alpha: true }, {
      wave: 2,
      label: `Planche ${food.id}`,
      category: food.category,
      mm: food.mm,
      grid: SHEET_GRID,
      // Repli accepté : 12 fichiers séparés sheet/<id>-01.png … -12.png
      fallbackPieces: Array.from({ length: 12 }, (_, i) =>
        `${BASE}sheet/${food.id}-${String(i + 1).padStart(2, '0')}.png`
      )
    })
  ),

  /* ---- vague 3 --------------------------------------------------------- */
  ...[
    ['tongs-open', 'Pince ouverte'],
    ['tongs-closed', 'Pince fermée'],
    ['spoon', 'Cuillère'],
    ['grater', 'Râpe'],
    ['peel', 'Pelle à pizza']
  ].map(([id, label]) =>
    entry('tool', id, `tool/${id}.png`, { alpha: true }, { wave: 3, label })
  ),

  ...[
    ['hand-open', 'Main ouverte'],
    ['hand-pinch', 'Main pincée'],
    ['hand-fist', 'Poignée fermée'],
    ['hand-flat', 'Main à plat']
  ].map(([id, label]) =>
    entry('hand', id, `hand/${id}.png`, { alpha: true }, { wave: 3, label })
  )
];

/** Les entrées d'une vague donnée. */
export function wave(n) {
  return MANIFEST.filter((a) => a.wave === n);
}

export function findAsset(kind, id) {
  return MANIFEST.find((a) => a.kind === kind && a.id === id) || null;
}
