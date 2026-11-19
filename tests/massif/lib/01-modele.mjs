// Batterie 01 (commandes à emporter) : MODÈLE INDÉPENDANT du serveur.
// Rien n'est importé de serveur/ : le catalogue est lu comme un simple fichier JSON (api/data/catalogue.json) et les règles
// (prix d'une ligne, suppléments rendus gratuits par un retrait, promotion « 1 pizza achetée = 1 offerte ») sont réécrites ici
// à partir de leur énoncé métier. Si le serveur et ce modèle divergent, c'est une anomalie à examiner (test ou produit).
import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';

export const CATALOGUE = JSON.parse(readFileSync(new URL('../../../api/data/catalogue.json', import.meta.url), 'utf8'));

export const TAILLES = ['Solo', 'Duo', 'Quatro', 'XXL'];
export const PIZZAS = CATALOGUE.products.filter((p) => p.kind === 'pizza');
export const PRODUITS = CATALOGUE.products.filter((p) => p.kind === 'product');
export const GROUPES = CATALOGUE.supplement_groups;
/** Pizzas qu'on peut mettre en 2e moitié / pizzas dont la ligne peut être en moitié-moitié. */
export const EN_MOITIE = PIZZAS.filter((p) => p.half_flavor);
export const AVEC_MOITIE = PIZZAS.filter((p) => p.half_allowed);

export const pizza = (nom) => PIZZAS.find((p) => p.name === nom);
export const produit = (nomLigne) => PRODUITS.find((p) => p.line_name === nomLigne);

// ---------------------------------------------------------------------------------------------------------------- hasard
/** Générateur pseudo-aléatoire reproductible (mulberry32) : même graine = mêmes commandes. */
export function rng(graine) {
  let a = graine >>> 0;
  const f = () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  f.entier = (min, max) => min + Math.floor(f() * (max - min + 1));
  f.choix = (tab) => tab[Math.floor(f() * tab.length)];
  f.vrai = (p = 0.5) => f() < p;
  f.melanger = (tab) => {
    const t = [...tab];
    for (let i = t.length - 1; i > 0; i--) { const j = Math.floor(f() * (i + 1)); [t[i], t[j]] = [t[j], t[i]]; }
    return t;
  };
  return f;
}

