// Batterie 10 : oracle de prix INDÉPENDANT du serveur + générateur de commandes (graine fixe).
// Ce fichier n'importe RIEN de serveur/ : il lit seulement les données du catalogue (api/data/catalogue.json) et
// applique les règles écrites dans le cahier des charges (promotions, frais, minimum par zone, échange d'ingrédients).
// Les barèmes publics (tailles, suppléments, zones) sont recopiés en dur plus bas : ils servent de référence
// indépendante pour vérifier que le catalogue lu par le serveur n'a pas été falsifié.
import { readFileSync } from 'node:fs';

export const CHEMIN_CATALOGUE = new URL('../../../api/data/catalogue.json', import.meta.url);
export const TAILLES = ['Solo', 'Duo', 'Quatro', 'XXL'];
export const MOYENS = ['card', 'cash', 'ticket', 'ticket_card'];
export const BILLETS = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

/** Zones de livraison (index.html, cart.js) : minimum de commande sur les produits APRÈS promotion, et frais, en centimes. */
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

/** Barème public (menu.html, composer.html, supplements.html), en centimes. */
export const BAREME = {
  pizza: { Solo: 1100, Duo: 1600, Quatro: 2300, XXL: 3300 },
  composee: { Solo: 900, Duo: 1300, Quatro: 1750, XXL: 2550 },
  legumes: { Solo: 100, Duo: 150, Quatro: 250, XXL: 350 },
  viandes: { Solo: 150, Duo: 200, Quatro: 300, XXL: 400 },
  categories: { pates: 850, subitowichs: 600, 'tex-mex': 500, salades: 750 },
  fiches: { 'Oasis Pomme Poire canette': 150, 'Maxi Coca': 300, 'Tiramisubito Oreo': 350, 'Tiramisubito Spéculoos': 350, "Tiramisubito M&M's": 350, 'Calzone Nutella': 650, 'Part de Tarte au Daim': 300 }
};

// ------------------------------------------------------------------ graine

/** Générateur pseudo-aléatoire reproductible (mulberry32), propre à cette batterie. */
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

// ------------------------------------------------------------------ chaînes

