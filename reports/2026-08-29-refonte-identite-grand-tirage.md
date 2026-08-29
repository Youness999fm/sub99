# Mission — Refonte identité de marque de "Le Grand Tirage"

## Demande initiale
Transformer la page `grand-tirage.html` (déjà en ligne) pour qu'elle soit immédiatement identifiable comme Subito Pizza — pas une amélioration cosmétique, une vraie direction artistique ancrée dans l'identité réelle de la marque, sans rien inventer (aucun faux lot, faux logo, fausse couleur, faux chiffre).

## Analyse préalable (étapes 0-2 du brief)
**Page actuelle avant refonte** : logo visible seulement dans le header partagé (jamais dans le hero) ; "depuis 1999" relégué au footer en petit ; chiffres 250/30/45 en trois pastilles `aria-hidden="true"` (invisibles pour un lecteur d'écran) ; lots seulement visibles pendant le show ; son coupé par défaut avec bouton séparé à activer ; esthétique "jackpot" générique sans code visuel spécifiquement pizzeria.

**Identité réelle vérifiée** (fichier `assets/img/logo.jpg`, seule source utilisée — aucun logo inventé) : wordmark "SUbiTO" blanc sur vert forêt, flamme rouge, bandeau rouge "PIZZA", "ORIGINAL DEPUIS 1999". Couleurs déjà correctement calées dans `style.css` (`--green`, `--red`, `--gold*`) — confirmées cohérentes avec le vrai logo, donc conservées telles quelles. Ton de marque déjà observable sur le reste du site : chaleureux, direct, signature récurrente "depuis le 1ᵉʳ avril 1999".

## Direction artistique retenue
Vrai logo intégré au hero (pas de logo généré), pastille "Depuis 1999 · N ans de fidélité" (valeur calculée en direct, jamais codée en dur — réutilise `yearsSinceOpening()` déjà présent dans `assets/js/main.js`), cartes stats accessibles avec compteur animé, lots réels affichés en clair avant le levier, ligne de confiance (adresse réelle), son actif par défaut et démarré par le geste déjà obligatoire (tirer le levier) plutôt qu'un bouton séparé à activer.

## Actions

### `grand-tirage.html`
- Ajout du vrai logo (`assets/img/logo.jpg`) dans le hero, avec `alt="Subito Pizza — Original depuis 1999"`.
- Nouvel eyebrow : "Subito Pizza · Hénin-Beaumont" (remplace "édition spéciale concours", générique).
- Nouvelle pastille héritage : "🍕 Depuis 1999 · `<span id="tirage-heritage-years">` ans de fidélité" — valeur injectée en JS depuis la vraie date d'ouverture.
- Nouvelle accroche : "Depuis 1999, c'est vous qui nous faites tourner. Aujourd'hui, Subito vous dit merci — en grand." (voix propre à la marque, pas la phrase suggérée telle quelle).
- Stats 250/30/45 transformées en 3 cartes accessibles (icônes 👥🏆🎁, `data-count-to`, plus de `aria-hidden`).
- Nouveaux badges lots réels : "🍕🍕 2 Pizzas XXL" / "🍰 1 Tiramisu" (aucun lot inventé, reprend exactement `PRIZES` de `data.js`).
- Ligne de confiance : "🍕 Jeu organisé par Subito Pizza — 333 rue Elie Gruyelle, Hénin-Beaumont" (adresse réelle, déjà utilisée partout ailleurs sur le site).
- Bouton son : libellé initial corrigé (`🔊 Son`, `aria-pressed="true"`) pour refléter le nouveau défaut honnête.

### `assets/css/tirage.css`
Nouveaux styles pour `.tirage-hero__logo`, `.tirage-heritage-pill`, `.tirage-hero__tagline`, `.tirage-stats`/`.tirage-stat` (cartes), `.tirage-prizes-chips`/`.tirage-prize-chip`, `.tirage-hero__trust`. Anciennes règles `.tirage-hero__stats` (pastilles génériques) retirées, remplacées.

### `assets/js/tirage/audio.js`
Le son est maintenant actif "par préférence" dès le départ (`enabled = true` sauf choix explicite de coupure mémorisé) — plus de bouton "cliquez pour activer" séparé. Le vrai démarrage audio reste techniquement contraint par les navigateurs (Chrome/Safari/TikTok in-app) à un vrai geste utilisateur : c'est le tir du levier — déjà obligatoire pour voir le show — qui déclenche `ensureContext()`. Aucun contournement des politiques navigateur, aucun faux état "activé" affiché si rien ne joue.

### `assets/js/tirage/main.js`
- `renderHeritageYears()` : injecte la vraie ancienneté (calculée par le script partagé du site, jamais une valeur en dur).
- `initStatsCountUp()` : anime les 3 chiffres (courbe d'accélération, `requestAnimationFrame`) au moment où le hero devient visible, avec repli immédiat (pas d'animation) sous `prefers-reduced-motion` ou si `IntersectionObserver` est indisponible — contenu réel dans le DOM dans tous les cas.

## Vérification e2e réelle (navigateur, serveur `sub99`)
- **Arbre d'accessibilité** (capturé en entier) : logo avec texte alternatif correct, "SUBITO PIZZA · HÉNIN-BEAUMONT", pastille "Depuis 1999 · 27 ans de fidélité" (valeur réelle confirmée), titre, accroche, 3 stats en vrai texte (250/30/45), lots, levier, ligne de confiance, lien "passer aux résultats" — tout est du vrai contenu HTML, rien caché aux lecteurs d'écran.
- **Son** : testé sur session vierge (`localStorage` vidé) → bouton affiche bien "🔊 Son activé" par défaut. Clic sur le toggle → passe honnêtement à "🔇 Son coupé" (`aria-pressed="false"`, préférence mémorisée) ; nouveau clic → revient à "activé". Aucun état trompeur observé.
- **Show existant** : bouton "passer aux résultats" et liste des 30 gagnants re-testés après la refonte — toujours 15+15, zéro erreur console.
- **Responsive** : à 390×844 (iPhone récent) et 375×812, zéro élément débordant, zéro scroll horizontal (vérifié programmatiquement sur tous les éléments de la page, pas seulement visuellement).
- **Console** : aucune erreur/avertissement sur l'ensemble des interactions testées (chargement, activation du levier, toggle son, skip, recherche).
- **Limite de test à signaler honnêtement** : l'outil de capture d'écran de cette session a rencontré une panne technique (timeout systématique, indépendante de la page — confirmé par un arbre d'accessibilité et des logs sains). La vérification a donc été faite par inspection programmatique complète (DOM, styles calculés, dimensions) plutôt que par confirmation visuelle en image. Recommandation : un coup d'œil visuel rapide une fois republié, pour confirmer que le rendu correspond à l'intention (déjà cohérent sur tous les points mesurables).

## Verdict
Conforme à la demande : identité Subito Pizza immédiatement reconnaissable (vrai logo, vraies couleurs, "depuis 1999" mis en avant, ton de marque), aucune donnée inventée (lots, chiffres, adresse tous repris tels quels), aucune régression du fonctionnement existant (recherche, show, liste des résultats). **PASS**, avec la réserve de vérification visuelle mentionnée ci-dessus.

## À republier
Cette refonte est uniquement locale (fichiers `grand-tirage.html`, `tirage.css`, `audio.js`, `tirage/main.js`) — comme la mise en ligne précédente, il faudra renvoyer ces fichiers modifiés par FTP pour qu'elle soit visible sur `https://www.subito-pizza-heninbeaumont.fr/tirage-au-sort`.
