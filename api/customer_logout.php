<?php
// POST customer_logout.php — révoque la session client courante. Toujours 200.
declare(strict_types=1);
require __DIR__ . '/lib/bootstrap.php';

allow_methods(['POST']);
read_json_body();

$s = current_session('customer');
if ($s !== null) {
    revoke_session((int) $s['id']);
}
clear_auth_cookie('customer');
ok();
