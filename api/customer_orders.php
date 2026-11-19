<?php
// GET customer_orders.php — commandes du client connecté (50 plus récentes).
declare(strict_types=1);
require __DIR__ . '/lib/bootstrap.php';

allow_methods(['GET']);
[, $c] = require_customer();

$rows = db_all('SELECT * FROM orders WHERE customer_id = ? ORDER BY created_at DESC, id DESC LIMIT 50', [(int) $c['id']]);
ok(['orders' => order_views($rows, false)]);
