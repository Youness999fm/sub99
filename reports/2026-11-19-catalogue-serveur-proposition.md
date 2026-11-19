# Catalogue serveur des prix — proposition (non appliquée)

Date : 2026-11-19 · Statut : **proposition à valider par le propriétaire**. Rien n'a été appliqué, aucun prix n'a été modifié ni inventé. Les montants cités sont ceux lus dans le site.

## 1. Le problème constaté

`api/order_create.php` calcule le total à partir des prix unitaires envoyés par le navigateur : le calcul à la ligne 55 utilise `$o['items']`, la comparaison à la ligne 70 ne vérifie que le total envoyé par le client, et la ligne 107 enregistre `unit_price_cents × qty` sans les comparer à la carte. Le serveur ne connaît donc aucun prix de référence. Un client qui modifie la requête peut commander à un prix quelconque, et la commande est acceptée (test à faire pour le démontrer ; la lecture du code suffit à l'établir).

Les tarifs sont aujourd'hui répartis en trois endroits du site :

| Source | Où | Ce qu'elle donne |
|---|---|---|
| Taille des pizzas | `menu.html`, lignes 166 à 184 (`.size-chart__item`) | Solo 11,00 €, Duo 16,00 €, Quatro 23,00 €, XXL 33,00 € |
| Prix par catégorie | `menu.html`, lignes 472, 513, 578, 619 (`.menu-category__price-note`) | Pâtes : 8,50 € (spaghettis ou tagliatelles) et 6,00 € (tomate ou crème) ; une catégorie à 7,50 € ; Tex-Mex : « Au choix » (pas de prix) |
| Prix par article | `menu.html`, lignes 668 à 730 (`.menu-item__price`, 7 articles de la section Desserts) | 3,50 €, 6,50 €, 3,00 €, 1,50 € |
| Suppléments | `supplements.html`, lignes 83 à 101 (`.compose-price-row`) | Deux groupes, un prix par taille (voir section 3) |
| Zones de livraison | `assets/js/cart.js`, lignes 175 à 183 (`DELIVERY_ZONES`) et `api/lib/util.php`, lignes 8 à 17 | Minimum et frais par ville, déjà dupliqués dans deux fichiers |

Le navigateur lit ces prix dans le DOM (`cart.js`, `readSizeChart` ligne 508, `priceFromCategoryNote` ligne 494, `.menu-item__price` ligne 572). Le serveur, lui, ne lit rien.

## 2. Mécanisme proposé

1. **Source unique, versionnée.** Un script de génération, `tools/build-catalogue.mjs` (Node, sans dépendance), lit `menu.html`, `supplements.html` et `composer.html`, puis écrit `api/data/catalogue.json` : produits (nom, catégorie, prix par taille ou prix fixe), groupes de suppléments (ingrédients et prix par taille), zones. Le fichier est committé, donc relisible et comparable.
2. **Refus des prix qui ne correspondent pas.** Dans `order_create.php`, avant le calcul, chaque ligne est vérifiée :
   - prix attendu d'une pizza = prix de la taille (catalogue) + Σ des suppléments attendus × quantité ;
   - prix attendu d'un autre article = prix du catalogue × quantité ;
   - tout écart d'un centime refuse la commande avec `422 price_mismatch_line` (et l'index de la ligne), sans rien enregistrer ;
   - un nom absent du catalogue donne `422 unknown_item`.
3. **Suppléments et remises de substitution.** Le calcul des suppléments doit reprendre la règle `applySwapDiscount` de `cart.js` (ligne 634), qui modifie le prix d'un supplément lorsqu'un ingrédient du même groupe est retiré. La règle doit être transposée en PHP et testée sur les mêmes paniers.
4. **Le navigateur ne change pas de comportement** : il affiche les mêmes prix, il envoie les mêmes lignes. Le serveur devient seul juge.
5. **Une seule source pour les zones** : le serveur lit le catalogue (au lieu de sa copie dans `util.php`), et un test vérifie que `cart.js` et le catalogue donnent les mêmes minimums et frais.

## 3. Points que seul le restaurant peut confirmer

