# Mission — Section événementielle "Panuzo" (nouveauté à venir)

## Demande initiale
Créer une section spectaculaire annonçant l'arrivée prochaine du **Panuzo** (pain garni de mozzarella, roquette fraîche, charcuterie de bœuf, pesto) sur `index.html`. Brief très détaillé (direction artistique, hiérarchie, animation, responsive, accessibilité) rédigé en termes génériques (mentionnant JSX/Tailwind/React) sans connaître la stack réelle du projet.

## Cadrage
Le projet est un site statique vanilla HTML/CSS/JS sans build ni framework — pas de JSX/Tailwind/React ici. Implémenté avec les conventions déjà en place (variables couleur `--green/--red/--gold/--dark`, `--font-display` Playfair Display, système de reveal existant, style d'icônes SVG inline déjà utilisé dans la nav/paiement). Aucune photo du Panuzo n'existe dans `assets/img/` (vérifié) : structure prête à recevoir une vraie photo, avec placeholder explicite en attendant (même convention que la galerie de `index.html`).

## Ce qui a été fait

**`index.html`** — nouvelle section `#panuzo-teaser`, placée juste après le hero (deuxième chose vue par le visiteur, avant même l'offre permanente) :
- Logo Subito réutilisé tel quel (`assets/img/logo.jpg`, non déformé, `object-fit` implicite via dimensions fixes).
- Titre "Panuzo" en Playfair Display 800, très grand (`clamp(3.4rem, 15vw, 6rem)`), sous-titre italique "L'Italie dans chaque bouchée", indicateur "Arrive très bientôt" (point qui pulse, sans compte à rebours inventé — aucune date officielle disponible), petite signature italienne vert/blanc/rouge.
- Visuel produit : cadre circulaire (écho du `.hero__plate` déjà existant) avec placeholder explicite + commentaire HTML indiquant comment brancher la vraie photo plus tard.
- Deux bandes diagonales "BIENTÔT DISPONIBLE" en vrai HTML/CSS (marquee en boucle, sens opposés), qui traversent le visuel produit.
- 4 pictogrammes SVG maison (mozzarella, roquette, charcuterie, pesto) dans le même style que les icônes déjà présentes sur le site (trait 1.6-1.8, sans emoji), grille 2×2.
- CTA discret "Suivez l'arrivée du Panuzo" vers `reseaux.html` (pas de bouton commercial classique — le produit n'est pas en vente, choix fait après lecture du brief qui laissait la main sur ce point).

**`assets/css/style.css`** — bloc `.panuzo-teaser` complet (fond cinématographique `--dark`/vert profond, texture diagonale légère, lueurs radiales rouge/or, éléments végétaux flottants décoratifs), animation d'entrée séquencée réutilisant le mécanisme déjà en place pour `#finale` (délais en cascade calés sur `.is-visible`).

**`assets/js/main.js`** — `.panuzo-teaser` ajoutée à la liste des sections "moment fort" (`reveal--feature`), même traitement que le teaser concours et la présentation.

## Bug trouvé et corrigé avant test (auto-révision)
En construisant la transition d'entrée du CTA, la même propriété `transition` (raccourci) était redéclarée deux fois sur `.panuzo-teaser__cta` — une pour l'entrée (opacity/transform, 0.75s), une pour le survol (gap/couleur, 0.25s). En CSS, une redéclaration de `transition` remplace entièrement la précédente : le survol aurait hérité du délai de 0.75s de l'entrée, rendant le CTA visiblement mou au survol après le chargement. Corrigé avec des propriétés `transition-property/duration/timing-function/delay` explicites et listées, pour que chaque propriété garde son propre timing. Un second cas similaire a été trouvé sur `:active` (`transform` partagé avec l'animation d'entrée) et corrigé en utilisant `filter: brightness()` à la place — pattern déjà utilisé ailleurs sur le site (`.event-ribbon:hover`), sans conflit.

## Audit e2e réel (navigateur, pas de simulation)
- **Technique** : aucune erreur console sur `index.html`, avant/après implémentation, à 320px/375px/768px/1100px.
- **UI** : capture à 320px, 375px, 768px et 1100px — aucun débordement horizontal (`scrollWidth === clientWidth` vérifié en direct à chaque taille), grille 2 colonnes confirmée active dès 780px (`gridTemplateColumns` lu en direct), titre jamais coupé même à 320px, bandes diagonales bien clippées par `overflow:hidden` (pas de fuite hors du cercle produit malgré leur débord `-12%/+12%`).
- **UX** : classes `reveal`, `reveal--feature`, `is-visible` confirmées posées sur la section ; état final de l'entrée (opacity/transform) vérifié conforme.
- Itérations : 1 (le bug de transition ci-dessus a été trouvé et corrigé avant le test e2e, pas après).

## Reste à faire / pour l'utilisateur
- Si une date de lancement officielle se précise, la section est prête à recevoir un compte à rebours réel (même mécanisme que celui du concours) — non ajouté pour l'instant, aucune date fournie.

## Suite — vraie photo intégrée (même journée)
Le client a fourni une vraie photo du Panuzo (`assets/img/photos/panuzo.jpg`, ~126 Ko). Le bloc placeholder ("Photo à venir" + icône) a été remplacé par un `<img>` réel dans `.panuzo-teaser__plate` — cadrage par défaut (`object-fit: cover`, position centrée) suffisant tel quel, mozzarella/roquette/charcuterie bien visibles dans le cadre circulaire. Vérifié en navigateur réel : image chargée (`naturalWidth > 0`), aucune erreur console, aucun débordement horizontal.

## Suite — visibilité étendue à tout le site (même journée)
Demande : "mets le maximum en avant sur les endroits que tu trouves nécessaire" — carte blanche sur les emplacements. Choix fait en évitant deux pièges : (1) dupliquer le bandeau événementiel du haut de page (déjà occupé par le concours, plus urgent — tirage le 30 août — ajouter un 2ᵉ bandeau aurait surchargé le haut de chaque page) et (2) transformer le Panuzo en produit commandable alors qu'il n'est pas encore disponible.

4 points de contact ajoutés, en réutilisant les patterns déjà établis pour le concours :
1. **Pastille sur `menu.html`**, juste au-dessus de la catégorie Subitowichs (`.menu-panuzo-pill`, verte pour rester visuellement distincte de la pastille concours qui est dorée) → lien vers `index.html#panuzo-teaser`.
2. **Carte teaser sur `reseaux.html`** (`.panuzo-card`), juste après la carte du concours — palette charbon/or (distincte du vert utilisé pour le concours) pour boucler la boucle avec le CTA de la homepage qui renvoie vers cette page.
3. **Ligne de pied de page** sur les 9 pages qui ont déjà une ligne concours (index, menu, avis, reseaux, composer, vegetarien, supplements, faq) + `concours.html` — `.site-footer__panuzo-line`, sous la ligne concours existante.
4. Section homepage déjà en place (mission précédente), point d'entrée principal.

Vérifié en navigateur réel sur `menu.html`, `reseaux.html`, `avis.html` : aucune erreur console, éléments visibles avec les bonnes dimensions, liens corrects (`index.html#panuzo-teaser` depuis les autres pages, `#panuzo-teaser` en ancre directe depuis `index.html`), aucun débordement horizontal à 375px. Une fausse alerte de débordement est apparue sur `menu.html` à une largeur de viewport non standard (~300px, résidu d'un test précédent) — vérifiée et confirmée sans lien avec les nouveaux éléments (déjà présente sur les badges du header, pré-existante).
