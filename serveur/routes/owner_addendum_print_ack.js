// POST owner_addendum_print_ack { id, outcome: "dispatched"|"failed"|"unknown", error? } — l'appareil qui
// avait réclamé le ticket complémentaire (owner_addendum_print_claim.php) rapporte le résultat RÉEL de
// l'envoi à l'imprimante. Mêmes règles que owner_print_ack.php (voir ce fichier) : dispatched = octets
// remis (jamais une preuve d'impression physique) ; failed/unknown redeviennent pending jusqu'à
// PRINT_MAX_ATTEMPTS, puis failed définitif.
import { allowMethods, readJsonBody, failValidation, ok } from '../core.js';
import { requireOwner } from '../auth.js';
import { accuserReceptionImpressionAjout } from '../impression.js';

const ISSUES = ['dispatched', 'failed', 'unknown'];

export default async function ownerAddendumPrintAck(c) {
  allowMethods(c, ['POST']);
  const b = await readJsonBody(c);
  await requireOwner(c);

  const err = {};
  const id = b.id ?? null;
  if (!Number.isInteger(id) || id < 1) err.id = 'Identifiant invalide.';
  const outcome = b.outcome ?? null;
  if (!ISSUES.includes(outcome)) err.outcome = 'Résultat attendu : dispatched, failed ou unknown.';
  if (Object.keys(err).length > 0) failValidation(err);

  const error = typeof b.error === 'string' ? b.error : null;
  const status = await accuserReceptionImpressionAjout(id, outcome, error);
  return ok({ status });
}
