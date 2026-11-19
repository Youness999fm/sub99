# Intégration de l'espace commerçant dans sub99 — rapport de mission

Date : 2026-11-19 · **Statut : développement, tests locaux et paquet de préproduction reconstruit depuis l'arbre figé `a31340b2eaba262e6e69da72cec5773c24ec0896`. Juge indépendant lancé (verdict ci-dessous). Commit : fait par la session parente, sur une nouvelle branche depuis `main`, sans push (à confirmer). Rien n'est publié, rien n'est déployé.** Décisions bloquantes avant toute commande réelle : confirmer les décisions par défaut du catalogue serveur, et revalider les éléments non figés (voir « Décisions à prendre »). Les autres points ouverts et leurs solutions sont dans [2026-11-19-solutions-points-ouverts.md](2026-11-19-solutions-points-ouverts.md).

Documents liés : [contrat d'API](2026-11-19-espace-commercant-contrat-api.md) · [mises à jour du contrat](2026-11-19-contrat-api-mises-a-jour.md) · [proposition de catalogue des prix](2026-11-19-catalogue-serveur-proposition.md) · [checklist de préproduction](2026-11-19-preproduction-checklist-utilisateur.md) · [contrôle du paquet](2026-11-19-controle-paquet-preproduction.md)

## Demandé

Relier la maquette `commercant/` au site client, dans `sub99`, avec une seule chaîne de commande : compte client, commande enregistrée côté serveur, espace commerçant, acceptation ou refus avec délai, suivi client. Accès commerçant réservé à un seul compte propriétaire. Tests : accès, double clic, relance réseau, rupture, mobile et tablette, notifications. Capacité de 100 commandes par minute, mesurée seulement dans un environnement isolé.

## Résultats vérifiés

| Élément | Résultat | Preuve |
|---|---|---|
| Suite API (`tests/api/api.test.mjs`) | **57 réussis sur 57**, à deux reprises. Une exécution précédente a subi des expirations de connexion sur la boucle locale (`ETIMEDOUT`, sans lien avec le code) | Relances de l'après-midi, port 18093 |
| Suite catalogue (`tests/api/catalogue.test.mjs`) | **26 réussis sur 26** : 22 tests existants et 4 tests de parité pour l'échange par pizza. `--check` répond « Catalogue à jour » | Relance de l'après-midi, port 18093 |
| Suite politique (`tests/api/politique.test.mjs`) | **25 réussis sur 25** | Relance de l'après-midi, port 18093 |
| Suites sur MariaDB 11.8.10 | 104 sur 104 au moment de la relance du matin (une base vide par fichier), avant les derniers changements de la règle d'échange ; non relancées depuis | Relances du 19/11 entre 12:03 et 12:12 |
| Syntaxe | `php -l` sur les fichiers PHP modifiés ; `node --check` sur les 19 fichiers JavaScript du site du paquet | Relance de l'après-midi |
| Commande de bout en bout, site client → commerçant | Commande n° 4 créée depuis la page de commande, retrouvée côté commerçant (recette et ticket) : à emporter, 11,00 €, acceptée 20 min | Contrôle croisé par les deux lots (version précédente) |
| Parcours client final | Rupture du jambon affichée ; commande de quatre articles acceptée et totalisée côté serveur (26,00 € après 11,00 € de promotion) ; moitié-moitié en Duo acceptée et suivie (« Moitié : Régina / Kebab ») ; profil ; recherche clients en POST | Lot site client, relance du 19/11 |
| Test XSS (espace commerçant) | Note `<img src=x onerror=…>`, nom client piégé, supplément `<b>gras</b>` : affichés en texte brut dans la file, la fiche, la recette, le ticket et la liste clients ; `window.__xss` reste indéfini | Captures `00-xss-*.png` (dossier de session, hors dépôt) |
| Déconnexion du commerçant | Sur une réponse 500, reste connecté avec un message d'échec ; la vraie déconnexion fonctionne ensuite | Test navigateur |
| Son d'alerte | 18 bips puis silence à 28,8 s ; « Couper le son » coupe, « Réactiver le son » rétablit ; une nouvelle commande rétablit le son | Test navigateur |
| Mise en page à 375 px | En-tête sur trois lignes ; pas de défilement horizontal à 375, 768 et 1024 px | Captures `54-entete-*.png` |
| Colonne de décision | Masquée sans commande ; réapparaît à l'arrivée d'une commande ; « Accepter » (20 min) en une seule requête, puis masquée | Captures `56` à `58` |
| **Calzone : contrôle « aucune option »** | **Échec signalé, non résolu.** Son auteur l'attribue à son propre test (présence d'un élément masqué). Non revérifié à l'écran | Lot site client |
| Paquet de préproduction | 172 fichiers ; manifeste vérifié (172 OK, 0 échec) ; test sur copie extraite au port 18096 : pages, absences, API, connexion propriétaire | Voir « Paquet de préproduction » |
| Capacité, local | 100 commandes enregistrées (201) sur 100, 0 erreur, 100 visibles côté propriétaire, en 59,5 s. **Mesure faite avant les changements de l'après-midi : à relancer** | Voir « Capacité » |

