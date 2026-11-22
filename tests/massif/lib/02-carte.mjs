// Batterie 02 (livraison) : barème et carte EN DUR (contrôle indépendant du serveur), calcul indépendant des totaux
// (jamais le code du serveur), fabrique de lignes et de paniers, recherche de paniers à montant exact, comparaison des vues.
// Montants en centimes entiers.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

export const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const FICHIER_CATALOGUE = path.join(RACINE, 'api', 'data', 'catalogue.json');

// ---------------------------------------------------------------------------------------------------------------------
// Zones de livraison (recopiées en dur : minimum de commande hors frais, frais s'il n'y a aucune pizza)
export const ZONES = {
  'Hénin-Beaumont': { min: 1000, frais: 550 },
  'Montigny-en-Gohelle': { min: 1500, frais: 550 },
  'Dourges': { min: 1500, frais: 550 },
  'Noyelles-Godault': { min: 1500, frais: 550 },
  'Courrières': { min: 2000, frais: 800 },
  'Billy-Montigny': { min: 2000, frais: 800 },
  'Fouquières-lès-Lens': { min: 2500, frais: 800 },
  'Rouvroy': { min: 2500, frais: 800 }
};
export const VILLES = Object.keys(ZONES);
export const MOYENS = ['card', 'cash', 'ticket', 'ticket_card'];
export const BILLETS = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
export const TAILLES = ['Solo', 'Duo', 'Quatro', 'XXL'];

// ---------------------------------------------------------------------------------------------------------------------
// Carte en dur
const PIZZAS_STANDARD = ['Végétarienne', '3 Jambons', '4 Saisons', 'Campione', 'Kebab', 'Napolitaine', 'Régina', 'Chicken', 'Kefta', 'Neptune',
  '4 Fromages', 'Carnivora', "L'Extravagante", 'Fruits de mer', 'Orientale', 'Pacifico', 'Subito', 'Venezia', 'Chèvre miel', 'Chicken Chika',
  'Milano', 'Normande', 'Fajitas', 'Maroilles', 'Pollame', 'Savoyarde', 'Suisse', 'Indienne', 'Carolina'];

const PRODUITS = {
  'Pâtes Bolognaise': 850, 'Pâtes 3 fromages': 850, 'Pâtes Saumon': 850, 'Pâtes Carbonara': 850,
  'Subitowich Milano': 600, 'Subitowich Vesuvio': 600, 'Subitowich 4 fromages': 600, 'Subitowich Rome': 600,
  'Subitowich Venise': 600, 'Subitowich Norvégien': 600, 'Subitowich Kebab': 600,
  'Tex-Mex Wings (5 pièces)': 500, 'Tex-Mex Tenders (4 pièces)': 500, 'Tex-Mex Nuggets (4 pièces)': 500, 'Tex-Mex Oignon ring (8 pièces)': 500,
  'Salade Exotique': 750, 'Salade Niçoise': 750, 'Salade Printanière': 750, 'Salade Di Roma': 750,
  'Dessert Tiramisubito Spéculoos': 350, 'Dessert Tiramisubito Oreo': 350, "Dessert Tiramisubito M&M's": 350,
  'Dessert Calzone Nutella': 650, 'Dessert Part de Tarte au Daim': 300,
  'Canette Oasis pomme poire': 150, 'Canette Fanta': 150, 'Canette Coca': 150,
  'Canette Coca zéro': 150, 'Canette Tropico': 150, 'Canette Lipton': 150,
  'Canette Oasis PCF': 150,
  'Maxi Coca': 300, 'Maxi Fanta': 300, 'Maxi Tropico': 300
};

const SUPPLEMENTS = [
  {
    noms: ['Champignons', 'artichauts', 'poivrons', 'oignons', 'câpres', 'olives', 'sauce barbecue', 'sauce curry', 'sauce tomate', 'crème fraîche', 'miel'],
    prix: { Solo: 100, Duo: 150, Quatro: 250, XXL: 350 }
  },
  {
    noms: ['Viande hachée', 'mortadelle', 'merguez', 'chorizo', 'kebab', 'jambon', 'lardons', 'poulet', 'anchois', 'thon', 'parmesan', 'brie', 'chèvre', 'bleu', 'reblochon'],
    prix: { Solo: 150, Duo: 200, Quatro: 300, XXL: 400 }
  },
  {
    noms: ['Œuf'],
    prix: { Solo: 100, Duo: 100, Quatro: 200, XXL: 200 }
  }
];

