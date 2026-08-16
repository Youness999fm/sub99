# Mission — Transformer le compteur "10 000 jours" en expérience mémorable

## Demande initiale
Refonte créative complète de la scène finale (`#finale`, bas de `index.html`) : dépasser le simple compteur pour créer un moment "WOW" mémorable, tout en gardant un calcul de jours réel (jamais figé), performant, mobile-first et accessible (`prefers-reduced-motion`).

## Découverte clé
Vérification de la date d'ouverture (1ᵉʳ avril 1999) vs date du jour (17 août 2026) : **aujourd'hui est exactement le jour 10 000**. La fenêtre de célébration (`MILESTONE_DAY` à `MILESTONE_DAY+13`) est donc active en ce moment même, pas un scénario futur abstrait.

## Diagnostic
L'existant (fondu séquencé, odomètre à rouleaux, braises au clic, halo doré) était propre mais restait un "compteur qui compte" : aucune sensation d'échelle, aucun pont émotionnel entre 1999 et aujourd'hui, rien après le chiffre.

## Concepts envisagés
- **A. Scroll scrubbing/pinning cinématique** — écarté (risque mobile disproportionné, surenchère technique).
- **B. Accumulation monumentale (braises ambiantes + chiffre qui "prend du poids")** — retenu.
- **C. Équivalences humaines vraies (années/semaines/samedis soir)** — retenu.
- **D. Chambre noire + spot suivant la souris** — écarté (pas d'équivalent mobile propre).
- **E. Son au clic** — écarté (fragilité autoplay, gain marginal).

Direction choisie : **B + C**, avec une version sobre de l'ambiance D (halo statique, sans dépendance souris), pour couvrir les 5 niveaux d'émerveillement (intrigue → compréhension → surprise → émotion → mémorisation) sans dépendance externe ni risque mobile.

## Ce qui a été fait
**`index.html`** — section `#finale` :
- Ajout d'un `<canvas>` ambiant pour les braises (`#finale-embers-canvas`).
- Ajout d'une plaque datée réelle (`#finale-milestone-date`), visible uniquement pendant la vraie fenêtre des 10 000 jours.
- Ajout d'un indice de rejouabilité discret (`.finale__replay-hint`).
- Ajout de 3 équivalences chiffrées vraies (`#finale-equivalences`) : années, semaines, samedis soir.
- Fallback statique no-JS mis à jour (`9991` → `10000`, valeurs d'équivalence à jour).

**`assets/js/main.js`** :
- `saturdaysSinceOpening(target)` : calcul par formule (pas de boucle/estimation) du nombre de samedis écoulés depuis l'ouverture, basé sur le vrai jour de semaine du 1ᵉʳ avril 1999.
- `initDaysCounter()` étendu : calcul et affichage des équivalences (révélées via classe `is-revealed`, synchronisée sur la fin réelle de l'animation plutôt que sur la chaîne `transition-delay` générique — nécessaire car la durée du roll-up varie selon qu'on est ou non dans la fenêtre du seuil), plaque datée, effet "prend du poids" (`setWeight`, transform:scale uniquement, compositor-friendly), rebond d'arrivée (`settle`, classe `.is-settling` + keyframes CSS).
- `initFinaleEmbers()` (nouveau) : système de particules canvas 2D, actif uniquement pendant que la section est visible (IntersectionObserver) et l'onglet au premier plan (`visibilitychange`), désactivé sous `prefers-reduced-motion`, budget de particules réduit sur petit viewport (16 vs 34), `devicePixelRatio` plafonné à 2.
- Correctif reporté du fix précédent (conflit transition CSS/rAF sur l'odomètre) : tous les nouveaux appels `setOdometer` du compteur de jours utilisent `instant=true`.

**`assets/css/style.css`** :
- Styles pour le canvas de braises, la plaque, l'indice de rejeu, les équivalences (avec media query mobile dédiée).
- `@keyframes finale-settle` (rebond d'arrivée) et halo `text-shadow` renforcé pendant la fenêtre du seuil.
- Overrides `prefers-reduced-motion` pour chaque nouvel élément animé.

## Auto-révision (rôle adversaire/juge tenu par le lead faute de sous-agents dédiés dans cette session)
- Vérifié : calcul des jours (`daysSinceOpening`) reste en dates civiles UTC, aucune valeur codée en dur pour le chiffre affiché — seul `MILESTONE_DAY = 10000` est un seuil de comparaison, pas une valeur figée.
- Vérifié : toutes les nouvelles animations utilisent `transform`/`opacity` (compositor), aucune propriété qui déclenche un reflow par frame.
- Vérifié : `initFinaleEmbers` s'arrête proprement (canvas vidé, `rafId` nettoyé) quand la section sort du viewport ou que l'onglet passe en arrière-plan.
- Vérifié : aucune donnée inventée dans les équivalences — années/semaines/samedis calculés depuis la vraie date d'ouverture.
- Point d'attention accepté : les valeurs statiques de fallback (HTML sans JS) sont figées au 17/08/2026 et se périmeront comme le faisait déjà `9991` avant cette mission — limitation déjà présente et acceptée dans ce projet, pas une régression introduite ici.

## Audit e2e réel
Navigateur réel utilisé (pas de simulation) :
- **Technique** : aucune erreur console au chargement ; `daysSinceOpening()===10000`, `yearsSinceOpening()===27`, `saturdaysSinceOpening(10000)===1429` vérifiés en direct dans la page ; sélecteurs CSS `.finale__equivalences.is-revealed` et `finale-settle` confirmés présents et corrects dans la feuille de style chargée.
- **UI** : capture d'écran réelle en mobile (375px) après scroll jusqu'à `#finale` — chiffre doré "10000" avec halo, badge "✦ 10 000 JOURS ✦", plaque "Constaté aujourd'hui, 17 août 2026", indice de rejeu, 3 équivalences (27 ANS / 1428 SEMAINES / 1429 SAMEDIS SOIR), braises visibles en mouvement à l'écran, filigrane "1999" en fond — tout s'affiche conforme au concept.
- **UX** : capture desktop (1280px) non exploitable (bug d'affichage de l'outil de capture après un `resize_window`, sans rapport avec le code du site — le viewport JS confirmait bien 1280×900) ; le layout desktop n'a pas pu être vérifié visuellement dans cette session, seulement par lecture du CSS responsive (déjà basé sur `clamp()`/`flex-wrap` existants, cohérent avec le reste du site).
- Itérations : 1 (aucun bug trouvé nécessitant une correction après la première implémentation).

## Reste à vérifier par l'utilisateur
- Rendu visuel desktop réel (capture non obtenue dans cette session, cause outil).
- Ressenti "WOW" subjectif — à confirmer en conditions réelles sur téléphone/ordinateur.

## Suite — retours utilisateur du 17/08/2026 (même journée)

**Retour 1** : "le chiffre 10000 est dans un rectangle flou". Cause : le halo `.finale__days-glow` ("four qui s'allume", déclenché par `celebrate()` le jour du seuil) rendait comme un rectangle flou plutôt qu'une lueur, à cause de sa boîte très haute (`inset: -30% -10%`) mal proportionnée pour le dégradé radial. **Retiré entièrement** (HTML, JS, CSS) plutôt que corrigé — demande explicite de l'utilisateur.

**Retour 2** : "améliore le chiffre 10000 qui charge" → précisé par question de clarification : "pas assez impressionnant" + "saccadé". Diagnostic : le mécanisme de comptage par frame (`requestAnimationFrame` + `setOdometer` appelé ~60×/s avec `instant=true`) éliminait bien le conflit de transition CSS (bug précédent) mais, en contrepartie, chaque chiffre "sautait" sans aucune interpolation visuelle — mécanique mais pas fluide, et la courbe d'accélération concentrait l'essentiel du mouvement dans le premier tiers du temps, rendant la fin de l'animation statique et peu spectaculaire.

**Refonte complète du mécanisme** (`initDaysCounter` → nouvelle fonction `spin()`) : chaque chiffre tourne désormais sur lui-même à travers plusieurs cycles complets (0-9 répété, 1 à 3 tours selon le contexte) avant de se figer sur sa valeur réelle, en cascade de gauche à droite, chaque chiffre piloté par **une seule transition CSS** (`transform`, easing `cubic-bezier(0.16, 1, 0.3, 1)`) — plus aucune mise à jour par frame en JavaScript. Le rebond d'arrivée et l'effet de "poids" (`scale` progressif) sont conservés mais recalés sur ce nouveau mécanisme. Le clic de rejeu (pendant et hors fenêtre du seuil) réutilise la même fonction pour un rendu cohérent partout.

Vérifié en navigateur réel : capture mi-animation montrant un chiffre effectivement en train de "tourner" (glyphe transitoire visible), capture de l'état final propre et net, aucune erreur console liée au changement (seule une alerte `navigator.vibrate` bloquée est apparue, attendue et déjà gérée : elle vient du clic synthétique déclenché par le test, pas d'un vrai geste utilisateur).
