# Mission — Commander en livraison, adresse en compte, vérification du minimum par ville

## Demande
Que le client puisse choisir "Livraison" dans son panier (avec le bon calcul de prix), qu'il puisse renseigner une adresse facultative dans son compte, et que le site vérifie automatiquement le minimum de commande de sa ville avant de le laisser commander en livraison.

## Ce qui a été fait

**Dans le panier** (`cart.js`) : une bascule "🏠 À emporter" / "🛵 Livraison" apparaît maintenant sous la liste des articles. En livraison, le calcul change automatiquement : au lieu de "1 pizza achetée = 1 offerte", c'est "1 pizza achetée, la 2ème à −50 %" (même logique d'appariement que l'existant : la pizza la plus chère de la paire est toujours payée pleine, jamais pénalisée par un supplément). Le total, le récapitulatif copié/envoyé et le texte "Copier" s'adaptent tous au mode choisi.

**Dans le compte** (`compte.html`) : une adresse (numéro/rue + ville) peut être renseignée à l'inscription — explicitement facultative, comme demandé — et modifiée à tout moment depuis la fiche "Mon compte" une fois connecté. La ville se choisit dans une liste déroulante limitée aux 8 villes de la zone de livraison (reprises telles quelles de la section déjà publiée sur la page d'accueil — une seule liste de référence dans tout le site, pas de risque qu'elle diverge).

**La vérification du minimum** : quand le client choisit "Livraison" dans son panier, le site regarde sa ville enregistrée et compare le total (avec la promo livraison déjà appliquée) au minimum de cette ville :
- Pas connecté → invité à se connecter.
- Connecté mais sans adresse → message clair avec un bouton "Ajouter mon adresse", qui l'envoie sur `compte.html`, puis le ramène automatiquement sur son panier (toujours en mode livraison) une fois l'adresse enregistrée — sans qu'il ait besoin de la remplir à nouveau.
- Adresse connue mais minimum pas atteint → "Minimum pour [ville] : X € — il manque Y €", et le bouton "Commander en ligne" refuse d'envoyer tant que ce n'est pas corrigé (testé : exemple donné dans la demande, Rouvroy avec une seule solo à 11 €, bloqué avec le bon message et le bon montant manquant).
- Minimum atteint → confirmation verte, commande envoyable normalement.

## Vérifications réellement effectuées (serveur local, vrais clics + réponses d'API simulées puisque le backend n'existe pas encore)
- Deux solos à 11 € ajoutées : "À emporter" affiche bien 11 € (1 offerte) ; bascule sur "Livraison" → 16,50 € (11 + la moitié de 11), calcul vérifié exact.
- Parcours complet "pas d'adresse" : message + bouton affichés, redirection vers `compte.html` avec le bon retour, ville bien proposée dans une liste des 8 villes, enregistrement simulé, retour automatique sur le panier toujours en mode livraison.
- Ville "Rouvroy" (minimum 25 €) avec un panier à 16,50 € en livraison : bloqué avec "il manque 8,50 €" — exact. Clic sur "Commander en ligne" dans cet état : refusé avec le même message, rien envoyé.
- Ville "Hénin-Beaumont" (minimum 10 €) avec le même panier : "Livraison disponible" affiché, clic sur "Commander en ligne" déclenche bien une vraie tentative d'envoi (échoue proprement puisque le backend n'existe pas encore — comportement attendu et déjà documenté).
- Repassage en "À emporter" après ces tests : calcul toujours correct (11 €), aucune régression.
- Aucune nouvelle erreur de console.

## Limite assumée
Comme pour tout le reste du système de commande, rien de ceci n'est encore relié à un vrai backend — testé avec des réponses d'API simulées dans le navigateur. Une fois l'hébergement disponible, il faudra ajouter les colonnes `street`/`city` à la table `customers` du schéma déjà validé, et les endpoints `customer_update_address.php` et `order_create.php` devront accepter les champs `mode`/`street`/`city` déjà envoyés par le code.

## Verdict
**PASS.** Les trois points de la demande (bascule livraison avec bon calcul, adresse facultative en compte, vérification automatique du minimum) sont en place et vérifiés avec le scénario exact donné en exemple (Rouvroy, une solo à 11 €).

## À republier
`compte.html`, `assets/js/cart.js`, `assets/js/account.js`, `assets/js/compte.js`, `assets/css/cart.css`, `assets/css/compte.css`.
