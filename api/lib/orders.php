<?php
// Commandes : validation du corps, calcul serveur, vues client et propriétaire.
declare(strict_types=1);

require_once __DIR__ . '/catalogue.php';

const PAYMENT_METHODS = ['card', 'cash', 'ticket', 'ticket_card'];
const CASH_CHANGE_CHOICES = [0, 10, 20, 50, 100];
const VARIANTS = ['', 'Solo', 'Duo', 'Quatro', 'XXL'];
const PIZZA_SIZES = ['Solo', 'Duo', 'Quatro', 'XXL'];

/**
 * Valide le corps de order_create. Répond 422 (validation / empty_cart) en cas d'erreur.
 * @return array corps normalisé
 */
function validate_order_body(array $b): array
{
    $err = [];

    $key = $b['idempotency_key'] ?? null;
    if (!is_string($key) || !preg_match('/^[A-Za-z0-9-]{8,64}$/', $key)) {
        $err['idempotency_key'] = 'Clé d\'envoi invalide.';
        $key = '';
    }

    $mode = $b['mode'] ?? null;
    if ($mode !== 'pickup' && $mode !== 'delivery') {
        $err['mode'] = 'Mode invalide (à emporter ou livraison).';
        $mode = 'pickup';
    }

    $pm = $b['payment_methods'] ?? null;
    $methods = [];
    $cash = null;
    if (!is_list_array($pm)) {
        $err['payment_methods'] = 'Moyens de paiement invalides.';
    } elseif ($mode === 'delivery') {
        foreach ($pm as $m) {
            if (!is_string($m) || !in_array($m, PAYMENT_METHODS, true)) {
                $err['payment_methods'] = 'Moyen de paiement inconnu.';
                break;
            }
            if (!in_array($m, $methods, true)) {
                $methods[] = $m;
            }
        }
        if (!isset($err['payment_methods']) && $methods === []) {
            $err['payment_methods'] = 'Choisissez au moins un moyen de paiement.';
        }
        if (in_array('cash', $methods, true)) {
            $c = $b['cash_change_for'] ?? null;
            if (!is_int($c) || !in_array($c, CASH_CHANGE_CHOICES, true)) {
                $err['cash_change_for'] = 'Indiquez le billet utilisé (ou l\'appoint).';
            } else {
                $cash = $c;
            }
        }
    }

    $itemsIn = $b['items'] ?? null;
    $items = [];
    if (!is_list_array($itemsIn)) {
        $err['items'] = 'Panier invalide.';
    } elseif (count($itemsIn) === 0) {
        if ($err === []) {
            fail(422, 'empty_cart', 'Votre panier est vide.');
        }
    } elseif (count($itemsIn) > 40) {
        $err['items'] = 'Trop de lignes (40 au plus).';
    } else {
        $qtySum = 0;
        foreach ($itemsIn as $i => $it) {
            $p = "items[$i]";
            if (!is_array($it) || is_list_array($it) && $it !== []) {
                $err[$p] = 'Ligne invalide.';
                continue;
            }
            $name = isset($it['name']) && is_string($it['name']) ? trim($it['name']) : '';
            if ($name === '' || str_chars($name) > 120) {
                $err["$p.name"] = 'Nom invalide.';
            }
            $variant = $it['variant'] ?? '';
            if ($variant === null) {
                $variant = '';
            }
            if (!is_string($variant) || !in_array($variant, VARIANTS, true)) {
                $err["$p.variant"] = 'Taille invalide.';
                $variant = '';
            }
            $qty = $it['qty'] ?? null;
            if (!is_int_between($qty, 1, 20)) {
                $err["$p.qty"] = 'Quantité invalide (1 à 20).';
                $qty = 1;
            }
            $qtySum += $qty;
            $unit = $it['unit_price_cents'] ?? null;
            if (!is_int_between($unit, 1, 50000)) {
                $err["$p.unit_price_cents"] = 'Prix invalide.';
                $unit = 0;
            }
            $removed = [];
            $rIn = $it['removed'] ?? [];
            if (!is_list_array($rIn) || count($rIn) > 20) {
                $err["$p.removed"] = 'Liste d\'ingrédients retirés invalide.';
            } else {
                foreach ($rIn as $r) {
                    if (!is_string($r) || str_chars(trim($r)) > 60) {
                        $err["$p.removed"] = 'Ingrédient retiré invalide.';
                        break;
                    }
                    $removed[] = trim($r);
                }
            }
            $extras = [];
            $eIn = $it['extras'] ?? [];
            if (!is_list_array($eIn) || count($eIn) > 20) {
                $err["$p.extras"] = 'Suppléments invalides.';
            } else {
                $seenExtras = [];
                foreach ($eIn as $j => $e) {
                    $en = is_array($e) && isset($e['name']) && is_string($e['name']) ? trim($e['name']) : null;
                    $ep = is_array($e) ? ($e['price_cents'] ?? null) : null;
                    $eq = is_array($e) ? ($e['qty'] ?? 1) : null;
                    if ($en === null || str_chars($en) > 60 || !is_int_between($ep, 0, 10000)) {
                        $err["$p.extras"] = 'Supplément invalide.';
                        break;
                    }
                    // Un supplément = une portion : l'interface n'envoie jamais d'autre quantité.
                    if ($eq !== 1) {
                        $err["$p.extras[$j].qty"] = 'Quantité de supplément invalide (1 uniquement).';
                        break;
                    }
                    $ek = catalogue_swap_key($en);
                    if (isset($seenExtras[$ek])) {
                        $err["$p.extras[$j].name"] = 'Supplément en double.';
                        break;
                    }
                    $seenExtras[$ek] = true;
                    $extras[] = ['name' => $en, 'price_cents' => $ep, 'qty' => $eq];
                }
            }
            $half = null;
            $hIn = $it['half'] ?? null;
            if ($hIn !== null) {
                $f1 = is_array($hIn) && isset($hIn['flavor1']) && is_string($hIn['flavor1']) ? trim($hIn['flavor1']) : null;
                $f2 = is_array($hIn) && isset($hIn['flavor2']) && is_string($hIn['flavor2']) ? trim($hIn['flavor2']) : null;
                if ($f1 === null || $f2 === null || str_chars($f1) > 120 || str_chars($f2) > 120) {
                    $err["$p.half"] = 'Moitié-moitié invalide.';
                } else {
                    $half = ['flavor1' => $f1, 'flavor2' => $f2];
                }
            }
            $note = $it['note'] ?? '';
            if ($note === null) {
                $note = '';
            }
            if (!is_string($note) || str_chars(trim($note)) > 300) {
                $err["$p.note"] = 'Remarque trop longue (300 caractères au plus).';
                $note = '';
            }
            $items[] = [
                'name' => $name, 'variant' => $variant, 'qty' => $qty, 'unit_price_cents' => $unit,
                'removed' => $removed, 'extras' => $extras, 'half' => $half, 'note' => trim($note),
            ];
        }
        if ($qtySum > 60) {
            $err['items'] = 'Trop d\'articles (60 au plus).';
        }
    }

    foreach (['delivery_fee_cents', 'total_cents'] as $k) {
        if (!is_int_between($b[$k] ?? null, 0, 10000000)) {
            $err[$k] = 'Montant invalide.';
        }
    }

    if ($err !== []) {
        fail_validation($err);
    }

    return [
        'idempotency_key' => $key,
        'mode' => $mode,
        'payment_methods' => $mode === 'delivery' ? $methods : [],
        'cash_change_for' => $mode === 'delivery' ? $cash : null,
        'items' => $items,
        'delivery_fee_cents' => $b['delivery_fee_cents'],
        'total_cents' => $b['total_cents'],
    ];
}

