# Subito Pizza — site statique

Site 100% HTML/CSS/JS, sans backend. 4 pages : `index.html` (accueil), `menu.html`, `avis.html`, `reseaux.html`. Styles partagés dans `assets/css/style.css`, comportements (nav active, lightbox galerie) dans `assets/js/main.js`.

## Prévisualiser en local

Deux options :

1. **Le plus simple** : double-cliquer sur `index.html` pour l'ouvrir dans un navigateur. Tout fonctionne (nav, lightbox, carte, QR code), à une exception près : ne fonctionne pas pour tester des changements qui dépendraient d'un vrai serveur (aucun cas actuellement, donc cette méthode suffit).
2. Un petit serveur local est fourni pour un rendu plus fidèle à ce que verra un vrai navigateur en ligne : `powershell -ExecutionPolicy Bypass -File .claude\serve.ps1`, puis ouvrir `http://localhost:8090`.

## Mettre le site en ligne (FTP)

Le domaine `subito-pizza-heninbeaumont.fr` reste le même, seul le contenu change (le site n'est plus sous WordPress).

1. Connecte-toi en FTP avec les identifiants reçus par email (hôte `ftp.cluster102.hosting.ovh.net`, utilisateur `coursguil-subito`).
2. **Sauvegarde d'abord l'existant** : télécharge une copie du contenu actuel du dossier racine (l'ancien site WordPress) sur ton ordinateur avant de toucher à quoi que ce soit, au cas où.
3. Supprime (ou déplace dans un sous-dossier d'archive) les anciens fichiers WordPress du dossier racine du site (`wp-admin`, `wp-content`, `wp-includes`, `wp-config.php`, etc.).
4. Envoie tout le contenu de ce dossier (`index.html`, `menu.html`, `avis.html`, `reseaux.html`, le dossier `assets/`) à la racine du site.
5. Vérifie en visitant `https://subito-pizza-heninbeaumont.fr` que tout s'affiche correctement.

Si tu préfères que ton agence (BROWEB) s'en charge, ce dossier complet est prêt à leur être transmis tel quel.

## Ajouter le logo

Remplace, dans les 4 fichiers `.html`, le bloc :
```html
<div class="site-header__logo-placeholder">LOGO<br>SUBITO PIZZA</div>
```
par :
```html
<img src="assets/img/logo.png" alt="Subito Pizza">
```
et dépose ton fichier logo dans `assets/img/logo.png`.

## Ajouter des photos

- **Galerie (accueil)** : dans `index.html`, remplace chaque `<div class="img-placeholder">...</div>` par une vraie image, et mets à jour l'attribut `data-lightbox-src` du bouton parent pour qu'il pointe vers le même fichier. Dépose tes photos dans `assets/img/galerie/`.
- **Page Menu** : dans `menu.html`, remplace chaque `<div class="img-placeholder">...</div>` par `<img src="assets/img/menu/menu-N.jpg" alt="...">`. Dépose tes photos dans `assets/img/menu/`.

## Ajouter un nouvel avis client

Ouvre `avis.html`, suis les instructions écrites directement dans le fichier juste avant le premier avis (copier un bloc `<!-- DEBUT AVIS -->` / `<!-- FIN AVIS -->`, remplacer nom/date/texte/étoiles). Pense à aussi mettre à jour les 2 avis mis en avant sur `index.html` si tu veux qu'ils changent.

## ⚠️ Avant de mettre le site en ligne : activer la réception des avis

La page Avis clients contient un formulaire "Donnez votre avis" (accessible directement depuis le menu "Avis clients"). Quand un client l'envoie, ça ouvre sa messagerie avec un email pré-rempli adressé à `avis@subito-pizza-heninbeaumont.fr`.

**Cette adresse email doit exister et être relevée**, sinon les avis envoyés par tes clients partiront dans le vide sans que tu le saches. Deux options :
- Crée cette boîte mail dans ton espace d'administration OVH (mail lié à ton hébergement), ou
- Remplace-la par une adresse que tu utilises déjà : ouvre `assets/js/main.js`, cherche la ligne `const ownerEmail = 'avis@subito-pizza-heninbeaumont.fr';` et remplace l'adresse par la tienne.

Si un client n'a pas de messagerie configurée sur son téléphone, le formulaire l'invite à t'appeler directement au 03 21 20 00 33 à la place — c'est déjà géré, rien à faire de ce côté.

## Réseaux sociaux et QR code

Dans `reseaux.html`, remplace les `href="#"` par tes vraies URLs Facebook/Instagram/TikTok (repères en commentaire juste au-dessus de chaque lien). Si tu n'as pas de TikTok, supprime simplement le bloc `.social-link` correspondant.

Le QR code de cette page pointe vers `https://subito-pizza-heninbeaumont.fr/reseaux.html` — comme le domaine ne change pas, il n'y a rien à régénérer. Si un jour le domaine change, il faudra régénérer l'URL dans le paramètre `data=` du lien `<img>` du QR code (service utilisé : api.qrserver.com, gratuit, sans clé).

## Texte de présentation

Dans `index.html`, remplace le paragraphe "REMPLACER — le propriétaire fournira ce texte de présentation." par ton texte, dans la section `Subito Pizza` en bas de la page.
