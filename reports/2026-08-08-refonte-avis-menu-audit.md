# Rapport — Refonte parcours avis, finalisation menu.html, audit technique

Session de nuit (2026-08-08), travail autonome pendant que le client dormait, sur instruction explicite ("finalise et maximise le site, sois le meilleur").

## 1. Parcours de notation (`avis.html`)

Demande du client, en plusieurs messages successifs : ne plus proposer d'avis interne écrit sur le site (uniquement Google), et faire en sorte qu'une note basse redirige vers la réclamation plutôt que de simplement collecter la note.

**Implémenté** (`avis.html`, `assets/js/main.js` — `initReviewForm()`) :
- Suppression complète du formulaire interne "Écrivez-nous directement" (avis publié nulle part, il ne servait qu'à collecter un message privé).
- **4-5 étoiles** → ouverture automatique de la fiche Google (nouvel onglet) dès le clic sur l'étoile, avec un panneau de confirmation + bouton de secours si le navigateur bloque l'ouverture automatique.
- **1-3 étoiles** → défilement automatique vers la section "Un souci avec votre commande ?" (`#reclamation`), avec focus direct sur le premier champ du formulaire.

**Point de vigilance conformité (Google, avril 2026)** : rediriger sélectivement les notes basses loin de Google est en zone grise du "review gating" si Google devient inaccessible pour ces notes-là. Décision prise : le lien Google reste **en permanence visible et cliquable** dans la section réclamation (`.complaint-section__google`), quelle que soit la façon dont le client y est arrivé. Le choix n'est donc pas de masquer Google aux mécontents, mais de leur proposer en priorité un canal de résolution concrète, sans jamais leur retirer l'accès à Google. Documenté en commentaire dans `avis.html` et `main.js`.

**Bug pré-existant trouvé et corrigé pendant les tests** : `.review-step { display: flex }` écrasait l'attribut natif `hidden` (la règle d'auteur gagne sur la règle navigateur `[hidden]{display:none}`), donc le panneau "Merci pour votre note" s'affichait **en permanence**, dès le chargement de la page, avant même de cliquer une étoile. Corrigé par l'ajout de `.review-step[hidden] { display: none; }`. Bug antérieur à cette session, pas introduit par les changements ci-dessus — vérifié via capture DOM avant/après.

## 2. Finalisation `menu.html`

- Surlignage automatique de la catégorie active dans la barre de navigation collante (`initMenuJumpActive()`, `IntersectionObserver`), vérifié en scrollant manuellement vers plusieurs sections.
- `.menu-item` ajouté à la liste des grilles avec apparition en cascade au scroll.
- Badge "★ Notre signature" sur la pizza Subito.
- Touche discrète "Depuis 1999" au-dessus du titre `<h1>Notre menu</h1>`.
- **Bandeau défilant de catégories** : essayé puis retiré. Le client a d'abord demandé un bandeau auto-défilant sous le titre, avec des liens cliquables vers chaque catégorie ; après l'avoir vu en place, il a demandé à revenir à l'affichage d'origine ("tous afficher c'est mieux") — masquer certaines catégories derrière une animation à un instant donné allait à l'encontre de l'objectif (donner envie de voir toutes les catégories). Retiré entièrement (HTML + CSS), la barre `.menu-jump` d'origine (déjà présente avant cette session, affiche toutes les catégories en permanence, cliquable, sticky sur mobile) reste seule responsable de la navigation par catégorie.

## 3. Audit technique express (toutes les pages)

