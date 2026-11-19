# Contrat API — mises à jour du 19/11/2026

Ce document complète [2026-11-19-espace-commercant-contrat-api.md](2026-11-19-espace-commercant-contrat-api.md). En cas de contradiction, ce document fait foi pour les points listés ici. Tout ce qui suit a été relu dans le code (`api/`) et couvert par les suites de tests.

## 1. Commande : ordre des contrôles (`api/order_create.php`)

1. Session client (`require_customer`).
2. Forme du corps (`validate_order_body`).
3. Clé d'idempotence déjà connue : même contenu → 200 avec `replayed: true` ; contenu différent → 409 `idempotency_conflict`. Un rejeu ne compte pas dans la limite de l'étape 4.
4. Limitation : 20 commandes par client et par 10 minutes (429 `too_many_attempts`).
5. Catalogue et disponibilités, ligne par ligne (voir sections 2 à 4 et 8).
6. Téléphone renseigné sur le compte (422 `profile_incomplete`).
7. Adresse et zone de livraison, pour une livraison seulement (422 `address_required`).
8. Totaux calculés par le serveur, puis minimum de la zone (422 `minimum_not_reached`).
9. Comparaison avec les totaux envoyés (409 `price_mismatch`, avec les totaux serveur).
10. Enregistrement dans une transaction. Rien n'est enregistré avant la fin de l'étape 9.

## 2. Catalogue serveur des prix

- Source : `api/data/catalogue.json`, généré par `tools/build-catalogue.mjs` à partir des pages du site (carte, suppléments, composer, `assets/js/cart.js`) et de la liste `MENU` de `assets/js/commercant.js`. Lecture seule ; `--check` vérifie que le fichier est à jour.
- Chaque ligne est recalculée côté serveur : prix de taille (pizza) ou prix fixe, plus les suppléments. Un écart d'un centime donne `price_mismatch_line`.
- **Les prix, promotions, minimums et frais de livraison sont des décisions à confirmer par le propriétaire** (rapport catalogue, section « Reste à confirmer »). Les minimums par ville (10, 15, 20 et 25 €) et les prix des desserts et des boissons sont validés. Aucun prix n'est inventé : le générateur lit les pages du site.

## 3. Codes d'erreur de la commande

| HTTP | `error` | Champs | Cas |
|---|---|---|---|
| 409 | `idempotency_conflict` | — | Même clé, contenu différent. |
| 429 | `too_many_attempts` | `retry_after_seconds` | Plus de 20 commandes en 10 minutes. |
| 422 | `unknown_item` | `name` | Article, moitié ou supplément absent de la carte ; supplément sur un article qui n'est pas une pizza. |
| 422 | `unpriced_item` | `name` | Article sans prix en ligne. |
| 422 | `price_mismatch_line` | `index`, `name`, `expected_unit_cents`, `sent_unit_cents` | Prix unitaire ou prix d'un supplément différent de la carte (dont un supplément offert facturé). Rien n'est enregistré. |
| 422 | `unavailable_items` | `unavailable` (noms des produits), `unavailable_ingredients` (ingrédients en rupture, en minuscules) | Rupture de produit ou d'ingrédient. |
| 422 | `validation` | `items[i].half` | Moitié-moitié sur un format Solo ou sur un article qui ne l'accepte pas (dont la calzone). |
| 422 | `validation` | `items[i].extras[j].qty` | Quantité de supplément différente de 1. |
| 422 | `validation` | `items[i].extras[j].name` | Supplément répété dans la même ligne. |
| 422 | `validation` | `items[i].removed` | Retrait qui n'est pas un ingrédient de la ligne. |
| 422 | `profile_incomplete` | — | Téléphone absent du compte. |
| 422 | `address_required` | — | Livraison sans adresse dans une zone desservie. |
| 422 | `minimum_not_reached` | `minimum_cents`, `products_after_promo_cents` | Minimum de la zone non atteint. |
| 409 | `price_mismatch` | `server_*` | Total envoyé différent du total serveur. |