/** Forme de comparaison d'un ingrédient : sans accents, minuscules, espaces réduits. */
export function norm(s) {
  return String(s).normalize('NFD').replace(/\p{Mn}+/gu, '').toLowerCase()
    .replace(/œ/g, 'oe').replace(/æ/g, 'ae').replace(/[’‘`´]/g, "'").replace(/\s+/g, ' ').trim();
}

/** Clé d'appartenance à un groupe de suppléments : minuscules, astérisque finale retirée. */
export const cleGroupe = (s) => String(s).toLowerCase().replace(/\*$/u, '').trim();

export function capPremiere(s) {
  const c = Array.from(String(s));
  return c.length === 0 ? '' : c[0].toUpperCase() + c.slice(1).join('');
}

/** « Calzone (soufflée) — Thon » -> ['Calzone (soufflée)', 'Thon'] ; sans choix -> [nom, null]. */
export function decouper(nom) {
  const i = String(nom).indexOf(' — ');
  return i < 0 ? [String(nom), null] : [String(nom).slice(0, i), String(nom).slice(i + 3)];
}

// ------------------------------------------------------------------ catalogue

export function chargerCatalogue(chemin = CHEMIN_CATALOGUE) {
  return JSON.parse(readFileSync(chemin, 'utf8'));
}

export function indexer(cat) {
  const pizzas = cat.products.filter((p) => p.kind === 'pizza' && p.orderable);
  const produits = cat.products.filter((p) => p.kind === 'product' && p.orderable);
  const groupes = cat.supplement_groups.map((g) => ({ titre: g.title, noms: g.names.map(String), prix: g.prices_by_size }));
  const groupeDe = new Map();
  groupes.forEach((g, i) => g.noms.forEach((n) => groupeDe.set(cleGroupe(n), i)));
  const supplements = groupes.flatMap((g, i) => g.noms.map((n) => ({ nom: n, groupe: i })));
  const demis = pizzas.filter((p) => p.half_flavor);
  const ingredients = [...new Set(cat.products.flatMap((p) => p.ingredients.map(String)))];
  return { cat, pizzas, produits, groupes, groupeDe, supplements, demis, ingredients };
}

/**
 * Prix attendu d'une ligne (nom canonique ou nom reçu à l'identique du catalogue).
 * Renvoie { ok:true, unit, extras:[prix], nom, demi, creditsRestants } ou { ok:false, raison }.
 * Règle d'échange : chaque ingrédient retiré (présent sur la pizza ou sur sa 2e moitié, compté une seule fois)
 * rend gratuit le premier supplément suivant du même groupe.
 */
export function prixLigne(idx, l) {
  const pizza = l.variant !== '';
  const [base, reste] = decouper(l.name);
  const p = (pizza ? idx.pizzas : idx.produits).find((x) => x.line_name === base);
  if (!p) return { ok: false, raison: `article inconnu « ${l.name} »` };
  let filler = null;
  if (p.choice) {
    if (reste !== null && reste !== '') {
      filler = p.choice.options.find((o) => norm(o) === norm(reste)) ?? null;
      if (filler === null) return { ok: false, raison: 'garniture inconnue' };
    } else if (p.choice.required) {
      return { ok: false, raison: 'garniture obligatoire' };
    }
  } else if (reste !== null) {
    return { ok: false, raison: 'choix non prévu' };
  }
  let demi = null;
  if (l.half) {
    if (!pizza || l.variant === 'Solo' || !p.half_allowed) return { ok: false, raison: 'moitié-moitié interdite' };
    demi = idx.demis.find((x) => norm(x.name) === norm(l.half.flavor2)) ?? null;
    if (demi === null || norm(l.half.flavor1) !== norm(p.name)) return { ok: false, raison: 'moitié inconnue' };
  }
  const unitBase = pizza ? p.prices_by_size[l.variant] : p.price_cents;
  if (!Number.isInteger(unitBase)) return { ok: false, raison: 'sans prix' };
  const fixes = [...p.ingredients, ...(demi ? demi.ingredients : [])].map(norm);
  const presents = new Set(fixes);
  const autorises = new Set(filler ? [...fixes, norm(filler)] : fixes);
  for (const r of l.removed) if (!autorises.has(norm(r))) return { ok: false, raison: 'retrait absent : ' + r };
  const credits = idx.groupes.map(() => 0);
  const vus = new Set();
  for (const r of l.removed) {
    const k = norm(r);
    if (!presents.has(k) || vus.has(k)) continue;
    vus.add(k);
    const g = idx.groupeDe.get(cleGroupe(r));
    if (g !== undefined) credits[g]++;
  }
  let unit = unitBase;
  const extras = [];
  for (const e of l.extras) {
    const g = idx.groupeDe.get(cleGroupe(e.name));
    if (!pizza || g === undefined) return { ok: false, raison: 'supplément inconnu : ' + e.name };
    let prix = idx.groupes[g].prix[l.variant];
    if (credits[g] > 0) { credits[g]--; prix = 0; }
    extras.push(prix);
    unit += prix;
  }
  return {
    ok: true, unit, extras, creditsRestants: credits, pizza, produit: p, filler, autorises,
    nom: base + (filler ? ' — ' + capPremiere(filler) : ''),
    demi: demi ? { flavor1: p.name, flavor2: demi.name } : null
  };
}

// ------------------------------------------------------------------ promotions et totaux

const gainPaire = (moinsCher, mode) => (mode === 'pickup' ? moinsCher : Math.ceil(moinsCher / 2));

/**
 * Promotion : on apparie les pizzas du prix le plus élevé au plus bas (la plus chère payée, la moins chère de la paire
 * offerte à emporter / à moitié prix en livraison, arrondi par paire au centime supérieur) ; une pizza seule n'a pas de remise.
 * Algorithme : extractions successives du maximum (autre méthode que le tri du serveur).
 */
export function promoCents(prix, mode) {
  const reste = prix.slice();
  let promo = 0;
  const extraireMax = () => {
    let m = 0;
    for (let i = 1; i < reste.length; i++) if (reste[i] > reste[m]) m = i;
    return reste.splice(m, 1)[0];
  };
  while (reste.length >= 2) {
    extraireMax(); // payée
    promo += gainPaire(extraireMax(), mode);
  }
  return promo;
}

/** Meilleure remise possible sur TOUS les appariements (petits paniers) : doit égaler promoCents. */
export function promoForceBrute(prix, mode) {
  const meilleur = (liste) => {
    if (liste.length < 2) return 0;
    const [x, ...reste] = liste;
    let best = meilleur(reste); // x reste seule
    for (let j = 0; j < reste.length; j++) {
      const sans = reste.filter((_, k) => k !== j);
      best = Math.max(best, gainPaire(Math.min(x, reste[j]), mode) + meilleur(sans));
    }
    return best;
  };
  return meilleur(prix);
}

/** Totaux d'une commande. lignes : [{ unit, qty, pizza }]. */
export function totaux(lignes, mode, ville) {
  let brut = 0;
  const prixPizzas = [];
  let aPizza = false;
  for (const l of lignes) {
    brut += l.unit * l.qty;
    if (l.pizza) {
      aPizza = true;
      for (let i = 0; i < l.qty; i++) prixPizzas.push(l.unit);
    }
  }
  const promo = promoCents(prixPizzas, mode);
  const apres = brut - promo;
  const zone = mode === 'delivery' ? ZONES[ville] : null;
  const frais = zone && !aPizza ? zone.frais : 0;
  return {
    produits: brut, promo, apres, frais, total: apres + frais, aPizza,
    pizzas: prixPizzas.length, min: zone ? zone.min : 0, minimumAtteint: zone ? apres >= zone.min : true
  };
}

/**
 * Calcul attendu d'un corps de commande dont les lignes portent des noms exacts du catalogue.
 * Renvoie { lignes: [calc], t: totaux, erreurs } ; les prix déclarés dans le corps ne sont PAS utilisés.
 */
export function calculerCommande(idx, corps, ville) {
  const lignes = [];
  const erreurs = [];
  corps.items.forEach((l, i) => {
    const c = prixLigne(idx, l);
    if (!c.ok) { erreurs.push(`ligne ${i} : ${c.raison}`); return; }
    lignes.push({ ...c, qty: l.qty });
  });
  return { lignes, t: erreurs.length ? null : totaux(lignes, corps.mode, ville), erreurs };
}

/** Totaux calculés avec les prix DÉCLARÉS par un client qui falsifie ses prix (pour fabriquer un total « cohérent »). */
export function totauxDeclares(corps, ville) {
  const lignes = corps.items.map((l) => ({ unit: Number(l.unit_price_cents), qty: Number(l.qty), pizza: l.variant !== '' }));
  return totaux(lignes, corps.mode, ville);
}

// ------------------------------------------------------------------ générateur de commandes valides

const NOTES = ['', '', '', '', '', 'Sans oignons svp', 'Bien cuite', 'Couper en 8', 'Sonnez 2 fois', 'Digicode 1234A', 'Merci ! 🍕',
  'Très croustillante', 'Allergie : arachides', 'Ça va ? Ça va très bien — merci.', 'a'.repeat(300), 'ligne 1\nligne 2'];

/** Noms qui ne sont dans AUCUN groupe de suppléments ni dans la carte. */
export const SUPPLEMENTS_INCONNUS = ['caviar', 'truffe', 'foie gras', 'jambon cru', 'ananas', 'pepperoni', 'mozzarella di bufala', 'sauce tomate bio'];
export const ARTICLES_INCONNUS = ['Margherita', 'Pizza Licorne', 'Hawaïenne', 'Boisson 50cl', 'Pâtes Alfredo', 'Tiramisu', 'Subitowich Poulet', 'Burger maison'];

const casse = (r, s) => {
  const k = r.entier(0, 3);
  return k === 1 ? capPremiere(s) : k === 2 ? s.toUpperCase() : s;
};

let compteurCles = 0;
/** Clé d'envoi valide (8 à 64 caractères [A-Za-z0-9-]) et unique dans le processus. */
export const cleEnvoi = (r, prefixe = 'p10') => `${prefixe}-${(++compteurCles).toString(36)}-${r.entier(0, 1e9).toString(36)}`.slice(0, 64);

function choisirExtras(r, idx, n, retraits) {
  const noms = [];
  const pris = new Set();
  const groupesRetires = retraits.map((ing) => idx.groupeDe.get(cleGroupe(ing))).filter((g) => g !== undefined);
  for (let k = 0; k < n; k++) {
    const cands = groupesRetires.length && r.vrai(0.5) ? idx.supplements.filter((s) => s.groupe === r.choix(groupesRetires)) : idx.supplements;
    const libres = cands.filter((s) => !pris.has(cleGroupe(s.nom)));
    if (!libres.length) break;
    const s = r.choix(libres);
    pris.add(cleGroupe(s.nom));
    noms.push(s.nom);
  }
  return noms;
}

/**
 * Ligne VALIDE (prix calés par l'oracle). Options : pizza (booléen), produit, taille, qty, extras (nombre), retraits (nombre),
 * demi (booléen), note, echange (ligne « échange » : un ingrédient retiré + un supplément gratuit du même groupe).
 */
export function genererLigne(r, idx, o = {}) {
  const pizza = o.pizza ?? r.vrai(0.7);
  let l;
  if (pizza) {
    // Une ligne « échange » exige un ingrédient fixe qui appartienne à un groupe de suppléments.
    const sources = o.echange ? idx.pizzas.filter((x) => x.ingredients.some((ing) => idx.groupeDe.has(cleGroupe(ing)))) : idx.pizzas;
    const p = o.produit ?? r.choix(sources);
    const taille = o.taille ?? r.choix(TAILLES);
    let name = p.line_name;
    if (p.choice && (p.choice.required || r.vrai(0.5))) name += ' — ' + casse(r, r.choix(p.choice.options));
    let half = null;
    let demi = null;
    if (taille !== 'Solo' && p.half_allowed && (o.demi ?? r.vrai(0.25))) {
      demi = r.choix(idx.demis.filter((x) => x.name !== p.name));
      half = { flavor1: p.name, flavor2: demi.name };
    }
    const candidats = [];
    const vus = new Set();
    for (const ing of [...p.ingredients, ...(demi ? demi.ingredients : [])].map(String)) {
      if (!vus.has(norm(ing))) { vus.add(norm(ing)); candidats.push(ing); }
    }
    let removed;
    let noms;
    if (o.echange) {
      const avecGroupe = candidats.filter((ing) => idx.groupeDe.has(cleGroupe(ing)));
      if (avecGroupe.length === 0) throw new Error('pas d\'échange possible sur ' + p.name);
      const ing = r.choix(avecGroupe);
      removed = [ing];
      const g = idx.groupeDe.get(cleGroupe(ing));
      noms = [r.choix(idx.supplements.filter((s) => s.groupe === g)).nom];
    } else {
      const nR = o.retraits ?? (r.vrai(0.6) ? 0 : r.vrai(0.6) ? 1 : r.vrai(0.7) ? 2 : 3);
      removed = r.melanger(candidats).slice(0, Math.min(nR, candidats.length));
      const nE = o.extras ?? (r.vrai(0.55) ? 0 : r.vrai(0.5) ? 1 : r.vrai(0.6) ? 2 : r.entier(3, 5));
      noms = choisirExtras(r, idx, nE, removed);
    }
    l = {
      name, variant: taille, qty: o.qty ?? 1, unit_price_cents: 1, removed,
      extras: noms.map((n) => ({ name: n, price_cents: 0, qty: 1 })), half, note: o.note ?? r.choix(NOTES)
    };
  } else {
    // Produits à choix obligatoire (base des subitowichs, décision du 22/11/2026) volontairement exclus du
    // tirage général de cette batterie : la combinatoire (choix × indisponibilité) est déjà couverte de façon
    // exhaustive par tests/massif/11-disponibilite-dynamique.mjs. Les inclure ici changerait la composition
    // de commandes générées à des index déjà fixés par la graine, dont dépendent de nombreux scénarios de
    // falsification écrits pour une ligne de produit « simple » (jamais de choix) à cet index précis.
    const p = o.produit ?? r.choix(idx.produits.filter((x) => !x.choice));
    let name = p.line_name;
    // Les boissons n'ont aucun ingrédient fixe : pas de retrait possible sur ces fiches (tirage conservé pour la suite de la graine).
    const tenteRetrait = r.vrai(0.05);
    const retire = tenteRetrait && p.ingredients.length ? [r.choix(p.ingredients.map(String))] : [];
    l = { name, variant: '', qty: o.qty ?? 1, unit_price_cents: 1, removed: retire, extras: [], half: null, note: o.note ?? r.choix(NOTES) };
  }
  return calerLigne(idx, l);
}

/** Fixe les prix attendus dans la ligne ; renvoie { ligne, calc }. Lève si la ligne est incohérente (erreur du test). */
export function calerLigne(idx, l) {
  const c = prixLigne(idx, l);
  if (!c.ok) throw new Error('Ligne générée invalide : ' + c.raison + ' ' + JSON.stringify(l));
  l.unit_price_cents = c.unit;
  l.extras.forEach((e, k) => { e.price_cents = c.extras[k]; });
  return { ligne: l, calc: c };
}

function quantiteAleatoire(r, pizza) {
  const x = r.entier(1, 100);
  if (pizza) return x <= 68 ? 1 : x <= 88 ? 2 : x <= 94 ? 3 : x <= 98 ? r.entier(4, 6) : r.entier(7, 20);
  return x <= 70 ? 1 : x <= 90 ? 2 : x <= 98 ? 3 : r.entier(4, 8);
}

/** Moyens de paiement et billet d'une commande en livraison. */
export function genererPaiement(r, imposes = null) {
  const methods = imposes ?? r.melanger(MOYENS).slice(0, r.entier(1, 3));
  return { payment_methods: methods, cash_change_for: methods.includes('cash') ? r.choix(BILLETS) : null };
}

/**
 * Commande VALIDE complète : { corps, ville, mode, calcul } (calcul = calculerCommande).
 * Options : mode, ville, nbLignes, qtyMax (quantité maximale par ligne), lignes (déjà prêtes), pizzas (nombre minimal d'unités
 * de pizza), echange (une ligne d'échange), supplement (au moins une ligne de pizza avec supplément), cash (livraison avec
 * espèces), paiements (moyens imposés), cle.
 */
export function genererCommande(r, idx, o = {}) {
  const mode = o.mode ?? (r.vrai(0.5) ? 'pickup' : 'delivery');
  const ville = o.ville ?? r.choix(VILLES);
  const items = o.lignes ? o.lignes.map((l) => structuredClone(l)) : [];
  const cumul = () => items.reduce((s, l) => s + l.qty, 0);
  const ajouter = (opt = {}) => {
    const pizza = opt.pizza ?? r.vrai(0.7);
    const qty = Math.min(opt.qty ?? quantiteAleatoire(r, pizza), o.qtyMax ?? 60, 60 - cumul());
    if (qty < 1 || items.length >= 40) return false;
    items.push(genererLigne(r, idx, { ...opt, pizza, qty }).ligne);
    return true;
  };
  if (!o.lignes) {
    const nb = o.nbLignes ?? (r.vrai(0.06) ? r.entier(8, 24) : r.entier(1, 5));
    for (let i = 0; i < nb; i++) ajouter();
    if (o.echange) ajouter({ pizza: true, echange: true, qty: 1 });
    if (o.supplement && !items.some((l) => l.variant !== '' && l.extras.length > 0)) ajouter({ pizza: true, extras: r.entier(1, 3), qty: 1 });
    for (let guard = 0; guard < 30 && o.pizzas && items.filter((l) => l.variant !== '').reduce((s, l) => s + l.qty, 0) < o.pizzas; guard++) {
      ajouter({ pizza: true, qty: 1 });
    }
  }
  const minimum = () => (mode === 'delivery' ? ZONES[ville].min : 0);
  for (let guard = 0; guard < 40 && !o.lignes; guard++) {
    const c = calculerCommande(idx, { mode, items }, ville);
    if (items.length > 0 && c.t.apres >= minimum()) break;
    if (!ajouter({ qty: 1 })) break;
  }
  const calcul = calculerCommande(idx, { mode, items }, ville);
  const pay = mode === 'delivery'
    ? genererPaiement(r, o.cash ? ['cash', ...r.melanger(MOYENS.filter((m) => m !== 'cash')).slice(0, r.entier(0, 1))] : o.paiements ?? null)
    : { payment_methods: [], cash_change_for: null };
  const corps = {
    idempotency_key: o.cle ?? cleEnvoi(r),
    mode,
    payment_methods: pay.payment_methods,
    cash_change_for: pay.cash_change_for,
    // Sauce piquante (livraison uniquement, SBT-009) : choix obligatoire côté serveur.
    hot_sauce: mode === 'delivery' ? (o.hotSauce ?? r.vrai(0.5)) : null,
    items,
    delivery_fee_cents: calcul.t.frais,
    total_cents: calcul.t.total
  };
  return { corps, ville, mode, calcul };
}

/** Recalcule frais et total d'un corps modifié (lignes déjà calées) et les inscrit dans le corps. */
export function recalibrer(idx, corps, ville) {
  const calcul = calculerCommande(idx, corps, ville);
  if (calcul.t === null) throw new Error('recalibrage impossible : ' + calcul.erreurs.join(' ; '));
  corps.delivery_fee_cents = calcul.t.frais;
  corps.total_cents = calcul.t.total;
  return calcul;
}
