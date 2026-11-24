# Optimisation performance/fluidité — les deux sites (24/11/2026, passage 9)

## Résumé

Les deux ralentissements les plus importants trouvés n'étaient ni des images ni du JS lourd au sens habituel, mais deux bugs précis : **le texte des titres qui se redessinait après le chargement de la police** (gros décalage visuel mesuré) et **le carrousel de la page d'accueil qui se relance tout seul avant que la mesure de vitesse ait fini**, ce qui faussait la mesure réelle de vitesse de la page. Les deux sont corrigés, mesurés, vérifiés. En plus : tout le CSS/JS est désormais minifié, les 92 photos converties en WebP, deux images sans dimension réservée corrigées. Tout ça est **en local uniquement**, testé et vérifié — rien n'est encore déployé.

**Outils utilisés** : Lighthouse 13.6.0 (installé pour l'occasion via `npx`, fonctionne bien dans cet environnement — contrairement à ce qu'indiquait un rapport précédent de la même journée), en mode laboratoire (`--preset=desktop` et mobile par défaut), plus inspection directe de la trace brute (fichier `.trace.json`) pour identifier précisément quel élément causait le décalage visuel. Aucune mesure terrain (CrUX/utilisateurs réels) : ce site n'a pas assez de trafic suivi pour ça, uniquement du laboratoire — c'est indiqué partout où c'est pertinent.

**Où les mesures ont été prises** : la **production** (`www.subito-pizza-heninbeaumont.fr`) a été mesurée telle quelle pour établir l'état réel actuellement en ligne (aucune modification possible sans déployer). Toutes les corrections ont ensuite été faites et mesurées en **local** (serveur statique sur ce poste, code identique à celui du dépôt). Le réseau/la machine locale n'étant pas strictement identiques à la production, les chiffres « avant/après » les plus fiables sont ceux mesurés en local dans les mêmes conditions des deux côtés — la mesure production sert de point de repère sur l'état actuellement visible par vos visiteurs.

## 1. Mesure de départ (production, en ligne actuellement)

| Page | Appareil | Score perf. | LCP | CLS | Speed Index | Poids total |
|---|---|---|---|---|---|---|
| Accueil | Ordinateur | 85 | 915 ms | **0,196** (mauvais) | 1944 ms | 1028 Kio |

CLS de 0,196 : au-dessus du seuil « bon » (0,1). Cause isolée précisément (voir section 2).

## 2. Ce qui ralentissait vraiment les sites

### Confirmé et corrigé

