<?php
// Point d'entrée commun de toutes les routes HTTP de l'API.
declare(strict_types=1);

ini_set('display_errors', '0');
ini_set('html_errors', '0');
error_reporting(E_ALL);
date_default_timezone_set('UTC');
ob_start();

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/db.php';
require_once __DIR__ . '/horloge.php';
require_once __DIR__ . '/util.php';
require_once __DIR__ . '/http.php';
require_once __DIR__ . '/auth.php';
require_once __DIR__ . '/throttle.php';
require_once __DIR__ . '/customers.php';
require_once __DIR__ . '/availability.php';
require_once __DIR__ . '/orders.php';

header_remove('X-Powered-By');
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

set_error_handler(function (int $no, string $str, string $file = '', int $line = 0): bool {
    if (!(error_reporting() & $no)) {
        return false;
    }
    throw new ErrorException($str, 0, $no, $file, $line);
});

set_exception_handler(function (Throwable $e): void {
    // Pas de message PDO (il peut contenir une valeur saisie) : classe, code SQL, fichier, ligne.
    $detail = $e instanceof PDOException
        ? 'SQLSTATE ' . (is_array($e->errorInfo ?? null) ? ($e->errorInfo[0] ?? '?') : (string) $e->getCode())
        : substr($e->getMessage(), 0, 200);
    error_log(sprintf('[subito-api] %s %s 500 server_error %s %s %s:%d',
        gmdate('Y-m-d\TH:i:s\Z'), function_exists('route_name') ? route_name() : '?',
        get_class($e), $detail, basename($e->getFile()), $e->getLine()));
    send_json(500, ['ok' => false, 'error' => 'server_error', 'message' => 'Erreur interne. Réessayez dans un instant.']);
});

register_shutdown_function(function (): void {
    $err = error_get_last();
    if ($err !== null && in_array($err['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR, E_USER_ERROR], true)) {
        error_log(sprintf('[subito-api] %s fatal %s:%d', gmdate('Y-m-d\TH:i:s\Z'), basename((string) $err['file']), (int) $err['line']));
        while (ob_get_level() > 0) {
            ob_end_clean();
        }
        if (!headers_sent()) {
            http_response_code(500);
            header('Content-Type: application/json; charset=utf-8');
            header('Cache-Control: no-store');
            header('X-Content-Type-Options: nosniff');
        }
        echo '{"ok":false,"error":"server_error","message":"Erreur interne. Réessayez dans un instant."}';
    }
});

// Origine : comparaison exacte avec la liste de la configuration.
if (isset($_SERVER['HTTP_ORIGIN'])) {
    $origin = (string) $_SERVER['HTTP_ORIGIN'];
    $allowed = array_map('strval', subito_config()['app_origins']);
    if (!in_array($origin, $allowed, true)) {
        fail(403, 'bad_origin', 'Origine non autorisée.');
    }
}
