// POST order_cancel — décision du 24/11/2026 : annuler une commande déjà passée n'est PLUS proposé en
// libre-service (le commerçant veut que le client appelle directement, après que l'alerte tablette pour
// ce type d'événement se soit révélée impossible à garantir de façon fiable sur certains appareils — voir
// historique git pour l'implémentation complète, successivement directe puis à validation du commerçant).
// Renvoie 409 avec un message clair et le téléphone, jamais une erreur de validation générique — au cas
// où un client resterait sur une version plus ancienne du site le temps que la mise à jour se propage.
import { allowMethods, readJsonBody, fail, failValidation } from '../core.js';
import { requireCustomer } from '../auth.js';
import { ID_MAX } from '../orders.js';

export default async function orderCancel(c) {
  allowMethods(c, ['POST']);
  const b = await readJsonBody(c);
  await requireCustomer(c);

  const id = b.id ?? null;
  if (!Number.isInteger(id) || id < 1 || id > ID_MAX) failValidation({ id: 'Identifiant de commande invalide.' });

  fail(409, 'cancel_disabled', "L'annulation d'une commande déjà passée n'est pas proposée en libre-service. Merci de nous appeler directement.", { phone: '0321200033' });
}
