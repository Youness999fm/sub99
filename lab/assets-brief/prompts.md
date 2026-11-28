# Pack de prompts — L'Atelier Subito

Les prompts sont **en anglais** : tous les générateurs d'images donnent des
résultats nettement supérieurs en anglais, y compris pour de la cuisine
française. Les commentaires sont en français.

Lis [`README.md`](README.md) avant de commencer, en particulier les quatre
règles et la liste des dix points à me confirmer.

---

## BLOC DE STYLE — à copier-coller en tête de CHAQUE prompt

> **Ne le reformule jamais.** C'est lui qui garantit que quarante images
> générées séparément aient l'air d'appartenir à la même séance photo.

```
Professional food commercial photography. Shot from directly overhead at a
perfect 90 degree top-down angle, 100mm macro lens, no perspective distortion,
no tilt. One large soft diffused key light from the upper left at 45 degrees,
soft white fill from the lower right, neutral 5200K white balance, no colour
cast, pure whites stay pure white. Natural realistic food colours, no
saturation boost, no warm filter. Entire subject in sharp focus, visible
micro-texture, natural moisture and sheen. Photorealistic.
```

## BLOC NÉGATIF — à copier-coller en tête de CHAQUE prompt

```
Negative: illustration, cartoon, drawing, painting, vector, 3D render, CGI,
plastic, toy, glossy plastic, text, watermark, logo, signature, hands, fingers,
utensils, garnish, basil, herbs, parsley, cherry tomatoes, props, decoration,
dark vignette, dramatic lighting, orange instagram filter, shallow depth of
field, blurry, tilted angle, perspective view, side view.
```

## BLOC DÉCOUPE — à ajouter pour tout ce qui doit être détouré

```
Isolated on a fully transparent background. No shadow, no reflection, no
ground plane, no surface underneath.
```

---

# VAGUE 1 — Prouver le photoréalisme (14 images)

À la réception de ces quatorze fichiers, la scène de la sauce devient entièrement
photographique : la louche puise dans un vrai bac, verse, et la vraie matière
se révèle dans le sillage de l'ustensile.

---

## 1.1 — Le plan de travail

**Fichier :** `assets/img/lab/atelier/scene/worktop.jpg`
**Format :** le plus large possible, idéalement 21:9 (ex. 2560 × 1097). JPEG, pas de transparence.
**Ombres :** autorisées (elles appartiennent à la surface).

```
[BLOC DE STYLE]

Subject: an empty professional stainless steel kitchen worktop in a pizzeria,
brushed steel finish with the brushing lines running horizontally across the
frame. Fine natural micro-scratches from daily use, subtle variations of
silver-grey, soft broad reflections of the overhead light, no mirror-like
reflections. The surface is spotless and well maintained but clearly in daily
professional use, not brand new. A few scattered grains of flour. Ultra wide
panoramic framing. Completely empty, nothing on the surface.

[BLOC NÉGATIF]
```

> **Note moteur :** si ton outil plafonne en 16:9, génère en 16:9. Le moteur
> étend la surface par symétrie horizontale — l'inox brossé se raccorde bien.

---

## 1.2 à 1.5 — Les quatre pâtes

**Fichiers :** `dough/dough-solo.png`, `dough-duo.png`, `dough-quatro.png`, `dough-xxl.png`
**Format :** 1024 × 1024, PNG transparent, pâte centrée remplissant ~95 % du cadre.

Les quatre images sont identiques en style ; seule la mention de diamètre
change, pour que la main du générateur varie légèrement l'épaisseur du bord.

```
[BLOC DE STYLE]

Subject: a single disc of raw hand-stretched pizza dough, seen from directly
above, ready to be topped. Pale ivory colour with subtle natural variations.
A thin flat centre and a modest raised rim about 15mm wide — a French pizzeria
style base, NOT a thick puffy Neapolitan cornicione. Slightly irregular organic
outline, never a perfect circle. Light dusting of flour, a few fine finger
marks from shaping, small air bubbles visible under the surface, delicate
uneven texture. The dough is raw and uncooked: no browning, no golden colour,
no char, no bubbles that have baked. Diameter 26 cm.

[BLOC DÉCOUPE]
[BLOC NÉGATIF]
```

