<?php
// php api/tools/reset_customer.php
// Lit l'e-mail du client puis le nouveau mot de passe sur l'entrée standard (une ligne chacun),
// remplace le mot de passe et révoque toutes les sessions de ce client.
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

if (count($argv) > 1) {
    fwrite(STDERR, "Aucune option attendue.\n");
    exit(1);
}

try {
    $email = strtolower(trim(cli_read_line('E-mail du client : ')));
    $password = cli_read_secret('Nouveau mot de passe (8 caractères au moins) : ');
    fwrite(STDERR, "\n");

    if ($email === '' || strlen($email) > 190 || filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
        fwrite(STDERR, "E-mail invalide.\n");
        exit(1);
    }
    if (strlen($password) < 8 || strlen($password) > 200) {
        fwrite(STDERR, "Mot de passe refusé : 8 caractères au moins, 200 octets au plus.\n");
        exit(1);
    }
    $c = db_one('SELECT id FROM customers WHERE email = ?', [$email]);
    if ($c === null) {
        fwrite(STDERR, "Aucun client avec cet e-mail.\n");
        exit(1);
    }
    $now = now_utc();
    $pdo = db();
    $pdo->beginTransaction();
    db_exec('UPDATE customers SET password_hash = ?, updated_at = ? WHERE id = ?',
        [password_hash($password, PASSWORD_DEFAULT), $now, (int) $c['id']]);
    $n = db_exec("UPDATE sessions SET revoked_at = ? WHERE user_type = 'customer' AND user_id = ? AND revoked_at IS NULL",
        [$now, (int) $c['id']]);
    $pdo->commit();
    echo "Mot de passe du client remplacé. Sessions révoquées : $n.\n";
    exit(0);
} catch (Throwable $e) {
    fwrite(STDERR, 'Échec : ' . get_class($e) . ($e instanceof PDOException ? ' SQLSTATE ' . ($e->errorInfo[0] ?? $e->getCode()) : '') . "\n");
    exit(1);
}
