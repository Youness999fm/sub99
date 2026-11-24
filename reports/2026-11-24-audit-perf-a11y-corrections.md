# Audit perf/fonctionnel/a11y — subito-pizza.vercel.app/commercant/ + www.subito-pizza-heninbeaumont.fr (24/11/2026, passage 8)

## Mission et périmètre

Mission reçue : audit complet (performance, fonctionnel, accessibilité) des deux domaines de production, correction des problèmes réellement observés, avec preuve à chaque étape. Ce rapport ne reprend pas ce qui est déjà prouvé dans les passages précédents de la même journée ([`2026-11-24-audit-perf-ux-client.md`](2026-11-24-audit-perf-ux-client.md), [`2026-11-24-audit-qa-client-commercant.md`](2026-11-24-audit-qa-client-commercant.md)) — il couvre le terrain neuf trouvé lors de cette passe.

**Méthode** : deux agents dédiés en lecture seule ont audité le code source (performance et accessibilité des 14 pages client), pendant qu'un test réel dans le navigateur (bureau + mobile 375px, console, réseau, clavier) était mené en parallèle sur le serveur de développement local (identique au code de production). Toute correction a été re-testée en direct avant d'être considérée faite. **Aucune mesure Lighthouse** (outil non installé dans le projet) — uniquement des constats de code et des mesures de laboratoire via les API navigateur, jamais inventés.

Aucun déploiement effectué par cette passe — tout est en local, prêt à être poussé sur votre instruction.

## Corrections appliquées (vérifiées en direct)

1. **Logo illisible sur l'écran de connexion commerçant et sur le bandeau du haut** — [`commercant/index.html`](../commercant/index.html) utilisait le logo rectangulaire complet (`logo.jpg`, 520×215) dans un badge rond de 64px/36px avec `object-fit: cover` : le texte "SUBITO PIZZA" était coupé en plein milieu, illisible (capture avant : un fragment "JbI...GINAL DEPUIS T...Z"). Remplacé par l'icône carrée déjà présente dans le projet (`assets/img/icons/icon-192.png`, le même logo proprement recadré sur fond vert pour un usage carré/rond). Même correction sur la vignette du ticket à l'écran (`.t-logo` dans [`assets/js/commercant.js`](../assets/js/commercant.js)), qui écrasait le logo (`object-fit` par défaut = étirement) dans un cercle. **Non touché** : la conversion du logo en bitmap pour l'impression thermique physique (`prepareLogoRaster()`), qui préserve déjà correctement les proportions — c'était la bonne logique, pas besoin d'y toucher.
   - Vérifié : capture d'écran avant/après sur l'écran de connexion, logo pleinement lisible après correction.

2. **Décalage de mise en page (CLS) du logo client** — [`assets/css/style.css`](../assets/css/style.css) : `.site-header__logo img` n'avait aucune dimension réservée (ni `width`/`height`, ni `aspect-ratio`), contrairement au reste du site qui réserve systématiquement l'espace des images. Ajouté `aspect-ratio: 520 / 215` (ratio réel du fichier). Présent sur les 14 pages client.
   - Vérifié : `getBoundingClientRect()` en direct confirme un ratio affiché identique au ratio intrinsèque, aucun changement visuel.

3. **Message d'erreur des formulaires jamais porté à l'attention du clavier** — [`compte.html`](../compte.html) (connexion, création de compte, profil, adresse) : le message d'erreur (`role="alert"`) s'affichait sans jamais recevoir le focus, donc un utilisateur au clavier devait chercher où il était apparu. Ajouté `tabindex="-1"` sur les 4 paragraphes d'erreur + `el.focus()` dans `showError()` ([`assets/js/compte.js`](../assets/js/compte.js)) : le focus saute maintenant sur le message dès qu'il apparaît.
   - Vérifié en direct : tentative de connexion invalide → `document.activeElement` pointe bien sur le message d'erreur, capture d'écran à l'appui.

