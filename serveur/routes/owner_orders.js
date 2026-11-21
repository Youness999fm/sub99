// GET owner_orders — commandes nouvelles (tous jours) + commandes du jour de service.
import { allowMethods, ok } from '../core.js';
import { all } from '../db.js';
import { requireOwner } from '../auth.js';
import { nowUtc, serviceDay } from '../util.js';
import { orderViews } from '../orders.js';
import { reclasserClaimsBloques, printJobView } from '../impression.js';

export default async function ownerOrders(c) {
  allowMethods(c, ['GET']);
  await requireOwner(c);
  const now = nowUtc();
  // Reclasse d'abord toute tâche d'impression bloquée (appareil disparu en plein envoi, SBT-005) : la file
  // affichée doit toujours refléter l'état réel, pas un appareil qui ne répondra jamais.
  await reclasserClaimsBloques(now);
  const rows = await all(
    "SELECT * FROM orders WHERE status = 'new' OR service_day = ? ORDER BY created_at ASC, id ASC",
    [serviceDay()]
  );
  const orders = await orderViews(rows, true);
  if (orders.length) {
    const ph = orders.map(() => '?').join(',');
    const jobs = await all(`SELECT * FROM print_jobs WHERE order_id IN (${ph})`, orders.map((o) => o.id));
    const byOrder = new Map(jobs.map((j) => [Number(j.order_id), j]));
    for (const o of orders) {
      const job = byOrder.get(o.id);
      o.print_job = printJobView(job);
      o.print_due = Boolean(job && job.status === 'pending' && String(job.print_due_at) <= now);
    }
  }
  return ok({ server_now: now, orders });
}
