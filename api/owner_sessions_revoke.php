<?php
// POST owner_sessions_revoke.php — {"scope": "others"} ou {"scope": "all"}.
declare(strict_types=1);
require __DIR__ . '/lib/bootstrap.php';

allow_methods(['POST']);
$b = read_json_body();
[$session, $owner] = require_owner();

$scope = $b['scope'] ?? null;
if ($scope !== 'others' && $scope !== 'all') {
    fail_validation(['scope' => 'Valeur attendue : others ou all.']);
}

$now = now_utc();
$sql = "UPDATE sessions SET revoked_at = ?
        WHERE user_type = 'owner' AND user_id = ? AND revoked_at IS NULL AND expires_at > ?";
$params = [$now, (int) $owner['id'], $now];
if ($scope === 'others') {
    $sql .= ' AND id <> ?';
    $params[] = (int) $session['id'];
}
$revoked = db_exec($sql, $params);

if ($scope === 'all') {
    clear_auth_cookie('owner');
    ok(['revoked' => $revoked, 'logged_out' => true]);
}
ok(['revoked' => $revoked]);
