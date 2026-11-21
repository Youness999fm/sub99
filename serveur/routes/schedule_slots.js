// GET schedule_slots — créneaux programmables (type Uber Eats), publics, pour le sélecteur « Plus tard » du
// panier. Toujours calculés, même canal fermé (SBT-003 : une commande planifiée reste possible fermé ; seule
// une commande « dès que possible » est bloquée par order_create.js). Réponse par mode (pickup/delivery),
// chacun avec son propre `immediate_open` et ses propres créneaux, car chaque canal a désormais ses propres
// horaires et sa propre bascule manuelle (restaurant vs livraison — demande du 21/11). Le panier bascule entre
// les deux sans refaire d'appel réseau.
import { allowMethods } from '../core.js';
import { nowUtc } from '../util.js';
import { etatOuverture } from '../horaires.js';
import { creneauxDisponibles, DELAI_MIN_MINUTES, JOURS_MAX, PAS_MINUTES } from '../planification.js';

export default async function scheduleSlots(c) {
  allowMethods(c, ['GET']);
  const [restaurant, delivery] = await Promise.all([etatOuverture('restaurant'), etatOuverture('delivery')]);
  return {
    status: 200,
    body: {
      server_now: nowUtc(),
      min_lead_minutes: DELAI_MIN_MINUTES,
      max_days: JOURS_MAX,
      step_minutes: PAS_MINUTES,
      pickup: { immediate_open: restaurant.ouvert, days: creneauxDisponibles('pickup') },
      delivery: { immediate_open: delivery.ouvert, days: creneauxDisponibles('delivery') }
    }
  };
}
