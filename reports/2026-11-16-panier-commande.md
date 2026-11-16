# Mission — Panier de commande (récapitulatif + appel)

## Demande initiale
Permettre au client de parcourir toute la carte et d'ajouter des produits à un panier qui reste accessible pendant toute la navigation, puis d'obtenir un récapitulatif automatique à présenter/dicter au téléphone. Précision donnée en cours de mission : **pas de formulaire client, pas de simulation de commande en ligne** — juste un pense-bête pratique avant d'appeler, avec un ton qui laisse clairement comprendre que ça ne commande rien tout seul.

## Analyse préalable
- Technologie : HTML/CSS/JS statique, aucun build, 12 pages, `assets/css/style.css` partagé + fichiers dédiés par fonctionnalité (`subito-popup.css/js` existant, suivi comme modèle).
- Carte existante : prix soit sur la fiche produit (`.menu-item__price` — desserts, boissons), soit en note de catégorie (`.menu-category__price-note` — pâtes, subitowichs, salades), soit par grille de tailles partagée (`.size-chart` — toutes les pizzas, y compris `vegetarien.html`). Tex-Mex n'a son prix que dans le titre de catégorie ("Nos Tex-Mex à 5 €").
- `composer.html` : page informative seule (aucune logique interactive existante, le site renvoie déjà à un appel téléphonique pour composer sa pizza) — pas de calculateur à « récupérer », juste la grille de prix de la base Marguerita.
- Aucun canal de transmission réel confirmé (pas de WhatsApp pro, pas de caisse en ligne) : seul le 03 21 20 00 33 est un canal réel aujourd'hui.

## Solution livrée
**Le panier lit les prix directement depuis le HTML existant, jamais une liste dupliquée** — en cas de modification de la carte, le panier reste juste, aucune resynchronisation à faire.

- `assets/js/cart.js` (nouveau) : scanne chaque `.menu-item` de la page, détecte automatiquement le bon mode de prix, et injecte le bon contrôle :
  - Prix propre ou note de catégorie/titre → bouton « Ajouter 🛒 » + compteur +/-.
  - Pas de prix propre mais une grille de tailles sur la page → sélecteur Solo/Duo/Quatro/XXL (pizzas de `menu.html` et `vegetarien.html`, base Marguerita de `composer.html`).
  - Panier dans `localStorage` (persiste à l'actualisation et d'une page à l'autre), fusion automatique des lignes identiques (même produit + même taille), lignes séparées sinon.
  - Barre flottante en bas (nombre d'articles + total + « Commander »), panier détaillé (quantités, suppression, total), et une fenêtre « Mon récapitulatif » : le texte généré automatiquement depuis le panier, un gros bouton rouge **Appeler pour commander · 03 21 20 00 33**, un bouton « Copier le récapitulatif », et une phrase qui dédramatise avec humour : *« Petite précision utile : ce bouton n'envoie rien tout seul, ce n'est pas une commande en ligne. C'est juste votre antisèche pour ne rien oublier au téléphone — à vous de jouer, le resto est au bout du fil ! »*
- `assets/css/cart.css` (nouveau) : réutilise les couleurs/rayons/ombres déjà définis dans `style.css` (`--green`, `--red`, `--radius`...), aucune nouvelle charte.
- Les 12 pages du site reçoivent chacune 2 lignes ajoutées (`<link>` + `<script defer>`), rien d'autre modifié dans leur HTML — tout le reste (design, animations, structure) est strictement intact.

## Bugs trouvés et corrigés pendant les tests réels (pas juste relus)
1. Le champ "Adresse de livraison" restait visible malgré `hidden` (une règle `display:flex` de même spécificité écrasait la règle native) — devenu sans objet après la simplification (formulaire entièrement retiré).
2. Panier détaillé et fenêtre de commande pouvaient s'ouvrir superposés selon le chemin emprunté — fermeture immédiate de l'un avant d'ouvrir l'autre, désormais impossible de les avoir tous les deux à l'écran.
3. `openCheckout()` tentait de mettre le focus sur un champ "Nom" supprimé lors de la simplification → erreur JS bloquante, corrigée (focus sur la fenêtre elle-même).

## Vérifications réellement effectuées (serveur local, interactions réelles)
- Parcours complet simulé via de vrais clics sur les boutons injectés (pas l'API interne) : 1 pizza Duo + 1 pizza Solo + 2 boissons + 1 dessert → panier à 5 articles, total **36,50 €** vérifié exact (16 + 11 + 3 + 6,50).
- Panier rouvert sur une **autre page** (`index.html` après ajout sur `menu.html`) : même contenu, même total — persistance confirmée.
- Fenêtre de récapitulatif : texte généré conforme (nom, taille, prix, total), bouton d'appel (`tel:0321200033`) et bouton copier fonctionnels.
- `composer.html` : sélecteur de taille de la base Marguerita injecté et fonctionnel (prix 9/13/17,50/25,50 €, différents des pizzas classiques — confirmé lus depuis la bonne grille de la page).
- `vegetarien.html` : 5 sélecteurs de taille injectés sur les 5 pizzas de la sélection.
- `node --check` sur `cart.js` : syntaxe valide.
- Les 12 pages visitées une à une : **aucune erreur console** après ajout du panier (y compris les pages sans produits : avis, faq, concours, grand-tirage, mentions-légales, 404, reseaux, supplements).

## Limites assumées (hors périmètre, à dire clairement)
- Aucune transmission automatique au restaurant : ni WhatsApp, ni email, ni caisse en ligne — volontairement, puisque rien de tout ça n'existe réellement côté Subito aujourd'hui et que la demande finale est explicitement « pas une commande en ligne ».
- Pas de choix de saveur pour les boissons multi-choix (Coca/Fanta/Orangina...) ni de personnalisation ingrédient par ingrédient des pizzas classiques (cette dernière reste gérée par téléphone, comme c'était déjà le cas avant cette mission sur `composer.html`).
- Pas de mode de commande (sur place / à emporter / livraison) à choisir : retiré sur demande, le client en discute directement au téléphone.

## Verdict
Fonctionnalité réellement opérationnelle, testée avec de vrais clics sur les vrais boutons de la carte, panier persistant et exact, récapitulatif fiable, aucune régression détectée sur les 12 pages. **PASS.**

## À republier
Les 12 pages HTML (2 lignes ajoutées chacune), plus les deux nouveaux fichiers `assets/css/cart.css` et `assets/js/cart.js`, par FTP.
