# Mission — Reprise du site : disponibilité des pizzas côté client (étape 1)

Statut : **livré en local, rien commité.** Vérifications faites (voir plus bas). Verdict du juge sur l'état final : PASS (lecture logique), rendu avant le dernier changement décrit plus bas. Décisions de l'utilisateur : D1 et D2 tranchées (pizzas commandables, appliqué) ; D3, D4 et D5 restent ouvertes.

## Demande

Première étape de la reprise du site Subito Pizza Hénin-Beaumont (dépôt `sub99`) : afficher la disponibilité des pizzas côté client, sans backend. Source : un fichier statique `assets/data/disponibilite.json`, mis à jour à la main pour l'instant.

Règles (cadrage du 19/11/2026, [reports/2026-11-19-reprise-site-cadrage.md](2026-11-19-reprise-site-cadrage.md)) :
- une pizza indisponible (pizza listée, ou ingrédient fixe indisponible) reste visible, grisée, avec la mention « Victime de son succès » et la sous-ligne « Elle se repose un moment. Revenez très vite. » ; elle n'est plus commandable, ni directement, ni comme deuxième moitié ;
- garniture au choix (Calzone) : seule la garniture indisponible disparaît du choix ; la Calzone reste commandable tant qu'une garniture reste ;
- le mot « rupture » n'apparaît jamais côté client ;
- la tablette commerçant (`commercant/`) ne change pas ; `assets/js/cart.js` n'est pas modifié par cette étape.

Demandes faites pendant la mission :
- le visuel doit suivre le thème du site (couleurs, police manuscrite Caveat, pastille rouge) ;
- le pansement est retiré ; « Victime de son succès » devient un bandeau rouge, en gros, en travers de la photo.

Hors périmètre (tenu) : composer.html, vegetarien.html, produits non-pizza, suppléments, backend, tablette commerçant.

## Ce qui a été fait

Fichiers créés :
- `assets/data/disponibilite.json` : source. Listes vides = tout disponible. Commentaire d'usage dans le fichier.
- `assets/js/disponibilite.js` : lecture de la source, noms tolérants, garde-fous de racine et de clé, retrait des boutons des pizzas indisponibles, bandeau, Calzone, moitiés-moitiés, avertissements console.
- `assets/css/disponibilite.css` : boutons masqués tant que la disponibilité n'est pas lue, carte grisée, bandeau rouge, sous-ligne. Aucune animation ni délai.

Fichier modifié :
- `menu.html`, trois lignes ajoutées par cette étape : le lien vers `disponibilite.css` (ligne 27) ; un petit script inline qui écoute les erreurs de la fenêtre et pose la classe `dispo-echec` si l'erreur vient de `disponibilite.js` (ligne 32) ; le script `disponibilite.js` en `defer`, avec l'attribut `onerror` qui pose la même classe si le fichier ne se charge pas (ligne 33). Ce fichier porte aussi des modifications d'autres missions (git : un diff de 179 lignes, 19 ajoutées et 160 supprimées, par rapport au commit, dont `account.js`, `icons.js` et la navigation « Mon compte »). Elles ne viennent pas de cette étape.

