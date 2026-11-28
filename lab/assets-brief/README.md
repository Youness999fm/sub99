# L'ATELIER SUBITO — Production des ressources par génération IA

Ce dossier est le **cahier de production des images**. Il ne contient pas de
code : il dit quoi générer, comment, sous quel nom, et à quelle taille réelle
correspond chaque chose.

Le moteur lit un manifeste et compose la scène. Tant qu'un fichier manque, il
affiche une vignette **« ASSET MANQUANT »** bien visible — jamais un faux
photoréalisme déguisé.

---

## 1. Les quatre règles qui décident de la réussite

### Règle 1 — Une seule recette de lumière, recopiée mot pour mot

C'est le point qui fait échouer tous les compositings amateurs : quarante images
générées séparément arrivent avec quarante éclairages différents, et l'œil le
voit instantanément (§09 du cahier des charges).

Chaque prompt de [`prompts.md`](prompts.md) commence par le **même bloc de
style**. Ne le reformule pas, ne le raccourcis pas, ne le « améliore » pas.
Copie-colle. S'il faut le changer, change-le **partout en même temps** et
régénère tout.

### Règle 2 — Aucune ombre dans les images d'ingrédients

Contre-intuitif, mais essentiel. Les ombres de contact sont **calculées par le
moteur** (§51), en fonction de l'endroit où le morceau se pose et de ce qu'il y
a dessous. Une ombre déjà peinte dans l'image arriverait toujours au mauvais
endroit et dans la mauvaise direction.

