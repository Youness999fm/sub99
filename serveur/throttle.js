// Limitation de débit (table throttle) : compteur par seau, fenêtre simple, verrou au seuil.
// Port de api/lib/throttle.php, avec un comptage ATOMIQUE (une seule instruction SQL) : des requêtes simultanées
// reçoivent des numéros d'essai distincts, et seules les `limit` premières sont traitées.
import net from 'node:net';
import { fail } from './core.js';
import { one, exec } from './db.js';
import { maintenantEpoch } from './horloge.js';

/** Secondes restantes de verrou (0 si libre). */
export async function throttleLocked(bucket) {
  const row = await one('SELECT locked_until FROM throttle WHERE bucket = ?', [bucket]);
  if (row === null || row.locked_until === null) return 0;
  const left = Number(row.locked_until) - maintenantEpoch();
  return left > 0 ? left : 0;
}

/**
 * Compte une tentative (atomique) et renvoie son numéro dans la fenêtre. Quand le seuil est atteint, verrouille
 * le seau pendant `lock` secondes (ou jusqu'à la fin de la fenêtre si `lock` est null).
 */
export async function throttleHit(bucket, limit, windowS, lock = null) {
  const now = maintenantEpoch();
  await exec('DELETE FROM throttle WHERE window_start < ? AND (locked_until IS NULL OR locked_until < ?)', [now - 86400, now]);
  const row = await one(
    `INSERT INTO throttle (bucket, attempts, window_start, locked_until) VALUES (?, 1, ?, NULL)
     ON CONFLICT (bucket) DO UPDATE SET
       attempts = CASE WHEN throttle.window_start + ? <= ? THEN 1 ELSE throttle.attempts + 1 END,
       locked_until = CASE WHEN throttle.window_start + ? <= ? THEN NULL ELSE throttle.locked_until END,
       window_start = CASE WHEN throttle.window_start + ? <= ? THEN ? ELSE throttle.window_start END
     RETURNING attempts, window_start`,
    [bucket, now, windowS, now, windowS, now, windowS, now, now]
  );
  const attempts = Number(row.attempts);
  if (attempts >= limit) {
    const until = lock !== null ? now + lock : Math.max(now + 1, Number(row.window_start) + windowS);
    await exec('UPDATE throttle SET locked_until = ? WHERE bucket = ?', [until, bucket]);
  }
  return attempts;
}

/**
 * Verrou déjà posé -> 429 ; sinon compte la tentative et refuse (429) toute tentative au-delà de `limit`,
 * même si le verrou n'est pas encore visible (requêtes simultanées). Renvoie le numéro de la tentative.
 */
export async function throttleEnforce(bucket, limit, windowS, lock = null) {
  await throttleGuard([bucket]);
  const n = await throttleHit(bucket, limit, windowS, lock);
  if (n > limit) {
    const wait = Math.max(1, await throttleLocked(bucket));
    fail(429, 'too_many_attempts', 'Trop de tentatives. Réessayez plus tard.', { retry_after_seconds: wait }, { 'Retry-After': String(wait) });
  }
  return n;
}

export async function throttleReset(bucket) {
  await exec('DELETE FROM throttle WHERE bucket = ?', [bucket]);
}

/**
 * Annule la tentative comptée par throttleHit() quand elle a réussi : une réussite ne compte pas,
 * mais ne remet pas non plus le compteur à zéro. Le verrou n'est levé que si le compteur repasse sous le seuil.
 */
export async function throttleRefund(bucket, limit) {
  await exec('UPDATE throttle SET attempts = attempts - 1 WHERE bucket = ? AND attempts > 0', [bucket]);
  await exec('UPDATE throttle SET locked_until = NULL WHERE bucket = ? AND attempts < ?', [bucket, limit]);
}

/** Développe une IPv6 en 8 groupes (entiers 16 bits), y compris avec un IPv4 écrit en notation pointée à la fin. */
function groupesIpv6(ip) {
  let texte = ip;
  const pointee = /^(.*:)(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(texte);
  if (pointee) {
    const [, tete, a, b, c, d] = pointee;
    texte = tete + ((Number(a) << 8) | Number(b)).toString(16) + ':' + ((Number(c) << 8) | Number(d)).toString(16);
  }
  const [tete, queue] = texte.split('::');
  const g1 = tete ? tete.split(':') : [];
  const g2 = queue === undefined ? [] : (queue ? queue.split(':') : []);
  let g = g1;
  if (queue !== undefined) g = [...g1, ...Array(Math.max(0, 8 - g1.length - g2.length)).fill('0'), ...g2];
  return g.map((x) => parseInt(x || '0', 16));
}

/**
 * Clé d'adresse pour les seaux par IP : IPv4 telle quelle ; IPv6 réduite à son préfixe /64 (4 premiers groupes) ;
 * une IPv6 « IPv4 mappée » (::ffff:a.b.c.d, quelle que soit son écriture) est traitée comme l'IPv4.
 */
export function throttleIpKey(ip) {
  if (net.isIPv4(ip)) return ip;
  if (!net.isIPv6(ip)) return 'unknown';
  const g = groupesIpv6(ip);
  if (g.length === 8 && g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) {
    return [g[6] >> 8, g[6] & 255, g[7] >> 8, g[7] & 255].join('.');
  }
  return g.slice(0, 4).map((x) => x.toString(16).padStart(4, '0')).join(':') + '::/64';
}

/** Répond 429 si l'un des seaux est verrouillé. */
export async function throttleGuard(buckets) {
  let wait = 0;
  for (const b of buckets) wait = Math.max(wait, await throttleLocked(b));
  if (wait > 0) {
    fail(429, 'too_many_attempts', 'Trop de tentatives. Réessayez plus tard.', { retry_after_seconds: wait }, { 'Retry-After': String(wait) });
  }
}
