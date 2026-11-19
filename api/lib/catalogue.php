<?php
// Catalogue serveur (api/data/catalogue.json, généré par tools/build-catalogue.mjs à partir des pages).
// Vérifie chaque ligne de commande : article connu, prix unitaire au centime près
// (taille ou prix fixe + suppléments, règle de substitution de cart.js), disponibilités.
declare(strict_types=1);

/** Chemin du catalogue : clé « catalogue_path » de la configuration (tests), sinon api/data/catalogue.json. */
function catalogue_path(): string
{
    $p = subito_config()['catalogue_path'] ?? null;
    return is_string($p) && $p !== '' ? $p : dirname(__DIR__) . '/data/catalogue.json';
}

/** Catalogue chargé une fois par requête. Absent ou invalide : exception (500), jamais de commande sans catalogue. */
function catalogue(): array
{
    static $cat = null;
    if ($cat !== null) {
        return $cat;
    }
    $raw = @file_get_contents(catalogue_path());
    if (!is_string($raw)) {
        throw new RuntimeException('Catalogue absent');
    }
    $c = json_decode($raw, true);
    if (!is_array($c) || ($c['schema'] ?? null) !== 1 || !is_array($c['products'] ?? null)
        || !is_array($c['supplement_groups'] ?? null)) {
        throw new RuntimeException('Catalogue invalide');
    }
    $cat = $c;
    return $cat;
}

/** normalizeIngredientName() de cart.js : minuscules, astérisque final retiré, espaces coupés. */
function catalogue_swap_key(string $name): string
{
    $s = mb_strtolower($name, 'UTF-8');
    $s = (string) preg_replace('/\*$/u', '', $s);
    return trim($s);
}

/** Nom de ligne découpé comme item_base_name() : [base, garniture ou null]. */
function catalogue_split_name(string $name): array
{
    $clean = preg_replace('/\p{Cf}+/u', '', $name) ?? $name;
    $parts = preg_split('/\s*[—–]\s*|\s+-\s+/u', $clean, 2);
    if ($parts === false || count($parts) < 2) {
        return [preclean_name($clean), null];
    }
    return [preclean_name($parts[0]), preclean_name($parts[1])];
}

/** Article du catalogue dont le nom de ligne correspond (mêmes clés que la disponibilité, jamais approximatif). */
function catalogue_find(string $name, string $kind): ?array
{
    if ($name === '') {
        return null;
    }
    foreach (catalogue()['products'] as $p) {
        if ($p['kind'] === $kind && name_keys_intersect((string) $p['line_name'], $name)) {
            return $p;
        }
    }
    return null;
}

/**
 * Groupe de suppléments contenant ce nom (casse et astérisque finale sans importance :
 * le propriétaire retire les astérisques de supplements.html, une astérisque résiduelle
 * envoyée par le navigateur reste reconnue), sinon null.
 */
function catalogue_extra_group(string $name): ?int
{
    $key = catalogue_swap_key($name);
    foreach (catalogue()['supplement_groups'] as $gi => $g) {
        foreach ($g['names'] as $n) {
            if (catalogue_swap_key((string) $n) === $key) {
                return (int) $gi;
            }
        }
    }
    return null;
}

/** Clés de disponibilité couvertes par un supplément (son nom, et ses alias : « chèvre » → « fromage de chèvre »). */
function catalogue_extra_keys(string $name): array
{
    $gi = catalogue_extra_group($name);
    if ($gi === null) {
        return [];
    }
    $g = catalogue()['supplement_groups'][$gi];
    $key = catalogue_swap_key($name);
    foreach ($g['names'] as $n) {
        if (catalogue_swap_key((string) $n) === $key) {
            return array_map('strval', $g['availability_keys'][$n] ?? [$n]);
        }
    }
    return [];
}

/**
 * Article d'une ligne validée.
 * @return array ['product'=>…, 'filler'=>?string, 'half'=>?array] ou ['error'=>code, 'name'=>…]
 */