/** Contenu du fichier du catalogue du serveur (données seulement : ingrédients des pizzas, comparaison avec la carte en dur). */
export function lireCatalogueFichier(chemin = FICHIER_CATALOGUE) {
  return JSON.parse(fs.readFileSync(chemin, 'utf8'));
}

/** Carte en dur. `catalogue` ne sert qu'à lire les listes d'ingrédients (retraits). */
export function carteEnDur(catalogue = lireCatalogueFichier()) {
  const std = { Solo: 1100, Duo: 1600, Quatro: 2300, XXL: 3300 };
  const pizzas = {};
  for (const n of PIZZAS_STANDARD) pizzas[n] = { prix: { ...std } };
  const ingredients = {};
  for (const p of catalogue.products) if (p.kind === 'pizza') ingredients[p.name] = p.ingredients.map(String);
  return {
    pizzas,
    calzone: { nom: 'Calzone (soufflée)', prix: { ...std }, garnitures: ['jambon', 'thon', 'kebab', 'viande hachée', 'poulet'] },
    composer: { nom: 'Marguerita (base)', prix: { Solo: 900, Duo: 1300, Quatro: 1750, XXL: 2550 }, bases: ['sauce tomate', 'crème fraîche'] },
    produits: { ...PRODUITS },
    supplements: SUPPLEMENTS.map((g) => ({ noms: [...g.noms], prix: { ...g.prix } })),
    ingredients
  };
}

/** Carte à prix IMPAIRS (catalogue d'essai pour la deuxième partie) : même noms, prix décalés d'un nombre de centimes quelconque. */
export function carteImpaire(rng, catalogue = lireCatalogueFichier()) {
  const c = carteEnDur(catalogue);
  const std = { Solo: 1100, Duo: 1600, Quatro: 2300, XXL: 3300 };
  for (const nom of Object.keys(c.pizzas)) {
    const impair = rng.vrai(0.7);
    for (const t of TAILLES) {
      const delta = impair ? rng.entier(-24, 24) * 2 + 1 : rng.entier(-24, 24) * 2;
      c.pizzas[nom].prix[t] = std[t] + delta;
    }
  }
  c.calzone.prix = { Solo: 1101, Duo: 1601, Quatro: 2301, XXL: 3301 };
  c.composer.prix = { Solo: 899, Duo: 1299, Quatro: 1749, XXL: 2549 };
  c.supplements[0].prix = { Solo: 101, Duo: 149, Quatro: 251, XXL: 349 };
  c.supplements[1].prix = { Solo: 149, Duo: 201, Quatro: 299, XXL: 401 };
  c.supplements[2].prix = { Solo: 99, Duo: 99, Quatro: 199, XXL: 199 };
  const noms = Object.keys(c.produits);
  noms.forEach((n, i) => {
    // un décalage de -3 à +3 centimes, propre à chaque produit
    c.produits[n] = PRODUITS[n] + ((i * 3 + 1) % 7) - 3;
  });
  // Quelques prix de repère pour atteindre n'importe quel centime : boisson à 149, grande bouteille à 301.
  c.produits['Oasis Pomme Poire canette'] = 149;
  c.produits['Maxi Coca'] = 301;
  return c;
}

/** Catalogue au format du serveur (copie du vrai, prix remplacés par ceux de `carte`). */
export function catalogueServeurDepuis(carte, reel = lireCatalogueFichier()) {
  const copie = JSON.parse(JSON.stringify(reel));
  for (const p of copie.products) {
    if (p.kind === 'pizza') {
      if (carte.pizzas[p.name]) p.prices_by_size = { ...carte.pizzas[p.name].prix };
      else if (p.name === carte.calzone.nom) p.prices_by_size = { ...carte.calzone.prix };
      else if (p.name === carte.composer.nom) p.prices_by_size = { ...carte.composer.prix };
      else throw new Error('Pizza inconnue de la carte : ' + p.name);
    } else if (carte.produits[p.line_name] !== undefined) {
      p.price_cents = carte.produits[p.line_name];
    } else {
      throw new Error('Produit inconnu de la carte : ' + p.line_name);
    }
  }
  copie.supplement_groups.forEach((g, i) => { g.prices_by_size = { ...carte.supplements[i].prix }; });
  return copie;
}

// ---------------------------------------------------------------------------------------------------------------------
// Calcul indépendant (centimes entiers)

