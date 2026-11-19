<?php
// GET order_status.php?id=42 — une commande du client connecté.
declare(strict_types=1);
require __DIR__ . '/lib/bootstrap.php';

allow_methods(['GET']);
[, $c] = require_customer();

$raw = isset($_GET['id']) && is_string($_GET['id']) ? $_GET['id'] : '';
$id = preg_match('/^[1-9][0-9]{0,9}$/', $raw) ? (int) $raw : 0;
$order = $id > 0 ? db_one('SELECT * FROM orders WHERE id = ? AND customer_id = ?', [$id, (int) $c['id']]) : null;
if ($order === null) {
    fail(404, 'not_found', 'Commande introuvable.');
}
ok(['server_now' => now_utc(), 'order' => order_views([$order], false)[0]]);
