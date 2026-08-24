# Mission — Correctif : l'écran d'intro laissait voir le bas de la page d'accueil

## Demande initiale
Le loader (`.intro-splash`, accueil uniquement) est visuellement bon (design, animation, timing à conserver tels quels) mais ne couvre pas 100 % du viewport : le bas de la page d'accueil est visible derrière lui pendant le chargement. Corriger à la source, sans refaire le loader, en garantissant une couverture plein cadre desktop/mobile, un blocage du scroll pendant l'affichage puis une restauration propre, sans flash de contenu ni saut de layout à la fin.

## Cause réelle identifiée
`assets/css/style.css`, règle `.intro-splash` : l'élément avait **à la fois** `position: fixed; inset: 0;` **et** des déclarations explicites `width: 100%; height: 100vh; height: 100dvh;`.

C'est un cas classique de boîte "sur-contrainte" : quand `top`, `bottom` (fournis par `inset: 0`) **et** `height` sont tous les trois définis sur un élément en position fixe/absolue, la spec CSS fait gagner `height` et recalcule/ignore `bottom`. Concrètement, le bas réel de l'élément n'était plus "le bas du viewport" mais "le haut + la valeur calculée de `100dvh` (ou `100vh` en repli)" — et tout écart entre cette valeur figée au moment du calcul et la vraie fenêtre visible (barre d'adresse mobile qui se rétracte juste après le premier rendu, arrondis, etc.) laissait un espace en bas où la page d'accueil apparaissait. `width: 100%` était le même genre de redondance sans effet négatif visible, mais tout aussi inutile.

Un second facteur aggravant : le scroll du document n'était **pas** verrouillé pendant l'affichage du loader (décision assumée d'une mission précédente, pour éviter une attente forcée). Sans verrou, un défilement — volontaire ou non — pendant la fenêtre de chargement pouvait faire apparaître le bas de page réel sous un loader déjà imparfaitement dimensionné.

## Corrections

1. **`assets/css/style.css`** (`.intro-splash`) : suppression de `width: 100%; height: 100vh; height: 100dvh;`. Il ne reste que `position: fixed; inset: 0;` — une boîte définie uniquement par ses quatre bords collés au viewport, jamais par une hauteur calculée à un instant donné. Elle se recalcule automatiquement à chaque repositionnement du viewport (y compris le retrait de la barre d'adresse mobile), sans dépendre d'aucune unité `vh`/`dvh`/`svh`/`lvh`. Aucune autre propriété du loader touchée (couleurs, dégradé, animation, timing, contenu — tout identique).
2. **`assets/js/main.js`** (`initIntroSplash()`) : ajout d'un verrou de scroll (`document.body.style.overflow = 'hidden'`) posé au moment où le voile s'affiche, et retiré **immédiatement** (synchrone, pas après le fondu de sortie) dans `dismiss()` — donc un premier geste réel (clic, touche, molette, toucher) fait toujours disparaître le voile et rendre la main tout de suite, exactement comme avant. Le filet de sécurité existant (retrait automatique après 1200 ms même sans interaction) garantit qu'aucun visiteur ne peut rester bloqué avec le scroll verrouillé.

## Tests effectués (navigateur réel, serveur `sub99`)

- **Géométrie** : élément avec la classe `.intro-splash` mesuré via `getBoundingClientRect()` à plusieurs tailles de viewport (desktop, mobile 375×812) — coïncide exactement avec `window.innerWidth`/`innerHeight` (0 écart), plus aucun espace en bas.
- **Redimensionnement pendant l'affichage** : le **même** élément (non recréé) redimensionné de 375×812 à 430×932 en direct — se réajuste tout seul, sans JS, toujours calé exactement sur les nouveaux bords du viewport.
- **Verrou de scroll — geste réel** : un événement `wheel` natif (`deltaY: 400`) déclenché sur `window` pendant que `body.style.overflow` vaut `hidden` ne déplace pas `window.scrollY` (reste à 0). *(Note technique : `window.scrollTo()` appelé directement en JS, lui, contourne `overflow:hidden` dans Chrome — comportement connu du moteur, sans rapport avec un vrai geste utilisateur (molette/tactile/barre de défilement), qui est bien bloqué.)*
- **Cycle complet réel** : voile réinjecté + `initIntroSplash()` relancé → `body.overflow` passe à `hidden` → déclenchement d'un vrai `dismiss` (touche `Escape`, l'un des 5 déclencheurs) → `body.overflow` repasse à `visible` **immédiatement** (pas après les 900 ms de fondu) → après ~1 s, le voile est entièrement retiré du DOM (`splashStillInDom: false`) → le scroll refonctionne normalement.
- **Capture visuelle mobile (375 px)** : le voile occupe bien tout l'écran jusqu'au dernier pixel en bas, aucune trace de la page d'accueil derrière.
- **Autres pages** : `menu.html` (et donc toutes les pages sans `#intro-splash`) — `initIntroSplash()` s'arrête immédiatement (`if (!splash) return;`), aucun effet de bord sur `body.style.overflow` ailleurs sur le site.
- **Console** : aucune erreur JS après les deux correctifs.

## Verdict
Cause racine corrigée à la source (conflit `inset` + `height`), design/animation/timing du loader intégralement conservés. Verrou de scroll ajouté en défense supplémentaire, avec déblocage immédiat garanti (pas de régression vers l'attente forcée corrigée par une mission précédente). **PASS.**