function catalogue_resolve_line(array $it): array
{
    $unknown = ['error' => 'unknown_item', 'name' => $it['name']];
    $isPizza = $it['variant'] !== '';
    [$base, $rest] = catalogue_split_name($it['name']);
    $p = catalogue_find($base, $isPizza ? 'pizza' : 'product');
    if ($p === null) {
        return $unknown;
    }
    // Choix écrit dans le nom après « — » : garniture de la calzone (obligatoire),
    // base de la pizza à composer (facultative : le navigateur ne la transmet pas encore).
    $filler = null;
    if (is_array($p['choice']) && ($rest === null || $rest === '') && empty($p['choice']['required'])) {
        // pas de choix transmis : accepté (la disponibilité exige alors au moins une option)
    } elseif (is_array($p['choice'])) {
        if ($rest === null || $rest === '') {
            return $unknown;
        }
        foreach ($p['choice']['options'] as $opt) {
            if (norm_name($opt) === norm_name($rest)) {
                $filler = (string) $opt;
                break;
            }
        }
        if ($filler === null) {
            return $unknown;
        }
    } elseif ($rest !== null) {
        return $unknown;
    }
    if (!$p['orderable']) {
        return ['error' => 'unpriced_item', 'name' => $it['name']];
    }
    if ($isPizza && !is_int($p['prices_by_size'][$it['variant']] ?? null)) {
        return ['error' => 'unpriced_item', 'name' => $it['name']];
    }
    // Moitié-moitié (décision du propriétaire, 19/11/2026) : à partir de Duo, jamais en Solo,
    // jamais sur la calzone (ni sur un article sans moitié-moitié) → 422 validation, champ items[i].half.
    // Première moitié = la pizza de la ligne ; deuxième = une pizza proposable en moitié.
    $half = null;
    if (is_array($it['half'])) {
        if ($it['variant'] === 'Solo' || !$p['half_allowed']) {
            return ['error' => 'validation', 'field' => 'half'];
        }
        if (!name_keys_intersect((string) $p['line_name'], $it['half']['flavor1'])) {
            return $unknown;
        }
        $h = catalogue_find(item_base_name($it['half']['flavor2']), 'pizza');
        if ($h === null || !$h['half_flavor']) {
            return ['error' => 'unknown_item', 'name' => $it['half']['flavor2']];
        }
        $half = $h;
    }
    // Suppléments : seulement sur une pizza, et seulement ceux de supplements.html.
    foreach ($it['extras'] as $ex) {
        if (!$isPizza || catalogue_extra_group($ex['name']) === null) {
            return ['error' => 'unknown_item', 'name' => $ex['name']];
        }
    }
    // Retraits : ingrédients fixes de la fiche, choix retenu (garniture, base), ou ingrédients
    // de la deuxième moitié (le navigateur les propose aussi).
    $allowed = [];
    foreach ($p['ingredients'] as $ing) {
        $allowed[norm_name((string) $ing)] = true;
    }
    if ($filler !== null) {
        $allowed[norm_name($filler)] = true;
    }
    if ($half !== null) {
        foreach ($half['ingredients'] as $ing) {
            $allowed[norm_name((string) $ing)] = true;
        }
    }
    foreach ($it['removed'] as $ing) {
        if (!isset($allowed[norm_name($ing)])) {
            return ['error' => 'validation', 'field' => 'removed'];
        }
    }
    // Nom canonique (celui du catalogue), enregistré sur le ticket.
    $canonical = (string) $p['line_name'];
    if ($filler !== null) {
        $canonical .= ' — ' . mb_strtoupper(mb_substr($filler, 0, 1, 'UTF-8'), 'UTF-8') . mb_substr($filler, 1, null, 'UTF-8');
    }
    $canonicalHalf = $half === null ? null : ['flavor1' => (string) $p['name'], 'flavor2' => (string) $half['name']];
    return ['product' => $p, 'filler' => $filler, 'half' => $half, 'name' => $canonical, 'half_names' => $canonicalHalf];
}

