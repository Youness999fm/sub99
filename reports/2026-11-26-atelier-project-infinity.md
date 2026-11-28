# Atelier Compose ta pizza — virage « PROJECT INFINITY »

Date : 2026-11-26 (suite de `2026-11-26-lab-atelier-compose-ta-pizza.md`)

## Demandé

Cahier des charges de 70+ sections : expérience photoréaliste, **interdiction
du SVG/CSS pour représenter les aliments** (§04), test du §03 (une capture sans
interface doit passer pour une photo culinaire), cuisine panoramique continue,
mains du pizzaiolo filmées, écran unique sans défilement.

## Point bloquant identifié et remonté

Le §69 demande explicitement de signaler les ressources indispensables
manquantes. C'est le cas : l'expérience repose à ~90 % sur une bibliothèque
photo/vidéo qui n'existe pas.

Vérifié : les 81 fichiers de `photos_originales_avant_optimisation/` sont un
**catalogue produit** (pizzas cuites cadrées sur le fond vert/rouge de la
marque, packshots type Häagen-Dazs), et `visuels-references/` ne contient que
des visuels réseaux sociaux et le logo. Aucune photo de plan de travail, de
pâte crue vue de dessus, de bac gastronorme ni d'ingrédient détouré.

Voie retenue par l'utilisateur : **génération IA externe** — je rédige les
spécifications, il génère avec son propre outil.

## Livré

### Pack de production des images

- `lab/assets-brief/README.md` — méthode, 4 règles structurantes, nommage,
  échelle physique, checklist de réception, 3 vagues.
- `lab/assets-brief/prompts.md` — 67 prompts en anglais, un par ressource, avec
  une description propre à chaque ingrédient (test de reconnaissance du §22).
- `lab/assets-brief/SOURCES.md` — tableau de provenance et de droits (§05).

Décisions de conception notables :
- **Bloc de lumière unique** recopié à l'identique dans chaque prompt. C'est le
  point qui fait échouer les compositings multi-sources (§09).
- **Planches 4×3** : 12 morceaux par image, découpés et recadrés par le moteur.
  44 générations au lieu de 264.
- **Textures de sauce en plein cadre** plutôt qu'en disque détouré : le contour
  et l'étalement restent pilotés par le moteur, donc jamais figés (§21).
- **Aucune ombre dans les images d'ingrédients** : les ombres de contact sont
  calculées au placement (§51).
- Signalé : les **mains** sont le mauvais cas d'usage pour la génération IA ;
  un tournage au téléphone est recommandé à la place.

### Pipeline d'intégration

- `assets/js/lab/atelier/data/assets.js` — manifeste : chemin, dimensions
  attendues, taille réelle en millimètres, repli à 12 fichiers séparés.
- `assets/js/lab/atelier/core/asset-loader.js` — chargement, contrôle des
  dimensions, **détection d'un fond non détouré et des liserés de détourage**
  (analyse des pixels semi-transparents, §48), découpe et recadrage des
  planches, vignette « ASSET MANQUANT ».
- `lab/assets-check.html` — tableau de bord des 68 ressources : vignettes sur
  damier (un carré blanc = fond non détouré), bascule sur fond clair pour
  chercher les contours sombres, compteur conformes / à corriger / manquantes.
- `assets/img/lab/` ajouté au `.vercelignore`.

### Réponses produit intégrées

Confirmé par le restaurant : olives **noires dénoyautées entières**, fromage de
base **en julienne**, jambon **en lamelles**, barbecue **orange et proposée en
sauce de base**. Tranché en carte blanche faute d'information : mortadelle sans
pistache, poulet sans marque de grill, poivrons rouge + vert, parmesan râpé
fin, chèvre en rondelles de bûche, champignons de Paris frais.

Répercuté dans les prompts, dans le manifeste (mm) et dans le rendu maquette :
olive entière, lamelle de jambon, parmesan plus fin, et surtout le fromage de
base **n'est plus une nappe fondue mais une couche de julienne crue** —
l'ancien rendu contredisait le §39 (la pizza n'est pas cuite à ce stade).

### Export d'aperçu

`renderStaticSvg()` dans `pizza-canvas.js` rend une composition complète en SVG
autonome **sans DOM**, et `lab/tools/apercu.mjs` l'appelle en ligne de commande.
C'est la brique de l'aperçu partageable du §63, et ça permet de contrôler un
rendu sans navigateur.

## Deux bugs réels corrigés

1. **Plantage pendant les transitions d'étape.** Les anciens bacs restent
   quelques centaines de millisecondes dans le DOM pendant leur animation de
   sortie ; la resynchronisation des prix tentait de lire le tarif d'une carte
   de taille comme si c'était un ingrédient
   (`Cannot read properties of undefined (reading 'includedInBase')`). Les
   cartes sortantes sont désormais marquées et ignorées, et `previewPrice`
   tolère un ingrédient absent.

