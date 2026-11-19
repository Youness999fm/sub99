# Mission — Faire comprendre "compte requis pour commander" (bandeau accueil + pop-up + menu)

## Demande
Rendre bien visible que commander en ligne nécessite un compte, à la fois sur le menu et via un nouvel élément en haut de la page d'accueil, dans la qualité visuelle du reste du site, avec éventuellement un petit pop-up — sans "salir" le site.

## Ce qui a été fait
- **Page d'accueil (`index.html`)** : nouvelle section "Commandez en ligne" juste après le bloc promo existant ("1 pizza achetée = 1 offerte"), donc bien en haut de page. Reprend le vocabulaire visuel déjà établi sur le site (liseré dégradé rouge→or en haut, titre en Playfair Display, carte blanche avec ombre) et un parcours en 3 étapes numérotées (Créez un compte → Composez votre commande → Récupérez-la), avec deux boutons ("Créer mon compte", "Voir la carte").
- **Petit pop-up d'accueil**, uniquement sur la page d'accueil : s'affiche une seule fois par visiteur (1,6 seconde après l'arrivée sur la page), jamais relancé après une fermeture (croix, clic en dehors, ou touche Échap). Design assorti (carte à liseré or, icône ronde, titre Playfair), bouton principal vers la création de compte et un lien discret pour continuer sans commander. Indépendant du pop-up "réseaux sociaux" déjà existant sur le site (clé de stockage différente, et non chargé sur les mêmes pages — aucun risque que les deux s'affichent en même temps).
- **Page menu (`menu.html`)** : la bannière déjà en place a été complétée pour préciser explicitement qu'un compte gratuit est nécessaire pour commander, avec un lien direct "créer mon compte".

## Bug trouvé et corrigé en testant
Sur mobile, les 3 étapes du nouveau bandeau s'affichaient mal : le numéro, le titre et le texte de chaque étape se retrouvaient alignés côte à côte au lieu que le titre/texte s'empile proprement sous le numéro — un oubli de structure HTML (pas de bloc pour regrouper titre+texte). Corrigé en regroupant les deux dans un conteneur dédié.

## Vérifications réellement effectuées (serveur local, mobile puis desktop large)
- Nouveau bandeau : rendu correct en 3 colonnes sur grand écran, et en liste empilée lisible sur mobile (après correctif).
- Pop-up : apparition confirmée pour un visiteur "neuf" (localStorage vidé), fermeture confirmée (bouton, et vérifié qu'il ne réapparaît pas après rechargement de la page une fois fermé).
- Lien "créer mon compte" dans la bannière du menu : visible, bien distinct (rouge, souligné) dans le texte.
- Aucune nouvelle erreur de console sur `index.html` ni `menu.html` (seules les erreurs habituelles liées aux polices externes et à l'API pas encore en ligne, déjà présentes avant ce travail).

## Verdict
Les trois éléments demandés sont en place, dans le ton visuel du site, un bug réel trouvé et corrigé pendant les tests. **PASS.**

## À republier
`index.html`, `menu.html`, `assets/css/order-launch.css` (nouveau), `assets/js/order-launch.js` (nouveau), `assets/css/cart.css`. Comme pour le reste du travail en attente du backend, le bouton "Créer mon compte" renvoie vers `compte.html`, qui ne sera pleinement fonctionnel qu'une fois l'API en place.
