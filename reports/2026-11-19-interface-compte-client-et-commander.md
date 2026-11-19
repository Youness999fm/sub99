# Mission — Interface "Mon compte" + bouton "Commander en ligne" (front-end, sans backend)

## Contexte
En attendant les accès d'hébergement (gérés par un ami de l'utilisateur, disponibles le lendemain), travail demandé sur l'interface pendant que le backend n'existe pas encore : les pages "Mon compte" client (Phase 3 du plan) et le bouton "Commander" du panier (Phase 4).

## Ce qui a été fait
- **`compte.html`** (nouvelle page) : onglets "Se connecter" / "Créer un compte", formulaires (email/mot de passe pour la connexion ; prénom/nom/email/téléphone/mot de passe + confirmation pour l'inscription), vue "connecté" avec nom/email, bouton de déconnexion et un bloc "Mes commandes". Suit l'identité visuelle existante (mêmes variables de couleur, même police de titres, mêmes classes de champs `.review-form__field` déjà utilisées ailleurs sur le site).
- **`assets/js/account.js`** (nouveau) : petit module partagé `window.SubitoAccount` (me/login/signup/logout/myOrders) qui parlera à l'API `/api/customer_*.php` une fois le backend en place — utilisé à la fois par `compte.js` et par `cart.js`, pour ne pas dupliquer cette logique.
- **`assets/js/compte.js`** (nouveau) : bascule entre les deux onglets, validation (mots de passe qui ne correspondent pas, 8 caractères minimum), affichage des erreurs, et surtout : si le client est arrivé ici parce qu'il voulait commander (voir point suivant), il est renvoyé automatiquement vers sa commande une fois connecté.
- **`assets/js/cart.js`** : le bouton "📞 Appeler pour commander" devient "🛒 Commander en ligne" (avec l'appel téléphonique gardé juste en dessous comme solution de repli, conformément au plan validé). S'il n'est pas connecté, le client est envoyé sur `compte.html`, puis ramené automatiquement sur sa commande après connexion/inscription — il n'a pas à tout recommencer. Les anciennes mentions "ce n'est pas une commande en ligne" ont été retirées du panier et de la bannière de `menu.html`.
- **Navigation** : un lien "Mon compte" a été ajouté dans le menu principal des 12 pages du site.

## Bug trouvé et corrigé en testant (même piège que vu ailleurs sur ce site)
En testant l'affichage réel, les deux formulaires (connexion ET inscription) s'affichaient **en même temps** au lieu de basculer : `display: flex` dans `compte.css` avait la même priorité que l'attribut `hidden` et l'emportait. C'est exactement le même piège déjà rencontré et corrigé ailleurs dans `cart.css` pendant les sessions précédentes. Corrigé avec la même règle défensive (`.account-form[hidden] { display: none; }`).

## Vérifications réellement effectuées (serveur local, vrais clics, mobile puis desktop)
- Bascule entre les deux onglets : un seul formulaire visible à la fois, confirmé après correction.
- Validation : mots de passe différents → message d'erreur clair, pas d'envoi.
- Inscription avec une réponse d'API simulée (le vrai backend n'existe pas encore) : passage correct à la vue "connecté", nom/email affichés, "Mes commandes" interrogé.
- **Parcours complet simulé de bout en bout** : panier avec une pizza → clic "Commander en ligne" sans être connecté → redirection vers `compte.html?retour=...` → connexion (réponse simulée) → retour automatique sur la page d'origine → la commande est renvoyée automatiquement, sans que le client retouche son panier.
- **Comportement honnête sans backend** : comme `/api/order_create.php` n'existe pas encore (404 normal), l'envoi échoue proprement avec un message clair ("L'envoi en ligne n'a pas fonctionné pour l'instant — merci d'appeler directement") et le numéro de téléphone juste en dessous — jamais de fausse confirmation, panier jamais perdu.
- Les 12 pages du site (dont `index.html`, `composer.html`) chargent toujours sans nouvelle erreur de console après l'ajout de `account.js` et du lien de navigation.

## Limite assumée
Rien de tout ceci n'est connecté à un vrai backend — c'est strictement de l'interface et de la logique côté client, testée avec des réponses d'API simulées dans le navigateur. Dès que `/api/customer_*.php` et `/api/order_create.php` existeront (Phases 1, 3 et 4 du plan), ce code devrait fonctionner sans changement majeur : il appelle déjà les bonnes adresses avec le bon format.

## Verdict
Interface complète, testée visuellement et fonctionnellement (avec simulation), un bug réel trouvé et corrigé. **PASS pour la partie interface — en attente du backend pour la partie réelle.**

## À republier
Pas urgent tant que le backend n'existe pas (le bouton "Commander en ligne" échouerait proprement en attendant, avec le téléphone en repli) — mais si vous voulez republier dès maintenant : `compte.html`, `assets/js/account.js`, `assets/js/compte.js`, `assets/css/compte.css`, `assets/js/cart.js`, `assets/css/cart.css`, `menu.html`, et les 12 pages HTML du site (nouveau lien de navigation + chargement de `account.js`).
