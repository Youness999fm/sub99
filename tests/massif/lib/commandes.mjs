// Générateur de commandes VALIDES à partir du vrai catalogue (api/data/catalogue.json) : mêmes noms, tailles, suppléments,
// retraits, moitié-moitié, garnitures à choix, moyens de paiement et zones que le site. Les prix unitaires sont ceux que
// le serveur attend (règle des suppléments gratuits comprise) ; les totaux viennent du calcul serveur (promotions, frais).
// Graine : même graine = mêmes commandes (reproductible).
import { catalogue, catalogueResolveLine, catalogueExpectedLine } from '../../../serveur/catalogue.js';
import { computeOrderTotals, PAYMENT_METHODS, CASH_CHANGE_CHOICES } from '../../../serveur/orders.js';
import { DELIVERY_ZONES } from '../../../serveur/util.js';

export const TAILLES = ['Solo', 'Duo', 'Quatro', 'XXL'];
export const MODES = ['pickup', 'delivery'];
export { PAYMENT_METHODS, CASH_CHANGE_CHOICES, DELIVERY_ZONES };

/** Générateur pseudo-aléatoire reproductible (mulberry32). */
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
  f.melanger = (tab) => { const t = [...tab]; for (let i = t.length - 1; i > 0; i--) { const j = Math.floor(f() * (i + 1)); [t[i], t[j]] = [t[j], t[i]]; } return t; };
  return f;
}

export function produits() {
  const c = catalogue();
  return {
    pizzas: c.products.filter((p) => p.kind === 'pizza' && p.orderable),
    autres: c.products.filter((p) => p.kind === 'product' && p.orderable),
    groupes: c.supplement_groups,
    zones: c.zones
  };
}

const NOTES = ['', '', '', 'Sans oignons svp', 'Bien cuite', 'Couper en 8', 'Sonnez 2 fois', 'Digicode 1234A', 'Merci !', 'Très croustillante'];

/** Ligne de pizza valide. Options : produit, taille, qty, extras (nombre), retraits (nombre), moitie (booléen), note. */
export function lignePizza(r, { produit, taille, qty, extras, retraits, moitie, note } = {}) {
  const { pizzas, groupes } = produits();
  const p = produit || r.choix(pizzas);
  const variant = taille || r.choix(TAILLES);
  let name = p.line_name;
  if (p.choice && typeof p.choice === 'object' && Array.isArray(p.choice.options)) name += ' — ' + r.choix(p.choice.options);
  let half = null;
  if ((moitie === true || (moitie === undefined && r.vrai(0.2))) && variant !== 'Solo' && p.half_allowed) {
    const candidates = pizzas.filter((h) => h.half_flavor && h.name !== p.name);
    if (candidates.length) half = { flavor1: p.name, flavor2: r.choix(candidates).name };
  }
  const fixes = (p.ingredients || []).map(String);
  const nbRetraits = retraits === undefined ? (r.vrai(0.3) ? r.entier(1, 2) : 0) : retraits;
  const removed = r.melanger(fixes).slice(0, Math.min(nbRetraits, fixes.length));
  const noms = groupes.flatMap((g) => g.names.map(String));
  const nbExtras = extras === undefined ? (r.vrai(0.35) ? r.entier(1, 3) : 0) : extras;
  const choisis = r.melanger(noms).slice(0, nbExtras);
  const ligne = {
    name,
    variant,
    qty: qty || (r.vrai(0.15) ? 2 : 1),
    unit_price_cents: 1,
    removed,
    extras: choisis.map((n) => ({ name: n, price_cents: 0, qty: 1 })),
    half,
    note: note !== undefined ? note : r.choix(NOTES)
  };
  return calibrer(ligne);
}

/** Ligne d'un produit sans taille (pâtes, boissons, desserts, subitowichs…). */
export function ligneProduit(r, { produit, qty, note } = {}) {
  const { autres } = produits();
  const p = produit || r.choix(autres);
  let name = p.line_name;
  if (p.choice && typeof p.choice === 'object' && Array.isArray(p.choice.options)) name += ' — ' + r.choix(p.choice.options);
  return calibrer({
    name, variant: '', qty: qty || (r.vrai(0.25) ? r.entier(2, 3) : 1), unit_price_cents: 1,
    removed: [], extras: [], half: null, note: note !== undefined ? note : ''
  });
}

/** Fixe les prix unitaires et de suppléments attendus par le serveur ; lève si la ligne n'est pas résolue par le catalogue. */
export function calibrer(ligne) {
  const res = catalogueResolveLine(ligne);
  if (res.error) throw new Error('Ligne générée refusée par le catalogue : ' + JSON.stringify(res) + ' pour ' + JSON.stringify(ligne));
  const exp = catalogueExpectedLine(ligne, res);
  ligne.unit_price_cents = exp.unit_cents;
  ligne.extras.forEach((e, k) => { e.price_cents = exp.extras[k]; });
  return ligne;
}

let compteurCles = 0;
export const nouvelleCle = (prefixe = 'massif') => `${prefixe}-${Date.now().toString(36)}-${(++compteurCles).toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`.slice(0, 64);

/**
 * Commande valide complète : { body, totals, zone }.
 * Options : mode, ville (obligatoire en livraison : sert au minimum), lignes (tableau déjà prêt), cle, paiements, billet,
 * nbPizzas, nbAutres. En livraison, des lignes sont ajoutées jusqu'à atteindre le minimum de la ville.
 */
export function construireCommande(r, opts = {}) {
  const mode = opts.mode || r.choix(MODES);
  const ville = opts.ville || r.choix(Object.keys(DELIVERY_ZONES));
  const zone = mode === 'delivery' ? DELIVERY_ZONES[ville] : null;
  const items = opts.lignes ? [...opts.lignes] : [];
  if (!opts.lignes) {
    const nbPizzas = opts.nbPizzas ?? r.entier(0, 3);
    const nbAutres = opts.nbAutres ?? (nbPizzas === 0 ? r.entier(1, 3) : r.entier(0, 2));
    for (let i = 0; i < nbPizzas; i++) items.push(lignePizza(r));
    for (let i = 0; i < nbAutres; i++) items.push(ligneProduit(r));
  }
  let totals = computeOrderTotals(items, mode, zone);
  for (let essai = 0; mode === 'delivery' && !opts.lignes && totals.products_after_promo_cents < zone.minimum_cents && essai < 30; essai++) {
    items.push(r.vrai(0.6) ? lignePizza(r, { qty: 1 }) : ligneProduit(r));
    totals = computeOrderTotals(items, mode, zone);
  }
  const paiements = mode === 'delivery'
    ? (opts.paiements || r.melanger(PAYMENT_METHODS).slice(0, r.entier(1, 2)))
    : [];
  const body = {
    idempotency_key: opts.cle || nouvelleCle(),
    mode,
    payment_methods: paiements,
    cash_change_for: paiements.includes('cash') ? (opts.billet ?? r.choix(CASH_CHANGE_CHOICES)) : null,
    items,
    delivery_fee_cents: totals.delivery_fee_cents,
    total_cents: totals.total_cents
  };
  return { body, totals, zone, ville };
}

/** Fait correspondre le client à une adresse de livraison dans la zone (obligatoire pour une commande en livraison). */
export async function definirAdresse(client, ville, rue = '12 rue des Tests') {
  return client.post('customer_update_address.php', { street: rue, city: ville });
}
