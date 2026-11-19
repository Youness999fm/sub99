# Mission — Téléphone obligatoire à l'inscription

## Demande
Le numéro de téléphone ne doit plus être facultatif sur le formulaire de création de compte (`compte.html`) : il doit être obligatoire pour s'inscrire.

## Ce qui a été fait
- `compte.html` : retiré la mention "(facultatif)" sur le champ Téléphone, ajouté l'attribut `required`.
- `assets/js/compte.js` : le formulaire utilisant `novalidate` (les erreurs sont déjà gérées à la main, comme pour les mots de passe), ajouté une vérification explicite — sans numéro, l'inscription est bloquée avec le message "Le numéro de téléphone est obligatoire."

## Vérifications réellement effectuées
- Tentative d'inscription sans numéro : bloquée, message d'erreur affiché, rien envoyé.
- Même formulaire avec un numéro rempli : passe normalement (testé avec une réponse d'API simulée, le vrai backend n'existe pas encore).

## Verdict
**PASS.**

## À republier
`compte.html`, `assets/js/compte.js`.
