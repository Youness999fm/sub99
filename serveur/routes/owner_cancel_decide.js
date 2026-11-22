// POST owner_cancel_decide — le commerçant tranche une demande d'annulation déposée par le client
// (order_cancel.js) : { id, action: 'accept' | 'refuse' }.
//   accept : la commande passe réellement à 'cancelled' (cancelled_at, cancel_reason='client').
//   refuse : la demande est effacée (cancel_requested_at remis à NULL), la commande continue normalement
//            dans son statut actuel (new/accepted) — le client reprend son suivi comme si de rien n'était.
// Un renvoi identique répond 200 replayed:true ; une décision impossible (déjà tranchée, déjà prête/
// refusée) répond 409 already_decided.
import { allowMethods, readJsonBody, fail, failValidation, ok } from '../core.js';
import { exec } from '../db.js';
import { requireOwner } from '../auth.js';
import { nowUtc } from '../util.js';
import { orderLoad, orderViews } from '../orders.js';

export default async function ownerCancelDecide(c) {
  allowMethods(c, ['POST']);
  const b = await readJsonBody(c);
  await requireOwner(c);

  const err = {};
  const id = b.id ?? null;
  if (!Number.isInteger(id) || id < 1) err.id = 'Identifiant invalide.';
  const action = b.action ?? null;
  if (action !== 'accept' && action !== 'refuse') err.action = 'Action attendue : accept ou refuse.';
  if (Object.keys(err).length > 0) failValidation(err);

  const order = await orderLoad(id);
  if (order === null) fail(404, 'not_found', 'Commande introuvable.');

  const now = nowUtc();
  let n;
  if (action === 'accept') {
    n = await exec(
      "UPDATE orders SET status = 'cancelled', cancelled_at = ?, cancel_reason = 'client', cancel_requested_at = NULL WHERE id = ? AND cancel_requested_at IS NOT NULL AND status IN ('new', 'accepted')",
      [now, id]
    );
  } else {
    n = await exec(
      'UPDATE orders SET cancel_requested_at = NULL WHERE id = ? AND cancel_requested_at IS NOT NULL',
      [id]
    );
  }

  const fresh = await orderLoad(id);
  let replayed = false;
  if (n !== 1) {
    const stillPending = fresh.cancel_requested_at !== null && fresh.cancel_requested_at !== undefined;
    const same = (action === 'accept' && String(fresh.status) === 'cancelled' && !stillPending)
      || (action === 'refuse' && !stillPending && String(fresh.status) !== 'cancelled');
    if (!same) {
      fail(409, 'already_decided', 'Cette demande a déjà été tranchée ou la commande ne peut plus être annulée.',
        { status: String(fresh.status) });
    }
    replayed = true;
  }

  return ok({ order: (await orderViews([fresh], true))[0], replayed });
}
