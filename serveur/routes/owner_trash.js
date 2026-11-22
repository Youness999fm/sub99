// GET owner_trash — commandes mises à la corbeille (deleted_at non NULL), les plus récentes en premier.
// Tolère l'absence de la colonne deleted_at (migration pas encore appliquée en prod) : répond une liste
// vide plutôt que de planter, même logique que partout ailleurs dans ce dossier.
import { allowMethods, ok } from '../core.js';
import { all, estSchemaAbsent } from '../db.js';
import { requireOwner } from '../auth.js';
import { orderViews } from '../orders.js';

export default async function ownerTrash(c) {
  allowMethods(c, ['GET']);
  await requireOwner(c);

  let rows = [];
  try {
    rows = await all('SELECT * FROM orders WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC LIMIT 200', []);
  } catch (e) {
    if (!estSchemaAbsent(e)) throw e;
  }
  return ok({ orders: await orderViews(rows, true) });
}