- Aucune erreur console sur les 10 pages HTML du site (index, menu, avis, composer, faq, mentions-legales, reseaux, supplements, vegetarien, 404), testées via serveur local (`.claude/serve.ps1`, port 8090 — le rendu direct en `file://` s'est révélé peu fiable dans l'outil de preview, avec du contenu visiblement mis en cache après édition : à éviter pour les tests futurs, toujours passer par le serveur local).
- Tous les liens internes vers d'autres pages (`href="*.html"`) pointent vers des fichiers qui existent réellement.
- **Lien cassé trouvé et corrigé** : `faq.html` renvoyait vers `index.html#faq`, une ancre qui n'a jamais existé sur la page d'accueil (probablement un nom d'ancre jamais synchronisé avec la vraie section). La section concernée ("Notre zone de livraison", qui contient bien le détail par ville mentionné dans la FAQ) n'avait pas d'`id`. Corrigé : ajout de `id="zone-livraison"` sur la section, et mise à jour du lien dans `faq.html` en conséquence.

## 4. Vérifications complémentaires (audit ciblé, adapté à un site statique sans build/backend)

Suite à la demande de mener un audit pré-production complet : le site n'ayant ni build step, ni framework JS, ni backend, ni panier/paiement en ligne, les phases de l'audit demandé qui portent sur ces sujets ne s'appliquent pas (confirmé : aucune trace de panier/checkout/paiement en ligne dans le code, uniquement des mentions informatives des moyens de paiement acceptés en boutique). Vérifications réellement effectuées :

- ✅ Numéro de téléphone identique partout (18 occurrences affichées "03 21 20 00 33", 17 `tel:0321200033`, aucune variante).
- ✅ Adresse identique partout (333 rue Elie Gruyelle, 62110 Hénin-Beaumont).
- ✅ Horaires de prise de commande (18h00-22h47) cohérents entre le texte affiché et la logique JS (`initOrderStatus`).
- ✅ Aucune image sans attribut `alt`.
- ✅ `<title>` et meta description présents sur les 10 pages ; `canonical` présent partout sauf `404.html` (normal, page non indexée) et `supplements.html` (normal aussi : `<meta name="robots" content="noindex">` volontaire, page absente du sitemap — cohérent).
- ✅ Aucun élément de panier/checkout/paiement en ligne : les seules mentions de "paiement" sont informatives (moyens acceptés en boutique : CB, espèces, Ticket Restaurant).
- ✅ Réseaux sociaux : Snapchat (`subito_henin`) et TikTok ont de vrais liens fonctionnels ; Facebook et Instagram affichent "Bientôt disponible" de façon assumée (`aria-disabled`, pas de lien mort), TODO en commentaire pour le développeur suivant.
- ✅ Concours : cohérence numérique confirmée (30 pizzas XXL = 15 gagnants × 2 chacun).
- ✅ Rendu desktop (1280px) vérifié sur `menu.html` et `avis.html` : pas de débordement, grille de catégories bien répartie, pas de chevauchement.
- ✅ `robots.txt` et `sitemap.xml` cohérents entre eux et avec les pages réellement indexables.

Éléments identifiés comme nécessitant une validation externe (déjà connus, non re-testables sans les vraies données) : voir section suivante.

## 5. Barre de navigation rapide sur une seule ligne (`menu.html`)

Demande explicite : ne pas toucher à la grille de catégories (`.menu-jump`), mais ajouter une seconde barre, sur une seule ligne, qui apparaît une fois qu'on a commencé à naviguer dans les sections, avec la même mise en avant (vert foncé + liseré or) pour la catégorie affichée.

**Implémenté** : nouvelle `<nav class="menu-quicknav">` juste après la grille, avec les 7 catégories (Pizzas → Boissons, sans "Composer" ni "Végétarien"). Techniquement, les deux barres sont "empilées" en sticky (la grille reste collante en haut sur mobile, la barre fine se colle juste en dessous, hauteur mesurée en JS avec `--menu-jump-h`/`--menu-sticky-h` recalculées au chargement et au redimensionnement). Un seul `IntersectionObserver` met à jour la catégorie active dans les deux barres à la fois.

**Bug trouvé et corrigé en testant** : la marge de déclenchement de l'`IntersectionObserver` (`-40% 0px -55% 0px`, un pourcentage fixe hérité de l'ancienne implémentation) se retrouvait cachée derrière les deux barres collantes empilées (jusqu'à ~460px de haut sur petit écran), ce qui faisait que la catégorie surlignée restait bloquée sur la précédente au lieu de suivre le défilement réel. Corrigé en calculant la marge en pixels à partir de la hauteur réellement mesurée des barres collantes.

**Ajustement demandé juste après** : la grille ne doit plus rester fixe en permanence — elle défile normalement avec la page (donc disparaît une fois qu'on descend), et c'est la barre fine qui prend le relais en devenant collante à ce moment-là. La barre fine reste masquée (`opacity:0`, `.is-visible` ajouté par JS) tant que la grille est encore à l'écran, et apparaît soit dès qu'on la dépasse en scrollant (détecté via `IntersectionObserver` sur la grille elle-même), soit immédiatement si le client clique sur une catégorie de la grille. Revérifié : masquée au chargement, apparaît au scroll, apparaît instantanément au clic, se recache si on remonte en haut — sur mobile (375px) et desktop (1280px), aucune erreur console.

## 6. Nettoyage CSS et documentation (suite à un plan approuvé)

Demande du client : raisonner en profondeur sur ce qu'il reste à faire, et optimiser. Après relecture directe du code (pas la mémoire, datée), un plan a été soumis et approuvé avant exécution.

- **~110 lignes de CSS mort supprimées** dans `assets/css/style.css`, vérifiées une par une (recherche exhaustive dans les 10 pages HTML + `main.js`, zéro occurrence) : `.site-header__slogan`/`.site-header__location` (ancien header), bloc `.hours-banner*`/`.site-footer__hours` (remplacé par le widget `#order-status`), `.review-form` (conteneur de l'ancien formulaire d'avis interne, supprimé plus tôt cette session), `.legal-content__todo` (ancien encart "à compléter" sur les mentions légales, page maintenant remplie avec les vraies données), bloc `.menu-text*` (ancien accordéon texte du menu, redondant avec le contenu texte réel déjà présent dans la grille actuelle). Revérifié après coup : console propre sur `index.html`, `menu.html`, `avis.html`, `mentions-legales.html`, aucun changement visuel (rien de tout ça ne s'affichait plus).
- **`README.md` réécrit intégralement** pour refléter l'état réel du site (10 pages au lieu de 5, adresse email de contact correcte, parcours avis actuel avec redirection Google/réclamation, statut réseaux sociaux, 8 photos galerie encore en attente).
- **Performance vérifiée sans action nécessaire** : polices déjà chargées avec `preconnect`/`display=swap`, lazy-loading déjà en place sur toutes les images sous la ligne de flottaison, `aspect-ratio` CSS déjà utilisé pour éviter le décalage de mise en page (CLS) sans avoir besoin d'ajouter `width`/`height` sur une centaine de balises `<img>`. Minification CSS/JS délibérément écartée : casserait la promesse d'un site 100% modifiable à la main sans outil de build.

## 7. Balayage final

Après le nettoyage CSS, contrôle systématique pour s'assurer qu'il ne reste rien d'actionnable de mon côté :

- Toutes les fonctions JS définies dans `main.js` (17 au total) sont bien appelées au moins une fois — aucune fonction morte.
- Toutes les références `src="assets/..."` dans les 10 pages HTML pointent vers des fichiers réellement présents sur disque, **à l'exception** des 8 placeholders de galerie déjà connus et documentés (en attente des vraies photos du client) — aucune référence cassée nouvelle trouvée.
- `manifest.json` vérifié : les 2 icônes référencées (`icon-192.png`, `icon-512.png`) existent bien, couleurs cohérentes avec la charte du site.
- Console vérifiée une dernière fois sur les 10 pages (`index`, `menu`, `avis`, `composer`, `vegetarien`, `supplements`, `faq`, `mentions-legales`, `reseaux`, `404`) : aucune erreur.

Au-delà de ce qui est listé dans la section suivante (bloqué côté client), il n'y a plus rien d'identifié qui soit à la fois réel et actionnable sans information ou accès supplémentaire du client.

## 8. Lien Google Maps précisé (CID vérifié, sans accès au compte du client)

L'un des points listés comme "bloqué côté client" était le Place ID Google (pour un lien direct vers la fiche, au lieu d'une recherche par adresse). En cherchant publiquement (aucun identifiant, aucun compte requis), j'ai trouvé et **vérifié deux fois** l'identifiant CID exact de la fiche Google Maps de "Pizza Subito Hénin Beaumont" (4,0 ★, 596 avis à ce jour) : `9858007054937316298`.

Les 10 liens du site qui pointaient vers `google.com/maps/search/?...query=Subito+Pizza+333+rue...` (recherche par adresse, potentiellement ambiguë) ont été remplacés par `https://www.google.com/maps?cid=9858007054937316298` — un lien direct et sans ambiguïté vers cette fiche précise. Fichiers modifiés : `index.html` (2), `avis.html` (7), `assets/js/main.js` (1, utilisé pour l'ouverture automatique après une note de 4-5 étoiles). La carte intégrée et le bouton "itinéraire" de l'accueil n'ont pas été touchés (ils utilisent à juste titre une adresse, pas un CID, pour le calcul d'itinéraire).

Revérifié : les deux liens ré-ouvrent bien la fiche "Pizza Subito Hénin Beaumont" (confirmé par le titre de page et le nombre d'avis affiché), console propre sur `avis.html` et `index.html`.

**Ce que ça n'est pas** : un lien "écrire un avis" en un clic (ça demanderait le vrai Place ID au format `ChIJ...`, uniquement disponible depuis le compte Google Business Profile du client). C'est en revanche strictly plus fiable que l'ancienne recherche par adresse pour "voir notre fiche Google" — un utilisateur atterrit maintenant toujours exactement sur la bonne fiche, sans dépendre de l'algorithme de recherche Google.

## 9. Livraison offerte + SEO meta description (index.html, faq.html)

Le client a confirmé : pas de frais de livraison, seul le montant minimum de commande déjà affiché s'applique. Ajouté clairement sur `index.html` (intro de la section "Notre zone de livraison") et `faq.html` (réponse visible + JSON-LD FAQPage, les deux mis à jour pour rester cohérents).

Meta description (`index.html`, `<meta name="description">` + `og:description`) réécrite avec des faits réels et vérifiés : pizzeria depuis 1999, spécialité (pizza Subito), offre 1 pizza achetée = 1 offerte, livraison offerte. Ajout de `foundingDate: "1999-04-01"` dans les données structurées JSON-LD (`Restaurant`). Revérifié : JSON-LD valide sur les deux pages, console propre.

**Demandes non exécutées, avec explication :**
- *"Mettre notre logo" comme la petite icône dans le résultat Google* : la capture montre le site **actuellement en ligne** (l'ancien WordPress, puisque `sub99` n'est pas encore déployé) — aucune modification de code ici ne peut changer cette icône tant que le nouveau site n'est pas mis en ligne. Le favicon du nouveau site est déjà en place (`assets/img/icons/favicon.svg`), mais c'est volontairement une version simplifiée (un "S" stylisé) plutôt que le logo complet : le logo réel (`logo.jpg`, 520×215 px) est un bandeau rectangulaire avec texte, illisible une fois réduit à 16-32 px. C'est la pratique standard (créer une version simplifiée pour l'icône). Si vous voulez un favicon différent, dites-le précisément et je l'ajuste — mais le logo texte complet ne fonctionnera pas tel quel à cette taille.
- *"Top 3 pizzas dans le Nord-Pas-de-Calais" comme description Google* : ce texte ("Subito Pizza vous propose des pizzas, pâtes...") vu dans la capture est la **description de votre fiche Google Business Profile**, pas une donnée du site web — elle se modifie uniquement depuis votre compte Google (business.google.com), auquel je n'ai pas accès. Et même s'il s'agissait d'un texte du site, je n'invente pas de classement non vérifié ("top 3 du Nord-Pas-de-Calais") : c'est le genre d'affirmation qui peut se retourner contre vous (avis Google, pratiques commerciales trompeuses) si elle n'est pas vraie et vérifiable.
- *"Ajouter du gras"* : Google ne permet pas de mettre du texte en gras dans une description de site ou de fiche — c'est Google qui met automatiquement en gras les mots qui correspondent à la recherche de l'utilisateur, pas quelque chose qu'on contrôle depuis le code.

## 10. Favicon : vrai logo + trou technique `favicon.ico` corrigé

Le client a insisté (avec une capture montrant l'icône générique "globe" dans un résultat Google) pour que l'icône du site utilise le vrai logo plutôt que le monogramme "S" simplifié construit précédemment. Fait : les 4 tailles PNG (32/180/192/512px) sont maintenant générées directement depuis `assets/img/logo.jpg` (fond vert de la marque + logo entier centré), via un script PowerShell (`System.Drawing`, pas de dépendance externe). L'ancien lien `<link rel="icon" ... favicon.svg>` (qui passait avant les PNG dans le `<head>` et aurait montré l'ancienne icône) a été retiré des 10 pages.

**Vrai trou technique trouvé en creusant** : `https://subito-pizza-heninbeaumont.fr/favicon.ico` renvoyait une 404 — ce fichier n'a jamais existé. De nombreux outils (navigateurs en repli, certains robots d'indexation) vérifient ce chemin par convention, indépendamment des balises `<link rel="icon">` du HTML. Corrigé : génération d'un vrai fichier `.ico` multi-résolutions (16/32/48px, format ICO avec données PNG embarquées, construit manuellement en PowerShell — `System.Drawing` seul ne sait pas exporter en `.ico` multi-tailles) à la racine du site, plus une balise `<link rel="shortcut icon" href="/favicon.ico">` ajoutée sur les 10 pages pour plus de robustesse. Vérifié valide (`System.Drawing.Icon` le charge sans erreur) et correctement affiché en local.

**Important, expliqué au client** : l'icône vue dans un résultat de recherche Google (le globe) et le texte de description vus dans une fiche "Google Business Profile" sont deux choses différentes du site web :
- Le texte de description de la fiche Google (celui visible dans le panneau avec les onglets Menu/Avis/Photos) est stocké uniquement dans le compte Google Business Profile du client — aucune modification du code du site ne peut jamais le changer, seul un accès à business.google.com le permet.
- L'icône (favicon) est bien contrôlée par le code, déjà corrigée, mais Google met en cache sa propre copie et ne la rafraîchit pas instantanément (parfois plusieurs jours) — ça ne dépend d'aucune autre action côté site.

## 11. Découverte : le site est déjà déployé automatiquement

En cherchant pourquoi le site en ligne reflétait déjà des modifications faites quelques minutes plus tôt dans cette session, découverte que `sub99` contient son propre dépôt git (`git status` : working tree propre, branche à jour avec `origin/main`, remote `https://github.com/Youness999fm/sub99.git`). Chaque modification de cette session a été automatiquement commitée et poussée (messages de commit génériques du type "up", "x", "oui" — mécanisme automatique, pas manuel), et l'hébergement OVH semble configuré pour se synchroniser automatiquement depuis ce dépôt : le domaine ne montre plus aucune trace de l'ancien WordPress, et un changement de favicon vérifié en local est apparu en ligne en quelques minutes sans action FTP manuelle de qui que ce soit. Il n'y a donc pas de "mise en ligne" à déclencher manuellement — c'est déjà automatique et continu.

## 12. Sous-catégories par base dans Menu > Pizzas

Demande ciblée : scinder la section Pizzas en 3 groupes (Base tomate / Base crème / Base spéciale), avec une mini-navigation à ancres en haut de la liste, sans rien changer d'autre au site.

En analysant la structure existante avant de toucher au code : les 30 pizzas étaient déjà, par pur hasard, dans l'ordre exact de leurs bases (18 pizzas tomate d'affilée, puis 10 crème, puis Indienne et Carolina) — aucune pizza n'a donc eu besoin d'être déplacée, seulement enveloppée dans 3 nouveaux groupes (`#base-tomate`, `#base-creme`, `#base-speciale`) avec un titre chacun. Rien d'autre modifié : mêmes noms, descriptions, ingrédients, prix, tailles, images, badge "signature", offre 1 achetée = 1 offerte, boutons — tout identique.

