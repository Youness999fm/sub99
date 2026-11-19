<?php
// POST customer_update_profile.php — {"first_name", "last_name", "phone"} (mêmes règles qu'à l'inscription).
// Ni l'adresse (customer_update_address.php), ni l'e-mail, ni le mot de passe.
declare(strict_types=1);
require __DIR__ . '/lib/bootstrap.php';

allow_methods(['POST']);
$b = read_json_body();
[, $c] = require_customer();

$err = [];
[$first, $last, $phone] = validate_profile($b, $err);
if ($err !== []) {
    fail_validation($err);
}
db_exec('UPDATE customers SET first_name = ?, last_name = ?, phone = ?, updated_at = ? WHERE id = ?',
    [$first, $last, $phone, now_utc(), (int) $c['id']]);
$c = db_one('SELECT * FROM customers WHERE id = ?', [(int) $c['id']]);
ok(['customer' => customer_view($c)]);
