# Contrôle du paquet de préproduction — 2026-11-19

## Périmètre

- Archive `preproduction-subito-2026-11-19.zip`, manifeste `preproduction-MANIFESTE-SHA256.txt`, dossier `preproduction-paquet` (dossier parent du dépôt).
- Dépôt `sub99`, lu en lecture seule.
- Méthode : quatre vérifications indépendantes (intégrité, contenu et sécurité, documents, liens et espace commerçant), chacune contestée par un second agent qui refaisait les contrôles décisifs par une autre méthode, puis une recherche des contrôles manquants. Aucun fichier du paquet ni du dépôt n'a été modifié par le contrôle.
- Les chiffres ont bougé pendant le contrôle (le dépôt a continué d'évoluer) : ils sont donnés au dernier relevé.

## Résultat

**Le paquet n'est pas à téléverser en l'état.**

- **Intégrité.** L'archive correspond à son manifeste (180 fichiers sur 180) et son empreinte est celle annoncée. Mais elle est antérieure au dépôt : au dernier relevé, 22 fichiers diffèrent et 6 manquent (`api/lib/catalogue.php`, `api/lib/horloge.php`, `api/customer_update_profile.php`, `api/data/`, `api/.user.ini`). Le paquet doit être reconstruit.
- **Contenu et sécurité.** Aucun secret réel trouvé. `api/lib/config.php` est un simple chargeur ; `api/config.sample.php` ne contient que des marqueurs. Les outils d'administration sont protégés (gardes CLI et `api/tools/.htaccess`).
- **Documents.** La checklist et les rapports décrivent par endroits un état antérieur (détail dans les actions).
- **Liens et espace commerçant.** Les trois changements de l'espace commerçant (en-tête à 375 px, son d'alerte arrêté après 30 s, colonne de décision) sont présents dans le dépôt et dans l'archive. Le service worker ne perd aucune URL de précache. Huit vignettes de la galerie ouvraient une image absente (corrigé).

## Décisions prises le 2026-11-19

| Point | Décision |
|---|---|
| Qui reconstruit le paquet et la checklist | Session d'intégration, depuis une version figée |
| `subito-popup/` | Exclu du paquet (page de démonstration) |
| Numéro dans `assets/js/main.js` | Ligne publique du restaurant : aucune modification |
| Concours | `concours.html`, `grand-tirage.html`, `assets/js/tirage/`, `assets/js/winners-data.js` exclus du paquet |
| Avis (`avis.html`, `index.html`) | Noms réduits à prénom et initiale |
| Galerie (`index.html`) | Clic retiré des huit vignettes tant que les photos manquent |
| Minimums par ville | Validés |
| Desserts et boissons | Prix validés |
| Composeur | Moitié-moitié à partir de Duo ; même prix quelle que soit la sauce |
| Échange d'ingrédients | Un retrait ne rend gratuite qu'une seule portion |

## Actions restantes

