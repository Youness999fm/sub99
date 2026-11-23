// POST order_addendum_create — décision du 24/11/2026 : ajouter un article à une commande déjà passée
// n'est PLUS proposé en libre-service (le commerçant veut que le client appelle directement, après que
// l'alerte tablette pour ce type d'événement se soit révélée impossible à garantir de façon fiable sur
// certains appareils). `kind: 'add'` était jusqu'ici autorisé (voir historique git pour l'implémentation
// complète : fenêtre de 10 minutes, recalcul de la promo, ticket complémentaire) ; `kind: 'modify'` était
// déjà désactivé depuis le 22/11/2026. Les deux renvoient maintenant 409, avec un message clair et le
// téléphone, jamais une erreur de validation générique — au cas où un client resterait sur une version
// plus ancienne du site le temps que la mise à jour se propage. Les tables (order_addenda,
// order_addendum_items, addendum_print_jobs) restent en base (annulation, voir order_cancel.js, en a
// encore besoin) ; seule la création d'un ajout est bloquée ici.
import { allowMethods, readJsonBody, fail, failValidation } from '../core.js';
import { requireCustomer } from '../auth.js';
import { ID_MAX } from '../orders.js';

export default async function orderAddendumCreate(c) {
  allowMethods(c, ['POST']);
  const b = await readJsonBody(c);
  await requireCustomer(c);

  const err = {};
  const orderId = b.order_id ?? null;
  if (!Number.isInteger(orderId) || orderId < 1 || orderId > ID_MAX) err.order_id = 'Identifiant de commande invalide.';
  let key = b.idempotency_key ?? null;
  if (typeof key !== 'string' || !/^[A-Za-z0-9-]{8,64}$/.test(key)) err.idempotency_key = "Clé d'envoi invalide.";
  const kind = b.kind ?? null;
  if (kind !== 'add' && kind !== 'modify') err.kind = 'Type attendu : add.';
  if (Object.keys(err).length > 0) failValidation(err);

  fail(409, 'addendum_disabled', "L'ajout d'article à une commande déjà passée n'est pas proposé en libre-service. Merci de nous appeler directement.", { phone: '0321200033' });
}
