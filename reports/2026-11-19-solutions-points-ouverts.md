# Solutions aux points ouverts — état au 19/11/2026

Ce document reprend les points ouverts du rapport de mission et dit, pour chacun : ce qui est fait et vérifié, ce qui reste à faire, et la décision à prendre. Rien n'est publié, rien n'est déployé. Le commit complet est fait par la session parente, sur une nouvelle branche depuis `main`, sans push (voir le rapport de mission).

Rapport de mission : [2026-11-19-espace-commercant-integration.md](2026-11-19-espace-commercant-integration.md) · Contrat : [2026-11-19-espace-commercant-contrat-api.md](2026-11-19-espace-commercant-contrat-api.md) · Mises à jour du contrat : [2026-11-19-contrat-api-mises-a-jour.md](2026-11-19-contrat-api-mises-a-jour.md) · Checklist préproduction : [2026-11-19-preproduction-checklist-utilisateur.md](2026-11-19-preproduction-checklist-utilisateur.md) · Proposition catalogue : [2026-11-19-catalogue-serveur-proposition.md](2026-11-19-catalogue-serveur-proposition.md) · Contrôle du paquet : [2026-11-19-controle-paquet-preproduction.md](2026-11-19-controle-paquet-preproduction.md)

## 0. Vérification finale (19/11/2026)

