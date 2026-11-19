<?php
// php api/tools/create_owner.php [--reset-password]
// Lit l'e-mail puis le mot de passe sur l'entrée standard (une ligne chacun).
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
require_once __DIR__ . '/../lib/cli.php';
date_default_timezone_set('UTC');

$reset = false;
foreach (array_slice($argv, 1) as $arg) {
    if ($arg === '--reset-password') {
        $reset = true;
    } else {
        fwrite(STDERR, "Option inconnue : $arg\n");
        exit(1);
    }
}

try {
    $email = strtolower(trim(cli_read_line('E-mail du propriétaire : ')));
    $password = cli_read_secret('Mot de passe (12 caractères au moins) : ');
    fwrite(STDERR, "\n");

    if ($email === '' || strlen($email) > 190 || filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
        fwrite(STDERR, "E-mail invalide.\n");
        exit(1);
    }
    if (str_chars($password) < 12 || strlen($password) > 200) {
        fwrite(STDERR, "Mot de passe refusé : 12 caractères au moins, 200 octets au plus.\n");
        exit(1);
    }

    $existing = db_one('SELECT id, email FROM owners ORDER BY id LIMIT 1');
    $now = now_utc();
    if (!$reset) {
        if ($existing !== null) {
            fwrite(STDERR, "Un propriétaire existe déjà. Utilisez --reset-password pour changer son mot de passe.\n");
            exit(1);
        }
        db_exec('INSERT INTO owners (email, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?)',
            [$email, password_hash($password, PASSWORD_DEFAULT), $now, $now]);
        echo "Propriétaire créé.\n";
        exit(0);
    }

    if ($existing === null) {
        fwrite(STDERR, "Aucun propriétaire : lancez l'outil sans --reset-password pour le créer.\n");
        exit(1);
    }
    if (!hash_equals((string) $existing['email'], $email)) {
        fwrite(STDERR, "Cet e-mail ne correspond pas au propriétaire enregistré.\n");
        exit(1);
    }
    $pdo = db();
    $pdo->beginTransaction();
    db_exec('UPDATE owners SET password_hash = ?, updated_at = ? WHERE id = ?',
        [password_hash($password, PASSWORD_DEFAULT), $now, (int) $existing['id']]);
    $n = db_exec("UPDATE sessions SET revoked_at = ? WHERE user_type = 'owner' AND user_id = ? AND revoked_at IS NULL",
        [$now, (int) $existing['id']]);
    $pdo->commit();
    echo "Mot de passe remplacé. Sessions propriétaire révoquées : $n.\n";
    exit(0);
} catch (Throwable $e) {
    fwrite(STDERR, 'Échec : ' . get_class($e) . ($e instanceof PDOException ? ' SQLSTATE ' . ($e->errorInfo[0] ?? $e->getCode()) : '') . "\n");
    exit(1);
}
