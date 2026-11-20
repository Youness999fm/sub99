// Commandes : validation du corps, calcul serveur, vues client et propriétaire (port de api/lib/orders.php).
import crypto from 'node:crypto';
import { fail, failValidation } from './core.js';
import { all, one } from './db.js';
import { catalogueCanonicalItems, catalogueSwapKey, checkAvailabilityLines, verifyLinePrices } from './catalogue.js';
import { isIntBetween, strChars, utcAt, utcToEpoch } from './util.js';

export const PAYMENT_METHODS = ['card', 'cash', 'ticket', 'ticket_card'];
export const CASH_CHANGE_CHOICES = [0, 10, 20, 50, 100];
export const VARIANTS = ['', 'Solo', 'Duo', 'Quatro', 'XXL'];
export const PIZZA_SIZES = ['Solo', 'Duo', 'Quatro', 'XXL'];

/** Plus grand entier d'une colonne INTEGER Postgres : un identifiant au-delà ne peut pas exister (et ferait échouer la requête). */
export const ID_MAX = 2147483647;

/** trim() de PHP : seulement espace, tabulation, saut de ligne, retour chariot, NUL, tabulation verticale. */
export function phpTrim(s) {
  return String(s).replace(/^[ \t\n\r\0\x0B]+|[ \t\n\r\0\x0B]+$/g, '');
}

const estObjet = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Liste (tableau JSON) ou null. Comme en PHP, l'objet vide {} est une liste vide. */
function liste(v) {
  if (Array.isArray(v)) return v;
  if (estObjet(v) && Object.keys(v).length === 0) return [];
  return null;
}

/**
 * Valide le corps de order_create. Répond 422 (validation / empty_cart) en cas d'erreur.
 * Renvoie le corps normalisé (les objets sont construits dans un ordre de clés fixe : il sert à l'empreinte).
 */
