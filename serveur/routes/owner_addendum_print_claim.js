// POST owner_addendum_print_claim { id } — réclame le ticket complémentaire d'un ajout/modification/
// annulation (order_addendum_create.js, order_cancel.js), toujours dû dès sa création (pas de délai H-45,
// contrairement à owner_print_claim.php). Réclamation ATOMIQUE, même garantie I9 : un seul appareil obtient
// la tâche si plusieurs sondent au même instant. Après l'impression (ou l'échec), l'appareil doit appeler
// owner_addendum_print_ack.php.
import { allowMethods, readJsonBody, failValidation, ok } from '../core.js';
import { requireOwner } from '../auth.js';
import { one } from '../db.js';
import { reclamerTacheImpressionAjout, addendumPrintJobView } from '../impression.js';

export default async function ownerAddendumPrintClaim(c) {
  allowMethods(c, ['POST']);
  const b = await readJsonBody(c);
  await requireOwner(c);

  const id = b.id ?? null;
  if (!Number.isInteger(id) || id < 1) failValidation({ id: 'Identifiant invalide.' });
  if ((await one('SELECT id FROM order_addenda WHERE id = ?', [id])) === null) return ok({ claimed: false, job: null });

  const device = typeof b.device === 'string' ? b.device : '';
  const job = await reclamerTacheImpressionAjout(id, device);
  return ok({ claimed: job !== null, job: addendumPrintJobView(job) });
}
