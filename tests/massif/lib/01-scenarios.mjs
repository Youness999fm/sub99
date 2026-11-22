// Batterie 01 (commandes à emporter) : les scénarios. Tout est déterministe (graine fixe) et vient du modèle indépendant
// (01-modele.mjs) : chaque commande porte le corps à poster ET le résultat attendu (lignes canoniques, totaux, promotion).
import {
  PIZZAS, PRODUITS, GROUPES, TAILLES, EN_MOITIE, AVEC_MOITIE, pizza, produit, ligne, commande, groupeDe, cle, rng, exactement, points
} from './01-modele.mjs';

export const STYLES = ['exact', 'min', 'ascii', 'maj', 'espaces', 'asciimin', 'espaces2'];
const CATEGORIES_PERSONNALISABLES = new Set(['pates', 'subitowichs']);

const exact300 = (motif) => {
  let s = Array.from(exactement(300, motif));
  if (/\s/u.test(s[0])) s[0] = 'A';
  if (/\s/u.test(s[299])) s[299] = '.';
  s = s.join('');
  if (points(s) !== 300) throw new Error('Note de 300 caractères mal construite');
  return s;
};

/** Remarques de toutes sortes. Les `trimPhp` sont attendues : le serveur retire les blancs de bord (comme trim de PHP). */
export const NOTES = {
  simple: 'Sans oignons svp',
  accents: 'Très croustillante, bien cuite, à découper en huit — c’est pour l’anniversaire d’Éloïse !',
  apostrophes: "L'adresse de l'immeuble : c'est l'entrée à droite, code 1234A. N’oubliez pas l’apostrophe typographique.",
  emoji: 'Merci 🙏🍕🔥 à ce soir 😀 👨‍👩‍👧‍👦 🇫🇷',
  ascii300: exact300('abcdefghij '),
  accents300: exact300('éèàçôêîûœ'),
  emoji300: exact300('🍕'),
  mixte300: exact300("Très bien cuite, l'été 🍕 « ok » "),
  json: 'Dis "bonjour" \\ au chef {"a":1} [x] \\n \\t \\u00e9',
  sql: "'; DROP TABLE orders; --  Robert'); DELETE FROM order_items;--  \\' OR 1=1",
  html: '<b>gras</b> <script>alert(1)</script> &amp; &lt;img src=x onerror=alert(1)&gt;',
  retours: 'ligne 1\nligne 2\tcolonne\r\nligne 3',
  espaces: '   décalé avec espaces   ',
  nfd: 'école  ñ  ü',
  langues: 'مرحبا 你好 こんにちは Привет',
  symboles: "100% _ \\n LIKE '%' $1 $2 ?",
  court299: exactement(299, 'bonjour') + '           ',
  trois00espace: exactement(300, 'x') + ' ',
  blancs: '   ',
  controle: 'a​b c d\u0001e\u007f'
};
const NOTES_COURTES = ['Sans oignons svp', 'Bien cuite', 'Couper en 8', 'Sonnez 2 fois', 'Digicode 1234A', 'Merci !', 'Très croustillante', "C'est pour l'anniversaire d'Éloïse 🎂"];

// ---------------------------------------------------------------------------------------------------------------- aides
/** Ingrédients de la fiche qui appartiennent au groupe de suppléments g. */
const ingG = (p, g) => p.ingredients.filter((i) => groupeDe(i) === g);
const surLaFiche = (p, ing) => p.ingredients.map(cle).includes(cle(ing));
const garnitureAuto = (r, p) => (p.choice && p.choice.required ? r.choix(p.choice.options) : null);

/** Ligne : garniture imposée par le catalogue tirée au hasard si l'appelant n'en donne pas. */
function L(r, p, taille, o = {}) {
  const garniture = Object.prototype.hasOwnProperty.call(o, 'garniture') ? o.garniture : garnitureAuto(r, p);
  return ligne({ p, taille, ...o, garniture });
}

/** Noms de suppléments distincts, un par entrée du motif (0 : légumes et sauces, 1 : viandes, poissons et fromages). */
function supplementsPour(r, motif) {
  const pris = new Set();
  return motif.map((g) => {
    let nom;
    do { nom = r.choix(GROUPES[g].names); } while (pris.has(nom.toLowerCase()));
    pris.add(nom.toLowerCase());
    return nom;
  });
}