export function validateOrderBody(b) {
  const err = {};

  let key = b.idempotency_key ?? null;
  if (typeof key !== 'string' || !/^[A-Za-z0-9-]{8,64}$/.test(key)) {
    err.idempotency_key = "Clé d'envoi invalide.";
    key = '';
  }

  let mode = b.mode ?? null;
  if (mode !== 'pickup' && mode !== 'delivery') {
    err.mode = 'Mode invalide (à emporter ou livraison).';
    mode = 'pickup';
  }

  const pm = liste(b.payment_methods ?? null);
  const methods = [];
  let cash = null;
  if (pm === null) {
    err.payment_methods = 'Moyens de paiement invalides.';
  } else if (mode === 'delivery') {
    for (const m of pm) {
      if (typeof m !== 'string' || !PAYMENT_METHODS.includes(m)) {
        err.payment_methods = 'Moyen de paiement inconnu.';
        break;
      }
      if (!methods.includes(m)) methods.push(m);
    }
    if (err.payment_methods === undefined && methods.length === 0) {
      err.payment_methods = 'Choisissez au moins un moyen de paiement.';
    }
    if (methods.includes('cash')) {
      const c = b.cash_change_for ?? null;
      if (!Number.isInteger(c) || !CASH_CHANGE_CHOICES.includes(c)) {
        err.cash_change_for = "Indiquez le billet utilisé (ou l'appoint).";
      } else {
        cash = c;
      }
    }
  }

  const itemsIn = liste(b.items ?? null);
  const items = [];
  if (itemsIn === null) {
    err.items = 'Panier invalide.';
  } else if (itemsIn.length === 0) {
    if (Object.keys(err).length === 0) fail(422, 'empty_cart', 'Votre panier est vide.');
  } else if (itemsIn.length > 40) {
    err.items = 'Trop de lignes (40 au plus).';
  } else {
    let qtySum = 0;
    itemsIn.forEach((raw, i) => {
      const p = `items[${i}]`;
      // Une ligne est un objet (un tableau vide est lu comme un objet vide, comme en PHP).
      const it = estObjet(raw) ? raw : (Array.isArray(raw) && raw.length === 0 ? {} : null);
      if (it === null) {
        err[p] = 'Ligne invalide.';
        return;
      }
      const name = typeof it.name === 'string' ? phpTrim(it.name) : '';
      if (name === '' || strChars(name) > 120) err[`${p}.name`] = 'Nom invalide.';
      let variant = it.variant ?? '';
      if (typeof variant !== 'string' || !VARIANTS.includes(variant)) {
        err[`${p}.variant`] = 'Taille invalide.';
        variant = '';
      }
      let qty = it.qty ?? null;
      if (!isIntBetween(qty, 1, 20)) {
        err[`${p}.qty`] = 'Quantité invalide (1 à 20).';
        qty = 1;
      }
      qtySum += qty;
      let unit = it.unit_price_cents ?? null;
      if (!isIntBetween(unit, 1, 50000)) {
        err[`${p}.unit_price_cents`] = 'Prix invalide.';
        unit = 0;
      }
      const removed = [];
      const rIn = liste(it.removed ?? []);
      if (rIn === null || rIn.length > 20) {
        err[`${p}.removed`] = "Liste d'ingrédients retirés invalide.";
      } else {
        for (const r of rIn) {
          if (typeof r !== 'string' || strChars(phpTrim(r)) > 60) {
            err[`${p}.removed`] = 'Ingrédient retiré invalide.';
            break;
          }
          removed.push(phpTrim(r));
        }
      }
      const extras = [];
      const eIn = liste(it.extras ?? []);
      if (eIn === null || eIn.length > 20) {
        err[`${p}.extras`] = 'Suppléments invalides.';
      } else {
        const seen = new Set();
        for (let j = 0; j < eIn.length; j++) {
          const e = eIn[j];
          const objet = e !== null && typeof e === 'object';
          const en = objet && typeof e.name === 'string' ? phpTrim(e.name) : null;
          const ep = objet ? (e.price_cents ?? null) : null;
          const eq = objet ? (e.qty ?? 1) : null;
          if (en === null || strChars(en) > 60 || !isIntBetween(ep, 0, 10000)) {
            err[`${p}.extras`] = 'Supplément invalide.';
            break;
          }
          // Un supplément = une portion : l'interface n'envoie jamais d'autre quantité.
          if (eq !== 1) {
            err[`${p}.extras[${j}].qty`] = 'Quantité de supplément invalide (1 uniquement).';
            break;
          }
          const ek = catalogueSwapKey(en);
          if (seen.has(ek)) {
            err[`${p}.extras[${j}].name`] = 'Supplément en double.';
            break;
          }
          seen.add(ek);
          extras.push({ name: en, price_cents: ep, qty: eq });
        }
      }
      let half = null;
      const hIn = it.half ?? null;
      if (hIn !== null) {
        const objet = typeof hIn === 'object';
        const f1 = objet && typeof hIn.flavor1 === 'string' ? phpTrim(hIn.flavor1) : null;
        const f2 = objet && typeof hIn.flavor2 === 'string' ? phpTrim(hIn.flavor2) : null;
        if (f1 === null || f2 === null || strChars(f1) > 120 || strChars(f2) > 120) {
          err[`${p}.half`] = 'Moitié-moitié invalide.';
        } else {
          half = { flavor1: f1, flavor2: f2 };
        }
      }
      let note = it.note ?? '';
      if (typeof note !== 'string' || strChars(phpTrim(note)) > 300) {
        err[`${p}.note`] = 'Remarque trop longue (300 caractères au plus).';
        note = '';
      } else if (note.includes('\0')) {
        // Postgres refuse le caractère NUL dans un texte : la remarque est refusée proprement (422) plutôt qu'en erreur 500.
        err[`${p}.note`] = 'Remarque invalide.';
        note = '';
      }
      items.push({ name, variant, qty, unit_price_cents: unit, removed, extras, half, note: phpTrim(note) });
    });
    if (qtySum > 60) err.items = "Trop d'articles (60 au plus).";
  }

  for (const k of ['delivery_fee_cents', 'total_cents']) {
    if (!isIntBetween(b[k] ?? null, 0, 10000000)) err[k] = 'Montant invalide.';
  }

  // Commande planifiée (type Uber Eats) : absent/null = dès que possible. Sinon, même format que les colonnes
  // date (« 2026-11-20T18:00:00Z ») ; la validité du créneau (délai, horaires) est vérifiée par order_create.
  let scheduledFor = null;
  if (b.scheduled_for !== undefined && b.scheduled_for !== null) {
    if (typeof b.scheduled_for !== 'string' || utcToEpoch(b.scheduled_for) === 0) {
      err.scheduled_for = 'Horaire programmé invalide.';
    } else {
      scheduledFor = b.scheduled_for;
    }
  }

  if (Object.keys(err).length > 0) failValidation(err);

  return {
    idempotency_key: key,
    mode,
    payment_methods: mode === 'delivery' ? methods : [],
    cash_change_for: mode === 'delivery' ? cash : null,
    items,
    delivery_fee_cents: b.delivery_fee_cents,
    total_cents: b.total_cents,
    scheduled_for: scheduledFor
  };
}