| Action | Responsable | Statut |
|---|---|---|
| Appliquer la règle d'échange (une seule portion) dans le panier et le contrôle serveur, avec tests de parité | Session d'intégration | À faire |
| Reconstruire le catalogue (`tools/build-catalogue.mjs`) après les dernières modifications de pages | Session d'intégration | En cours |
| Exclure du paquet les pages et fichiers du concours et `subito-popup/` ; retirer `concours.html` de `sitemap.xml` ; vérifier la redirection `/tirage-au-sort` (`.htaccess` racine, lignes 49 et 50) | Session d'intégration | À faire |
| Manifeste : UTF-8 sans BOM et fins de ligne LF ; décrire la procédure de contrôle (`sha256sum -c` échoue sur le fichier livré) | Session d'intégration | À faire |
| `.htaccess` racine : ajouter `Options -Indexes` et les règles qui protègent sauvegardes, configuration, `.md` et fichiers cachés (comme `api/.htaccess`) | Session d'intégration | À faire |
| Retirer les outils de test exposés sur `window` (`SubitoPopup`, `resetSubitoPopup`, `getSubitoPopupState`, `SubitoCart`) | Session d'intégration | À faire |
| Corriger la checklist et les rapports périmés (404 attendu remplacé par 403, état du service worker, redirection HTTPS, `install.php`, `app_origins`, chemin d'exemple) | Session d'intégration | À faire |
| Relire les fichiers du dépôt absents du paquet avant embarquement : `api/lib/horloge.php` (horloge de test : vérifier qu'aucune requête ne peut décaler l'heure en production), `api/lib/catalogue.php`, `api/customer_update_profile.php` | Session d'intégration, puis relecture | À faire |
| Vérifier la syntaxe PHP 8.1 de tous les fichiers `.php` (`php -l`) | Session d'intégration | À faire |
| Créer le dossier vide `assets/img/placeholders` côté serveur (une archive ne le porte pas) | Responsable, à la mise en ligne | À faire |
| Vérifier la version de MySQL sur l'hébergement (5.7 ou 8.0) et exécuter la suite API sur une base réelle | Responsable, sur OVH | À faire |
| Relire les modifications sans justification dans le rapport de mission (environ 37 fichiers, dont `menu.html`, `compte.html`, `index.html`, `assets/js/main.js`, feuilles de style) | Responsable | À faire |
| Commit ou tag pour figer la version : `sub99` est un dépôt git (HEAD du 18/11) avec 68 changements non commités. Un commit demande ton accord ; je ne commite pas sans lui. | Responsable | En attente |
| `api/tools/` (installation, création du propriétaire, réinitialisation client) : reste dans le paquet ; `api/.user.ini` : inclus | Responsable | Décidé le 2026-11-19 |
| `api/README.md` (chemins internes, ports de développement) : exclu du paquet ; la règle du script (ligne 23) doit être adaptée | Responsable | Décidé le 2026-11-19 |
| Supprimer du poste de travail `api/_phpinfo.php` et `api/_dbtest.php` (présents dans le dépôt, ignorés par git) | Responsable | En attente |

## Points de politique (information, sans blocage)

- Iframe Google Maps sur `index.html` sans mécanisme de consentement ; polices Google Fonts. À mentionner dans une politique de confidentialité.
- Données stockées dans le navigateur : panier (localStorage) et tentatives de commande (sessionStorage). À documenter.
- Conservation : les commandes copient nom, téléphone, e-mail et adresse ; il n'existe pas d'effacement de compte client ni de purge des sessions expirées. À traiter ou à documenter avant la mise en production.
- Politique de mot de passe : 8 caractères pour les clients, 12 pour le gérant, sans règle de complexité. À documenter si voulu.
- Session « rester connecté » du gérant de 30 jours. Durée à confirmer.
- Absence de Content-Security-Policy et de Strict-Transport-Security dans le paquet.
- URL de production (sitemap, balises canonical, JSON-LD) dans la copie de préproduction : sans gravité grâce à `noindex` et `Disallow: /`, mais à réécrire pour la mise en production.

## Points contestés ou corrigés pendant le contrôle

- Le lanceur annonçait le port 18091 fermé. Pendant le contrôle (vers 12h06), un serveur PHP servait le dépôt sur ce port (tests de la session d'intégration). Il est fermé au moment de ce rapport.
- Le manifeste n'était pas conforme à sa propre description : « 180 lignes conformes » était inexact, car le BOM et les fins de ligne CRLF rendent `sha256sum -c` inopérant. Les empreintes, elles, sont justes.
- L'écart entre le dépôt et le paquet a été recompté plusieurs fois (de 17 à 26 fichiers divergents selon le moment) : le dépôt évoluait pendant le contrôle.
- Le service worker utilise `Promise.allSettled` : une URL absente n'empêche pas l'installation, elle est seulement signalée. L'affirmation contraire ne tenait pas.
- Deux manques de détail ont été reconnus par le contrôle lui-même : le contrôle PHP, `.htaccess`, `sitemap.xml` et `robots.txt` n'avaient pas été contrôlés en détail par l'agent des liens ; la contestation les a relus.

## Vérifications non faites

- Exécution des suites de tests sur la version figée (interdite pendant le contrôle, à faire après reconstruction).
- Recette navigateur sur une copie isolée (lecture seule ici).
- Tests sur OVH : décompression, clés SSH, version PHP et MySQL, droits des fichiers `.htaccess`.

## Modifications sans justification (liste de référence)

Source : classement par date de modification (aucun diff git n'a été possible pendant le contrôle). Une entrée « citée » signifie qu'un rapport du jour mentionne le fichier, pas qu'il décrit la modification : à confirmer par le responsable de chaque mission.

### Aucun rapport du jour ne les cite (à justifier ou à annuler)

- `tests/e2e/lib/cdp.mjs` (03:04) : justification proposée par la session d'intégration (helper partagé ; quatre tests l'utilisent ; non modifié par sa mission).
- `.git/FETCH_HEAD`, `.git/refs/remotes/origin/HEAD`, `.git/logs/refs/remotes/origin/HEAD` (11:19) : opération git distante non documentée (remote `origin`, récupération). La session d'intégration dit ne pas l'avoir lancée ; ces références ne sont pas modifiées. Point ouvert, décision de l'utilisateur : aucune action distante, auteur à identifier.

### Citées par un rapport du jour, mais pas par le rapport de mission

- `assets/js/icons.js`, `assets/js/tirage/main.js`, `assets/js/tirage/reveal.js`, `assets/css/tirage.css`, `concours.html`, `reseaux.html`, `grand-tirage.html` : rapport « emoji vers icônes SVG ».
- `assets/js/main.js` (02:14) : rapports « emoji vers icônes SVG », « catalogue », « espace commerçant ».
- `tests/accessibilite/axe-pages.mjs`, `tests/accessibilite/lighthouse.mjs`, `tests/README.md`, `tests/e2e/regressions-audit.mjs`, `.gitattributes`, `.gitignore`, `robots.txt` : rapport « audit prépublication ».
- `assets/css/disponibilite.css`, `assets/js/disponibilite.js`, `assets/data/disponibilite.json` : rapports « disponibilité » et « espace commerçant ».
- `assets/css/style.css`, `assets/css/order-launch.css`, `assets/js/order-launch.js` : rapports « annonce commande en ligne », « offre livraison », « frais de livraison sans pizza ».
- `404.html`, `avis.html`, `commande.html`, `index.html`, `mentions-legales.html`, `menu.html`, `vegetarien.html` : plusieurs rapports du jour (accueil, commande, catalogue, espace commerçant).
- `compte.html`, `assets/css/cart.css`, `assets/css/commande.css`, `assets/css/compte.css` : rapports « compte client », « commande livraison réelle », « page de suivi », « identification par nom », « moyen de paiement ».
- `tests/e2e/parcours-commande.mjs` : rapports « audit prépublication » et « reprise site disponibilité ».

### Écarts entre les décisions et le paquet reconstruit (relevé à 12h46, empreinte e3a85…)

- `concours.html`, `grand-tirage.html`, `assets/js/tirage/` et `assets/js/winners-data.js` sont encore dans le paquet ; décision : les exclure.
- `api/README.md` est encore dans le paquet ; décision : l'exclure (règle du script, ligne 23).
- `sitemap.xml` liste encore `concours.html` (ligne 16).
- `.htaccess` du paquet, ligne 81 : redirection `/tirage-au-sort` vers `grand-tirage.html`, qui sera exclu.
- Règle d'échange : constat levé. Côté panier, un supplément a une quantité de 1 et le serveur refuse les autres quantités. Restait le cas d'une ligne de plusieurs pizzas : décision de l'utilisateur « une portion gratuite par pizza » (comportement actuel conservé, `assets/js/cart.js` `applySwapDiscount`, `api/lib/catalogue.php`). La proposition « une par ligne » est abandonnée.

Vérifié OK dans le paquet : empreinte de l'archive, manifeste de 182 lignes sans BOM ni CRLF, `subito-popup/` exclu, `api/tools/` et `api/.user.ini` présents, catalogue dans `api/data/`, `Options -Indexes`, FAQ et astérisques corrigés, noms d'avis réduits, galerie sans déclencheur actif.
