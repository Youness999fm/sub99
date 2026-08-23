# Mission — Refonte de la section Panuzo à partir du flyer officiel

## Demande initiale
Brief très ambitieux ("carte blanche") demandant de transformer la section teaser existante (`#panuzo-teaser` sur `index.html`, livrée le 2026-08-19) en un véritable "événement digital de marque", à partir du flyer officiel du produit. Le brief insistait sur : trouver l'idée avant l'effet, ne pas reproduire le flyer tel quel, faire du client un acteur de la décision (le Panuzo reste au menu si les clients l'adorent), traiter "tous les lundis / en éphémère" comme un rendez-vous et non une info secondaire, rester sobre (complexité perçue > complexité réelle), ne rien inventer, et ne rien casser.

## Point de cadrage résolu : orthographe du produit
Le texte du brief écrit systématiquement **"Panuozzo"**. Le flyer officiel fourni (`WhatsApp Image 2026-08-23 at 11.27.37.jpeg`) écrit en réalité **"PANUZO"** en toutes lettres, à l'identique de ce qui existait déjà partout sur le site (`#panuzo-teaser`, pastille menu, carte réseaux, lignes de pied de page). Décision : conserver "Panuzo" partout, conforme au visuel officiel — aucun renommage du site.

## Analyse du flyer (DNA créatif retenu)
- **Progression** : sceau de marque → titre produit → promesse → rareté (badge "tous les lundis en éphémère") → produit → mécanique (2 bandeaux "twist") → participation (3 blocs explication/action/conséquence) → action finale.
- **Palette** : noir profond, or/doré, blanc, touches vert/rouge (liseré italien sous le titre).
- **Le badge "tous les lundis"** n'est pas une ligne d'info : c'est visuellement le deuxième élément le plus fort du flyer après le titre, positionné en accroche directe du produit.
- **Les 3 blocs du bas** ne sont pas équivalents : ils forment Pourquoi (explication) → Vous aimez ? (action) → Votre avis compte (conséquence).

## Ce qui a été fait (`index.html` + `assets/css/style.css`, uniquement `.panuzo-teaser`)
Aucune nouvelle dépendance, aucun changement de `main.js` (le système de reveal existant — une classe `.is-visible` posée une fois sur la section — gère déjà tout le séquençage via `transition-delay` en CSS).

1. **Sceau "L'Italie dans chaque bouchée"** — médaillon rond doré, légèrement de travers (comme un vrai cachet), à côté du logo. Remplace l'ancienne ligne "Arrive très bientôt" (redondante avec le nouveau sous-titre).
2. **Titre + liseré tricolore** repositionnés dans l'ordre du flyer (le liseré vert/blanc/rouge existait déjà, simplement remonté juste sous le titre).
3. **Sous-titre** changé pour la vraie phrase du flyer : "Un nouveau classique s'approche…" (à la place de la traduction du sceau, désormais portée par le sceau lui-même).
4. **Badge "Tous les lundis / En éphémère !"** — nouveau, en médaillon sombre à cerclage doré, accroché au coin du cadre produit (écho de la flèche du flyer sans ajouter d'élément séparé). Entrée animée façon "tampon qu'on abat" (léger sur-pivot puis stabilisation), plus marquée que le simple fondu du reste — c'est la deuxième révélation de la scène.
5. **Bandeau défilant du produit** : texte changé de "BIENTÔT DISPONIBLE" à "TOUS LES LUNDIS ✦ EN ÉPHÉMÈRE" pour renforcer le rendez-vous plutôt qu'une simple disponibilité floue.
6. **Double bandeau "twist"** (nouveau) : "On le propose en éphémère pour voir si vous l'adorez" / "Et si c'est le cas… il rejoindra notre menu !" — deux rubans en biais opposés (pas deux cartes identiques), c'est le cœur stratégique du brief.
7. **3 blocs de mécanique** (nouveau) : "Pourquoi en éphémère ?" → "Vous aimez ? Dites-le nous !" → "Votre avis peut tout changer !", numérotés et reliés par une flèche en desktop pour marquer la progression explication → action → conséquence. Icônes SVG maison (point d'interrogation, bulle, étoile), même style trait que le reste du site.
8. **Ligne finale + CTA** (nouveau) : "Alors, prêt à le tester et à faire partie de la décision ?" + lien "Je veux le tester →" vers `reseaux.html`. Le CTA reste volontairement non transactionnel : le site n'a pas de commande en ligne par article (uniquement appel téléphonique), donc pas de "Commander" inventé — `reseaux.html` reste la vraie destination (c'est là que l'annonce officielle et la collecte d'avis se feront).

## Non-négociables respectés
- Aucune donnée inventée (prix, date de lancement, chiffres, avis) — tous les textes viennent du flyer, légèrement adaptés à l'écrit web (`&hellip;`, ponctuation).
- CTA choisi selon les fonctionnalités réellement disponibles (pas de commande fictive).
- Aucun autre fichier touché (menu.html / reseaux.html / footers déjà cohérents avec "Panuzo", laissés tels quels — hors périmètre de cette mission).
- `prefers-reduced-motion` respecté (règle globale déjà en place + badge figé dans son état final).

## Auto-critique (tests du brief)
- **Test 3 secondes** : PANUZO → badge "tous les lundis / en éphémère" visibles dès le premier écran mobile, sans scroll — validé (capture 375px).
- **Sans animation** : toutes animations/transitions désactivées via override CSS in-page — composition intacte, hiérarchie toujours lisible (capture 390px) — validé.
- **Sans texture** : le fond texturé masqué séparément — aucune perte de lisibilité, la texture n'était qu'un enrichissement, pas un support — validé.
- Point resté simple à dessein : pas de compte à rebours (aucune date officielle disponible), pas de prise de position sur un "signature moment" plus spectaculaire (parallax/masking) — le brief demandait explicitement de préférer la retenue à l'accumulation d'effets ; le tampon du badge est le seul moment volontairement plus marqué que le reste.

## Audit e2e réel (navigateur, serveur local `sub99`)
- **Technique** : aucune erreur console avant/après, à 320px / 375px / 390px / 768px (via largeur 320 vérifiée) / 1100px / 1400px.
- **UI** : `scrollWidth === clientWidth` vérifié en direct à 320px et 1100px (aucun débordement horizontal). Positions du badge et du sceau vérifiées par `getBoundingClientRect()` : chevauchement du cadre produit intentionnel et conforme au design, aucune collision avec la liste d'ingrédients en dessous.
- **UX** : grille desktop 2 colonnes confirmée active (≥780px), 3 blocs en ligne sur desktop / empilés en mobile, CTA final accessible et non masqué par le bouton flottant "retour en haut".
- Itérations : 1 (le placement initial du sceau en texte arqué SVG a été rejeté avant implémentation finale — voir ci-dessous — et remplacé par un médaillon à texte droit, plus fidèle au flyer et sans risque d'orientation de texte à l'envers).

## Décision technique notable
Le sceau a d'abord été prototypé avec du texte arqué (SVG `textPath` le long d'un cercle), technique élégante mais risquée ici : la trajectoire choisie aurait fait apparaître le texte à l'envers sur la moitié basse du cercle. En réexaminant le flyer de près, le vrai sceau est un médaillon à texte droit empilé (pas un arc complet) — implémentation simplifiée en conséquence, plus fidèle et plus robuste.

## Reste à faire / pour l'utilisateur
- Si une date de lancement officielle est fixée, un compte à rebours réel peut être ajouté (même mécanisme que celui du concours) — non fait, aucune date fournie ni dans le flyer ni par l'utilisateur.
- Les points de contact secondaires (pastille `menu.html`, carte `reseaux.html`, lignes de pied de page) n'ont pas été retouchés : ils restent cohérents avec "Panuzo" mais ne reprennent pas encore le langage "tous les lundis / éphémère". À faire si souhaité, en mission séparée pour ne pas faire dériver le périmètre de celle-ci.
