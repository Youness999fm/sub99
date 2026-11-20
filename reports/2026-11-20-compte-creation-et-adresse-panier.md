# Écran "Compte créé !", résumé replié, adresse de livraison directement dans le panier

Date : 2026-11-20 · Dépôt : `sub99`

## Demande

Trois choses liées au compte client (demande vocale du 20/11) :
1. Quand le client crée son compte, afficher un écran dédié "Compte créé !" au lieu d'aller directement sur l'espace client habituel.
2. Dans l'espace client, une partie "Mes informations" repliée par défaut (il faut appuyer pour l'ouvrir) qui montre seulement prénom, nom, téléphone, et l'adresse si elle est enregistrée — rien d'autre.
3. Quand un client connecté sans adresse enregistrée choisit "Livraison" dans son panier pour la première fois, il doit pouvoir remplir son adresse directement dans le panier (pas redirigé vers "Mon compte"), avec attention particulière sur la ville — et cette adresse doit s'enregistrer automatiquement sur son compte dès cette première fois.

## Ce qui a été fait

- `compte.html` : nouveau bloc `#accountCreated` (icône, titre "Compte créé !", bouton "Continuer") affiché juste après l'inscription ; nouveau `<details class="account-summary">` repliable (réutilise `.faq-item`) avec prénom/nom/téléphone/adresse ; ajout d'un sélecteur "Type de logement" aux deux formulaires d'adresse (inscription et "Modifier mes informations").
- `assets/js/compte.js` : `showAccountCreated(session)` affichée après une inscription réussie (pas après une connexion) ; `#accountCreatedContinue` bascule ensuite sur la vue connectée habituelle ; `showLoggedIn()` et les succès des formulaires profil/adresse alimentent le résumé replié.
- `assets/js/cart.js` : quand "Livraison" est choisi et que le client n'a pas d'adresse (ou de ville) valide, un formulaire (rue, ville, type de logement) s'affiche directement dans le panier ; sa validation appelle l'API existante `updateAddress()`, qui enregistre sur le compte — disponible ensuite pour cette commande et toutes les suivantes.
- `assets/css/compte.css` : styles de l'écran de confirmation et du résumé replié.

## Problème trouvé et corrigé en cours de route

Un champ serveur `housing_type` (maison/appartement/immeuble) avait été ajouté par un changement antérieur, obligatoire pour toute commande en livraison mais volontairement facultatif à l'enregistrement de l'adresse (pour ne pas casser les comptes déjà créés avant son ajout). Résultat avant correction : un compte avec une ville déjà enregistrée mais sans type de logement voyait "Livraison disponible ✓" dans le panier, puis la commande échouait sans aucun moyen de corriger sans quitter le panier — à l'opposé du but recherché.

Corrigé dans `assets/js/cart.js` (`renderDeliveryStatus`/`cartAddressFormHtml`) : le panier détecte maintenant aussi ce cas, préremplit la rue et la ville déjà connues, et ne demande que le type de logement manquant, avec un message adapté.

Deuxième correctif : après modification du profil ("Modifier mes informations"), le résumé replié affichait encore l'ancien prénom/nom/téléphone tant que la page n'était pas rechargée. `assets/js/compte.js` met maintenant aussi à jour le résumé à la sauvegarde.

## Vérification

- Relecture par un agent adversaire (rôle dédié selon `CLAUDE.md`) : a trouvé les deux bugs ci-dessus (housing_type non détecté dans le panier, résumé non rafraîchi après édition du profil) — tous deux corrigés et re-testés. A aussi noté deux points mineurs jugés hors périmètre (formulaire "Modifier mes informations" toujours visible sous le résumé replié ; écran de confirmation sauté quand l'inscription reprend une commande en attente) : laissés tels quels, comportement jugé correct.
- Test e2e réel dans un navigateur (serveur `sub99-api`, le vrai serveur Node, pas le serveur statique `sub99` qui ne sert aucune API) :
  - Inscription complète → écran "Compte créé !" avec prénom → "Continuer" → vue connectée, résumé fermé par défaut, s'ouvre au clic, affiche bien les 4 champs attendus.
  - Compte sans adresse → ajout d'une pizza → "Livraison" dans le panier → formulaire d'adresse apparaît dans le panier → soumission → adresse vérifiée automatiquement enregistrée sur le compte (`me()` confirmé côté serveur).
  - Compte simulé "créé avant l'ajout du type de logement" (ville enregistrée, type de logement vide) → "Livraison" → formulaire avec rue/ville préremplies, ne demande que le type de logement → soumission → statut repasse à "Livraison disponible".
  - Modification du profil → résumé replié mis à jour immédiatement.

## À republier

`compte.html`, `assets/js/compte.js`, `assets/js/cart.js`, `assets/css/compte.css`.

Les fichiers étaient déjà commités dans un commit local (`5324af6`) avant les deux correctifs ci-dessus ; `assets/js/cart.js` et `assets/js/compte.js` ont des modifications non commitées à l'issue de cette session — à committer puis republier (push GitHub → déploiement Vercel automatique).
