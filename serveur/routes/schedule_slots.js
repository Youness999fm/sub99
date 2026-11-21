// GET schedule_slots — créneaux programmables (type Uber Eats), publics, pour le sélecteur « Plus tard » du panier.
// Toujours calculés, même restaurant fermé (SBT-003 : une commande planifiée reste possible fermé ; seule une
// commande « dès que possible » est bloquée par order_create.js). `immediate_open` indique seulement si une
// commande « dès que possible » serait acceptée maintenant, pour que le panier puisse l'annoncer.
import { allowMethods } from '../core.js';
import { nowUtc } from '../util.js';
import { etatOuverture } from '../horaires.js';
import { creneauxDisponibles, DELAI_MIN_MINUTES, JOURS_MAX, PAS_MINUTES } from '../planification.js';

export default async function scheduleSlots(c) {
  allowMethods(c, ['GET']);
  const etat = await etatOuverture();
  return {
    status: 200,
    body: {
      server_now: nowUtc(),
      immediate_open: etat.ouvert,
      min_lead_minutes: DELAI_MIN_MINUTES,
      max_days: JOURS_MAX,
      step_minutes: PAS_MINUTES,
      days: creneauxDisponibles()
    }
  };
}
