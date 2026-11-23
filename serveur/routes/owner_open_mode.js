// GET/POST owner_open_mode — ouverture/fermeture manuelle d'UN SERVICE (retrait sur place OU livraison,
// indépendants depuis le 24/11/2026 — espace patron, accès supérieur 1109).
//   GET ?service=pickup|delivery (défaut pickup) : état courant (lecture seule, session commerçant normale
//     — pour afficher le statut sans ressaisir le code).
//   POST { service: "pickup"|"delivery", mode: "auto"|"open"|"closed", code } : change la bascule DE CE
//     SERVICE, réservé au code supérieur — ne touche jamais l'autre service.
// AUTO = horaire programmé (18h00-22h47 pour le retrait, 19h00-22h00 pour la livraison) ; FORCE_OPEN/
// FORCE_CLOSED expirent d'eux-mêmes à la prochaine transition automatique de ce service (jamais besoin d'y
// repenser le lendemain). Ne concerne que les commandes « dès que possible » : une commande planifiée
// reste toujours possible restaurant/livraison fermé (SBT-003).
import { allowMethods, readJsonBody, bodyStr, failValidation, ok } from '../core.js';
import { requireOwner, requireSuperCode } from '../auth.js';
import { SERVICES, MODES_OUVERTURE, ecrireBascule, etatOuverture, libelleHeure } from '../horaires.js';
import { utcAt } from '../util.js';

function vue(etat) {
  return {
    service: etat.service,
    mode: etat.mode,
    ouvert: etat.ouvert,
    auto_ouvert: etat.auto_ouvert,
    expires_at: etat.expires_at === null ? null : utcAt(etat.expires_at),
    prochaine_transition: etat.prochaine_transition === null ? null : utcAt(etat.prochaine_transition),
    horaire_auto: etat.creneau === null ? null : { opens_at: libelleHeure(etat.creneau.debut), closes_at: libelleHeure(etat.creneau.fin) }
  };
}

function lireService(valeur) {
  return SERVICES.includes(valeur) ? valeur : 'pickup';
}

export default async function ownerOpenMode(c) {
  const method = allowMethods(c, ['GET', 'POST']);
  let b = null;
  if (method === 'POST') b = await readJsonBody(c);
  await requireOwner(c);

  if (method === 'POST') {
    const service = b.service;
    if (typeof service !== 'string' || !SERVICES.includes(service)) {
      failValidation({ service: 'Service attendu : pickup ou delivery.' });
    }
    const mode = b.mode;
    if (typeof mode !== 'string' || !MODES_OUVERTURE.includes(mode)) {
      failValidation({ mode: 'Mode attendu : auto, open ou closed.' });
    }
    await requireSuperCode(c, bodyStr(b, 'code'));
    const expiresAt = mode === 'auto' ? null : (await etatOuverture(service)).prochaine_transition;
    await ecrireBascule(service, mode, expiresAt);
    return ok(vue(await etatOuverture(service)));
  }

  return ok(vue(await etatOuverture(lireService(c.query.get('service')))));
}