/** json_encode(JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) de PHP : seuls U+2028 et U+2029 restent échappés. */
function jsonCanonique(v) {
  return JSON.stringify(v).split(String.fromCharCode(0x2028)).join('\\u2028').split(String.fromCharCode(0x2029)).join('\\u2029');
}

/**
 * Empreinte d'idempotence : sha256 du JSON canonique [mode, moyens de paiement, billet, lignes, frais, total].
 * Les lignes sont reconstruites par validateOrderBody() dans un ordre de clés fixe : même corps = même empreinte,
 * quel que soit l'ordre des clés envoyé.
 */
export function orderPayloadHash(o) {
  const canon = [o.mode, o.payment_methods, o.cash_change_for, o.items, o.delivery_fee_cents, o.total_cents, o.scheduled_for];
  return crypto.createHash('sha256').update(jsonCanonique(canon)).digest('hex');
}

/**
 * Catalogue puis disponibilités (après la validation et la clé d'idempotence, avant les totaux).
 * Répond 422 validation / unknown_item / unpriced_item / price_mismatch_line / unavailable_items ;
 * rien n'est enregistré. Renvoie les lignes avec les noms du catalogue (à enregistrer).
 */
export async function orderEnforceCatalogue(o) {
  const err = verifyLinePrices(o.items, o.mode);
  if (err !== null) {
    const { error: code, ...donnees } = err;
    if (code === 'validation') failValidation(donnees.fields);
    const messages = {
      unknown_item: "Un article de votre panier n'est pas à la carte.",
      unpriced_item: "Un article de votre panier n'a pas de prix en ligne.",
      price_mismatch_line: "Le prix d'un article a changé. Rechargez la page avant de commander."
    };
    fail(422, code, messages[code] ?? 'Panier invalide.', donnees);
  }
  const { unavailable, ingredients } = await checkAvailabilityLines(o.items);
  if (unavailable.length > 0) {
    fail(422, 'unavailable_items', 'Certains articles ne sont plus disponibles.', {
      unavailable,
      unavailable_ingredients: ingredients
    });
  }
  return catalogueCanonicalItems(o.items);
}

/**
 * Calcul serveur (porté de cart.js). zone : { minimum_cents, fee_cents } ou null (à emporter).
 * Entiers uniquement.
 */
export function computeOrderTotals(items, mode, zone) {
  let gross = 0;
  const pizzaPrices = [];
  let hasPizza = false;
  for (const it of items) {
    gross += it.unit_price_cents * it.qty;
    if (it.variant !== '') {
      for (let i = 0; i < it.qty; i++) pizzaPrices.push(it.unit_price_cents);
    }
    if (PIZZA_SIZES.includes(it.variant)) hasPizza = true;
  }
  pizzaPrices.sort((a, b) => b - a);
  let promo = 0;
  for (let i = 0; i + 1 < pizzaPrices.length; i += 2) {
    const cheaper = pizzaPrices[i + 1];
    // À emporter : la moins chère offerte. Livraison : la moins chère à moitié prix, arrondi par paire.
    promo += mode === 'pickup' ? cheaper : Math.floor((cheaper + 1) / 2);
  }
  const after = gross - promo;
  const fee = mode === 'delivery' && !hasPizza && zone !== null ? Number(zone.fee_cents) : 0;
  return {
    products_cents: gross,
    promo_cents: promo,
    products_after_promo_cents: after,
    delivery_fee_cents: fee,
    total_cents: after + fee
  };
}