/**
 * Totaux d'un panier. lignes : [{ variant, qty, unit }] (variant non vide = pizza). zone : { min, frais } (null à emporter).
 * À emporter : dans chaque paire (prix triés du plus cher au moins cher, 1er-2e, 3e-4e…), la moins chère est offerte.
 * Livraison : la moins chère de la paire est à moitié prix ; la REMISE est arrondie vers le haut, paire par paire.
 * Frais de livraison : seulement en livraison et s'il n'y a aucune pizza.
 */
export function calculer(lignes, mode, zone) {
  let brut = 0;
  const prix = [];
  let pizza = false;
  for (const l of lignes) {
    brut += l.unit * l.qty;
    if (l.variant !== '') {
      pizza = true;
      for (let k = 0; k < l.qty; k++) prix.push(l.unit);
    }
  }
  prix.sort((a, b) => b - a);
  let remise = 0;
  const paires = [];
  for (let k = 0; k + 1 < prix.length; k += 2) {
    const r = mode === 'delivery' ? Math.ceil(prix[k + 1] / 2) : prix[k + 1];
    remise += r;
    paires.push([prix[k], prix[k + 1], r]);
  }
  const apres = brut - remise;
  const frais = mode === 'delivery' && !pizza && zone ? zone.frais : 0;
  return {
    brut, remise, apres, frais, total: apres + frais, paires, pizza,
    minimum: mode === 'delivery' && zone ? zone.min : 0,
    minimumAtteint: mode !== 'delivery' || !zone || apres >= zone.min
  };
}

export function calculerLignes(lignes, mode, zone) {
  return calculer(lignes.map((l) => ({ variant: l.variant, qty: l.qty, unit: l.unit })), mode, zone);
}

// ---------------------------------------------------------------------------------------------------------------------
// Lignes

const phpTrim = (s) => String(s).replace(/^[ \t\n\r\0\x0B]+|[ \t\n\r\0\x0B]+$/g, '');
const majuscule = (s) => { const c = Array.from(s); return c.length ? c[0].toUpperCase() + c.slice(1).join('') : ''; };

export function groupeDe(carte, nom) {
  const k = String(nom).toLowerCase().replace(/\*$/, '').trim();
  for (let g = 0; g < carte.supplements.length; g++) if (carte.supplements[g].noms.some((n) => n.toLowerCase() === k)) return g;
  return -1;
}

function fabriquer({ name, canon, variant, qty, unit, removed, extras, half, halfCanon, note }) {
  const noteVue = phpTrim(note);
  return {
    variant, qty, unit,
    envoi: { name, variant, qty, unit_price_cents: unit, removed, extras, half, note },
    attendu: {
      name: canon, variant, qty, unit_price_cents: unit, line_total_cents: unit * qty,
      removed: removed.map(phpTrim), extras, half: halfCanon, note: noteVue
    }
  };
}

/**
 * Ligne de commande à partir d'une description :
 *  { type: 'produit', nom, qty, note }
 *  { type: 'pizza', nom, taille, qty, extras: [noms], retraits: [noms], moitie: nom|null, note }
 *  { type: 'calzone', taille, garniture, qty, extras, retraits, note }       (jamais de moitié-moitié)
 *  { type: 'composer', taille, base: nom|null, qty, extras, retraits, note }
 * Prix unitaire calculé ici, avec la carte en dur : base + suppléments, un supplément du même groupe qu'un ingrédient
 * retiré étant gratuit (un retrait couvre un supplément).
 */
