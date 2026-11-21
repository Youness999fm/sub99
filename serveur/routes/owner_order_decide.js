// POST owner_order_decide — accepter (avec délai), refuser, puis marquer « prête » une commande.
//   { id, action: "accept", delay_minutes: 0|10|20|30|40|50|60 }   new -> accepted (0 = « venir tout de suite »)
//   { id, action: "refuse" }                                  new -> refused
//   { id, action: "ready" }                                   accepted -> ready (le client est prévenu par son suivi)
// Un renvoi identique répond 200 avec replayed: true ; une décision contraire répond 409 already_decided.
import { allowMethods, readJsonBody, fail, failValidation, ok } from '../core.js';
import { exec } from '../db.js';
import { requireOwner } from '../auth.js';
import { DELAY_CHOICES, DELAY_IMMEDIATE, nowUtc } from '../util.js';
import { orderLoad, orderViews } from '../orders.js';
import { creerTacheImpression } from '../impression.js';

export default async function ownerOrderDecide(c) {
  allowMethods(c, ['POST']);
  const b = await readJsonBody(c);
  await requireOwner(c);

  const err = {};
  const id = b.id ?? null;
  if (!Number.isInteger(id) || id < 1) err.id = 'Identifiant invalide.';
  const action = b.action ?? null;
  if (action !== 'accept' && action !== 'refuse' && action !== 'ready') err.action = 'Action attendue : accept, refuse ou ready.';
  let delay = null;
  if (action === 'accept') {
    delay = b.delay_minutes ?? null;
    if (!Number.isInteger(delay) || !(delay === DELAY_IMMEDIATE || DELAY_CHOICES.includes(delay))) {
      err.delay_minutes = 'Délai attendu : tout de suite, 10, 20, 30, 40, 50 ou 60 minutes.';
    }
  }
  if (Object.keys(err).length > 0) failValidation(err);

  // orderLoad() répond null pour un identifiant hors de la plage de la colonne (Postgres refuserait la requête).
  if ((await orderLoad(id)) === null) fail(404, 'not_found', 'Commande introuvable.');

  const now = nowUtc();
  let n;
  if (action === 'accept') {
    n = await exec("UPDATE orders SET status = 'accepted', delay_minutes = ?, accepted_at = ? WHERE id = ? AND status = 'new'",
      [delay, now, id]);
  } else if (action === 'refuse') {
    n = await exec("UPDATE orders SET status = 'refused', refused_at = ? WHERE id = ? AND status = 'new'", [now, id]);
  } else {
    n = await exec("UPDATE orders SET status = 'ready', prepared_at = ? WHERE id = ? AND status = 'accepted'", [now, id]);
  }

  const order = await orderLoad(id);
  let replayed = false;
  if (n !== 1) {
    const current = String(order.status);
    const currentDelay = order.delay_minutes === null ? null : Number(order.delay_minutes);
    const same = (action === 'accept' && (current === 'accepted' || current === 'ready') && currentDelay === delay)
      || (action === 'refuse' && current === 'refused')
      || (action === 'ready' && current === 'ready');
    if (!same) {
      fail(409, 'already_decided', action === 'ready' ? "Cette commande n'est pas en cours de préparation." : 'Cette commande a déjà été traitée.',
        { status: current, delay_minutes: currentDelay });
    }
    replayed = true;
  }

  // Commande planifiée tout juste acceptée (SBT-005) : tâche d'impression de préparation à H-45. Idempotent
  // (contrainte unique sur order_id) : sans effet sur un rejeu d'acceptation.
  if (action === 'accept' && order.scheduled_for !== null) {
    await creerTacheImpression(id, String(order.scheduled_for));
  }

  return ok({ order: (await orderViews([order], true))[0], replayed });
}
