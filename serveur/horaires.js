// Horaires de prise de commande en ligne, à l'heure de Paris — deux canaux indépendants : « restaurant »
// (retrait) et « delivery » (livraison), chacun avec son propre horaire automatique et sa propre bascule
// manuelle (demande du 21/11 : pouvoir ouvrir/fermer l'un sans affecter l'autre).
// Réglage restaurant : variable HORAIRES_COMMANDES, réglage livraison : HORAIRES_LIVRAISON — même format
// « HH:MM-HH:MM » (ex. « 18:00-22:47 »), ou « off » pour accepter les commandes à toute heure.
// Sans variable : contrôle actif uniquement sur Vercel, avec le créneau affiché sur le site.
// En local et dans les tests (hors Vercel), aucun contrôle sauf si la variable est posée.
import { maintenantEpoch } from './horloge.js';
import { FUSEAU, parisLocalVersEpoch, jourParisDecale } from './util.js';
import { one, exec, estViolationUnique } from './db.js';

export const HORAIRES_PAR_DEFAUT = '18:00-22:47';
export const HORAIRES_LIVRAISON_PAR_DEFAUT = '19:00-22:00';
export const MODES_OUVERTURE = ['auto', 'open', 'closed'];
export const CANAUX = ['restaurant', 'delivery'];

function cleEnv(canal) {
  return canal === 'delivery' ? 'HORAIRES_LIVRAISON' : 'HORAIRES_COMMANDES';
}

function defautCanal(canal) {
  return canal === 'delivery' ? HORAIRES_LIVRAISON_PAR_DEFAUT : HORAIRES_PAR_DEFAUT;
}

/** Noms des deux réglages (mode + expiration) en base, distincts par canal — « restaurant » garde les clés
 * historiques (open_mode / open_mode_expires_at), posées avant l'existence du canal livraison. */
function clesBascule(canal) {
  return canal === 'delivery'
    ? { mode: 'open_mode_delivery', exp: 'open_mode_delivery_expires_at' }
    : { mode: 'open_mode', exp: 'open_mode_expires_at' };
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
 * Bascule manuelle ouverture/fermeture d'un canal (accès supérieur, 1109 — voir owner_open_mode.js) :
 * AUTO (horaire programmé), FORCE_OPEN ou FORCE_CLOSED. Une bascule manuelle expire d'elle-même à la
 * prochaine transition automatique de CE canal (voir prochaineTransition()) : jamais besoin d'y repenser
 * le lendemain. Stockée dans la table settings, clés distinctes par canal (clesBascule) ; absente -> auto.
 */
async function lireBascule(canal, maintenant) {
  const { mode: cleMode, exp: cleExp } = clesBascule(canal);
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

/** Fixe la bascule manuelle d'un canal. `mode` parmi MODES_OUVERTURE ; l'expiration est calculée par l'appelant. */
export async function ecrireBascule(canal, mode, expiresAt) {
  if (!CANAUX.includes(canal)) throw new Error('Canal invalide : ' + canal);
  if (!MODES_OUVERTURE.includes(mode)) throw new Error('Mode invalide : ' + mode);
  const { mode: cleMode, exp: cleExp } = clesBascule(canal);
  await Promise.all([
    ecrireReglage(cleMode, mode),
    ecrireReglage(cleExp, expiresAt === null ? null : String(expiresAt))
  ]);
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

/** Créneau applicable à cette exécution pour ce canal, ou null si les commandes sont acceptées à toute heure. */
export function creneauActif(canal, env = process.env) {
  const v = env[cleEnv(canal)];
  if (v !== undefined && v !== '') return lireCreneau(v);
  return env.VERCEL ? lireCreneau(defautCanal(canal)) : null;
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
 * Prochain instant (epoch UTC) où l'ouverture automatique bascule (18h00 ou 22h47, le plus proche après
 * `maintenant`). Null si aucun horaire automatique n'est actif (créneau désactivé, HORAIRES_COMMANDES=off).
 * Cherche sur 2 jours : aujourd'hui et demain suffisent puisque les deux bornes sont dans la même journée
 * civile parisienne (le créneau ne traverse jamais minuit en pratique : 18h00-22h47).
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
 * État d'ouverture complet d'un canal (automatique + bascule manuelle), pour la vérification
 * (order_create.js) et l'affichage commerçant (owner_open_mode.js) : mode effectif, expiration de la
 * bascule, horaire automatique et ouverture résultante pour une commande « dès que possible ». Ne concerne
 * jamais les commandes planifiées (voir planification.js).
 */
export async function etatOuverture(canal, maintenant = maintenantEpoch()) {
  if (!CANAUX.includes(canal)) throw new Error('Canal invalide : ' + canal);
  const creneau = creneauActif(canal);
  const minutes = minutesParis(maintenant);
  const autoOuvert = commandesOuvertes(creneau, minutes);
  const { mode, expiresAt } = await lireBascule(canal, maintenant);
  const ouvert = mode === 'open' ? true : mode === 'closed' ? false : autoOuvert;
  return { canal, mode, expires_at: expiresAt, ouvert, auto_ouvert: autoOuvert, creneau, prochaine_transition: prochaineTransition(creneau, maintenant) };
}