- **Prix Tex-Mex** : la catégorie n'a que la mention « Au choix » (ligne 578). Les articles ont-ils un prix individuel ? Sans réponse, ils ne peuvent pas être commandés.
- **Suppléments** : les noms des groupes portent des astérisques (`supplements.html`, ligne 96 : « Viande hachée*, mortadelle*, merguez*, chorizo*, kebab*, jambon*, lardons*, poulet* »). Leur signification n'est pas indiquée dans la page : à confirmer, il ne faut pas la deviner.
- **Calzone et garniture au choix** : la garniture est dans le nom de la ligne ; son prix doit être confirmé comme celui de la taille, sans supplément.
- **Moitié-moitié** : le prix est-il celui de la taille, sans supplément ? À confirmer (le code l'indique, la page ne le dit pas).
- **Articles sans prix** : toute ligne sans prix dans le catalogue doit être refusée, jamais acceptée à 0 €.
- **Changement de prix** : le catalogue doit être régénéré à chaque modification de `menu.html`, et un test doit signaler un écart entre le fichier généré et les pages.

## 4. Tests proposés

- **Cohérence catalogue ↔ pages** : régénérer le catalogue et comparer au fichier committé (échec si différence).
- **Parité navigateur ↔ serveur** : un corpus de paniers (tailles, suppléments, substitutions, moitié-moitié, promos, livraison, minimum) est calculé par `cart.js` et par le serveur ; les totaux doivent être identiques au centime.
- **Négatifs** : un prix faux d'un centime, un supplément au prix modifié, un article inconnu, un article sans prix, une taille inconnue : chacun refusé, rien enregistré.
- **Positifs** : chaque article du catalogue est commandable au prix affiché.
- **Régression** : la suite API existante (51 tests) reste verte.

Effort estimé : deux à trois jours de travail, dont la transposition de la règle de substitution. Le test de parité est le plus long.

## 5. Décisions à prendre (propriétaire)

1. Valider la liste des prix du catalogue tels qu'ils figurent dans les pages (aucun prix n'est inventé ici).
2. Répondre aux points de la section 3 (Tex-Mex, astérisques, calzone, moitié-moitié).
3. Choisir entre garder `menu.html` comme source (génération) ou déplacer les prix dans un fichier de données lu à la fois par le site et par le serveur. Le deuxième choix est plus sûr à long terme, mais demande de modifier les pages.
4. Accepter qu'une modification de prix ne soit prise en compte qu'après régénération.

Tant que ces points ne sont pas tranchés, la commande en ligne ne doit pas être ouverte à de vrais clients : un client qui modifie la requête peut payer le prix qu'il veut.

## 6. Décisions appliquées par défaut (mise en œuvre du 19/11/2026)

Mise en œuvre : `tools/build-catalogue.mjs` (génération, lecture seule des pages), `api/data/catalogue.json` (généré), `api/data/.htaccess` (accès direct refusé), `api/lib/catalogue.php` (`verify_line_prices`, `check_availability_lines`), appel dans `api/lib/orders.php` (`order_enforce_catalogue`) et `api/order_create.php` (après la clé d'idempotence et la limitation de débit, avant le profil, l'adresse, les totaux et la comparaison). Tests : `tests/api/catalogue.test.mjs`. Aucun prix inventé : tout est lu dans les pages (et, pour les zones, les libellés de catégorie et le nom de la base composée, dans `assets/js/cart.js`, ce que le navigateur utilise réellement).

Correction de la section 1 : les pâtes sont à 8,50 € (note « Spaghettis ou tagliatelles — 8,50 € »), les subitowichs à 6,00 € (note « Tomate ou crème fraîche — 6,00 € »), les salades à 7,50 €. Le tableau de la section 1 attribuait les deux prix aux pâtes.

Décisions du propriétaire reçues le 19/11/2026 (elles remplacent les choix par défaut) :

| Point | Décision appliquée |
|---|---|
| Grilles (tailles, composer, suppléments) | Validées telles qu'affichées ; lues dans les pages. |
| Tex-Mex | 5,00 € par article (titre « Nos Tex-Mex à 5 € » ; « Au choix » se lit avec le titre). C'est aussi la règle de `cart.js` (`priceFromCategoryNote` : note, sinon titre). Commandable. |
| Astérisques | Retirées par le propriétaire de `supplements.html` et `composer.html` ; le générateur lit les noms sans astérisque et retire une astérisque résiduelle ; le serveur compare les suppléments sans casse ni astérisque finale. |
| Calzone | Prix de la taille ; garniture au choix gratuite ; garniture obligatoire dans le nom de ligne (« Calzone (soufflée) — Thon »), sinon `unknown_item`. |
| Moitié-moitié | Prix de la taille ; Duo, Quatro, XXL seulement ; jamais sur la calzone (ni la base composée) : `422 validation`, champ `items[i].half`. La calzone n'est jamais une deuxième moitié (`unknown_item`). |
| Prix de catégorie | Pâtes 8,50 €, subitowichs 6,00 €, salades 7,50 €, même prix pour chaque plat (test sur les sections de `menu.html`). |
| Livraison, minimum, promotions | Règles serveur inchangées (frais sans pizza, offerte avec pizza, minimum sur les produits après promotion, paires du plus cher au moins cher), testées avec les prix du catalogue. |
| Billets (espèces) | Hors catalogue. |
| `vegetarien.html` | Test : grille des tailles identique à `menu.html`, pizzas présentes au catalogue avec les mêmes ingrédients. |