const trouver = (pred, rang = 0) => { const l = PIZZAS.filter(pred); if (!l.length) throw new Error('Aucune pizza ne convient'); return l[rang % l.length]; };

// ---------------------------------------------------------------------------------------------------------------- A. matrice
const DECORS = ['simple', 's1', 's2', 's3', 'r1', 'r2', 'credit', 'moitie', 'moitieCredit', 'note', 'qty', 'style'];

function optionsDecor(r, p, t, d) {
  const autres = EN_MOITIE.filter((h) => h.name !== p.name);
  const peutMoitie = p.half_allowed && t !== 'Solo';
  const repli = () => ({ note: r.choix(NOTES_COURTES) });
  switch (d) {
    case 's1': return { supplements: supplementsPour(r, [r.entier(0, 1)]) };
    case 's2': return { supplements: supplementsPour(r, [0, 1]) };
    case 's3': return { supplements: supplementsPour(r, r.choix([[0, 1, 0], [1, 1, 0], [0, 1, 1], [1, 0, 1]])) };
    case 'r1': return { retraits: r.melanger(p.ingredients).slice(0, 1) };
    case 'r2': return { retraits: r.melanger(p.ingredients).slice(0, 2), note: r.choix(NOTES_COURTES) };
    case 'credit': {
      const g = [0, 1].filter((x) => ingG(p, x).length);
      if (!g.length) return repli();
      const gg = r.choix(g);
      return { retraits: [r.choix(ingG(p, gg))], supplements: supplementsPour(r, [gg]) };
    }
    case 'moitie': return peutMoitie ? { moitie: r.choix(autres) } : repli();
    case 'moitieCredit': {
      if (!peutMoitie) return repli();
      const h = r.choix(autres);
      const cands = [0, 1].flatMap((g) => ingG(h, g).filter((i) => !surLaFiche(p, i)).map((i) => ({ g, i })));
      if (!cands.length) return { moitie: h };
      const c = r.choix(cands);
      return { moitie: h, retraits: [c.i], supplements: supplementsPour(r, [c.g]) };
    }
    case 'note': return repli();
    case 'qty': return { qty: r.entier(2, 4), retraits: r.melanger(p.ingredients).slice(0, r.entier(0, 1)) };
    case 'style': return { style: r.choix(STYLES.slice(1)), supplements: supplementsPour(r, [r.entier(0, 1)]), styleSupp: r.choix(['exact', 'min']) };
    default: return {};
  }
}

/** 31 pizzas x 4 tailles : une commande par combinaison, chacune avec une « décoration » (suppléments, retraits, moitié, note…). */
export function famMatrice(r) {
  const combos = [];
  PIZZAS.forEach((p, i) => TAILLES.forEach((t, j) => combos.push({ p, t, i, j })));
  const etiquettes = r.melanger(combos.map((_, k) => DECORS[k % DECORS.length]));
  return combos.map((c, k) => {
    const d = etiquettes[k];
    return commande(`A-${c.p.name}-${c.t}-${d}`, 'matrice', [L(r, c.p, c.t, optionsDecor(r, c.p, c.t, d))]);
  });
}

// ---------------------------------------------------------------------------------------------------------------- B. produits
/** Les 26 produits hors pizza, un par commande (quantités variées, retraits sur pâtes et subitowichs, variantes d'écriture). */
export function famProduits(r) {
  const QTES = [1, 2, 1, 3, 1, 2, 5, 1, 4, 1, 2];
  return PRODUITS.map((p, i) => {
    const retraits = CATEGORIES_PERSONNALISABLES.has(p.category) ? p.ingredients.slice(0, i % 3) : [];
    return commande(`B-${p.line_name}`, 'produits', [L(r, p, '', {
      qty: QTES[i % QTES.length], style: STYLES[i % STYLES.length], retraits, note: i % 3 === 0 ? 'Sans couverts' : ''
    })]);
  });
}

