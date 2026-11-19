<?php
// Réponses JSON, méthode HTTP, lecture du corps.
declare(strict_types=1);

const MAX_BODY_BYTES = 65536;

function send_json(int $status, array $data): void
{
    while (ob_get_level() > 0) {
        ob_end_clean();
    }
    if (!headers_sent()) {
        http_response_code($status);
        header('Content-Type: application/json; charset=utf-8');
        header('Cache-Control: no-store');
        header('X-Content-Type-Options: nosniff');
    }
    $json = json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE);
    echo $json === false ? '{"ok":false,"error":"server_error","message":"Erreur interne."}' : $json;
    exit;
}

function ok(array $data = [], int $status = 200): void
{
    send_json($status, ['ok' => true] + $data);
}

function fail(int $status, string $code, string $message, array $extra = []): void
{
    log_event($code, $status);
    send_json($status, ['ok' => false, 'error' => $code, 'message' => $message] + $extra);
}

function fail_validation(array $fields): void
{
    fail(422, 'validation', 'Certains champs sont invalides.', ['fields' => $fields]);
}

/** Journal sans donnée personnelle : route, code, horodatage. */
function log_event(string $code, int $status): void
{
    if ($status >= 500 || in_array($code, ['too_many_attempts', 'bad_origin', 'invalid_credentials'], true)) {
        error_log(sprintf('[subito-api] %s %s %d %s', now_utc(), route_name(), $status, $code));
    }
}

function route_name(): string
{
    $s = (string) ($_SERVER['SCRIPT_NAME'] ?? '');
    $b = basename($s);
    return preg_match('/^[a-z_]+\.php$/', $b) ? $b : '?';
}

function allow_methods(array $methods): string
{
    $m = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    if (!in_array($m, $methods, true)) {
        header('Allow: ' . implode(', ', $methods));
        fail(405, 'method_not_allowed', 'Méthode non autorisée.');
    }
    return $m;
}

/** Corps JSON d'une requête POST : objet uniquement, 64 Ko au plus. */
function read_json_body(): array
{
    $ct = (string) ($_SERVER['CONTENT_TYPE'] ?? $_SERVER['HTTP_CONTENT_TYPE'] ?? '');
    $media = strtolower(trim(explode(';', $ct, 2)[0]));
    if ($media !== 'application/json') {
        fail(415, 'unsupported_media_type', 'Format de requête non pris en charge.');
    }
    $len = $_SERVER['CONTENT_LENGTH'] ?? $_SERVER['HTTP_CONTENT_LENGTH'] ?? null;
    if ($len !== null && $len !== '' && (!ctype_digit((string) $len) || (int) $len > MAX_BODY_BYTES)) {
        fail(413, 'payload_too_large', 'Requête trop volumineuse.');
    }
    $raw = file_get_contents('php://input', false, null, 0, MAX_BODY_BYTES + 1);
    if ($raw === false) {
        $raw = '';
    }
    if (strlen($raw) > MAX_BODY_BYTES) {
        fail(413, 'payload_too_large', 'Requête trop volumineuse.');
    }
    $trim = ltrim($raw);
    if ($trim === '' || $trim[0] !== '{') {
        fail(400, 'bad_request', 'Requête illisible.');
    }
    try {
        $data = json_decode($raw, true, 32, JSON_THROW_ON_ERROR);
    } catch (JsonException $e) {
        fail(400, 'bad_request', 'Requête illisible.');
    }
    if (!is_array($data)) {
        fail(400, 'bad_request', 'Requête illisible.');
    }
    return $data;
}

function client_ip(): string
{
    $ip = (string) ($_SERVER['REMOTE_ADDR'] ?? '');
    return filter_var($ip, FILTER_VALIDATE_IP) ? $ip : 'unknown';
}

function body_bool(array $b, string $k): bool
{
    return isset($b[$k]) && $b[$k] === true;
}

function body_str(array $b, string $k): string
{
    return (isset($b[$k]) && is_string($b[$k])) ? $b[$k] : '';
}
