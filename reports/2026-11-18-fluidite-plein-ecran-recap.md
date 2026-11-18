# Mission — Récapitulatif pas fluide, pas plein écran sur mobile

## Signalement
« Il se met pas plein écran et tout, je peux pas bien enlever des pizzas, remettre... il est pas fluide » en ouvrant le récapitulatif sur téléphone.

## Causes réelles (confirmées)
1. **Pas plein écran** : le récapitulatif s'ouvrait en « feuille » remontant du bas avec un espace vide en haut de l'écran (jusqu'à 15 % de hauteur perdue) et des coins arrondis — correct sur un grand écran, mais serré sur téléphone.
2. **Pas fluide** : à **chaque** appui sur + ou −, le script reconstruisait **toute la liste des articles** (tous les éléments HTML étaient détruits puis recréés), même pour changer un seul chiffre. Sur un panier avec plusieurs pizzas, ça donnait un petit flash/saut visuel à chaque appui, et la position de défilement pouvait sauter — d'où l'impression de lenteur/bug, même si le chiffre finissait par être juste.

## Correctifs
- **`assets/css/cart.css`** : le récapitulatif occupe maintenant toute la hauteur de l'écran sous 560px de large (plein écran réel, sans coins arrondis, avec marge de sécurité pour l'encoche en haut). Au-delà de 560px (tablette/ordinateur), il reste une carte centrée classique, inchangée. Les boutons +/− sont aussi agrandis (24px → 32px) pour être plus faciles à toucher précisément.
- **`assets/js/cart.js`** : un appui sur + ou − (quand ça ne supprime pas la ligne) ne touche plus que le chiffre et le sous-total de **cette** ligne, plus le pied (total/promo) — la liste entière n'est plus reconstruite. Quand une ligne disparaît réellement (quantité à 0, suppression), la liste se reconstruit comme avant, mais en conservant la position de défilement du client au lieu de la remettre en haut.

## Vérifications réellement effectuées (serveur local, viewport mobile 375×812 puis desktop)
- Panier avec 3 articles ouvert : le récapitulatif occupe bien tout l'écran du téléphone, sans bande vide en haut.
- Appui sur + d'une ligne : vérifié par script que c'est **le même élément HTML** qui reste affiché (pas de reconstruction), avec le bon nouveau chiffre, le bon sous-total, et le total général/la remise recalculés correctement (3 pizzas à 33 € → 1 offerte → 70,50 €).
- La barre flottante (en bas de la page menu) se met aussi à jour correctement après un +/−.
- Appui sur − jusqu'à 0 : la ligne disparaît bien, la position de défilement des autres lignes est conservée.
- Repassage en desktop : le récapitulatif reste bien une carte centrée avec coins arrondis, comportement inchangé.
- Aucune erreur console sur `menu.html`.
- `node --check` sur `cart.js` : syntaxe valide.

## Verdict
Les deux points signalés (plein écran, fluidité des +/−) sont corrigés et vérifiés en conditions réelles (clics réels, deux tailles d'écran). **PASS.**

## À republier
`assets/css/cart.css`, `assets/js/cart.js`, par FTP.
