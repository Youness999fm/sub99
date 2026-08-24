# Mission — Panuzo dans le carrousel "épisodes du menu" (accueil), le lundi uniquement

## Demande initiale
Le carrousel de la photo héro (accueil) fait défiler ~45 produits en boucle. Chaque lundi, le Panuzo doit y apparaître en édition spéciale ("Aujourd'hui seulement — 9,90 €"), en première position, sans supprimer aucun produit existant. Du mardi au dimanche, retour automatique au fonctionnement actuel, à l'identique. Aucune date codée en dur — même logique centrale que le reste du site.

## Analyse préalable
Le "slider" n'est pas un carrousel à slides multiples visibles : c'est `initHeroCarousel()` dans `main.js` — une seule image (`#hero-plate-img`) + une légende (`#hero-plate-caption`), dans un lien unique `<a class="hero__plate" href="menu.html">`, qui change de contenu toutes les 1,6 s via un fondu (`is-swapping`), en bouclant sur un tableau JS de 45 produits. Le tout premier affichage (avant le premier changement) correspond au `<img>` déjà présent dans le HTML statique (Pizza Subito) ; le premier item du tableau JS (`menuItems[0]`, aussi Pizza Subito) est délibérément "sauté" au premier battement pour ne pas répéter la même image deux fois de suite.

## Solution retenue
**Solution C, exactement la préférence indiquée : Panuzo en première position le lundi, rotation normale ensuite.** Techniquement : un objet `panuzoSlide` est ajouté en tête du tableau (`unshift`) uniquement si `getPanuzoStatus().isToday` est vrai (même fonction centrale que le reste du site — aucune date codée ici). Comme il rejoint le tableau au même titre que les 45 autres, il revient périodiquement dans la boucle tout au long de la journée de lundi, exactement comme demandé ("le client peut continuer à faire défiler les autres produits").

**Un point a été traité au-delà de la demande initiale, avec justification** : comme le tout premier affichage vient du HTML statique (pas du tableau JS), un simple `unshift` n'aurait montré le Panuzo qu'après 1,6 s (le temps que la rotation l'atteigne), pas immédiatement. Pour respecter la préférence explicite "Panuzo apparaît en premier", la toute première image affichée est remplacée directement (sans attendre le premier battement) dès que `initHeroCarousel()` s'exécute — y compris pour les visiteurs en `prefers-reduced-motion` (qui ne verront jamais tourner le reste du carrousel, mais verront quand même "aujourd'hui c'est Panuzo" dès l'arrivée, plutôt que rien).

## Ce qui a été modifié

- **`assets/js/main.js`**, `initHeroCarousel()` : ajout du bloc `panuzoSlide` + `isPanuzoDay` (via `getPanuzoStatus()`, déjà existant), affichage immédiat si lundi, `unshift` dans le tableau existant, et dans la boucle de rotation, deux lignes ajoutées pour remettre à jour le lien du carrousel (`plate.href = p.href || 'menu.html'`) et l'accent visuel (`classList.toggle('is-panuzo', p === panuzoSlide)`) à chaque battement. **Aucune ligne des 45 produits existants modifiée**, timing (1,6 s), fondu, préchargement et logique de rotation strictement inchangés.
- **`assets/css/style.css`** : une seule règle ajoutée (`.hero__plate.is-panuzo::after { opacity: 1; }`), qui réutilise l'anneau doré déjà existant (utilisé pendant les transitions) plutôt que d'en inventer un nouveau.

## Contenu et lien du slide Panuzo

- **Visuel** : `assets/img/photos/panuzo.jpg`, déjà utilisé ailleurs sur le site — aucune nouvelle image créée.
- **Texte** (dans la légende existante, format identique aux autres produits) : `🔥 Panuzo — aujourd'hui seulement, 9,90 €` puis `🍕 À retrouver sur notre carte`, prix et nom lus depuis la configuration centrale (`PANUZO_CONFIG`), jamais écrits en dur.
- **Lien** : `menu.html#panuzo` — l'ancre existe déjà sur la page menu (section `<section id="panuzo">`), réutilisée telle quelle. Tous les autres produits gardent leur lien générique `menu.html` inchangé.

## Retour automatique mardi → dimanche

Garanti à deux niveaux : (1) le tableau n'est jamais modifié si `isPanuzoDay` est faux — les 45 produits et leur ordre restent strictement identiques à aujourd'hui ; (2) à chaque battement de la rotation, `plate.href` et la classe `is-panuzo` sont recalculés à partir de l'élément affiché (jamais de valeur qui "reste collée") — donc même en cours de rotation un lundi, dès que l'item suivant n'est pas Panuzo, le lien et l'accent visuel redisparaissent immédiatement.

## Tests effectués (navigateur réel, serveur `sub99`, aujourd'hui = vrai lundi)

- **Logique du premier affichage** rejouée sur des éléments détachés avec le vrai `getPanuzoStatus()` : image, texte alt, légende et lien tous corrects, prix lu dynamiquement (9,90 €).
- **Rotation réelle observée en direct** : après plusieurs battements, l'item affiché correspondait exactement à l'indice attendu compte tenu du décalage d'un cran causé par `unshift` (vérifié par calcul d'index) — confirme que l'insertion ne désynchronise pas le reste du tableau.
- **Capture visuelle réelle** (forçage temporaire de l'affichage pour figer l'instant, sans toucher au code) : photo Panuzo dans le cadre circulaire habituel, légende sur deux lignes conforme à la demande, lien `menu.html#panuzo`.
- **Simulation d'un mardi** (interception temporaire d'`Intl.DateTimeFormat`, comme pour les autres fonctionnalités Panuzo de cette session) : `isToday` faux → l'image initiale n'est jamais touchée ; un item normal traité par la boucle remet bien `plate.href` sur `menu.html` et retire la classe `is-panuzo`.
- **Console/réseau** : aucune erreur JS après les changements ; les requêtes en échec observées sont des préchargements d'images annulés par un rechargement de page (comportement navigateur normal, aucun rapport avec la modification) et l'iframe Google Maps (préexistant).

## Verdict
Conforme à la préférence explicite (Solution C), aucune régression sur les 45 produits existants ni sur le timing/l'animation, retour automatique vérifié. **PASS.**
