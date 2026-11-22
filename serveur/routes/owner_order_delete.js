// POST owner_order_delete — mise à la corbeille d'une commande terminée, { id }.
// Jamais un vrai DELETE SQL : la commande reste en base (preuve, recette) avec deleted_at renseigné,
// seulement masquée de la file tant qu'elle n'est pas restaurée (voir owner_order_restore.js). Réservé
// aux commandes qui n'ont plus besoin d'action (prête, refusée, annulée) : une commande encore "new" ou
// "accepted" ne peut pas être mise à la corbeille, pour ne jamais faire disparaître par erreur une
// commande que le commerçant doit encore traiter. Idempotent (rejouer répond 200 replayed:true).
import { allowMethods, readJsonBody, fail, failValidation, ok } from '../core.js';
import { estSchemaAbsent, exec } from '../db.js';
import { requireOwner } from '../auth.js';
import { nowUtc } from '../util.js';
import { orderLoad, orderViews } from '../orders.js';

export default async function ownerOrderDelete(c) {
  allowMethods(c, ['POST']);
  const b = await readJsonBody(c);
  await requireOwner(c);

  const id = b.id ?? null;
  if (!Number.isInteger(id) || id < 1) failValidation({ id: 'Identifiant de commande invalide.' });

  const order = await orderLoad(id);
  if (order === null) fail(404, 'not_found', 'Commande introuvable.');
  if (order.status === 'new' || order.status === 'accepted') {
    fail(409, 'not_deletable', 'Seules les commandes terminées (prêtes, refusées ou annulées) peuvent être mises à la corbeille.', { status: String(order.status) });
  }

  const now = nowUtc();
  let n = 0;
  try {
    n = await exec('UPDATE orders SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL', [now, id]);
  } catch (e) {
    if (!estSchemaAbsent(e)) throw e;
    fail(503, 'feature_unavailable', "La corbeille n'est pas encore disponible.");
  }

  const fresh = await orderLoad(id);
  return ok({ order: (await orderViews([fresh], true))[0], replayed: n !== 1 });
}
