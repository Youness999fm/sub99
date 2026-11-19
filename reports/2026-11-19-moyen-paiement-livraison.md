# Mission — Moyen de paiement obligatoire en livraison + appoint espèces

> **Document dépassé.** Le contrat décrit ci-dessous (`payment_method`, un seul moyen) a été remplacé : plusieurs moyens sont désormais cochables, envoyés dans `payment_methods` (tableau, vide à emporter), avec `cash_change_for`. Voir [2026-11-19-calzone-garniture-paiement-recap.md](2026-11-19-calzone-garniture-paiement-recap.md).

## Demande
En livraison, le client doit préciser son moyen de paiement (carte bancaire, espèces, ticket restaurant, carte ticket restaurant — bien deux choses différentes, acceptées toutes les deux). S'il paie en espèces, il doit préciser avec quel billet il règle, pour que le livreur prépare la monnaie à l'avance (il ne garde pas d'espèces sur lui pour des raisons de sécurité).

## Ce qui a été fait
Dans le panier, en mode "Livraison" (juste en dessous du message de vérification d'adresse/minimum déjà en place) : un bloc "💳 Moyen de paiement à la livraison" avec les 4 mêmes libellés et icônes déjà utilisés sur la page d'accueil (section "Moyens de paiement acceptés") — une seule liste de référence, pas de texte réinventé :
- Carte bancaire
- Espèces
- Ticket Restaurant
- Carte Ticket Restaurant

En choisissant "Espèces", un second choix apparaît aussitôt : "Vous réglez avec un billet de…" avec les coupures courantes (10 €, 20 €, 50 €, 100 €) et une option "Appoint exact". Ce choix est repris explicitement dans le récapitulatif copié (ex. *"Paiement : 💶 Espèces (billet de 20 €)"*) et envoyé avec la commande.

Le bouton "Commander en ligne" refuse d'envoyer la commande en livraison tant que le moyen de paiement n'est pas choisi, et tant que le montant du billet n'est pas précisé si c'est en espèces — avec un message clair à chaque étape.

## Vérifications réellement effectuées
- Sélection d'un moyen de paiement puis d'un billet : le bouton "Commander en ligne" refuse d'envoyer sans billet précisé, accepte une fois choisi.
- Le contenu réellement envoyé à l'API (vérifié en interceptant l'appel) contient bien `mode: "delivery"`, `payment_method: "cash"`, `cash_change_for: 20`.
- Le texte "Copier" inclut bien la ligne "Paiement : 💶 Espèces (billet de 20 €)".
- Le choix de paiement est conservé si le client doit d'abord se connecter (comme pour le mode livraison déjà en place) — pas besoin de le re-choisir après un aller-retour sur la connexion.
- Aucune nouvelle erreur de console.

## Verdict
**PASS.**

## À republier
`assets/js/cart.js`, `assets/css/cart.css`.
