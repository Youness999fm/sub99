<?php
// Connexion PDO et petites aides SQL (requêtes préparées uniquement).
declare(strict_types=1);

function db(): PDO
{
    static $pdo = null;
    if ($pdo !== null) {
        return $pdo;
    }
    $c = subito_config()['db'];
    $pdo = new PDO($c['dsn'], $c['user'] ?? null, $c['password'] ?? null, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);
    $driver = $pdo->getAttribute(PDO::ATTR_DRIVER_NAME);
    if ($driver === 'sqlite') {
        $pdo->exec('PRAGMA foreign_keys = ON');
        $pdo->exec('PRAGMA busy_timeout = 5000');
    } elseif ($driver === 'mysql') {
        $pdo->setAttribute(PDO::ATTR_EMULATE_PREPARES, false);
        $pdo->exec("SET NAMES utf8mb4");
    }
    return $pdo;
}

function db_driver(): string
{
    return (string) db()->getAttribute(PDO::ATTR_DRIVER_NAME);
}

function db_one(string $sql, array $params = []): ?array
{
    $st = db()->prepare($sql);
    $st->execute($params);
    $row = $st->fetch();
    $st->closeCursor();
    return $row === false ? null : $row;
}

function db_all(string $sql, array $params = []): array
{
    $st = db()->prepare($sql);
    $st->execute($params);
    return $st->fetchAll();
}

/** Exécute une écriture et renvoie le nombre de lignes modifiées. */
function db_exec(string $sql, array $params = []): int
{
    $st = db()->prepare($sql);
    $st->execute($params);
    return $st->rowCount();
}

function db_insert(string $sql, array $params = []): int
{
    $st = db()->prepare($sql);
    $st->execute($params);
    return (int) db()->lastInsertId();
}

function db_is_unique_violation(Throwable $e): bool
{
    if (!$e instanceof PDOException) {
        return false;
    }
    $state = is_array($e->errorInfo ?? null) ? ($e->errorInfo[0] ?? '') : '';
    return $state === '23000' || (string) $e->getCode() === '23000';
}
