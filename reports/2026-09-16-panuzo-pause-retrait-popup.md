# Mission — Panuzo en pause + retrait du pop-up "il est de retour"

## Demande initiale
Faire comprendre partout sur le site que le Panuzo n'est plus disponible malgré la demande, qu'on retravaille la recette — et retirer le pop-up Panuzo.

## Contexte trouvé
Le Panuzo était présenté comme une offre hebdomadaire (tous les lundis, 9,90 €) pilotée automatiquement par `PANUZO_CONFIG`/`getPanuzoStatus()`/`applyPanuzoStatus()` dans `assets/js/main.js` (statut "aujourd'hui" le lundi, sinon "tous les lundis"), répercutée sur 3 composants (`index.html` teaser, `menu.html` fiche, `reseaux.html` carte) + une ligne de pied de page identique sur les 10 pages du site. Un pop-up "Panuzo, il est de retour !" (ajouté le 2026-09-02, jamais testé ni documenté) s'affichait une fois par navigateur sur `index.html` uniquement.

## Actions
- **Pop-up supprimé** : balisage, lien CSS et script retirés de `index.html` ; fichiers `assets/css/panuzo-popup.css` et `assets/js/panuzo-popup.js` supprimés (plus aucune référence ailleurs). Le dossier `panuzo-popup/` à la racine (non lié au site en ligne) n'a pas été touché, hors périmètre.
- **Automatisation hebdomadaire retirée** : suppression de `PANUZO_CONFIG`, `getParisWeekday()`, `getPanuzoStatus()`, `applyPanuzoStatus()`, `initPanuzoStatus()`, `initPanuzoReminder()` et du cas spécial "lundi" dans `initHeroCarousel()` (carrousel accueil) — plus aucune logique qui affiche le Panuzo comme disponible ou commandable.
- **Message mis à jour** sur les 3 points de contact + le pied de page (10 pages) : le Panuzo est présenté comme "Actuellement indisponible", remerciements pour la demande, annonce qu'on retravaille la recette, retour annoncé sur le site et les réseaux. Le bouton "Me rappeler lundi" (génération .ics) a été retiré du teaser `index.html`, devenu faux puisqu'il n'y a plus de date fixe.

## Fichiers modifiés
`index.html`, `menu.html`, `reseaux.html`, `avis.html`, `composer.html`, `concours.html`, `faq.html`, `grand-tirage.html`, `supplements.html`, `vegetarien.html`, `assets/js/main.js`. Supprimés : `assets/css/panuzo-popup.css`, `assets/js/panuzo-popup.js`.

## Vérification e2e réelle
- `node --check assets/js/main.js` : syntaxe valide.
- `index.html` : pop-up absent du DOM (`document.getElementById('panuzoPopupOverlay')` → null, `window.PanuzoPopup` → undefined) ; teaser vérifié par capture d'écran (eyebrow, marquee, badge, ribbons, 3 étapes, texte final) ; carrousel héros fonctionne sans erreur console.
- `menu.html#panuzo` : fiche Panuzo vérifiée par capture (tag, statut, note, CTA).
- `reseaux.html` : carte Panuzo vérifiée par capture.
- Zéro erreur console sur les 3 pages testées.
- Recherche globale : aucune trace restante de "tous les lundis" / "en éphémère" / "il est de retour" sur le site en ligne.

## Verdict
Conforme à la demande : le Panuzo n'est plus présenté nulle part comme disponible/commandable, le message "pause + recette retravaillée" est cohérent sur les 3 points de contact et le pied de page, et le pop-up a disparu du site (markup, styles, script et fichiers). **PASS.**

## À republier
Tous les fichiers listés ci-dessus, par FTP comme les précédentes modifications.
