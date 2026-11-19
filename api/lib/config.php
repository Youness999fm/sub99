<?php
// Lecture de la configuration (api/config.php, ou le fichier désigné par SUBITO_CONFIG).
declare(strict_types=1);

function subito_config(): array
{
    static $cfg = null;
    if ($cfg !== null) {
        return $cfg;
    }
    // SUBITO_CONFIG : seulement en ligne de commande et avec le serveur de test (php -S).
    // En production (Apache, PHP-FPM, CGI), la variable est ignorée.
    $path = in_array(PHP_SAPI, ['cli', 'cli-server'], true) ? getenv('SUBITO_CONFIG') : false;
    if (!is_string($path) || $path === '') {
        $path = dirname(__DIR__) . '/config.php';
    }
    if (!is_file($path)) {
        throw new RuntimeException('Configuration absente');
    }
    $c = require $path;
    if (!is_array($c) || !isset($c['db']['dsn']) || !is_string($c['db']['dsn'])) {
        throw new RuntimeException('Configuration invalide');
    }
    $c += ['app_origins' => [], 'cookie_secure' => true, 'timezone' => 'Europe/Paris'];
    if (!is_array($c['app_origins'])) {
        $c['app_origins'] = [];
    }
    $cfg = $c;
    return $cfg;
}
