# Mission — Désambiguïser les noms de produits dans le récapitulatif

## Demande initiale
Dans le récapitulatif, « Bolognaise » (pâtes) apparaît sans le mot « Pâtes » — risque de confusion au téléphone. Même problème pour les Subitowichs (« panini »/« subito wish » dans le message vocal, compris comme « Subitowichs »).

## Cause
Les noms affichés sur la carte (`.menu-item__name`) sont volontairement courts car le contexte vient du titre de la catégorie au-dessus (« Pâtes », « Subitowichs »...). Le panier, lui, ne reprend que le nom court — hors contexte visuel, ça devient ambigu. Pire : certains noms existent dans **deux catégories différentes** avec un prix différent — « Milano » et « Kebab » sont à la fois des pizzas et des Subitowichs.

## Correctif
`assets/js/cart.js` : les produits des catégories Pâtes, Subitowichs, Tex-Mex, Salades, Desserts et Boissons reçoivent désormais le nom de leur catégorie en préfixe dans le panier/récapitulatif (ex. « Pâtes Bolognaise », « Subitowich Milano », « Salade Exotique », « Boisson Grande bouteille »). Un garde-fou évite le doublon quand le nom contient déjà le mot (« Boisson 33cl » reste tel quel, pas de « Boisson Boisson 33cl »). Les pizzas (choisies par taille) ne sont pas concernées : leur variante « (Solo/Duo/Quatro/XXL) » suffit déjà à les distinguer, y compris des Subitowichs homonymes.

Rien n'est changé sur la carte elle-même (les boutons "Ajouter" sous chaque produit) — uniquement ce qui s'affiche dans le panier et le récapitulatif.

## Vérifications réellement effectuées
- Clic réel sur "Bolognaise" (section Pâtes) → panier affiche **« Pâtes Bolognaise »**.
- Clic réel sur "Exotique" (Salades) → **« Salade Exotique »**.
- Clic réel sur "Grande bouteille" (Boissons) → **« Boisson Grande bouteille »**.
- Clic réel sur "Milano" et "Kebab" dans la section Subitowichs → **« Subitowich Milano »**, **« Subitowich Kebab »**.
- Clic réel sur la pizza "Milano" (taille Solo) → reste **« Milano (Solo) »**, coexiste sans confusion avec « Subitowich Milano » dans le même panier (prix différents : 11 € vs 6 €, vérifié).
- `node --check` : syntaxe valide. Aucune erreur console sur `menu.html` et `vegetarien.html`.

## Verdict
Conforme à la demande : impossible désormais de confondre un produit avec un autre au téléphone, y compris les cas de noms identiques entre deux catégories. **PASS.**

## À republier
`assets/js/cart.js`, par FTP.
