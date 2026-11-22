// Impression de préparation automatique des commandes planifiées (SBT-005) ET tickets complémentaires
// d'ajout/modification/annulation (order_addendum_create.js, order_cancel.js) : même cycle de vie pour
// les deux files (print_jobs / addendum_print_jobs), fabriqué une seule fois ci-dessous pour ne jamais
// faire diverger les deux comportements.
//   PRINT_DUE_AT = scheduled_for - 45 minutes pour print_jobs. Un ticket complémentaire est dû
//   IMMÉDIATEMENT (addendum_print_jobs n'a pas de colonne due_at).
//   Cycle commun : pending -> claimed (un appareil l'a prise, impression en cours) -> dispatched (octets
//   remis avec succès à l'appli Android — JAMAIS une preuve d'impression physique, voir l'invariant I12)
//   | failed (abandon après plusieurs essais) | unknown (résultat jamais revenu, ex. tablette éteinte en
//   plein envoi). Une tâche « claimed » trop ancienne est reclassée pending automatiquement
//   (reclasserClaimsBloques) : jamais bloquée indéfiniment par un appareil qui ne répond plus (I6).
// Appareil physique unique dans ce commerce (une seule tablette) : la réclamation atomique (WHERE status =
// 'pending' ... RETURNING) protège quand même contre deux onglets ouverts par erreur sur le même appareil (I9).
import { one, all, exec, estViolationUnique } from './db.js';
import { nowUtc, utcToEpoch, utcAt } from './util.js';

export const PRINT_LEAD_MINUTES = 45;
export const PRINT_MAX_ATTEMPTS = 5; // au-delà : failed, laissé à la réimpression manuelle du commerçant.
export const PRINT_CLAIM_TIMEOUT_S = 120; // une tâche « claimed » plus vieille que ça est considérée bloquée.

/**
 * Fabrique les 5 fonctions du cycle de vie pour une file donnée. `hasDueAt` : si true, une tâche n'est due
 * qu'à partir de sa colonne print_due_at (print_jobs) ; si false, toute tâche pending est due dès sa
 * création (addendum_print_jobs, pas de délai H-45 pour un ticket complémentaire).
 */
function fabriqueFileImpression({ table, keyColumn, hasDueAt }) {
  const dueSql = hasDueAt ? ' AND print_due_at <= ?' : '';

  async function creerTache(key, dueAtUtc) {
    const now = nowUtc();
    const sql = hasDueAt
      ? `INSERT INTO ${table} (${keyColumn}, print_due_at, status, attempts, created_at, updated_at) VALUES (?, ?, 'pending', 0, ?, ?)`
      : `INSERT INTO ${table} (${keyColumn}, status, attempts, created_at, updated_at) VALUES (?, 'pending', 0, ?, ?)`;
    const params = hasDueAt ? [key, dueAtUtc, now, now] : [key, now, now];
    try {
      await exec(sql, params);
    } catch (e) {
      // Déjà créée (rejeu, contrainte unique sur la clé) : rien à faire. Toute autre erreur doit remonter.
      if (!estViolationUnique(e)) throw e;
    }
  }

  async function reclasserClaimsBloques(maintenant = nowUtc()) {
    const limite = utcAt(utcToEpoch(maintenant) - PRINT_CLAIM_TIMEOUT_S);
    await exec(
      `UPDATE ${table} SET status = 'pending', last_error = 'appareil sans réponse', updated_at = ?
       WHERE status = 'claimed' AND claimed_at < ?`,
      [maintenant, limite]
    );
  }

  async function clesDues(keys, maintenant = nowUtc()) {
    if (keys.length === 0) return new Set();
    await reclasserClaimsBloques(maintenant);
    const ph = keys.map(() => '?').join(',');
    const params = [...(hasDueAt ? [maintenant] : []), ...keys];
    const rows = await all(`SELECT ${keyColumn} AS k FROM ${table} WHERE status = 'pending'${dueSql} AND ${keyColumn} IN (${ph})`, params);
    return new Set(rows.map((r) => Number(r.k)));
  }

  async function reclamer(key, claimedBy, maintenant = nowUtc()) {
    await reclasserClaimsBloques(maintenant);
    const params = [maintenant, String(claimedBy || '').slice(0, 120), maintenant, key, ...(hasDueAt ? [maintenant] : [])];
    return one(
      `UPDATE ${table} SET status = 'claimed', claimed_at = ?, claimed_by = ?, attempts = attempts + 1, updated_at = ?
       WHERE ${keyColumn} = ? AND status = 'pending'${dueSql}
       RETURNING *`,
      params
    );
  }

  async function accuserReception(key, outcome, errorMessage, maintenant = nowUtc()) {
    const job = await one(`SELECT * FROM ${table} WHERE ${keyColumn} = ? AND status = ?`, [key, 'claimed']);
    if (job === null) return null;
    const attempts = Number(job.attempts);
    let status;
    if (outcome === 'dispatched') status = 'dispatched';
    else if (attempts >= PRINT_MAX_ATTEMPTS) status = 'failed';
    else status = 'pending'; // nouvel essai possible (failed ou unknown, sous le plafond)
    await exec(
      `UPDATE ${table} SET status = ?, dispatched_at = ?, last_error = ?, updated_at = ? WHERE ${keyColumn} = ? AND status = ?`,
      [status, status === 'dispatched' ? maintenant : null, errorMessage ? String(errorMessage).slice(0, 300) : null, maintenant, key, 'claimed']
    );
    return status;
  }

  return { creerTache, reclasserClaimsBloques, clesDues, reclamer, accuserReception };
}

