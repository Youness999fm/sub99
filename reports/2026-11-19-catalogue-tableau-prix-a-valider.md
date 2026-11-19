# Tableau des prix — décisions prises, catalogue serveur

Référence pour le catalogue serveur. Le propriétaire a tranché les points 1 à 11 le 2026-11-19 (réponses point par point, section 13). Chaque montant est recopié tel qu'il figure dans les pages ou le code, avec sa source (fichier et ligne, relus le 2026-11-19). Aucune page n'a encore été modifiée : les changements décidés sont listés en section 14.

Statuts :
- **Lu** : le montant figure tel quel dans la page.
- **Validé (n)** : décision du propriétaire, numéro de la section 13.
- **Exemple** : calcul affiché comme exemple, pas un prix de vente.
- **Non-prix** : montant trouvé dans le code qui n'est pas un prix de vente.
- **Question ouverte** : non tranchée par les décisions.

## 1. Pizzas du menu (30 pizzas, section Pizzas)

Les prix de taille ci-dessous sont ceux de la section Pizzas. Le code les applique à chaque pizza de la section, Calzone comprise (`assets/js/cart.js` ligne 989 : `basePrice: size.price`).

| Taille | Prix | Source | Statut |
|---|---|---|---|
| Solo (26 cm) | 11,00 € | `menu.html` ligne 169 | Validé (1) |
| Duo (31,5 cm) | 16,00 € | `menu.html` ligne 174 | Validé (1) |
| Quatro (40 cm) | 23,00 € | `menu.html` ligne 179 | Validé (1) |
| XXL (50 cm) | 33,00 € | `menu.html` ligne 184 | Validé (1) |

Grille reprise dans `vegetarien.html` lignes 120 à 135 : mêmes montants aujourd'hui ; le test de parité doit les garder identiques (section 14).

Les 30 pizzas du menu (noms aux lignes 208 à 455 de `menu.html`) : Végétarienne, 3 Jambons, 4 Saisons, Calzone (soufflée), Campione, Kebab, Napolitaine, Régina, Chicken, Kefta, Neptune, 4 Fromages, Carnivora, L'Extravagante, Fruits de mer, Orientale, Pacifico, Subito, Venezia, Chèvre miel, Chicken Chika, Milano, Normande, Fajitas, Maroilles, Pollame, Savoyarde, Suisse, Indienne, Carolina.

| Règle | Montant | Source | Statut |
|---|---|---|---|
| Moitié-moitié (deux parfums différents) | Prix de la taille, sans montant ajouté, à partir de la taille Duo | `assets/js/cart.js` ligne 989 ; `menu.html` ligne 190 | Validé (2) |
| Calzone (soufflée), garniture au choix | Prix de la taille ; garniture gratuite | `menu.html` lignes 229 à 233 ; `assets/js/cart.js` lignes 737 et 743 à 757 | Validé (3) |

- **Moitié-moitié** : pas en Solo (`menu.html` ligne 190 : « À partir de la taille Duo, possibilité de moitié-moitié entre deux pizzas différentes ») ; jamais sur la Calzone (`menu.html` ligne 229, attribut `data-no-half` ; `assets/js/cart.js` lignes 574 et 1252).
- **Calzone** : la garniture est obligatoire (`assets/js/cart.js` ligne 737) et se choisit parmi jambon, thon, kebab, viande hachée ou poulet (`menu.html` ligne 233). Elle est gratuite : aucun supplément.

## 2. Composez votre pizza (`composer.html`)

Base Marguerita, prix par taille. Les deux grilles, celle du menu et celle du composeur, sont voulues.

| Taille | Prix | Source | Statut |
|---|---|---|---|
| Solo | 9,00 € | `composer.html` ligne 150 | Validé (1) |
| Duo | 13,00 € | `composer.html` ligne 155 | Validé (1) |
| Quatro | 17,50 € | `composer.html` ligne 160 | Validé (1) |
| XXL | 25,50 € | `composer.html` ligne 165 | Validé (1) |

Exemple affiché sur la page :

| Calcul | Total | Source | Statut |
|---|---|---|---|
| Solo 9,00 € + poulet 1,50 € + oignons 1,00 € | 11,50 € | `composer.html` ligne 207 | Exemple |

## 3. Suppléments (`supplements.html` lignes 84 à 107 ; `composer.html` lignes 187 à 201)

Prix par ingrédient supplémentaire, par taille (`supplements.html` lignes 87 à 90 et 98 à 101 ; mêmes montants dans `composer.html`, lignes 187 à 190 et 198 à 201).

