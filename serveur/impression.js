// Impression de préparation automatique des commandes planifiées (SBT-005).
//   PRINT_DUE_AT = scheduled_for - 45 minutes. Tant que l'heure n'est pas atteinte, rien ne se passe.
//   Cycle : pending -> claimed (un appareil l'a prise, impression en cours) -> dispatched (octets remis avec
//   succès à l'appli Android — JAMAIS une preuve d'impression physique, voir l'invariant I12 de la mission)
//   | failed (abandon après plusieurs essais) | unknown (résultat jamais revenu, ex. tablette éteinte en
//   plein envoi). Une tâche « claimed » trop ancienne est reclassée pending automatiquement (reclasserClaimsBloques) :
//   jamais bloquée indéfiniment par un appareil qui ne répond plus (I6 — « keep it recoverable »).
// Appareil physique unique dans ce commerce (une seule tablette) : la réclamation atomique (WHERE status =
// 'pending' ... RETURNING) protège quand même contre deux onglets ouverts par erreur sur le même appareil (I9).
import { one, all, exec, estViolationUnique } from './db.js';
import { nowUtc, utcToEpoch, utcAt } from './util.js';

export const PRINT_LEAD_MINUTES = 45;
export const PRINT_MAX_ATTEMPTS = 5; // au-delà : failed, laissé à la réimpression manuelle du commerçant.
export const PRINT_CLAIM_TIMEOUT_S = 120; // une tâche « claimed » plus vieille que ça est considérée bloquée.

/** Crée la tâche d'impression d'une commande planifiée tout juste acceptée. Sans effet si elle existe déjà
 * (rejeu d'acceptation, ou appel redondant) : la contrainte unique sur order_id protège l'idempotence. */
export async function creerTacheImpression(orderId, scheduledForUtc) {
  const dueAt = utcAt(utcToEpoch(scheduledForUtc) - PRINT_LEAD_MINUTES * 60);
  const now = nowUtc();
  try {
    await exec(
      `INSERT INTO print_jobs (order_id, print_due_at, status, attempts, created_at, updated_at)
       VALUES (?, ?, 'pending', 0, ?, ?)`,
      [orderId, dueAt, now, now]
    );
  } catch (e) {
    // Déjà créée (rejeu) : rien à faire. Toute autre erreur doit remonter.
    if (!estViolationUnique(e)) throw e;
  }
}

/** Reclasse pending toute tâche « claimed » depuis plus de PRINT_CLAIM_TIMEOUT_S : l'appareil qui l'avait prise
 * n'a jamais donné de résultat (éteint, appli fermée en plein envoi...). Appelé avant toute lecture des tâches
 * dues, pour qu'aucune commande ne reste bloquée par un appareil disparu. */
export async function reclasserClaimsBloques(maintenant = nowUtc()) {
  const limite = utcAt(utcToEpoch(maintenant) - PRINT_CLAIM_TIMEOUT_S);
  await exec(
    `UPDATE print_jobs SET status = 'pending', last_error = 'appareil sans réponse', updated_at = ?
     WHERE status = 'claimed' AND claimed_at < ?`,
    [maintenant, limite]
  );
}

/** Identifiants de commande dont la tâche d'impression est due (pending, heure atteinte). Reclasse d'abord
 * les tâches « claimed » bloquées, pour que la liste reflète l'état réel. */
export async function commandesImpressionDue(orderIds, maintenant = nowUtc()) {
  if (orderIds.length === 0) return new Set();
  await reclasserClaimsBloques(maintenant);
  const ph = orderIds.map(() => '?').join(',');
  const rows = await all(`SELECT order_id FROM print_jobs WHERE status = 'pending' AND print_due_at <= ? AND order_id IN (${ph})`, [maintenant, ...orderIds]);
  return new Set(rows.map((r) => Number(r.order_id)));
}

/** Réclamation atomique : un seul appareil obtient la tâche, même si plusieurs sondent au même instant (I9).
 * Renvoie la tâche réclamée, ou null si elle n'est plus due (déjà prise, annulée, pas encore à l'heure…). */
export async function reclamerTacheImpression(orderId, claimedBy, maintenant = nowUtc()) {
  await reclasserClaimsBloques(maintenant);
  return one(
    `UPDATE print_jobs SET status = 'claimed', claimed_at = ?, claimed_by = ?, attempts = attempts + 1, updated_at = ?
     WHERE order_id = ? AND status = 'pending' AND print_due_at <= ?
     RETURNING *`,
    [maintenant, String(claimedBy || '').slice(0, 120), maintenant, orderId, maintenant]
  );
}

/** Résultat rapporté par l'appareil qui avait réclamé la tâche (succès, échec, ou résultat jamais revenu).
 * Un échec redevient pending tant que PRINT_MAX_ATTEMPTS n'est pas atteint (nouvelle tentative au prochain
 * sondage, par le même appareil ou un autre) ; au-delà, failed — laissé à la réimpression manuelle. */
export async function accuserReceptionImpression(orderId, outcome, errorMessage, maintenant = nowUtc()) {
  const job = await one('SELECT * FROM print_jobs WHERE order_id = ? AND status = ?', [orderId, 'claimed']);
  if (job === null) return null;
  const attempts = Number(job.attempts);
  let status;
  if (outcome === 'dispatched') status = 'dispatched';
  else if (attempts >= PRINT_MAX_ATTEMPTS) status = 'failed';
  else status = 'pending'; // nouvel essai possible (failed ou unknown, sous le plafond)
  await exec(
    'UPDATE print_jobs SET status = ?, dispatched_at = ?, last_error = ?, updated_at = ? WHERE order_id = ? AND status = ?',
    [status, status === 'dispatched' ? maintenant : null, errorMessage ? String(errorMessage).slice(0, 300) : null, maintenant, orderId, 'claimed']
  );
  return status;
}

/** Vue publique (espace commerçant) de l'état d'impression d'une commande, ou null si aucune tâche n'existe
 * (commande immédiate, ou planifiée pas encore acceptée). */
export function printJobView(row) {
  if (!row) return null;
  return {
    status: String(row.status),
    print_due_at: row.print_due_at,
    attempts: Number(row.attempts),
    last_error: row.last_error ?? null
  };
}
