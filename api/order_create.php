<?php
// POST order_create.php — création d'une commande (calcul serveur, idempotence).
declare(strict_types=1);
require __DIR__ . '/lib/bootstrap.php';

allow_methods(['POST']);
$b = read_json_body();

// 1. Session
[, $customer] = require_customer();
$customerId = (int) $customer['id'];

// 2. Forme du corps
$o = validate_order_body($b);
$payloadHash = order_payload_hash($o);

/** Rejeu ou conflit pour une clé déjà enregistrée. */
$replayOrConflict = function (array $existing) use ($payloadHash): void {
    if (!hash_equals((string) $existing['payload_hash'], $payloadHash)) {
        fail(409, 'idempotency_conflict', 'Cette commande a déjà été envoyée avec un contenu différent.');
    }
    ok(['replayed' => true, 'order' => order_views([$existing], false)[0]], 200);
};

// 3. Clé d'idempotence déjà connue
$existing = db_one('SELECT * FROM orders WHERE customer_id = ? AND idempotency_key = ?', [$customerId, $o['idempotency_key']]);
if ($existing !== null) {
    $replayOrConflict($existing);
}

// Limitation de débit après le contrôle de la clé : un rejeu répond 200 même après 20 envois.
$bucket = 'order_create:customer:' . $customerId;
throttle_guard([$bucket]);
throttle_hit($bucket, 20, 600);

// 4. Catalogue (article connu, prix unitaire au centime près) puis disponibilités.
//    Les prix envoyés par le navigateur ne sont acceptés que s'ils sont ceux de la carte.
//    Les lignes enregistrées portent ensuite le nom du catalogue, pas le texte envoyé
//    (l'empreinte d'idempotence, elle, reste calculée sur le corps reçu).
$o['items'] = order_enforce_catalogue($o);

// 5. Profil
if (trim((string) $customer['phone']) === '') {
    fail(422, 'profile_incomplete', 'Ajoutez un numéro de téléphone à votre compte avant de commander.');
}

// 6. Adresse et zone
$zone = null;
$street = null;
$city = null;
if ($o['mode'] === 'delivery') {
    $city = $customer['city'] === null ? '' : (string) $customer['city'];
    $street = $customer['street'] === null ? '' : trim((string) $customer['street']);
    if ($street === '' || !array_key_exists($city, DELIVERY_ZONES)) {
        fail(422, 'address_required', 'Ajoutez une adresse de livraison dans notre zone.');
    }
    $zone = DELIVERY_ZONES[$city];
}

// 7. Calcul serveur (prix unitaires vérifiés à l'étape 4)
$t = compute_order_totals($o['items'], $o['mode'], $zone);
if ($o['mode'] === 'delivery' && $t['products_after_promo_cents'] < $zone['minimum_cents']) {
    fail(422, 'minimum_not_reached', 'Le minimum de commande pour votre ville n\'est pas atteint.', [
        'minimum_cents' => $zone['minimum_cents'],
        'products_after_promo_cents' => $t['products_after_promo_cents'],
    ]);
}

// 8. Comparaison des totaux
if ($o['total_cents'] !== $t['total_cents'] || $o['delivery_fee_cents'] !== $t['delivery_fee_cents']) {
    fail(409, 'price_mismatch', 'Le total a changé. Vérifiez votre panier.', [
        'server_products_cents' => $t['products_cents'],
        'server_promo_cents' => $t['promo_cents'],
        'server_delivery_fee_cents' => $t['delivery_fee_cents'],
        'server_total_cents' => $t['total_cents'],
    ]);
}

// 9. Insertion dans une transaction
$pdo = db();
$now = now_utc();
try {
    $pdo->beginTransaction();
    $orderId = db_insert(
        'INSERT INTO orders (customer_id, idempotency_key, payload_hash, status, mode,
            customer_first_name, customer_last_name, customer_phone, customer_email,
            delivery_street, delivery_city, payment_methods, cash_change_for,
            products_cents, promo_cents, delivery_fee_cents, total_cents, delay_minutes,
            created_at, accepted_at, refused_at, service_day)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL, NULL, ?)',
        [
            $customerId, $o['idempotency_key'], $payloadHash, 'new', $o['mode'],
            (string) $customer['first_name'], (string) $customer['last_name'],
            (string) $customer['phone'], (string) $customer['email'],
            $street, $city, json_encode($o['payment_methods']), $o['cash_change_for'],
            $t['products_cents'], $t['promo_cents'], $t['delivery_fee_cents'], $t['total_cents'],
            $now, service_day(),
        ]
    );
    $stItem = $pdo->prepare(
        'INSERT INTO order_items (order_id, position, name, variant, qty, unit_price_cents, line_total_cents,
            removed_json, extras_json, half_json, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    foreach ($o['items'] as $pos => $it) {
        $stItem->execute([
            $orderId, $pos, $it['name'], $it['variant'], $it['qty'], $it['unit_price_cents'],
            $it['unit_price_cents'] * $it['qty'],
            json_encode($it['removed'], JSON_UNESCAPED_UNICODE),
            json_encode($it['extras'], JSON_UNESCAPED_UNICODE),
            $it['half'] === null ? null : json_encode($it['half'], JSON_UNESCAPED_UNICODE),
            $it['note'],
        ]);
    }
    $pdo->commit();
} catch (PDOException $e) {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
    if (!db_is_unique_violation($e)) {
        throw $e;
    }
    // Envoi concurrent avec la même clé : relire la ligne existante.
    $existing = db_one('SELECT * FROM orders WHERE customer_id = ? AND idempotency_key = ?', [$customerId, $o['idempotency_key']]);
    if ($existing === null) {
        throw $e;
    }
    $replayOrConflict($existing);
}

$order = order_load($orderId);
ok(['replayed' => false, 'order' => order_views([$order], false)[0]], 201);