| Groupe | Solo | Duo | Quatro | XXL | Ingrédients | Statut |
|---|---|---|---|---|---|---|
| Légumes et sauces | 1,00 € | 1,50 € | 2,50 € | 3,50 € | Champignons, artichauts, poivrons, oignons, câpres, olives, sauce barbecue, sauce curry, sauce tomate, crème fraîche, miel (ligne 85) | Validé (1) |
| Viandes, poissons et fromages | 1,50 € | 2,00 € | 3,00 € | 4,00 € | Viande hachée, mortadelle, merguez, chorizo, kebab, jambon, lardons, poulet, anchois, thon, parmesan, brie, chèvre, bleu, reblochon (ligne 96 ; la même liste, ligne 196, est dans `composer.html` ; astérisques à retirer : section 14) | Validé (1) et (4) |

Exemple affiché sur la page :

| Calcul | Total | Source | Statut |
|---|---|---|---|
| L'Extravagante en taille Solo, avec poulet 1,50 € et oignons 1,00 € en plus | +2,50 € | `supplements.html` ligne 107 | Exemple |

D'après la page, la grille ci-dessus s'applique aussi aux pizzas du menu : « mêmes suppléments et mêmes prix que sur la pizza composée » (`menu.html` ligne 190).

## 4. Pâtes (`menu.html` lignes 470 à 510)

Plats (noms aux lignes 479, 487, 495 et 503) : Bolognaise, 3 fromages, Saumon, Carbonara.

| Règle | Montant | Source | Statut |
|---|---|---|---|
| « Spaghettis ou tagliatelles — 8,50 € » (prix de la catégorie, appliqué à chaque plat) | 8,50 € pour chaque plat | `menu.html` ligne 472 ; `assets/js/cart.js` lignes 494 à 506 et 1237 à 1248 | Validé (5) |

Aucun prix n'est affiché sur les plats : le prix de la catégorie vaut pour chacun.

## 5. Subitowichs (`menu.html` lignes 511 à 575)

Sandwichs (noms aux lignes 519 à 567) : Milano, Vesuvio, 4 fromages, Rome, Venise, Norvégien, Kebab.

| Règle | Montant | Source | Statut |
|---|---|---|---|
| « Tomate ou crème fraîche — 6,00 € » (prix de la catégorie) | 6,00 € pour chaque sandwich | `menu.html` ligne 513 ; `assets/js/cart.js` lignes 494 à 506 et 1237 à 1248 | Validé (5) |

## 6. Tex-Mex (`menu.html` lignes 576 à 614)

Articles (noms aux lignes 584 à 608) : Wings (5 pièces), Tenders (4 pièces), Nuggets (4 pièces), Oignon ring (8 pièces). Aucun article n'a de prix propre.

| Élément | Montant | Source | Statut |
|---|---|---|---|
| Titre « Nos Tex-Mex à 5 € » | 5,00 € l'article | `menu.html` ligne 577 ; `assets/js/cart.js` lignes 494 à 506 et 1237 à 1248 | Validé (6) |
| Mention « Au choix » | — | `menu.html` ligne 578 | Sans modification (lue avec le titre) |

