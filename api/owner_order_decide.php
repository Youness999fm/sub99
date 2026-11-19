<?php
// POST owner_order_decide.php — accepter (avec délai) ou refuser une commande.
declare(strict_types=1);
require __DIR__ . '/lib/bootstrap.php';

allow_methods(['POST']);
$b = read_json_body();
require_owner();

$err = [];
$id = $b['id'] ?? null;
if (!is_int($id) || $id < 1) {
    $err['id'] = 'Identifiant invalide.';
}
$action = $b['action'] ?? null;
if ($action !== 'accept' && $action !== 'refuse') {
    $err['action'] = 'Action attendue : accept ou refuse.';
}
$delay = null;
if ($action === 'accept') {
    $delay = $b['delay_minutes'] ?? null;
    if (!is_int($delay) || !in_array($delay, DELAY_CHOICES, true)) {
        $err['delay_minutes'] = 'Délai attendu : 20, 30, 40, 50 ou 60 minutes.';
    }
}
if ($err !== []) {
    fail_validation($err);
}

$order = order_load($id);
if ($order === null) {
    fail(404, 'not_found', 'Commande introuvable.');
}

$now = now_utc();
if ($action === 'accept') {
    $n = db_exec("UPDATE orders SET status = 'accepted', delay_minutes = ?, accepted_at = ? WHERE id = ? AND status = 'new'",
        [$delay, $now, $id]);
} else {
    $n = db_exec("UPDATE orders SET status = 'refused', refused_at = ? WHERE id = ? AND status = 'new'", [$now, $id]);
}

$order = order_load($id);
$replayed = false;
if ($n !== 1) {
    $current = (string) $order['status'];
    $currentDelay = $order['delay_minutes'] === null ? null : (int) $order['delay_minutes'];
    $same = ($action === 'accept' && $current === 'accepted' && $currentDelay === $delay)
        || ($action === 'refuse' && $current === 'refused');
    if (!$same) {
        fail(409, 'already_decided', 'Cette commande a déjà été traitée.',
            ['status' => $current, 'delay_minutes' => $currentDelay]);
    }
    $replayed = true;
}

ok(['order' => order_views([$order], true)[0], 'replayed' => $replayed]);
