# Subito Pizza — site statique

Site 100% HTML/CSS/JS, sans backend ni outil de build. 10 pages : `index.html` (accueil), `menu.html`, `composer.html` (composer sa pizza), `vegetarien.html` (sélection végétarienne), `supplements.html` (détail des prix de suppléments, non indexée), `avis.html` (avis clients), `reseaux.html` (réseaux sociaux + concours), `faq.html`, `mentions-legales.html`, `404.html`. Styles partagés dans `assets/css/style.css`, comportements (nav active, lightbox galerie, parcours avis, formulaire réclamation, compteurs, animations) dans `assets/js/main.js`.

## Prévisualiser en local

Deux options :

1. **Le plus simple** : double-cliquer sur `index.html` pour l'ouvrir dans un navigateur. Utile pour un aperçu rapide, mais certains comportements (notamment liés au chargement de plusieurs pages) peuvent se comporter différemment qu'en ligne.
2. **Recommandé** : un petit serveur local est fourni pour un rendu fidèle à ce que verra un vrai navigateur en ligne : `powershell -ExecutionPolicy Bypass -File .claude\serve.ps1`, puis ouvrir `http://localhost:8090`.

## Mettre le site en ligne (FTP)

Le domaine `subito-pizza-heninbeaumont.fr` reste le même, seul le contenu change (le site n'est plus sous WordPress).

1. Connecte-toi en FTP avec les identifiants reçus par email (hôte `ftp.cluster102.hosting.ovh.net`, utilisateur `coursguil-subito`).
2. **Sauvegarde d'abord l'existant** : télécharge une copie du contenu actuel du dossier racine (l'ancien site WordPress) sur ton ordinateur avant de toucher à quoi que ce soit, au cas où.
3. Supprime (ou déplace dans un sous-dossier d'archive) les anciens fichiers WordPress du dossier racine du site (`wp-admin`, `wp-content`, `wp-includes`, `wp-config.php`, etc.).
4. Envoie tout le contenu de ce dossier (toutes les pages `.html`, `manifest.json`, `robots.txt`, `sitemap.xml`, le dossier `assets/`) à la racine du site.
5. Vérifie en visitant `https://subito-pizza-heninbeaumont.fr` que tout s'affiche correctement.

Si tu préfères que ton agence (BROWEB) s'en charge, ce dossier complet est prêt à leur être transmis tel quel.

**Avant de générer un zip à envoyer** : régénère-le au dernier moment, juste avant l'envoi — pas à l'avance — pour être sûr qu'il contient bien la toute dernière version du site.

## Ajouter des photos

- **Galerie (accueil)** : dans `index.html`, remplace chaque `<div class="img-placeholder">...</div>` par une vraie image (`<img src="assets/img/..." alt="...">`), et mets à jour l'attribut `data-lightbox-src` du bouton parent pour qu'il pointe vers le même fichier. 8 emplacements encore en attente : Pizzas ×2, Restaurant ×2, Équipe ×2, Ingrédients, Desserts.
- **Page Menu** : les photos des plats sont déjà en place (`assets/img/photos/`).

## Ajouter un nouvel avis client

Ouvre `avis.html`, suis les instructions écrites directement dans le fichier juste avant le premier avis (copier un bloc `<!-- DEBUT AVIS -->` / `<!-- FIN AVIS -->`, remplacer nom/date/texte/étoiles).

## Comment fonctionne le parcours "Avis clients"

Sur `avis.html`, le client choisit une note de 1 à 5 étoiles :
- **4-5 étoiles** → sa fiche Google s'ouvre automatiquement dans un nouvel onglet, pour l'inviter à laisser un avis public.
- **1-3 étoiles** → il est amené directement vers la section "Un souci avec votre commande ?", pour traiter concrètement le problème (appel ou message).

Le lien Google reste toujours visible dans la section réclamation, quelle que soit la note — volontaire, pour rester conforme aux règles de Google sur les avis (ne jamais masquer le lien Google selon la note donnée).

Le formulaire de réclamation ("Un souci avec votre commande ?", présent sur `avis.html`) envoie un email pré-rempli à l'adresse définie dans `assets/js/main.js` (constante `ownerEmail`, ligne ~721, actuellement `contact@subito-pizza-heninbeaumont.fr`).

## ⚠️ Avant de mettre le site en ligne : vérifier la réception des messages

**L'adresse `contact@subito-pizza-heninbeaumont.fr` doit exister et être relevée** (ou rediriger vers une boîte que tu consultes déjà, ex. `subito.pizza.hb@gmail.com`), sinon les réclamations envoyées par tes clients partiront dans le vide sans que tu le saches. Deux options :
- Crée une redirection dans ton espace client OVH (Emails > Redirections) vers l'adresse de ton choix, ou
- Ouvre `assets/js/main.js`, cherche `const ownerEmail = 'contact@subito-pizza-heninbeaumont.fr';` et remplace directement par l'adresse que tu veux utiliser.

Si un client n'a pas de messagerie configurée sur son téléphone, le formulaire ne bloque pas : un bouton d'appel direct (03 21 20 00 33) est proposé en alternative.

## Réseaux sociaux

Dans `reseaux.html` : Snapchat (`subito_henin`) et TikTok (`@subitopizzaoriginal`) ont déjà de vrais liens fonctionnels. Facebook et Instagram affichent "Bientôt disponible" (repérés par un commentaire `TODO` juste au-dessus dans le code) : dès que tu as les vraies URLs, remplace le `<span class="social-link social-link--soon">...</span>` correspondant par un `<a class="social-link" href="TON_URL" target="_blank" rel="noopener">...</a>`, en gardant la même structure interne (icône + nom + identifiant).

## Avis Google — lien direct

Les liens "avis Google" pointent actuellement vers une recherche Google Maps par adresse (fonctionnel, mais pas un lien "écrire un avis" en un clic). Si tu obtiens un jour le Place ID exact de la fiche Google Business de Subito Pizza, dis-le pour que je remplace ces liens par une redirection directe vers le formulaire d'avis Google.
