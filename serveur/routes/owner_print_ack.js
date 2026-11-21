// POST owner_print_ack { id, outcome: "dispatched"|"failed"|"unknown", error? } — l'appareil qui avait réclamé
// la tâche (owner_print_claim.php) rapporte le résultat RÉEL de l'envoi à l'imprimante.
//   dispatched : les octets ont été remis avec succès à l'appli Android (JAMAIS une preuve d'impression
//                physique — voir l'invariant I12 : le papier peut être vide, bourré, l'imprimante éteinte).
//   failed     : l'appli a explicitement signalé un échec (voir error).
//   unknown    : résultat jamais revenu dans le délai (page fermée, réseau coupé en plein envoi…).
// failed/unknown redeviennent "pending" (nouvel essai au prochain sondage) tant que le nombre d'essais n'a
// pas atteint PRINT_MAX_ATTEMPTS ; au-delà, "failed" définitif — laissé à la réimpression manuelle du
// commerçant (bouton « Imprimer le ticket », indépendant de cette tâche planifiée, voir commercant.js).
import { allowMethods, readJsonBody, failValidation, ok } from '../core.js';
import { requireOwner } from '../auth.js';
import { accuserReceptionImpression } from '../impression.js';

const ISSUES = ['dispatched', 'failed', 'unknown'];

export default async function ownerPrintAck(c) {
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
  const status = await accuserReceptionImpression(id, outcome, error);
  return ok({ status });
}