/** Lignes avec les noms du catalogue (nom de ligne, moitiés) ; lignes déjà vérifiées par verify_line_prices(). */
function catalogue_canonical_items(array $items): array
{
    foreach ($items as $i => $it) {
        $r = catalogue_resolve_line($it);
        if (!isset($r['error'])) {
            $items[$i]['name'] = $r['name'];
            $items[$i]['half'] = $r['half_names'];
        }
    }
    return $items;
}

/**
 * Prix unitaire attendu d'une ligne résolue, et prix attendu de chaque supplément.
 * Règle de substitution reprise de applySwapDiscount() (cart.js) : chaque ingrédient retiré
 * d'un groupe rend gratuit le premier supplément suivant du même groupe ; un retrait ne
 * couvre qu'un supplément (la ligne entière, quelle que soit sa quantité, comme cart.js).
 * Seuls comptent les retraits d'ingrédients réellement présents sur la pizza (ou sa deuxième
 * moitié), une fois chacun : le navigateur ne peut pas en envoyer d'autres.
 */
function catalogue_expected_line(array $it, array $r): array
{
    $p = $r['product'];
    if ($p['kind'] !== 'pizza') {
        return ['unit_cents' => (int) $p['price_cents'], 'extras' => []];
    }
    $variant = $it['variant'];
    $groups = catalogue()['supplement_groups'];
    $groupOf = [];
    foreach ($groups as $gi => $g) {
        foreach ($g['names'] as $n) {
            $groupOf[catalogue_swap_key((string) $n)] = (int) $gi;
        }
    }
    // Crédits : retraits d'ingrédients fixes de la fiche (ou de la deuxième moitié), une fois
    // chacun — exactement les puces « Sans » que propose le navigateur.
    $present = [];
    foreach ($p['ingredients'] as $ing) {
        $present[norm_name((string) $ing)] = true;
    }
    if ($r['half'] !== null) {
        foreach ($r['half']['ingredients'] as $ing) {
            $present[norm_name((string) $ing)] = true;
        }
    }
    $credits = array_fill(0, count($groups), 0);
    $counted = [];
    foreach ($it['removed'] as $ing) {
        $k = norm_name($ing);
        if (!isset($present[$k]) || isset($counted[$k])) {
            continue;
        }
        $counted[$k] = true;
        $gi = $groupOf[catalogue_swap_key($ing)] ?? null;
        if ($gi !== null) {
            $credits[$gi]++;
        }
    }
    $unit = (int) $p['prices_by_size'][$variant];
    $extras = [];
    foreach ($it['extras'] as $ex) {
        $price = (int) $groups[catalogue_extra_group($ex['name'])]['prices_by_size'][$variant];
        $gi = $groupOf[catalogue_swap_key($ex['name'])] ?? null;
        if ($gi !== null && $credits[$gi] > 0) {
            $credits[$gi]--;
            $price = 0;
        }
        $extras[] = $price;
        $unit += $price * $ex['qty'];
    }
    return ['unit_cents' => $unit, 'extras' => $extras];
}

/**
 * Vérifie toutes les lignes contre le catalogue. $mode (pickup / delivery) n'intervient pas :
 * le prix unitaire est le même dans les deux modes (la promotion est calculée ensuite).
 * @return array|null null si tout est conforme, sinon l'erreur ['error'=>code, …données].
 */
function verify_line_prices(array $items, string $mode): ?array
{
    $resolved = [];
    foreach ($items as $i => $it) {
        $r = catalogue_resolve_line($it);
        if (isset($r['error']) && $r['error'] === 'validation') {
            $messages = [
                'half' => 'Moitié-moitié possible à partir de la taille Duo, jamais sur la calzone.',
                'removed' => 'Ingrédient retiré absent de ce produit.',
            ];
            return ['error' => 'validation', 'fields' => ["items[$i]." . $r['field'] => $messages[$r['field']]]];
        }
        if (isset($r['error'])) {
            return $r;
        }
        $resolved[$i] = $r;
    }
    foreach ($items as $i => $it) {
        $exp = catalogue_expected_line($it, $resolved[$i]);
        $ok = $exp['unit_cents'] === $it['unit_price_cents'];
        foreach ($it['extras'] as $k => $ex) {
            if ($ex['price_cents'] !== $exp['extras'][$k]) {
                $ok = false;
            }
        }
        if (!$ok) {
            return [
                'error' => 'price_mismatch_line',
                'index' => $i,
                'name' => $it['name'],
                'expected_unit_cents' => $exp['unit_cents'],
                'sent_unit_cents' => $it['unit_price_cents'],
            ];
        }
    }
    return null;
}

