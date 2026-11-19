# Mission — Mettre en valeur l'offre livraison (proposition, à discuter)

## Demande
Faire en sorte que la livraison soit aussi mise en avant comme un vrai mode de commande, en analysant d'abord comment la livraison fonctionne actuellement chez Subito, puis en proposant la meilleure présentation possible de cette offre — explicitement une base de discussion, pas une version figée.

## Analyse de l'existant (avant de proposer quoi que ce soit)
La livraison existe déjà sur le site sous forme d'une section factuelle (`#zone-livraison` sur `index.html`) : 4 paliers de montant minimum selon la ville (10 € à Hénin-Beaumont, jusqu'à 25 € pour Fouquières-lès-Lens/Rouvroy), horaires 19h–22h (déjà affichés dans le hero), et une promo différente de celle à emporter : en livraison, c'est 1 pizza achetée → la 2ème à −50 % (cumulable), alors qu'à emporter c'est 1 achetée → 1 offerte. Dans `cart.js`, j'ai confirmé que le calcul de cette promo livraison est explicitement noté "hors périmètre" pour l'instant (décision prise dans une session précédente) — la commande en ligne ne gère aujourd'hui que le retrait.

## Ce qui a été fait
J'ai retravaillé la section existante plutôt que d'en recréer une en double ailleurs sur la page (pour ne pas surcharger le site) :
- Un en-tête à l'identique du reste du site (eyebrow doré "★ LIVRAISON ★", titre Playfair) et un texte d'intro qui rappelle les horaires (19h–22h).
- Les 4 cartes de montant minimum par ville, inchangées (déjà bien faites).
- Le rappel de la promo, reformulé pour être plus clair ("1 pizza achetée, la 2ème à −50 %, cumulable sans limite").
- **Nouveau** : un bouton d'appel assorti au reste du site (même style que le bouton "Pensez à réserver vos pizzas" déjà existant), et une phrase honnête juste en dessous : *"La commande en ligne pour la livraison arrive bientôt, avec votre compte — pour l'instant, un appel suffit."*

## Pourquoi je n'ai pas branché un vrai bouton "Commander en livraison en ligne"
Le panier ne sait aujourd'hui distinguer ni le mode (retrait/livraison), ni calculer la bonne promo pour la livraison, ni collecter une adresse — et le backend qui recevrait les commandes n'existe toujours pas. Mettre un bouton qui prétendrait commander la livraison en ligne aurait été un mensonge visuel. J'ai donc gardé l'appel téléphonique comme action réelle, tout en annonçant clairement que la version en ligne arrive — exactement dans l'esprit de "on réfléchira ensemble" : la présentation est prête, les décisions de fonctionnement (comment calculer le minimum par ville, comment gérer l'adresse, comment adapter la promo) restent à prendre avec vous avant de coder le reste.

## Vérifications réellement effectuées
- Rendu vérifié sur mobile (une colonne) et grand écran (les 4 cartes côte à côte) — aucune régression sur la mise en page existante.
- Aucune nouvelle erreur de console.

## Verdict
Proposition livrée, basée sur les vraies données déjà publiées sur le site (rien d'inventé), honnête sur ce qui fonctionne réellement aujourd'hui. **Prêt pour discussion, pas pour republication en l'état si vous voulez d'abord trancher le fonctionnement de la commande en livraison.**

## Points à trancher ensemble avant d'aller plus loin
- Faut-il demander l'adresse du client à la commande, et comment vérifier qu'elle est dans une des 4 zones (et donc quel minimum s'applique) ?
- La promo "2ème à −50 %" doit-elle être calculée automatiquement dans le panier comme l'est déjà celle à emporter ?
- Le choix "à emporter / en livraison" doit-il se faire dès l'ajout au panier, ou seulement à la validation de la commande ?

## À republier
`index.html`, `assets/css/style.css` — mais seulement quand vous voudrez, rien d'urgent puisque c'est une proposition à valider.