const filePrintJobs = fabriqueFileImpression({ table: 'print_jobs', keyColumn: 'order_id', hasDueAt: true });
const fileAddendumPrintJobs = fabriqueFileImpression({ table: 'addendum_print_jobs', keyColumn: 'addendum_id', hasDueAt: false });

/** Crée la tâche d'impression d'une commande planifiée tout juste acceptée. Sans effet si elle existe déjà
 * (rejeu d'acceptation, ou appel redondant) : la contrainte unique sur order_id protège l'idempotence. */
export async function creerTacheImpression(orderId, scheduledForUtc) {
  const dueAt = utcAt(utcToEpoch(scheduledForUtc) - PRINT_LEAD_MINUTES * 60);
  await filePrintJobs.creerTache(orderId, dueAt);
}

/** Reclasse pending toute tâche « claimed » depuis plus de PRINT_CLAIM_TIMEOUT_S : l'appareil qui l'avait prise
 * n'a jamais donné de résultat (éteint, appli fermée en plein envoi...). Appelé avant toute lecture des tâches
 * dues, pour qu'aucune commande ne reste bloquée par un appareil disparu. */
export async function reclasserClaimsBloques(maintenant = nowUtc()) {
  await filePrintJobs.reclasserClaimsBloques(maintenant);
}

/** Identifiants de commande dont la tâche d'impression est due (pending, heure atteinte). Reclasse d'abord
 * les tâches « claimed » bloquées, pour que la liste reflète l'état réel. */
export async function commandesImpressionDue(orderIds, maintenant = nowUtc()) {
  return filePrintJobs.clesDues(orderIds, maintenant);
}

/** Réclamation atomique : un seul appareil obtient la tâche, même si plusieurs sondent au même instant (I9).
 * Renvoie la tâche réclamée, ou null si elle n'est plus due (déjà prise, annulée, pas encore à l'heure…). */
export async function reclamerTacheImpression(orderId, claimedBy, maintenant = nowUtc()) {
  return filePrintJobs.reclamer(orderId, claimedBy, maintenant);
}

/** Résultat rapporté par l'appareil qui avait réclamé la tâche (succès, échec, ou résultat jamais revenu).
 * Un échec redevient pending tant que PRINT_MAX_ATTEMPTS n'est pas atteint (nouvelle tentative au prochain
 * sondage, par le même appareil ou un autre) ; au-delà, failed — laissé à la réimpression manuelle. */
export async function accuserReceptionImpression(orderId, outcome, errorMessage, maintenant = nowUtc()) {
  return filePrintJobs.accuserReception(orderId, outcome, errorMessage, maintenant);
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

// ---------- Ticket complémentaire (ajout/modification/annulation, order_addendum_create.js, order_cancel.js) ----------
// Même cycle de vie que ci-dessus, mais dû immédiatement (pas de délai H-45) et clé sur addendum_id.

/** Crée la tâche d'impression d'un ticket complémentaire (ajout/modification/annulation) tout juste confirmé.
 * Sans effet si elle existe déjà (contrainte unique sur addendum_id). */
export async function creerTacheImpressionAjout(addendumId) {
  await fileAddendumPrintJobs.creerTache(addendumId);
}

/** Identifiants d'addenda dont le ticket complémentaire est dû (toujours vrai dès pending : pas de délai). */
export async function addendaImpressionDue(addendumIds, maintenant = nowUtc()) {
  return fileAddendumPrintJobs.clesDues(addendumIds, maintenant);
}

/** Réclamation atomique du ticket complémentaire, même garantie que reclamerTacheImpression. */
export async function reclamerTacheImpressionAjout(addendumId, claimedBy, maintenant = nowUtc()) {
  return fileAddendumPrintJobs.reclamer(addendumId, claimedBy, maintenant);
}

/** Résultat rapporté par l'appareil pour un ticket complémentaire, même règle de nouvelle tentative/abandon. */
export async function accuserReceptionImpressionAjout(addendumId, outcome, errorMessage, maintenant = nowUtc()) {
  return fileAddendumPrintJobs.accuserReception(addendumId, outcome, errorMessage, maintenant);
}

/** Vue publique (espace commerçant) de l'état d'impression d'un ticket complémentaire, ou null si aucune
 * tâche n'existe (ne devrait pas arriver : une tâche est toujours créée avec l'addenda). */
export function addendumPrintJobView(row) {
  if (!row) return null;
  return {
    status: String(row.status),
    attempts: Number(row.attempts),
    last_error: row.last_error ?? null
  };
}
