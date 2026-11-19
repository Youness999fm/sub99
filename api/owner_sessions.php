<?php
// GET owner_sessions.php — sessions propriétaire actives.
declare(strict_types=1);
require __DIR__ . '/lib/bootstrap.php';

allow_methods(['GET']);
[$session, $owner] = require_owner();

$rows = db_all(
    "SELECT id, device, created_at, last_seen_at, expires_at, remember FROM sessions
     WHERE user_type = 'owner' AND user_id = ? AND revoked_at IS NULL AND expires_at > ?
     ORDER BY last_seen_at DESC, id DESC",
    [(int) $owner['id'], now_utc()]
);
$list = [];
foreach ($rows as $r) {
    $list[] = [
        'id' => (int) $r['id'],
        'device' => (string) $r['device'],
        'created_at' => (string) $r['created_at'],
        'last_seen_at' => (string) $r['last_seen_at'],
        'expires_at' => (string) $r['expires_at'],
        'remember' => (int) $r['remember'] === 1,
        'current' => (int) $r['id'] === (int) $session['id'],
    ];
}
ok(['sessions' => $list]);
