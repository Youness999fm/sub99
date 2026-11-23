// GET owner_scheduled — TOUTES les commandes programmées à venir (pas encore honorées), quel que soit le
// moment où elles entrent dans la file active habituelle (owner_orders.php, décision du 22/11/2026) ou si
// elles ont déjà été acceptées automatiquement hors service (décision du même jour, voir order_create.js) :
// jusqu'à 7 jours à l'avance (JOURS_MAX, voir planification.js — rien ne peut être programmé au-delà). Page
// dédiée (demande du 24/11/2026) : le commerçant veut voir toute sa semaine programmée en un coup d'œil,
// pas seulement ce qui approche (owner_orders.js ne montre une commande déjà "accepted" que le jour même,
// voir service_day) ni ce qui vient de "surfacer" (assets/js/commercant.js, surfaced()).
import { allowMethods, ok } from '../core.js';
import { all, estSchemaAbsent } from '../db.js';
import { requireOwner } from '../auth.js';
import { nowUtc } from '../util.js';
import { orderViews } from '../orders.js';

export default async function ownerScheduled(c) {
  allowMethods(c, ['GET']);
  await requireOwner(c);
  const now = nowUtc();
  // Même tolérance que owner_orders.js pour une commande mise à la corbeille entre-temps.
  let rows;
  try {
    rows = await all(
      `SELECT * FROM orders WHERE scheduled_for IS NOT NULL AND scheduled_for > ?
         AND status IN ('new', 'accepted') AND deleted_at IS NULL ORDER BY scheduled_for ASC`,
      [now]
    );
  } catch (e) {
    if (!estSchemaAbsent(e)) throw e;
    rows = await all(
      `SELECT * FROM orders WHERE scheduled_for IS NOT NULL AND scheduled_for > ?
         AND status IN ('new', 'accepted') ORDER BY scheduled_for ASC`,
      [now]
    );
  }
  const orders = await orderViews(rows, true);
  return ok({ server_now: now, orders });
}
