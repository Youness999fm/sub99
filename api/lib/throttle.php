<?php
// Limitation de débit (table throttle) : compteur par seau, fenêtre simple, verrou au seuil.
declare(strict_types=1);

/** Secondes restantes de verrou (0 si libre). */
function throttle_locked(string $bucket): int
{
    $row = db_one('SELECT locked_until FROM throttle WHERE bucket = ?', [$bucket]);
    if ($row === null || $row['locked_until'] === null) {
        return 0;
    }
    $left = (int) $row['locked_until'] - maintenant_epoch();
    return $left > 0 ? $left : 0;
}

/**
 * Compte une tentative. Quand le seuil est atteint, verrouille le seau
 * pendant $lock secondes (ou jusqu'à la fin de la fenêtre si $lock est null).
 */
function throttle_hit(string $bucket, int $limit, int $window, ?int $lock = null): void
{
    $now = maintenant_epoch();
    // Purge des lignes expirées au passage.
    db_exec('DELETE FROM throttle WHERE window_start < ? AND (locked_until IS NULL OR locked_until < ?)', [$now - 86400, $now]);

    $row = db_one('SELECT window_start FROM throttle WHERE bucket = ?', [$bucket]);
    if ($row === null) {
        try {
            db_exec('INSERT INTO throttle (bucket, attempts, window_start, locked_until) VALUES (?, 1, ?, NULL)', [$bucket, $now]);
        } catch (PDOException $e) {
            if (!db_is_unique_violation($e)) {
                throw $e;
            }
            db_exec('UPDATE throttle SET attempts = attempts + 1 WHERE bucket = ?', [$bucket]);
        }
    } elseif ((int) $row['window_start'] + $window <= $now) {
        $n = db_exec('UPDATE throttle SET attempts = 1, window_start = ?, locked_until = NULL WHERE bucket = ? AND window_start = ?',
            [$now, $bucket, (int) $row['window_start']]);
        if ($n === 0) {
            db_exec('UPDATE throttle SET attempts = attempts + 1 WHERE bucket = ?', [$bucket]);
        }
    } else {
        db_exec('UPDATE throttle SET attempts = attempts + 1 WHERE bucket = ?', [$bucket]);
    }

    $row = db_one('SELECT attempts, window_start FROM throttle WHERE bucket = ?', [$bucket]);
    if ($row !== null && (int) $row['attempts'] >= $limit) {
        $until = $lock !== null ? $now + $lock : max($now + 1, (int) $row['window_start'] + $window);
        db_exec('UPDATE throttle SET locked_until = ? WHERE bucket = ?', [$until, $bucket]);
    }
}

function throttle_reset(string $bucket): void
{
    db_exec('DELETE FROM throttle WHERE bucket = ?', [$bucket]);
}

/**
 * Annule la tentative comptée par throttle_hit() quand elle a réussi : une réussite ne compte pas,
 * mais ne remet pas non plus le compteur à zéro (les échecs déjà comptés restent jusqu'à la fin
 * de la fenêtre). Le verrou n'est levé que si le compteur repasse sous le seuil.
 */
function throttle_refund(string $bucket, int $limit): void
{
    db_exec('UPDATE throttle SET attempts = attempts - 1 WHERE bucket = ? AND attempts > 0', [$bucket]);
    db_exec('UPDATE throttle SET locked_until = NULL WHERE bucket = ? AND attempts < ?', [$bucket, $limit]);
}

/**
 * Clé d'adresse pour les seaux par IP : IPv4 telle quelle ; IPv6 réduite à son préfixe /64
 * (les 4 premiers groupes), car un même abonné dispose en général de tout un /64.
 * Une IPv6 « IPv4 mappée » (::ffff:a.b.c.d) est traitée comme l'IPv4.
 */
function throttle_ip_key(string $ip): string
{
    if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4) !== false) {
        return $ip;
    }
    if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV6) === false) {
        return 'unknown';
    }
    $bin = inet_pton($ip);
    if ($bin === false || strlen($bin) !== 16) {
        return 'unknown';
    }
    if (substr($bin, 0, 12) === str_repeat("\0", 10) . "\xff\xff") {
        return (string) inet_ntop(substr($bin, 12));
    }
    $groups = str_split(bin2hex(substr($bin, 0, 8)), 4);
    return implode(':', $groups) . '::/64';
}

/** Répond 429 si l'un des seaux est verrouillé. */
function throttle_guard(array $buckets): void
{
    $wait = 0;
    foreach ($buckets as $b) {
        $wait = max($wait, throttle_locked($b));
    }
    if ($wait > 0) {
        header('Retry-After: ' . $wait);
        fail(429, 'too_many_attempts', 'Trop de tentatives. Réessayez plus tard.', ['retry_after_seconds' => $wait]);
    }
}
