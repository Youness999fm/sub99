<?php
// POST owner_login.php — connexion du propriétaire.
declare(strict_types=1);
require __DIR__ . '/lib/bootstrap.php';

allow_methods(['POST']);
$b = read_json_body();

$email = is_string($b['email'] ?? null) ? strtolower(trim($b['email'])) : '';
$password = is_string($b['password'] ?? null) ? $b['password'] : '';
$remember = body_bool($b, 'remember');

// Verrou par adresse IP seulement (décision C) : aucun verrou par e-mail, pour qu'un tiers
// ne puisse pas bloquer la connexion du propriétaire. Le reste de la protection repose sur
// la longueur du mot de passe (12 caractères au moins). IPv6 : seau par préfixe /64.
$ipBucket = 'owner_login:ip:' . throttle_ip_key(client_ip());
throttle_guard([$ipBucket]);
// Chaque tentative est comptée avant la vérification du mot de passe (verrou à 5 échecs en 15 min) ;
// une réussite est décomptée ensuite, sans remettre le compteur à zéro.
throttle_hit($ipBucket, 5, 900, 900);

$owner = ($email !== '' && strlen($email) <= 190)
    ? db_one('SELECT id, email, password_hash FROM owners WHERE email = ?', [$email])
    : null;
// Vérification même sans compte, pour un temps de réponse comparable.
$hash = $owner !== null ? (string) $owner['password_hash'] : dummy_password_hash();
$valid = strlen($password) <= 4096 && password_verify($password, $hash) && $owner !== null;

if (!$valid) {
    fail(401, 'invalid_credentials', 'Email ou mot de passe incorrect.');
}

// Pas de remise à zéro : les échecs déjà comptés pour cette IP expirent seuls (fenêtre de 15 min).
throttle_refund($ipBucket, 5);
if (password_needs_rehash((string) $owner['password_hash'], PASSWORD_DEFAULT)) {
    db_exec('UPDATE owners SET password_hash = ?, updated_at = ? WHERE id = ?',
        [password_hash($password, PASSWORD_DEFAULT), now_utc(), (int) $owner['id']]);
}
create_session('owner', (int) $owner['id'], $remember);

ok(['owner' => ['email' => (string) $owner['email'], 'remember' => $remember]]);