function jsonOuVide(texte, defaut) {
  try {
    const v = JSON.parse(String(texte));
    return v ? v : defaut;
  } catch {
    return defaut;
  }
}

/** Lignes des commandes données, groupées par numéro de commande (Map id -> lignes). */
export async function orderItemsByOrder(orderIds) {
  const map = new Map();
  if (orderIds.length === 0) return map;
  const ph = orderIds.map(() => '?').join(',');
  const rows = await all(`SELECT * FROM order_items WHERE order_id IN (${ph}) ORDER BY order_id, position`, orderIds);
  for (const r of rows) {
    const id = Number(r.order_id);
    if (!map.has(id)) map.set(id, []);
    map.get(id).push({
      name: String(r.name),
      variant: String(r.variant),
      qty: Number(r.qty),
      unit_price_cents: Number(r.unit_price_cents),
      line_total_cents: Number(r.line_total_cents),
      removed: jsonOuVide(r.removed_json, []),
      extras: jsonOuVide(r.extras_json, []),
      half: r.half_json === null ? null : jsonOuVide(r.half_json, null),
      note: String(r.note)
    });
  }
  return map;
}

export function orderView(o, items, owner) {
  const delay = o.delay_minutes === null ? null : Number(o.delay_minutes);
  let readyAt = null;
  if (o.accepted_at !== null && delay !== null) {
    readyAt = utcAt(utcToEpoch(String(o.accepted_at)) + delay * 60);
  }
  let methods;
  try { methods = JSON.parse(String(o.payment_methods)); } catch { methods = null; }
  const v = {
    id: Number(o.id),
    status: String(o.status),
    mode: String(o.mode),
    customer_name: phpTrim(o.customer_first_name + ' ' + o.customer_last_name),
    delivery_address: o.mode === 'delivery' ? { street: o.delivery_street, city: o.delivery_city, housing_type: o.delivery_housing_type } : null,
    payment_methods: Array.isArray(methods) ? methods : [],
    cash_change_for: o.cash_change_for === null ? null : Number(o.cash_change_for),
    items,
    products_cents: Number(o.products_cents),
    promo_cents: Number(o.promo_cents),
    delivery_fee_cents: Number(o.delivery_fee_cents),
    total_cents: Number(o.total_cents),
    created_at: String(o.created_at),
    accepted_at: o.accepted_at,
    refused_at: o.refused_at,
    // Instant où le commerçant a marqué la commande « prête » (statut ready) ; null avant.
    prepared_at: o.prepared_at === undefined ? null : o.prepared_at,
    delay_minutes: delay,
    // Heure prévue (acceptation + délai annoncé) : une estimation, à ne pas confondre avec prepared_at.
    ready_at: readyAt,
    service_day: String(o.service_day),
    // Commande planifiée par le client (type Uber Eats) ; null = commande « dès que possible ».
    scheduled_for: o.scheduled_for === undefined ? null : o.scheduled_for
  };
  if (owner) {
    v.customer_id = Number(o.customer_id);
    v.customer_phone = String(o.customer_phone);
    v.customer_email = String(o.customer_email);
  }
  return v;
}

/** Vues pour une liste de lignes `orders`. */
export async function orderViews(rows, owner) {
  const items = await orderItemsByOrder(rows.map((r) => Number(r.id)));
  return rows.map((r) => orderView(r, items.get(Number(r.id)) ?? [], owner));
}

export async function orderLoad(id) {
  if (!Number.isInteger(id) || id < 1 || id > ID_MAX) return null;
  return one('SELECT * FROM orders WHERE id = ?', [id]);
}
