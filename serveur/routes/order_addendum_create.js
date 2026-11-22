// POST order_addendum_create — ajout ou modification rattaché à une commande existante (jamais une
// nouvelle commande indépendante) :
//   { order_id, idempotency_key, kind: 'add', items: [...], total_cents }
//   { order_id, idempotency_key, kind: 'modify', target_item_id | target_addendum_item_id, item: {...}, total_cents }
// Fenêtre de 10 minutes depuis orders.created_at (jamais prolongée par un ajout précédent, jamais
// accepted_at). Toujours autorisé dans la fenêtre même si déjà accepté par le commerçant (décision du
// 21/11/2026) : un ticket complémentaire (addendum_print_jobs) l'alerte sans délai, voir impression.js.
import crypto from 'node:crypto';
import { allowMethods, readJsonBody, fail, failValidation, ok } from '../core.js';
import { one, estSchemaAbsent, estViolationUnique, transaction } from '../db.js';
import { requireCustomer } from '../auth.js';
import { DELIVERY_ZONES, isIntBetween, nowUtc, utcAt, utcToEpoch } from '../util.js';
import {
  ADDENDUM_WINDOW_S, ID_MAX, addendumPayloadHash, computeOrderTotals, effectiveOrderLines,
  orderEnforceCatalogue, orderLoad, orderViews, validateItemFields
} from '../orders.js';

