<?php
// POST customer_update_address.php — {"street", "city"} ; ville vide = adresse effacée.
declare(strict_types=1);
require __DIR__ . '/lib/bootstrap.php';

allow_methods(['POST']);
$b = read_json_body();
[, $c] = require_customer();

$err = [];
[$street, $city] = validate_address($b, $err);
if ($err !== []) {
    fail_validation($err);
}
db_exec('UPDATE customers SET street = ?, city = ?, updated_at = ? WHERE id = ?', [$street, $city, now_utc(), (int) $c['id']]);
$c = db_one('SELECT * FROM customers WHERE id = ?', [(int) $c['id']]);
ok(['customer' => customer_view($c)]);