- **Suites sur l'arbre figé `a31340b2eaba262e6e69da72cec5773c24ec0896`, port 18093** : API 57/57 (une exécution a subi des expirations de boucle locale, deux reprises à 57/57) ; catalogue 26/26 (dont 4 tests de parité par pizza) ; politique 25/25. `--check` : « Catalogue à jour ».
- **Paquet de préproduction reconstruit** depuis cet arbre : 172 fichiers ; `sha256sum -c` : 172 OK ; test sur copie extraite, port 18096 : pages attendues en 200, fichiers absents en 404, API, connexion propriétaire. Les protections `.htaccess` ne sont pas testées (Apache seulement).
- **Parcours navigateur** (lot site client, serveur de test arrêté ensuite) : rupture du jambon affichée « Ingrédient en rupture : jambon » ; commande de quatre articles acceptée et totalisée côté serveur, sans écart de prix ; moitié-moitié en Duo acceptée et suivie ; profil client ; recherche clients en POST.
- **Un contrôle du lot site client a échoué** : « aucune option sur la calzone ». Son auteur l'attribue à son propre test (présence d'un élément masqué). Je ne l'ai pas revérifié à l'écran : **non résolu**.
- **Juge indépendant** (lecture seule, sans les rapports d'avancement) : 9 points sur 10 passent ; le 10e (fichiers de disponibilité intacts) n'est pas vérifiable faute de référence. Détail dans le rapport de mission, « Relectures ».

## 1. Faits et vérifiés

| # | Point | Solution appliquée | Vérification |
|---|---|---|---|
| 1 | `SUBITO_CONFIG` lu en production | Ignoré hors CLI et hors serveur de test (`cli`, `cli-server`) | Suite API, test « SUBITO_CONFIG ignorée » |
| 2 | Limitation des connexions contournable en rafale | Chaque tentative est comptée avant la vérification ; une tentative réussie est retirée (`throttle_refund`). 5 échecs en 15 min → verrou de 15 min, **par adresse IP seulement** (IPv6 : préfixe /64). Aucun verrou par e-mail | Suite API (6 tentatives → 429) ; suite politique (le verrou IP expire après 15 min) |
| 3 | Noms approchés | Rupture : normalisation (caractères de format retirés, séparateurs de garniture, ponctuation finale), « La Calzone » non accepté. Profil : caractères de format retirés, caractères de contrôle remplacés par une espace (**choix à valider**) | Suite API : cinq noms approchés refusés. Profil : relu |
| 4 | Rupture partielle d'une pizza | Remettre « Calzone » en disponible lève aussi la rupture de sa variante | Suite API : commande passée après remise |
| 5 | Mot de passe propriétaire visible à la saisie | Saisie masquée sous Unix quand `stty` existe. Sous Windows, inchangé | Non testé sous Unix (à faire sur le serveur) |
| 6 | Session client conservée après une nouvelle connexion | Une session active par navigateur : la précédente est révoquée | Suite API : l'ancienne session répond 401 |
| 7 | Pas de réinitialisation du mot de passe client | `api/tools/reset_customer.php`, en ligne de commande, révoque les sessions | Suite API : ancien mot de passe refusé, nouveau accepté |
| 8 | Fichiers de sauvegarde servis en clair ; `lib/` et `tools/` protégés seulement par `mod_rewrite` | Règles `.htaccess` élargies ; `api/lib/.htaccess` et `api/tools/.htaccess` (`Require all denied`) ; bloc de protections dans le `.htaccess` racine et dans le paquet | **Non testé ici** (Apache). À vérifier : checklist 7.2 et 7.6 |
| 9 | Mots de passe de test en clair dans le code | Générés à chaque exécution ; un seul point d'entrée (`SUBITO_TEST_PORT`, puis `PORT`). Aucun mot de passe de test dans le dépôt (contrôle du 19/11) | Recherche dans le dépôt : aucune occurrence |
| 10 | Deux harnais de test lisent deux variables différentes | Une variable de port commune, documentée dans l'API README | Relu |
| 11 | Paquet : chemins avec antislashs, manifeste mal encodé | Archive avec barres obliques (0 antislash) ; manifeste UTF-8 sans BOM, fins de ligne LF, format `sha256sum` | Reconstruit : `sha256sum -c` 172 OK ; archive extraite 172 OK |
| 12 | Copie de préproduction en retard sur le dépôt | Paquet reconstruit depuis la version figée `a31340b2…` (contenu du site, hors `reports/`) ; concours, README et `subito-popup/` exclus | Test sur le port 18096 : pages, absences, API, connexion propriétaire |
| 13 | Préproduction indexable | `robots.txt` en `Disallow: /`, `X-Robots-Tag: noindex, nofollow`, redirection HTTP vers HTTPS (paquet seulement) | Relu dans le paquet ; à vérifier sur le sous-domaine (checklist 7.4) |
| 14 | Modèle de configuration | Espaces réservés « À REMPLACER », `cookie_secure` à vrai, aucun secret | Relu |
| 15 | Procédure de déploiement | Checklist avec commandes exactes : archive et manifeste, reconstruction, 403, 404, 301, `noindex`, test sur téléphone | Document, mis à jour le 19/11 |
| 16 | Son d'alerte sans fin ni coupure | Arrêt après 30 s, bouton « Couper le son », rétablissement à chaque nouvelle commande | **Testé** : 18 bips puis silence à 28,8 s ; coupure et réactivation |
| 17 | Recherche clients par `GET` (donnée personnelle dans les journaux) | `POST` seul, en JSON `{q}` ; un `GET` renvoie 405 | Suite politique ; recherche testée dans l'espace commerçant |
| 18 | Échange d'ingrédients : une portion | **Décision de l'utilisateur : une portion par pizza.** Comportement actuel conservé, 4 tests de parité ajoutés. Variante « par ligne » codée puis retirée | Suite catalogue : 26/26 |

## 2. En cours, implémenté ou ouvert

| # | Point | État |
|---|---|---|
| 19 | Service worker | Enregistrement OK sur `/commercant/` (portée, état activé, page contrôlée). Le **cache** échoue sur les profils neufs de ce poste (« Failed to execute 'open' on 'CacheStorage' »), y compris pour `/robots.txt` : défaillance du stockage Chrome de ce poste, pas du code. L'installation tolère l'échec. **À vérifier sur un vrai téléphone** |
| 20 | Son d'alerte | **Testé** : arrêt après 30 s, coupure et réactivation, retour du son à une nouvelle commande, focus clavier |
| 21 | En-tête à 375 px ; carte blanche vide sous « En attente de commande » | **Corrigé et vérifié** à 375, 768 et 1024 px |
| 22 | Ruptures par ingrédient et par produit (ex-B) | **Fait et testé** : l'API refuse la ligne si un ingrédient fixe, la garniture choisie ou un supplément est en rupture (`unavailable_ingredients`) ; le navigateur affiche « Ingrédient en rupture : jambon » |
| 23 | Catalogue serveur des prix (ex-A) | **Implémenté** : `api/data/catalogue.json` généré depuis les pages ; chaque ligne est recalculée ; un écart de prix est refusé (`price_mismatch_line`) ; le ticket reçoit le nom du catalogue. **Les prix, promotions, minimums et frais de livraison sont des décisions par défaut à confirmer** (§3, A) |
| 24 | Téléphone non modifiable après inscription (ex-M) | **Fait et testé** : `api/customer_update_profile.php` et « Mes informations » dans « Mon compte » |
| 25 | Idempotence si `sessionStorage` est bloqué | **Ouvert** (relevé par le juge indépendant) : sans `sessionStorage`, une actualisation crée une nouvelle clé, donc un doublon est possible dans ce cas précis. Correctif proposé : repli sur `localStorage`. **Non fait** : le code client n'a pas été retesté |
| 26 | Calzone : contrôle « aucune option » | **Échec du contrôle, non résolu** (voir §0) |
| 27 | Moitié-moitié du composeur | **Décidée** (à partir de Duo, comme le menu ; ni en Solo ni sur la calzone). **Non implémentée** : la page composeur n'a ni liste de parfums ni option. À implémenter après le commit, sur demande |

## 3. Décisions (vous)

| # | Point | Ce que je recommande | Ce qu'il faut décider | État |
|---|---|---|---|---|
| A | Catalogue serveur : prix et règles | Garder les décisions par défaut, et les confirmer une fois pour toutes | Confirmer les décisions par défaut (proposition catalogue, « Reste à confirmer ») et les prix tels qu'affichés | **Bloquant** pour une commande réelle |
| B | Ruptures par ingrédient | — | — | Fait (§2, 22) |
| C | Verrouillage du propriétaire | Verrou par adresse IP seulement, sans verrou par e-mail ; une réussite n'est pas comptée | Confirmer cette politique | Fait, à confirmer |
| D | Notifications push (écran verrouillé, appli fermée) | Plus tard : clés VAPID (gratuites), abonnements, envoi côté serveur, service worker, test sur téléphone réel (2 à 3 jours). En attendant : alerte dans la page ouverte, et notification du navigateur si l'onglet est caché | Faut-il le push maintenant ? | Non fait |
| E | Impression (SUNMI) | Tester l'imprimante du commerce via le pilote système (impression du navigateur). Un SUNMI demande une application Android dédiée, hors périmètre | Quel matériel au restaurant ? | Non fait |
| F | Son : rétablissement à chaque nouvelle commande | Garder : une commande ne doit jamais passer inaperçue | Confirmer, ou limiter le rétablissement au clic suivant | Fait, à confirmer |
| G | Conservation | Ne rien supprimer : commandes et comptes conservés | Confirmer | Décision |
| H | Adresse de l'espace commerçant | `/commercant/` provisoire, sans secret dans l'adresse | Garder ou changer | Décision |
| I | Compte employé | Non créé (un seul compte propriétaire est demandé) | Créer ou non | Décision |
| J | `subito-popup/` dans le paquet | **Décidé par le responsable (19/11)** : hors du paquet. Le dossier reste dans le dépôt | — | Fait |
| K | Réinitialisation du mot de passe par e-mail | Demande un service d'envoi (coût éventuel) | Oui ou non, et quel service | Non fait (ligne de commande seulement) |
| L | Recherche clients par `GET` | — | — | Fait : `POST` seul (§1, 17) |
| M | Téléphone non modifiable | — | Choix à valider : espace (et non suppression) pour les caractères de contrôle des noms | Fait (§2, 24) |
| N | Mission « disponibilité » : fichiers non commités | Coordonner avec la session disponibilité, puis commiter `assets/data/disponibilite.json`, `assets/js/disponibilite.js`, `assets/css/disponibilite.css`, `menu.html` (qui mélange disponibilité et d'autres changements) et les deux rapports de disponibilité | Inclure ou non, et quand | **En attente** : sans ces fichiers, le menu ne lit pas l'API de disponibilité |
| O | Paquet de préproduction | **Fait** : 172 fichiers, reconstruit depuis `a31340b2…`, manifeste vérifié, test sur le port 18096. À refaire si le contenu figé change | — | Fait |
| P | Éléments non figés : publication des gagnants du concours (question en cours), noms des avis et galerie (modifiés, à valider), composeur (décidé, à implémenter) | Ne pas publier en l'état : revalider chaque élément avant publication | Valider chaque élément | **En attente** (responsable) |
| Q | Commit complet et push | Commit fait par la session parente, sur une nouvelle branche depuis `main`, sans push | Push : oui ou non, et quelle branche | **Commit fait (à confirmer)** ; push en attente |
| R | Moitié-moitié du composeur | Implémenter après le commit : choix de la deuxième moitié sur `composer.html`, règle de prix, validation serveur, tests | Lancer l'implémentation, sur demande | Décidé, non implémenté |
| S | Échange d'ingrédients | Une portion par pizza, comme aujourd'hui ; quatre tests de parité | — | **Décidé et en vigueur** |
| T | Modifications hors mission (liste du contrôle) | Justifiées par rapport de référence dans le rapport de mission, « à confirmer par le responsable » ; `cdp.mjs` justifié comme helper partagé ; références git non annulées | Confirmer par chaque responsable de chantier | En attente (responsables) |

## 4. À faire ensuite (sans décision de votre part)

1. **Service worker et favori** : vérifier sur un vrai téléphone en préproduction (checklist 7.5).
2. **Juge indépendant** : fait le 19/11 (rapport de mission). À relancer après les prochaines modifications de code.
3. **Sur le sous-domaine** (checklist) : exécuter le schéma sur MySQL réel, vérifier `intl`, les 403 et 404 (dont `tirage-au-sort`), le `.htaccess` (7.0 et 7.6), les erreurs PHP non affichées, une rupture de bout en bout, et `REMOTE_ADDR` (si toutes les connexions arrivent avec l'adresse d'un proxy, un verrou touche tout le monde).
4. **Expiration des sessions et du verrou** : testée dans la suite politique, avec l'horloge de test (verrou de 15 min ; session propriétaire de 12 h sans « rester connecté »). À revérifier sur le sous-domaine.
5. **Collision réelle** (deux envois simultanés) : non exercée. À tester sur MySQL réel.
6. **Idempotence sans `sessionStorage`** (§2, 25) : repli sur `localStorage` à coder, puis à retester.
7. **Opération git distante non documentée** (`origin/HEAD`, `FETCH_HEAD`, 11:19) : identifier son auteur et le signaler à l'utilisateur. Rien n'est annulé sans accord.
8. **Capacité** : la dernière mesure propre date de 10:33, avant les changements de l'après-midi. À relancer sur la version finale, et sur l'hébergement seulement après accord, avec données synthétiques.

## 5. Ordre recommandé

1. Décider A (catalogue) : c'est le seul point qui bloque une commande réelle.
2. Confirmer le commit fait par la session parente, puis décider Q (push).
3. Revalider P (gagnants, avis, galerie, composeur), décider R (implémentation du composeur, sur demande), puis C, F, N et le reste selon vos priorités.
4. Déployer sur le sous-domaine avec la checklist, puis faire la section 4.
5. Publier seulement après accord explicite.