function order_payload_hash(array $o): string
{
    $canon = [
        $o['mode'], $o['payment_methods'], $o['cash_change_for'], $o['items'],
        $o['delivery_fee_cents'], $o['total_cents'],
    ];
    return hash('sha256', (string) json_encode($canon, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
}

/**
 * Catalogue puis disponibilités (après la validation et la clé d'idempotence, avant les totaux).
 * Répond 422 validation / unknown_item / unpriced_item / price_mismatch_line / unavailable_items ;
 * rien n'est enregistré. Renvoie les lignes avec les noms du catalogue (à enregistrer).
 */
function order_enforce_catalogue(array $o): array
{
    $err = verify_line_prices($o['items'], $o['mode']);
    if ($err !== null) {
        $code = (string) $err['error'];
        unset($err['error']);
        if ($code === 'validation') {
            fail_validation($err['fields']);
        }
        $messages = [
            'unknown_item' => 'Un article de votre panier n\'est pas à la carte.',
            'unpriced_item' => 'Un article de votre panier n\'a pas de prix en ligne.',
            'price_mismatch_line' => 'Le prix d\'un article a changé. Rechargez la page avant de commander.',
        ];
        fail(422, $code, $messages[$code] ?? 'Panier invalide.', $err);
    }
    $ingredients = [];
    $unavailable = check_availability_lines($o['items'], $ingredients);
    if ($unavailable !== []) {
        fail(422, 'unavailable_items', 'Certains articles ne sont plus disponibles.', [
            'unavailable' => $unavailable,
            'unavailable_ingredients' => $ingredients,
        ]);
    }
    return catalogue_canonical_items($o['items']);
}

/**
 * Calcul serveur (porté de cart.js). $zone : ['minimum_cents','fee_cents'] ou null (à emporter).
 * Entiers uniquement.
 */
function compute_order_totals(array $items, string $mode, ?array $zone): array
{
    $gross = 0;
    $pizzaPrices = [];
    $hasPizza = false;
    foreach ($items as $it) {
        $gross += $it['unit_price_cents'] * $it['qty'];
        if ($it['variant'] !== '') {
            for ($i = 0; $i < $it['qty']; $i++) {
                $pizzaPrices[] = $it['unit_price_cents'];
            }
        }
        if (in_array($it['variant'], PIZZA_SIZES, true)) {
            $hasPizza = true;
        }
    }
    rsort($pizzaPrices, SORT_NUMERIC);
    $promo = 0;
    for ($i = 0; $i + 1 < count($pizzaPrices); $i += 2) {
        $cheaper = $pizzaPrices[$i + 1];
        // À emporter : la moins chère offerte. Livraison : la moins chère à moitié prix, arrondi par paire.
        $promo += $mode === 'pickup' ? $cheaper : intdiv($cheaper + 1, 2);
    }
    $after = $gross - $promo;
    $fee = ($mode === 'delivery' && !$hasPizza && $zone !== null) ? (int) $zone['fee_cents'] : 0;
    return [
        'products_cents' => $gross,
        'promo_cents' => $promo,
        'products_after_promo_cents' => $after,
        'delivery_fee_cents' => $fee,
        'total_cents' => $after + $fee,
    ];
}

function order_items_by_order(array $orderIds): array
{
    $map = [];
    if ($orderIds === []) {
        return $map;
    }
    $ph = implode(',', array_fill(0, count($orderIds), '?'));
    $rows = db_all("SELECT * FROM order_items WHERE order_id IN ($ph) ORDER BY order_id, position", array_values($orderIds));
    foreach ($rows as $r) {
        $map[(int) $r['order_id']][] = [
            'name' => (string) $r['name'],
            'variant' => (string) $r['variant'],
            'qty' => (int) $r['qty'],
            'unit_price_cents' => (int) $r['unit_price_cents'],
            'line_total_cents' => (int) $r['line_total_cents'],
            'removed' => json_decode((string) $r['removed_json'], true) ?: [],
            'extras' => json_decode((string) $r['extras_json'], true) ?: [],
            'half' => $r['half_json'] === null ? null : json_decode((string) $r['half_json'], true),
            'note' => (string) $r['note'],
        ];
    }
    return $map;
}

function order_view(array $o, array $items, bool $owner): array
{
    $delay = $o['delay_minutes'] === null ? null : (int) $o['delay_minutes'];
    $readyAt = null;
    if ($o['accepted_at'] !== null && $delay !== null) {
        $readyAt = utc_at(utc_to_epoch((string) $o['accepted_at']) + $delay * 60);
    }
    $methods = json_decode((string) $o['payment_methods'], true);
    $v = [
        'id' => (int) $o['id'],
        'status' => (string) $o['status'],
        'mode' => (string) $o['mode'],
        'customer_name' => trim($o['customer_first_name'] . ' ' . $o['customer_last_name']),
        'delivery_address' => $o['mode'] === 'delivery'
            ? ['street' => $o['delivery_street'], 'city' => $o['delivery_city']]
            : null,
        'payment_methods' => is_array($methods) ? $methods : [],
        'cash_change_for' => $o['cash_change_for'] === null ? null : (int) $o['cash_change_for'],
        'items' => $items,
        'products_cents' => (int) $o['products_cents'],
        'promo_cents' => (int) $o['promo_cents'],
        'delivery_fee_cents' => (int) $o['delivery_fee_cents'],
        'total_cents' => (int) $o['total_cents'],
        'created_at' => (string) $o['created_at'],
        'accepted_at' => $o['accepted_at'],
        'refused_at' => $o['refused_at'],
        'delay_minutes' => $delay,
        'ready_at' => $readyAt,
        'service_day' => (string) $o['service_day'],
    ];
    if ($owner) {
        $v['customer_id'] = (int) $o['customer_id'];
        $v['customer_phone'] = (string) $o['customer_phone'];
        $v['customer_email'] = (string) $o['customer_email'];
    }
    return $v;
}

/** Vues pour une liste de lignes `orders`. */
function order_views(array $rows, bool $owner): array
{
    $items = order_items_by_order(array_map(function ($r) { return (int) $r['id']; }, $rows));
    $out = [];
    foreach ($rows as $r) {
        $out[] = order_view($r, $items[(int) $r['id']] ?? [], $owner);
    }
    return $out;
}

function order_load(int $id): ?array
{
    return db_one('SELECT * FROM orders WHERE id = ?', [$id]);
}
