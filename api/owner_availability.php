<?php
// GET/POST owner_availability.php — ruptures enregistrées (pizza, produit, ingrédient).
declare(strict_types=1);
require __DIR__ . '/lib/bootstrap.php';

$method = allow_methods(['GET', 'POST']);
if ($method === 'POST') {
    $b = read_json_body();
}
require_owner();

if ($method === 'POST') {
    $err = [];
    $kind = $b['kind'] ?? null;
    if (!is_string($kind) || !in_array($kind, AVAILABILITY_KINDS, true)) {
        $err['kind'] = 'Type attendu : pizza, product ou ingredient.';
    }
    $status = $b['status'] ?? null;
    if (!in_array($status, ['available', 'out_today', 'out_manual'], true)) {
        $err['status'] = 'Statut attendu : available, out_today ou out_manual.';
    }
    $name = is_string($b['name'] ?? null) ? clean_spaces($b['name']) : '';
    if ($name === '' || str_chars($name) > 120) {
        $err['name'] = 'Nom attendu (1 à 120 caractères).';
    }
    if ($err !== []) {
        fail_validation($err);
    }

    $now = now_utc();
    if ($status === 'available') {
        db_exec('DELETE FROM availability WHERE kind = ? AND name = ?', [$kind, $name]);
        // Supprime aussi les entrées du même type dont le nom correspond après normalisation
        // (« Calzone » rend disponible « Calzone (soufflée) », et inversement).
        foreach (db_all('SELECT id, name FROM availability WHERE kind = ?', [$kind]) as $row) {
            if (name_keys_intersect((string) $row['name'], $name)) {
                db_exec('DELETE FROM availability WHERE id = ?', [(int) $row['id']]);
            }
        }
    } else {
        $day = $status === 'out_today' ? service_day() : null;
        $params = [$status, $day, $now, $kind, $name];
        $sqlUpdate = 'UPDATE availability SET status = ?, service_day = ?, updated_at = ? WHERE kind = ? AND name = ?';
        if (db_exec($sqlUpdate, $params) === 0) {
            try {
                db_exec('INSERT INTO availability (kind, name, status, service_day, updated_at) VALUES (?, ?, ?, ?, ?)',
                    [$kind, $name, $status, $day, $now]);
            } catch (PDOException $e) {
                if (!db_is_unique_violation($e)) {
                    throw $e;
                }
                db_exec($sqlUpdate, $params);
            }
        }
    }
}

ok(['out' => availability_effective()]);
