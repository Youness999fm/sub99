// GET schedule_slots — créneaux programmables (type Uber Eats), publics, pour le sélecteur « Plus tard » du panier.
import { allowMethods } from '../core.js';
import { nowUtc } from '../util.js';
import { fermetureManuelle } from '../horaires.js';
import { creneauxDisponibles, DELAI_MIN_MINUTES, JOURS_MAX, PAS_MINUTES } from '../planification.js';

export default async function scheduleSlots(c) {
  allowMethods(c, ['GET']);
  const fermee = await fermetureManuelle();
  const days = fermee ? [] : creneauxDisponibles();
  return {
    status: 200,
    body: {
      server_now: nowUtc(),
      manually_closed: fermee,
      min_lead_minutes: DELAI_MIN_MINUTES,
      max_days: JOURS_MAX,
      step_minutes: PAS_MINUTES,
      days
    }
  };
}
