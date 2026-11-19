# Mission — Frais de livraison pour les commandes sans pizza

> **Note.** La ligne 33 décrit l’ancien contrat à moyen de paiement unique (`payment_method`). Le contrat actuel envoie `payment_methods` (tableau, vide à emporter) : voir [2026-11-19-calzone-garniture-paiement-recap.md](2026-11-19-calzone-garniture-paiement-recap.md). Le reste de ce rapport (frais de livraison) reste valable.

## Demande
En livraison, une commande qui ne contient aucune pizza (uniquement pâtes, paninis, boissons, desserts, tex-mex ou salades) doit payer des frais de livraison selon la ville. Une commande avec au moins une pizza n'a pas de frais (la livraison est offerte).

Barème demandé :
- Hénin-Beaumont, Montigny-en-Gohelle, Dourges, Noyelles-Godault : **5,50 €**
- Courrières, Billy-Montigny, Fouquières-lès-Lens, Rouvroy : **8 €**

## Ce qui a été fait

**Barème** (`assets/js/cart.js`, `DELIVERY_ZONES`) : chaque ville porte désormais son montant de frais (`fee`). Les noms de villes sont ceux déjà publiés sur le site (Montigny-en-Gohelle, Noyelles-Godault, Fouquières-lès-Lens).

**Règle** : `deliveryFee(cart)` renvoie 0 hors mode livraison, 0 dès qu'une ligne de panier a une taille (une pizza, même une seule), et sinon les frais de la ville du client.

**Minimum de commande inchangé** : le minimum de la ville porte toujours sur les produits seuls (après promo), les frais ne comptent pas dans le minimum.

**Totaux** : le pied du tiroir, la barre flottante du bas, le total envoyé à l'API et les récapitulatifs (copié et envoyé à quelqu'un) incluent les frais. Une ligne « Frais de livraison : X € » apparaît dans le récapitulatif copié quand elle s'applique. La barre du bas affiche désormais le même total que le tiroir (avant, elle ignorait le mode livraison).

**Statut de livraison** (tiroir) : « Frais de livraison : X € (commande sans pizza). » quand ils s'appliquent, ou « Pas de frais de livraison : votre commande contient des pizzas. » quand il y a au moins une pizza.

**Suivi de commande** (`commande.js`) : une ligne « Frais de livraison » s'affiche au-dessus du total si l'API renvoie `delivery_fee`.

**Accueil** (`index.html`) : chaque carte de ville indique ses frais (« Frais : 5,50 € sans pizza ») et une phrase précise la règle sous la promo livraison.

**Code retiré** : `cartTotal()` (remplacé par les fonctions `activeCartTotal` / `activeGrandTotal`), devenu inutilisé.

## Vérifications réellement effectuées (serveur local, réponses de compte simulées)
- Hénin-Beaumont, panier sans pizza (12 €) : frais 5,50 €, total 17,50 € (pied et barre identiques).
- Même ville, avec une pizza 4 Saisons Solo ajoutée : aucun frais, total 23,00 €.
- Panier sans pizza à 30 €, villes testées une par une : Rouvroy 38 €, Courrières 38 €, Billy-Montigny 38 €, Fouquières-lès-Lens 38 € (8 €) ; Montigny-en-Gohelle 35,50 €, Noyelles-Godault 35,50 €, Dourges 35,50 € (5,50 €).
- Rouvroy avec 12 € de produits sans pizza : minimum non atteint (« il manque 13,00 € »), commande bloquée.
- Commande envoyée (intercepte l'appel) : `mode: "delivery"`, `delivery_fee: 5.5`, `total: 35.5`, `payment_method: "card"`.
- Commande à emporter : `delivery_fee: 0`, `total: 30`.
- Récapitulatif copié en livraison : « Frais de livraison : 5,50 € » et « Total livraison : 35,50 € ». En à emporter : aucune ligne de frais, « Total à emporter : 30,00 € ».
- Tiroir en livraison rendu à l'écran : ligne de frais visible, total cohérent. Section livraison de l'accueil rendue : frais affichés sur chaque carte.
- Aucune erreur JavaScript non interceptée pendant les tests.

## Ce qui reste à faire côté serveur et commerçant
- **Le serveur doit recalculer les frais lui-même** (`order_create.php`) à partir de la ville du compte et du contenu du panier, et ne jamais se fier au `total` envoyé par le navigateur : un client pourrait sinon modifier ce montant.
- Le ticket commerçant (`commercant/`) n'affiche pas encore les frais de livraison : à ajouter quand le backend fournira `delivery_fee` (ligne « Frais de livraison » avant le TOTAL).
- Pour mémoire : le mode de retrait (à emporter / livraison) est toujours réinitialisé à « à emporter » à chaque changement de page. Ce comportement est inchangé.

## Verdict
**PASS** pour la partie interface et le calcul côté navigateur. Le contrôle définitif des frais est à faire côté serveur (voir ci-dessus).

## À republier
`assets/js/cart.js`, `assets/js/commande.js`, `assets/css/cart.css`, `assets/css/commande.css`, `assets/css/style.css`, `index.html`.
