// GET order_status?id=42 — une commande du client connecté.
import { allowMethods, fail, ok } from '../core.js';
import { one } from '../db.js';
import { requireCustomer } from '../auth.js';
import { nowUtc } from '../util.js';
import { ID_MAX, autoReadyOverdueOrders, orderViews } from '../orders.js';

export default async function orderStatus(c) {
  allowMethods(c, ['GET']);
  const [, cust] = await requireCustomer(c);

  // Comme $_GET de PHP : la dernière valeur d'un paramètre répété l'emporte.
  const valeurs = c.query.getAll('id');
  const raw = valeurs.length ? valeurs[valeurs.length - 1] : '';
  const id = /^[1-9][0-9]{0,9}$/.test(raw) ? Number(raw) : 0;
  // Au-delà du plus grand entier de la colonne, la commande ne peut pas exister (et Postgres refuserait la requête).
  const order = id > 0 && id <= ID_MAX ? await one('SELECT * FROM orders WHERE id = ? AND customer_id = ?', [id, Number(cust.id)]) : null;
  if (order === null) fail(404, 'not_found', 'Commande introuvable.');
  const now = nowUtc();
  // Le suivi client doit voir "prête" dès que le délai annoncé est dépassé, même si la tablette du
  // commerçant n'a pas encore sondé owner_orders.php entre-temps (voir orders.js).
  await autoReadyOverdueOrders([order], now);
  return ok({ server_now: now, order: (await orderViews([order], false))[0] });
}