Le code proposait déjà 5,00 € par article, lu depuis le titre ; la décision le confirme. La mention « Au choix » se lit avec le titre (5 € l'article, au choix) : aucune modification demandée.

## 7. Salades (`menu.html` lignes 617 à 658)

Plats (noms aux lignes 626 à 650) : Exotique, Niçoise, Printanière, Di Roma.

| Règle | Montant | Source | Statut |
|---|---|---|---|
| « 7,50 € » (prix de la catégorie) | 7,50 € pour chaque salade | `menu.html` ligne 619 ; `assets/js/cart.js` lignes 494 à 506 et 1237 à 1248 | Validé (5) |

## 8. Desserts (`menu.html` lignes 659 à 711)

| Article | Prix | Source | Statut |
|---|---|---|---|
| Tiramisubito Spéculoos | 3,50 € | `menu.html` ligne 668 | Lu |
| Tiramisubito Oreo | 3,50 € | `menu.html` ligne 677 | Lu |
| Tiramisubito M&M's | 3,50 € | `menu.html` ligne 686 | Lu |
| Calzone Nutella | 6,50 € | `menu.html` ligne 695 | Lu |
| Part de Tarte au Daim | 3,00 € | `menu.html` ligne 704 | Lu |

## 9. Boissons (`menu.html` lignes 712 à 735)

| Article | Prix | Source | Statut |
|---|---|---|---|
| Boisson 33cl (Coca Cola, Coca Cerise, Coca Zero, Oasis Tropical, Oasis Pomme Cassis Framboise, Oasis Pomme Poire, Orangina, Schweppes Agrumes, Fanta Orange, Fanta Citron, Ice Tea) | 1,50 € | `menu.html` ligne 721 | Lu |
| Grande bouteille (Coca Cola, Fanta, Orangina, Ice Tea) | 3,00 € | `menu.html` ligne 730 | Lu |

## 10. Livraison (`assets/js/cart.js` lignes 181 à 188 ; `api/lib/util.php` lignes 9 à 16)

Les deux listes sont identiques (mêmes villes, mêmes montants).

| Ville | Minimum de commande | Frais si la commande ne contient aucune pizza | Statut |
|---|---|---|---|
| Hénin-Beaumont | 10,00 € | 5,50 € | Lu |
| Montigny-en-Gohelle | 15,00 € | 5,50 € | Lu |
| Dourges | 15,00 € | 5,50 € | Lu |
| Noyelles-Godault | 15,00 € | 5,50 € | Lu |
| Courrières | 20,00 € | 8,00 € | Lu |
| Billy-Montigny | 20,00 € | 8,00 € | Lu |
| Fouquières-lès-Lens | 25,00 € | 8,00 € | Lu |
| Rouvroy | 25,00 € | 8,00 € | Lu |

Règle des frais (`assets/js/cart.js` lignes 178, 179 et 221 ; `api/lib/orders.php` ligne 215 ; `index.html` lignes 276 à 295) : **sans pizza, les frais s'ajoutent ; avec au moins une pizza, la livraison est offerte.** Le minimum de commande porte sur les produits seuls (`assets/js/cart.js` ligne 227). **Validé (7).**

**FAQ** : `faq.html` lignes 54 et 126 disent « La livraison est offerte, sans frais supplémentaires », ce qui est faux pour une commande sans pizza. **Décidé (8)** : la FAQ est corrigée pour suivre la règle ci-dessus (texte en section 14).

## 11. Promotions (`assets/js/cart.js` lignes 143 et 159 ; `api/lib/orders.php` ligne 212)

| Promotion | Règle | Statut |
|---|---|---|
| 1 pizza achetée = 1 offerte (à emporter) | Dans chaque paire de pizzas, la moins chère est offerte. Offre cumulable sans limite dans la même commande. | Validé (9) |
| 2ᵉ pizza à −50 % (livraison) | Dans chaque paire de pizzas, la moins chère est à moitié prix. | Validé (9) |

Méthode de calcul (validée) :
- Les pizzas du panier sont triées du plus cher au moins cher, puis appariées deux par deux (`assets/js/cart.js` lignes 126 à 128 ; `api/lib/orders.php` lignes 207 et 209). Une pizza sans pair n'a pas de remise.
- À emporter, la moins chère de chaque paire est offerte (`api/lib/orders.php` ligne 212).
- En livraison, la moins chère de chaque paire est à moitié prix. L'affichage la calcule à `assets/js/cart.js` ligne 164 ; l'envoi au serveur la calcule en centimes entiers et l'arrondit au centime supérieur sur la remise (`assets/js/cart.js` ligne 1791 ; `api/lib/orders.php` ligne 212 : `intdiv($cheaper + 1, 2)`).
- Tous les prix actuels sont des multiples de 0,50 €, donc la moitié d'un prix tombe toujours sur un nombre entier de centimes : les deux calculs donnent le même résultat et l'arrondi ne change rien. Ils ne pourraient diverger qu'avec un prix contenant un nombre impair de centimes.

## 12. Autres montants

Aucun autre frais, taxe ni supplément n'apparaît dans les pages ou le code. Les modes de paiement ne changent pas le prix.

Montants trouvés dans le code qui ne sont pas des prix de vente :

| Montant | Source | Statut |
|---|---|---|
| Billets proposés pour le paiement en espèces : 10 €, 20 €, 50 €, 100 €, et « Appoint exact » (sans montant) | `assets/js/cart.js` ligne 252 (`CASH_NOTES`), boutons lignes 262 à 265 | Validé (10) : Non-prix, choix de monnaie. Visibles seulement en livraison, avec « Espèces » coché (lignes 258 et 1468) |
| « 0,00 € » : valeur de départ de la barre du panier | `assets/js/cart.js` ligne 1289 | Non-prix : remplacée dès le chargement, jamais affichée |

## 13. Décisions prises (2026-11-19)

1. **Grilles** : validées telles qu'affichées (menu, composeur, suppléments).
2. **Moitié-moitié** : prix de la taille, à partir de la taille Duo, jamais sur la Calzone.
3. **Calzone** : garniture au choix gratuite.
4. **Astérisques** : retirés des suppléments (page à modifier, section 14).
5. **Pâtes, salades, subitowichs** : même prix pour chaque plat (8,50 €, 7,50 €, 6,00 €).
6. **Tex-Mex** : 5,00 € l'article.
7. **Livraison** : sans pizza, frais de 5,50 € ou 8 € ; avec au moins une pizza, livraison offerte.
8. **FAQ** : corrigée pour suivre la règle 7 (texte en section 14).
9. **Promotions** : à emporter, la moins chère de chaque paire est offerte ; livraison, la moins chère de chaque paire à −50 % ; paires formées du plus cher au moins cher.
10. **Billets proposés en espèces** : choix de monnaie, non-prix.
11. **Source** : catalogue généré depuis les pages, avec tests de parité avec le panier ; la grille répétée de `vegetarien.html` est alignée sur `menu.html`.

## 14. Modifications de pages à faire

| Fichier | Où | Modification | Statut |
|---|---|---|---|
| `supplements.html` | ligne 96 | Retirer les astérisques des ingrédients (Viande hachée, mortadelle, merguez, chorizo, kebab, jambon, lardons, poulet) | Fait le 2026-11-19 (décision 4) |
| `composer.html` | ligne 196 | Retirer les mêmes astérisques (même liste, groupe « Viandes, poissons et fromages ») | Fait le 2026-11-19 (décision 4) |
| `faq.html` | lignes 54 et 126 | Remplacer la phrase sur la livraison par le texte ci-dessous | Fait le 2026-11-19 (décision 8) |
| `vegetarien.html` | lignes 120 à 135 | Aucune modification : les quatre montants sont déjà ceux de `menu.html` ; le test de parité doit vérifier qu'ils le restent | Sans modification (décision 11) |

Texte proposé pour la FAQ, ligne 54 (données structurées) et ligne 126 (paragraphe) : « Nous livrons à Hénin-Beaumont et dans les communes voisines : Montigny-en-Gohelle, Dourges, Noyelles-Godault, Courrières, Billy-Montigny, Fouquières-lès-Lens et Rouvroy. Sur une commande sans pizza, les frais de livraison s'ajoutent (5,50 € ou 8 € selon la ville) ; dès qu'une pizza est dans la commande, la livraison est offerte. Un montant minimum de commande s'applique, de 10 € à 25 € selon la ville. » La ligne 126 garde en plus « (voir le détail sur la page d'accueil) ».