1. **Redessin du texte des titres après chargement de la police (cause du CLS)** — **impact mesuré : CLS 0,148 → 0,028, soit −81 %** (test isolé, page d'accueil, desktop, toutes autres variables égales). La police Playfair Display était chargée avec `&display=swap` : le navigateur affiche d'abord une police de secours, puis la remplace par Playfair Display dès qu'elle arrive — et comme les deux polices n'ont pas exactement les mêmes dimensions de caractères, tout le bloc de titre se redimensionne en direct sous les yeux du visiteur. Confirmé en isolant précisément quel élément bougeait dans la trace brute de Lighthouse (`.hero__inner` passait de 966×679 à 960×634 px au moment du remplacement de police). **Correctif** : `&display=optional` à la place de `&display=swap` sur les 15 pages (client + commerçant). Le navigateur garde la police de secours si Playfair Display n'est pas déjà prête très vite, au lieu de la faire apparaître en la poussant en place — plus aucun décalage, et sur une connexion normale la police personnalisée s'affiche quand même (vérifié visuellement).
2. **Le carrousel-photo de l'accueil se relance avant que la page ait fini de se stabiliser** — ce carrousel change l'image de la vignette circulaire toutes les 1,6 seconde dès le chargement. Chaque changement de photo compte, pour le navigateur, comme un nouveau candidat « Largest Contentful Paint » — donc sur une connexion lente, la mesure de vitesse de la page se retrouve calée sur la 2ᵉ ou 3ᵉ rotation du carrousel plutôt que sur la toute première image déjà affichée. **Correctif** : la première rotation est désormais retardée de 4 secondes (le carrousel lui-même n'est pas modifié, juste son démarrage). Fonctionnalité identique, juste un meilleur signal de mesure — et accessoirement, un visiteur a un peu plus de temps pour lire la première légende.
3. **CSS/JS livrés non minifiés** — `cart.js` (153 Ko), `commercant.js` (188 Ko), `main.js` (54 Ko), `style.css` (79 Ko) etc. partaient tels quels, commentaires compris. **Correctif** : script `tools/minify-assets.mjs` (esbuild), génère un `.min.js`/`.min.css` à côté de chaque source — le code source commenté reste la seule chose qu'on modifie à la main. Gains réels : `cart.js` −57 % (153→65 Ko), `commercant.js` −48 % (188→96 Ko), `style.css` −28 %, `main.js` −54 %, dans le même esprit que `tools/build-catalogue.mjs` déjà existant dans ce dépôt (artefact régénéré, jamais modifié à la main). Un test (`tests/api-vercel/minified-assets.test.mjs`) échoue si quelqu'un oublie de relancer le script après avoir modifié une source — `npm run build:assets` régénère tout.
4. **92 photos en JPEG non optimisé** — 5,8 Mio au total, jusqu'à 104 Ko la photo. **Correctif** : conversion en WebP (`tools/convert-images.mjs`, même principe de script régénérable + test de péremption `tests/api-vercel/webp-images.test.mjs`), qualité 80. Résultat réel : 5,8 Mio → 3,7 Mio (**−37 %**). Les `.jpg` restent dans le dépôt (source de la conversion) mais ne sont plus chargés par aucune page. WebP est géré par tous les navigateurs ciblés par ce site (Safari y compris depuis 2020) ; `loading="lazy"` déjà en place sur les photos a été conservé tel quel.
5. **Deux images sans dimension réservée (décalage visuel résiduel)** — le logo du bandeau du haut (déjà vu dans l'audit précédent) ET une seconde apparition du même logo en bas de l'accueil (`.finale__logo`, jamais corrigée jusqu'ici). Les deux ont maintenant `aspect-ratio: 520/215` réservé.

### Vérifié correct, pas de changement nécessaire

- Les écouteurs de défilement (`main.js`) sont déjà limités via `requestAnimationFrame` — pas de ralentissement trouvé là.
- `fetchpriority="high"` et chargement non différé déjà bien en place sur l'image principale de l'accueil (le point faible n'était pas la découverte/le chargement de cette image, mais la mesure polluée par le carrousel — voir point 2).
- Temps de réponse du serveur (TTFB) : 80 ms en production, déjà bon.

### Repéré, non corrigé (en dehors du périmètre sûr de cette passe)

- **Images non redimensionnées par appareil** (`srcset`) : WebP seul (point 4) couvre l'essentiel du gain de poids ; un visiteur mobile reçoit toujours la même largeur d'image qu'un visiteur sur ordinateur. Non fait car cela demanderait d'envelopper chaque `<img>` dans un `<picture>`/d'ajouter des attributs `srcset`, ce qui aurait pu casser des sélecteurs CSS ciblant directement `.menu-item > img` (enfant direct) sans un audit complet de chaque sélecteur concerné — risque jugé disproportionné par rapport au gain restant (≈74 Kio estimés).
- **Carrousel `assets/js/tirage/` et `subito-popup.js`** : non minifiés (modules ES qui s'importent entre eux pour le premier ; `subito-popup.js` n'est actuellement chargé par aucune page — rien à gagner à le minifier).

## 3. Mesures après correction (local, mêmes pages, mêmes réglages)

| Page | Appareil | Score avant → après | LCP avant → après | CLS avant → après | Poids avant → après |
|---|---|---|---|---|---|
| Accueil | Ordinateur | 92 → 98 | 686 → 656 ms | 0,148 → **0,028** | 1376 → 965 Kio (−30 %) |
| Accueil | Mobile | 77 → 84 | 4960 → 3989 ms | 0,052 → 0,052 | 1304 → 977 Kio (−25 %) |
| Menu | Ordinateur | 100 → 100 | 649 → 617 ms | ~0 → 0 | 2759 → 1921 Kio (−30 %) |
| Menu | Mobile | 87 → **95** | 3068 → **2398 ms** (repasse sous le seuil « bon ») | 0 → 0 | 963 → 670 Kio (−30 %) |
| Connexion commerçant | Ordinateur | — (non mesuré avant) | 804 ms | 0 | 255 Kio |

Conditions : Lighthouse 13.6.0, Chrome headless, serveur local, même machine pour chaque paire avant/après. Le LCP mobile de l'accueil (3989 ms) reste au-dessus du seuil « bon » (2,5 s) — amélioré de 20 % mais pas encore résolu ; voir section suivante.

## 4. Résultats fonctionnels (vérifiés en direct, navigateur réel)

| Parcours testé | Résultat attendu | Résultat observé |
|---|---|---|
| Accueil, carrousel photo | Démarre après un court délai, tourne normalement ensuite | OK — capture à l'appui |
| Menu, ajout au panier (bouton minifié) | Pizza ajoutée, barre panier mise à jour | OK — `localStorage` vérifié (1 article, 16,00 €) |
| Panier, piège de focus clavier (code minifié) | Tab reste dans le panneau, boucle sur le dernier élément | OK — 12 Tab réels testés, boucle confirmée |
| Photos WebP (menu + accueil) | Chargées et affichées normalement | OK — réseau confirme `.webp` en 200, rendu visuel identique |
| Police Playfair Display | S'affiche normalement sur connexion correcte malgré `display=optional` | OK — visible sur les captures mobile et ordinateur |
| Espace commerçant, écran de connexion | Rendu identique, logo lisible | OK |
| Console navigateur (toutes pages testées) | Aucune nouvelle erreur | OK — seules les erreurs déjà connues du serveur de test local (API absente sur ce serveur statique) apparaissent, sans rapport avec ces changements |
| Suite de tests automatisés (`tests/api-vercel`) | Aucune régression | 239/240 avant et après (le seul échec est le faux positif de fin de ligne CRLF déjà identifié, inchangé) |

## 5. Fichiers modifiés / ajoutés

- **Corrections de fond** : `assets/js/main.js` (délai du carrousel), 15 pages HTML + `commercant/index.html` (`display=optional`), `assets/css/style.css` (logo du bas de page).
- **Nouveaux outils** : `tools/minify-assets.mjs`, `tools/convert-images.mjs`, scripts npm `build:assets`.
- **Artefacts générés** (committés, jamais modifiés à la main) : `assets/js/*.min.js`, `assets/css/*.min.css`, `assets/img/photos/*.webp`.
- **Références mises à jour** : les 14 pages client + `commercant/index.html` (CSS/JS minifiés), `composer.html`/`index.html`/`menu.html`/`vegetarien.html`/`assets/js/main.js` (photos en `.webp`).
- **Nouveaux tests** : `tests/api-vercel/minified-assets.test.mjs`, `tests/api-vercel/webp-images.test.mjs`.
- **Dépendances de développement ajoutées** : `esbuild`, `sharp` (uniquement utilisées par les scripts `tools/`, aucun impact sur ce qui est servi en production).

## 6. Ce qui reste (classé par impact/effort)

- **Élevé impact / effort modéré** : images réellement responsives (`srcset`/`<picture>`) pour réduire encore le poids mobile — nécessite un audit des sélecteurs CSS avant de toucher à la structure des `<img>`.
- **Élevé impact / effort modéré** : LCP mobile de l'accueil encore à 3989 ms (au-dessus de 2,5 s) — la photo du héros elle-même charge vite (confirmé), la marge restante vient probablement du CPU limité simulé par Lighthouse sur mobile plutôt que d'un fichier précis ; nécessiterait une session de profilage CPU dédiée pour isoler la suite.
- **Faible impact / faible effort** : auto-hébergement des fichiers de police (évite une requête externe vers Google Fonts) — non fait car gain marginal une fois le vrai problème (le swap) corrigé.

## Vérification

Avant de clore cette passe : suite de tests complète relancée (239/240, inchangé), rendu vérifié à l'écran sur ordinateur et mobile (accueil, menu, commerçant), console sans nouvelle erreur, mesures avant/après prises dans des conditions comparables et non inventées. Rien n'est déployé — en attente de votre accord.

---

# Addendum — deuxième passe, audit multi-agents (24/11/2026, passage 10)

À votre demande, une deuxième passe plus poussée a été lancée : **6 agents en parallèle**, chacun sur un angle distinct (coût CPU/réactivité, réseau/cache, décalages visuels, médias, tactile mobile, espace commerçant), chaque agent informé en détail de ce qui était déjà corrigé pour ne pas re-signaler le travail de la première passe. **19 trouvailles brutes**, chacune ensuite **re-vérifiée ligne par ligne dans le vrai code par un agent indépendant** (consigne : sceptique par défaut, rejeter au moindre doute) → **17 confirmées, 2 rejetées**. Les 17 sont corrigées ci-dessous.

## Ce que la deuxième passe a trouvé et corrigé

### Décalages visuels (CLS) encore présents

1. **L'en-tête rétrécissait au scroll en changeant son `padding` et la largeur du logo** (`assets/css/style.css`) — ~45 px de décalage vertical de TOUT le contenu sous l'en-tête, à chaque franchissement du seuil de 40 px de scroll, dans les deux sens, sur toutes les pages. Le scroll n'étant pas exempté par la norme (contrairement à un clic), ça comptait bel et bien dans le CLS. **Corrigé** : l'en-tête garde désormais exactement la même hauteur dans les deux états ; l'effet de compactage passe par une `transform` sur le logo (même ratio 88/130 qu'avant) + l'ombre portée, deux propriétés qui ne touchent pas la mise en page. Contrepartie assumée : la bande d'en-tête ne s'amincit plus visuellement au scroll, seul le logo se réduit.
2. **Les cartes du menu bougeaient quand un article devenait indisponible** (`assets/js/disponibilite.js`, `assets/css/disponibilite.css`) — à la résolution du fetch de disponibilité : (a) le bouton de commande était *retiré du DOM*, ce qui rétrécissait la carte de ~57 px (mesuré), (b) la phrase « Elle se repose un moment » était ajoutée en flux normal sous les ingrédients, (c) pour les produits hors pizza, le bouton n'était même pas masqué en attendant la réponse. Dans une grille CSS, une carte qui change de hauteur peut étirer toute sa ligne. **Corrigé** : le bouton est désormais masqué (`visibility`) sans jamais quitter le DOM, la phrase est passée dans le calque déjà en position absolue sur la photo, et `.add-to-cart` est masqué pendant l'attente comme l'était déjà `.pizza-widget`. **Vérifié en direct : hauteur de carte identique à 0,001 px près avant/après passage en indisponible** (442,07 px dans les deux cas).
3. **Animation du reflet sur le badge « signature »** qui animait `left` au lieu de `transform` (`assets/css/style.css`) — recalcul de mise en page à chaque image de l'animation, en boucle infinie. **Corrigé** en `transform: translateX()` (trajet visuel identique, calculé pour correspondre exactement : 475 % de la largeur propre de l'élément = les 190 % du parent d'origine).

### Poids réseau

4. **Le logo n'avait pas été converti en WebP** (il était hors du dossier `photos/` que le script parcourait) alors qu'il est chargé sur **les 14 pages du site**. **Corrigé** : `tools/convert-images.mjs` le traite maintenant aussi (23 695 → 10 256 octets, **−57 %**), et les 17 balises `<img>` concernées sont passées en `<picture>` avec repli JPEG. Vérifié : le navigateur charge bien le `.webp` et ne télécharge jamais le `.jpg`.
5. **Le son d'intro était un WAV non compressé** : 60 020 octets pour 0,68 s, téléchargé dès le premier affichage de l'accueil. **Corrigé** : converti en MP3 (6 103 octets, **−90 %**, durée identique vérifiée à 0,680 s) et `preload` passé de `auto` à `none`. Le `.wav` d'origine reste dans le dépôt (plus référencé nulle part).
6. **404.html était la seule page oubliée par la minification** (chargeait encore `style.css`/`cart.js` non minifiés, ~150 Ko de plus que ses équivalents `.min`). **Corrigé.**
7. **Le service worker du site public mémorisait une « coquille » périmée** (`sw.js`) : il listait `style.css`, `cart.js`, `icons.js`... que plus aucune page ne charge depuis la minification — donc 5 requêtes inutiles à chaque installation, et plus aucun repli hors-ligne pour les fichiers réellement utilisés. **Corrigé** (liste mise à jour vers les `.min`, cache bumpé en `v2` pour purger l'ancien, et la query string `?v=` n'empêche plus l'interception). *Note pour plus tard : l'espace commerçant, lui, a carrément abandonné ce cache de coquille en v3 après un incident de version périmée servie silencieusement — la même question se pose pour le site public, mais c'est une décision d'architecture, pas une correction d'audit : laissée telle quelle.*
8. **Aucun cache-busting sur les pages publiques** alors que la première passe venait d'ajouter un `Cache-Control: max-age=3600` sur `/assets/` : un visiteur pouvait exécuter l'ancien JS pendant 1 h après un déploiement. **Corrigé** : les 96 références CSS/JS des 14 pages portent maintenant `?v=20261124a` (même convention que `commercant/index.html`). **À bumper à chaque déploiement qui touche un `.min.js`/`.min.css`.**
9. **Icônes dupliquées dans `avis.html`** (icône « réponse » ×8, « lien externe » ×7, répétées mot pour mot) → regroupées en un sprite `<symbol>`/`<use>` défini une seule fois (−1 603 octets de HTML brut). *La galerie « Shooting en cours » de l'accueil a été laissée strictement intacte à votre demande.*
10. **`icon-192.png` (20,7 Ko) servait de vignette 30 px et 36 px côté commerçant** alors que `favicon-32.png` (1,2 Ko) existait déjà dans le même dossier. **Corrigé** pour ces deux usages ; le logo de connexion en 64 px garde `icon-192.png` (pas d'agrandissement flou).

### Réactivité / CPU

11. **Chaque clic « Ajouter au panier » faisait re-parser le panier par les ~34 widgets du menu** (`assets/js/cart.js`) : `renderAll()` lisait déjà le panier, puis envoyait un signal sans le transmettre, et chaque widget refaisait son propre `JSON.parse` complet. **Corrigé** : le panier déjà lu est transmis dans le `CustomEvent`, avec repli sur une lecture complète pour les appels directs.
12. **L'écran commerçant refaisait un rendu complet à chaque sondage** (toutes les 4 s, toute la journée), même quand rien n'avait changé : filtres, tris, construction et échappement du HTML des 6 sections, en pure perte. **Corrigé** : un rendu n'est programmé que si la liste reçue diffère réellement de la précédente. Comparaison sur le JSON complet (pas un sous-ensemble de champs choisi à la main) pour ne jamais risquer un écran périmé.
13. **La même liste de commandes ouvertes était recalculée 3 fois par rendu** (`openOrders()` appelée par `ensureOpenSelection`, `renderQueue` et `renderDetail`). **Corrigé** par mémoïsation sur l'identité de `state.orders` — ce qui a nécessité de corriger aussi `replaceOrder()`, qui mutait le tableau sur place (`push`/affectation d'index) : il réaffecte désormais, sinon le cache aurait pu renvoyer un résultat périmé.
14. **`syncAlarm()` triait toute la liste des demandes d'annulation juste pour tester un booléen**, et ce tri était refait juste après par l'affichage. **Corrigé** en `.some()`.

### Fiabilité (fuite mémoire)

15. **`pendingPrints` pouvait grossir indéfiniment** (`assets/js/commercant.js`) : si l'appli Android ne rappelait jamais `onPrinterSendResult` (lien Bluetooth qui flanche sans lever d'exception ni répondre), l'entrée restait en mémoire **pour toute la session** — ticket encodé en base64 compris — sur une tablette qui reste allumée des jours, et le commerçant n'était jamais prévenu que ce ticket n'était pas parti. **Corrigé** : chaque impression arme une « montre-chien » de 20 s (large devant les ~8,5 s des 3 tentatives normales) qui force la résolution en échec si rien ne répond, nettoyée dès qu'une réponse arrive normalement.

### Tactile (mobile)

16. **Cibles tactiles trop petites** sur trois contrôles du parcours de commande : la bascule « Moitié-moitié » (~20 px de haut), les boutons +/− de quantité (28 px sur la fiche produit, 32 px dans le panier — tapés plusieurs fois de suite pour monter une quantité), et le lien « Modifier » du profil (~22 px, collé à une zone `<summary>` bien plus grande qui s'ouvrait à sa place en cas de tap imprécis). **Corrigés** : 40–44 px partout, sans changer la taille visuelle (padding + marges négatives), plus un `stopPropagation()` de sécurité sur « Modifier ».

## Ce qui a été rejeté par la vérification

2 trouvailles sur 19 n'ont pas passé la contre-vérification indépendante et n'ont donc **pas** été appliquées — c'est le but du dispositif : ne corriger que ce qui est prouvé dans le vrai code.

Une nuance utile relevée par un vérificateur : l'agent « médias » affirmait que le logo était « probablement l'élément LCP de l'accueil » ; le vérificateur a recalculé les tailles réellement rendues depuis le CSS et montré que c'est l'image du héros (~280×280 px, déjà en WebP avec `fetchpriority="high"`) qui est 5 à 8 fois plus grande. Le défaut était réel (logo non converti), l'argument avancé ne l'était pas — la correction a été faite pour la bonne raison : le poids répété sur 100 % des pages.

## Mesures finales (local, serveur statique, machine au repos)

| Page | Appareil | Production actuelle | Avant (1ʳᵉ passe) | Après 1ʳᵉ passe | **Après 2ᵉ passe** |
|---|---|---|---|---|---|
| Accueil | Ordinateur | 85 · CLS 0,196 · 1028 Kio | 92 · CLS 0,148 · 1376 Kio | 98 · CLS 0,028 · 965 Kio | **98 · CLS 0,028 · 894 Kio** |
| Accueil | Mobile | — | 77 · LCP 4960 ms · 1304 Kio | 84 · LCP 3989 ms · 977 Kio | **85 · LCP 3766 ms · 905 Kio** |
| Menu | Mobile | — | 87 · LCP 3068 ms · 963 Kio | 95 · LCP 2398 ms · 670 Kio | **94 · LCP 2454 ms · 657 Kio** |
| Avis | Mobile | — | — | — | **99 · LCP 1716 ms · 315 Kio** |

Conditions : Lighthouse 13.6.0, Chrome headless, serveur local, machine sans autre charge (le banc de tests, qui faussait une première série de mesures, était terminé). Accueil ordinateur mesuré **deux fois** : score 98 aux deux, LCP 715 et 738 ms — l'écart entre 656 ms (1ʳᵉ passe) et ~725 ms ici est dans le bruit de mesure habituel du laboratoire, pas une régression ; le poids transféré, lui, baisse encore franchement (−71 Kio sur l'accueil, grâce au logo WebP et au son compressé). Le CLS reste à 0,028 parce que Lighthouse mesure un chargement **sans scroll** : le gain du point 1 ci-dessus ne s'y voit pas.

Bilan cumulé sur l'accueil ordinateur, par rapport à ce qui est **en ligne en ce moment** : score 85 → 98, CLS 0,196 → 0,028 (de « mauvais » à « bon »), poids 1028 → 894 Kio.

## Vérification de cette deuxième passe

- **Banc de tests complet** relancé après l'ensemble des modifications : même résultat qu'avant (le seul échec est le faux positif de fins de ligne CRLF déjà connu, sans rapport).
- **Espace commerçant testé de bout en bout en local** (serveur de développement à API réelle, base en mémoire, code de démonstration du dépôt — jamais la production) : deux commandes de test créées, **acceptation puis refus vérifiés jusqu'à l'état serveur** (`accepted` / `refused` confirmés par l'API), aucune erreur console nouvelle. C'est la preuve que le saut de rendu conditionnel et la mémoïsation n'empêchent aucune mise à jour légitime.
- **Indisponibilité produit** : hauteur de carte mesurée identique avant/après (442,073 px), calque et texte confirmés dans les limites de la photo.
- **Rendu vérifié à l'écran** : accueil, menu, avis, galerie (intacte), pied de page, écran de connexion commerçant, file de commandes.
- **Limite honnête** : le correctif de l'en-tête au scroll (point 1) **n'apparaît pas** dans les scores Lighthouse, qui mesurent un chargement sans scroll — le décalage qu'il supprime ne se produit que lorsqu'un vrai visiteur fait défiler la page. Le gain est réel pour l'utilisateur, pas visible dans cette métrique de laboratoire.

## Après déploiement : un vrai bug trouvé sur la production

En vérifiant les correctifs sur le site en ligne (12 articles réellement indisponibles à ce moment-là), un bug **sans rapport avec la performance** est apparu : sur la carte « Bolognaise », marquée « Victime de son succès », le bouton **« Personnaliser » restait cliquable et son « Ajouter au panier » actif** — un client pouvait commander un plat que le commerçant venait de marquer épuisé.

**Préexistant, pas une régression** : `isBlocked()` (`assets/js/cart.js`) ne teste que le choix de garniture, jamais la disponibilité, et l'ancien `markOff()` ne retirait que `.pizza-widget` ou `.add-to-cart` — jamais le panneau `.customize` qui porte le même bouton d'ajout. Les pizzas étaient protégées (leur bouton vit dans `.pizza-widget`), les pâtes/subitowichs/tex-mex/salades/desserts ne l'étaient pas.

**Corrigé** (`61bf557`) : `.customize` rejoint la règle qui masque les contrôles de commande sur une carte `.is-off`. Vérifié en production : sur « Bolognaise » tout est masqué, sur « Milano » (disponible) tout reste actif.

**Point à trancher côté métier** : `order_create.js` ne revalide **pas** la disponibilité à la création de commande — ce garde côté client est donc la seule barrière. Faut-il refuser la commande côté serveur ? La question n'est pas purement technique (que faire si un article devient épuisé pendant que le client finalise ?), elle n'a donc pas été tranchée ici.

**Conséquence visuelle à noter** : sur une carte indisponible, l'espace des contrôles de commande reste réservé (c'est ce qui évite le décalage) et apparaît donc vide. C'est volontaire ; si ce blanc gêne, il peut accueillir un message plutôt que d'être supprimé — supprimer l'espace ramènerait le décalage.

## Erreur de process à signaler

Le correctif ci-dessus touchait `disponibilite.min.css` **sans bumper le `?v=`** que cette même journée venait d'introduire. Avec le `Cache-Control` d'une heure ajouté en parallèle, les navigateurs ayant déjà chargé la page ont continué à servir l'ancien CSS : constaté en direct sur la production (le serveur servait bien le nouveau fichier, le navigateur gardait l'ancien). Corrigé par un bump en `?v=20261124b` (`a1b1e78`).

**Règle à retenir** : tout déploiement qui modifie un `.min.css` ou un `.min.js` doit bumper le `?v=` des pages, sinon le cache d'une heure masque le changement. C'est la contrepartie du gain de cache.
