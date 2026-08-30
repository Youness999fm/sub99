# Mission — Statut des commandes repris sur "Notre menu"

## Demande initiale
Afficher sur `menu.html`, juste sous le titre "Notre menu" et avant les catégories, le même bloc de statut des commandes (ouvert/fermé + compte à rebours dynamique) déjà présent sur l'accueil — sans recréer de nouveau système, sans changer la logique.

## Composant identifié
`#order-status` dans `index.html` (dans le hero), piloté par `initOrderStatus()` dans `assets/js/main.js` (créneau réel 18h00–22h47, déjà appelée au chargement sur **toutes** les pages du site, y compris `menu.html`, avec un garde `if (!root) return;` qui ne fait rien si l'élément est absent).

## Action
Markup copié à l'identique (mêmes id, même structure) juste après le `<h1>` "Notre menu" et avant la nav de catégories (`.menu-jump`) — donc avant Pizzas/Pâtes/Panini, etc. Aucune ligne de JS ajoutée : le script partagé déjà chargé sur cette page pilote automatiquement ce nouvel élément, exactement comme sur l'accueil.

## Bug trouvé et corrigé pendant le test
Le composant a été conçu pour le fond sombre du hero (`background: rgba(255,255,255,0.07)`, texte blanc) — copié tel quel dans le contexte clair de `menu.html`, il devenait quasiment invisible (texte blanc sur fond presque blanc). Ajout d'une variante `.order-status--on-light` (fond vert plein, mêmes couleurs de statut, mêmes données) appliquée uniquement au bloc de `menu.html` — **la version de l'accueil n'a pas été touchée**.

## Vérification e2e réelle
- `menu.html` : bloc visible juste sous le titre, avant les catégories ; capture d'écran confirmant "COMMANDES FERMÉES — Ouvrent dans 2 h 11 min".
- `index.html` : capture confirmant le rendu strictement identique à avant ("COMMANDES FERMÉES — Ouvrent dans 2 h 09 min" au moment du test) — le léger écart de minutes entre les deux pages est dû aux quelques secondes réelles écoulées entre les deux vérifications, ce qui confirme que les deux pages lisent bien la même horloge en direct.
- Zéro erreur console sur les deux pages.

## Verdict
Conforme à la demande : un seul composant, une seule logique, réutilisé à l'identique et synchronisé entre les deux pages. **PASS.**

## À republier
Fichiers modifiés : `menu.html`, `assets/css/style.css` (nouvelle variante de contraste seulement). À renvoyer par FTP comme les précédentes modifications.
