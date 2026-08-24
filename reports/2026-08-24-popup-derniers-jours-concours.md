# Mission — Pop-up "derniers jours" du jeu concours

## Demande initiale
Mettre en place une pop-up de campagne (« PLUS QUE X JOURS POUR PARTICIPER ! ») s'affichant peu après l'arrivée du visiteur, avec compte à rebours dynamique, CTA vers la participation, fermeture irréprochable (croix, ESC, clic arrière-plan), fréquence raisonnable, mobile-first, accessible, sans nouvelle dépendance — sans rien casser de l'existant.

## Analyse préalable
Site 100 % statique HTML/CSS/JS, sans build, sans framework — chaque page duplique ses blocs partagés (header/nav/footer) à la main, convention suivie ici aussi. Le concours possédait déjà une date de fin unique (`daysUntilContestDraw()` dans `assets/js/main.js`, tirage le 30 août 2026) réutilisée par 4 points de contact existants (bandeau, teaser accueil, pastille menu, ligne de pied de page). **Aucune nouvelle date créée** : la pop-up consomme cette même fonction.

**Bug pré-existant trouvé et corrigé au passage** : `initIntroSplash()` ne déclenchait aucun événement quand le voile de bienvenue de l'accueil était sauté instantanément (visite déjà vue dans la session, ou `prefers-reduced-motion`) — seul le chemin animé dispatchait un signal. Sans correctif, la pop-up ne se serait jamais affichée sur l'accueil dans ces deux cas. Un `window.dispatchEvent(new CustomEvent('subito:introDismissed'))` a été ajouté aux deux chemins.

## Actions

1. **`assets/js/main.js`** :
   - `initIntroSplash()` : dispatch de l'événement `subito:introDismissed` dans les deux chemins de sortie (correctif ci-dessus).
   - Nouvelle fonction `initContestModal()` (juste après `initContestCountdown()`) : calcule les jours restants via `daysUntilContestDraw()`, adapte le texte (`Plus que N jours` / `Plus qu'1 jour` / `Dernière chance : c'est aujourd'hui !` pour le jour 0 — jamais de « 0 jour restant »), gère l'ouverture différée (après le voile d'intro sur l'accueil, ou 600 ms sur les autres pages), le piège de focus clavier (Tab/Shift+Tab), la fermeture (croix, ESC, clic sur l'arrière-plan), le verrouillage/déverrouillage du scroll, et la restauration du focus.
   - Fréquence : clé `sessionStorage.subitoContestModalSeen` stockant le nombre de jours affiché. Une seule apparition par session pour une même urgence ; se réaffiche automatiquement si l'urgence a changé (nouvelle session, ou jour différent).
   - Appelée depuis le `DOMContentLoaded` existant, juste après `initContestPresence()`.

2. **`assets/css/style.css`** : nouveau bloc `.contest-modal*` (inséré dans la zone des styles « concours »), réutilisant intégralement le langage visuel déjà établi par `.contest-card` (dégradé vert `--green`/`--green-dark`, cadre `--gold`, gros chiffre en dégradé blanc, `--font-display`) et les boutons existants (`.btn-solid`). Overlay vert très sombre (pas noir pur). Animation d'entrée fondu + léger zoom (320 ms), pulsation discrète du bouton CTA — tout est neutralisé automatiquement par la règle globale `prefers-reduced-motion` déjà présente dans le fichier. `z-index: 3600`, au-dessus du voile d'intro (3000). Croix 44×44 px, contraste fort, `outline` doré au focus clavier (cohérent avec le reste du site).

3. **Markup** ajouté entre `</main>` et `<footer>` sur **8 pages** : `index.html`, `menu.html`, `composer.html`, `vegetarien.html`, `avis.html`, `reseaux.html`, `faq.html`, `supplements.html`. **Volontairement exclu** de `concours.html` (le visiteur y est déjà — redondant), `mentions-legales.html` et `404.html` (pages utilitaires, mauvais moment pour une pop-up commerciale).

## Vérification e2e réelle (navigateur, serveur `sub99`)

- **Premier affichage** : ouverture ~2,2 s après chargement sur l'accueil (attente du voile d'intro + 400 ms), ~700 ms sur les autres pages. Texte correct (« Plus que 6 jours pour participer ! », compté en direct depuis la vraie date).
- **Fermeture** : croix ✅, touche `Escape` ✅, clic sur l'arrière-plan (hors panneau) ✅ — testé en ciblant précisément l'élément backdrop pour éviter le faux négatif du clic géométrique au centre (qui retombe sur le panneau, comportement correct).
- **Navigation après fermeture** : clic sur un lien du menu principal → navigation normale, aucune régression, pop-up non réaffichée sur la page suivante (même session, même urgence).
- **Piège de focus clavier** : `Tab` depuis le dernier élément (CTA) boucle vers la croix ; `Shift+Tab` depuis la croix boucle vers le CTA. Focus initial posé sur la croix à l'ouverture, restauré à l'élément précédent à la fermeture.
- **Mobile (375×812)** : aucun débordement horizontal, CTA pleine largeur, croix bien atteignable au pouce.
- **Textes selon l'urgence** : testé en simulant `days = 1` (« Plus qu'1 jour pour participer ! »), `days = 0` (« Dernière chance : c'est aujourd'hui ! », gros chiffre masqué proprement) et `days = -1` (pop-up ne s'ouvre jamais) — les trois via le vrai code de `initContestModal()`, pas une simulation externe.
- **Fréquence** : re-testé explicitement — même urgence (« 6 » déjà vu) → pas de réouverture ; urgence différente (valeur périmée en storage vs vraie valeur du jour) → réouverture automatique, storage mis à jour.
- **Pages exclues** : `concours.html`, `mentions-legales.html`, `404.html` confirmées sans l'élément modal.
- **Console/réseau** : aucune erreur JS, aucune requête échouée imputable à la pop-up.

## Verdict
Mission conforme au périmètre demandé, aucune dérive. Un bug pré-existant (événement manquant sur l'intro-splash) a été identifié et corrigé car il aurait bloqué la fonctionnalité elle-même — signalé ci-dessus plutôt que corrigé en silence. **PASS.**