Le panier lit déjà `supplements.html` à l'exécution (`assets/js/cart.js` lignes 588 à 607) ; la normalisation des noms (ligne 633) ignore déjà l'astérisque final : retirer les astérisques ne change pas ses calculs.

Les commandes en ligne restent fermées aux vrais clients tant que le catalogue serveur et ses tests de parité ne sont pas en place (point A du rapport de solutions).

## 15. Décisions complémentaires (2026-11-19)

1. **Desserts et boissons** : prix validés (5 desserts : 3,50 €, 3,50 €, 3,50 €, 6,50 €, 3,00 € ; 2 boissons : 1,50 €, 3,00 €).
2. **Minimums par ville** : validés (section 10).
3. **Composeur, moitié-moitié** : à partir de la taille Duo, comme sur le menu. Pas encore implémentée (composer.html ne propose pas de deuxième moitié) : à implémenter après le commit, décision de l'utilisateur du 2026-11-19 (« commit d'abord »).
4. **Composeur, base** : sauce tomate ou crème fraîche au même prix.
5. **Échange d'ingrédients** : une portion gratuite par pizza. Chaque pizza d'une ligne qui n'a plus l'ingrédient retiré a son supplément offert (3 pizzas sans champignons avec olives : 3 olives gratuites). Comportement actuel conservé, dans le panier (`assets/js/cart.js`, `applySwapDiscount`) et dans le contrôle serveur (`api/lib/catalogue.php`). Décision de l'utilisateur du 2026-11-19.
6. **Concours** : pages et données des gagnants exclues du paquet de préproduction ; le dépôt n'est pas modifié.
7. **Avis** : noms réduits à prénom et initiale (`avis.html` et `index.html`).
8. **Galerie** : clic retiré des huit vignettes de `index.html` tant que les photos manquent.
9. **Numéro dans `assets/js/main.js`** : ligne publique du restaurant, aucune modification.
10. **`subito-popup/`** : exclu du paquet de préproduction ; le dépôt n'est pas modifié.
