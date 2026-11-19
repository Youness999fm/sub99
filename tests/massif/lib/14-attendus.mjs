// Batterie 14 : valeurs ATTENDUES calculées à part, à partir des règles métier et des prix du catalogue (données seulement),
// sans réutiliser le code de calcul du site ni du serveur. Les lignes décrivent ce que le test a cliqué.
import { catalogue } from '../../../serveur/catalogue.js';
import { DELIVERY_ZONES } from '../../../serveur/util.js';

export const TAILLES = ['Solo', 'Duo', 'Quatro', 'XXL'];
export const ZONES = DELIVERY_ZONES;

const sansAccents = (s) => String(s).normalize('NFD').replace(/\p{Mn}+/gu, '').toLowerCase().replace(/\*$/, '').trim();

export function produitCatalogue(nomLigne) {
  const p = catalogue().products.find((x) => x.line_name === nomLigne);
  if (!p) throw new Error('Produit absent du catalogue : ' + nomLigne);
  return p;
}

export function groupeDe(nom) {
  const k = sansAccents(nom);
  return catalogue().supplement_groups.findIndex((g) => g.names.some((n) => sansAccents(n) === k));
}

export function prixSupplement(nom, taille) {
  const gi = groupeDe(nom);
  if (gi === -1) throw new Error('Supplément inconnu : ' + nom);
  return catalogue().supplement_groups[gi].prices_by_size[taille];
}

/**
 * Prix unitaire d'une pizza (centimes) : prix de la taille + suppléments, avec la règle d'échange
 * (chaque ingrédient retiré rend gratuit UN supplément du même groupe, dans l'ordre de choix).
 * Renvoie { unite, prixSupplements }.
 */
export function prixPizza(nomLigneBase, taille, { retraits = [], supplements = [] } = {}) {
  const p = produitCatalogue(nomLigneBase);
  const credits = catalogue().supplement_groups.map(() => 0);
  // Le test ne retire que des ingrédients réellement présents sur la fiche (ou sur la seconde moitié) : chaque retrait compte une fois.
  for (const r of retraits) {
    const gi = groupeDe(r);
    if (gi !== -1) credits[gi]++;
  }
  let unite = p.prices_by_size[taille];
  const prixSupplements = supplements.map((nom) => {
    const gi = groupeDe(nom);
    let prix = prixSupplement(nom, taille);
    if (credits[gi] > 0) { credits[gi]--; prix = 0; }
    unite += prix;
    return prix;
  });
  return { unite, prixSupplements };
}

/** Prix fixe d'un produit sans taille (pâtes, boissons, desserts…), centimes. */
export function prixProduit(nomLigne) {
  return Number(produitCatalogue(nomLigne).price_cents);
}

const rang = (taille) => (taille === '' ? -1 : TAILLES.indexOf(taille));

/** Ordre d'affichage du panier : sans taille d'abord (ordre d'ajout), puis Solo, Duo, Quatro, XXL (tri stable). */
export function ordreAffichage(lignes) {
  return lignes.map((l, i) => ({ l, i })).sort((a, b) => (rang(a.l.taille) - rang(b.l.taille)) || (a.i - b.i)).map((x) => x.l);
}

/**
 * Totaux d'une commande (centimes) : promo à emporter (moins chère de chaque paire offerte), livraison (moins chère à moitié prix,
 * arrondi par paire), frais seulement sans pizza, minimum de la ville.
 */
export function totaux(lignes, mode, ville = null) {
  let brut = 0;
  const pizzas = [];
  for (const l of lignes) {
    brut += l.unite * l.qte;
    if (l.taille !== '') for (let i = 0; i < l.qte; i++) pizzas.push(l.unite);
  }
  pizzas.sort((a, b) => b - a);
  let promo = 0;
  for (let i = 0; i + 1 < pizzas.length; i += 2) promo += mode === 'pickup' ? pizzas[i + 1] : Math.floor((pizzas[i + 1] + 1) / 2);
  const zone = mode === 'delivery' && ville ? ZONES[ville] : null;
  const frais = zone && pizzas.length === 0 ? zone.fee_cents : 0;
  const apresPromo = brut - promo;
  return {
    brut, promo, apresPromo, frais, total: apresPromo + frais,
    pizzas: pizzas.length,
    reste: pizzas.length % 2 === 1,
    minimum: zone ? zone.minimum_cents : null,
    manque: zone && apresPromo < zone.minimum_cents ? zone.minimum_cents - apresPromo : 0
  };
}

/** Lignes (détail sous le nom) telles que le panier les affiche : moitiés, retraits, suppléments, demande. */
export function detailsAttendus(l) {
  const d = [];
  if (l.moitie) { d.push('Moitié 1 : ' + l.moitie.flavor1); d.push('Moitié 2 : ' + l.moitie.flavor2); }
  if (l.retraits && l.retraits.length) d.push('Sans : ' + l.retraits.join(', '));
  if (l.supplements && l.supplements.length) {
    d.push('Suppléments : ' + l.supplements.map((n, i) => n + (l.prixSupplements[i] === 0 ? ' (échange offert)' : '')).join(', '));
  }
  if (l.note) d.push('Autre demande : ' + l.note);
  return d;
}

/** Libellé d'une pizza dont la moitié-moitié est choisie : la ligne garde le nom de la première moitié. */
export const nomsPizzasMoitie = () => catalogue().products
  .filter((p) => p.kind === 'pizza' && p.category === 'pizzas' && p.half_flavor && p.orderable)
  .map((p) => p.name);
