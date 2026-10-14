# Mission — Vibration haptique sur l'écran d'intro

## Demande initiale
Ajouter une vibration courte (~20-30ms) sur mobile, synchronisée avec le « ding » déjà en place (voir [reports/2026-10-14-signature-sonore-intro.md](2026-10-14-signature-sonore-intro.md)), via `navigator.vibrate()`, en acceptant explicitement que l'API ne soit pas disponible/autorisée partout (notamment iPhone), sans contourner ces restrictions.

## Actions
Dans `initIntroSplash()` (`assets/js/main.js`), le même `setTimeout` à 250ms qui déclenche déjà le son appelle désormais aussi `navigator.vibrate(25)`, protégé par une détection de fonctionnalité (`'vibrate' in navigator`) et un `try/catch`. Le timer (renommé `introFxTimer`, ex-`chimeTimer`) reste annulé dans `dismiss()` si l'utilisateur interagit avant qu'il ne se déclenche — même garde-fou que pour le son, aucune répétition possible.

## Fichiers modifiés
`assets/js/main.js` uniquement. Aucun changement visuel, CSS, ou sur une autre page.

## Vérification e2e réelle
- `node --check assets/js/main.js` : syntaxe valide.
- Testé en viewport mobile (375×812, user-agent tactile émulé) sur le serveur local : écran d'intro identique visuellement (capture), aucune régression de timing.
- `'vibrate' in navigator` → `true` dans cet environnement de test ; appel direct de `navigator.vibrate(25)` ne lève aucune exception (retourne `false` quand bloqué).
- **Constat important, non contourné volontairement** : Chrome journalise un message `console.error` interne (« Blocked call to navigator.vibrate because user hasn't tapped on the frame... ») à chaque fois que `vibrate()` est appelé sans interaction préalable de l'utilisateur — ce qui est précisément le cas ici puisque l'intro se joue automatiquement au chargement. Ce message est une diagnostique du navigateur lui-même (pas une exception JS, rien n'est catché à tort), n'affecte ni l'animation ni la suite du site, et est inévitable dès lors qu'on respecte la consigne de ne pas contourner la politique du navigateur. En pratique, la vibration ne se déclenchera donc quasiment jamais au premier chargement (ni sur desktop, ni sur la plupart des mobiles sans engagement préalable avec le site) ; iOS Safari, lui, n'expose pas du tout `navigator.vibrate` (branche silencieusement ignorée, aucun appel tenté).
- Aucune nouvelle erreur réseau ni régression constatée sur les ressources de la page (confirmé par la liste des requêtes réseau, toutes en 200).

## Verdict
Conforme à la demande, dans les limites que la demande elle-même anticipait : la vibration est codée correctement (détection de fonctionnalité, non bloquante, non répétée, synchronisée au même instant que le son), mais son déclenchement réel dépendra des politiques d'engagement de chaque navigateur/appareil — elle ne fonctionnera quasiment jamais sur un tout premier chargement, nulle part sur iPhone. **PASS avec limitation inhérente à l'API, documentée et non contournée.**

## À republier
`assets/js/main.js` (déjà listé dans le rapport du son — un seul fichier à republier pour les deux fonctionnalités), par FTP.
