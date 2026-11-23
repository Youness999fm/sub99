// Horaires de prise de commande en ligne, à l'heure de Paris — DEUX horaires indépendants (décision du
// 24/11/2026) : retrait sur place (18h00-22h47, comme avant) et livraison (19h00-22h00, plus court — pas
// de livreur disponible avant 19h ni après 22h). Chacun a sa propre bascule manuelle (ouverture/fermeture
// forcée, accès supérieur) : fermer la livraison (ex. plus de livreur ce soir) n'affecte jamais le retrait
// sur place, et inversement.
// Réglage retrait : variable HORAIRES_COMMANDES, au format « HH:MM-HH:MM » (ex. « 18:00-22:47 »), ou
// « off » pour accepter les commandes à toute heure (utile pour un essai en dehors du service).
// Réglage livraison : variable HORAIRES_LIVRAISON_COMMANDES, même format, défaut « 19:00-22:00 ».
// Sans variable : contrôle actif uniquement sur Vercel, avec les créneaux affichés sur le site.
// En local et dans les tests (hors Vercel), aucun contrôle sauf si la variable est posée.
import { maintenantEpoch } from './horloge.js';
import { FUSEAU, parisLocalVersEpoch, jourParisDecale } from './util.js';
import { one, exec, estViolationUnique } from './db.js';

export const HORAIRES_PAR_DEFAUT = '18:00-22:47';
export const HORAIRES_LIVRAISON_PAR_DEFAUT = '19:00-22:00';
export const MODES_OUVERTURE = ['auto', 'open', 'closed'];
export const SERVICES = ['pickup', 'delivery'];

/** Clés settings de la bascule manuelle pour un service donné : pickup garde les clés historiques
 * (compat), livraison utilise de nouvelles clés dédiées — jamais de migration de schéma nécessaire,
 * `settings` est déjà une table clé/valeur générique. */
function clesBascule(service) {
  return service === 'delivery'
    ? { mode: 'open_mode_delivery', expires: 'open_mode_delivery_expires_at' }
    : { mode: 'open_mode', expires: 'open_mode_expires_at' };
}

async function ecrireReglage(cle, valeur) {
  if (valeur === null) { await exec('DELETE FROM settings WHERE skey = ?', [cle]); return; }
  if ((await exec('UPDATE settings SET svalue = ? WHERE skey = ?', [valeur, cle])) === 0) {
    try {
      await exec('INSERT INTO settings (skey, svalue) VALUES (?, ?)', [cle, valeur]);
    } catch (e) {
      if (!estViolationUnique(e)) throw e;
      await exec('UPDATE settings SET svalue = ? WHERE skey = ?', [valeur, cle]);
    }
  }
}

/**
 * Bascule manuelle ouverture/fermeture, PAR SERVICE — pickup ou delivery (accès supérieur, 1109 — voir
 * owner_open_mode.js) : AUTO (horaire programmé), FORCE_OPEN ou FORCE_CLOSED. Une bascule manuelle expire
 * d'elle-même à la prochaine transition automatique DE CE SERVICE (voir prochaineTransition()) : jamais
 * besoin d'y repenser le lendemain. Stockée dans la table settings (clesBascule(service)) ; absente -> auto.
 */
async function lireBascule(service, maintenant) {
  const { mode: cleMode, expires: cleExp } = clesBascule(service);
  const [modeRow, expRow] = await Promise.all([
    one('SELECT svalue FROM settings WHERE skey = ?', [cleMode]),
    one('SELECT svalue FROM settings WHERE skey = ?', [cleExp])
  ]);
  const mode = modeRow !== null && MODES_OUVERTURE.includes(modeRow.svalue) ? modeRow.svalue : 'auto';
  const expiresAt = expRow !== null && /^\d+$/.test(expRow.svalue) ? Number(expRow.svalue) : null;
  if (mode !== 'auto' && expiresAt !== null && maintenant >= expiresAt) {
    // Expirée : on revient à l'automatique, et on l'écrit tout de suite (ne dépend pas du prochain appel).
    await Promise.all([ecrireReglage(cleMode, 'auto'), ecrireReglage(cleExp, null)]);
    return { mode: 'auto', expiresAt: null };
  }
  return { mode, expiresAt };
}

/** Fixe la bascule manuelle d'un service (pickup/delivery). `mode` parmi MODES_OUVERTURE ; l'expiration est calculée par l'appelant. */
export async function ecrireBascule(service, mode, expiresAt) {
  if (!SERVICES.includes(service)) throw new Error('Service invalide : ' + service);
  if (!MODES_OUVERTURE.includes(mode)) throw new Error('Mode invalide : ' + mode);
  const { mode: cleMode, expires: cleExp } = clesBascule(service);
  await Promise.all([
    ecrireReglage(cleMode, mode),
    ecrireReglage(cleExp, expiresAt === null ? null : String(expiresAt))
  ]);
}

/**
 * Fermeture manuelle d'un service (compat) : vrai si sa bascule FORCE_CLOSED est active. Les commandes
 * planifiées ne sont jamais bloquées par cette fonction (voir SBT-003) — seules les commandes « dès que
 * possible » le sont, via etatOuverture().
 */
export async function fermetureManuelle(service = 'pickup', maintenant = maintenantEpoch()) {
  return (await lireBascule(service, maintenant)).mode === 'closed';
}

