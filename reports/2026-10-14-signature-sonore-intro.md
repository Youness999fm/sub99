# Mission — Signature sonore de l'écran d'intro

## Demande initiale
Ajouter un effet sonore court, cristallin et discret (type « ting » de marque haut de gamme, 300-900ms) synchronisé avec l'apparition du logo dans l'écran d'intro, sans toucher au visuel, au timing ni à la logique existants.

## Contexte trouvé
L'intro (`#intro-splash` dans `index.html`) est un voile plein écran purement animé en CSS : le logo se révèle via `introLogoWipe` (délai 0.25s, durée 0.6s), l'anneau se dessine en parallèle, un reflet balaie le logo à 0.65s. `initIntroSplash()` dans `assets/js/main.js` gère uniquement l'affichage/masquage (`sessionStorage`, `prefers-reduced-motion`, dismiss au premier geste ou après 1200ms). Aucun son n'existait sur le site ; aucune ressource audio n'était présente dans `assets/`.

## Solution retenue
Aucun effet sonore adapté n'était disponible dans le projet ni récupérable de façon fiable sans dépendre d'une ressource tierce (licence/qualité incertaines). Le son a donc été **synthétisé sur mesure** (synthèse additive de type cloche/cristal : fondamentale 1318 Hz + partiels inharmoniques à décroissance rapide, micro-transitoire de frappe filtré, montée douce 4ms, fondu de sortie propre 50ms, pic normalisé à -4 dB environ) via un script Node ponctuel (non conservé dans le dépôt), pour garantir un rendu exactement calibré sur le cahier des charges (durée, timbre, absence de pic agressif) sans ajouter de dépendance au projet. Export en **WAV PCM 16 bits mono, 44.1kHz, 680ms, 59 Ko** — `assets/audio/intro-chime.wav`. Le WAV a été choisi plutôt que MP3/OGG car aucun encodeur n'est disponible sur la machine (pas de ffmpeg) ; à ce poids (59 Ko) l'impact est négligeable et le format est nativement supporté par tous les navigateurs ciblés.

## Synchronisation
Dans `initIntroSplash()`, un `setTimeout` de 250ms déclenche `chime.play()` — exactement le délai CSS avant lequel le logo commence à se révéler (`introLogoWipe`). Le timer est annulé dans `dismiss()` s'il n'a pas encore eu lieu, pour ne jamais jouer un son après que l'utilisateur a déjà interagi/quitté l'intro.

## Fichiers modifiés
- `assets/js/main.js` : ajout du déclenchement du son dans `initIntroSplash()` (aucune autre fonction touchée).
- `index.html` : aucun changement de structure ; seul un `<link rel="preload">` ajouté puis retiré en cours de vérif (voir Audit technique).
- Ajouté : `assets/audio/intro-chime.wav`.

Aucun fichier CSS, aucune autre page, aucun autre composant touché.

## Comportement si la lecture automatique est bloquée
`chime.play()` retourne une promesse ; un `.catch()` silencieux absorbe le rejet (politique d'autoplay sans geste préalable, fréquente notamment sur mobile au premier chargement) — aucune erreur console, aucun impact sur l'animation visuelle, qui ne dépend jamais du son. Aucun contournement (lecture forcée, bouton ajouté, etc.) n'a été mis en place, conformément à la consigne.

## Vérification e2e réelle
- `node --check assets/js/main.js` : syntaxe valide.
- Serveur local (`sub99`), page rechargée avec stockage vidé : écran d'intro identique visuellement à avant (capture), zéro erreur/avertissement console, requête réseau `assets/audio/intro-chime.wav` → 200 OK.
- Testé un `<link rel="preload" as="audio">` initial : généré un avertissement console (`unsupported 'as' value`, limitation Chromium) sans gain réel vu la taille du fichier (59 Ko, déjà chargé par l'`Audio()` avec `preload="auto"`) — retiré pour repartir strictement propre en console.
- Clic sur l'intro : dismiss fonctionne comme avant, page d'accueil s'affiche sans régression.
- **Non vérifié** : le rendu audio à l'oreille (pas d'accès à une sortie son dans cet environnement) — seules les propriétés techniques (durée, enveloppe, pic, absence de coupure) ont pu être contrôlées par le code de synthèse lui-même.

## Verdict
Conforme au périmètre demandé : design visuel, timing et fonctionnalités de l'intro strictement inchangés ; son ajouté de façon non bloquante, synchronisée au déclenchement du dévoilement du logo, sans erreur console ni dépendance ajoutée. **PASS avec réserve** : qualité subjective du son non validée à l'oreille par un humain — à écouter en priorité avant mise en ligne.

## À republier
`index.html`, `assets/js/main.js`, `assets/audio/intro-chime.wav` (nouveau fichier), par FTP comme les précédentes modifications.
