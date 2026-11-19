<?php
// GET owner_me.php — propriétaire connecté.
declare(strict_types=1);
require __DIR__ . '/lib/bootstrap.php';

allow_methods(['GET']);
[$session, $owner] = require_owner();

ok(['owner' => [
    'email' => (string) $owner['email'],
    'remember' => (int) $session['remember'] === 1,
    'session_id' => (int) $session['id'],
]]);
