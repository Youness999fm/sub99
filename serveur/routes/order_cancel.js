// POST order_cancel — annulation d'une commande par son client, { id }. Décision du 23/11/2026 : le client
// annule DIRECTEMENT, aucune validation du commerçant n'est requise (revient sur la décision du 22/11/2026,
// qui faisait attendre le client sans que l'annulation soit garantie côté commerçant). Fenêtre de 4 minutes
// calculée depuis orders.created_at (confirmation serveur de la commande initiale), jamais réinitialisée.
// Toujours autorisée dans la fenêtre même si déjà acceptée par le commerçant : la commande passe
// immédiatement à 'cancelled' ; un événement order_addenda de type "cancel" + une tâche addendum_print_jobs
// sont créés juste après pour alerter le commerçant sans délai (il juge sur place si c'est encore faisable
// en cuisine, voir assets/js/commercant.js, alertAddendum). Rejeu (déjà annulée) : 200 replayed:true, jamais
// une erreur.
import crypto from 'node:crypto';
import { allowMethods, readJsonBody, fail, failValidation, ok } from '../core.js';
import { estSchemaAbsent, one, transaction } from '../db.js';
import { requireCustomer } from '../auth.js';
import { nowUtc, utcAt, utcToEpoch } from '../util.js';
import { CANCEL_WINDOW_S, ID_MAX, orderLoad, orderViews } from '../orders.js';

/**
 * Insère l'événement d'alerte (vue par la tablette via la queue addendum_print_jobs, voir impression.js).
 * Appelée APRÈS que la demande elle-même soit déjà committée (jamais dans la même transaction) : une
 * alerte qui ne peut pas être créée (ex. migration order_addenda pas encore appliquée en prod) ne doit
 * jamais faire perdre la demande réelle, qui est la partie critique pour le client. Tolère l'absence
 * de schéma comme ailleurs (owner_orders.js) ; toute autre erreur reste silencieuse ici aussi — une
 * alerte manquée reste moins grave qu'une demande qui semble déposée mais ne l'est pas.
 */
async function insertCancelAlert(orderId, order, now) {
  try {
    await transaction(async (tx) => {
      const seqRow = await tx.one('SELECT COALESCE(MAX(seq), 0) AS m FROM order_addenda WHERE order_id = ?', [orderId]);
      const seq = Number(seqRow.m) + 1;
      const payloadHash = crypto.createHash('sha256').update('cancel:' + orderId + ':' + seq).digest('hex');
      const addendumId = await tx.insert(
        `INSERT INTO order_addenda (order_id, seq, kind, idempotency_key, payload_hash, target_item_id, delta_cents, customer_first_name, created_at)
         VALUES (?, ?, 'cancel', ?, ?, NULL, 0, ?, ?)`,
        [orderId, seq, 'cancel-' + orderId + '-' + now, payloadHash, String(order.customer_first_name), now]
      );
      await tx.insert(
        'INSERT INTO addendum_print_jobs (addendum_id, status, attempts, created_at, updated_at) VALUES (?, \'pending\', 0, ?, ?)',
        [addendumId, now, now]
      );
    });
  } catch (e) {
    if (!estSchemaAbsent(e)) throw e;
    // Migration pas encore appliquée : la demande reste valable, seule l'alerte tablette est absente.
  }
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

  // UPDATE conditionnel atomique : annule réellement la commande seulement si new/accepted et encore dans
  // la fenêtre — jamais une lecture préalable suivie d'une décision séparée.
  const n = await transaction((tx) => tx.exec(
    "UPDATE orders SET status = 'cancelled', cancelled_at = ?, cancel_reason = 'client' WHERE id = ? AND status IN ('new', 'accepted') AND created_at > ?",
    [now, id, cutoff]
  ));

  if (n === 1) {
    await insertCancelAlert(id, order, now);
    const fresh = await orderLoad(id);
    return ok({ replayed: false, order: (await orderViews([fresh], false))[0] });
  }

  const fresh = await orderLoad(id);
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
