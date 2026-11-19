<?php
// Disponibilités : entrées effectives aujourd'hui, correspondance tolérante des noms.
declare(strict_types=1);

const AVAILABILITY_KINDS = ['pizza', 'product', 'ingredient'];

/** Entrées indisponibles effectives : out_manual, et out_today du jour de service courant. */
function availability_effective(): array
{
    $rows = db_all(
        "SELECT kind, name, status, service_day FROM availability
         WHERE status = 'out_manual' OR (status = 'out_today' AND service_day = ?)
         ORDER BY kind, name",
        [service_day()]
    );
    return array_map(function (array $r): array {
        return [
            'kind' => (string) $r['kind'],
            'name' => (string) $r['name'],
            'status' => (string) $r['status'],
            'service_day' => $r['status'] === 'out_today' ? (string) $r['service_day'] : null,
        ];
    }, $rows);
}

/**
 * Nom de base d'une ligne : avant le premier séparateur de garniture.
 * « — » et « – » avec ou sans espaces ; « - » seulement entouré d'espaces
 * (un trait d'union dans un nom, « Chèvre-miel », n'est pas un séparateur).
 */
function item_base_name(string $name): string
{
    $name = preg_replace('/\p{Cf}+/u', '', $name) ?? $name;
    $parts = preg_split('/\s*[—–]\s*|\s+-\s+/u', $name, 2);
    return preclean_name($parts === false ? $name : $parts[0]);
}

/**
 * Noms des pizzas indisponibles présentes dans les lignes (ligne, et moitiés éventuelles).
 * @param array $items lignes validées
 */
function unavailable_pizzas(array $items): array
{
    $keys = [];
    foreach (availability_effective() as $e) {
        if ($e['kind'] === 'pizza') {
            foreach (name_keys($e['name']) as $k) {
                $keys[$k] = true;
            }
        }
    }
    if ($keys === []) {
        return [];
    }
    $out = [];
    foreach ($items as $it) {
        $candidates = [item_base_name($it['name'])];
        if (is_array($it['half'])) {
            $candidates[] = item_base_name($it['half']['flavor1']);
            $candidates[] = item_base_name($it['half']['flavor2']);
        }
        foreach ($candidates as $cand) {
            if ($cand === '') {
                continue;
            }
            foreach (name_keys($cand) as $k) {
                if (isset($keys[$k])) {
                    $out[$cand] = true;
                    break;
                }
            }
        }
    }
    return array_keys($out);
}
