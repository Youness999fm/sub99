<?php
// POST owner_logout.php — révoque la session propriétaire courante.
declare(strict_types=1);
require __DIR__ . '/lib/bootstrap.php';

allow_methods(['POST']);
read_json_body();
[$session] = require_owner();

revoke_session((int) $session['id']);
clear_auth_cookie('owner');
ok();
