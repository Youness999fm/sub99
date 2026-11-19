<?php
// Horloge de l'API : time() en production ; horloge de test lue dans un fichier,
// uniquement sous le serveur de développement PHP (php -S) avec SUBITO_TEST_CLOCK_FILE.
declare(strict_types=1);

/** Époque courante en secondes. */
function maintenant_epoch(): int
{
    if (PHP_SAPI === 'cli-server') {
        $file = getenv('SUBITO_TEST_CLOCK_FILE');
        if (is_string($file) && $file !== '') {
            // Relu à chaque appel : les tests réécrivent le fichier entre deux requêtes.
            $raw = @file_get_contents($file);
            $raw = is_string($raw) ? trim($raw) : '';
            if (!preg_match('/^[0-9]{1,12}$/', $raw)) {
                throw new RuntimeException('Horloge de test illisible.');
            }
            return (int) $raw;
        }
    }
    return time();
}
