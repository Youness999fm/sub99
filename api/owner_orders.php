<?php
// GET owner_orders.php — commandes nouvelles (tous jours) + commandes du jour de service.
declare(strict_types=1);
require __DIR__ . '/lib/bootstrap.php';

allow_methods(['GET']);
require_owner();

$rows = db_all(
    "SELECT * FROM orders WHERE status = 'new' OR service_day = ? ORDER BY created_at ASC, id ASC",
    [service_day()]
);
ok(['server_now' => now_utc(), 'orders' => order_views($rows, true)]);