2. **File de mise en scène bloquée à vie en arrière-plan.** Quand l'onglet
   passe en arrière-plan, le navigateur gèle `document.timeline` : les
   animations restent à `currentTime: 0` et leur promesse `finished` ne se
   résout jamais. La file bloquait, et comme elle est bornée à 3 tâches, tous
   les clics suivants étaient silencieusement ignorés — l'utilisateur
   retrouvait en revenant une pizza figée au milieu d'un geste. `motion.js`
   traite maintenant l'onglet caché comme le mode « mouvement réduit » (état
   final appliqué immédiatement) et termine d'autorité les animations en cours
   au moment où l'onglet disparaît. Découvert parce que la fenêtre de preview
   s'était mise en arrière-plan — c'est un vrai défaut, pas un artefact de test.

## Vérifié en navigateur

Parcours complets rejoués après chaque correctif. Zéro erreur console.
Totaux exacts : Quatro + jambon + chorizo + olives + champignons = 28,50 € ;
XXL chargée = 52,00 € ; Solo + merguez = 10,50 €. Retrait d'ingrédient,
ajout/retrait pendant l'animation, changement de taille avec garniture posée :
conformes. Aucun élément volant orphelin.

Calibrage visuel repris trois fois sur la julienne : trop clairsemée elle
ressemblait à de la paille jetée sur du rouge. Densité portée à ~880 bâtonnets,
géométrie simplifiée à une forme par bâtonnet pour la performance, et voile
crème sous la couche.

## État réel

**Fait :** la moitié « données, pipeline, règles métier, fiabilité » de PROJECT
INFINITY, plus tout ce qui prépare l'arrivée des photos.

**Pas fait :** la moitié « mise en scène » — écran unique fixe 1920×1080 sans
défilement (§11), cuisine panoramique continue à 6 stations (§07), caméra qui
accompagne la pizza d'une station à l'autre (§18), scène finale à la pelle
(§61), mode express (§60). Ce travail est volontairement reporté : il n'a pas
été entrepris à l'aveugle pendant que la vérification visuelle était
indisponible, et une partie de son intérêt (plan de travail inox photographique,
bacs réels) dépend de toute façon de la vague 1.

**Le rendu des aliments reste une maquette SVG**, explicitement non conforme au
§04. Il tient lieu de remplacement jusqu'à l'arrivée des photos ; le moteur
bascule sur les ressources photographiques dès qu'elles sont déposées.

## Suite

1. Générer les 14 images de la vague 1 (`lab/assets-brief/prompts.md`).
2. Contrôler dans `lab/assets-check.html`.
3. Construire le compositing photo et la scène panoramique sur ces ressources.
4. Le message du cahier des charges était coupé au §70 : les sections 71+ n'ont
   pas été prises en compte.

---

## Deuxième passe — plan de travail et bacs (carte blanche)

### Le plan de travail

Nouveau module `render/kitchen.js`. La scène repose désormais sur **une seule
surface inox continue** : le rail réfrigéré où les bacs sont encastrés et la
zone de travail où repose la pizza appartiennent au même plan (§07, §08). Plus
aucun dégradé CSS ne simule du métal.

L'inox est monté en couches : courbure de la tôle, grain anisotrope du brossage
(`feTurbulence` très étiré horizontalement), rayures d'usage longues et rares,
halo de la lampe en haut à gauche, assombrissement des angles. Puis la farine —
voile diffus, grains avec leur micro-ombre, et une trace balayée le long du
rail.

L'arête du rail n'est pas une proportion fixe : elle est **mesurée sur la
rangée de bacs réelle** et suivie par un `ResizeObserver`, plus une
resynchronisation à chaque changement d'étape (le nombre de bacs change, donc
la hauteur de la rangée aussi).

### Les bacs

Géométrie refaite en trois anneaux concentriques — bord roulé, paroi, fond —
parce qu'un rectangle inséré dans un autre lit comme une étiquette, pas comme
un récipient. Bord roulé avec arête vive au nord-ouest et extinction au
sud-est, paroi intérieure dont le côté éclairé est à l'opposé de la source,
ombre portée du bac sur le rail, reflets longs du néon.

Le contenu est **entassé** et non étalé : densité biaisée vers le centre,
morceaux plus gros au sommet du tas, tri par profondeur pour que l'empilement
soit cohérent, occlusion contre les parois en `multiply`, lumière sur le haut
du tas en `screen`.

### Trois défauts corrigés pendant cette passe

1. `.atelier-app > *` écrasait le positionnement absolu de la cuisine, qui se
   retrouvait avec une hauteur nulle — fond resté noir. Spécificité renforcée.
2. `preserveAspectRatio="none"` déformait le bruit du brossage : sur une
   fenêtre étroite le grain basculait à la verticale. Passé en `slice`.
3. Les commentaires SVG contenaient des suites de tirets. Toléré par
   l'analyseur HTML, **fatal** dès que le SVG est servi en fichier autonome :
   l'aperçu exporté ne s'ouvrait pas. Corrigé.

### Export

`renderStaticSvg()` pose maintenant la pizza sur le vrai plan de travail, pas
sur un aplat gris.