Pour les trois autres, remplacer la dernière phrase par
`Diameter 31.5 cm.` / `Diameter 40 cm.` / `Diameter 50 cm.`

> **Pourquoi quatre et pas une mise à l'échelle :** une Solo et une XXL n'ont
> pas le même rapport bord/centre. Agrandir la Solo donnerait un bourrelet de
> 3 cm sur la XXL. Si tu ne veux en générer qu'une, génère la **Duo** et je
> compose les autres — mais les quatre sont nettement meilleures.

> ⚠ **Référence interne :** regarde `photos_originales_avant_optimisation/photo-24.jpg`.
> C'est une vraie pizza Subito cuite : bord doré modéré, base fine, pas de
> grosse bordure napolitaine. La pâte crue doit mener à ce résultat-là.

---

## 1.6 à 1.9 — Les quatre textures de sauce

**Fichiers :** `sauce/texture-tomate.jpg`, `texture-creme.jpg`, `texture-curry.jpg`, `texture-barbecue.jpg`
**Format :** 1400 × 1400, JPEG, **plein cadre** (la matière remplit toute l'image, pas de bord, pas de fond).

> **Pourquoi plein cadre et pas un disque détouré :** le contour du disque de
> sauce et son étalement progressif sont générés par le moteur, via un masque
> piloté par la trajectoire de la louche (§21). Si le contour était peint dans
> la photo, il serait figé et toujours identique. On te demande donc **la
> matière**, le moteur s'occupe de la forme. C'est aussi beaucoup plus facile à
> générer proprement.

### Tomate

```
[BLOC DE STYLE]

Subject: an extreme close-up of raw tomato pizza sauce spread in a thin layer,
filling the entire frame edge to edge. Natural deep red, not orange, not
scarlet. Visible crushed tomato pulp, small seeds and skin fragments, uneven
thickness with thicker ridges and thinner translucent patches, wet glossy
highlights catching the key light, fine swirl marks left by the back of a
ladle. Raw and uncooked. Texture fills the whole image, no edge, no background
visible, no plate, no dough.

[BLOC NÉGATIF]
```

### Crème fraîche

```
[BLOC DE STYLE]

Subject: an extreme close-up of thick crème fraîche spread in a layer, filling
the entire frame edge to edge. Pure ivory white, not yellow, not grey. Thick
dense dairy texture with soft peaks and ridges left by spreading, satin sheen
rather than wet gloss, small folds and air pockets. Raw and uncooked. Texture
fills the whole image, no edge, no background visible.

[BLOC NÉGATIF]
```

### Curry / indienne

```
[BLOC DE STYLE]

Subject: an extreme close-up of a creamy Indian-style curry sauce spread in a
layer, filling the entire frame edge to edge. Warm golden yellow with slight
orange undertones, clearly distinguishable from plain cream and from barbecue
sauce. Smooth creamy body with fine spice particles suspended in it, gentle
sheen, uneven thickness. Texture fills the whole image, no edge, no background
visible.

[BLOC NÉGATIF]
```

### Barbecue

```
[BLOC DE STYLE]

Subject: an extreme close-up of barbecue sauce spread in a layer, filling the
entire frame edge to edge. Amber orange colour, warm and bright, NOT dark
brown, NOT mahogany. Thick slightly syrupy body, glossy wet highlights, smooth
with fine texture variations and a few darker streaks. Texture fills the whole
image, no edge, no background visible.

[BLOC NÉGATIF]
```

**Confirmé par le restaurant :** la barbecue est bien **orange**, et elle est
bien proposée **en sauce de base** (au même titre que tomate et crème), pas
seulement en supplément. Les majuscules dans le prompt sont volontaires : sans
elles, la plupart des générateurs sortent spontanément un marron foncé.

---

## 1.10 — Les quatre bacs de sauce

**Fichiers :** `pan/pan-sauce-tomate.png`, `pan-sauce-creme.png`, `pan-sauce-curry.png`, `pan-sauce-barbecue.png`
**Format :** 1024 × 768, PNG transparent, le bac remplit ~92 % du cadre.
**Ombres :** celles **à l'intérieur** du bac uniquement. Pas d'ombre portée au sol.

```
[BLOC DE STYLE]

Subject: a stainless steel gastronorm food pan seen from directly above,
filled with tomato pizza sauce. The polished steel rim is visible all the way
around the pan, with its thickness, its rounded corners and a soft reflection
of the overhead light. The pan is deep enough that a soft shadow falls inside
along the upper-left wall. The sauce fills the pan almost to the rim with a
naturally uneven surface, slightly lower near the edges, with ladle marks on
the surface. Rectangular pan, straight edges, photographed square to the frame.

[BLOC DÉCOUPE]
[BLOC NÉGATIF]
```

Pour les trois autres, remplacer `tomato pizza sauce` par
`thick ivory-white crème fraîche` / `golden Indian curry sauce` /
`amber orange barbecue sauce`, et reprendre à chaque fois la description de
couleur du §1.6-1.9 correspondant.

---

## 1.11 — La louche

**Fichiers :** `tool/ladle.png` **et** `tool/ladle-bowl-mask.png`
**Format :** 512 × 1024, PNG transparent. Manche vers le haut, cuillère en bas.

```
[BLOC DE STYLE]

Subject: a professional stainless steel kitchen ladle, seen from directly
above, empty. The bowl of the ladle is at the bottom of the frame and the
handle runs straight up to the top of the frame. Polished steel with soft
broad reflections and fine use marks, a darker shaded interior inside the bowl,
a black or dark grey grip on the upper part of the handle. Clean, professional,
no food on it.

[BLOC DÉCOUPE]
[BLOC NÉGATIF]
```

**Le second fichier, `ladle-bowl-mask.png`,** ne se génère pas : c'est un
masque que tu fabriques en deux minutes. Prends `ladle.png`, peins en **blanc
opaque** uniquement le creux intérieur de la cuillère (la zone que la sauce
remplirait), laisse tout le reste **transparent**, enregistre aux mêmes
dimensions. Le moteur y verse la texture de sauce du bac sélectionné — c'est ce
qui fait que la louche se remplit vraiment de la bonne sauce, et que la quantité
visible diminue pendant le versement (§21).

---

# VAGUE 2 — La bibliothèque alimentaire

**Deux fichiers par ingrédient**, à générer seulement une fois la vague 1
validée.

## Gabarit « bac » — `pan/pan-<id>.png`

1024 × 768, PNG transparent.

```
[BLOC DE STYLE]

Subject: a stainless steel gastronorm food pan seen from directly above,
generously filled with << DESCRIPTION >>. The polished steel rim is visible all
the way around with its thickness and rounded corners, soft reflections of the
overhead light, and a soft shadow inside along the upper-left wall. The
ingredient is piled naturally and unevenly, slightly heaped in the middle,
pieces overlapping and falling at different angles, a few pieces leaning
against the pan wall. Not arranged, not styled, not symmetrical — exactly as a
pizzaiolo would leave it during service. Rectangular pan, photographed square
to the frame.

[BLOC DÉCOUPE]
[BLOC NÉGATIF]
```

## Gabarit « planche » — `sheet/<id>.png`

1024 × 768, PNG transparent, grille 4 × 3 de cellules 256 × 256.

```
[BLOC DE STYLE]

Subject: a technical reference sheet of exactly 12 separate pieces of
<< DESCRIPTION >>, arranged in a regular grid of 4 columns and 3 rows on a
fully transparent background. Each piece is centred in its own cell, well
separated from its neighbours, never touching and never overlapping, and never
crossing the boundary of its cell. The 12 pieces are genuinely different from
each other: different size, different outline, different thickness, different
orientation — not the same piece repeated or rotated. Each piece is sharp,
fully visible, photographed from directly above.

[BLOC DÉCOUPE]
[BLOC NÉGATIF]
```

> Si ton outil n'obéit pas à la grille, alternative acceptable : génère **12
> images séparées** nommées `sheet/<id>-01.png` … `-12.png`, 256 × 256 chacune.
> Le moteur accepte les deux formats. C'est juste douze fois plus long.

---

## Les descriptions à insérer dans `<< DESCRIPTION >>`

La colonne **mm** est la dimension réelle du morceau, utilisée par le moteur
pour l'échelle. **Mesure-les sur vos vrais produits et corrige-moi.**

### Viandes et poissons

| id | mm | `<< DESCRIPTION >>` |
|---|---|---|

**`viande-hachee`** — 10 mm
```
cooked seasoned minced beef crumbles, loose irregular clusters from 3 to 12 mm,
browned on the outside with paler fibrous interior visible on broken surfaces,
slightly glossy from rendered fat, some crumbles clumped together in small
groups, coarse uneven grind
```

**`mortadelle`** — 45 mm — *décision : nature, sans pistache*
```
pieces of Italian mortadella cut from a thick slice, pale pink, very fine
smooth homogeneous paste with only a few tiny pale fat specks, no pistachios,
soft slightly folded cut edges, faint sheen, pieces of irregular shape as if
cut by hand
```

**`merguez`** — 26 mm
```
cooked merguez sausage cut into rounds about 25 mm across, the thin natural
casing visible as a darker ring around the edge, coarse red-orange spiced
interior with clearly visible meat grain and small fat specks, a few darker
caramelised spots, slices of slightly different thickness
```

**`chorizo`** — 45 mm
```
thin slices of Spanish chorizo sausage, deep orange-red cured paste with
irregular white fat marbling scattered through it, thin casing edge, slightly
curled and cupped edges, matte surface with a faint paprika oil sheen, every
slice different
```

**`kebab`** — 50 × 14 mm
```
cooked doner kebab meat shaved into thin irregular strips 30 to 60 mm long,
naturally curled, folded and twisted, dark caramelised browned edges contrasting
with paler interior, clearly visible meat fibres running along each strip,
varying width and thickness, soft and pliable looking
```

**`jambon`** — 55 × 14 mm — *confirmé : lamelles*
```
cooked ham cut into thin strips about 50 mm long and 10 to 16 mm wide, pale
natural pink, visible fine muscle grain running along each strip, thin pale
connective lines, moist soft surface, strips naturally limp and slightly
folded or curled, varying length and width
```

**`lardons`** — 20 × 9 mm
```
cooked bacon lardons, small rectangular batons 15 to 25 mm long, clear
alternating layers of pink meat and pale cream fat, lightly browned and
slightly shrunken at the ends, glossy from rendered fat, each baton a different
size
```

**`poulet`** — 30 × 24 mm — *décision : cuit nature, sans marque de grill*
```
cooked chicken breast torn into irregular chunks 20 to 35 mm, pale cream to
light golden, clearly visible muscle fibres and torn edges, moist surface,
pieces of noticeably different sizes and shapes. No grill marks, no char, no
barbecue stripes
```

**`anchois`** — 50 × 9 mm
```
anchovy fillets in oil, flat elongated strips 40 to 55 mm long, grey-brown
flesh with silvery edges, visible fibre lines running lengthwise, oily sheen,
naturally curved and slightly twisted, each fillet differently bent
```

**`thon`** — 16 mm
```
canned tuna flakes, irregular pale beige-pink fragments from 8 to 25 mm,
clearly visible flaky fibrous structure splitting along the grain, slightly
moist, some fragments larger and some crumbled small
```

### Légumes

**`champignons`** — 36 × 28 mm — *décision : champignons de Paris frais émincés*
```
fresh white button mushroom slices cut about 4 mm thick, each slice showing the
rounded cap outline, the solid stem section in the middle and the darker gills
on either side, cream to pale brown, a few slices broken or cut off-centre so
they are incomplete, slightly different thicknesses
```

**`artichauts`** — 42 × 32 mm
```
marinated artichoke heart quarters, visible overlapping leaf layers and
fibrous structure, pale green shading to cream and pale yellow at the base,
irregular fibrous cut edges, light sheen from the marinade, pieces of different
sizes
```

**`poivrons`** — 48 × 13 mm — *décision : mélange rouge et vert*
```
red and green bell pepper strips 40 to 55 mm long and 8 to 14 mm wide, glossy
smooth outer skin on one side, visible pale flesh thickness at the cut edges,
naturally curved following the shape of the pepper, strips of different lengths
and curvature, roughly half red and half green
```

**`oignons`** — 52 × 10 mm
```
raw white onion sliced into thin half-rings, translucent and almost see-through
at the thinnest edges, visible concentric layer lines, faint purple-white tint,
naturally curved into open arcs, varying thickness and length, some slices
partly separated into two layers
```

**`capres`** — 9 mm
```
whole capers in brine, small buds 7 to 11 mm across, deep olive green, tight
closed bud shape with fine ribbed surface texture and a tiny stem nub, matte
with a wet sheen, each one slightly differently shaped
```

**`olives`** — 22 mm — *confirmé : noires, dénoyautées, entières*
```
whole pitted black olives, 18 to 24 mm long, seen from directly above as
plump rounded ovals, dark purple-black skin with natural subtle wrinkling and
tonal variation, soft sheen rather than wet gloss, the small open hole left by
the pitting visible on some of them, each olive a slightly different size and
shape. Whole olives, not sliced, not rings
```

### Fromages

**`fromage-base`** — 45 × 3 mm — *confirmé : fromage en julienne*
```
uncooked pizza cheese cut in julienne: long straight thin strips of cheese, 30
to 60 mm long with a square section of about 3 mm, pale ivory to very pale
yellow, matte surface, clean straight machine-cut edges rather than torn
shreds, strips lying at different angles, a few slightly bent, a few shorter
broken ones. Raw and uncooked, not melted, not browned, not stringy shredded
cheese
```

> La julienne est une coupe plus **longue, plus droite et plus régulière** que
> le râpé classique. Si le générateur sort du fromage râpé frisé, insiste avec
> `straight julienne matchsticks of cheese, not curly shredded cheese`.

**`parmesan`** — 14 × 4 mm — *décision : râpé fin*
```
finely grated parmesan, small irregular granules and short slivers 5 to 18 mm
long, pale straw yellow, dry granular crystalline texture, matte, natural
broken edges, every fragment a different size and shape. Finely grated, not
large shavings, not powder
```

**`brie`** — 36 × 28 mm
```
pieces of brie cut from a wheel, each piece showing the soft white bloomy rind
along one edge and the pale cream supple paste inside, with a clear visible
contrast between rind and paste, soft slightly collapsing cut edges, pieces of
different sizes and wedge angles
```

**`chevre`** — 45 mm — *décision : rondelles de bûche avec croûte fine*
```
slices of goat cheese log about 45 mm across, bright white dense paste with a
fine chalky texture, a thin slightly darker natural rind around the
circumference, soft cut faces, some slices cracked or crumbled at the rim, no
two slices identical
```

**`bleu`** — 20 mm — **l'ingrédient le plus exigeant, voir §40**
```
crumbled blue cheese, irregular broken fragments 12 to 25 mm, ivory-white and
cream paste shot through with blue-grey and grey-green marbling veins that run
into the body of the cheese itself, natural rough fracture surfaces with small
cracks and crumbly edges, some fragments heavily veined and others almost
plain white, visibly crumbly and slightly moist
```

> ⚠ Vérifie cette planche plus attentivement que les autres. L'erreur
> classique du générateur est de poser des **points bleus en surface** sur des
> cubes blancs. Les marbrures doivent **traverser la matière** et apparaître
> sur les faces de cassure. Si ce n'est pas le cas, régénère en ajoutant
> `the blue veins run through the interior of the cheese and are visible on the
> broken surfaces, not painted on top`.

**`reblochon`** — 36 × 30 mm
```
pieces of reblochon cheese, each showing the thin orange-yellow washed rind
with a faint white bloom along one edge and the supple pale cream paste inside,
the rind clearly orange and clearly thinner than a brie rind, soft yielding cut
edges, pieces of different sizes
```

> ⚠ Le §44 est explicite : le reblochon ne doit pas être un brie recoloré en
> jaune. Génère-le **dans une session séparée** du brie et compare les deux
> planches côte à côte avant de valider.

---

# VAGUE 3 — Ustensiles et mains

## Ustensiles

Même gabarit que la louche (vue de dessus, manche vers le haut, détouré, sans
ombre).

| Fichier | Sujet |
|---|---|
| `tool/tongs-open.png` | `stainless steel kitchen tongs seen from directly above, jaws open, scalloped gripping ends, polished steel with fine use marks` |
| `tool/tongs-closed.png` | *le même ustensile, mâchoires fermées* — à générer dans la même session pour que les deux images soient identiques en dehors du geste |
| `tool/spoon.png` | `a small stainless steel serving spoon seen from directly above, empty` |
| `tool/grater.png` | `a flat stainless steel cheese grater seen from directly above, rectangular blade with rows of raised cutting holes, black handle at the top` |
| `tool/peel.png` | `a professional pizza peel seen from directly above, round thin metal head with a long handle, fine scratches, 1400 × 900` |

## Les mains — le point faible, lis ceci avant de générer

C'est le seul endroit où je te dis franchement que la génération IA est le
mauvais outil. Une main qui **saisit réellement** un morceau, avec cinq doigts
corrects, la bonne tension du gant et un contact crédible, sur une séquence
cohérente — c'est précisément ce que les générateurs ratent le plus (§53 le
reconnaît en demandant un contrôle image par image).