Donc : ingrédients et ustensiles **sans ombre, fond transparent**. Les ombres
sont autorisées uniquement dans le plan de travail et dans les bacs (où elles
font partie de l'objet).

### Règle 3 — Les planches en grille

Pour chaque ingrédient, **une seule image** contenant 12 morceaux distincts,
disposés en **grille 4 colonnes × 3 rangées**, chaque morceau **centré dans sa
cellule** et ne la débordant pas. Le moteur découpe les 12 variantes tout seul.

```
1024 × 768 px  →  cellules de 256 × 256 px

┌──────┬──────┬──────┬──────┐
│  1   │  2   │  3   │  4   │
├──────┼──────┼──────┼──────┤
│  5   │  6   │  7   │  8   │
├──────┼──────┼──────┼──────┤
│  9   │  10  │  11  │  12  │
└──────┴──────┴──────┴──────┘
```

Les 12 morceaux doivent être **réellement différents** (taille, forme,
orientation, épaisseur) — pas le même morceau pivoté douze fois (§47). S'ils
sortent trop semblables, régénère en insistant sur `each piece distinctly
different in size and shape`.

### Règle 4 — Le fond transparent

Objectif : **PNG avec canal alpha**. Si ton outil ne sait pas le produire,
génère sur un **fond vert uni `#00B140`** parfaitement plat et sans ombre
portée, puis détoure (Photoroom, remove.bg, ou l'outil de détourage de ton
générateur). Vérifie ensuite l'absence de liseré vert ou blanc sur les bords
(§48) : ouvre le PNG sur un fond noir **et** sur un fond blanc.

---

## 2. Produits : réponses du restaurant et décisions prises

Confirmé par Subito Pizza :

| Produit | Réalité |
|---|---|
| **Olives** | noires, **dénoyautées mais entières** — pas de rondelles |
| **Fromage de base** | **en julienne** : bâtonnets longs et droits, pas du râpé frisé |
| **Jambon** | **en lamelles** |
| **Sauce barbecue** | bien **orange**, et proposée **en sauce de base** comme la tomate et la crème |

Tranché par moi en carte blanche, faute d'information contraire — corrigeable
en une ligne dans `prompts.md` si c'est faux :

| Produit | Décision | Raison |
|---|---|---|
| Mortadelle | nature, sans pistache | §27 interdit d'ajouter des inclusions non confirmées |
| Poulet | cuit nature, **sans marque de grill** | §24 interdit d'inventer des traces de grillade |
| Poivrons | mélange rouge et vert | usage le plus courant en pizzeria |
| Parmesan | **râpé fin** (et non copeaux) | cohérent avec un supplément au poids ; entraîne l'animation en pluie fine |
| Chèvre | rondelles de bûche avec croûte fine | §42 |
| Champignons | champignons de Paris **frais émincés** | plus appétissant que la conserve, et la lamelle reste identifiable (§33) |

## 3. Les trois vagues

Ne génère pas 68 images d'un coup. On valide le pipeline sur les 14 de la
vague 1 avant d'investir dans le reste.

### Vague 1 — Prouver le photoréalisme (14 images + 1 masque)

Plan de travail, pâte, les 4 sauces, les 4 bacs de sauce, la louche.

À l'arrivée de ces fichiers, la **scène de la sauce est entièrement
photoréaliste** : la louche puise dans un vrai bac, verse, et la vraie texture
de sauce se révèle dans le sillage. C'est le test du §03 sur le moment le plus
difficile de l'expérience. Si ça passe, le reste suit la même recette.

### Vague 2 — La bibliothèque alimentaire (44 images)

22 ingrédients × (1 bac + 1 planche de 12 morceaux).
Le fromage de base compte comme un ingrédient à part entière.

### Vague 3 — Ustensiles et mains (9 images)

Pince, râpe, cuillère, pelle à pizza, et les poses de main.

---

## 4. Convention de nommage

Le moteur attend **exactement** ces chemins, depuis la racine du dépôt.
Un fichier mal nommé = un « ASSET MANQUANT » à l'écran.

```
assets/img/lab/atelier/
├── scene/
│   └── worktop.jpg                   plan de travail inox, 2560×1097 mini, pas de transparence
├── dough/
│   ├── dough-solo.png                1024×1024, transparent
│   ├── dough-duo.png
│   ├── dough-quatro.png
│   └── dough-xxl.png
├── sauce/
│   ├── texture-tomate.jpg            1400×1400, plein cadre, PAS de transparence
│   ├── texture-creme.jpg             (le contour du disque et l'étalement
│   ├── texture-curry.jpg              sont générés par le moteur, pas peints
│   └── texture-barbecue.jpg           dans la photo — voir prompts.md §1.6)
├── pan/
│   ├── pan-sauce-tomate.png          1024×768, transparent (bac inox rempli)
│   ├── pan-sauce-creme.png
│   ├── pan-sauce-curry.png
│   ├── pan-sauce-barbecue.png
│   ├── pan-chorizo.png
│   └── …                             un par ingrédient (voir prompts.md)
├── sheet/
│   ├── chorizo.png                   1024×768, transparent, grille 4×3
│   └── …                             un par ingrédient
├── tool/
│   ├── ladle.png                     512×1024, transparent
│   ├── ladle-bowl-mask.png           512×1024, le creux de la louche en blanc sur transparent
│   ├── grater.png
│   ├── tongs-open.png
│   ├── tongs-closed.png
│   ├── spoon.png
│   └── peel.png                      pelle à pizza, 1400×900
└── hand/
    ├── hand-open.png                 main gantée, doigts ouverts
    ├── hand-pinch.png                doigts pincés tenant un morceau
    ├── hand-fist.png                 poignée fermée
    └── hand-flat.png                 main à plat (ajustement de la pâte)
```

**Minuscules, tirets, pas d'accents, pas d'espaces.** `pan-viande-hachee.png`,
pas `pan-viande hachée.png`.

---

## 5. Échelle physique

Le moteur a besoin de la **taille réelle en millimètres** de chaque morceau pour
respecter le §50 : une rondelle de chèvre ne grossit pas sur une XXL, il y en a
simplement plus.

L'ancre de calibration, ce sont les diamètres de pâte : **260 / 315 / 400 /
500 mm**. Tout le reste s'y rapporte.

Mes estimations de départ sont dans le manifeste
(`assets/js/lab/atelier/data/assets.js`, champ `mm`). **Elles sont à corriger
avec vos vrais produits** : mesure une rondelle de chorizo, une lamelle de
kebab, une rondelle de chèvre au réglet, et donne-moi les chiffres. C'est cinq
minutes de travail qui décident de la crédibilité de toute la pizza.

---

## 6. Contrôle à la réception de chaque image

Avant de déposer un fichier, vérifie :

- [ ] Vue strictement de dessus, pas d'angle, pas de perspective.
- [ ] Lumière venant du **haut-gauche**, comme toutes les autres images.
- [ ] Balance des blancs neutre — un blanc est blanc, pas crème ni bleuté.
- [ ] Aucune ombre portée (sauf plan de travail et bacs).
- [ ] Fond réellement transparent, sans liseré (teste sur fond noir ET blanc).
- [ ] Aucun texte, logo, filigrane, main, ustensile parasite.
- [ ] Aucun décor ajouté : pas de basilic, pas de tomate cerise, pas de farine
      saupoudrée artistiquement (§08).
- [ ] Pour les planches : 12 morceaux **vraiment différents**, un par cellule,
      aucun débordement.
- [ ] L'ingrédient est **cru / en préparation**, pas cuit (§39) — sauf s'il est
      réellement précuit chez vous (poulet, kebab).

Un fichier qui rate un seul de ces points pollue toute la scène. Régénère
plutôt que de « faire avec ».

---

## 7. Droits

§05 : la présence d'une image dans un moteur de recherche n'autorise pas son
usage commercial. Pour les images générées, **vérifie les conditions
d'utilisation de ton outil** : certains réservent l'usage commercial aux
formules payantes. Note l'outil utilisé et la date dans
[`SOURCES.md`](SOURCES.md) au fur et à mesure — ça évitera une mauvaise surprise
le jour de la mise en ligne.
