# Mission — Fusion des tailles, calcul "1 achetée = 1 offerte", règle d'échange, habillage

## Demande initiale (orale, en plusieurs points)
1. La rangée de tailles (Solo/Duo/Quatro/XXL) apparaissait deux fois — une fois sur la fiche, une fois dans le panneau "Personnaliser". À fusionner.
2. Prendre en compte la promo "1 pizza achetée = 1 offerte" (à emporter) dans le panier/récapitulatif — pas la livraison (-50 %), "on la travaillera après".
3. Le récapitulatif reflète une commande **à emporter** ; pour une livraison, le client doit appeler directement.
4. Prévenir le client quand le nombre de pizzas est impair qu'une pizza de plus serait offerte.
5. Dans la promo, c'est la pizza **la plus chère** du binôme qui est payée, la moins chère offerte — un supplément ajouté ne doit jamais réduire la remise.
6. Règle d'échange : retirer un ingrédient d'un groupe (légumes/sauces, ou viandes/poissons/fromages) rend gratuit l'ajout d'un supplément du **même groupe** (une viande contre une viande ou un fromage, un légume contre un légume) — jamais entre les deux groupes.
7. Retravailler l'habillage visuel du panneau de personnalisation (jugé "moche") pour qu'il soit beau et cohérent avec le thème du site.
8. Réécrire et embellir le bandeau d'annonce : expliquer clairement qu'il s'agit d'un pense-bête pour faciliter les clients, qu'on ne peut pas commander en ligne, que c'est provisoire ("pour l'instant") et qu'une évolution est à l'étude.

## Ce qui a été fait

**Fusion des tailles** — `assets/js/cart.js` : les deux rangées de tailles (ajout rapide + panneau) sont remplacées par un seul widget (`buildPizzaWidget`) : une rangée de tailles unique, qui révèle ensuite deux actions claires — « Ajouter telle quelle » (ajout immédiat sans option) et « Personnaliser » (ouvre le panneau, qui réutilise la taille déjà choisie, sans la redemander).

**Promo "1 pizza achetée = 1 offerte" (à emporter)** : nouvelle fonction `pizzaPromo()` qui prend toutes les pizzas du panier (tailles + suppléments déjà appliqués), les trie de la plus chère à la moins chère, et offre la moins chère de chaque paire — jamais de perte pour le client, un supplément ne peut qu'augmenter la remise potentielle, jamais la réduire. Si le nombre de pizzas est impair, un encart doré invite à en ajouter une de plus. Le panier affiche désormais : sous-total, ligne de remise, total « à emporter », et un rappel que la livraison nécessite un appel direct (tarif différent, non calculé ici).

**Règle d'échange ingrédient-contre-ingrédient** : nouvelle fonction `applySwapDiscount()`, appliquée au moment de l'ajout au panier (et dans l'aperçu de prix avant ajout, pour que ce soit cohérent) : chaque ingrédient retiré "paie" un supplément du même groupe que `supplements.html` (légumes/sauces d'un côté, viandes/poissons/fromages de l'autre), qui devient alors gratuit — affiché "(échange offert)" dans le panier et le récapitulatif.

**Habillage** : nouveau design pour le panneau de personnalisation (carte blanche avec liseré dégradé rouge→or en haut, titres en Playfair Display, séparateurs en pointillés entre sections, icônes par section — ✂️ Sans, ➕ Suppléments, 🍕🍕 Moitié-moitié, 💬 Autre demande), nouveau bouton "Personnaliser" (pastille bordée or avec une icône de réglages, plus l'ancien crayon jugé "moche"), résumé final sur fond vert tendre façon ticket de caisse.

**Bandeau d'annonce** (`menu.html`) : reconstruit en carte (icône 🍕 en médaillon, titre en Playfair, texte explicatif, note en italique précisant que ce n'est pas une commande en ligne, que c'est provisoire et qu'une évolution est à l'étude), avec liseré dégradé assorti au panneau de personnalisation.

## Vérifications réellement effectuées (serveur local, vrais clics/événements)
- Exemple donné par l'utilisateur reproduit à l'identique : 3 Jambons XXL, sans mortadelle, suppléments champignons + artichauts + olives + poulet → poulet automatiquement gratuit (échange avec la mortadelle retirée, même groupe), les 3 légumes facturés normalement → **43,50 €** exact.
- 4 Saisons XXL + 3 Jambons XXL (toutes deux à 33 €) → total **33 €** (une offerte).
- Même scénario avec un supplément ajouté sur l'une des deux → la pizza personnalisée (40 €) est payée, l'autre (33 €, moins chère) offerte → total **40 €** — vérifie que la remise ne pénalise jamais le client.
- 5 pizzas Solo ajoutées → remise sur 2 paires (−22 €), message "Ajoutez encore 1 pizza : elle sera offerte" affiché pour la 5ᵉ pizza seule.
- Un seul widget de taille par pizza, vérifié sur `menu.html`, `vegetarien.html` et `composer.html` — plus de doublon.
- Panneau pâtes/Subitowichs : même bouton "Personnaliser" harmonisé, fonctionnel.
- Aucune erreur console sur `menu.html`, `vegetarien.html`, `composer.html` (onglets neufs, lecture propre).
- `node --check` sur `cart.js` : syntaxe valide tout au long.

## Limite assumée
Le calcul de la promo livraison (2ᵉ pizza à −50 %) n'est volontairement pas implémenté, conformément à la demande explicite ("on le travaillera après") — seul un rappel textuel oriente le client vers un appel direct pour ce cas.

## Verdict
Les 8 points de la demande sont livrés et vérifiés avec de vrais calculs (pas seulement relus). **PASS.**

## À republier
`menu.html`, `assets/js/cart.js`, `assets/css/cart.css`, par FTP.