**Ma recommandation : filme-les toi-même.** C'est le seul plan du cahier des
charges qui ne demande aucun stylisme culinaire — juste une main gantée au-dessus
d'un plan de travail. Téléphone posé à plat au-dessus, 10 secondes par geste,
fond uni (une plaque sombre suffit, je détoure derrière). Une dizaine de prises
et c'est réglé, avec une qualité qu'aucune génération n'atteindra.

Si tu préfères malgré tout générer, voici les quatre poses minimales. Génère-les
**dans une seule session**, à la suite, pour que ce soit la même main :

| Fichier | Pose |
|---|---|
| `hand/hand-open.png` | `a hand in a black food-safe nitrile glove seen from directly above, palm down, fingers relaxed and slightly spread, wrist entering from the bottom edge of the frame, forearm visible` |
| `hand/hand-pinch.png` | `the same gloved hand seen from directly above, thumb and two fingers pinched together as if holding a small piece of food, other fingers curled` |
| `hand/hand-fist.png` | `the same gloved hand seen from directly above, loosely closed as if holding a handful of shredded cheese, fingers curled towards the palm` |
| `hand/hand-flat.png` | `the same gloved hand seen from directly above, fingers flat and together as if gently pressing the edge of a pizza dough` |

Contrôle obligatoire : **compte les doigts** sur chaque image. Cinq. Vérifie
aussi que le poignet entre bien par le bas du cadre et qu'il n'y a pas de main
flottante coupée au milieu de l'image.

---

# Récapitulatif du nombre d'images

| Vague | Contenu | À générer |
|---|---|---|
| 1 | plan de travail, 4 pâtes, 4 textures de sauce, 4 bacs de sauce, louche | **14** (+1 masque fait à la main) |
| 2 | 22 ingrédients × (1 bac + 1 planche) | **44** |
| 3 | 5 ustensiles + 4 mains | **9** |
| | | **67** (68 fichiers avec le masque) |

Le décompte exact est affiché en direct par la page de contrôle
[`lab/assets-check.html`](../assets-check.html).

Commence par la vague 1. Dépose les fichiers aux chemins indiqués, dis-le-moi,
et je te montre le résultat composité avant qu'on engage les 42 suivantes.
