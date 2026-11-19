<?php
// php api/tools/install.php [--source=<chemin du JSON de disponibilité>]
// Crée les tables (idempotent), le réglage par défaut, et recopie les indisponibilités
// de assets/data/disponibilite.json (lecture seule) sans écraser une ligne existante.
declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    if (!headers_sent()) {
        http_response_code(403);
        header('Content-Type: text/plain; charset=utf-8');
    }
    echo "Outil en ligne de commande uniquement.\n";
    exit(1);
}

require_once __DIR__ . '/../lib/config.php';
require_once __DIR__ . '/../lib/db.php';
require_once __DIR__ . '/../lib/util.php';
require_once __DIR__ . '/../lib/schema.php';
date_default_timezone_set('UTC');

$source = dirname(__DIR__, 2) . '/assets/data/disponibilite.json';
foreach (array_slice($argv, 1) as $arg) {
    if (strpos($arg, '--source=') === 0) {
        $source = substr($arg, 9);
    } else {
        fwrite(STDERR, "Option inconnue : $arg\n");
        exit(1);
    }
}

try {
    $pdo = db();
    $driver = db_driver();
    foreach (schema_sql($driver) as $sql) {
        $pdo->exec($sql);
    }
    echo "Tables prêtes ($driver).\n";

    if (db_one('SELECT skey FROM settings WHERE skey = ?', ['default_delay_minutes']) === null) {
        try {
            db_exec('INSERT INTO settings (skey, svalue) VALUES (?, ?)', ['default_delay_minutes', '30']);
            echo "Réglage default_delay_minutes = 30 ajouté.\n";
        } catch (PDOException $e) {
            if (!db_is_unique_violation($e)) {
                throw $e;
            }
        }
    }

    if (!is_file($source)) {
        echo "Fichier de disponibilité absent : aucune recopie.\n";
        exit(0);
    }
    $data = json_decode((string) file_get_contents($source), true);
    if (!is_array($data)) {
        fwrite(STDERR, "Fichier de disponibilité illisible : aucune recopie.\n");
        exit(1);
    }
    $added = 0;
    $kept = 0;
    $now = now_utc();
    foreach (['pizzasIndisponibles' => 'pizza', 'ingredientsIndisponibles' => 'ingredient'] as $key => $kind) {
        $list = $data[$key] ?? [];
        if (!is_array($list)) {
            continue;
        }
        foreach ($list as $name) {
            if (!is_string($name)) {
                continue;
            }
            $name = clean_spaces($name);
            if ($name === '' || str_chars($name) > 120) {
                continue;
            }
            if (db_one('SELECT id FROM availability WHERE kind = ? AND name = ?', [$kind, $name]) !== null) {
                $kept++;
                continue;
            }
            try {
                db_exec("INSERT INTO availability (kind, name, status, service_day, updated_at) VALUES (?, ?, 'out_manual', NULL, ?)",
                    [$kind, $name, $now]);
                $added++;
            } catch (PDOException $e) {
                if (!db_is_unique_violation($e)) {
                    throw $e;
                }
                $kept++;
            }
        }
    }
    echo "Indisponibilités recopiées : $added ajoutée(s), $kept déjà présente(s).\n";
    exit(0);
} catch (Throwable $e) {
    $detail = $e instanceof PDOException ? 'SQLSTATE ' . ($e->errorInfo[0] ?? $e->getCode()) . ' ' . $e->getMessage() : $e->getMessage();
    fwrite(STDERR, 'Échec de l\'installation : ' . get_class($e) . ' — ' . $detail . "\n");
    exit(1);
}