export function ligne(carte, spec) {
  const qty = spec.qty ?? 1;
  const note = spec.note ?? '';
  if (spec.type === 'produit') {
    const unit = carte.produits[spec.nom];
    if (!Number.isInteger(unit)) throw new Error('Produit inconnu : ' + spec.nom);
    return fabriquer({ name: spec.nom, canon: spec.nom, variant: '', qty, unit, removed: [], extras: [], half: null, halfCanon: null, note });
  }
  const taille = spec.taille;
  let nomEnvoye;
  let nomVue;
  let prixBase;
  let ingredients;
  let moitieEnvoi = null;
  let moitieVue = null;
  if (spec.type === 'pizza') {
    if (!carte.pizzas[spec.nom]) throw new Error('Pizza inconnue : ' + spec.nom);
    nomEnvoye = spec.nom;
    nomVue = spec.nom;
    prixBase = carte.pizzas[spec.nom].prix[taille];
    ingredients = carte.ingredients[spec.nom] || [];
    if (spec.moitie) {
      moitieEnvoi = { flavor1: spec.nom, flavor2: spec.moitie };
      moitieVue = { flavor1: spec.nom, flavor2: spec.moitie };
    }
  } else if (spec.type === 'calzone') {
    nomEnvoye = `${carte.calzone.nom} — ${spec.garniture}`;
    nomVue = `${carte.calzone.nom} — ${majuscule(spec.garniture)}`;
    prixBase = carte.calzone.prix[taille];
    ingredients = carte.ingredients[carte.calzone.nom] || [];
  } else if (spec.type === 'composer') {
    nomEnvoye = spec.base ? `${carte.composer.nom} — ${spec.base}` : carte.composer.nom;
    nomVue = spec.base ? `${carte.composer.nom} — ${majuscule(spec.base)}` : carte.composer.nom;
    prixBase = carte.composer.prix[taille];
    ingredients = carte.ingredients[carte.composer.nom] || [];
  } else {
    throw new Error('Type de ligne inconnu : ' + spec.type);
  }
  if (!Number.isInteger(prixBase)) throw new Error('Prix inconnu pour ' + nomEnvoye + ' ' + taille);
  const retraits = (spec.retraits || []).slice();
  for (const r of retraits) if (!ingredients.some((i) => i.toLowerCase() === r.toLowerCase())) throw new Error('Retrait hors fiche : ' + r);
  const credits = carte.supplements.map(() => 0);
  for (const r of retraits) {
    const g = groupeDe(carte, r);
    if (g >= 0) credits[g]++;
  }
  let unit = prixBase;
  const extras = [];
  for (const e of spec.extras || []) {
    const g = groupeDe(carte, e);
    if (g < 0) throw new Error('Supplément inconnu : ' + e);
    let prix = carte.supplements[g].prix[taille];
    if (credits[g] > 0) { credits[g]--; prix = 0; }
    extras.push({ name: e, price_cents: prix, qty: 1 });
    unit += prix;
  }
  return fabriquer({
    name: nomEnvoye, canon: nomVue, variant: taille, qty, unit, removed: retraits, extras,
    half: moitieEnvoi, halfCanon: moitieVue, note
  });
}

export const lignes = (carte, specs) => specs.map((s) => ligne(carte, s));

// ---------------------------------------------------------------------------------------------------------------------
// Corps de commande et valeur attendue

let compteurCles = 0;
/** Clé d'envoi (8 à 64 caractères parmi A-Z a-z 0-9 -). */
export const cleSuivante = (prefixe = 'l02') => `${prefixe}-${String(++compteurCles).padStart(6, '0')}`.slice(0, 64);

export function dedoublonner(tab) {
  const out = [];
  for (const x of tab) if (!out.includes(x)) out.push(x);
  return out;
}

/** Corps envoyé à order_create. `frais` et `total` : valeurs forcées (tests d'écart) ; sinon le calcul indépendant. */
export function corpsCommande({ cle, mode = 'delivery', moyens = [], billet = null, hotSauce, lignes: ls, calc, frais, total }) {
  const livraison = mode === 'delivery';
  return {
    idempotency_key: cle,
    mode,
    payment_methods: livraison ? moyens : [],
    cash_change_for: livraison && moyens.includes('cash') ? billet : null,
    // Sauce piquante (livraison uniquement, SBT-009) : choix obligatoire côté serveur.
    hot_sauce: livraison ? (hotSauce ?? true) : null,
    items: ls.map((l) => l.envoi),
    delivery_fee_cents: frais ?? calc.frais,
    total_cents: total ?? calc.total
  };
}

