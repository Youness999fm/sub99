// Planification de commande (type Uber Eats) : créneaux proposés au client, validation du choix envoyé.
// Reprend trois réglages observés chez Uber Eats : créneaux de 30 minutes, jusqu'à 7 jours à l'avance, au
// plus tard 1 heure avant le créneau choisi. Le retrait programmé a en plus sa propre fenêtre fixe, 18h20 à
// 22h30 (demande explicite du 20/11 : premier retrait possible 20 min après l'ouverture, dernier 17 min
// avant la fermeture générale) — indépendante de HORAIRES_COMMANDES, qui ne régit que « commander maintenant ».
// La fermeture manuelle (store_open) reste vérifiée séparément par l'appelant.
import { maintenantEpoch } from './horloge.js';
import { FUSEAU, utcAt } from './util.js';
import { minutesParis, libelleHeure } from './horaires.js';

export const DELAI_MIN_MINUTES = 60;
export const JOURS_MAX = 7;
export const PAS_MINUTES = 30;
// Bornes incluses (22h30 est un créneau réservable, pas une limite exclue) ; ne traverse jamais minuit.
export const FENETRE_RETRAIT = { debut: 18 * 60 + 20, fin: 22 * 60 + 30 };

function dansFenetreRetrait(minute) {
  return minute >= FENETRE_RETRAIT.debut && minute <= FENETRE_RETRAIT.fin;
}

const FORMAT_JOUR = new Intl.DateTimeFormat('en-CA', { timeZone: FUSEAU, year: 'numeric', month: '2-digit', day: '2-digit' });
const FORMAT_DATETIME = new Intl.DateTimeFormat('en-CA', {
  timeZone: FUSEAU, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
});
const pad2 = (n) => String(n).padStart(2, '0');

/** Epoch UTC (secondes) de l'instant qui s'affiche "year-month-day hour:minute" à Paris. */
function parisVersEpoch(year, month, day, hour, minute) {
  const naif = Math.floor(Date.UTC(year, month - 1, day, hour, minute, 0) / 1000);
  const parts = {};
  for (const p of FORMAT_DATETIME.formatToParts(new Date(naif * 1000))) parts[p.type] = p.value;
  const vu = Math.floor(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), 0) / 1000);
  return naif - (vu - naif);
}

/** Les n prochains jours calendaires parisiens (aujourd'hui inclus), sous forme { year, month, day }. */
function joursAPartirDe(epoch, n) {
  const [y, m, d] = FORMAT_JOUR.format(new Date(epoch * 1000)).split('-').map(Number);
  const base = Date.UTC(y, m - 1, d);
  const jours = [];
  for (let i = 0; i < n; i++) {
    const dt = new Date(base + i * 86400000);
    jours.push({ year: dt.getUTCFullYear(), month: dt.getUTCMonth() + 1, day: dt.getUTCDate() });
  }
  return jours;
}

/**
 * Créneaux programmables des JOURS_MAX prochains jours, groupés par date (AAAA-MM-JJ).
 * Un jour sans créneau valide (horaires fermées, ou tout déjà sous le délai minimum) n'apparaît pas.
 */
export function creneauxDisponibles(maintenant = maintenantEpoch()) {
  const auPlusTot = maintenant + DELAI_MIN_MINUTES * 60;
  const auPlusTard = maintenant + JOURS_MAX * 86400;
  const resultat = [];
  for (const { year, month, day } of joursAPartirDe(maintenant, JOURS_MAX)) {
    const slots = [];
    for (let minute = 0; minute < 1440; minute += PAS_MINUTES) {
      if (!dansFenetreRetrait(minute)) continue;
      const epoch = parisVersEpoch(year, month, day, Math.floor(minute / 60), minute % 60);
      if (epoch < auPlusTot || epoch > auPlusTard) continue;
      slots.push({ time: libelleHeure(minute), iso: utcAt(epoch) });
    }
    if (slots.length) resultat.push({ date: `${year}-${pad2(month)}-${pad2(day)}`, slots });
  }
  return resultat;
}

/** Vrai si l'epoch UTC donné est un créneau programmable valide (alignement, délai, fenêtre de retrait). */
export function creneauValide(epoch, maintenant = maintenantEpoch()) {
  if (!Number.isInteger(epoch)) return false;
  if (epoch % (PAS_MINUTES * 60) !== 0) return false; // le décalage Paris est toujours un nombre entier d'heures
  if (epoch < maintenant + DELAI_MIN_MINUTES * 60) return false;
  if (epoch > maintenant + JOURS_MAX * 86400) return false;
  return dansFenetreRetrait(minutesParis(epoch));
}
