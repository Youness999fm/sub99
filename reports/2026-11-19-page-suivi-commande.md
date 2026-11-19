# Mission — Page de suivi de commande (attente, acceptation, minuteur, rappel)

## Demande
Après avoir cliqué "Commander en ligne", le client doit arriver sur une page avec son récapitulatif et l'attente de validation du restaurant. Dès que le commerçant accepte et transmet le délai, cette page doit l'afficher avec un minuteur, et proposer un rappel.

## Ce qui a été fait
Nouvelle page `commande.html?token=...` (lien unique à la commande, généré par le futur backend). Elle ne dépend pas du panier local — tout vient de l'API (`/api/order_status.php?token=...`), donc elle fonctionne même si le client change d'appareil ou revient plus tard.

- **En attente** : "⏳ En attente de confirmation du restaurant…" avec une icône animée, et un rappel que la page se met à jour toute seule (sondage automatique toutes les 4 secondes, comme pour la page commerçant).
- **Acceptée** : "✅ Commande acceptée !" avec un gros minuteur (MM:SS) qui décompte le délai annoncé par le restaurant, jusqu'à "C'est prêt !". Un bouton "🔔 Me prévenir quand c'est prêt" active un rappel (son + notification du navigateur si autorisée) qui se déclenche à zéro — activé uniquement sur un vrai clic du client, jamais automatique, avec un rappel honnête que ça ne sonne que si cet onglet reste ouvert (une vraie alerte même téléphone verrouillé/onglet fermé demande les notifications push, prévues plus tard dans le projet).
- **Refusée** : message clair + bouton d'appel direct.
- Le récapitulatif complet (articles, options, total, mode à emporter/livraison, moyen de paiement) reste affiché en dessous, à tout moment.
- Le bouton "Commander en ligne" du panier redirige maintenant vers cette page dès que la commande est bien envoyée (avant, il affichait juste un message dans le panier).
- Bonus : dans "Mon compte → Mes commandes", chaque commande encore en attente ou acceptée est maintenant cliquable et renvoie directement vers sa page de suivi.

## Vérifications réellement effectuées (serveur local, réponses d'API simulées puisque le backend n'existe pas encore)
- Parcours complet : ajout au panier → "Commander en ligne" → redirection réelle vers `commande.html?token=...` avec le bon jeton dans l'adresse.
- Sans backend réel, la page affiche honnêtement "Impossible de récupérer votre commande pour l'instant" plutôt que de bloquer ou mentir — testé.
- Les 3 états simulés un par un : attente (bien affichée), acceptée avec minuteur qui décompte vraiment seconde par seconde jusqu'à "C'est prêt !", refusée avec le bouton d'appel.
- Rappel : clic sur le bouton confirmé (passe à "🔔 Rappel activé"), déclenchement vérifié en simulant une commande déjà prête.
- Aucune nouvelle erreur de console.

## Limite assumée
Comme pour le reste, non connecté à un vrai backend — testé avec des réponses simulées. Une fois l'API en place, il faudra qu'elle retourne un jeton public à la création de commande et qu'`order_status.php` réponde avec la forme de données déjà utilisée ici (statut, articles, total, mode, paiement, délai, date d'acceptation).

## Verdict
**PASS.**

## À republier
`commande.html`, `assets/js/commande.js`, `assets/css/commande.css`, `assets/js/cart.js`, `assets/js/compte.js`, `assets/css/compte.css`.