export const utcAt = (epoch) => new Date(epoch * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
const FORMAT_JOUR = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' });
export const jourService = (epoch) => FORMAT_JOUR.format(new Date(epoch * 1000));

/** Vue attendue d'une commande (champs communs aux vues client et patron + champs du patron). */
export function attendu({ client, mode, moyens, billet, lignes: ls, calc, adresse, epoch }) {
  const livraison = mode === 'delivery';
  const c = client.customer;
  return {
    status: 'new',
    mode,
    customer_name: `${c.first_name} ${c.last_name}`,
    delivery_address: livraison && adresse ? { street: adresse.street, city: adresse.city, housing_type: adresse.housing_type ?? 'maison' } : null,
    payment_methods: livraison ? dedoublonner(moyens) : [],
    cash_change_for: livraison && moyens.includes('cash') ? billet : null,
    items: ls.map((l) => l.attendu),
    products_cents: calc.brut,
    promo_cents: calc.remise,
    delivery_fee_cents: calc.frais,
    total_cents: calc.total,
    created_at: utcAt(epoch),
    accepted_at: null,
    refused_at: null,
    prepared_at: null,
    delay_minutes: null,
    ready_at: null,
    service_day: jourService(epoch),
    customer_id: c.id,
    customer_phone: c.phone,
    customer_email: c.email
  };
}

const CHAMPS_CLIENT = ['id', 'status', 'mode', 'customer_name', 'delivery_address', 'payment_methods', 'cash_change_for', 'items',
  'products_cents', 'promo_cents', 'delivery_fee_cents', 'total_cents', 'created_at', 'accepted_at', 'refused_at', 'prepared_at',
  'delay_minutes', 'ready_at', 'service_day'];
const CHAMPS_PATRON = ['customer_id', 'customer_phone', 'customer_email'];

const abrege = (v) => { let s; try { s = JSON.stringify(v); } catch { s = String(v); } return s === undefined ? 'undefined' : (s.length > 160 ? s.slice(0, 157) + '...' : s); };

/** Compare une vue (client ou patron) à la valeur attendue : renvoie la liste des écarts (vide = conforme). */
export function comparerVue(vue, att, { proprietaire = false } = {}) {
  const ecarts = [];
  if (vue === null || typeof vue !== 'object') return ['vue absente : ' + abrege(vue)];
  const champs = proprietaire ? [...CHAMPS_CLIENT, ...CHAMPS_PATRON] : CHAMPS_CLIENT;
  for (const c of champs) {
    if (att[c] === undefined) continue;
    if (c === 'items') {
      const lv = Array.isArray(vue.items) ? vue.items : [];
      if (lv.length !== att.items.length) { ecarts.push(`items : ${lv.length} ligne(s) / attendu ${att.items.length}`); continue; }
      // category (SBT-006, catégorie du catalogue au moment de la commande) : hors du périmètre de cette
      // batterie (prix/promotions en livraison), jamais fournie par `attendu` -> retirée avant comparaison.
      att.items.forEach((a, i) => {
        const { category, ...sansCategorie } = lv[i] || {};
        if (!isDeepStrictEqual(sansCategorie, a)) ecarts.push(`items[${i}] : ${abrege(lv[i])} / attendu ${abrege(a)}`);
      });
    } else if (c === 'delivery_address' && att[c] !== null) {
      // Comparaison par sous-ensemble : seuls les champs présents dans l'attendu sont vérifiés, pour
      // ne pas casser à chaque champ ajouté à l'adresse plus tard (housing_type, par exemple).
      if (vue[c] === null || typeof vue[c] !== 'object') ecarts.push(`${c} : ${abrege(vue[c])} / attendu ${abrege(att[c])}`);
      else {
        for (const k of Object.keys(att[c])) {
          if (!isDeepStrictEqual(vue[c][k], att[c][k])) ecarts.push(`${c}.${k} : ${abrege(vue[c][k])} / attendu ${abrege(att[c][k])}`);
        }
      }
    } else if (!isDeepStrictEqual(vue[c], att[c])) {
      ecarts.push(`${c} : ${abrege(vue[c])} / attendu ${abrege(att[c])}`);
    }
  }
  if (!proprietaire) {
    for (const c of CHAMPS_PATRON) if (c in vue) ecarts.push(`la vue client expose « ${c} »`);
  }
  return ecarts;
}

// ---------------------------------------------------------------------------------------------------------------------
// Recherche de paniers dont le montant après promotion vaut EXACTEMENT une cible

/** Classes de pizzas par prix unitaire : [{ unit, options: [{ type, nom?, taille }] }]. */
export function classesPizza(carte) {
  const groupes = new Map();
  const ajouter = (unit, opt) => { if (!groupes.has(unit)) groupes.set(unit, []); groupes.get(unit).push(opt); };
  for (const [nom, p] of Object.entries(carte.pizzas)) for (const t of TAILLES) ajouter(p.prix[t], { type: 'pizza', nom, taille: t });
  for (const t of TAILLES) ajouter(carte.calzone.prix[t], { type: 'calzone', taille: t });
  for (const t of TAILLES) ajouter(carte.composer.prix[t], { type: 'composer', taille: t });
  return [...groupes].map(([unit, options]) => ({ unit, options }));
}

/** Prix des produits sans taille : Map prix -> noms. */
export function classesProduit(carte) {
  const m = new Map();
  for (const [nom, prix] of Object.entries(carte.produits)) { if (!m.has(prix)) m.set(prix, []); m.get(prix).push(nom); }
  return m;
}

function resolveurProduits(prix) {
  const memo = new Map();
  const faisable = (R, k) => {
    if (R === 0) return true;
    if (R < 0 || k === 0) return false;
    const cle = R * 100 + k;
    if (memo.has(cle)) return memo.get(cle);
    let ok = false;
    for (const p of prix) if (p <= R && faisable(R - p, k - 1)) { ok = true; break; }
    memo.set(cle, ok);
    return ok;
  };
  const tirer = (R, k, rng) => {
    const sol = [];
    while (R > 0) {
      const candidats = rng.melanger(prix).filter((p) => p <= R && faisable(R - p, k - 1));
      const p = candidats[0];
      sol.push(p);
      R -= p;
      k--;
    }
    return sol;
  };
  return { faisable, tirer };
}

/**
 * Candidats de paniers (pizzas + produits) dont le montant après promotion vaut `cible`.
 * Renvoie { candidats, produits } ; materialiser() en fait des descriptions de lignes.
 */
export function trouverPaniers(carte, { mode, zone, cible, minPizzas = 0, maxPizzas = 4, maxProduits = 4, rng, maxClasses = 12 }) {
  let cls = classesPizza(carte);
  if (cls.length > maxClasses) cls = rng.melanger(cls).slice(0, maxClasses);
  const res = resolveurProduits([...classesProduit(carte).keys()]);
  const candidats = [];
  const rec = (debut, choisis) => {
    if (choisis.length >= minPizzas) {
      const base = calculer(choisis.map((c) => ({ variant: 'X', qty: 1, unit: c.unit })), mode, zone);
      const reste = cible - base.apres;
      if (reste >= 0 && res.faisable(reste, maxProduits)) candidats.push({ pizzas: choisis.slice(), reste });
    }
    if (choisis.length >= maxPizzas) return;
    for (let i = debut; i < cls.length; i++) { choisis.push(cls[i]); rec(i, choisis); choisis.pop(); }
  };
  rec(0, []);
  return { candidats, resolveur: res, maxProduits };
}

/** Descriptions de lignes (specs) d'un candidat. Les doublons exacts sont parfois fusionnés en une quantité. */
export function materialiser(carte, recherche, cand, rng) {
  const specs = [];
  for (const c of cand.pizzas) {
    const o = rng.choix(c.options);
    if (o.type === 'pizza') specs.push({ type: 'pizza', nom: o.nom, taille: o.taille });
    else if (o.type === 'calzone') specs.push({ type: 'calzone', taille: o.taille, garniture: rng.choix(carte.calzone.garnitures) });
    else specs.push({ type: 'composer', taille: o.taille, base: rng.vrai(0.5) ? rng.choix(carte.composer.bases) : null });
  }
  const noms = classesProduit(carte);
  for (const p of recherche.resolveur.tirer(cand.reste, recherche.maxProduits, rng)) specs.push({ type: 'produit', nom: rng.choix(noms.get(p)) });
  // Fusion des lignes identiques (même description) en une quantité, une fois sur deux.
  const fusion = [];
  for (const s of specs) {
    const cle = JSON.stringify([s.type, s.nom, s.taille, s.garniture, s.base]);
    const deja = fusion.find((f) => f.cle === cle);
    if (deja && rng.vrai(0.5)) deja.spec.qty = (deja.spec.qty ?? 1) + 1;
    else fusion.push({ cle, spec: s });
  }
  return rng.melanger(fusion.map((f) => f.spec));
}

/** Un panier exact : specs ou null si aucun candidat. */
export function panierExact(carte, opts) {
  const rech = trouverPaniers(carte, opts);
  if (!rech.candidats.length) return null;
  const cand = opts.rng.choix(rech.candidats);
  return { specs: materialiser(carte, rech, cand, opts.rng), nbCandidats: rech.candidats.length };
}

// ---------------------------------------------------------------------------------------------------------------------
// Paniers aléatoires de tous types (partie « rafale »)

const NOTES = ['', '', '', 'Sans oignons svp', 'Bien cuite', 'Couper en 8', 'Sonnez 2 fois', 'Digicode 1234A', "Merci ! L'étage 3, porte à gauche",
  'Très croustillante', 'Allergie : arachides 😀', 'Ligne 1\nLigne 2', 'Guillemets "doubles" & <b>balises</b>'];

function extrasAleatoires(carte, r, n, retraits) {
  const noms = carte.supplements.flatMap((g) => g.noms);
  const choisis = [];
  // Une fois sur deux, au moins un supplément est du même groupe qu'un ingrédient retiré (supplément gratuit).
  if (retraits.length && r.vrai(0.5)) {
    const g = groupeDe(carte, retraits[0]);
    if (g >= 0) choisis.push(r.choix(carte.supplements[g].noms));
  }
  for (const nom of r.melanger(noms)) {
    if (choisis.length >= n) break;
    if (!choisis.some((x) => x.toLowerCase() === nom.toLowerCase())) choisis.push(nom);
  }
  return choisis;
}

export function specPizzaAleatoire(carte, r, { qtyMax = 2 } = {}) {
  const taille = r.choix(TAILLES);
  const qty = r.vrai(0.2) ? r.entier(2, qtyMax) : 1;
  const tirage = r();
  const note = r.choix(NOTES);
  if (tirage < 0.07) {
    const retraits = r.vrai(0.3) ? [r.choix(['Sauce tomate', 'fromage'])] : [];
    return { type: 'calzone', taille, garniture: r.choix(carte.calzone.garnitures), qty, retraits, extras: r.vrai(0.3) ? extrasAleatoires(carte, r, r.entier(1, 2), retraits) : [], note };
  }
  if (tirage < 0.14) {
    return { type: 'composer', taille, base: r.vrai(0.5) ? r.choix(carte.composer.bases) : null, qty, extras: r.vrai(0.4) ? extrasAleatoires(carte, r, r.entier(1, 3), []) : [], note };
  }
  const nom = r.choix(Object.keys(carte.pizzas));
  const ing = carte.ingredients[nom] || [];
  const retraits = ing.length && r.vrai(0.25) ? r.melanger(ing).slice(0, r.entier(1, Math.min(2, ing.length))) : [];
  const extras = r.vrai(0.35) ? extrasAleatoires(carte, r, r.entier(1, 3), retraits) : [];
  let moitie = null;
  if (taille !== 'Solo' && r.vrai(0.2)) moitie = r.choix(Object.keys(carte.pizzas).filter((n) => n !== nom));
  return { type: 'pizza', nom, taille, qty, extras, retraits, moitie, note };
}

export function specProduitAleatoire(carte, r) {
  return { type: 'produit', nom: r.choix(Object.keys(carte.produits)), qty: r.vrai(0.25) ? r.entier(2, 3) : 1, note: r.vrai(0.1) ? r.choix(NOTES) : '' };
}

/** Panier aléatoire d'un type donné : 'produits' | 'pizzas' | 'mixte' ; complété jusqu'au minimum de la zone si `zone` est donnée. */
export function specsAleatoires(carte, r, type, zone = null) {
  const specs = [];
  const nbPizzas = type === 'produits' ? 0 : (type === 'pizzas' ? r.entier(1, 5) : r.entier(1, 3));
  const nbProduits = type === 'pizzas' ? 0 : (type === 'produits' ? r.entier(1, 4) : r.entier(1, 3));
  for (let i = 0; i < nbPizzas; i++) specs.push(specPizzaAleatoire(carte, r));
  for (let i = 0; i < nbProduits; i++) specs.push(specProduitAleatoire(carte, r));
  if (zone) {
    for (let i = 0; i < 12; i++) {
      if (calculerLignes(lignes(carte, specs), 'delivery', zone).apres >= zone.min) break;
      specs.push(type === 'pizzas' ? specPizzaAleatoire(carte, r) : specProduitAleatoire(carte, r));
    }
  }
  return specs;
}

/** Sous-ensembles non vides des moyens de paiement. */
export function combinaisons(tab, k) {
  const res = [];
  const rec = (i, cur) => {
    if (cur.length === k) { res.push(cur.slice()); return; }
    for (let j = i; j < tab.length; j++) { cur.push(tab[j]); rec(j + 1, cur); cur.pop(); }
  };
  rec(0, []);
  return res;
}