/** Comparaison à temps constant de deux empreintes hexadécimales (même garde que order_create.js). */
function memeEmpreinte(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/** Réponse { addendum, order } : l'événement d'identifiant donné, retrouvé dans la vue déjà calculée de la commande (aucune requête de plus). */
async function viewWith(orderRow, addendumId) {
  const order = (await orderViews([orderRow], false))[0];
  return { addendum: order.addenda.find((a) => a.id === addendumId) ?? null, order };
}

export default async function orderAddendumCreate(c) {
  allowMethods(c, ['POST']);
  const b = await readJsonBody(c);
  const [, customer] = await requireCustomer(c);
  const customerId = Number(customer.id);

  // 1. Forme des champs communs.
  const err = {};
  const orderId = b.order_id ?? null;
  if (!Number.isInteger(orderId) || orderId < 1 || orderId > ID_MAX) err.order_id = 'Identifiant de commande invalide.';
  let key = b.idempotency_key ?? null;
  if (typeof key !== 'string' || !/^[A-Za-z0-9-]{8,64}$/.test(key)) { err.idempotency_key = "Clé d'envoi invalide."; key = ''; }
  const kind = b.kind ?? null;
  if (kind !== 'add' && kind !== 'modify') err.kind = 'Type attendu : add ou modify.';
  if (!isIntBetween(b.total_cents ?? null, 0, 10000000)) err.total_cents = 'Montant invalide.';
  let targetItemId = null;
  let targetAddendumItemId = null;
  if (kind === 'modify') {
    const hasItem = isIntBetween(b.target_item_id ?? null, 1, ID_MAX);
    const hasAddendumItem = isIntBetween(b.target_addendum_item_id ?? null, 1, ID_MAX);
    if (hasItem === hasAddendumItem) {
      err.target_item_id = 'Précisez exactement une cible (target_item_id ou target_addendum_item_id).';
    } else if (hasItem) {
      targetItemId = b.target_item_id;
    } else {
      targetAddendumItemId = b.target_addendum_item_id;
    }
  }
  if (Object.keys(err).length > 0) failValidation(err);

  // 2. Session + propriété de la commande.
  const order = await one('SELECT * FROM orders WHERE id = ? AND customer_id = ?', [orderId, customerId]);
  if (order === null) fail(404, 'not_found', 'Commande introuvable.');

  // 3. Résolution de la cible (modify) sur l'état EFFECTIF actuel (replis des modifications précédentes).
  const lines = await effectiveOrderLines(orderId);
  let targetLine = null;
  if (kind === 'modify') {
    targetLine = lines.find((l) => (targetItemId !== null
      ? l.source === 'item' && l.id === targetItemId
      : l.source === 'addendum_item' && l.id === targetAddendumItemId)) ?? null;
    if (targetLine === null) fail(404, 'not_found', 'Article à modifier introuvable.');
  }

  // 4. Forme du contenu : items neufs (add), ou l'état complet soumis pour la cible — nom/taille/moitié
  // IMPOSÉS par la cible, jamais envoyés par le client (une modification ne change jamais la pizza elle-même).
  let items;
  if (kind === 'add') {
    const itemsIn = Array.isArray(b.items) ? b.items : null;
    if (itemsIn === null || itemsIn.length === 0 || itemsIn.length > 10) {
      failValidation({
        items: itemsIn === null ? 'Articles invalides.'
          : (itemsIn.length === 0 ? 'Ajoutez au moins un article.' : "Trop d'articles ajoutés en une fois (10 au plus).")
      });
    }
    const addErr = {};
    items = [];
    itemsIn.forEach((raw, i) => {
      const item = validateItemFields(raw, `items[${i}]`, addErr);
      if (item !== null) items.push(item);
    });
    if (Object.keys(addErr).length > 0) failValidation(addErr);
  } else {
    const raw = {
      name: targetLine.name, variant: targetLine.variant,
      qty: b.item?.qty, unit_price_cents: b.item?.unit_price_cents,
      removed: b.item?.removed, extras: b.item?.extras,
      half: targetLine.half ?? null, note: b.item?.note
    };
    const modErr = {};
    const item = validateItemFields(raw, 'item', modErr);
    if (Object.keys(modErr).length > 0) failValidation(modErr);
    items = [item];
  }

  // 5. Empreinte d'idempotence (sur le contenu normalisé, comme order_create.js) et rejeu éventuel —
  // avant toute vérification de fenêtre/statut : une opération déjà réussie se reconfirme toujours,
  // même si les conditions ont changé depuis (même principe que order_create.js).
  const a = {
    kind, target_item_id: targetItemId, target_addendum_item_id: targetAddendumItemId,
    items: kind === 'add' ? items : null, item: kind === 'modify' ? items[0] : null, total_cents: b.total_cents
  };
  const payloadHash = addendumPayloadHash(a);
  let existing;
  try {
    existing = await one('SELECT * FROM order_addenda WHERE order_id = ? AND idempotency_key = ?', [orderId, key]);
  } catch (e) {
    if (!estSchemaAbsent(e)) throw e;
    fail(503, 'feature_unavailable', "L'ajout/la modification de commande n'est pas encore disponible. Appelez-nous directement.");
  }
  if (existing !== null) {
    if (!memeEmpreinte(existing.payload_hash, payloadHash)) {
      fail(409, 'idempotency_conflict', 'Cet ajout a déjà été envoyé avec un contenu différent.');
    }
    const freshOrder = await orderLoad(orderId);
    return ok({ replayed: true, ...(await viewWith(freshOrder, Number(existing.id))) });
  }

  // 6. Fenêtre (10 min depuis created_at) et statut (new/accepted seulement — rien à ajouter/modifier sur
  // une commande déjà prête, refusée ou annulée).
  if (order.status !== 'new' && order.status !== 'accepted') {
    fail(409, 'not_addable', 'Cette commande ne peut plus être modifiée.', { status: String(order.status) });
  }
  const nowEpoch = utcToEpoch(nowUtc());
  const createdEpoch = utcToEpoch(String(order.created_at));
  if (nowEpoch >= createdEpoch + ADDENDUM_WINDOW_S) {
    fail(409, 'too_late', 'Le délai de 10 minutes pour ajouter ou modifier est dépassé.',
      { addendum_eligible_until: utcAt(createdEpoch + ADDENDUM_WINDOW_S) });
  }

  // 7. Catalogue (prix, disponibilités) : mêmes règles que order_create.js.
  const canonicalItems = await orderEnforceCatalogue({ items, mode: order.mode });

  // 8. Total recalculé sur l'état EFFECTIF complet de la commande (toutes les lignes existantes, la
  // cible remplacée par son nouvel état pour une modification, ou les nouvelles lignes en plus) : la
  // promo « pizza offerte / -50 % » doit rester cohérente sur l'ensemble, jamais seulement sur le delta brut.
  const otherLines = kind === 'modify' ? lines.filter((l) => l !== targetLine) : lines;
  const effectiveAfter = [
    ...otherLines.filter((l) => l.qty > 0).map((l) => ({ unit_price_cents: l.unit_price_cents, qty: l.qty, variant: l.variant })),
    ...canonicalItems.map((it) => ({ unit_price_cents: it.unit_price_cents, qty: it.qty, variant: it.variant }))
  ];
  const zone = order.mode === 'delivery' ? (DELIVERY_ZONES[order.delivery_city] ?? null) : null;
  const totals = computeOrderTotals(effectiveAfter, order.mode, zone);
  if (b.total_cents !== totals.total_cents) {
    fail(409, 'price_mismatch', 'Le total a changé. Rechargez la commande.', {
      server_products_cents: totals.products_cents,
      server_promo_cents: totals.promo_cents,
      server_delivery_fee_cents: totals.delivery_fee_cents,
      server_total_cents: totals.total_cents
    });
  }
  const deltaCents = totals.total_cents - Number(order.total_cents);

  // 9. Transaction : l'événement, ses lignes, la tâche d'alerte, le nouveau total — ou rien.
  const now = nowUtc();
  let addendumId;
  try {
    addendumId = await transaction(async (tx) => {
      const seqRow = await tx.one('SELECT COALESCE(MAX(seq), 0) AS m FROM order_addenda WHERE order_id = ?', [orderId]);
      const seq = Number(seqRow.m) + 1;
      const id = await tx.insert(
        `INSERT INTO order_addenda (order_id, seq, kind, idempotency_key, payload_hash, target_item_id, target_addendum_item_id, delta_cents, customer_first_name, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [orderId, seq, kind, key, payloadHash, targetItemId, targetAddendumItemId, deltaCents, String(order.customer_first_name), now]
      );
      for (let pos = 0; pos < canonicalItems.length; pos++) {
        const it = canonicalItems[pos];
        await tx.insert(
          `INSERT INTO order_addendum_items (addendum_id, position, name, variant, qty, unit_price_cents, line_total_cents,
              removed_json, extras_json, half_json, note, category) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            id, pos, it.name, it.variant, it.qty, it.unit_price_cents, it.unit_price_cents * it.qty,
            JSON.stringify(it.removed), JSON.stringify(it.extras),
            it.half === null ? null : JSON.stringify(it.half), it.note, it.category ?? null
          ]
        );
      }
      await tx.insert(
        "INSERT INTO addendum_print_jobs (addendum_id, status, attempts, created_at, updated_at) VALUES (?, 'pending', 0, ?, ?)",
        [id, now, now]
      );
      await tx.exec('UPDATE orders SET total_cents = ? WHERE id = ?', [totals.total_cents, orderId]);
      return id;
    });
  } catch (e) {
    // Migration pas encore appliquée en prod (order_addenda/order_addendum_items/addendum_print_jobs
    // absentes) : message clair et spécifique plutôt qu'une « erreur interne » générique — cette
    // fonctionnalité repose entièrement sur ces tables, impossible de dégrader proprement ici (contrairement
    // à l'alerte d'annulation, voir order_cancel.js, qui reste facultative).
    if (estSchemaAbsent(e)) {
      fail(503, 'feature_unavailable', "L'ajout/la modification de commande n'est pas encore disponible. Appelez-nous directement.");
    }
    if (!estViolationUnique(e)) throw e;
    // Envoi concurrent avec la même clé : relire la ligne existante, hors transaction (même principe que order_create.js).
    const concurrent = await one('SELECT * FROM order_addenda WHERE order_id = ? AND idempotency_key = ?', [orderId, key]);
    if (concurrent === null) throw e;
    const freshOrder = await orderLoad(orderId);
    return ok({ replayed: true, ...(await viewWith(freshOrder, Number(concurrent.id))) });
  }

  const freshOrder = await orderLoad(orderId);
  return ok({ replayed: false, ...(await viewWith(freshOrder, addendumId)) }, 201);
}