Décisions par défaut, à confirmer :

1. **Substitution** : `applySwapDiscount` reproduit à l'identique (un retrait d'un groupe rend gratuit le premier supplément suivant du même groupe, ligne entière quelle que soit sa quantité). Seuls comptent les retraits d'ingrédients présents sur la pizza (ou sa deuxième moitié), une fois chacun : le navigateur ne peut pas en envoyer d'autres. Décision par défaut, à confirmer.
2. **Ingrédient fixe en rupture** : bloque la ligne même si le client l'a retiré (même règle que la carte, `disponibilite.js`). Le nom renvoyé dans `unavailable` est celui de la pizza (ou de la deuxième moitié) ; pour une garniture, le nom de ligne complet ; pour un supplément, le nom du supplément. Décision par défaut, à confirmer.
3. **Boissons** : la liste « ingrédients » est une liste de parfums ; la rupture d'un parfum ne bloque pas l'article (`ingredients_checked: false`). Décision par défaut, à confirmer.
4. **Correspondance des noms** : mêmes clés que la disponibilité (casse, accents, parenthèse finale), jamais approximative ; « La Calzone » est inconnue. Décision par défaut, à confirmer.
5. **Zones** : copiées de `cart.js` dans le catalogue ; un test exige l'égalité avec `DELIVERY_ZONES` de `util.php`. Le serveur lit toujours `util.php` (fichier non modifiable dans ce lot). Décision par défaut, à confirmer.
6. **Composer** : la ligne s'appelle « Marguerita (base) » (nom fixe écrit dans `cart.js`, lu par le générateur), prix de `composer.html` (9,00 / 13,00 / 17,50 / 25,50 €). Le nom est stable ; en revanche le choix de base « sauce tomate ou crème fraîche » affiché par la page n'est ni proposé ni transmis par le navigateur. Décision par défaut, à confirmer.
7. **Suppléments** : uniquement sur une pizza (sinon `unknown_item`) ; prix attendu de chaque supplément vérifié en plus du prix unitaire.

Écarts relevés entre `cart.js` et les pages (non corrigés côté serveur) :

- Substitution sur une quantité : `applySwapDiscount` rend gratuit tout le supplément, quelle que soit sa quantité (`qty`). Le navigateur envoie toujours `qty = 1`, mais une requête modifiée avec `qty = 10` obtient dix portions gratuites pour un seul retrait. Reproduit à l'identique ; à trancher.
- Noms qui ne se correspondent pas entre fiches et suppléments : « fromage de chèvre » (fiches) / « chèvre » (suppléments), « reblochons » (Savoyarde) / « reblochon », « saumon fumé », « oeuf », « jaune d'œuf » absents des groupes. Retirer ces ingrédients ne donne aucun crédit de substitution.
- Base composée : le choix sauce tomate / crème fraîche n'est pas transmis.

Corrections après contre-relecture (19/11/2026, appliquées) : noms du catalogue enregistrés sur le ticket (ligne, garniture, moitiés) ; supplément `qty` = 1 uniquement et pas de doublon (422 `validation`, ce qui ferme l'écart « substitution sur une quantité ») ; retraits limités aux ingrédients fixes de la fiche, à la garniture et à la deuxième moitié (422 `validation`, `items[i].removed`) ; ingrédients de disponibilité lus dans `MENU` de `assets/js/commercant.js` (Tex-Mex : poulet, oignons ; boissons : aucun) ; alias de disponibilité « chèvre » → « fromage de chèvre », « reblochon » → « reblochons » ; pizza à composer : « fromage » fixe, base « sauce tomate » ou « crème fraîche » lue dans `composer.html`, facultative dans le nom de ligne (le navigateur ne la transmet pas) : sans choix, au moins une base doit être disponible ; 422 `unavailable_items` porte aussi `unavailable_ingredients`.

Reste à confirmer : les sept décisions par défaut ci-dessus, et l'écart sur la quantité des suppléments. Le catalogue doit être régénéré (`node tools/build-catalogue.mjs`) après chaque modification des pages ; le test « le script de build, relancé, produit le même JSON » échoue tant que ce n'est pas fait.
