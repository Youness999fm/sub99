// POST owner_order_restore — sort une commande de la corbeille, { id }. Idempotent (rejouer répond
// 200 replayed:true si elle n'était déjà plus dans la corbeille).
import { allowMethods, readJsonBody, fail, failValidation, ok } from '../core.js';
import { estSchemaAbsent, exec } from '../db.js';
import { requireOwner } from '../auth.js';
import { orderLoad, orderViews } from '../orders.js';

export default async function ownerOrderRestore(c) {
  allowMethods(c, ['POST']);
  const b = await readJsonBody(c);
  await requireOwner(c);

  const id = b.id ?? null;
  if (!Number.isInteger(id) || id < 1) failValidation({ id: 'Identifiant de commande invalide.' });

  const order = await orderLoad(id);
  if (order === null) fail(404, 'not_found', 'Commande introuvable.');

  let n = 0;
  try {
    n = await exec('UPDATE orders SET deleted_at = NULL WHERE id = ? AND deleted_at IS NOT NULL', [id]);
  } catch (e) {
    if (!estSchemaAbsent(e)) throw e;
    fail(503, 'feature_unavailable', "La corbeille n'est pas encore disponible.");
  }

  const fresh = await orderLoad(id);
  return ok({ order: (await orderViews([fresh], true))[0], replayed: n !== 1 });
}
