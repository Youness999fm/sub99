<?php
// Modèle de configuration. Ne contient aucun secret.
// Sur le serveur, copier ce fichier en api/config.php (jamais versionné, jamais publié)
// puis remplacer TOUTES les valeurs marquées « À REMPLACER ».
return [
    'db' => [
        'dsn'      => 'mysql:host=À REMPLACER;dbname=À REMPLACER;charset=utf8mb4',
        'user'     => 'À REMPLACER',
        'password' => 'À REMPLACER',
    ],
    // Origine HTTPS exacte du site (sans barre finale).
    'app_origins'   => ['https://À REMPLACER.votre-domaine.fr'],
    // Doit rester true : le site est servi en HTTPS.
    'cookie_secure' => true,
    // Fuseau du jour de service.
    'timezone'      => 'Europe/Paris',
];
