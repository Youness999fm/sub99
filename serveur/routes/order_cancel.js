// POST order_cancel — annulation d'une commande par son client, { id }.
// Fenêtre de 4 minutes calculée depuis orders.created_at (confirmation serveur de la commande initiale),
// jamais réinitialisée. Toujours autorisée dans la fenêtre même si déjà acceptée par le commerçant
// (décision du 21/11/2026) : un événement order_addenda de type "cancel" + une tâche addendum_print_jobs
// sont créés dans la même transaction pour l'alerter immédiatement — lui seul juge sur place si la
// préparation peut être stoppée. Rejeu (déjà annulée) : 200 replayed:true, jamais une erreur.
import crypto from 'node:crypto';
import { allowMethods, readJsonBody, fail, failValidation, ok } from '../core.js';
import { one, transaction } from '../db.js';
import { requireCustomer } from '../auth.js';
import { nowUtc, utcAt, utcToEpoch } from '../util.js';
import { CANCEL_WINDOW_S, ID_MAX, orderLoad, orderViews } from '../orders.js';

/** Insère l'événement d'alerte (vue par la tablette via la queue addendum_print_jobs, voir impression.js). */
async function insertCancelAlert(tx, orderId, order, now) {
  const seqRow = await tx.one('SELECT COALESCE(MAX(seq), 0) AS m FROM order_addenda WHERE order_id = ?', [orderId]);
  const seq = Number(seqRow.m) + 1;
  const payloadHash = crypto.createHash('sha256').update('cancel:' + orderId + ':' + seq).digest('hex');
  const addendumId = await tx.insert(
    `INSERT INTO order_addenda (order_id, seq, kind, idempotency_key, payload_hash, target_item_id, delta_cents, customer_first_name, created_at)
     VALUES (?, ?, 'cancel', ?, ?, NULL, 0, ?, ?)`,
    [orderId, seq, 'cancel-' + orderId, payloadHash, String(order.customer_first_name), now]
  );
  await tx.insert(
    'INSERT INTO addendum_print_jobs (addendum_id, status, attempts, created_at, updated_at) VALUES (?, \'pending\', 0, ?, ?)',
    [addendumId, now, now]
  );
}

export default async function orderCancel(c) {
  allowMethods(c, ['POST']);
  const b = await readJsonBody(c);
  const [, customer] = await requireCustomer(c);
  const customerId = Number(customer.id);

  const id = b.id ?? null;
  if (!Number.isInteger(id) || id < 1 || id > ID_MAX) failValidation({ id: 'Identifiant de commande invalide.' });

  const order = await one('SELECT * FROM orders WHERE id = ? AND customer_id = ?', [id, customerId]);
  if (order === null) fail(404, 'not_found', 'Commande introuvable.');

  const now = nowUtc();
  const nowEpoch = utcToEpoch(now);
  // Strict : « exactement 4 minutes » n'est plus annulable (seulement < 240s, jamais <= 240s). cutoff est
  // le dernier instant encore VALIDE (created_at doit être strictement après pour rester dans la fenêtre).
  const cutoff = utcAt(nowEpoch - CANCEL_WINDOW_S);

  // Deux tentatives conditionnelles distinctes, dans UNE seule transaction : laquelle réussit prouve, de
  // façon atomique, le statut réel au moment du changement — jamais une lecture préalable suivie d'une
  // décision séparée, qui laisserait une fenêtre de course avec une acceptation commerçant concurrente
  // (même principe que les UPDATE conditionnels de owner_order_decide.js).
  const n = await transaction(async (tx) => {
    const fromAccepted = await tx.exec(
      "UPDATE orders SET status = 'cancelled', cancelled_at = ?, cancel_reason = ? WHERE id = ? AND status = 'accepted' AND created_at > ?",
      [now, 'client', id, cutoff]
    );
    if (fromAccepted === 1) {
      await insertCancelAlert(tx, id, order, now);
      return 1;
    }
    return tx.exec(
      "UPDATE orders SET status = 'cancelled', cancelled_at = ?, cancel_reason = ? WHERE id = ? AND status = 'new' AND created_at > ?",
      [now, 'client', id, cutoff]
    );
  });

  const fresh = await orderLoad(id);
  if (n === 1) return ok({ replayed: false, order: (await orderViews([fresh], false))[0] });

  if (String(fresh.status) === 'cancelled') {
    return ok({ replayed: true, order: (await orderViews([fresh], false))[0] });
  }
  const freshCreatedEpoch = utcToEpoch(String(fresh.created_at));
  if (freshCreatedEpoch <= nowEpoch - CANCEL_WINDOW_S) {
    fail(409, 'too_late', 'Le délai de 4 minutes pour annuler est dépassé.',
      { cancel_eligible_until: utcAt(freshCreatedEpoch + CANCEL_WINDOW_S) });
  }
  fail(409, 'not_cancellable', 'Cette commande ne peut plus être annulée.', { status: String(fresh.status) });
}