Non modifiés par cette étape :
- `assets/js/cart.js` : cette étape ne l'a jamais écrit ; elle ne l'a que lu (aucune écriture de cette étape dans l'historique de la session). Il porte des modifications d'autres missions du même jour (les rapports `calzone-garniture-paiement-recap`, `emoji-vers-icones-svg` et `commande-livraison-reelle` en décrivent). Il est encore réécrit par d'autres sessions pendant ce travail (horodatages observés entre 03:39 et 03:45) : les essais navigateur de cette étape ne garantissent donc pas la version finale de `cart.js`.
- `commercant/` : cette étape n'y a jamais écrit. Ce dossier n'est pas suivi par git : aucune base de comparaison. D'autres sessions y écrivent pendant ce travail (`commercant/index.html` à 03:44, `assets/js/commercant.js` à 03:48, horodatages observés) : ces modifications ne viennent pas de cette étape.
- `composer.html`, `vegetarien.html` : ne chargent ni le script ni la feuille de style.

## Choix pris (à valider)

1. Source en JSON, mise à jour à la main (défaut du cadrage).
2. Sous-ligne « Elle se repose un moment. Revenez très vite. » conservée.
3. Pansement retiré à la demande de l'utilisateur. Bandeau rouge en Caveat, pleine largeur, taille liée à la largeur de la carte (unités cqi, facteur 0,12) : une seule ligne mesurée de 224 à 335 px.
4. Badge « Notre signature » masqué sur une pizza indisponible.
5. Noms tolérants : casse, accents, apostrophes typographiques et « œ » ignorés ; « Calzone » vaut pour « Calzone (soufflée) ».
6. Boutons pizza masqués tant que la disponibilité n'est pas lue, sans délai. Repli : si le fichier du script ne se charge pas ou ne s'exécute pas (erreur de chargement, erreur de syntaxe), les boutons redeviennent visibles, sans retrait (décision D2, tranchée : commandables).
7. Fichier de disponibilité illisible ou invalide : toutes les pizzas restent commandables, avec un avertissement dans la console (décision D1, tranchée : commandables).

Ajouts non demandés, relevés par le juge comme mineurs et cohérents : les avertissements console, la tolérance des noms (conséquence de la contestation), le badge « Notre signature » masqué (choix 4).

## Décisions (D1 et D2 tranchées par l'utilisateur ; D3 à D5 à trancher)

**D1. Fichier `disponibilite.json` illisible ou invalide.** Décision de l'utilisateur : commandables (appliqué). Toutes les pizzas restent commandables, avec un avertissement dans la console.

**D2. Fichier `disponibilite.js` absent, en échec réseau (404, erreur réseau, type MIME refusé), ou qui ne s'exécute pas (erreur de syntaxe, exception au chargement).** Décision de l'utilisateur : commandables (appliqué). Les boutons restent visibles, sans retrait, pour toute la visite. Pour l'erreur de syntaxe et l'exception au chargement, l'écouteur d'erreurs de la fenêtre pose la même classe ; testé dans le navigateur (E25).

**D3. Source qui ne répond jamais.** Aujourd'hui, les boutons restent masqués, sans délai ni message ; une erreur HTTP sur la source, elle, les affiche sans retrait. Alternatives : un délai maximal puis affichage (ce qui rouvre une fenêtre pour une source lente) ; ou une politique unique pour les deux cas. Question à trancher : si la source ne répond jamais, faut-il rester masqué (actuel), ou afficher les boutons après un délai maximal ? Conséquence de la politique actuelle : un client dont la source ne répond jamais ne voit aucun bouton de commande pizza ; une source en erreur (404, JSON invalide) laisse au contraire les boutons visibles, sans retrait.

**D4. Règle de correspondance des ingrédients.** Aujourd'hui, l'ingrédient doit être écrit comme sur la carte. Cas non reconnus, relevés par vérification : « curry » et « barbecue » ne bloquent pas « Base crème fraîche/curry » ni « Base barbecue » ; « chèvre » ne bloque pas « fromage de chèvre » (Chèvre miel, Normande, Fajitas) ; « saumon » ne bloque pas « saumon fumé » (Pacifico, Venezia) ; « œuf » ne bloque pas « jaune d'œuf » (Calzone). Alternative : une correspondance plus large, avec un risque de faux positifs (« saumon » bloquerait « saumon fumé », ce qui peut être voulu ou non ; « œuf » bloquerait la Calzone).

**D5. Panier déjà rempli.** Une pizza ou une garniture ajoutée au panier avant sa mise en indisponibilité reste commandable. `cart.js` est hors périmètre de cette étape ; à traiter à l'étape suivante, après décision.

## Écarts connus (non couverts par cette étape)

- Suppléments du panneau de personnalisation : un ingrédient indisponible peut encore être ajouté en supplément sur une autre pizza.
- `composer.html` et `vegetarien.html` : non filtrés. `vegetarien.html` charge `cart.js` et affiche des boutons pizza, sans disponibilité appliquée.
- Produits non-pizza (pâtes, salades, desserts, boissons, wings) : non filtrés.
- Parcours de commande et de compte (`commande.js`, `order-launch.js`, `compte.js`) : ils ne contiennent aujourd'hui aucune liste de pizzas à filtrer ; à revoir si ces parcours évoluent.
- Avertissements : seulement dans la console du navigateur, que le gérant ne voit pas. Un contrôle visible du fichier reste à prévoir (question liée à D1).
- Contrôle serveur : à l'étape backend.
- Pizza indisponible (carte grisée) : la liste complète des ingrédients reste affichée, comme la fiche de la recette.
- Constaté, hors disponibilité : `compte.html` appelle `/api/customer_me.php`, absent du projet (404). Non corrigé.

## Vérifications

Vérifié :
- Syntaxe : `node --check` sur `disponibilite.js` : OK sur la version finale (relu pendant la vérification finale).
- JSON : lecture et parse OK ; listes vides ; quatre clés attendues.
- Navigateur, serveur de cette session (port 8092) :
  - fonctionnement normal : 30 pizzas visibles, aucune animation, aucune pizza marquée indisponible ;
  - source en attente : boutons masqués, sans délai ;
  - échec de chargement du script, simulé avec le même attribut `onerror` : boutons visibles, état restauré ensuite ;
  - `menu.html` : 67 références du même site répondent 200 ou 206 ; aucune ressource en échec ; aucune 404 dans la console de l'onglet ;
  - erreurs de script (dernier changement) : une erreur de syntaxe dans un script nommé `autre-script.js` ou `disponibilite.json` ne change rien ; dans un script dont le chemin contient `/assets/js/disponibilite.js` (script de données, fichier livré non altéré), `dispo-echec` est posée et les boutons deviennent visibles.
- Journal e2e détaillé : [reports/e2e-reprise-site-disponibilite.md](e2e-reprise-site-disponibilite.md) (E1 à E25).
- Contestation adverse :
  - passe 1 : objection bloquante sur l'appariement des noms, traitée (normalisation, « Calzone », avertissements) ; mineures 1, 3, 4 et 5 traitées ; mineures 2, 6 et 7 non traitées (hors périmètre ou cosmétiques) ;
  - passe 2 : aucune objection bloquante sur le code de l'époque ; mineures traitées (garde-fou de racine, clé inconnue, facteur 0,12) ;
  - vérification ciblée du filet de sécurité, première version (délai de 8 s) : deux objections bloquantes, B1 (une fenêtre où les boutons sont visibles avant le marquage des cartes, si le script arrive après 8 s) et B2 (aucune borne sur l'attente de la source). B1 est corrigée par la suppression du délai ;
  - vérification ciblée de la version actuelle : B1 est fermée, aucune nouvelle fenêtre temporelle. Reste le cas de D2, qui relève d'une décision ;
  - vérification ciblée de l'écouteur d'erreurs de la fenêtre (dernier changement, `menu.html` avant le script) : acceptable. Pas de faux positif au chargement normal, pas de fenêtre temporelle, pas d'effet sur les autres pages, pas de réaffichage à tort après `dispo-pret`. Mineure traitée : le filtre vise désormais le chemin `/assets/js/disponibilite.js` (et non la sous-chaîne `disponibilite.js`), testé. Rappels : B2 reste ouvert (D3) ; m1 non traité ; autres navigateurs non vérifiés (voir « Non vérifié »).
- Vérification indépendante par workflow (six agents, dont trois refuteurs) sur la version précédente des rapports : le constat bloquant de la lecture lente au-delà de 8 s a été confirmé, puis corrigé ; la correspondance stricte des ingrédients a été confirmée (D4) ; deux affirmations inexactes ont été corrigées (le filet « cachés pendant la lecture », et la liste de pizzas de `compte.js`, `commande.js`, `order-launch.js`) ; les affirmations invérifiables par git (cart.js, menu.html, commercant/) ont été reformulées.
- Deuxième vérification indépendante des rapports finaux : deux agents ont relu chaque affirmation vérifiable contre le code et le dépôt, puis quatre refuteurs ont examiné les affirmations jugées inexactes. Trois inexactitudes sont confirmées et corrigées (horodatages de `cart.js` et de `commercant/`, conséquence de D3). Le libellé « carte retirée » est exact au sens du projet, mais ambigu : il est remplacé par « pizza indisponible (carte grisée) ». Deux inexactitudes du journal e2e (facteur 0,13, formulation sur `onerror`) sont corrigées, sans refuteur, car les fichiers et le texte les tranchent. Les mesures de navigateur, les captures et les décisions ne sont pas vérifiables par lecture.
- Juge (état final) : PASS. Le juge a vérifié les exigences 1 à 7 sur le code livré (fichiers et lignes cités dans son rapport) et n'a relevé aucun ajout non demandé majeur. Il n'a pas pu comparer `cart.js` ni `commercant/` à une version antérieure, et n'a pas vérifié le rendu réel ni la durée d'un téléchargement lent. Il rappelle que D2 est le cas le plus sensible : il va dans le sens inverse de l'exigence 2 si le fichier du script échoue. Les décisions D1 à D5 sont des politiques à confirmer, pas des échecs.

Non vérifié :
- Le comportement réel d'un téléchargement lent, et celui d'une erreur 404 ou d'un type MIME refusé, avec un vrai serveur lent : mécanisme standard du navigateur, non reproduit à l'échelle d'un réseau réel.
- Le rendu du bandeau aux largeurs non mesurées ; mesuré à 224, 284, 291, 320 et 335 px seulement.
- Le cas d'un vrai fichier `disponibilite.js` contenant une erreur de syntaxe : non reproduit sur le fichier livré (test avec un script de données dont le nom contient `disponibilite.js`). Le navigateur fournit bien le nom du fichier fautif pour ce type d'erreur, ce qui fonde le test.
- Une éventuelle Content-Security-Policy de l'hébergeur, qui pourrait bloquer le gestionnaire `onerror` : le dépôt n'en définit aucune, mais l'hébergement ne se voit pas depuis le dépôt.
- L'affichage sur un vrai téléphone : non testé.
- Le fonctionnement complet de `cart.js` : seulement lu pour ses dépendances, non revérifié.
- L'état final de `cart.js` et de `commercant/`, modifiés pendant ce travail par d'autres sessions : les essais navigateur ne le couvrent pas.

## État du dépôt

- Dépôt git : `sub99`, commit `1770177`. Rien n'a été commité par cette étape.
- Fichiers de cette étape, non suivis par git : `assets/js/disponibilite.js`, `assets/css/disponibilite.css`, `assets/data/disponibilite.json`, `reports/2026-11-19-reprise-site-disponibilite.md`, `reports/e2e-reprise-site-disponibilite.md`.
- Fichier suivi modifié par cette étape : `menu.html` (deux lignes), parmi d'autres modifications d'autres missions.
- `cart.js` et `commercant/` : non écrits par cette étape.
- Un dossier `tests/` non suivi (auteur non établi) contient un test e2e (`tests/e2e/parcours-commande.mjs`, test T14) qui, d'après sa lecture, attend un comportement différent du code livré sur le panier (D5). Ce test n'a pas été exécuté ici.
- `api/_phpinfo.php` et `api/_dbtest.php` restent présents : à retirer avant la mise en ligne, avec l'accord de l'utilisateur.

## Suite proposée

1. Trancher D3, D4 et D5.
2. Suppléments, `composer.html`, `vegetarien.html`, produits non-pizza ; puis revalidation du panier, après la décision D5.
3. Étape backend : validation côté serveur ; une API remplace le fichier.
