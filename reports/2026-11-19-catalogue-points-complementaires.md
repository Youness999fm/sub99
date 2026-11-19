# Catalogue serveur des prix — compléments et corrections (session parente)

Complète `reports/2026-11-19-catalogue-serveur-proposition.md`, sans le modifier. Rien n'est appliqué, aucun prix n'est modifié ni inventé. Les lignes citées ont été relues le 2026-11-19.

## 1. Corrections à la proposition (vérifiées)

- **Zones de livraison** : `assets/js/cart.js`, lignes **180 à 188** (et non 175 à 183). Les zones de `api/lib/util.php` (lignes 8 à 17) concordent avec `cart.js` : minimums 10 / 15 / 20 / 25 €, frais 5,50 € ou 8 €.
- **Notes de catégorie** (`menu.html`) :
  - Pâtes, ligne 472 : « Spaghettis ou tagliatelles — 8,50 € ».
  - **Subitowichs**, ligne 513 : « Tomate ou crème fraîche — 6,00 € » (la proposition la rattachait aux Pâtes).
  - **Salades**, ligne 619 : « 7,50 € » (la proposition ne la nommait pas).
  - **Tex-Mex**, ligne 577 : titre « Nos Tex-Mex à 5 € », et ligne 578 : mention « Au choix ». Les deux se contredisent.
- **Articles à prix fixe** (`menu.html`) : la section Desserts (lignes 659 à 711) compte **5 articles** : 3,50 €, 3,50 €, 3,50 €, 6,50 € et 3,00 € (lignes 668 à 704). La section Boissons (lignes 712 et suivantes) compte **2 articles** : 1,50 € et 3,00 € (lignes 721 et 730). La proposition parlait de « 7 articles de la section Desserts ».
- **Tailles et suppléments** : confirmés. Tailles : 11,00 €, 16,00 €, 23,00 € et 33,00 € (`menu.html`, lignes 169 à 184). Suppléments : deux groupes à prix par taille (`supplements.html`, lignes 87 à 101), dont les noms portent des astérisques (ligne 96).
- **Moitié-moitié** : le code applique le prix de la taille (`cart.js`, ligne 989, `basePrice: size.price`). La proposition pose la question sans répondre ; le code répond, le propriétaire doit confirmer.

Les numéros de lignes de la section 1 de la proposition relatifs à `readSizeChart`, `priceFromCategoryNote` et `.menu-item__price` n'ont pas été revérifiés.

## 2. Règles absentes de la proposition

**Frais de livraison** (`cart.js`, lignes 178 et 179 ; `api/lib/orders.php`, ligne 215 ; `index.html`, lignes 276 à 295) :
- Commande **sans pizza** (pâtes, paninis, boissons) : frais de 5,50 € ou 8 € selon la ville.
- Commande **avec au moins une pizza** : livraison offerte.

**Contradiction avec la FAQ** : `faq.html` dit, aux lignes 54 (données structurées pour les moteurs de recherche) et 126 : « La livraison est offerte, sans frais supplémentaires ». C'est faux pour une commande sans pizza. Ce texte public doit être corrigé ou confirmé par le propriétaire.

**Promotions** :
- À emporter : pour chaque paire de pizzas, la moins chère est offerte (`cart.js`, ligne 143 ; `orders.php`, ligne 212, qui compte `$cheaper`).
- En livraison : une 2ᵉ pizza à −50 %, arrondi par paire (`cart.js`, ligne 159 ; `orders.php`, ligne 212 : `intdiv($cheaper + 1, 2)`).
- L'arrondi au centime et la règle « par paire » doivent être confirmés.

## 3. Décisions du propriétaire

1. Valider le tableau complet des prix, une ligne par article, taille et supplément, tel qu'il figure dans les pages. Le générateur ne fait que recopier ces valeurs.
2. Confirmer la règle de livraison : frais sans pizza, offerte avec pizza.
3. Corriger ou confirmer la phrase « La livraison est offerte » de la FAQ.
4. Confirmer les deux règles de promotion et l'arrondi par paire.
5. Tex-Mex : prix individuels ? Quel prix, « 5 € » ou « Au choix » ?
6. Moitié-moitié : prix de la taille, sans supplément ?
7. Astérisques des suppléments (`supplements.html`, ligne 96) : que signifient-ils ?
8. Calzone : prix de la taille, sans supplément ?
9. Source unique : générer le catalogue depuis les pages (proposition) ou déplacer les prix dans un fichier de données lu par le site et par le serveur.

Tant que ces points ne sont pas tranchés, la commande en ligne ne doit pas être ouverte à de vrais clients : le serveur accepte aujourd'hui les prix envoyés par le navigateur (`api/order_create.php`, lignes 55, 70 et 107).
