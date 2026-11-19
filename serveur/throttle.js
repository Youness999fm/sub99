// Limitation de débit (table throttle) : compteur par seau, fenêtre simple, verrou au seuil.
// Port de api/lib/throttle.php.
import net from 'node:net';
import { fail } from './core.js';
import { one, exec, estViolationUnique } from './db.js';
import { maintenantEpoch } from './horloge.js';

/** Secondes restantes de verrou (0 si libre). */
export async function throttleLocked(bucket) {
  const row = await one('SELECT locked_until FROM throttle WHERE bucket = ?', [bucket]);
  if (row === null || row.locked_until === null) return 0;
  const left = Number(row.locked_until) - maintenantEpoch();
  return left > 0 ? left : 0;
}

/**
 * Compte une tentative. Quand le seuil est atteint, verrouille le seau pendant `lock` secondes
 * (ou jusqu'à la fin de la fenêtre si `lock` est null).
 */
export async function throttleHit(bucket, limit, windowS, lock = null) {
  const now = maintenantEpoch();
  await exec('DELETE FROM throttle WHERE window_start < ? AND (locked_until IS NULL OR locked_until < ?)', [now - 86400, now]);

  let row = await one('SELECT window_start FROM throttle WHERE bucket = ?', [bucket]);
  if (row === null) {
    try {
      await exec('INSERT INTO throttle (bucket, attempts, window_start, locked_until) VALUES (?, 1, ?, NULL)', [bucket, now]);
    } catch (e) {
      if (!estViolationUnique(e)) throw e;
      await exec('UPDATE throttle SET attempts = attempts + 1 WHERE bucket = ?', [bucket]);
    }
  } else if (Number(row.window_start) + windowS <= now) {
    const n = await exec('UPDATE throttle SET attempts = 1, window_start = ?, locked_until = NULL WHERE bucket = ? AND window_start = ?',
      [now, bucket, Number(row.window_start)]);
    if (n === 0) await exec('UPDATE throttle SET attempts = attempts + 1 WHERE bucket = ?', [bucket]);
  } else {
    await exec('UPDATE throttle SET attempts = attempts + 1 WHERE bucket = ?', [bucket]);
  }

  row = await one('SELECT attempts, window_start FROM throttle WHERE bucket = ?', [bucket]);
  if (row !== null && Number(row.attempts) >= limit) {
    const until = lock !== null ? now + lock : Math.max(now + 1, Number(row.window_start) + windowS);
    await exec('UPDATE throttle SET locked_until = ? WHERE bucket = ?', [until, bucket]);
  }
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

/** Développe une IPv6 en 8 groupes (tableau d'entiers 16 bits). */
function groupesIpv6(ip) {
  const [tete, queue] = ip.split('::');
  const a = tete ? tete.split(':') : [];
  const b = queue === undefined ? [] : (queue ? queue.split(':') : []);
  let g = a;
  if (queue !== undefined) g = [...a, ...Array(Math.max(0, 8 - a.length - b.length)).fill('0'), ...b];
  return g.map((x) => parseInt(x || '0', 16));
}

/**
 * Clé d'adresse pour les seaux par IP : IPv4 telle quelle ; IPv6 réduite à son préfixe /64 (4 premiers groupes) ;
 * une IPv6 « IPv4 mappée » (::ffff:a.b.c.d) est traitée comme l'IPv4.
 */
export function throttleIpKey(ip) {
  if (net.isIPv4(ip)) return ip;
  if (!net.isIPv6(ip)) return 'unknown';
  const mappee = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mappee && net.isIPv4(mappee[1])) return mappee[1];
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
