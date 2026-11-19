<?php
// Dates, chaînes, constantes métier.
declare(strict_types=1);

require_once __DIR__ . '/horloge.php';

const DELAY_CHOICES = [20, 30, 40, 50, 60];

/** Zones de livraison : identiques à DELIVERY_ZONES de assets/js/cart.js (montants en centimes). */
const DELIVERY_ZONES = [
    'Hénin-Beaumont'      => ['minimum_cents' => 1000, 'fee_cents' => 550],
    'Montigny-en-Gohelle' => ['minimum_cents' => 1500, 'fee_cents' => 550],
    'Dourges'             => ['minimum_cents' => 1500, 'fee_cents' => 550],
    'Noyelles-Godault'    => ['minimum_cents' => 1500, 'fee_cents' => 550],
    'Courrières'          => ['minimum_cents' => 2000, 'fee_cents' => 800],
    'Billy-Montigny'      => ['minimum_cents' => 2000, 'fee_cents' => 800],
    'Fouquières-lès-Lens' => ['minimum_cents' => 2500, 'fee_cents' => 800],
    'Rouvroy'             => ['minimum_cents' => 2500, 'fee_cents' => 800],
];

function utc_at(int $epoch): string
{
    return gmdate('Y-m-d\TH:i:s\Z', $epoch);
}

function now_utc(): string
{
    return utc_at(maintenant_epoch());
}

function utc_to_epoch(string $utc): int
{
    $d = DateTimeImmutable::createFromFormat('Y-m-d\TH:i:s\Z', $utc, new DateTimeZone('UTC'));
    return $d === false ? 0 : $d->getTimestamp();
}

/** Jour de service courant, calculé dans le fuseau de la configuration (Europe/Paris). */
function service_day(): string
{
    $tz = new DateTimeZone((string) (subito_config()['timezone'] ?? 'Europe/Paris'));
    return (new DateTimeImmutable('@' . maintenant_epoch()))->setTimezone($tz)->format('Y-m-d');
}

function str_chars(string $s): int
{
    return mb_strlen($s, 'UTF-8');
}

/** Espaces réduits et coupés aux extrémités. */
function clean_spaces(string $s): string
{
    $r = preg_replace('/\s+/u', ' ', $s);
    return trim($r === null ? $s : $r);
}

/** Forme de comparaison (même règle que norm() de assets/js/disponibilite.js). */
function norm_name(string $s): string
{
    if (class_exists('Normalizer')) {
        $n = Normalizer::normalize($s, Normalizer::FORM_D);
        if (is_string($n)) {
            $s = preg_replace('/\p{Mn}+/u', '', $n) ?? $s;
        }
    }
    $s = mb_strtolower($s, 'UTF-8');
    $s = strtr($s, [
        'à' => 'a', 'â' => 'a', 'ä' => 'a', 'á' => 'a', 'ã' => 'a', 'å' => 'a',
        'ç' => 'c', 'é' => 'e', 'è' => 'e', 'ê' => 'e', 'ë' => 'e',
        'î' => 'i', 'ï' => 'i', 'í' => 'i', 'ì' => 'i',
        'ô' => 'o', 'ö' => 'o', 'ó' => 'o', 'ò' => 'o', 'õ' => 'o',
        'ù' => 'u', 'û' => 'u', 'ü' => 'u', 'ú' => 'u', 'ÿ' => 'y', 'ñ' => 'n',
        'œ' => 'oe', 'æ' => 'ae',
        '’' => "'", '‘' => "'", '`' => "'", '´' => "'",
    ]);
    return clean_spaces($s);
}

/**
 * Nettoyage avant comparaison : caractères de format retirés (\p{Cf}, dont l'espace de
 * largeur nulle), espaces réduits, ponctuation finale retirée (. , ; : ! ?).
 */
function preclean_name(string $s): string
{
    $s = preg_replace('/\p{Cf}+/u', '', $s) ?? $s;
    $s = clean_spaces($s);
    $s = preg_replace('/[\s.,;:!?]+$/u', '', $s) ?? $s;
    return $s;
}

/** Clés d'un nom : complet, et sans parenthèse finale (« Calzone » pour « Calzone (soufflée) »). Correspondance exacte, jamais approximative. */
function name_keys(string $name): array
{
    $name = preclean_name($name);
    $full = norm_name($name);
    $core = norm_name(preclean_name((string) preg_replace('/\s*\([^()]*\)\s*$/u', '', $name)));
    return ($core !== '' && $core !== $full) ? [$full, $core] : [$full];
}

function name_keys_intersect(string $a, string $b): bool
{
    return array_intersect(name_keys($a), name_keys($b)) !== [];
}

function is_list_array($v): bool
{
    return is_array($v) && ($v === [] || array_keys($v) === range(0, count($v) - 1));
}

function is_int_between($v, int $min, int $max): bool
{
    return is_int($v) && $v >= $min && $v <= $max;
}