Le nom enregistré sur le ticket est celui du catalogue (ex. « Calzone (soufflée) — Thon », « Régina » en moitié), jamais le texte envoyé par le navigateur. Les retraits sont acceptés seulement pour un ingrédient fixe de la fiche, la garniture choisie ou un ingrédient de la deuxième moitié.

## 4. Disponibilité

- Vérifiée à l'étape 5 : produits (par nom), ingrédients fixes, garniture ou base choisie, suppléments. L'erreur indique l'ingrédient en rupture (`unavailable_ingredients`).
- Pizza à composer « Marguerita (base) » : « fromage » est fixe, et au moins une base (« sauce tomate » ou « crème fraîche ») doit être disponible. Si le navigateur transmet un choix, c'est ce choix qui est vérifié, et il devient le nom du ticket. Les deux bases sont au même prix.
- Alias de disponibilité : « chèvre » couvre « fromage de chèvre » ; « reblochon » couvre « reblochons ». Les autres suppléments ne couvrent que leur propre nom.

## 5. Connexion et limitation

- Connexion propriétaire et client : 5 échecs par adresse IP en 15 minutes, puis verrou de 15 minutes (429 `too_many_attempts`). Aucun verrou par e-mail : un tiers ne peut pas bloquer le compte en saisissant une adresse.
- Une tentative réussie n'est pas comptée (`throttle_refund`) : une réussite ne remet pas le compteur à zéro, et les échecs expirent seuls après 15 minutes.
- Pour IPv6, le compteur porte sur le préfixe /64.
- Inscription client : 10 par adresse IP et par heure.

## 6. Profil et recherche

- `api/customer_update_profile.php` (POST JSON, session client) : prénom, nom et téléphone, avec les mêmes règles qu'à l'inscription. Les caractères de format (`\p{Cf}`, dont les marques de sens d'écriture) sont retirés des noms. Les caractères de contrôle (`\p{Cc}`, tabulation, retour à la ligne) deviennent une espace, pour ne pas coller deux mots. **Choix à valider.**
- `api/owner_customers.php` : recherche par POST JSON `{q}` uniquement. Un GET renvoie 405 `method_not_allowed` avec `Allow: POST`.

## 7. Horloge de test

`maintenant_epoch()` (`api/lib/horloge.php`) lit une horloge de test seulement si `PHP_SAPI` vaut `cli-server` et si `SUBITO_TEST_CLOCK_FILE` est défini. Hors de ce cas (Apache, PHP-FPM, CGI), c'est l'heure réelle.

## 8. Échange d'ingrédients : une portion par pizza (décision de l'utilisateur, 19/11/2026)

**Règle** : chaque retrait d'un ingrédient présent sur la pizza donne un crédit dans son groupe (légumes et sauces, ou viandes, poissons et fromages). Le premier supplément suivant du même groupe est alors offert **sur chaque pizza de la ligne** : une ligne de N pizzas identiques avec un retrait et une olive offre N olives. Les suppléments qui n'ont pas de crédit restent payants. Un supplément reste à quantité 1.

**Ce qui circule** :
- Le navigateur (`applySwapDiscount`, `assets/js/cart.js`) met le prix du supplément offert à 0 €. Le prix unitaire envoyé (`unit_price_cents`) est donc la pizza avec ses suppléments payants uniquement. Le total de ligne est `qty × unit_price_cents`.
- Le serveur (`catalogue_expected_line`, `api/lib/catalogue.php`) recalcule la même chose ; un supplément offert envoyé à son prix de liste est refusé (422 `price_mismatch_line`).

**Exemple** (Régina Duo, sans champignons, avec une olive, 3 pizzas) : `unit_price_cents` = 1600 ; supplément `olives` à `price_cents` = 0 ; total à emporter = 3 × 1600 − 1600 = 3200 (une pizza sur deux de la paire est offerte par la promotion, comme pour toute ligne).

**Tests** : quatre tests de parité dans `tests/api/catalogue.test.mjs` (trois pizzas avec un retrait et une olive ; une olive facturée refusée ; une ligne normale qui garde son prix ; parité navigateur et serveur pour les quantités 1 et 3).

**Non retenu** : une variante « une portion offerte par ligne » a été codée puis retirée, en application de la décision.