4. **Aucun repère visuel pour les champs obligatoires** — seuls les champs facultatifs étaient annotés ("(facultatif)"). Ajouté un astérisque visuel (`.req-mark`, masqué aux lecteurs d'écran puisque l'attribut `required` natif est déjà annoncé) + une légende "* champ obligatoire" en tête de chaque formulaire concerné : connexion, inscription et profil dans [`compte.html`](../compte.html), formulaire de réclamation dans [`avis.html`](../avis.html).
   - Vérifié en direct (capture d'écran) sur les deux pages, aucune régression de mise en page après correction du premier essai (le marqueur se retrouvait sur sa propre ligne — corrigé en le regroupant avec le texte du label dans un même élément).

5. **Panier (tiroir latéral) : le clavier pouvait sortir du panneau ouvert** — `onDrawerKeydown()` dans [`assets/js/cart.js`](../assets/js/cart.js) ne gérait qu'Échap. Ajouté le même piège de focus (Tab/Maj+Tab restent dans le panneau) déjà utilisé ailleurs sur le site (`order-launch.js`), en interrogeant les éléments focalisables à chaque frappe (résiste au contenu dynamique du panier).
   - Vérifié en conditions réelles (clic réel + vraies touches Tab/Maj+Tab/Échap, pas d'émulation JS) : 11 Tab consécutifs restent dans le panier, le 12ᵉ boucle correctement sur le premier élément, Échap referme et rend le focus au bouton d'origine.

6. **Fenêtre "photo agrandie" (galerie accueil) sans sémantique de boîte de dialogue** — ajouté `role="dialog" aria-modal="true" aria-label="Photo agrandie"` sur `.lightbox` dans [`index.html`](../index.html). Fonctionnalité actuellement non déclenchable en production (les vignettes de la galerie sont encore des espaces réservés en attendant de vraies photos — `data-lightbox-src` n'est renseigné sur aucune, voir le commentaire existant dans le fichier), donc correction préventive sans risque de régression visible aujourd'hui.

7. **En-têtes de cache absents pour les fichiers statiques** — [`vercel.json`](../vercel.json) n'avait aucune règle `Cache-Control` pour `/assets/*` (seules les routes `/api/*` en avaient une). Ajouté `public, max-age=3600, must-revalidate` : un gain de cache modéré et sûr, sans risque de contenu périmé puisque les pages client n'utilisent pas de versionnage `?v=` (contrairement à `commercant/index.html`).

## Confirmé correct (pas de régression, pas d'action nécessaire)

- **Règle d'échange retrait/ajout gratuit** (ex. retirer un ingrédient pour en ajouter un autre gratuitement) : testée en direct sur `menu.html` (Végétarienne Duo). Le calcul est **déjà basé sur le prix réel de chaque ingrédient** (`applySwapDiscount()`, [`assets/js/cart.js:792`](../assets/js/cart.js)), pas sur une catégorie figée — contrairement à une note plus ancienne dans un autre document de planification de ce dépôt, qui décrivait un état antérieur du code déjà corrigé depuis. Retirer le "fromage" de base (qui n'a pas de prix listé comme supplément autonome) ne donne logiquement aucun crédit : comportement correct, pas un bug.
- **Écouteurs de scroll** (`main.js`) : déjà correctement limités via `requestAnimationFrame`, aucune charge CPU excessive trouvée.
- **Structure des titres, alternative textuelle des images, atterrissage des formulaires sur de vrais `<button>`** : rien à signaler sur les 14 pages client (vérifié par l'agent dédié).
- **Suite de tests backend** (`tests/api-vercel/*.test.mjs`) : 237/238 après les corrections, strictement identique à l'état avant cette passe (le seul échec est le faux positif de fin de ligne CRLF/LF déjà identifié dans un rapport précédent, sans rapport avec ce travail).

## Repéré mais non corrigé (recommandation, pas d'action prise)

- **JS/CSS non minifiés** (`cart.js` ~150 Ko, `style.css` ~79 Ko, `main.js` ~54 Ko) livrés tels quels, `cart.js` chargé même sur des pages sans panier (mentions légales, FAQ, réseaux). Gain réel mais demande d'ajouter une étape de build au déploiement — décision à prendre avec vous plutôt qu'à imposer silencieusement.
- **Polices Google Fonts bloquantes** (préconnexion déjà en place, mais la feuille de style elle-même reste bloquante). Gain mesurable uniquement en conditions réelles (outil de mesure absent ici).
- **Photos non redimensionnées par appareil** (pas de `srcset`/format WebP) : 92 photos de 50 à 104 Ko chacune, déjà en chargement différé (`loading="lazy"`), mais le même fichier plein format part vers mobile et bureau.

## Fichiers modifiés

`assets/css/style.css`, `assets/js/compte.js`, `compte.html`, `avis.html`, `assets/js/cart.js`, `index.html`, `commercant/index.html`, `assets/js/commercant.js`, `vercel.json`.

## Preuve

Captures d'écran avant/après (logo, champs obligatoires, message d'erreur focalisé) + vérifications en direct du piège de focus au clavier réalisées dans cette session (navigateur intégré, serveur de développement local). Suite de tests complète relancée après les corrections : 237/238 (inchangé).