/**
 * Noms indisponibles parmi les lignes : pizzas (kind = pizza, règle existante), produits
 * (kind = product), ingrédients (kind = ingredient) fixes, garniture choisie et suppléments.
 * Un ingrédient fixe en rupture bloque la ligne même s'il est retiré (même règle que la carte).
 * $ingredientsOut reçoit les ingrédients en rupture qui ont bloqué une ligne : noms tels
 * qu'enregistrés dans availability, en minuscules (comme dans le menu), sans doublon.
 */
function check_availability_lines(array $items, ?array &$ingredientsOut = null): array
{
    $ingredientsOut = [];
    $out = [];
    foreach (unavailable_pizzas($items) as $n) {
        $out[$n] = true;
    }
    $ingredients = [];
    $products = [];
    foreach (availability_effective() as $e) {
        if ($e['kind'] === 'ingredient') {
            $ingredients[norm_name(preclean_name($e['name']))] = mb_strtolower(preclean_name($e['name']), 'UTF-8');
        } elseif ($e['kind'] === 'product') {
            $products[] = $e['name'];
        }
    }
    if ($ingredients === [] && $products === []) {
        return array_keys($out);
    }
    $hits = [];
    $isOut = function (string $ing) use ($ingredients, &$hits): bool {
        $k = norm_name(preclean_name($ing));
        if (!isset($ingredients[$k])) {
            return false;
        }
        $hits[$ingredients[$k]] = true;
        return true;
    };
    foreach ($items as $it) {
        $r = catalogue_resolve_line($it);
        if (isset($r['error'])) {
            continue;
        }
        $p = $r['product'];
        $base = item_base_name($it['name']);
        if ($p['kind'] === 'product') {
            foreach ($products as $name) {
                if (name_keys_intersect($name, (string) $p['line_name']) || name_keys_intersect($name, (string) $p['name'])) {
                    $out[$base] = true;
                }
            }
        }
        if ($ingredients === []) {
            continue;
        }
        // Ingrédients de disponibilité : liste de l'espace commerçant (MENU de commercant.js).
        foreach ($p['availability']['fixed'] as $ing) {
            if ($isOut((string) $ing)) {
                $out[$base] = true;
            }
        }
        if ($r['half'] !== null) {
            foreach ($r['half']['availability']['fixed'] as $ing) {
                if ($isOut((string) $ing)) {
                    $out[item_base_name($it['half']['flavor2'])] = true;
                }
            }
        }
        $options = $p['availability']['choice'];
        if ($r['filler'] !== null) {
            if ($isOut($r['filler'])) {
                $out[preclean_name($it['name'])] = true;
            }
        } elseif (is_array($options) && $options !== []) {
            // Choix non transmis (base de la pizza à composer) : au moins une option disponible.
            $left = array_filter($options, function ($o) use ($ingredients): bool {
                return !isset($ingredients[norm_name(preclean_name((string) $o))]);
            });
            if ($left === []) {
                foreach ($options as $o) {
                    $isOut((string) $o);
                }
                $out[$base] = true;
            }
        }
        foreach ($it['extras'] as $ex) {
            foreach (catalogue_extra_keys($ex['name']) as $key) {
                if ($isOut($key)) {
                    $out[trim((string) preg_replace('/\*$/u', '', $ex['name']))] = true;
                }
            }
        }
    }
    $ingredientsOut = array_map('strval', array_keys($hits));
    return array_keys($out);
}