// ---------------------------------------------------------------------------------------------------------------- textes
const sansAccent = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '');
/** Forme de comparaison d'un nom : sans accent, minuscule, apostrophes droites, espaces réduits. */
export const cle = (s) => sansAccent(s).toLowerCase().replace(/œ/g, 'oe').replace(/[’‘`´]/g, "'").replace(/\s+/g, ' ').trim();
/** trim() de PHP : seulement espace, tabulation, saut de ligne, retour chariot, NUL, tabulation verticale. */
export const trimPhp = (s) => String(s).replace(/^[ \t\n\r\0\x0B]+|[ \t\n\r\0\x0B]+$/g, '');
export const points = (s) => Array.from(String(s)).length;
const maj1 = (s) => { const c = Array.from(s); return c.length ? c[0].toUpperCase() + c.slice(1).join('') : ''; };
/** Exactement 300 points de code (ni plus ni moins) à partir d'un motif répété. */
export function exactement(n, motif) {
  const m = Array.from(motif);
  const sortie = [];
  while (sortie.length < n) sortie.push(m[sortie.length % m.length]);
  return sortie.join('');
}

/** Jour parisien (AAAA-MM-JJ) d'un instant, calculé ici (pas d'import du serveur). */
export function jourParis(date = new Date()) {
  const parts = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const v = (t) => parts.find((x) => x.type === t).value;
  return `${v('year')}-${v('month')}-${v('day')}`;
}

// ---------------------------------------------------------------------------------------------------------------- prix
const GROUPE_DE = new Map();
GROUPES.forEach((g, gi) => g.names.forEach((n) => GROUPE_DE.set(n.toLowerCase(), gi)));
/** Groupe de suppléments (0 : légumes et sauces, 1 : viandes, poissons et fromages) d'un nom, -1 s'il n'en fait pas partie. */
export function groupeDe(nom) {
  const k = String(nom).toLowerCase().replace(/\*$/, '').trim();
  return GROUPE_DE.has(k) ? GROUPE_DE.get(k) : -1;
}

/**
 * Prix unitaire d'une ligne. Pizza : prix de la taille + suppléments (prix du groupe pour la taille). Chaque ingrédient RETIRÉ
 * (présent sur la pizza ou sur sa 2e moitié, compté une seule fois) rend gratuit le premier supplément suivant du même groupe.
 * Autre produit : prix fixe. Renvoie { unit, extras: [prix de chaque supplément] }.
 */
export function prixLigne(p, taille, { retraits = [], supplements = [], autre = null } = {}) {
  if (p.kind !== 'pizza') return { unit: p.price_cents, extras: [] };
  const presents = new Set([...p.ingredients, ...(autre ? autre.ingredients : [])].map(cle));
  const credits = GROUPES.map(() => 0);
  const vus = new Set();
  for (const r of retraits) {
    const k = cle(r);
    if (!presents.has(k) || vus.has(k)) continue;
    vus.add(k);
    const g = groupeDe(r);
    if (g >= 0) credits[g]++;
  }
  let unit = p.prices_by_size[taille];
  const extras = [];
  for (const nom of supplements) {
    const g = groupeDe(nom);
    if (g < 0) throw new Error('Supplément inconnu : ' + nom);
    let prix = GROUPES[g].prices_by_size[taille];
    if (credits[g] > 0) { credits[g]--; prix = 0; }
    extras.push(prix);
    unit += prix;
  }
  return { unit, extras };
}

/**
 * Promotion à emporter, formulation « depuis la pizza la moins chère » : les prix unitaires (une entrée par pizza, quantités
 * dépliées) sont triés du plus petit au plus grand ; sur n pizzas, la moins chère de chaque paire (paires formées du plus cher au
 * moins cher, la moins chère restant seule si n est impair) est offerte, soit les rangs i tels que i et n ont la même parité.
 */
export function remiseAEmporter(prixPizzas) {
  const a = [...prixPizzas].sort((x, y) => x - y);
  const n = a.length;
  let remise = 0;
  for (let i = 0; i < n; i++) if (i % 2 === n % 2) remise += a[i];
  return remise;
}

/** Même règle, formulation directe (tri décroissant puis paires voisines) : sert à vérifier l'autre formulation. */
export function remiseDirecte(prixPizzas) {
  const d = [...prixPizzas].sort((x, y) => y - x);
  let remise = 0;
  for (let i = 0; i + 1 < d.length; i += 2) remise += d[i + 1];
  return remise;
}

// ---------------------------------------------------------------------------------------------------------------- lignes
const SEPARATEURS = { exact: ' — ', min: ' – ', ascii: ' - ', asciimin: ' - ', maj: '—', espaces: ' — ', espaces2: ' — ' };

function styler(texte, style) {
  switch (style) {
    case 'min': return texte.toLowerCase();
    case 'maj': return texte.toUpperCase();
    case 'ascii': return sansAccent(texte);
    case 'asciimin': return sansAccent(texte).toLowerCase();
    case 'espaces2': return texte.replace(/ /g, '  ');
    default: return texte;
  }
}

/** Nom canonique attendu d'une ligne (celui du catalogue ; garniture ou base en capitale initiale). */
export function nomCanonique(p, garniture = null) {
  return garniture ? `${p.line_name} — ${maj1(garniture)}` : p.line_name;
}

/** Nom tel qu'on l'ENVOIE : casse, accents, séparateur et espaces varient, mais désignent le même article. */
function nomEnvoye(p, garniture, style) {
  const base = styler(p.line_name, style);
  const nom = garniture ? base + SEPARATEURS[style] + styler(maj1(garniture), style) : base;
  return style === 'espaces' ? `  ${nom} \t` : nom;
}

/**
 * Construit une ligne : { envoye (ce qu'on poste), attendu (ce que les 4 vues doivent montrer), ... }.
 * Options : p (produit du catalogue), taille ('' pour un produit sans taille), qty, garniture (choix de la calzone ou base),
 * retraits (ingrédients retirés, tels qu'écrits sur la carte), supplements (noms), moitie (pizza de la 2e moitié),
 * note, style (variante d'écriture du nom), styleMoitie, styleSupp ('exact' | 'min' | 'etoile'), parasites (champs en trop).
 */
export function ligne(o) {
  const { p, taille = '', qty = 1, garniture = null, retraits = [], supplements = [], moitie = null, note = '',
    style = 'exact', styleMoitie = 'exact', styleSupp = 'exact', parasites = null } = o;
  const estPizza = p.kind === 'pizza';
  if (estPizza && !TAILLES.includes(taille)) throw new Error(`Taille invalide pour ${p.line_name} : ${taille}`);
  if (!estPizza && taille !== '') throw new Error(`Un produit sans taille ne prend pas de taille : ${p.line_name}`);
  if (p.choice && p.choice.required && !garniture) throw new Error(`Garniture obligatoire : ${p.line_name}`);
  if (garniture && !(p.choice && p.choice.options.includes(garniture))) throw new Error(`Garniture inconnue : ${garniture}`);
  if (moitie && (!p.half_allowed || taille === 'Solo' || !moitie.half_flavor)) throw new Error(`Moitié-moitié impossible : ${p.name} / ${moitie.name} (${taille})`);
  if (supplements.length && !estPizza) throw new Error('Supplément sur un produit sans taille');
  const permis = new Set([...p.ingredients, ...(moitie ? moitie.ingredients : []), ...(garniture ? [garniture] : [])].map(cle));
  for (const r of retraits) if (!permis.has(cle(r))) throw new Error(`Retrait absent de la fiche : ${r} (${p.line_name})`);

  const { unit, extras } = prixLigne(p, taille, { retraits, supplements, autre: moitie });
  const suppEnvoyes = supplements.map((nom, k) => ({
    name: styleSupp === 'min' ? nom.toLowerCase() : styleSupp === 'etoile' ? nom + '*' : nom,
    price_cents: extras[k],
    qty: 1
  }));
  const envoye = {
    name: nomEnvoye(p, garniture, style),
    variant: taille,
    qty,
    unit_price_cents: unit,
    removed: [...retraits],
    extras: suppEnvoyes,
    half: moitie ? { flavor1: styler(p.name, styleMoitie), flavor2: styler(moitie.name, styleMoitie) } : null,
    note
  };
  const attendu = {
    name: nomCanonique(p, garniture),
    variant: taille,
    qty,
    unit_price_cents: unit,
    line_total_cents: unit * qty,
    removed: retraits.map(trimPhp),
    extras: suppEnvoyes.map((e) => ({ name: trimPhp(e.name), price_cents: e.price_cents, qty: 1 })),
    half: moitie ? { flavor1: p.name, flavor2: moitie.name } : null,
    note: trimPhp(note)
  };
  return { envoye: parasites ? { ...envoye, ...parasites } : envoye, attendu, produit: p, taille, garniture, moitie };
}

// ---------------------------------------------------------------------------------------------------------------- commandes
/** Totaux à emporter d'après les lignes attendues : brut, promotion (calcul ci-dessus), pas de frais de livraison. */
export function totauxEmporter(lignes) {
  let brut = 0;
  const prix = [];
  for (const { attendu: a } of lignes) {
    brut += a.unit_price_cents * a.qty;
    if (a.variant !== '') for (let i = 0; i < a.qty; i++) prix.push(a.unit_price_cents);
  }
  const promo = remiseAEmporter(prix);
  return { products_cents: brut, promo_cents: promo, delivery_fee_cents: 0, total_cents: brut - promo, nbPizzas: prix.length };
}

/** Commande à emporter complète (corps à poster + valeurs attendues). La clé d'envoi est fixée plus tard par l'exécuteur. */
export function commande(id, famille, lignes, { extra = {}, total = null } = {}) {
  const t = totauxEmporter(lignes);
  return {
    id, famille, lignes,
    corps: {
      idempotency_key: null,
      mode: 'pickup',
      payment_methods: [],
      cash_change_for: null,
      items: lignes.map((l) => l.envoye),
      delivery_fee_cents: 0,
      total_cents: total === null ? t.total_cents : total,
      ...extra
    },
    attendu: {
      items: lignes.map((l) => l.attendu),
      products_cents: t.products_cents,
      promo_cents: t.promo_cents,
      delivery_fee_cents: 0,
      total_cents: t.total_cents,
      nbPizzas: t.nbPizzas,
      nbLignes: lignes.length,
      nbArticles: lignes.reduce((s, l) => s + l.attendu.qty, 0)
    }
  };
}

// ---------------------------------------------------------------------------------------------------------------- comparaisons
/** Premier écart entre une valeur attendue et une valeur observée (JSON), ou null si elles sont identiques. */
export function ecart(attendu, observe, chemin = '') {
  if (isDeepStrictEqual(attendu, observe)) return null;
  if (attendu !== null && observe !== null && typeof attendu === 'object' && typeof observe === 'object' && Array.isArray(attendu) === Array.isArray(observe)) {
    const cles = new Set([...Object.keys(attendu), ...Object.keys(observe)]);
    for (const k of cles) {
      const e = ecart(attendu[k], observe[k], chemin + (Array.isArray(attendu) ? `[${k}]` : '.' + k));
      if (e) return e;
    }
  }
  return `${chemin || '(racine)'} : attendu ${JSON.stringify(attendu)} ≠ observé ${JSON.stringify(observe)}`.slice(0, 320);
}

export function stats(valeurs) {
  const v = [...valeurs].sort((a, b) => a - b);
  const q = (p) => v.length ? v[Math.min(v.length - 1, Math.floor(p * v.length))] : 0;
  return { n: v.length, min: v[0] ?? 0, p50: q(0.5), p95: q(0.95), p99: q(0.99), max: v[v.length - 1] ?? 0 };
}
