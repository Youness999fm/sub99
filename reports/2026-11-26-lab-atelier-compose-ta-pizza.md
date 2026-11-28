# Atelier « Compose ta pizza » — prototype isolé

Date : 2026-11-26

## Demandé

Une expérience front-end « atelier de préparation en direct » pour la
composition de pizza : mur de bacs d'ingrédients en haut, pizza au centre qui
se garnit réellement, panneaux d'étape et de résumé, parcours imposé
taille → sauce → viandes → légumes → fromages → récapitulatif. Exigence
explicite : **zone isolée, aucun branchement à la production, aucune
régression**.

## Fait

Module autonome monté sur un seul conteneur, dans `lab/` + `assets/{css,js}/lab/`.
Détail de l'architecture, des choix techniques et de l'isolation :
[`lab/README.md`](../lab/README.md).

Fichiers créés (16) :

```
lab/compose-ta-pizza.html
lab/README.md
assets/css/lab/atelier.css
assets/js/lab/atelier/index.js
assets/js/lab/atelier/data/ingredients.js
assets/js/lab/atelier/core/{store,price,random}.js
assets/js/lab/atelier/render/{svg-defs,placement,pizza-canvas,tray,panels,progress}.js
assets/js/lab/atelier/anim/{motion,stage}.js
reports/2026-11-26-lab-atelier-compose-ta-pizza.md
```

Fichier de production modifié (1) : `.vercelignore` — trois lignes d'exclusion
(`lab/`, `assets/css/lab/`, `assets/js/lab/`) pour que le prototype ne parte
jamais en ligne. Aucun autre fichier du site n'est touché, aucun script du site
n'est chargé par la page de lab.

## Vérifié en navigateur (serveur local port 8090)

Parcours complets rejoués : Quatro/tomate/chorizo/champignons/olives,
XXL/barbecue/poulet+lardons/oignons+poivrons/parmesan+chèvre,
Duo/crème/kebab/câpres/bleu jusqu'au récapitulatif.

- Aucune erreur ni avertissement console sur tout le parcours.
- Prix : XXL + bbq + poulet + lardons + oignons + poivrons + parmesan + chèvre
  = 52,00 € (attendu 25,50 + 3,50 + 4 + 4 + 3,50 + 3,50 + 4 + 4) ✔
  Duo + crème + kebab + câpres + bleu = 18,50 € ✔
  Solo + merguez = 10,50 € (sauce tomate incluse) ✔
- Retrait d'un ingrédient : les 11 morceaux disparaissent, le prix se décrémente.
- Ajout puis retrait immédiat pendant l'animation : rien ne reste sur la pizza
  (la tâche en file revérifie l'état avant de poser).
- Changement de taille avec garniture déjà posée : la garniture est replacée,
  avec un nombre de morceaux adapté (merguez 9 → 7 en passant en Solo).
- Aucun élément volant orphelin dans le calque d'animation après les séquences.
- Mise en page 3 colonnes à 1366 px (262 / 589 / 296, alignées), repliée en
  colonne unique sous 1080 px, bacs défilables horizontalement sous 680 px.

## Défauts trouvés et corrigés pendant la vérification

1. **La sauce ne s'affichait pas.** Le masque d'étalage et le clip de la pâte
   portaient un `translate(500,500)` en trop : masques et clips sont résolus
   dans l'espace utilisateur de l'élément qui les référence — déjà le groupe
   pizza centré. Supprimé, plus un `maskUnits="userSpaceOnUse"` explicite.
2. **La mozzarella masquait toute la sauce** (rayon trop large), et sa
   répartition purement aléatoire laissait des paquets d'un côté et des trous
   de l'autre. Passée en distribution tournesol (angle d'or) + jitter, rayon
   réduit pour laisser un liseré de sauce, liseré doré ajouté sur les bords.
3. **Garniture illisible** : à l'échelle réaliste les morceaux faisaient des
   points. Facteur d'agrandissement `ART_BOOST = 1.35` dans `placement.js`.
4. **Bacs à moitié vides** : les échelles de remplissage étaient environ deux
   fois trop petites, recalibrées ingrédient par ingrédient.
5. **Pastilles de taille indiscernables** : rendues proportionnelles au
   diamètre réel (26 → 50 cm) au lieu de l'échelle compressée du canvas.
6. **Les bacs restaient visibles à l'étape finale** : `[hidden]` était écrasé
   par `display: flex`. Règle `.tray__row[hidden] { display: none }` ajoutée.
7. **Le poulet disparaissait dans le fromage** (même beige) : dégradé assombri.

## Limites assumées

- Le rendu n'a pas été testé sur un iPhone réel : les filtres SVG
  (`feTurbulence`, `feDisplacementMap`, filtre gooey) sont le point à
  surveiller côté performance. Ils ne sont appliqués qu'au rendu statique,
  jamais pendant une animation.
- Pas de boucle adversaire / juge formelle sur cette mission : c'est un
  prototype explicitement hors production, et l'utilisateur a demandé une base
  à itérer plutôt qu'un livrable fermé. Les points de décision ouverts sont
  listés dans `lab/README.md` (arbitrage sauces curry/barbecue, intégration au
  panier, sort de `composer.html`).
- Rien n'est commité.

## Suite

Voir « Reste à faire avant intégration » dans [`lab/README.md`](../lab/README.md).
