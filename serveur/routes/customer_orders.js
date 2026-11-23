// GET customer_orders — commandes du client connecté (50 plus récentes).
import { allowMethods, ok } from '../core.js';
import { all } from '../db.js';
import { requireCustomer } from '../auth.js';
import { nowUtc } from '../util.js';
import { orderViews } from '../orders.js';

export default async function customerOrders(c) {
  allowMethods(c, ['GET']);
  const [, cust] = await requireCustomer(c);
  const rows = await all('SELECT * FROM orders WHERE customer_id = ? ORDER BY created_at DESC, id DESC LIMIT 50', [Number(cust.id)]);
  // server_now (décision du 24/11/2026) : « Mes commandes » bascule une commande en « Précédentes » 10h
  // après created_at même sans nouveau statut (voir isOngoing, assets/js/compte.js) — calculé côté client,
  // mais sur l'heure serveur plutôt que l'horloge de l'appareil, jamais fiable (fuseau, horloge décalée…).
  return ok({ server_now: nowUtc(), orders: await orderViews(rows, false) });
}
