# Mission — Correctif : les boutons +/− du panier ne répondaient pas sur téléphone

## Signalement
Après mise en ligne, sur téléphone : ajouter une pizza (ex. 4 Saisons Solo) fonctionne, mais une fois dans le récapitulatif, appuyer sur + ou − ne fait rien.

## Cause réelle (confirmée, pas supposée)
Chaque ligne du panier est identifiée en interne par une longue signature JSON (nom, taille, retraits, suppléments...). Cette signature était insérée directement dans un attribut HTML (`data-id="..."`). Or un JSON contient des guillemets `"` — et un attribut HTML délimité par des guillemets se referme automatiquement au premier guillemet rencontré. Résultat concret :

```html
<div class="cart-line" data-id="{"n":"4 saisons","v":"solo",...}">
```

L'attribut `data-id` ne contenait en réalité que `{` — le reste du JSON cassait le balisage. Au clic sur + ou −, le script cherchait la ligne correspondant à cet attribut tronqué, ne la trouvait jamais, et n'attachait donc **aucun gestionnaire de clic** sur ces boutons : ils devenaient visuellement présents mais totalement inertes. Le comportement exact dépend de la façon dont chaque navigateur « répare » un attribut mal formé — ce qui explique que ça n'ait pas été repéré de la même façon partout pendant les tests précédents.

## Correctif
`assets/js/cart.js` : les lignes du panier ne sont plus repérées par cette signature fragile dans le HTML, mais par un simple **numéro de position** (`data-index="0"`, `"1"`, ...) — aucun caractère spécial possible, donc aucun risque de casser l'attribut, quel que soit le navigateur. En complément, la fonction d'échappement HTML interne (`escapeHtml`) échappe désormais aussi les guillemets par prudence, partout où elle est utilisée.

## Vérifications réellement effectuées
- Reproduction exacte du scénario signalé (4 Saisons, taille Solo, ajout, puis clic réel sur + dans le récapitulatif, en viewport mobile 375 px) : la quantité passe bien de 1 à 2, le sous-total et la remise « 1 pizza achetée = 1 offerte » se recalculent instantanément.
- Clic réel sur − : quantité redescend correctement.
- Suppression (🗑) d'un article avec plusieurs lignes dans le panier (une pizza + un article sans taille) : la bonne ligne est retirée, l'autre reste intacte.
- `node --check` : syntaxe valide.

## Verdict
Bug réel confirmé et corrigé, reproduit puis vérifié résolu en conditions réelles (clic tactile, viewport mobile). **PASS.**

## À republier
`assets/js/cart.js` uniquement, par FTP — c'est le seul fichier concerné par ce correctif.