## Correctifs appliqués dans cette phase

- **API** : `SUBITO_CONFIG` ignoré hors ligne de commande et hors serveur de test ; tentatives de connexion comptées avant vérification, une tentative réussie est retirée du compte (`throttle_refund`) ; verrou par adresse IP seulement, sans verrou par e-mail ; noms de rupture normalisés (tirets, ponctuation, caractères invisibles), sans correspondance approximative ; remise en disponible d'une pizza qui lève aussi la rupture de sa variante ; saisie masquée du mot de passe propriétaire sous Unix ; une session client précédente est révoquée à la reconnexion ; réinitialisation de mot de passe client en ligne de commande (`api/tools/reset_customer.php`).
- **Catalogue serveur des prix** (nouveau) : `api/data/catalogue.json` généré par `tools/build-catalogue.mjs` depuis les pages du site ; chaque ligne recalculée (taille ou prix fixe, suppléments) ; écart de prix refusé (`price_mismatch_line`) ; nom du catalogue sur le ticket ; un supplément vaut une unité et ne peut pas être répété ; retrait limité aux ingrédients de la ligne ; rupture par ingrédient (`unavailable_ingredients`) ; pizza à composer vérifiée sur ses bases.
- **Échange d'ingrédients : une portion par pizza** (décision de l'utilisateur, 19/11) : chaque pizza d'une ligne qui n'a plus l'ingrédient retiré a son supplément offert. Une ligne de 3 pizzas avec un retrait et une olive offre 3 olives. Le comportement actuel de `cart.js` et du serveur est conservé. Une variante « une portion par ligne » a été codée par un agent, puis retirée : elle n'est pas dans le code. Les tests de parité qui fixent ce comportement sont décrits plus bas.
- **Profil client** (nouveau) : `api/customer_update_profile.php` et « Mes informations » dans « Mon compte ». Le téléphone peut être modifié après l'inscription.
- **Recherche clients** : `POST` seul (JSON `{q}`) ; `GET` renvoie 405.
- **Espace commerçant** : son arrêté après 30 secondes, bouton « Couper le son » ; service worker : erreur journalisée, mise en cache tolérante (un fichier en échec n'empêche plus l'installation) ; en-tête à 375 px ; colonne de décision masquée sans commande.
- **Site client** : promotion affichée ; clé d'idempotence conservée quand l'issue est inconnue ; sondage séquentiel avec recul ; rôle d'alerte permanent ; délai d'envoi ; correction d'une expression régulière qui cassait la page de suivi ; message de rupture qui nomme l'ingrédient.
- **Outils de test retirés de `window`** : `SubitoCart` (`assets/js/cart.js`), `SubitoPopup`, `resetSubitoPopup`, `getSubitoPopupState` (`assets/js/subito-popup.js`). Aucun test ni aucune page incluse ne les utilisait.
- **Outils et paquet** : harnais de test unifié (`SUBITO_TEST_PORT`, puis `PORT`) qui refuse un port occupé ; mots de passe de test générés à l'exécution ; horloge de test (`SUBITO_TEST_CLOCK_FILE`, active seulement sous `php -S`) ; script de paquet paramétré (`-Source`, `-Sortie`), qui refuse les dossiers interdits et contrôle son manifeste ; protections `.htaccess` (racine du dépôt et paquet).

