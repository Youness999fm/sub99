# Mission — Suppression intégrale de tout ce qui concerne « Le Panuzo »

## Demande initiale
Audit complet du projet et suppression réelle (pas juste masquage) de toute référence au « Panuzo » : textes, visuels, menus/liens, sections, intro/sons, configuration, SEO, pied de page, et toute référence cachée dans le code — en préservant le reste du site intact.

## Audit (avant modification)
Recherche « panuzo » insensible à la casse sur tout le projet : 23 fichiers touchés. Répartition :
- 10 pages HTML du site en ligne (`index.html`, `menu.html`, `reseaux.html`, `avis.html`, `composer.html`, `concours.html`, `faq.html`, `grand-tirage.html`, `supplements.html`, `vegetarien.html`)
- `assets/css/style.css` et `assets/js/main.js`
- Un dossier orphelin `panuzo-popup/` à la racine (jamais lié au site en ligne, déjà signalé « hors périmètre » dans un rapport précédent) et son image `panuzo-photo.jpg`
- L'image `assets/img/photos/panuzo.jpg`, utilisée par le site en ligne
- 7 rapports de mission dans `reports/` — **volontairement conservés** (voir « Hors périmètre » ci-dessous)

Aucune trace dans `manifest.json`, `sitemap.xml`, ou les métadonnées SEO (`<title>`, `<meta description>`, JSON-LD) : le Panuzo n'y a jamais été mentionné.

## Suppressions effectuées

**`index.html`** : section complète `<section class="panuzo-teaser">` (logo, bandeau, badge "En pause", ingrédients, étapes, prix — tout le bloc), et la ligne de pied de page `🥖 Le Panuzo fait une pause...`.

**`menu.html`** : les deux pastilles de navigation « Panuzo » (barre de catégories + nav rapide), la section catégorie complète `<section class="menu-category--panuzo">` (fiche produit, image, prix, description), la ligne de pied de page.

**`reseaux.html`** : la section `<section class="panuzo-card">` (carte dédiée en haut de page), la ligne de pied de page.

**Les 7 autres pages** (`avis.html`, `composer.html`, `concours.html`, `faq.html`, `grand-tirage.html`, `supplements.html`, `vegetarien.html`) : la ligne de pied de page identique sur chacune.

**`assets/js/main.js`** : retrait de `.panuzo-teaser` de la liste des sélecteurs animés au scroll (la seule référence restante dans ce fichier après le nettoyage de septembre).

**`assets/css/style.css`** : 820 lignes supprimées en 4 blocs —
- `.hero__plate.is-panuzo::after` (effet déjà mort depuis le retrait de la logique JS en septembre)
- `.site-footer__panuzo-line` + variante lien
- `.panuzo-card` et toute sa famille (reseaux.html)
- `.panuzo-menu-feature` et toute sa famille (menu.html)
- `.menu-jump__panuzo`
- Tout le bloc `/* Panuzo — teaser nouveauté */` (index.html), ~600 lignes à lui seul

**Fichiers supprimés** : `panuzo-popup/` (dossier entier : `index.html`, `script.js`, `style.css`, `assets/panuzo-photo.jpg`) et `assets/img/photos/panuzo.jpg`.

## Hors périmètre (volontairement non touché)
- **`reports/*.md`** (7 fichiers mentionnant Panuzo) : ce sont des comptes-rendus d'historique de développement, jamais exposés sur le site — les supprimer effacerait la traçabilité du projet sans aucun bénéfice pour le site lui-même. À signaler si vous préférez qu'ils soient nettoyés aussi.
- **`subito-popup/`** : un popup trouvé par hasard pendant la vérification visuelle, mais sans rapport avec le Panuzo (annonce « on se rapproche de vous ») — non touché, hors sujet de cette mission.

## Vérifications réellement effectuées
- Recherche finale « panuzo » sur tout le projet (HTML/CSS/JS/JSON/XML/TXT) : **0 résultat** hors `reports/`.
- Recherche de fichiers nommés `*panuzo*` : plus aucun hors `reports/`.
- `node --check assets/js/main.js` : syntaxe valide.
- Relecture manuelle de chaque point de jonction après suppression dans `style.css`, `index.html`, `menu.html`, `reseaux.html` : accolades/balises cohérentes, pas de ligne orpheline, espacement conforme au reste du fichier.
- Site testé en réel sur serveur local : `index.html` (flux hero → offre promo direct, sans le teaser), `menu.html` (catégories Pizzas → Pâtes → Subitowichs → Tex-Mex → Salades → Desserts → Boissons, sans trou), `reseaux.html` (réseaux sociaux directement après le bandeau communauté) — contenu confirmé via lecture de page, aucune erreur console nouvelle, aucune requête réseau vers un fichier Panuzo.

## Verdict
Le Panuzo a été retiré intégralement et réellement (code supprimé, pas masqué) de toutes les pages, du CSS, du JS, des images et des fichiers associés. Rien dans le reste du site n'a été modifié au-delà de ces suppressions. **PASS.**

## À republier
Les 10 pages HTML, `assets/css/style.css`, `assets/js/main.js`, et la suppression côté serveur de `assets/img/photos/panuzo.jpg` et du dossier `panuzo-popup/` (à retirer manuellement du serveur FTP, leur simple absence du prochain envoi ne les efface pas automatiquement de l'hébergement).