Nouvelle nav `.pizza-base-nav` (3 liens-ancres) juste après le bloc "Personnalisez votre pizza" et avant la liste, même langage visuel que les autres pills du site (dont l'état actif vert foncé + liseré or). Surlignage de l'état actif géré par une nouvelle fonction JS dédiée (`initPizzaBaseNav()`), sur le même principe que celle déjà en place pour les catégories, sans toucher à cette dernière. `scroll-margin-top` appliqué aux groupes pour que le titre ne soit jamais caché sous la barre de catégories collante.

Vérifié : 18/10/2 pizzas dans les bons groupes (comptage direct dans le DOM), clic sur chaque lien amène au bon groupe avec défilement doux, titre jamais caché sous la barre collante (mesuré précisément : pas de chevauchement), alignement parfait sur une seule ligne en desktop (les 3 liens à la même position verticale), défilement horizontal disponible sur mobile si besoin, aucune erreur console.

## 13. Passe de finition "premium" sur Menu > Pizzas

Demande explicite : la base (sous-nav par bases + barre de catégories) est validée, carte blanche pour l'élever au niveau "agence pro", sans casser ni changer le contenu métier. Ajouts, tous vérifiés avec garde `prefers-reduced-motion` :

- **Pastille glissante** sur `.pizza-base-nav` : au lieu d'un simple changement de couleur instantané entre onglets, un indicateur séparé glisse et se redimensionne exactement jusqu'au lien actif (largeur/position mesurées en JS, pas devinées en CSS — reste juste même si le texte d'un onglet changeait). Revérifié : position exacte (`translateX` mesuré = position réelle du lien actif, à 0px près), fonctionne identiquement en desktop et mobile.
- **Icônes** ajoutées aux 3 onglets (tomate / goutte crème / étoile), cohérentes avec le style ligne déjà utilisé partout ailleurs sur le site.
- **Retour tactile** au clic (`:active { scale(0.95) }`) sur les onglets de base.
- **Auto-défilement horizontal** de la barre fine de catégories (`.menu-quicknav`) : l'onglet actif se centre automatiquement dans la zone visible au changement de catégorie — corrige un vrai trou d'UX (sur mobile, "Boissons" tout à droite pouvait rester invisible même une fois actif). Revérifié par capture : après un clic sur "Boissons", la barre défile pour l'amener à l'écran.
- **Reflet discret** qui balaie le badge "★ Notre signature" toutes les 4,5s (une seule pizza concernée, pas un effet généralisé).
- **Profondeur de survol renforcée** sur les cartes pizza (léger `scale` en plus du soulèvement déjà existant, ombre plus marquée, easing aligné sur celui déjà utilisé pour les apparitions au scroll).
- **Trait d'accent rouge** sous chaque titre "Base tomate/crème/spéciale", reprenant exactement le motif déjà utilisé sous les grands titres de section du site (cohérence visuelle, pas un nouveau style inventé).

Rien de tout ça ne touche au contenu (noms, prix, ingrédients, tailles, offre) ni à la grille de catégories `.menu-jump` (laissée intacte comme demandé explicitement). Console propre sur `menu.html`, `index.html`, `avis.html`, `composer.html` après ces changements (JS partagé `main.js` modifié).

## 14. Stratégie SEO — audit et exécution directe

Mission confiée : responsabilité complète de la stratégie SEO, avec exécution directe (pas seulement des recommandations), carte blanche sur tout ce qui est sûr, sans jamais inventer d'information ni faire de spam SEO.

### Corrections techniques réelles exécutées

- **Bug de canonicalisation www/non-www (le plus important trouvé)** : le serveur en ligne redirige `subito-pizza-heninbeaumont.fr` → `www.subito-pizza-heninbeaumont.fr` (vérifié en navigant réellement sur les deux), mais tous les `canonical`, `og:url`, JSON-LD `url`, `sitemap.xml` et `robots.txt` déclaraient la version **sans** www comme canonique — l'inverse de ce que le serveur sert réellement. C'est exactement le genre de signal contradictoire que Google déconseille. Corrigé sur les 10 pages + sitemap.xml + robots.txt (57 occurrences), revérifié : JSON-LD valide partout, console propre.
- **Données structurées enrichies** (`Restaurant`, sur les 6 pages qui en ont une) : ajout de `geo` (coordonnées GPS réelles, récupérées directement depuis la fiche Google Maps déjà vérifiée de l'établissement — 50.4212916, 2.9535869) et `sameAs` (liens Snapchat + TikTok réels déjà présents sur `reseaux.html`). Sur la page d'accueil spécifiquement (entité principale) : ajout de `areaServed` (les 8 vraies communes de livraison déjà documentées sur le site), `hasMenu` (lien vers le menu) et `paymentAccepted` (CB/espèces, déjà affiché sur le site). Rien d'inventé — uniquement des faits déjà présents ailleurs sur le site, maintenant aussi lisibles par les moteurs de recherche dans un format structuré.
- **Titres de page** passés en revue : déjà propres (entité + lieu, sans répétition artificielle), aucune modification nécessaire.
- **Sémantique HTML, alt, sitemap/robots.txt, indexabilité** : déjà vérifiés à plusieurs reprises pendant cette session (voir sections précédentes de ce rapport) — pas de nouveau problème trouvé.

### Décision : pas de nouvelles pages ville créées

Conformément à la règle donnée ("pas de page pour chaque ville, seulement si contenu réellement utile et honnête") :

| Ville | Page dédiée ? | Pourquoi |
|---|---|---|
| Hénin-Beaumont | Déjà couvert (page d'accueil = l'entité elle-même) | C'est le siège réel de l'établissement |
| Montigny-en-Gohelle, Dourges, Noyelles-Godault, Courrières, Billy-Montigny, Fouquières-lès-Lens, Rouvroy | **NON**, mais déjà représentées | Zone de livraison réelle et vérifiable — désormais dans `areaServed` (structuré) + déjà visibles en clair sur `index.html`/`faq.html`. Une page séparée par ville dupliquerait ce contenu sans rien ajouter d'utile → risque de contenu fin/dupliqué plutôt qu'un vrai bénéfice. |
| Lens, Carvin, Harnes | **NON** | Hors zone de livraison connue et documentée. Créer une page prétendant un service qu'on ne peut pas confirmer serait trompeur. |
| Liévin, Seclin | **NON** | Idem, aucune proposition de valeur réelle et vérifiable pour ces communes. |
| Douai | **NON — pas de page dédiée** | Douai est dans le Nord (59), pas le Pas-de-Calais, et hors zone de livraison connue. Aucune réalité commerciale ne justifie une page "pizzeria Douai" : ce serait exactement le type de page trompeuse à éviter. |

Si la zone de livraison s'étend un jour réellement vers Lens/Douai/etc., ce sera le moment de reconsidérer — pas avant.

### Checklist Google Business Profile (à faire par vous, je n'y ai pas accès)

- Vérifier que **nom, adresse, téléphone** correspondent exactement au site (333 rue Elie Gruyelle, 62110 Hénin-Beaumont, 03 21 20 00 33) — aucune variante.
- Catégorie principale : Pizzeria. Catégories secondaires pertinentes si disponibles : Restaurant, Restauration rapide, Livraison de repas.
- Site web renseigné : `https://www.subito-pizza-heninbeaumont.fr` (la version www, celle que le serveur sert réellement).
- Horaires exacts : 18h-23h tous les jours (déjà cohérent avec le site).
- Description : voir le texte déjà préparé plus haut dans cette conversation (fait, spécialité, offre, livraison offerte — rien d'inventé).
- Photos : dès que les vraies photos du restaurant/équipe seront prises (le point déjà identifié comme en attente), les ajouter aussi sur la fiche Google, pas seulement sur le site.
- Avis : ne jamais générer de faux avis. Stratégie honnête : après une commande réussie, un message ou un ticket peut simplement rappeler "un avis nous aide beaucoup" avec le lien — jamais sélectif selon la satisfaction perçue (déjà la règle appliquée sur le site lui-même, voir section 1 de ce rapport). Répondre aux avis avec un ton humain, pas un modèle copié-collé identique à chaque fois.

### Priorisation (le reste, non exécuté ici — recommandations)

**Impact très élevé / effort faible — déjà fait cette session** : correction www, données structurées enrichies.

**Impact élevé / effort faible, à faire par vous** : mettre à jour la fiche Google Business Profile (checklist ci-dessus), créer la redirection email OVH déjà identifiée, fournir les vraies photos.

**Impact élevé / effort moyen** : une fois les vraies photos disponibles, enrichir les `alt` avec un peu plus de contexte descriptif naturel (pas de bourrage de mots-clés) et envisager des formats modernes (WebP) — déjà noté comme non prioritaire techniquement dans ce rapport (section performance), mais deviendrait plus pertinent avec de nouvelles photos.

**Impact élevé / effort élevé, hors de portée de ce site statique** : obtenir de vrais avis Google, obtenir des mentions locales (presse locale, annuaires sérieux type PagesJaunes, partenariats avec commerçants voisins) — nécessite une démarche humaine, pas du code.

## Reste en attente côté client (déjà documenté avant cette session, toujours valable)

- Redirection OVH `contact@subito-pizza-heninbeaumont.fr` → `subito.pizza.hb@gmail.com` (à confirmer faite).
- Photos galerie accueil (8 emplacements).
- Liens réels Facebook / Instagram.
