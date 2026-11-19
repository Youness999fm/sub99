<?php
// POST owner_customers.php {"q": "..."} — fiches clients (500 au plus).
// POST uniquement : la recherche (nom, téléphone, e-mail) ne passe jamais dans l'URL ni les journaux.
declare(strict_types=1);
require __DIR__ . '/lib/bootstrap.php';

allow_methods(['POST']);
$b = read_json_body();
require_owner();
if (isset($b['q']) && !is_string($b['q'])) {
    fail_validation(['q' => 'Recherche invalide.']);
}
$q = clean_spaces($b['q'] ?? '');
if (str_chars($q) > 80) {
    fail_validation(['q' => 'Recherche trop longue (80 caractères au plus).']);
}

$sql = 'SELECT c.*, (SELECT MAX(o.created_at) FROM orders o WHERE o.customer_id = c.id) AS last_order_at FROM customers c';
$params = [];
if ($q !== '') {
    $like = '%' . strtr($q, ['!' => '!!', '%' => '!%', '_' => '!_']) . '%';
    $sql .= " WHERE c.first_name LIKE ? ESCAPE '!' OR c.last_name LIKE ? ESCAPE '!'"
          . " OR c.phone LIKE ? ESCAPE '!' OR c.email LIKE ? ESCAPE '!'";
    $params = [$like, $like, $like, $like];
}
$sql .= ' ORDER BY c.last_name, c.first_name, c.id LIMIT 500';

$list = [];
foreach (db_all($sql, $params) as $r) {
    $list[] = customer_view($r) + [
        'created_at' => (string) $r['created_at'],
        'last_order_at' => $r['last_order_at'] === null ? null : (string) $r['last_order_at'],
    ];
}
ok(['customers' => $list]);
