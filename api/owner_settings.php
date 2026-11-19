<?php
// GET/POST owner_settings.php — délai par défaut.
declare(strict_types=1);
require __DIR__ . '/lib/bootstrap.php';

$method = allow_methods(['GET', 'POST']);
if ($method === 'POST') {
    $b = read_json_body();
}
require_owner();

if ($method === 'POST') {
    $d = $b['default_delay_minutes'] ?? null;
    if (!is_int($d) || !in_array($d, DELAY_CHOICES, true)) {
        fail_validation(['default_delay_minutes' => 'Délai attendu : 20, 30, 40, 50 ou 60 minutes.']);
    }
    if (db_exec('UPDATE settings SET svalue = ? WHERE skey = ?', [(string) $d, 'default_delay_minutes']) === 0) {
        try {
            db_exec('INSERT INTO settings (skey, svalue) VALUES (?, ?)', ['default_delay_minutes', (string) $d]);
        } catch (PDOException $e) {
            if (!db_is_unique_violation($e)) {
                throw $e;
            }
            db_exec('UPDATE settings SET svalue = ? WHERE skey = ?', [(string) $d, 'default_delay_minutes']);
        }
    }
}

$row = db_one('SELECT svalue FROM settings WHERE skey = ?', ['default_delay_minutes']);
$value = $row !== null && ctype_digit((string) $row['svalue']) ? (int) $row['svalue'] : 30;
ok(['default_delay_minutes' => $value]);
