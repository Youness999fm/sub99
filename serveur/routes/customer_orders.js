// GET customer_orders — commandes du client connecté (50 plus récentes).
import { allowMethods, ok } from '../core.js';
import { all } from '../db.js';
import { requireCustomer } from '../auth.js';
import { orderViews } from '../orders.js';

export default async function customerOrders(c) {
  allowMethods(c, ['GET']);
  const [, cust] = await requireCustomer(c);
  const rows = await all('SELECT * FROM orders WHERE customer_id = ? ORDER BY created_at DESC, id DESC LIMIT 50', [Number(cust.id)]);
  return ok({ orders: await orderViews(rows, false) });
}
