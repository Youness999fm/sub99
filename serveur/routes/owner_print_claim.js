// POST owner_print_claim { id } — réclame la tâche d'impression de préparation (H-45) d'une commande planifiée,
// si elle est due. Réclamation ATOMIQUE (SBT-005, invariant I9) : si deux appareils sondent au même instant,
// un seul obtient la tâche (UPDATE ... WHERE status = 'pending' ... RETURNING), l'autre reçoit claimed: false
// et ne doit RIEN imprimer. Après l'impression (ou l'échec), l'appareil doit appeler owner_print_ack.php.
import { allowMethods, readJsonBody, failValidation, ok } from '../core.js';
import { requireOwner } from '../auth.js';
import { orderLoad } from '../orders.js';
import { reclamerTacheImpression, printJobView } from '../impression.js';

export default async function ownerPrintClaim(c) {
  allowMethods(c, ['POST']);
  const b = await readJsonBody(c);
  await requireOwner(c);

  const id = b.id ?? null;
  if (!Number.isInteger(id) || id < 1) failValidation({ id: 'Identifiant invalide.' });
  if ((await orderLoad(id)) === null) return ok({ claimed: false, job: null });

  const device = typeof b.device === 'string' ? b.device : '';
  const job = await reclamerTacheImpression(id, device);
  return ok({ claimed: job !== null, job: printJobView(job) });
}
