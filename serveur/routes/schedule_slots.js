// GET schedule_slots?mode=pickup|delivery — créneaux programmables (type Uber Eats), publics, pour le
// sélecteur « Plus tard » du panier. Mode absent/invalide -> pickup (compat). Toujours calculés, même
// restaurant fermé (SBT-003 : une commande planifiée reste possible fermé ; seule une commande « dès que
// possible » est bloquée par order_create.js). `immediate_open` indique seulement si une commande « dès que
// possible » DE CE MODE serait acceptée maintenant, pour que le panier puisse l'annoncer — retrait et
// livraison ont chacun leurs horaires depuis le 24/11/2026 (voir horaires.js/planification.js).
import { allowMethods } from '../core.js';
import { nowUtc } from '../util.js';
import { SERVICES, etatOuverture } from '../horaires.js';
import { creneauxDisponibles, DELAI_MIN_MINUTES, JOURS_MAX, PAS_MINUTES } from '../planification.js';

export default async function scheduleSlots(c) {
  allowMethods(c, ['GET']);
  const service = SERVICES.includes(c.query.get('mode')) ? c.query.get('mode') : 'pickup';
  const etat = await etatOuverture(service);
  return {
    status: 200,
    body: {
      server_now: nowUtc(),
      service,
      immediate_open: etat.ouvert,
      min_lead_minutes: DELAI_MIN_MINUTES,
      max_days: JOURS_MAX,
      step_minutes: PAS_MINUTES,
      days: creneauxDisponibles(service)
    }
  };
}
