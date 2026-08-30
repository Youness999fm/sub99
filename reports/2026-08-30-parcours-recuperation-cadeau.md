# Mission — Parcours de récupération du cadeau (Snapchat + deadline 6 septembre)

## Demande initiale
Rendre limpide, dès l'arrivée sur `grand-tirage.html`, le parcours GAGNANT → MESSAGE SNAPCHAT → CODE GAGNANT → RÉCUPÉRATION DU CADEAU, avec une mise en évidence forte de la deadline du 6 septembre. Carte blanche sur la structure et les textes.

## Structure retenue
Dans `#tirage-resultats`, avant la recherche de pseudo (ordre pensé pour qu'on voie l'essentiel même en sautant le show) :
1. Titre "Les 30 gagnants"
2. **Bandeau deadline** (rouge, fort contraste) : "⏰ Gagnants, attention — Contacte-nous avant le 6 septembre" + compte à rebours réel ("Plus que 7 jours" aujourd'hui, se met à jour automatiquement les jours suivants).
3. **Bloc "Comment récupérer ton cadeau ?"** — 4 étapes numérotées avec icônes, dans des cartes individuelles très lisibles, + CTA principal "👻 Envoyer un message sur Snapchat" (lien réel vers `snapchat.com/add/subito_henin`, déjà utilisé ailleurs sur le site).
4. Recherche de pseudo — la carte de résultat d'un gagnant inclut maintenant le rappel de la démarche + le même bouton Snapchat + le bouton de partage existant.
5. Liste complète des 30 gagnants (inchangée).

## Textes exacts intégrés
- Bandeau : *"⏰ Gagnants, attention"* / *"Contacte-nous avant le **6 septembre**"* / countdown dynamique.
- Étapes : 🎉 *Tu as gagné — ton pseudo est dans la liste ci-dessous.* → 📲 *Envoie-nous un message sur Snapchat **avant le 6 septembre**.* → 🔑 *On te transmet ton **code gagnant**.* → 🎁 *Tu présentes ton code pour récupérer ton cadeau.*
- CTA principal : **👻 Envoyer un message sur Snapchat**
- Carte de résultat gagnant, ligne ajoutée : *"📲 Envoie-nous un message sur Snapchat **avant le 6 septembre** pour recevoir ton code gagnant."*
- Meta description / og:description mises à jour pour mentionner la deadline (utile si le lien est prévisualisé avant d'être ouvert).

## Actions techniques
- `grand-tirage.html` : nouveau bandeau + bloc étapes dans `#tirage-resultats` ; carte de résultat enrichie (Snapchat + partage côte à côte).
- `assets/js/tirage/main.js` : `daysUntilClaimDeadline()` (6 septembre 2026, calcul en date civile comme les autres décomptes du site) + `initClaimCountdown()`, appelés au chargement.
- `assets/css/tirage.css` : styles du bandeau, des étapes, et de la carte de résultat enrichie.

## Bug trouvé et corrigé pendant le test
Le bouton "Partager ma victoire" (`.btn-outline`) devenait quasiment illisible sur la carte verte du gagnant : texte blanc sur un fond gris clair hérité du style par défaut du navigateur pour un `<button>` (la classe `.btn-outline` ne définit pas de `background` explicite, ce qui passait inaperçu sur fond clair mais devenait un vrai problème de contraste sur fond sombre). Corrigé en ajoutant `background: transparent` à la règle spécifique à cette carte.

## Vérification e2e réelle
- Countdown vérifié : affiche bien "Plus que 7 jours" (aujourd'hui, 7 jours avant le 6 septembre).
- Carte de résultat testée pour un gagnant pizza (`Anita200311`) et un gagnant tiramisu (`Mathislens62`) : les deux affichent correctement le rappel Snapchat + deadline + les deux boutons, désormais lisibles.
- Lien Snapchat confirmé réel (`snapchat.com/add/subito_henin`, `target="_blank"`, `rel="noopener"`).
- Carte "non gagnant" non affectée, liste complète inchangée.
- Zéro erreur console sur l'ensemble des tests.

## Verdict
Conforme à la demande, avec un bug de contraste réel trouvé et corrigé en cours de route. **PASS.**

## À republier
Fichiers modifiés : `grand-tirage.html`, `assets/js/tirage/main.js`, `assets/css/tirage.css`. À renvoyer par FTP comme précédemment pour être visibles sur `https://www.subito-pizza-heninbeaumont.fr/tirage-au-sort`.
