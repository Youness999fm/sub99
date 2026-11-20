// Horaires de prise de commande en ligne, à l'heure de Paris.
// Réglage : variable HORAIRES_COMMANDES, au format « HH:MM-HH:MM » (ex. « 18:00-22:47 »),
// ou « off » pour accepter les commandes à toute heure (utile pour un essai en dehors du service).
// Sans variable : contrôle actif uniquement sur Vercel, avec le créneau affiché sur le site (18h00–22h47).
// En local et dans les tests (hors Vercel), aucun contrôle sauf si la variable est posée.
import { maintenantEpoch } from './horloge.js';
import { FUSEAU } from './util.js';
import { one } from './db.js';

export const HORAIRES_PAR_DEFAUT = '18:00-22:47';

/**
 * Fermeture manuelle fixée par le commerçant (table settings, clé « store_open »), prioritaire sur
 * l'horaire programmé (HORAIRES_COMMANDES). Pas de réglage en base -> pas de fermeture manuelle.
 */
export async function fermetureManuelle() {
  const row = await one('SELECT svalue FROM settings WHERE skey = ?', ['store_open']);
  return row !== null && row.svalue === '0';
}

const FORMAT_HEURE = new Intl.DateTimeFormat('fr-FR', { timeZone: FUSEAU, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/** « 18:00-22:47 » → { debut: 1080, fin: 1367 } (minutes depuis minuit), « off » → null, invalide → défaut. */
export function lireCreneau(valeur) {
  const v = String(valeur ?? '').trim().toLowerCase();
  if (v === 'off' || v === 'non' || v === '24h') return null;
  const m = /^([01]?\d|2[0-3])[:h]([0-5]\d)\s*-\s*([01]?\d|2[0-3])[:h]([0-5]\d)$/.exec(v);
  const src = m ? m : /^(\d+):(\d+)-(\d+):(\d+)$/.exec(HORAIRES_PAR_DEFAUT);
  return { debut: Number(src[1]) * 60 + Number(src[2]), fin: Number(src[3]) * 60 + Number(src[4]) };
}

/** Créneau applicable à cette exécution, ou null si les commandes sont acceptées à toute heure. */
export function creneauActif(env = process.env) {
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
