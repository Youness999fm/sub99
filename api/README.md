# API Subito Pizza — installation sur l'hébergement (OVH mutualisé)

Ce dossier contient l'API PHP du site : comptes clients, commandes, espace commerçant.
PHP 8.1 ou plus récent, base MySQL, aucune dépendance à installer.

## 1. Créer la base MySQL

Dans l'espace client OVH, rubrique **Hébergements → Bases de données** :

1. Créer une base MySQL (version 5.7 ou 8).
2. Noter l'**hôte**, le **nom de la base**, l'**utilisateur** et le **mot de passe**.

## 2. Copier la configuration

1. Copier `api/config.sample.php` en `api/config.php` (sur le serveur uniquement).
2. Remplir `api/config.php` :
   - `dsn` : `mysql:host=HOTE;dbname=NOM_BASE;charset=utf8mb4` avec l'hôte et le nom notés ;
   - `user` et `password` : l'utilisateur et le mot de passe de la base ;
   - `app_origins` : l'adresse exacte du site, en `https://`, sans barre finale ;
   - `cookie_secure` : `true` (le site doit être servi en HTTPS) ;
   - `timezone` : laisser `Europe/Paris`.
3. Ne jamais publier `api/config.php` ailleurs (il est ignoré par git).

## 3. Lancer l'installation

En SSH, depuis la racine du site :

```sh
php api/tools/install.php
```

L'outil crée les tables (il peut être relancé sans risque), ajoute le délai par défaut de 30 minutes,
et recopie les indisponibilités déjà saisies dans `assets/data/disponibilite.json`
(le fichier n'est pas modifié ; une ligne déjà en base n'est jamais écrasée).

Sans accès SSH : utiliser la tâche planifiée OVH (« Cron ») une seule fois avec la même commande,
ou demander au prestataire. Les outils refusent de s'exécuter depuis un navigateur.

## 4. Créer le compte du commerçant

```sh
php api/tools/create_owner.php
```

L'outil demande l'e-mail puis le mot de passe (12 caractères au moins). Il refuse s'il existe déjà
un propriétaire. Mot de passe oublié :

```sh
php api/tools/create_owner.php --reset-password
```

(même e-mail, nouveau mot de passe ; toutes les sessions ouvertes du commerçant sont fermées).

## 5. Vérifier

Ouvrir `https://<adresse du site>/api/availability.php`. La réponse attendue ressemble à :

```json
{"misAJourLe":"2026-11-19","pizzasIndisponibles":[],"ingredientsIndisponibles":[]}
```

Vérifier aussi que ces adresses répondent **403 (interdit)** :
`/api/config.php`, `/api/lib/db.php`, `/api/tools/install.php`, `/api/_phpinfo.php`.

## 6. Avant la mise en ligne

- **Supprimer `api/_phpinfo.php` et `api/_dbtest.php`** du serveur (fichiers de vérification ponctuelle).
  Ils sont déjà bloqués par `api/.htaccess`, mais ne doivent pas rester en ligne.
- Vérifier que le site est en HTTPS et que `cookie_secure` vaut `true`.
- Vérifier sur OVH que `api/.user.ini` est pris en compte (`display_errors = Off`, `log_errors = On`) : par exemple avec `api/_phpinfo.php`, colonne « Local Value », avant de supprimer ce fichier (la prise en compte peut demander quelques minutes).

## Contenu du dossier

- `*.php` : les routes de l'API (contrat : `reports/2026-11-19-espace-commercant-contrat-api.md`).
- `lib/` : code commun (jamais servi directement).
- `tools/` : outils en ligne de commande (jamais servis directement).
- `.htaccess` : bloque `lib/`, `tools/`, `config*.php`, les fichiers commençant par `_`, et la liste des fichiers.

## Tests (poste de développement)

```sh
SUBITO_PHP=<php> SUBITO_PHP_INI=<php.ini> node --test tests/api/
```

Les tests utilisent une base SQLite neuve dans un dossier temporaire (jamais la base de production).
`SUBITO_TEST_PORT` change le port de la suite API (`node --test tests/api/`, 8091 par défaut). Sur Windows, ce port peut être réservé : indiquer alors par exemple `SUBITO_TEST_PORT=18093`. Les scripts de capacité et de navigateur (`tests/lib`, `tests/capacite`) lisent la même variable, ou `PORT` à défaut (18091 par défaut). Ils refusent de démarrer si le port répond déjà, pour ne jamais réutiliser un serveur ancien.
