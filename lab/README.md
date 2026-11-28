# Laboratoire — Atelier « Compose ta pizza »

Prototype isolé. **Rien ici n'est relié au site de production.**

## Tester la page

```powershell
.\.claude\serve.ps1          # sert le dépôt sur http://localhost:8090
```

puis ouvrir <http://localhost:8090/lab/compose-ta-pizza.html>.

> Le module utilise des modules ES natifs (`<script type="module">`) : il faut
> passer par un serveur HTTP. Un double-clic sur le fichier (`file://`) ne
> marchera pas — le navigateur bloque les imports.

## Garanties d'isolation

| Point | État |
|---|---|
| Page référencée dans la navigation / le sitemap | non |
| `<meta name="robots">` | `noindex, nofollow` |
| Publiée par Vercel | non — `lab/`, `assets/css/lab/`, `assets/js/lab/` sont dans `.vercelignore` |
| Charge `cart.js` / `main.js` / `account.js` | non, aucun script du site |
| Écrit dans le `localStorage` / appelle `/api` | non |
| Fichier de production modifié | un seul : `.vercelignore` (3 lignes d'exclusion) |

Supprimer le prototype = supprimer `lab/`, `assets/css/lab/`, `assets/js/lab/`
et les 3 lignes de `.vercelignore`. Rien d'autre à défaire.

## Architecture

```
lab/compose-ta-pizza.html              page hôte (chrome de lab + point de montage)
assets/css/lab/atelier.css             styles, tous préfixés (atelier/bench/tray/panel/steps/summary/pz)
assets/js/lab/atelier/
├── index.js                           ComposePizzaPage — assemblage + orchestration
├── data/ingredients.js                données mockées : tailles, tarifs, étapes, ingrédients
├── core/
│   ├── store.js                       état + abonnements (+ toOrderPayload)
│   ├── price.js                       PriceCalculator — seul endroit où un prix est calculé
│   └── random.js                      PRNG semé : le rendu doit être reproductible
├── render/
│   ├── svg-defs.js                    dégradés, filtres et dessin de chaque ingrédient
│   ├── placement.js                   PizzaLayerRenderer — où tombe chaque morceau
│   ├── pizza-canvas.js                PizzaCanvas — pâte, sauce, fromage, calques
│   ├── tray.js                        IngredientTray + IngredientCard (les bacs)
│   ├── panels.js                      LeftStepPanel + RightSummaryPanel
│   └── progress.js                    StepProgress
└── anim/
    ├── motion.js                      socle WAAPI (easings, file d'attente, reduced-motion)
    └── stage.js                       chorégraphies : louche, portion qui tombe, râpe
```

### Monter le module ailleurs

```js
import { mountAtelier } from '/assets/js/lab/atelier/index.js';
const atelier = mountAtelier(document.querySelector('#mon-conteneur'));
// atelier.store.toOrderPayload()  → { product, size, extras[], includesBaseCheese }
// atelier.destroy()
```

Le montage automatique se déclenche uniquement si un élément porte
`data-atelier-root` ; sinon le module est inerte.

## Choix techniques

- **Vanilla + modules ES.** Le site n'a pas de bundler ; introduire React ou un
  build pour un prototype aurait été un faux départ.
- **Web Animations API plutôt que GSAP / Framer Motion.** Les chorégraphies
  s'écrivent en `await animation.finished`, c'est accéléré par le compositeur,
  et on n'ajoute aucun script tiers bloquant sur le site.
- **SVG procédural plutôt que des images.** Chaque ingrédient est dessiné en
  code (dégradés + `feTurbulence` pour la croûte et la sauce, filtre « gooey »
  pour la mozzarella fondue). Net à toutes les tailles, zéro asset à produire,
  et la même forme sert dans le bac et sur la pizza.
- **Un `<svg>` sprite caché** contient toutes les formes ; la pizza et les
  éléments volants les réutilisent via `<use>`.
- **Aléatoire semé par identifiant.** Retirer puis remettre un ingrédient le
  replace exactement au même endroit : la pizza ne « saute » jamais.
- **Changement de taille = mise à l'échelle du groupe SVG.** Les morceaux sont
  contre-mis à l'échelle pour garder une taille physique constante : une XXL a
  plus de garniture, pas une garniture plus grosse.

## Règles métier appliquées

- Base Marguerita au prix de la taille : Solo 9,00 · Duo 13,00 · Quatro 17,50 · XXL 25,50 €
- Suppléments légumes/sauces : 1,00 · 1,50 · 2,50 · 3,50 €
- Suppléments viandes/poissons/fromages : 1,50 · 2,00 · 3,00 · 4,00 €
- **Sauce tomate et crème fraîche = 0 €** (elles font partie de la Marguerita) ;
  **curry et barbecue = supplément** au tarif légumes/sauces, car elles n'en
  font pas partie. C'est un arbitrage de prototype : il tient dans un seul
  drapeau `includedInBase` si la décision change.
- La mozzarella de la Marguerita est posée automatiquement après la première
  sauce, gratuitement.
- Suppléments à la carte, sans contrainte de nombre (pas de « exactement 2
  viandes » : cette règle n'a pas de sens sur une pizza composée).

## Reste à faire avant intégration

1. **Trancher l'arbitrage des sauces curry / barbecue** (incluses ou non).
2. **Brancher le catalogue réel** : `data/ingredients.js` est le seul fichier à
   remplacer. Prévoir la lecture de `assets/data/disponibilite.json` pour griser
   un ingrédient indisponible (le site ne dit jamais « rupture »).
3. **Brancher le panier** : mapper `store.toOrderPayload()` vers
   `addLine()` / `SubitoPizzaWidget` dans `cart.js`.
4. **Dessiner anchois et thon** — déjà déclarés avec `available: false`.
5. Décider si l'atelier **remplace** `composer.html` ou devient un bloc
   supplémentaire de cette page (la grille tarifaire textuelle actuelle reste
   utile pour qui commande par téléphone).
6. Étape « cuisson » optionnelle avant l'ajout au panier (le canvas est prêt :
   il suffit d'un calque de dorure + une animation sur `.pz-pizza`).
7. Revue accessibilité complète (le module annonce déjà chaque ajout dans une
   zone `aria-live` et respecte `prefers-reduced-motion`).
8. Tests sur mobile réel (iOS Safari) : les filtres SVG sont le point à
   surveiller côté performance.
