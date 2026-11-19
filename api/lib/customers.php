<?php
// Clients : validation des champs et vues renvoyées.
declare(strict_types=1);

function customer_view(array $c): array
{
    return [
        'id' => (int) $c['id'],
        'first_name' => (string) $c['first_name'],
        'last_name' => (string) $c['last_name'],
        'email' => (string) $c['email'],
        'phone' => (string) $c['phone'],
        'street' => $c['street'] === null ? null : (string) $c['street'],
        'city' => $c['city'] === null ? null : (string) $c['city'],
    ];
}

function normalize_email($v): ?string
{
    if (!is_string($v)) {
        return null;
    }
    $e = strtolower(trim($v));
    if ($e === '' || strlen($e) > 190 || filter_var($e, FILTER_VALIDATE_EMAIL) === false) {
        return null;
    }
    return $e;
}

function valid_phone(string $p): bool
{
    $len = strlen($p);
    return $len >= 8 && $len <= 20
        && preg_match('/^[0-9+ .\-()]+$/', $p) === 1
        && preg_match_all('/[0-9]/', $p) >= 8;
}

/**
 * Prénom ou nom nettoyé avant la normalisation des espaces : caractères de format retirés
 * (\p{Cf} : sens d'écriture U+202A–U+202E, U+2066–U+2069, espace de largeur nulle…),
 * caractères de contrôle (\p{Cc} : tabulation, retour à la ligne…) remplacés par une espace,
 * puis espaces réduits. Chaîne UTF-8 invalide : chaîne vide (donc refusée).
 */
function clean_person_name(string $s): string
{
    $s = preg_replace('/\p{Cf}+/u', '', $s);
    $s = $s === null ? null : preg_replace('/\p{Cc}+/u', ' ', $s);
    return $s === null ? '' : clean_spaces($s);
}

/**
 * Valide prénom, nom et téléphone (mêmes règles à l'inscription et dans le profil).
 * Ajoute les erreurs dans $errors.
 * @return array{0: string, 1: string, 2: string} [first_name, last_name, phone]
 */
function validate_profile(array $b, array &$errors): array
{
    $first = is_string($b['first_name'] ?? null) ? clean_person_name($b['first_name']) : '';
    $last = is_string($b['last_name'] ?? null) ? clean_person_name($b['last_name']) : '';
    if ($first === '' || str_chars($first) > 60) {
        $errors['first_name'] = 'Prénom attendu (60 caractères au plus).';
    }
    if ($last === '' || str_chars($last) > 60) {
        $errors['last_name'] = 'Nom attendu (60 caractères au plus).';
    }
    $phone = is_string($b['phone'] ?? null) ? trim($b['phone']) : '';
    if (!valid_phone($phone)) {
        $errors['phone'] = 'Numéro de téléphone invalide.';
    }
    return [$first, $last, $phone];
}

/**
 * Valide rue + ville (ville vide = pas d'adresse). Ajoute les erreurs dans $errors.
 * @return array{0: ?string, 1: ?string} [street, city]
 */
function validate_address(array $b, array &$errors): array
{
    $street = isset($b['street']) ? $b['street'] : '';
    $city = isset($b['city']) ? $b['city'] : '';
    if ($street === null) {
        $street = '';
    }
    if ($city === null) {
        $city = '';
    }
    if (!is_string($street)) {
        $errors['street'] = 'Adresse invalide.';
        $street = '';
    }
    if (!is_string($city)) {
        $errors['city'] = 'Ville invalide.';
        $city = '';
    }
    $street = clean_spaces($street);
    $city = trim($city);
    if (str_chars($street) > 150) {
        $errors['street'] = 'Adresse trop longue (150 caractères au plus).';
    }
    if ($city !== '' && !array_key_exists($city, DELIVERY_ZONES)) {
        $errors['city'] = 'Cette ville n\'est pas dans notre zone de livraison.';
    }
    if ($city === '') {
        return [null, null];
    }
    return [$street === '' ? null : $street, $city];
}
