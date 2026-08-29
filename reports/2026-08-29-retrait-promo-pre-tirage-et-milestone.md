# Mission — Retrait du contenu "avant tirage" et du milestone "10 000 jours"

## Demande initiale
1. « Tout ce qui parle du concours avant le tirage, enlève-le » — retirer tout le contenu promotionnel/participatif du jeu concours (countdown, bandeau, pop-up, étapes de participation), maintenant que le tirage est terminé et que `grand-tirage.html` existe.
2. « Et enlève aujourd'hui 10 000 jours d'histoire » — retirer la mise en avant du cap des 10 000 jours.

## Analyse préalable
Inventaire complet (`grep` sur tout le repo) avant toute suppression, conformément à la règle du site. Deux composants distincts identifiés à ne pas confondre :
- Blocs strictement liés au concours (countdown, bandeau, pop-up, étapes) → à supprimer intégralement.
- Blocs Panuzo, interleavés dans la même zone du CSS (`panuzo-card`, `panuzo-menu-feature`, `site-footer__panuzo-line`) → à conserver, aucun rapport avec le concours.

Pour le point 2, question posée à l'utilisateur avant d'agir (`AskUserQuestion`) car le compteur de jours "Depuis 1999" et le cap "10 000 jours" étaient profondément imbriqués dans la même fonction JS (`initDaysCounter`) : l'utilisateur a confirmé vouloir garder le compteur évolutif, retirer seulement la pastille/le badge/la célébration spécifiques au cap.

## Actions — Concours

**8 pages** (`avis.html`, `composer.html`, `faq.html`, `index.html`, `menu.html`, `reseaux.html`, `supplements.html`, `vegetarien.html`) : suppression du bandeau `.event-ribbon`, de la pop-up `.contest-modal`, et de la ligne `.site-footer__contest-line` — blocs strictement identiques sur les 8 pages, retirés via un script PowerShell temporaire (regex ASCII-safe, pas de littéral emoji dans le script pour éviter les pièges d'encodage PowerShell 5.1) puis supprimé.

- `index.html` : suppression de la section `.contest-teaser` (30 pizzas XXL à gagner).
- `menu.html` : suppression de `.menu-contest-pill`.
- `reseaux.html` : suppression complète de `.contest-card` (étapes 1-2-3, countdown, CTA Snapchat/TikTok) + mise à jour des meta description/og:description.
- `concours.html` : réécrit en page-pont minimale ("Le concours est terminé 🎉" + lien vers `grand-tirage.html`), toutes les étapes de participation/countdown/comparatif de tailles retirés.
- `assets/js/main.js` : suppression de `daysUntilContestDraw()`, `initContestCountdown()`, `initContestPresence()`, `initContestModal()`, `initContestResultsBanner()` et de leurs appels ; nettoyage de l'événement `subito:introDismissed` (devenu orphelin, plus aucun écouteur).
- `assets/css/style.css` : suppression de ~650 lignes de CSS concours (`.contest-card*`, `.contest-steps*`, `.event-ribbon*`, `.contest-teaser*`, `.menu-contest-pill*`, `.site-footer__contest-line*`, `.contest-modal*`, `.concours-facts*`, `.size-scale*`), en 5 blocs distincts pour ne pas toucher aux règles Panuzo interleavées.

## Actions — Milestone "10 000 jours"

- `index.html` : suppression de `.hero__milestone-pill` (pastille "Aujourd'hui, 10 000 jours d'histoire") et des éléments `finale-milestone-badge` / `finale-milestone-date` dans la scène finale. Le compteur de jours (`finale-days-number`), son libellé, les équivalences (années/semaines/samedis) et le logo restent inchangés.
- `assets/js/main.js` : suppression de `initHeroMilestone()`, des constantes `MILESTONE_DAY`/`MILESTONE_WINDOW_END`, et de toute la logique de célébration dans `initDaysCounter()` (badge, plaque datée, bascule "1999 → 10 000" du filigrane, teaser "prochaine étape 20 000", distinction spin dramatique/normal). Le clic sur le chiffre rejoue désormais simplement l'animation, sans mise en scène de cap. `initFinaleEmbers()` (particules ambiantes de fond) corrigé pour ne plus référencer la fenêtre de milestone supprimée (couleur unique désormais, au lieu de "chaude pendant le cap / normale sinon").
- `assets/css/style.css` : suppression de `.hero__milestone-pill*`, `.finale__milestone-badge*`, `.finale__milestone-date*`, `.finale__year.is-climax`, `.finale__ember*` (braises "burst" du clic, devenues orphelines une fois la célébration retirée — `.finale__embers-canvas`, l'animation de fond, est conservée).

## Vérification e2e réelle (navigateur, serveur `sub99`)
Rechargement individuel de chaque page modifiée (`index`, `menu`, `reseaux`, `concours`, `avis`, `faq`, `supplements`, `vegetarien`, `composer`, `grand-tirage`, `mentions-legales`) :
- **Console** : zéro erreur/avertissement sur toutes les pages testées.
- **Éléments retirés** : confirmés absents du DOM (`event-ribbon`, `contest-modal`, `menu-contest-pill`, `contest-card`, `hero-milestone-pill`, `finale-milestone-badge` — vérifié via `getElementById`).
- **Éléments conservés** : `panuzo-card` (reseaux.html) et `finale-days-number` (index.html) confirmés présents et fonctionnels.
- **Compteur de jours** : clic testé sur `finale-days-number` — l'animation rejoue sans erreur.
- **Page `concours.html`** : rendu vérifié par capture d'écran ("Le concours est terminé 🎉" + bouton "Découvrir les 30 gagnants"), clic sur le bouton confirmé naviguant vers `grand-tirage.html`.

## Verdict
Conforme aux deux demandes. Aucune régression détectée. **PASS.**