const FORMAT_HEURE = new Intl.DateTimeFormat('fr-FR', { timeZone: FUSEAU, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/** « 18:00-22:47 » → { debut: 1080, fin: 1367 } (minutes depuis minuit), « off » → null, invalide → défaut. */
export function lireCreneau(valeur, defaut = HORAIRES_PAR_DEFAUT) {
  const v = String(valeur ?? '').trim().toLowerCase();
  if (v === 'off' || v === 'non' || v === '24h') return null;
  const m = /^([01]?\d|2[0-3])[:h]([0-5]\d)\s*-\s*([01]?\d|2[0-3])[:h]([0-5]\d)$/.exec(v);
  const src = m ? m : /^(\d+):(\d+)-(\d+):(\d+)$/.exec(defaut);
  return { debut: Number(src[1]) * 60 + Number(src[2]), fin: Number(src[3]) * 60 + Number(src[4]) };
}

/** Créneau applicable à cette exécution pour un service (pickup/delivery), ou null si les commandes de ce
 * service sont acceptées à toute heure. Variables distinctes : HORAIRES_COMMANDES (pickup, comme avant) et
 * HORAIRES_LIVRAISON_COMMANDES (delivery, nouvelle). */
export function creneauActif(service = 'pickup', env = process.env) {
  if (service === 'delivery') {
    if (env.HORAIRES_LIVRAISON_COMMANDES !== undefined && env.HORAIRES_LIVRAISON_COMMANDES !== '') {
      return lireCreneau(env.HORAIRES_LIVRAISON_COMMANDES, HORAIRES_LIVRAISON_PAR_DEFAUT);
    }
    return env.VERCEL ? lireCreneau(HORAIRES_LIVRAISON_PAR_DEFAUT, HORAIRES_LIVRAISON_PAR_DEFAUT) : null;
  }
  if (env.HORAIRES_COMMANDES !== undefined && env.HORAIRES_COMMANDES !== '') return lireCreneau(env.HORAIRES_COMMANDES);
  return env.VERCEL ? lireCreneau(HORAIRES_PAR_DEFAUT) : null;
}

/** Minutes écoulées depuis minuit, heure de Paris. */
export function minutesParis(epoch = maintenantEpoch()) {
  const [h, m] = FORMAT_HEURE.format(new Date(epoch * 1000)).split(':').map(Number);
  return h * 60 + m;
}

/** Vrai si une commande peut être prise maintenant (créneau [debut, fin[, qui peut passer minuit). */
export function commandesOuvertes(creneau, minutes) {
  if (creneau === null) return true;
  const { debut, fin } = creneau;
  if (debut === fin) return true;
  return debut < fin ? minutes >= debut && minutes < fin : minutes >= debut || minutes < fin;
}

/** « 18h00 » */
export function libelleHeure(minutes) {
  return Math.floor(minutes / 60) + 'h' + String(minutes % 60).padStart(2, '0');
}

/**
 * Prochain instant (epoch UTC) où l'ouverture automatique bascule (borne de `creneau` la plus proche après
 * `maintenant`). Null si aucun horaire automatique n'est actif (créneau désactivé, ex. HORAIRES_COMMANDES=off).
 * Cherche sur 2 jours : aujourd'hui et demain suffisent puisque les deux bornes sont dans la même journée
 * civile parisienne (le créneau ne traverse jamais minuit en pratique, pickup comme livraison).
 */
export function prochaineTransition(creneau, maintenant = maintenantEpoch()) {
  if (creneau === null || creneau.debut === creneau.fin) return null;
  const candidats = [];
  for (let offset = 0; offset <= 1; offset++) {
    const { annee, mois, jour } = jourParisDecale(maintenant, offset);
    for (const minute of [creneau.debut, creneau.fin]) {
      candidats.push(parisLocalVersEpoch(annee, mois, jour, Math.floor(minute / 60), minute % 60));
    }
  }
  const futurs = candidats.filter((e) => e > maintenant).sort((a, b) => a - b);
  return futurs.length ? futurs[0] : null;
}

/**
 * État d'ouverture complet d'un SERVICE (pickup ou delivery — automatique + sa propre bascule manuelle),
 * pour la vérification (order_create.js) et l'affichage commerçant (owner_open_mode.js) : mode effectif,
 * expiration de la bascule, horaire automatique et ouverture résultante pour une commande « dès que
 * possible » de ce service. Ne concerne jamais les commandes planifiées (voir planification.js).
 */
export async function etatOuverture(service = 'pickup', maintenant = maintenantEpoch()) {
  const creneau = creneauActif(service);
  const minutes = minutesParis(maintenant);
  const autoOuvert = commandesOuvertes(creneau, minutes);
  const { mode, expiresAt } = await lireBascule(service, maintenant);
  const ouvert = mode === 'open' ? true : mode === 'closed' ? false : autoOuvert;
  return { service, mode, expires_at: expiresAt, ouvert, auto_ouvert: autoOuvert, creneau, prochaine_transition: prochaineTransition(creneau, maintenant) };
}

/**
 * Instant d'ouverture (epoch UTC) du jour civil parisien contenant `epochCible` — décision du 22/11/2026 :
 * une commande planifiée déposée hors service (le commerçant ne peut pas l'accepter lui-même, voir
 * order_create.js) doit sonner UNE SEULE FOIS, exactement à l'ouverture du jour demandé par le client
 * (18h ce jour-là), jamais un compte à rebours avant l'heure de retrait/livraison (H-45 habituel, réservé
 * aux commandes acceptées par le commerçant lui-même). Si le créneau est désactivé (HORAIRES_COMMANDES=off),
 * renvoie `epochCible` lui-même (rien à attendre, « ouvert » tout le temps).
 */
export function ouvertureDuJour(creneau, epochCible) {
  if (creneau === null) return epochCible;
  const { annee, mois, jour } = jourParisDecale(epochCible, 0);
  return parisLocalVersEpoch(annee, mois, jour, Math.floor(creneau.debut / 60), creneau.debut % 60);
}
