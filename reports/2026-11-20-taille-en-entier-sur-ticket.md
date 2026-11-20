# Taille écrite en entier sur le ticket (Solo/Duo/Quatro/XXL)

Date : 2026-11-20 · Dépôt : `sub99`

## Demande

Le ticket abrégeait la taille des pizzas (S, D, Q — XXL restait déjà en entier). Le restaurant préfère la taille écrite en entier partout (Solo, Duo, Quatro, XXL) : le ticket est assez large, y compris pour une pizza moitié-moitié qui retourne à la ligne.

## Ce qui a été fait

`assets/js/commercant.js`, `ticketItemTitle(it)` : suppression de la table d'abréviation `TICKET_SIZE_ABBR` ; la taille (`it.variant`) est maintenant toujours écrite telle quelle. Aucun autre changement — le regroupement par taille (`ticketSizeRank`/`TICKET_SIZE_RANK`) et le reste de l'affichage (moitié-moitié, ingrédients retirés, suppléments) sont inchangés.

Concerne les trois formats de ticket (aperçu écran, charge imprimante, trame ESC/POS), qui partagent tous `ticketItemTitle`.

## Vérification

Relecture de code + `node -c` (pas d'erreur de syntaxe). Pas de vérification visuelle en direct (nécessite la connexion commerçant, hors de portée pour moi — voir consigne permanente sur les identifiants).

## À republier

`assets/js/commercant.js`.
