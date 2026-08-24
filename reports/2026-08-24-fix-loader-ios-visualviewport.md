# Mission — Correctif définitif : loader incomplet sur iPhone/Safari

## Contexte
Suite du correctif précédent ([2026-08-24-fix-loader-couverture-viewport.md](2026-08-24-fix-loader-couverture-viewport.md)), qui avait supprimé le conflit CSS `inset:0` + `height:100vh/100dvh` sur `.intro-splash`. Ce correctif est correct et suffisant sur desktop et la plupart des mobiles, mais le client a signalé un cas persistant **spécifiquement sur iPhone/Safari** : le bas de l'écran laissait voir le contenu réel (le texte du Panuzo) pendant l'affichage du loader.

## Cause supplémentaire (spécifique iOS Safari)
Safari iOS a un historique documenté de désynchronisation entre le **viewport de mise en page** (utilisé par `position: fixed`) et la **zone réellement visible à l'écran**, en particulier juste après le premier rendu quand sa barre d'outils se rétracte automatiquement (le viewport visible s'agrandit alors, sans que `position:fixed` + `inset:0` ne se resynchronise de façon fiable dans toutes les versions/situations). C'est un comportement propre au moteur Safari : `inset:0` seul, bien que la bonne pratique CSS standard, ne suffit pas toujours à couvrir ce cas précis.

## Correctif
**`assets/js/main.js`** : nouvelle fonction `syncSplashToVisualViewport()`, appelée en plus du CSS existant (qui reste la base, inchangée). Elle utilise la **Visual Viewport API** (native, aucune dépendance ajoutée, supportée par Safari iOS depuis 2020) : `window.visualViewport` donne la largeur/hauteur/position **réellement affichées à l'instant présent**, et se met à jour automatiquement à chaque changement (rotation, redimensionnement, barre d'outils qui apparaît/disparaît, clavier virtuel). La fonction fixe explicitement `width`/`height`/`top`/`left` du voile sur ces valeurs, et se réabonne à chaque événement `resize`/`scroll` du Visual Viewport tant que le voile est affiché. Le nettoyage (`stopSyncingViewport()`) est appelé dans `dismiss()`, au même endroit que le déverrouillage du scroll — aucune fuite d'écouteur possible.

Sur les navigateurs sans Visual Viewport API (très rares aujourd'hui), la fonction se retire immédiatement sans rien faire : le CSS `inset:0` déjà en place reste seul responsable, exactement comme avant ce correctif — aucune régression possible.

## Tests effectués (navigateur réel, serveur `sub99`)

- **État actif** : voile réinjecté + `initIntroSplash()` relancé (minuteur de repli étiré pour observer sans course contre le round-trip de l'outil) → `getBoundingClientRect()` colle exactement à `window.innerWidth`/`innerHeight` (375×812), styles inline `width`/`height`/`top`/`left` corrects, `body.overflow: hidden` actif.
- **Redimensionnement pendant l'affichage** (simule un changement d'orientation) : viewport changé de 375×812 à 414×896 **sans recharger la page** — le voile s'est resynchronisé tout seul via l'événement `resize` du Visual Viewport, toujours calé au pixel près sur la nouvelle taille.
- **Fin du cycle** : déclenchement d'un vrai `dismiss` (touche Escape) → voile retiré du DOM, `body.overflow` revient à `visible`, aucune erreur console (confirmant que les écouteurs Visual Viewport sont bien nettoyés, pas de listener orphelin qui continuerait à tourner après suppression du voile).
- **Non-régression** : rechargement complet réel de la page, aucune erreur console ; la pop-up concours (fonctionnalité indépendante d'une mission précédente) continue de fonctionner normalement en aval (testé : ouverture, fermeture, restauration du scroll).

## Verdict
Le correctif CSS de la mission précédente reste la base (toujours en place, inchangée). Cette mission ajoute une seconde couche de robustesse ciblant spécifiquement le comportement de Safari iOS, sans dépendance ajoutée, sans toucher au design/animation/timing du loader. **PASS.**
