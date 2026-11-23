// GET owner_orders — commandes nouvelles (tous jours) + commandes du jour de service.
import { allowMethods, ok } from '../core.js';
import { all, estSchemaAbsent } from '../db.js';
import { requireOwner } from '../auth.js';
import { nowUtc, serviceDay } from '../util.js';
import { autoReadyOverdueOrders, orderViews } from '../orders.js';
import { reclasserClaimsBloques, printJobView, addendaImpressionDue, addendumPrintJobView } from '../impression.js';

export default async function ownerOrders(c) {
  allowMethods(c, ['GET']);
  await requireOwner(c);
  const now = nowUtc();
  // Une commande mise à la corbeille (deleted_at non NULL, voir owner_order_delete.js) ne doit plus
  // apparaître ici (elle reste consultable via owner_trash.js). Tolère l'absence de la colonne (migration
  // pas encore appliquée en prod) : dans ce cas, aucune commande n'est jamais "supprimée", comportement
  // identique à avant cette fonctionnalité.
  let rows;
  try {
    rows = await all(
      "SELECT * FROM orders WHERE (status = 'new' OR service_day = ?) AND deleted_at IS NULL ORDER BY created_at ASC, id ASC",
      [serviceDay()]
    );
  } catch (e) {
    if (!estSchemaAbsent(e)) throw e;
    rows = await all(
      "SELECT * FROM orders WHERE status = 'new' OR service_day = ? ORDER BY created_at ASC, id ASC",
      [serviceDay()]
    );
  }
  // Avant de construire les vues : toute commande acceptée dont le délai annoncé est dépassé passe
  // automatiquement "prête" (voir orders.js) — mute `rows` en place, la réponse reflète déjà ce changement.
  await autoReadyOverdueOrders(rows, now);
  const orders = await orderViews(rows, true);
  // Impression de préparation planifiée (SBT-005) : si la table print_jobs n'existe pas encore (migration pas
  // encore appliquée en prod), la liste des commandes doit rester utilisable quand même — on tolère l'échec
  // plutôt que de faire planter owner_orders.php, dont dépendent la tablette et la prise de commande.
  try {
    // Reclasse d'abord toute tâche d'impression bloquée (appareil disparu en plein envoi) : la file affichée
    // doit toujours refléter l'état réel, pas un appareil qui ne répondra jamais.
    await reclasserClaimsBloques(now);
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
  } catch (e) { /* print_jobs indisponible : commandes affichées sans statut d'impression planifiée */ }

  // Ticket complémentaire (ajout/modification/annulation) : même tolérance (addendum_print_jobs absente
  // en prod avant migration ne doit jamais empêcher d'afficher les commandes).
  try {
    const addendumIds = orders.flatMap((o) => o.addenda.map((a) => a.id));
    if (addendumIds.length) {
      const ph = addendumIds.map(() => '?').join(',');
      const jobs = await all(`SELECT * FROM addendum_print_jobs WHERE addendum_id IN (${ph})`, addendumIds);
      const byAddendum = new Map(jobs.map((j) => [Number(j.addendum_id), j]));
      // Reclasse les tâches bloquées ET obtient la liste des tâches dues (toujours due dès pending, pas de délai).
      const due = await addendaImpressionDue(addendumIds, now);
      for (const o of orders) {
        for (const a of o.addenda) {
          const job = byAddendum.get(a.id);
          a.print_job = addendumPrintJobView(job);
          a.print_pending = due.has(a.id);
        }
      }
    }
  } catch (e) { /* addendum_print_jobs indisponible : addenda affichés sans statut d'impression */ }

  return ok({ server_now: now, orders });
}
