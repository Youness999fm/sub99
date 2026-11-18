# Mission — Bouton "Envoyer" + récapitulatif simplifié sans prix

## Demande
Ajouter un bouton de partage natif (« petites flèches pour envoyer ») à côté de « Copier le récapitulatif », pour que le client puisse l'envoyer à quelqu'un d'autre qui passera l'appel. Ce contenu envoyé doit être simplifié : pizza/taille, suppléments, retraits, moitié-moitié, peut-être le total — sans le détail des prix ni le reste.

## Interprétation retenue (à confirmer)
Le bouton « Copier » existant reste inchangé (texte complet, avec les prix) : il sert toujours de pense-bête détaillé pour le client lui-même avant d'appeler. Le **nouveau** bouton « Envoyer à quelqu'un » utilise lui le texte simplifié, puisque c'est précisément le cas d'usage décrit (l'envoyer à un tiers). Si vous vouliez en réalité que « Copier » devienne lui aussi simplifié, dites-le-moi.

## Ce qui a été fait
- **Bouton « 📤 Envoyer à quelqu'un »** ajouté à côté de « Copier », utilisant l'API native de partage du téléphone (`navigator.share`) — ouvre le menu de partage du système (WhatsApp, SMS, Messages, etc.). N'apparaît que si le téléphone/navigateur la prend en charge (pas tous les navigateurs ne l'ont) : jamais de bouton qui ne ferait rien.
- **Texte simplifié dédié**, sans aucun prix de détail :
  ```
  Commande Subito Pizza

  1 × Végétarienne (Duo)
     - Moitié 1 : Végétarienne
     - Moitié 2 : Chicken
     - Sans : oignons
     - Suppléments : Champignons

  Total : 16,00 €

  📞 Pour commander : appeler Subito Pizza au 03 21 20 00 33 (à confirmer par téléphone, ce n'est pas une commande en ligne).
  ```
  Contient uniquement : pizza + taille, moitié-moitié, retraits, suppléments (juste les noms, pas les prix ni la mention "échange offert"), le total général, et le numéro à appeler pour que la personne qui reçoit sache quoi faire. La demande libre ("Autre demande") n'est volontairement pas incluse, conformément à "rien d'autre, tu mets pas".

## Vérifications réellement effectuées
- `navigator.share` est absent dans mon navigateur de test (comportement normal, variable selon les navigateurs) : vérifié que le bouton reste bien **caché** dans ce cas, pas de bouton inactif affiché.
- Simulé la présence de l'API pour vérifier le contenu exact transmis : conforme au format attendu ci-dessus.
- Vérifié que « Copier » produit toujours le texte complet (avec prix, promo, demande libre) — inchangé.
- `node --check` : syntaxe valide.

## Limite de test
Je n'ai pas pu tester l'ouverture réelle du menu de partage du système (WhatsApp, SMS...) : ça nécessite un vrai téléphone. Le contenu transmis à l'API a été vérifié directement, mais pas le rendu final dans l'app de destination.

## Verdict
Fonctionnalité livrée et vérifiée dans la limite de ce que l'environnement de test permet. Un point d'interprétation à confirmer (voir ci-dessus). **PASS avec un point à valider.**

## À republier
`assets/js/cart.js`, `assets/css/cart.css`, par FTP.