## Tests de parité par pizza (`tests/api/catalogue.test.mjs`)

Quatre tests ajoutés. Les fonctions de prix sont extraites de `assets/js/cart.js` telles quelles (`applySwapDiscount`, `extrasTotal`, `lineUnitPrice`, `toCents`, `orderTotalsCents`), sans recopie. Les fins de ligne CRLF du poste sont normalisées avant l'extraction.
- Une ligne de 3 pizzas Régina Duo avec un retrait (champignons) et une olive : prix unitaire de liste 16,00 €, olive offerte ; total à emporter 32,00 € (trois pizzas, une pizza sur deux de la paire offerte) ; le serveur accepte (201).
- La même ligne avec une olive facturée 1,50 € : refusée (422 `price_mismatch_line`, prix unitaire attendu 16,00 €).
- Une ligne normale (une pizza, un retrait, un supplément) : une olive du même groupe est offerte (16,00 €), un brie d'un autre groupe est payé (18,00 €).
- Parité navigateur et serveur, quantités 1 et 3, avec deux retraits et trois suppléments : totaux 18,00 €, 3 × 18,00 € − 18,00 € (promotion) et 17,50 €, tous acceptés par le serveur.

## Relectures

- **Adversaire backend (Opus)** : 22 objections. Point bloquant : le serveur acceptait les prix unitaires envoyés par le navigateur. Traité par le catalogue serveur. Accepté par le contrat : la réponse `email_taken` révèle l'existence d'un compte.
- **Adversaire front (Sonnet)** : un point bloquant (déconnexion affichée sans révocation réelle), corrigé et retesté. L'objection « le serveur accepte un total différent » est **non fondée** : le serveur compare et renvoie 409.
- **Adversaire politique (connexion, profil, recherche, horloge)** : compteur IP, noms, IPv6 et recherche corrigés ; suites passantes sur SQLite et MariaDB. Écarts signalés et acceptés : `\p{Cc}` remplacés par une espace (choix à valider), et une tentative réussie n'est plus comptée.
- **Juge indépendant (19/11, lecture seule, sans les rapports d'avancement)** :
  - Points 1, 2, 3, 5, 7, 8 et 9 : **PASS**. Une seule interface commerçant (`/commercant/`) ; commande enregistrée dans une transaction, panier vidé seulement après réponse 201/200 ; propriétaire créé en ligne de commande seulement ; sessions révocables ; prix recalculés côté serveur, écarts refusés ; pas de push, aucune promesse d'écran verrouillé ; aucun paiement en ligne, FTP ou SSH.
  - Point 4 : **PASS avec réserve**. Tout passe par `require_owner()`. Réserve : `/commercant/index.html` est une page statique sans contrôle serveur ; elle ne contient aucune donnée (assumé). `sessionStorage` contient la clé d'idempotence, qui n'est pas un secret d'authentification.
  - Point 6 : **PASS avec deux limites** : sans `sessionStorage`, une actualisation crée une nouvelle clé ; après une issue inconnue suivie d'un panier modifié, un renvoi avec nouvelle clé reste possible après avertissement.
  - Point 10 : **non vérifiable par lecture** : les fichiers de disponibilité ne sont pas suivis par git, donc aucune référence ne permet de prouver qu'ils n'ont pas été modifiés. Le juge a noté que son constat « pas de dépôt git » visait le dossier parent ; `sub99` est un dépôt git.
  - Manques relevés : preuve d'intégrité des fichiers de disponibilité ; captures de test e2e hors dépôt ; fichiers de diagnostic `api/_phpinfo.php` et `api/_dbtest.php` encore sur le PC (ignorés par git, absents du paquet) ; production non confirmée (`config.php` réel absent, normal).
  - Non couvert par les tests : Apache et `.htaccess` sur OVH ; cookie `Secure` en HTTPS (les tests tournent en HTTP) ; MySQL OVH réel (tests sur MariaDB 11.8 et SQLite) ; comportement du navigateur sur les points de la section précédente, sauf ce qui est listé ; téléphone réel ; `sessionStorage` bloqué ; coupure réseau pendant l'envoi ; parcours complet dans deux navigateurs en même temps.
- **Contrôle du paquet (session parente, 19/11)** : décisions reçues et appliquées (concours, README, sitemap, redirection, échange par pizza, outils `window`, manifeste, `.htaccess`). La liste des modifications sans justification figure dans la section « Modifications hors mission » ci-dessous.

## Modifications hors mission (liste du contrôle, à confirmer par le responsable de chaque chantier)

Source : `reports/2026-11-19-controle-paquet-preproduction.md`, section « Modifications sans justification ». Une entrée « citée » signifie qu'un rapport du jour mentionne le fichier, pas qu'il décrit la modification : chaque responsable de chantier doit confirmer ou annuler. Cette mission n'a pas modifié les fichiers hors de sa liste de la section « Fichiers ».

| Fichier(s) | Rapport du jour qui le cite | Position de cette mission |
|---|---|---|
| `assets/js/icons.js`, `assets/js/tirage/main.js`, `assets/js/tirage/reveal.js`, `assets/css/tirage.css`, `concours.html`, `reseaux.html`, `grand-tirage.html` | `2026-11-19-emoji-vers-icones-svg.md` | Hors mission. Confirmer par le chantier icônes et concours. Les pages du concours sont exclues du paquet (décision du responsable) |
| `assets/js/main.js` | `emoji-vers-icones-svg`, `catalogue`, `espace-commercant` | Hors mission. Seule ligne modifiée dans la branche : la ligne 556 (icône de la pizza, chantier icônes). Les lignes 1128 et 1153 (numéro public) sont inchangées, vérifié |
| `tests/accessibilite/axe-pages.mjs`, `tests/accessibilite/lighthouse.mjs`, `tests/README.md`, `tests/e2e/regressions-audit.mjs` | `2026-11-19-audit-prepublication.md` | Hors mission. Confirmer par le responsable de l'audit prépublication |
| `.gitattributes`, `.gitignore` | `2026-11-19-audit-prepublication.md` | Hors mission. `.gitignore` couvre `api/config.php` et `api/_*.php` : à confirmer par l'audit |
| `robots.txt` (racine, version publique) | `2026-11-19-audit-prepublication.md` | Hors mission. La version de préproduction est `tools/preproduction/robots.txt`, qui est de cette mission |
| `assets/css/disponibilite.css`, `assets/js/disponibilite.js`, `assets/data/disponibilite.json` | `2026-11-19-reprise-site-disponibilite.md`, `espace-commercant` | Hors mission (chantier disponibilité, exclu du commit). L'API de disponibilité (`api/availability.php`, `api/lib/availability.php`) est de cette mission |
| `assets/css/style.css`, `assets/css/order-launch.css`, `assets/js/order-launch.js` | `2026-11-19-annonce-commande-en-ligne-accueil.md`, `2026-11-19-offre-livraison-accueil.md`, `2026-11-19-frais-livraison-sans-pizza.md` | Hors mission (accueil : annonce et offre) |
| `404.html`, `avis.html`, `index.html`, `mentions-legales.html`, `vegetarien.html` | Plusieurs rapports du jour (accueil, commande, catalogue, espace commerçant) | Hors mission. `avis.html` et `index.html` : noms d'avis réduits et galerie sans agrandissement, décidés par le responsable et appliqués par la session parente |
| `menu.html` | Plusieurs rapports du jour | Hors mission. Mélange icônes, garniture de la calzone et appels à la disponibilité |
| `commande.html`, `compte.html`, `assets/css/cart.css`, `assets/css/commande.css`, `assets/css/compte.css` | `2026-11-19-interface-compte-client-et-commander.md`, `2026-11-19-commande-livraison-reelle.md`, `2026-11-19-page-suivi-commande.md`, `2026-11-19-identification-par-nom-et-nettoyage-suivi.md`, `2026-11-19-moyen-paiement-livraison.md` | Pages et styles hors mission (chantier compte client et commande). Les scripts `assets/js/cart.js`, `commande.js`, `account.js`, `compte.js` sont de cette mission (branchement à l'API) |
| `tests/e2e/parcours-commande.mjs` | `2026-11-19-audit-prepublication.md`, `2026-11-19-reprise-site-disponibilite.md` | Hors mission. Confirmer par le responsable des tests e2e |
| `tests/e2e/lib/cdp.mjs` (03:04) | Aucun rapport du jour | **Justification : helper partagé** des tests e2e et d'accessibilité (quatre tests l'utilisent). Daté de 03:04, avant le démarrage de cette session (03:26) ; non modifié par cette mission. À conserver |
| `.git/FETCH_HEAD`, `.git/refs/remotes/origin/HEAD`, `.git/logs/refs/remotes/origin/HEAD` (11:19) | Aucun rapport du jour | **Opération git distante non documentée**, non lancée par cette mission (aucune commande git distante dans nos commandes : ni fetch, ni pull, ni push, ni set-head). Le journal ne contient que « remote set-head » et la récupération de `main`. Auteur à identifier ; références non annulées (elles concernent le suivi distant, pas le contenu) |

## Paquet de préproduction (reconstruit le 19/11, après-midi)

- **Version figée** : arbre git `a31340b2eaba262e6e69da72cec5773c24ec0896`, hors `reports/` (217 fichiers). Il a été calculé dans un index temporaire : aucune branche ni aucune référence n'a été modifiée. Il inclut les modifications d'autres sessions présentes au moment du gel (`account.js`, `commande.js`, `compte.js`, `cart.css`, `tests/e2e/regressions-audit.mjs`, et les parties de `cart.js` hors échange : tentatives d'envoi, panier en attente).
- **Extraction** : `git -c core.eol=lf -c core.autocrlf=false archive`. Sans les fins de ligne LF, le contrôle du catalogue échoue (l'archive par défaut est en CRLF).
- **Contrôles de la copie figée** : catalogue à jour ; 19 fichiers JavaScript du site passent `node --check`.
- **Paquet** : 172 fichiers, dans le dossier parent du dépôt : `preproduction-paquet\` ; archive `preproduction-subito-2026-11-19.zip`, SHA-256 `74b4b6d06b6bd6473a3e76c044f6a006e9f1c62092c1fc565ac1f8e8cb58c7fd` ; manifeste `preproduction-MANIFESTE-SHA256.txt`, UTF-8 sans BOM, fins de ligne LF, 172 lignes.
- **Contrôles du manifeste** : `sha256sum -c` lancé depuis le dossier du paquet : 172 OK, 0 échec. Archive extraite dans un dossier séparé : 172 OK. Archive sans antislash.
- **Exclus** : `concours.html`, `grand-tirage.html`, `assets/js/tirage/`, `assets/js/winners-data.js` (décision du responsable : ils restent dans le dépôt) ; `subito-popup/` ; `api/README.md` et toute documentation `.md` ; `api/config.php`, `api/_phpinfo.php`, `api/_dbtest.php` ; `reports/`, `tests/`, `tools/`, `.claude/`, `.git/`.
- **Présents** : `api/tools/` (installation, création du propriétaire, réinitialisation) et `api/.user.ini` ; `api/data/catalogue.json`.
- **Sitemap** : entrée `concours.html` retirée (9 → 8 entrées, vérifié). **Redirection** `/tirage-au-sort` retirée du `.htaccess` du paquet (sa cible n'y est plus) ; le `.htaccess` racine du dépôt la garde.
- **Test du paquet** (copie extraite de l'archive, serveur PHP sur le port dédié 18096, base SQLite de test hors du paquet, serveur arrêté ensuite) : `index.html`, `menu.html`, `commande.html`, `compte.html`, `commercant/`, `robots.txt`, `404.html`, `assets/js/cart.js` et `assets/js/disponibilite.js` en 200 ; `concours.html`, `grand-tirage.html`, `assets/js/tirage/main.js`, `assets/js/winners-data.js`, `subito-popup/index.html`, `api/config.php`, `api/_phpinfo.php`, `api/_dbtest.php`, `api/README.md` en 404 ; `availability.php` avec exactement trois clés ; installation et création du propriétaire : code 0 ; connexion propriétaire 200, session valide 200, `owner_orders` sans session 401.
- **Limites du test** : `php -S` sert `index.html` pour toute URL inconnue sans extension (`/tirage-au-sort` répond 200 ; `/nope-introuvable` aussi). Ce n'est pas un fichier du paquet. **Non testé ici** : les protections `.htaccess` et `Options -Indexes` (Apache seulement), la redirection supprimée (sur Apache, `/tirage-au-sort` doit répondre 404), la validation HTTPS. Voir checklist 7.0, 7.2, 7.3 et 7.6.
- **Dossier vide `assets/img/placeholders`** : à créer à la main sur le serveur (une archive ne transporte pas les dossiers vides).
- **Éléments non figés** (décision du responsable) : publication des gagnants du concours (question en cours) ; noms des avis (`avis.html`, `index.html`) réduits à prénom et initiale ; galerie de `index.html` sans agrandissement ; composeur, moitié-moitié décidée et à implémenter (voir ci-dessous). Ils sont dans le paquet dans leur état de la version figée : à revalider avant publication.
- **Dans la copie seulement** : `robots.txt` en `Disallow: /`, en-tête `X-Robots-Tag: noindex, nofollow`, redirection HTTP vers HTTPS. `api/config.sample.php` : espaces réservés « À REMPLACER », `cookie_secure` à vrai, aucun secret.
- Procédure de reconstruction : [checklist, section 0.3](2026-11-19-preproduction-checklist-utilisateur.md).

## Services, coûts, sécurité

- **Aucun service, abonnement ni coût** ajouté. PHP 8.3.36 portable (SHA256 vérifié) et MariaDB 11.8.10 portable (signature GPG vérifiée) : décompressés dans le dossier temporaire de la session, rien d'installé, rien de permanent. Approuvés par l'utilisateur pour les tests locaux uniquement.
- **Hébergement visé** : OVH mutualisé, avec base MySQL et accès SSH ou tâche planifiée. Aucun accès OVH n'a été utilisé. Rien n'est déployé.
- **Sécurité, selon le contrat** : cookies HttpOnly (Strict pour le propriétaire, Lax pour le client, chemin `/api/`) ; jetons aléatoires dont seul le hachage est stocké ; sessions révocables ; limitation des tentatives ; contrôle de rôle sur chaque route de l'API ; idempotence des commandes ; aucun mot de passe, jeton ni hachage dans les réponses.
- **Incident de manipulation** : pendant une vérification MariaDB, une commande d'inspection a affiché des identifiants de test locaux dans la sortie de la session. Ils ne valent que pour `127.0.0.1:3307` (base de test), le serveur est arrêté, et ils ne figurent dans aucun fichier du dépôt.

## Serveur de test

Arrêtés : `localhost:18091` ne répond plus ; MariaDB (`127.0.0.1:3307`) est arrêté ; le serveur de test du paquet (port 18096) est arrêté ; les serveurs de vérification des ports 18093 et 18097 ne tournent plus.

## Décisions prises (utilisateur et responsable)

- **Échange d'ingrédients : une portion par pizza** (décision de l'utilisateur, « recommandé »). Comportement actuel conservé ; tests de parité ajoutés.
- **Moitié-moitié du composeur** : décidée « comme le menu », à partir de la taille Duo, sauf en Solo et sur la calzone. **Non implémentée** : la page composeur n'a ni liste de parfums ni option de ce type. Implémentation à faire après le commit, sur demande (choix de la deuxième moitié sur `composer.html`, règle de prix, validation serveur, tests). `composer.html` n'a pas été modifié.
- **Base de la Marguerita** (sauce tomate ou crème fraîche) : même prix. Déjà le cas.
- **Minimums par ville** : 10, 15, 20 et 25 € (Hénin-Beaumont, Montigny-en-Gohelle, Dourges, Noyelles-Godault, Courrières, Billy-Montigny, Fouquières-lès-Lens, Rouvroy). Déjà identiques dans le serveur, le navigateur et le catalogue.
- **Prix des desserts et des boissons** : validés, aucun changement.
- **Concours** : exclu du paquet ; le dépôt garde les fichiers.
- **`subito-popup/`** : hors du paquet (page de démonstration).
- **`api/README.md`** : hors du paquet. **`api/tools/`** et **`api/.user.ini`** : dans le paquet.
- Connexion : verrou par adresse IP seulement, pas de verrou par e-mail ; une tentative réussie n'est pas comptée.
- Mots de passe de test : générés à chaque exécution. Aucun littéral dans `tests/` ; aucun mot de passe de test dans le dépôt.

## Git

- Branche locale **`espace-commercant-et-commande`** : un commit `9449ede` au-dessus de `main`, incomplet (sans `menu.html`), **non poussé**. À remplacer par le commit de la session parente, ou à supprimer si elle est remplacée.
- **Commit complet** : fait par la session parente sur une nouvelle branche depuis `main`, à partir de l'arbre de travail, sans push (à confirmer par elle). Son contenu du site correspond à l'arbre figé `a31340b2eaba262e6e69da72cec5773c24ec0896` pour les fichiers présents au gel.
- Pousser : `git push -u origin <nom de la branche>`, après confirmation de l'utilisateur.
- Le dépôt apparaît comme **public** sur GitHub : tout ce qui est poussé est visible.
- Non suivis et jamais commités : `api/config.php`, `api/_phpinfo.php`, `api/_dbtest.php` (ignorés par `.gitignore`).

## Fichiers

- **Mission (créés)** : `api/` (configuration exemple, `.htaccess`, `README.md`, `lib/`, `data/catalogue.json`, `tools/` avec `install`, `create_owner`, `reset_customer`) ; `tests/api/` ; `tests/lib/` ; `tests/capacite/` ; `commercant/manifest.webmanifest` ; `commercant/sw.js` ; `tools/build-catalogue.mjs` ; `tools/construire-preproduction.ps1` ; `tools/preproduction/` ; les rapports de la mission.
- **Mission (modifiés)** : `commercant/index.html`, `assets/js/commercant.js`, `assets/css/commercant.css`, `assets/js/cart.js` (branchement à l'API, retrait de `window.SubitoCart`, échange par pizza, tentatives d'envoi), `assets/js/commande.js`, `assets/js/account.js`, `assets/js/compte.js`, `api/config.sample.php` (espaces réservés), `api/lib/catalogue.php`, `api/lib/orders.php` (échange et totaux), `.htaccess` racine (protections et `Options -Indexes`), `assets/js/subito-popup.js` (retrait des outils `window`), `tests/api/catalogue.test.mjs` (4 tests de parité par pizza), `tools/construire-preproduction.ps1` (réécrit : paramètres, concours, README, sitemap, manifeste, contrôles), `tools/preproduction/htaccess.txt` (protections, redirection retirée).
- **À retirer du PC avant toute publication** : `api/_phpinfo.php` et `api/_dbtest.php` (diagnostics). Ils ne sont ni commités, ni dans le paquet.

## Capacité

Test local : PHP intégré (un seul processus) et SQLite, base neuve, hors dépôt. Les 10 clients synthétiques sont **insérés directement dans la base de test**, chacun avec une vraie session (jeton aléatoire, hachage SHA-256 stocké). **L'inscription est donc contournée pour ce test** ; la limite de production n'est ni modifiée ni consommée.

Dernière exécution propre : 2026-11-19 à 10:33:22 (+01:00), port 18094, `tests/capacite/capacite.mjs`. **Elle date d'avant le catalogue, la connexion par IP, le profil et la règle d'échange : à relancer sur la version finale avant de citer un chiffre.**

| Étape | Chiffre |
|---|---|
| Requêtes HTTP envoyées | 102 : 100 `order_create.php`, 1 `owner_login.php`, 1 `owner_orders.php` |
| Paniers commencés | Non mesuré : les commandes sont envoyées directement à l'API, sans panier navigateur |
| Commandes enregistrées (201) | 100, 0 erreur, 0 rejeu |
| Commandes visibles côté propriétaire | 100 |
| Durée d'envoi | 59,5 s |
| Latence (médiane / p95 / max) | 95,6 ms / 108,7 ms / 120,7 ms |

Mesure locale seulement : **pas la capacité de l'hébergement OVH** (MySQL mutualisé non testé). La session parente a reproduit le résultat (100/100) ; sa tentative antérieure avec inscriptions avait échoué à cause de la limite d'inscriptions, cause non établie.

Relance (PHP portable approuvé ; le port doit être libre) :

```powershell
$env:PHP_BIN = 'CHEMIN\vers\php\php.exe'
$env:PHP_INI = 'CHEMIN\vers\php\php.ini'
$env:PORT = '18097'
node 'CHEMIN\sub99\tests\capacite\capacite.mjs'
```

## Ce qui n'est pas fait ou pas démontré

- **Prix** : catalogue serveur appliqué, avec des décisions par défaut à confirmer. **Bloquant tant qu'elles ne sont pas confirmées.**
- **Moitié-moitié du composeur** : décidée, non implémentée (voir « Décisions »).
- **Ruptures par ingrédient et par produit** : faites et testées (API et navigateur).
- **MySQL** : non exécuté sur un vrai serveur OVH. Tests sur MariaDB 11.8 et SQLite.
- **Collision réelle** (deux envois simultanés) : non exercée ; l'idempotence est testée en séquentiel.
- **Expiration des sessions** (12 h sans « rester connecté ») et fin du verrou de 15 min : testées avec l'horloge de test (suite politique), à revérifier sur le sous-domaine.
- **Limitation des connexions** : par adresse IP seulement. Une adresse commune derrière un proxy partagerait le compteur : à vérifier sur OVH (`REMOTE_ADDR`). Le verrou partagé reste un risque accepté et documenté.
- **Idempotence sans `sessionStorage`** : limite relevée par le juge ; repli sur `localStorage` proposé, non fait.
- **Notifications** : alerte dans la page ouverte et notification du navigateur si permise et onglet caché. **Pas de push** : rien n'est affirmé pour l'écran verrouillé ou l'appli fermée.
- **Service worker** : cache non fonctionnel sur les profils neufs de ce poste (voir plus haut).
- **Impression** : `window.print()` seulement ; SUNMI non connecté, non testé.
- **Réinitialisation du mot de passe client** : en ligne de commande seulement ; pas d'e-mail.
- **Téléphone** : modifiable depuis « Mes informations » (testé en navigateur).
- **Paquet** : protections `.htaccess`, `Options -Indexes`, redirection `/tirage-au-sort` (404 attendu sur Apache) et validation HTTPS non testées (Apache seulement) ; dossier vide `assets/img/placeholders` à créer à la main sur le serveur.

## Étapes avant publication

1. Confirmer le catalogue (décisions par défaut) : seul point bloquant pour une commande réelle.
2. Commit complet par la session parente, sans push ; puis confirmation de l'utilisateur avant de pousser (dépôt public).
3. Revalider les éléments non figés : publication des gagnants, noms des avis, galerie, composeur.
4. Implémenter la moitié-moitié du composeur, sur demande, après le commit.
5. Coordonner la mission disponibilité, puis tester le menu avec l'API de disponibilité.
6. Relancer les suites, la capacité et le juge sur la version finale ; reconstruire le paquet si le contenu figé change.
7. Déployer sur le sous-domaine avec la checklist ; vérifier sur téléphone réel : son, favori, service worker ; sur le sous-domaine : schéma MySQL réel, `intl`, 403 et 404, redirection `/tirage-au-sort` (404), `.htaccess`, erreurs PHP non affichées, rupture de bout en bout, `REMOTE_ADDR`.
8. Publication : seulement après accord explicite de l'utilisateur.
