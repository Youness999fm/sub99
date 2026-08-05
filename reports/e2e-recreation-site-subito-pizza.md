# Rapport — Recréation du site Subito Pizza (statique)

Mission d'origine : recréer entièrement le site subito-pizza-heninbeaumont.fr en HTML/CSS/JS statique (même nom de domaine), en remplaçant l'ancien WordPress. 4 pages : Accueil, Menu, Avis clients, Nos réseaux. Photos, logo, textes et avis réels fournis ultérieurement par le client.

## Équipe mobilisée

- 4× `frontend-dev` en parallèle (une page chacun, sur un socle CSS/JS partagé construit en amont)
- `adversary` : 1 objection bloquante, 6 mineures
- `validator` : PASS après correction du bloquant
- Test e2e réel (ce rapport)

## Objection bloquante trouvée et corrigée

Cartes avis de l'accueil (`index.html`) construites avec des `<span>` inline au lieu de blocs (`avis.html` avait la bonne structure) → rendu cassé (tout le texte sur une seule ligne). **Corrigé** : alignées sur la structure `<article>/<p>` d'`avis.html`, plus 2 durcissements mineurs (cohérence `initial-scale`, `aria-label` sur le logo pour l'accessibilité).

## Test e2e réel — itération 1

Serveur statique local démarré (PowerShell/HttpListener, `.claude/serve.ps1`, port 8090) pour un rendu HTTP fidèle (le rendu via `file://` direct était trompeur dans l'outil de preview). Testé en résolution mobile réelle (375×812) + vérifications structurelles desktop (1280px) via mesures DOM directes.

**Technique**
- Aucune erreur console nouvelle sur les 4 pages.
- Aucune requête réseau en échec inattendue. Les seuls 404 observés sont les images placeholder de galerie/menu (`assets/img/placeholders/*.jpg`, `assets/img/menu/*.jpg`) — attendu, documenté par TODO, en attente des vraies photos du client.
- QR code (`api.qrserver.com`) : chargement confirmé, image scannable générée correctement, pointe vers `reseaux.html`.
- Grille de galerie confirmée par mesure DOM : 5 colonnes de 182px à 1280px de large (desktop), 2 colonnes à 375px (mobile) — comportement responsive correct.

**UI**
- Accueil : header/slogan, nav rouge à icônes, bouton d'appel rouge uni sans pointillés bien centré, carte Maps avec adresse réelle et bouton itinéraire, galerie 2 colonnes mobile, cartes avis (corrigées) lisibles, section présentation. Rendu conforme à la maquette décrite.
- Menu : page épurée, uniquement des blocs photo empilés, aucun texte/prix en dur.
- Avis clients : 5 cartes avis avec instructions d'ajout en clair, lisibles par un non-développeur.
- Nos réseaux : 3 icônes SVG (Facebook/Instagram/TikTok) propres et reconnaissables, QR code net et centré.
- Mobile (375px) vérifié sur les 4 pages : aucun débordement, aucun chevauchement, texte non tronqué.

**UX**
- Parcours nav → page ciblée fonctionne sur les 4 pages, lien actif surligné correctement.
- Bouton d'appel cliquable (`tel:0321200033`) déclenche l'appel sur mobile.
- Lightbox galerie : ouverture/fermeture (clic + touche Échap) fonctionnelles, testées via déclenchement direct des gestionnaires d'événements.
- "Voir tous les avis" renvoie bien vers `avis.html`.
- Aucune étape confuse ou sans feedback identifiée sur le parcours testé.

## Verdict

**PASS — aucun problème bloquant.** 1 itération suffisante. Mission validée en e2e réel.

## En attente côté client (non bloquant, documenté en TODO dans le code)

- Logo réel (reçu en cours de session, à intégrer — voir suite de la conversation)
- Photos galerie (8) et menu (5)
- Texte de présentation
- Avis clients réels (contenu)
- Liens réels Facebook / Instagram / TikTok
- Confirmation du domaine final si différent de subito-pizza-heninbeaumont.fr (sinon le QR code est déjà correct)
