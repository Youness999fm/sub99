// POST order_create — création d'une commande (calcul serveur, idempotence).
import crypto from 'node:crypto';
import { allowMethods, readJsonBody, fail, ok } from '../core.js';
import { one, transaction, estViolationUnique } from '../db.js';
import { requireCustomer } from '../auth.js';
import { throttleGuard, throttleHit } from '../throttle.js';
import { DELIVERY_ZONES, nowUtc, serviceDay, utcToEpoch } from '../util.js';
import { libelleHeure, etatOuverture } from '../horaires.js';
import { creneauValide } from '../planification.js';
import {
  validateOrderBody, orderPayloadHash, orderEnforceCatalogue, computeOrderTotals, orderViews, orderLoad, phpTrim
} from '../orders.js';

/** Comparaison à temps constant de deux empreintes hexadécimales. */
function memeEmpreinte(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

export default async function orderCreate(c) {
  allowMethods(c, ['POST']);
  const b = await readJsonBody(c);

  // 1. Session
  const [, customer] = await requireCustomer(c);
  const customerId = Number(customer.id);

  // 2. Forme du corps
  const o = validateOrderBody(b);
  const payloadHash = orderPayloadHash(o);

  /** Rejeu ou conflit pour une clé déjà enregistrée. */
  const replayOrConflict = async (existing) => {
    if (!memeEmpreinte(existing.payload_hash, payloadHash)) {
      fail(409, 'idempotency_conflict', 'Cette commande a déjà été envoyée avec un contenu différent.');
    }
    return ok({ replayed: true, order: (await orderViews([existing], false))[0] }, 200);
  };

  // 3. Clé d'idempotence déjà connue
  const existing = await one('SELECT * FROM orders WHERE customer_id = ? AND idempotency_key = ?', [customerId, o.idempotency_key]);
  if (existing !== null) return replayOrConflict(existing);

  if (o.scheduled_for === null) {
    // Commande « dès que possible » : fermeture manuelle (FORCE_CLOSED) OU hors créneau automatique (AUTO) ->
    // aucune commande nouvelle (personne ne la verrait). Jamais appliqué aux commandes planifiées (SBT-003) :
    // le client doit pouvoir programmer une commande même restaurant/livraison fermé(e). Chaque mode a son
    // propre canal (restaurant/delivery), indépendant.
    const etat = await etatOuverture(o.mode === 'delivery' ? 'delivery' : 'restaurant');
    if (!etat.ouvert) {
      // Fermeture manuelle : pas d'heure annoncée (le commerçant peut rouvrir à tout moment, avant l'expiration
      // automatique de la bascule). Fermé par l'horaire automatique : on annonce l'heure d'ouverture habituelle.
      // Message distinct pour la livraison : les deux canaux sont indépendants, l'un peut être fermé sans
      // l'autre — le client ne doit jamais croire que tout le site est fermé si seule la livraison l'est.
      const quoi = o.mode === 'delivery' ? 'La livraison' : 'La prise de commandes';
      fail(422, 'closed',
        etat.mode === 'closed'
          ? `${quoi} est fermée par le commerçant pour le moment. Réessayez plus tard.`
          : `${quoi} est fermée pour le moment.`,
        etat.mode === 'auto' && etat.creneau ? { opens_at: libelleHeure(etat.creneau.debut), closes_at: libelleHeure(etat.creneau.fin) } : {});
    }
  } else {
    // Commande planifiée : le créneau choisi doit être un horaire réellement proposé pour CE mode (délai,
    // alignement, fenêtre propre au retrait ou à la livraison — voir planification.js).
    if (!creneauValide(utcToEpoch(o.scheduled_for), o.mode)) {
      fail(422, 'invalid_schedule', "L'horaire choisi n'est plus disponible. Choisissez-en un autre.");
    }
  }

  // Limitation de débit : seules les commandes CRÉÉES sont comptées (dans la transaction ci-dessous). Un rejeu
  // répond 200 même après 20 commandes, et une requête refusée (catalogue, total…) ne consomme pas le quota.
  const bucket = 'order_create:customer:' + customerId;
  await throttleGuard([bucket]);

  // 4. Catalogue (article connu, prix unitaire au centime près) puis disponibilités.
  //    Les prix envoyés par le navigateur ne sont acceptés que s'ils sont ceux de la carte.
  //    Les lignes enregistrées portent ensuite le nom du catalogue, pas le texte envoyé
  //    (l'empreinte d'idempotence, elle, reste calculée sur le corps reçu).
  o.items = await orderEnforceCatalogue(o);

  // 5. Profil
  if (phpTrim(customer.phone) === '') {
    fail(422, 'profile_incomplete', 'Ajoutez un numéro de téléphone à votre compte avant de commander.');
  }

  // 6. Adresse et zone
  let zone = null;
  let street = null;
  let city = null;
  let housingType = null;
  if (o.mode === 'delivery') {
    city = customer.city === null ? '' : String(customer.city);
    street = customer.street === null ? '' : phpTrim(customer.street);
    housingType = customer.housing_type === null ? '' : String(customer.housing_type);
    if (street === '' || !Object.prototype.hasOwnProperty.call(DELIVERY_ZONES, city)) {
      fail(422, 'address_required', 'Ajoutez une adresse de livraison dans notre zone.');
    }
    // Compte créé avant l'ajout de ce champ : adresse déjà complète mais type de logement jamais précisé.
    if (housingType === '') {
      fail(422, 'housing_type_required', 'Précisez le type de logement (maison, appartement, immeuble) dans votre adresse de livraison.');
    }
    zone = DELIVERY_ZONES[city];
  }

  // 7. Calcul serveur (prix unitaires vérifiés à l'étape 4)
  const t = computeOrderTotals(o.items, o.mode, zone);
  if (o.mode === 'delivery' && t.products_after_promo_cents < zone.minimum_cents) {
    fail(422, 'minimum_not_reached', "Le minimum de commande pour votre ville n'est pas atteint.", {
      minimum_cents: zone.minimum_cents,
      products_after_promo_cents: t.products_after_promo_cents
    });
  }

  // 8. Comparaison des totaux
  if (o.total_cents !== t.total_cents || o.delivery_fee_cents !== t.delivery_fee_cents) {
    fail(409, 'price_mismatch', 'Le total a changé. Vérifiez votre panier.', {
      server_products_cents: t.products_cents,
      server_promo_cents: t.promo_cents,
      server_delivery_fee_cents: t.delivery_fee_cents,
      server_total_cents: t.total_cents
    });
  }

  // 9. Insertion dans une transaction (la commande et ses lignes, ou rien)
  const now = nowUtc();
  let orderId;
  try {
    orderId = await transaction(async (tx) => {
      const id = await tx.insert(
        `INSERT INTO orders (customer_id, idempotency_key, payload_hash, status, mode,
            customer_first_name, customer_last_name, customer_phone, customer_email,
            delivery_street, delivery_city, delivery_housing_type, payment_methods, cash_change_for, hot_sauce,
            products_cents, promo_cents, delivery_fee_cents, total_cents, delay_minutes,
            created_at, accepted_at, refused_at, service_day, scheduled_for)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL, NULL, ?, ?)`,
        [
          customerId, o.idempotency_key, payloadHash, 'new', o.mode,
          String(customer.first_name), String(customer.last_name),
          String(customer.phone), String(customer.email),
          street, city, housingType, JSON.stringify(o.payment_methods), o.cash_change_for,
          o.hot_sauce === null ? null : (o.hot_sauce ? 1 : 0),
          t.products_cents, t.promo_cents, t.delivery_fee_cents, t.total_cents,
          now, serviceDay(), o.scheduled_for
        ]
      );
      for (let pos = 0; pos < o.items.length; pos++) {
        const it = o.items[pos];
        await tx.insert(
          `INSERT INTO order_items (order_id, position, name, variant, qty, unit_price_cents, line_total_cents,
              removed_json, extras_json, half_json, note, category) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            id, pos, it.name, it.variant, it.qty, it.unit_price_cents, it.unit_price_cents * it.qty,
            JSON.stringify(it.removed), JSON.stringify(it.extras),
            it.half === null ? null : JSON.stringify(it.half), it.note, it.category ?? null
          ]
        );
      }
      // Compté dans la même transaction : des créations simultanées se succèdent sur la ligne du seau (pas de dépassement),
      // et un rejeu ou un conflit (violation d'unicité) n'arrive jamais ici. Au-delà de 20 : annulation de tout.
      const n = await throttleHit(bucket, 20, 600, null, tx);
      if (n > 20) {
        fail(429, 'too_many_attempts', 'Trop de commandes. Réessayez plus tard.', { retry_after_seconds: 600 }, { 'Retry-After': '600' });
      }
      return id;
    });
  } catch (e) {
    if (!estViolationUnique(e)) throw e;
    // Envoi concurrent avec la même clé : la transaction est annulée ; relire la ligne existante, hors transaction.
    const concurrent = await one('SELECT * FROM orders WHERE customer_id = ? AND idempotency_key = ?', [customerId, o.idempotency_key]);
    if (concurrent === null) throw e;
    return replayOrConflict(concurrent);
  }

  const order = await orderLoad(orderId);
  return ok({ replayed: false, order: (await orderViews([order], false))[0] }, 201);
}
