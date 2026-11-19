<?php
// POST customer_signup.php — création d'un compte client.
declare(strict_types=1);
require __DIR__ . '/lib/bootstrap.php';

allow_methods(['POST']);
$b = read_json_body();

$ipBucket = 'customer_signup:ip:' . throttle_ip_key(client_ip());
throttle_guard([$ipBucket]);

$err = [];
[$first, $last, $phone] = validate_profile($b, $err);
$email = normalize_email($b['email'] ?? null);
if ($email === null) {
    $err['email'] = 'Adresse e-mail invalide.';
}
$password = $b['password'] ?? null;
if (!is_string($password) || strlen($password) < 8 || strlen($password) > 200) {
    $err['password'] = 'Mot de passe de 8 caractères au moins.';
}
[$street, $city] = validate_address($b, $err);
if ($err !== []) {
    fail_validation($err);
}

throttle_hit($ipBucket, 10, 3600);

if (db_one('SELECT id FROM customers WHERE email = ?', [$email]) !== null) {
    fail(409, 'email_taken', 'Un compte existe déjà avec cette adresse e-mail.');
}
$now = now_utc();
try {
    $id = db_insert(
        'INSERT INTO customers (email, password_hash, first_name, last_name, phone, street, city, created_at, updated_at, last_login_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [$email, password_hash($password, PASSWORD_DEFAULT), $first, $last, $phone, $street, $city, $now, $now, $now]
    );
} catch (PDOException $e) {
    if (db_is_unique_violation($e)) {
        fail(409, 'email_taken', 'Un compte existe déjà avec cette adresse e-mail.');
    }
    throw $e;
}

create_session('customer', $id, true);
$customer = db_one('SELECT * FROM customers WHERE id = ?', [$id]);
ok(['customer' => customer_view($customer)], 201);