// ---------------------------------------------------------------------------------------------------------------- C. quantités 1 à 20
/** Une pizza en quantité q, pour q de 1 à 20 (la promotion porte alors sur q pizzas identiques). */
export function famQuantites(r) {
  const out = [];
  for (let q = 1; q <= 20; q++) {
    const p = PIZZAS[(q * 7) % PIZZAS.length];
    const t = TAILLES[q % 4];
    const o = { qty: q };
    if (q % 3 === 0) o.supplements = supplementsPour(r, [r.entier(0, 1)]);
    if (q % 5 === 0) o.retraits = [r.choix(p.ingredients)];
    if (q % 4 === 0) o.note = r.choix(NOTES_COURTES);
    out.push(commande(`C-qty${q}-${p.name}-${t}`, 'quantites', [L(r, p, t, o)]));
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------- D. suppléments
const MOTIFS_SUPPLEMENTS = [[0], [1], [0, 1], [0, 0], [1, 1], [0, 1, 0], [1, 1, 1], [0, 0, 0]];

/** Suppléments (1 à 3 dans chaque groupe et chaque taille, puis plus) et suppléments rendus gratuits par un retrait du même groupe. */
export function famSupplements(r) {
  const out = [];
  let n = 0;
  for (const motif of MOTIFS_SUPPLEMENTS) {
    for (const t of TAILLES) {
      const p = PIZZAS[(n * 5 + 3) % PIZZAS.length];
      n++;
      out.push(commande(`D-s${motif.join('')}-${t}-${p.name}`, 'supplements', [L(r, p, t, { supplements: supplementsPour(r, motif) })]));
    }
  }
  out.push(commande('D-s6-XXL', 'supplements', [L(r, pizza('Subito'), 'XXL', { supplements: supplementsPour(r, [0, 0, 1, 1, 0, 1]) })]));
  out.push(commande('D-s7-Quatro', 'supplements', [L(r, pizza('Carnivora'), 'Quatro', { supplements: supplementsPour(r, [1, 1, 1, 0, 0, 0, 1]) })]));
  out.push(commande('D-etoile', 'supplements', [L(r, pizza('Régina'), 'Duo', { supplements: ['jambon', 'Champignons'], styleSupp: 'etoile' })]));

  // ---- retraits qui rendent gratuit un supplément du même groupe
  const avecG0 = (k = 0) => trouver((p) => ingG(p, 0).length >= 1, k);
  const avecG1 = (k = 0) => trouver((p) => ingG(p, 1).length >= 1, k);
  const credit = (nom, p, t, o) => out.push(commande(`D-credit-${nom}-${t}-${p.name}`, 'credits', [L(r, p, t, o)]));
  TAILLES.forEach((t, k) => {
    // un retrait, un supplément du même groupe : gratuit
    let p = avecG0(k);
    credit('1g0', p, t, { retraits: [r.choix(ingG(p, 0))], supplements: supplementsPour(r, [0]) });
    p = avecG1(k);
    credit('1g1', p, t, { retraits: [r.choix(ingG(p, 1))], supplements: supplementsPour(r, [1]) });
    // deux retraits, trois suppléments du groupe : deux gratuits, un payé
    p = trouver((x) => ingG(x, 0).length >= 2, k);
    credit('2r3s-g0', p, t, { retraits: r.melanger(ingG(p, 0)).slice(0, 2), supplements: supplementsPour(r, [0, 0, 0]) });
    p = trouver((x) => ingG(x, 1).length >= 2, k);
    credit('2r3s-g1', p, t, { retraits: r.melanger(ingG(p, 1)).slice(0, 2), supplements: supplementsPour(r, [1, 1, 1]) });
  });
  let p = avecG0(2);
  credit('1r2s-g0', p, 'Duo', { retraits: [r.choix(ingG(p, 0))], supplements: supplementsPour(r, [0, 0]) });
  // jamais d'un groupe à l'autre, ni sans groupe
  p = avecG0(1);
  credit('croise-g0-g1', p, 'Quatro', { retraits: [r.choix(ingG(p, 0))], supplements: supplementsPour(r, [1]) });
  p = avecG1(1);
  credit('croise-g1-g0', p, 'XXL', { retraits: [r.choix(ingG(p, 1))], supplements: supplementsPour(r, [0]) });
  p = trouver((x) => x.ingredients.some((i) => cle(i) === 'fromage'));
  credit('sans-groupe', p, 'Duo', { retraits: ['fromage'], supplements: supplementsPour(r, [0, 1]) });
  // les deux groupes à la fois
  p = trouver((x) => ingG(x, 0).length >= 1 && ingG(x, 1).length >= 1);
  credit('g0+g1', p, 'XXL', { retraits: [r.choix(ingG(p, 0)), r.choix(ingG(p, 1))], supplements: supplementsPour(r, [1, 0]) });
  // un retrait écrit deux fois ne couvre qu'un supplément
  p = pizza('Végétarienne');
  credit('doublon', p, 'Quatro', { retraits: ['oignons', 'oignons'], supplements: ['olives', 'poivrons'] });
  // « Sauce tomate » (majuscule de la fiche) et « OIGNONS » (majuscules) : même groupe
  credit('majuscule-fiche', pizza('Régina'), 'Solo', { retraits: ['Sauce tomate'], supplements: ['olives'] });
  credit('majuscules', pizza('Végétarienne'), 'Duo', { retraits: ['OIGNONS'], supplements: ['miel'] });
  // moitié-moitié : le retrait porte sur la 2e moitié
  const h = pizza('4 Fromages');
  credit('moitie-2e', pizza('Végétarienne'), 'XXL', { moitie: h, retraits: ['brie'], supplements: ['jambon'] });
  credit('moitie-2e-g0', pizza('Régina'), 'Duo', { moitie: pizza('Végétarienne'), retraits: ['poivrons', 'olives'], supplements: ['miel', 'sauce curry', 'câpres'] });
  return out;
}

// ---------------------------------------------------------------------------------------------------------------- E. retraits
export function famRetraits(r) {
  const out = [];
  const R = (nom, p, t, o) => out.push(commande(`E-${nom}-${p.line_name}-${t}`, 'retraits', [L(r, p, t, o)]));
  R('un', pizza('Napolitaine'), 'Solo', { retraits: ['câpres'] });
  R('deux', pizza('Chicken'), 'Duo', { retraits: ['poivrons', 'champignons'] });
  R('trois', pizza('Orientale'), 'Quatro', { retraits: ['merguez', 'oignons', 'oeuf'] });
  R('tous-4', pizza('Régina'), 'XXL', { retraits: [...pizza('Régina').ingredients] });
  R('tous-7', pizza("L'Extravagante"), 'Quatro', { retraits: [...pizza("L'Extravagante").ingredients] });
  R('tous-calzone', pizza('Calzone (soufflée)'), 'Duo', { retraits: [...pizza('Calzone (soufflée)').ingredients], garniture: 'thon' });
  R('apostrophe-typo', pizza('Calzone (soufflée)'), 'Solo', { retraits: ['jaune d’œuf'], garniture: 'kebab' });
  R('moitie-deux-cotes', pizza('Kebab'), 'Duo', { moitie: pizza('Fruits de mer'), retraits: ['kebab', 'ail', 'persil'] });
  R('espaces', pizza('Végétarienne'), 'Duo', { retraits: [' oignons ', '\tolives'] });
  R('marguerita', pizza('Marguerita (base)'), 'Quatro', { retraits: ['fromage'], garniture: 'crème fraîche' });
  const P = (nom, p, o) => out.push(commande(`E-${nom}-${p.line_name}`, 'retraits', [L(r, p, '', o)]));
  P('pates', produit('Pâtes Bolognaise'), { retraits: ['Sauce tomate', 'oignons'] });
  P('subitowich', produit('Subitowich 4 fromages'), { retraits: ['brie', 'bleu'], qty: 2 });
  P('salade', produit('Salade Niçoise'), { retraits: ['thon', 'tomates'], note: 'Sans sauce' });
  return out;
}

// ---------------------------------------------------------------------------------------------------------------- F. moitié-moitié
/** Chacune des 29 pizzas qui acceptent la moitié-moitié, en Duo, Quatro et XXL, avec une autre pizza en 2e moitié. */
export function famMoitie(r) {
  const out = [];
  const tailles = ['Duo', 'Quatro', 'XXL'];
  AVEC_MOITIE.forEach((p, i) => {
    const autres = EN_MOITIE.filter((h) => h.name !== p.name);
    const h = autres[(i * 3 + Math.floor(i / 3)) % autres.length];
    const t = tailles[i % 3];
    const o = { moitie: h, styleMoitie: ['exact', 'min', 'maj', 'ascii'][i % 4] };
    if (i % 4 === 1) o.retraits = [r.choix(h.ingredients)];
    if (i % 5 === 2) o.supplements = supplementsPour(r, [r.entier(0, 1)]);
    out.push(commande(`F-${p.name}-${h.name}-${t}`, 'moitie', [L(r, p, t, o)]));
  });
  return out;
}

// ---------------------------------------------------------------------------------------------------------------- G. garnitures à choisir
/** Calzone (5 garnitures x 4 tailles) et Marguerita (base : aucune, sauce tomate ou crème fraîche, x 4 tailles). */
export function famChoix(r) {
  const out = [];
  let k = 0;
  const calzone = pizza('Calzone (soufflée)');
  for (const g of calzone.choice.options) for (const t of TAILLES) {
    out.push(commande(`G-calzone-${g}-${t}`, 'choix', [L(r, calzone, t, { garniture: g, style: STYLES[k++ % STYLES.length] })]));
  }
  const marg = pizza('Marguerita (base)');
  for (const g of [null, ...marg.choice.options]) for (const t of TAILLES) {
    out.push(commande(`G-marguerita-${g ?? 'sans'}-${t}`, 'choix', [L(r, marg, t, { garniture: g, style: STYLES[k++ % STYLES.length], supplements: k % 3 === 0 ? supplementsPour(r, [r.entier(0, 1)]) : [] })]));
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------- H. remarques
export function famNotes(r) {
  const out = [];
  const cles = Object.keys(NOTES);
  cles.forEach((nom, i) => {
    const p = PIZZAS[(i * 3 + 1) % PIZZAS.length];
    out.push(commande(`H-note-${nom}`, 'notes', [L(r, p, TAILLES[i % 4], { note: NOTES[nom] })]));
  });
  // remarques de 300 caractères exactement sur un produit sans taille et sur une moitié-moitié
  out.push(commande('H-note-emoji300-produit', 'notes', [L(r, produit('Canette Oasis pomme poire'), '', { note: NOTES.emoji300, qty: 3 })]));
  out.push(commande('H-note-accents300-moitie', 'notes', [L(r, pizza('Pollame'), 'XXL', { note: NOTES.accents300, moitie: pizza('Savoyarde') })]));
  // une ligne par type de remarque, dans la même commande
  out.push(commande('H-note-toutes-en-une', 'notes', cles.map((nom, i) => L(r, i % 2 ? PIZZAS[(i * 5) % PIZZAS.length] : PRODUITS[i % PRODUITS.length], i % 2 ? TAILLES[i % 4] : '', { note: NOTES[nom] }))));
  return out;
}

// ---------------------------------------------------------------------------------------------------------------- I. limites hautes
export function famLimites(r) {
  const out = [];
  // 40 lignes, 40 articles : les 26 produits et 14 pizzas, dans un ordre mélangé
  const lignes40 = (qte) => {
    const pizzasChoisies = r.melanger(PIZZAS).slice(0, 14);
    const emplacements = r.melanger(Array.from({ length: 40 }, (_, i) => i)).slice(0, 14);
    let ip = 0;
    let ia = 0;
    return Array.from({ length: 40 }, (_, i) => {
      const q = qte(i);
      if (emplacements.includes(i)) { const p = pizzasChoisies[ip]; return L(r, p, TAILLES[ip++ % 4], { qty: q }); }
      return L(r, PRODUITS[ia++], '', { qty: q });
    });
  };
  out.push(commande('I-40lignes-40articles', 'limites', lignes40(() => 1)));
  out.push(commande('I-40lignes-60articles', 'limites', lignes40((i) => (i < 20 ? 2 : 1))));
  // 60 articles en 3 lignes de 20
  out.push(commande('I-60articles-3pizzas', 'limites', [
    L(r, pizza('Carnivora'), 'XXL', { qty: 20 }), L(r, pizza('Régina'), 'Duo', { qty: 20 }), L(r, pizza('Napolitaine'), 'Solo', { qty: 20 })
  ]));
  out.push(commande('I-60articles-sans-pizza', 'limites', [
    L(r, produit('Canette Oasis pomme poire'), '', { qty: 20 }), L(r, produit('Maxi Coca'), '', { qty: 20 }), L(r, produit('Dessert Tiramisubito Oreo'), '', { qty: 20 })
  ]));
  // 40 lignes qui portent chacune une remarque de 300 caractères (accents)
  out.push(commande('I-40lignes-notes300', 'limites', lignes40(() => 1).map((l0, i) => L(r, l0.produit, l0.taille, { garniture: l0.garniture, note: i % 2 ? NOTES.accents300 : NOTES.mixte300 }))));
  // 40 lignes avec chacune une remarque de 300 emoji (4 octets chacun) : le corps approche la limite de 64 Ko sans la dépasser
  out.push(commande('I-40lignes-emoji300', 'limites', lignes40(() => 1).map((l0) => L(r, l0.produit, l0.taille, { garniture: l0.garniture, note: NOTES.emoji300 }))));
  // 20 lignes de 3 articles
  out.push(commande('I-20lignes-x3', 'limites', Array.from({ length: 20 }, (_, i) => (i % 2 ? L(r, PRODUITS[i], '', { qty: 3 }) : L(r, PIZZAS[(i * 3) % PIZZAS.length], TAILLES[i % 4], { qty: 3 })))));
  // 40 pizzas, chacune avec 3 suppléments et 1 à 2 retraits (ligne lourde x 40)
  out.push(commande('I-40lignes-lourdes', 'limites', Array.from({ length: 40 }, (_, i) => {
    const p = PIZZAS[i % PIZZAS.length];
    return L(r, p, TAILLES[(i + 1) % 4], { supplements: supplementsPour(r, [0, 1, i % 2]), retraits: r.melanger(p.ingredients).slice(0, 1 + (i % 2)) });
  })));
  return out;
}

// ---------------------------------------------------------------------------------------------------------------- J. promotion
/** « 1 pizza achetée = 1 offerte » avec 2, 3, 4, 5 et 6 pizzas, six compositions chacune (prix et tailles différents). */
export function famPromo(r) {
  const out = [];
  const SOLO_DUO = ['Solo', 'Duo', 'Quatro', 'XXL', 'Solo', 'Duo'];
  const distinctes = (n, exclure = []) => r.melanger(PIZZAS.filter((p) => !exclure.includes(p))).slice(0, n);
  for (let n = 2; n <= 6; n++) {
    // v0 : tailles croissantes, rien d'ajouté
    out.push(commande(`J-${n}pizzas-v0-tailles`, 'promo', distinctes(n).map((p, i) => L(r, p, SOLO_DUO[i]))));
    // v1 : tailles dans l'ordre inverse, avec suppléments qui font varier les prix (un Solo garni peut dépasser un Duo)
    out.push(commande(`J-${n}pizzas-v1-supplements`, 'promo', distinctes(n).map((p, i) => L(r, p, [...SOLO_DUO].reverse()[i + (6 - n)] ?? 'Duo', {
      supplements: i % 2 === 0 ? supplementsPour(r, [1, 1, 1]) : (i % 3 === 1 ? supplementsPour(r, [0]) : [])
    }))));
    // v2 : avec la base Marguerita (prix propres)
    out.push(commande(`J-${n}pizzas-v2-marguerita`, 'promo', [
      L(r, pizza('Marguerita (base)'), TAILLES[n % 4], { garniture: n % 2 ? 'sauce tomate' : null }),
      ...distinctes(n - 1, [pizza('Marguerita (base)')]).map((p, i) => L(r, p, SOLO_DUO[(i + n) % 6]))
    ]));
    // v3 : des quantités (le nombre de pizzas est la somme des quantités)
    const QTES = { 2: [2], 3: [2, 1], 4: [3, 1], 5: [3, 2], 6: [2, 2, 2] }[n];
    out.push(commande(`J-${n}pizzas-v3-quantites`, 'promo', distinctes(QTES.length).map((p, i) => L(r, p, SOLO_DUO[(i * 2 + n) % 6], { qty: QTES[i] }))));
    // v4 : mêlées à des produits sans taille (hors promotion)
    out.push(commande(`J-${n}pizzas-v4-produits`, 'promo', [
      L(r, produit('Canette Oasis pomme poire'), '', { qty: 2 }),
      ...distinctes(n).map((p, i) => L(r, p, SOLO_DUO[(i + 1) % 6])),
      L(r, produit('Dessert Calzone Nutella'), ''), L(r, produit('Pâtes Carbonara'), '', { qty: 2 })
    ]));
    // v5 : moitié-moitié et retraits qui changent les prix
    out.push(commande(`J-${n}pizzas-v5-moitie`, 'promo', distinctes(n).map((p, i) => {
      const t = i === 0 ? 'Duo' : SOLO_DUO[(i + 2) % 6];
      const autre = EN_MOITIE.find((h) => h.name !== p.name && ingG(h, 1).some((x) => !surLaFiche(p, x)) && ingG(h, 1).length > 0);
      if (p.half_allowed && t !== 'Solo' && autre) {
        const x = ingG(autre, 1).find((y) => !surLaFiche(p, y));
        return L(r, p, t, { moitie: autre, retraits: [x], supplements: supplementsPour(r, [1]) });
      }
      return L(r, p, t);
    })));
  }
  // égalité totale des prix, six lignes séparées ; une seule ligne de six
  out.push(commande('J-6pizzas-egalite', 'promo', distinctes(6).map((p) => L(r, p, 'Duo'))));
  out.push(commande('J-6pizzas-une-ligne', 'promo', [L(r, pizza('Subito'), 'Quatro', { qty: 6 })]));
  // « un supplément ne peut jamais réduire la remise » : le Solo garni (11 + 3 x 1,50 = 15,50) passe sous le Duo (16,00)
  out.push(commande('J-2pizzas-solo-garni', 'promo', [
    L(r, pizza('Régina'), 'Solo', { supplements: ['jambon', 'poulet', 'thon'] }), L(r, pizza('Kebab'), 'Duo')
  ]));
  return out;
}

// ---------------------------------------------------------------------------------------------------------------- K. champs en trop
/** Commandes valides mais bourrées de champs parasites : ils ne doivent avoir AUCUN effet (statut, jour, paiement, adresse…). */
export function famParasites(r) {
  const out = [];
  const base = () => [L(r, pizza('Régina'), 'Duo'), L(r, produit('Canette Oasis pomme poire'), '', { qty: 2 })];
  out.push(commande('K-statut-id-jour', 'parasites', base(), { extra: {
    id: 424242, status: 'ready', service_day: '1999-01-01', created_at: '2000-01-01T00:00:00Z', accepted_at: '2000-01-01T00:00:00Z',
    prepared_at: '2000-01-01T00:00:00Z', refused_at: null, delay_minutes: 20, ready_at: '2000-01-01T00:00:00Z',
    customer_id: 1, customer_name: 'Pirate', customer_phone: '0000000000', customer_email: 'pirate@example.test',
    products_cents: 1, promo_cents: 99999
  } }));
  out.push(commande('K-adresse-livraison', 'parasites', base(), { extra: {
    delivery_address: { street: '1 rue de la Ruse', city: 'Rouvroy' }, delivery_street: '1 rue de la Ruse', delivery_city: 'Rouvroy', street: 'x', city: 'Rouvroy'
  } }));
  out.push(commande('K-paiement-carte-especes', 'parasites', base(), { extra: { payment_methods: ['card', 'cash'], cash_change_for: 50 } }));
  out.push(commande('K-paiement-invalide', 'parasites', base(), { extra: { payment_methods: ['bitcoin', 42, null], cash_change_for: 'beaucoup' } }));
  out.push(commande('K-paiement-objet-vide', 'parasites', base(), { extra: { payment_methods: {}, cash_change_for: 20 } }));
  out.push(commande('K-lignes-parasites', 'parasites', [
    L(r, pizza('Kebab'), 'Solo', { parasites: { line_total_cents: 1, position: 99, id: 7, order_id: 1, extra: 'x' } }),
    L(r, produit('Pâtes Saumon'), '', { parasites: { line_total_cents: 1, unit_price_cents_serveur: 0, __proto__x: 'y' } })
  ]));
  // clés d'envoi aux limites (8 et 64 caractères)
  const c1 = commande('K-cle-8', 'parasites', base(), { extra: {} });
  c1.cleImposee = 'a1b2-c3d';
  const c2 = commande('K-cle-64', 'parasites', base(), { extra: {} });
  c2.cleImposee = 'k64-' + exactement(60, '0123456789abcdef');
  out.push(c1, c2);
  // ordre des clés mélangé (corps et lignes)
  const m = commande('K-ordre-des-cles', 'parasites', [L(r, pizza('Pollame'), 'Quatro', { supplements: ['miel'], retraits: ['kebab'], note: 'Ordre des clés' }), L(r, produit('Salade Exotique'), '', { qty: 2 })]);
  m.corps = Object.fromEntries(r.melanger(Object.entries(m.corps)).map(([k, v]) => [k, k === 'items' ? v.map((it) => Object.fromEntries(r.melanger(Object.entries(it)))) : v]));
  out.push(m);
  return out;
}

// ---------------------------------------------------------------------------------------------------------------- L. au hasard
/** Une ligne tirée au hasard dans tout ce que le catalogue permet (pizza ou produit, garniture, moitié, retraits, suppléments, écritures variées). */
function ligneAleatoire(r, qty) {
  if (r.vrai(0.2)) {
    const p = r.choix(PRODUITS);
    const retraits = r.vrai(0.3) ? r.melanger(p.ingredients).slice(0, r.entier(0, 3)) : [];
    return ligne({ p, taille: '', qty, retraits, note: r.vrai(0.2) ? r.choix(NOTES_COURTES) : '', style: r.choix(STYLES) });
  }
  const p = r.choix(PIZZAS);
  const taille = r.choix(TAILLES);
  const garniture = p.choice && (p.choice.required || r.vrai(0.5)) ? r.choix(p.choice.options) : null;
  const moitie = p.half_allowed && taille !== 'Solo' && r.vrai(0.4) ? r.choix(EN_MOITIE.filter((h) => h.name !== p.name)) : null;
  const retraits = r.melanger([...p.ingredients, ...(moitie ? moitie.ingredients : [])]).slice(0, r.entier(0, 4));
  if (retraits.length && r.vrai(0.1)) retraits.push(retraits[0]);
  const supplements = r.melanger(GROUPES.flatMap((g) => g.names)).slice(0, r.vrai(0.5) ? 0 : r.entier(1, 5));
  return ligne({
    p, taille, qty, garniture, retraits, supplements, moitie, note: r.vrai(0.25) ? r.choix(NOTES_COURTES) : '',
    style: r.choix(STYLES), styleMoitie: r.choix(['exact', 'min', 'maj', 'ascii']), styleSupp: r.choix(['exact', 'min', 'etoile'])
  });
}

/** n commandes de 1 à 14 lignes tirées au hasard (graine fixe) : tout est calculé par le modèle, jamais par le serveur. */
export function famAleatoire(r, n = 300) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const nl = r.vrai(0.2) ? r.entier(6, 14) : r.entier(1, 5);
    const qtes = Array.from({ length: nl }, () => r.entier(1, r.vrai(0.15) ? 6 : 3));
    while (qtes.reduce((s, q) => s + q, 0) > 60) qtes[qtes.indexOf(Math.max(...qtes))]--;
    out.push(commande(`Z-${i}`, 'aleatoire', qtes.map((q) => ligneAleatoire(r, q))));
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------- ensemble
export function construireScenarios(graine = 20261119, { aleatoires = 300 } = {}) {
  const r = rng(graine);
  return [
    ...famMatrice(r), ...famProduits(r), ...famQuantites(r), ...famSupplements(r), ...famRetraits(r), ...famMoitie(r),
    ...famChoix(r), ...famNotes(r), ...famLimites(r), ...famPromo(r), ...famParasites(r), ...famAleatoire(r, aleatoires)
  ];
}
