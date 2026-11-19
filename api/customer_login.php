<?php
// POST customer_login.php — connexion client.
declare(strict_types=1);
require __DIR__ . '/lib/bootstrap.php';

allow_methods(['POST']);
$b = read_json_body();

$email = is_string($b['email'] ?? null) ? strtolower(trim($b['email'])) : '';
$password = is_string($b['password'] ?? null) ? $b['password'] : '';

// Verrou par adresse IP seulement (décision C) : aucun verrou par e-mail, pour qu'un tiers
// ne puisse pas bloquer la connexion d'un client. IPv6 : seau par préfixe /64.
$ipBucket = 'customer_login:ip:' . throttle_ip_key(client_ip());
throttle_guard([$ipBucket]);
// Chaque tentative est comptée avant la vérification du mot de passe (verrou à 5 échecs en 15 min) ;
// une réussite est décomptée ensuite, sans remettre le compteur à zéro.
throttle_hit($ipBucket, 5, 900, 900);

$c = ($email !== '' && strlen($email) <= 190) ? db_one('SELECT * FROM customers WHERE email = ?', [$email]) : null;
$hash = $c !== null ? (string) $c['password_hash'] : dummy_password_hash();
$valid = strlen($password) <= 4096 && password_verify($password, $hash) && $c !== null;

if (!$valid) {
    fail(401, 'invalid_credentials', 'Email ou mot de passe incorrect.');
}

// Pas de remise à zéro : sinon un client connecté à son propre compte effacerait ses échecs
// sur les comptes d'autrui. Les échecs comptés expirent seuls (fenêtre de 15 min).
throttle_refund($ipBucket, 5);
$now = now_utc();
if (password_needs_rehash((string) $c['password_hash'], PASSWORD_DEFAULT)) {
    db_exec('UPDATE customers SET password_hash = ?, updated_at = ? WHERE id = ?',
        [password_hash($password, PASSWORD_DEFAULT), $now, (int) $c['id']]);
}
db_exec('UPDATE customers SET last_login_at = ? WHERE id = ?', [$now, (int) $c['id']]);
// Une seule session client active par navigateur : l'ancienne est révoquée.
$previous = current_session('customer');
if ($previous !== null) {
    revoke_session((int) $previous['id']);
}
create_session('customer', (int) $c['id'], true);

ok(['customer' => customer_view($c)]);
