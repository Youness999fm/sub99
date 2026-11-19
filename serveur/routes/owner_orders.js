// GET owner_orders — commandes nouvelles (tous jours) + commandes du jour de service.
import { allowMethods, ok } from '../core.js';
import { all } from '../db.js';
import { requireOwner } from '../auth.js';
import { nowUtc, serviceDay } from '../util.js';
import { orderViews } from '../orders.js';

export default async function ownerOrders(c) {
  allowMethods(c, ['GET']);
  await requireOwner(c);
  const rows = await all(
    "SELECT * FROM orders WHERE status = 'new' OR service_day = ? ORDER BY created_at ASC, id ASC",
    [serviceDay()]
  );
  return ok({ server_now: nowUtc(), orders: await orderViews(rows, true) });
}
