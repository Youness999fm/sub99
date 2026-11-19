<?php
// Sessions (jeton aléatoire en cookie HttpOnly, seul le SHA-256 est stocké).
declare(strict_types=1);

const OWNER_COOKIE = 'subito_owner';
const CUSTOMER_COOKIE = 'subito_customer';
const SESSION_SHORT = 43200;     // 12 h
const SESSION_LONG = 2592000;    // 30 jours
const SESSION_TOUCH_EVERY = 300; // 5 min

function auth_cookie_name(string $type): string
{
    return $type === 'owner' ? OWNER_COOKIE : CUSTOMER_COOKIE;
}

function auth_samesite(string $type): string
{
    return $type === 'owner' ? 'Strict' : 'Lax';
}

function new_token(): string
{
    return rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
}

function session_lifetime(string $type, bool $remember): int
{
    return ($type === 'owner' && !$remember) ? SESSION_SHORT : SESSION_LONG;
}

function set_auth_cookie(string $type, string $token, bool $persistent): void
{
    setcookie(auth_cookie_name($type), $token, [
        'expires' => $persistent ? maintenant_epoch() + SESSION_LONG : 0,
        'path' => '/api/',
        'secure' => (bool) subito_config()['cookie_secure'],
        'httponly' => true,
        'samesite' => auth_samesite($type),
    ]);
}

function clear_auth_cookie(string $type): void
{
    setcookie(auth_cookie_name($type), '', [
        'expires' => 1,
        'path' => '/api/',
        'secure' => (bool) subito_config()['cookie_secure'],
        'httponly' => true,
        'samesite' => auth_samesite($type),
    ]);
}

/** Libellé court de l'appareil, tiré du User-Agent (« Chrome · Android »). */
function device_label(): string
{
    $ua = (string) ($_SERVER['HTTP_USER_AGENT'] ?? '');
    $browser = 'Navigateur';
    foreach (['Edg/' => 'Edge', 'OPR/' => 'Opera', 'SamsungBrowser' => 'Samsung Internet', 'Firefox/' => 'Firefox',
              'CriOS' => 'Chrome', 'Chrome/' => 'Chrome', 'Safari/' => 'Safari'] as $needle => $label) {
        if (stripos($ua, $needle) !== false) {
            $browser = $label;
            break;
        }
    }
    $os = 'appareil inconnu';
    foreach (['Android' => 'Android', 'iPhone' => 'iPhone', 'iPad' => 'iPad', 'Windows' => 'Windows',
              'Mac OS X' => 'Mac', 'CrOS' => 'ChromeOS', 'Linux' => 'Linux'] as $needle => $label) {
        if (stripos($ua, $needle) !== false) {
            $os = $label;
            break;
        }
    }
    return substr($browser . ' · ' . $os, 0, 120);
}

/** Crée une session, pose le cookie, renvoie l'id de session. */
function create_session(string $type, int $userId, bool $remember): int
{
    $token = new_token();
    $now = maintenant_epoch();
    $id = db_insert(
        'INSERT INTO sessions (token_hash, user_type, user_id, remember, created_at, last_seen_at, expires_at, revoked_at, device)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)',
        [hash('sha256', $token), $type, $userId, $remember ? 1 : 0, utc_at($now), utc_at($now),
         utc_at($now + session_lifetime($type, $remember)), device_label()]
    );
    set_auth_cookie($type, $token, $type === 'customer' || $remember);
    return $id;
}

/** Session valide du rôle demandé (non révoquée, non expirée), ou null. Prolonge l'expiration (glissante). */
function current_session(string $type): ?array
{
    static $cache = [];
    if (array_key_exists($type, $cache)) {
        return $cache[$type];
    }
    $token = $_COOKIE[auth_cookie_name($type)] ?? null;
    if (!is_string($token) || !preg_match('/^[A-Za-z0-9_-]{43}$/', $token)) {
        return $cache[$type] = null;
    }
    $row = db_one('SELECT * FROM sessions WHERE token_hash = ? AND user_type = ?', [hash('sha256', $token), $type]);
    $now = maintenant_epoch();
    if ($row === null || $row['revoked_at'] !== null || utc_to_epoch((string) $row['expires_at']) <= $now) {
        return $cache[$type] = null;
    }
    if (utc_to_epoch((string) $row['last_seen_at']) <= $now - SESSION_TOUCH_EVERY) {
        $remember = (int) $row['remember'] === 1;
        $exp = utc_at($now + session_lifetime($type, $remember));
        $n = db_exec('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ? AND revoked_at IS NULL',
            [utc_at($now), $exp, (int) $row['id']]);
        if ($n === 1) {
            $row['last_seen_at'] = utc_at($now);
            $row['expires_at'] = $exp;
            if ($type === 'customer' || $remember) {
                set_auth_cookie($type, $token, true);
            }
        }
    }
    return $cache[$type] = $row;
}

/**
 * Hachage factice pour une connexion avec un e-mail inconnu : un seul password_verify,
 * comme pour un compte existant. Créé une fois à l'exécution (valeur aléatoire), gardé
 * dans une variable statique et dans `settings` pour les requêtes suivantes, jamais codé en dur.
 */
function dummy_password_hash(): string
{
    static $hash = null;
    if ($hash !== null) {
        return $hash;
    }
    $row = db_one('SELECT svalue FROM settings WHERE skey = ?', ['login_dummy_hash']);
    if ($row !== null && strpos((string) $row['svalue'], '$') === 0) {
        return $hash = (string) $row['svalue'];
    }
    $hash = password_hash(bin2hex(random_bytes(16)), PASSWORD_DEFAULT);
    try {
        db_exec('INSERT INTO settings (skey, svalue) VALUES (?, ?)', ['login_dummy_hash', $hash]);
    } catch (PDOException $e) {
        if (!db_is_unique_violation($e)) {
            throw $e;
        }
    }
    return $hash;
}

function revoke_session(int $id): void
{
    db_exec('UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL', [now_utc(), $id]);
}

/** Propriétaire connecté, sinon 403 (session client) ou 401. Renvoie [session, owner]. */
function require_owner(): array
{
    $s = current_session('owner');
    if ($s !== null) {
        $owner = db_one('SELECT id, email FROM owners WHERE id = ?', [(int) $s['user_id']]);
        if ($owner !== null) {
            return [$s, $owner];
        }
    }
    if (current_session('customer') !== null) {
        fail(403, 'forbidden', 'Accès réservé au commerçant.');
    }
    fail(401, 'unauthorized', 'Connexion requise.');
    return [];
}

/** Client connecté, sinon 403 (session propriétaire seule) ou 401. Renvoie [session, customer]. */
function require_customer(): array
{
    $c = optional_customer();
    if ($c !== null) {
        return $c;
    }
    if (current_session('owner') !== null) {
        fail(403, 'forbidden', 'Accès réservé aux clients.');
    }
    fail(401, 'unauthorized', 'Connexion requise.');
    return [];
}

function optional_customer(): ?array
{
    $s = current_session('customer');
    if ($s === null) {
        return null;
    }
    $c = db_one('SELECT * FROM customers WHERE id = ?', [(int) $s['user_id']]);
    return $c === null ? null : [$s, $c];
}
