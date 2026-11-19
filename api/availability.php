<?php
// GET availability.php — disponibilités publiques (mêmes clés que assets/data/disponibilite.json).
declare(strict_types=1);
require __DIR__ . '/lib/bootstrap.php';

allow_methods(['GET']);

$pizzas = [];
$ingredients = [];
foreach (availability_effective() as $e) {
    if ($e['kind'] === 'pizza') {
        $pizzas[] = $e['name'];
    } elseif ($e['kind'] === 'ingredient') {
        $ingredients[] = $e['name'];
    }
    // kind = product : jamais dans la réponse publique (contrat §4.1 mis à jour).
}

// Exactement les clés de assets/data/disponibilite.json (pas de clé « ok » : disponibilite.js signale toute clé inconnue).
send_json(200, [
    'misAJourLe' => service_day(),
    'pizzasIndisponibles' => $pizzas,
    'ingredientsIndisponibles' => $ingredients,
]);
