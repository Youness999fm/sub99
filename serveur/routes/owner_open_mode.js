// GET/POST owner_open_mode — ouverture/fermeture manuelle, par canal (espace patron, accès supérieur 1109).
//   GET  : état courant des DEUX canaux (lecture seule, session commerçant normale — pour afficher le statut
//          sans ressaisir le code).
//   POST { canal: "restaurant"|"delivery", mode: "auto"|"open"|"closed", code } : change la bascule d'un seul
//   canal, réservé au code supérieur. Les deux canaux sont indépendants (demande du 21/11) : forcer l'un
//   n'affecte jamais l'autre.
// AUTO = horaire programmé de ce canal ; FORCE_OPEN/FORCE_CLOSED expirent d'eux-mêmes à la prochaine
// transition automatique DE CE CANAL (jamais besoin d'y repenser le lendemain). Ne concerne que les
// commandes « dès que possible » : une commande planifiée reste toujours possible canal fermé (SBT-003).
import { allowMethods, readJsonBody, bodyStr, failValidation, ok } from '../core.js';
import { requireOwner, requireSuperCode } from '../auth.js';
import { CANAUX, MODES_OUVERTURE, ecrireBascule, etatOuverture, libelleHeure } from '../horaires.js';
import { utcAt } from '../util.js';

function vue(etat) {
  return {
    mode: etat.mode,
    ouvert: etat.ouvert,
    auto_ouvert: etat.auto_ouvert,
    expires_at: etat.expires_at === null ? null : utcAt(etat.expires_at),
    prochaine_transition: etat.prochaine_transition === null ? null : utcAt(etat.prochaine_transition),
    horaire_auto: etat.creneau === null ? null : { opens_at: libelleHeure(etat.creneau.debut), closes_at: libelleHeure(etat.creneau.fin) }
  };
}

export default async function ownerOpenMode(c) {
  const method = allowMethods(c, ['GET', 'POST']);
  let b = null;
  if (method === 'POST') b = await readJsonBody(c);
  await requireOwner(c);

  if (method === 'POST') {
    const canal = b.canal;
    if (typeof canal !== 'string' || !CANAUX.includes(canal)) {
      failValidation({ canal: 'Canal attendu : restaurant ou delivery.' });
    }
    const mode = b.mode;
    if (typeof mode !== 'string' || !MODES_OUVERTURE.includes(mode)) {
      failValidation({ mode: 'Mode attendu : auto, open ou closed.' });
    }
    await requireSuperCode(c, bodyStr(b, 'code'));
    const expiresAt = mode === 'auto' ? null : (await etatOuverture(canal)).prochaine_transition;
    await ecrireBascule(canal, mode, expiresAt);
  }

  const [restaurant, delivery] = await Promise.all([etatOuverture('restaurant'), etatOuverture('delivery')]);
  return ok({ restaurant: vue(restaurant), delivery: vue(delivery) });
}
