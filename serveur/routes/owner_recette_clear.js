// POST owner_recette_clear {"code": "..."} — supprime DÉFINITIVEMENT les commandes de la recette du jour
// (acceptées ou prêtes, jour de service courant) et leurs lignes. Irréversible, réservé au code supérieur :
// une fois supprimées, le total ne réapparaît nulle part (aucun appareil, aucun rechargement).
// Les commandes encore nouvelles (non décidées) ou refusées ne sont pas concernées : seule la recette l'est.
import { allowMethods, readJsonBody, bodyStr, ok } from '../core.js';
import { requireOwner, requireSuperCode } from '../auth.js';
import { transaction } from '../db.js';
import { serviceDay } from '../util.js';

export default async function ownerRecetteClear(c) {
  allowMethods(c, ['POST']);
  const b = await readJsonBody(c);
  await requireOwner(c);
  await requireSuperCode(c, bodyStr(b, 'code'));

  const day = serviceDay();
  const deleted = await transaction(async ({ all, exec }) => {
    const rows = await all("SELECT id FROM orders WHERE service_day = ? AND status IN ('accepted', 'ready')", [day]);
    const ids = rows.map((r) => Number(r.id));
    if (ids.length === 0) return 0;
    const placeholders = ids.map(() => '?').join(',');
    await exec(`DELETE FROM order_items WHERE order_id IN (${placeholders})`, ids);
    await exec(`DELETE FROM print_jobs WHERE order_id IN (${placeholders})`, ids);
    return exec(`DELETE FROM orders WHERE id IN (${placeholders})`, ids);
  });

  return ok({ deleted });
}
