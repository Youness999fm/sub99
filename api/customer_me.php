<?php
// GET customer_me.php — client connecté, ou null pour un invité (jamais 401).
declare(strict_types=1);
require __DIR__ . '/lib/bootstrap.php';

allow_methods(['GET']);
$c = optional_customer();
ok(['customer' => $c === null ? null : customer_view($c[1])]);
