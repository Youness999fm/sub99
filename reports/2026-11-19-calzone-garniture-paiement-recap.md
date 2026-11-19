# Calzone (garniture obligatoire), paiement multiple, récapitulatif « Mon panier »

Date : 2026-11-19 · Dépôt : `sub99` · Suivi e2e détaillé : [e2e-calzone-paiement-recap.md](e2e-calzone-paiement-recap.md) · Remplacement des emojis : [2026-11-19-emoji-vers-icones-svg.md](2026-11-19-emoji-vers-icones-svg.md)

## 1. Demande

1. **Calzone** : pas de moitié-moitié (`data-no-half`) ; suppléments conservés ; garniture obligatoire parmi jambon, thon, kebab, viande hachée, poulet (span `menu-item__choice` de la fiche) ; ingrédients retirables sauce tomate, fromage, jaune d’œuf ; « jaune d’œuf » à la place de « œuf » pour la calzone.
2. **Récapitulatif** : titre du tiroir « Mon panier » ; bouton « Copier » retiré.
3. **Moyens de paiement** (livraison) : plusieurs choix possibles à la fois (par exemple espèces + carte ticket restaurant, 2 ou 3) ; le bloc du billet apparaît dès qu’« Espèces » est coché.

Dernière demande : vérifier le journal du remplacement des emojis, appliquer les changements de calzone une fois les groupes terminés, tester sur la page réelle, rendre compte. **Les changements de calzone étaient déjà en place** (vérifiés sur le fichier) ; ce tour a porté sur la vérification, les défauts trouvés et leur correction.

## 2. État vérifié

### `menu.html`
- Fiche « Calzone (soufflée) » (ligne 226) : `data-no-half`.
- Ingrédients (ligne 232) : « Sauce tomate, fromage, jaune d’œuf, » suivi du span `menu-item__choice` « Garniture au choix : jambon, thon, kebab, viande hachée ou poulet ».
- « jaune d’œuf » n’est appliqué qu’à la calzone. Les autres fiches contenant « oeuf » (voir section 6) sont inchangées.

### `assets/js/cart.js`
- **Lecture de la fiche** : `readMenuItemIngredients(item)` lit la garniture à part (sur un clone) ; la liste « Sans » ne contient que les ingrédients fixes.
- **Catalogue de moitiés** : `readPizzaCatalog` exclut `data-no-half` (29 pizzas, aucune calzone).
- **Widget** : `buildPizzaWidget(…, options)` avec `allowHalf` (section moitié-moitié masquée pour la calzone) et `choice` (rangée de garniture visible dès qu’une taille est choisie). Sans garniture, « Ajouter telle quelle » et « Ajouter au panier » sont désactivés, avec un indice et un résumé qui le disent.
- **Nom de ligne** : `displayName()` ajoute la garniture (« Calzone (soufflée) — Thon »). Deux garnitures = deux lignes, visibles partout.
- **Supplément au changement de taille** : `rebuildExtras` recale le prix d’un supplément coché sur la taille affichée, ou le retire s’il n’a pas de prix pour elle.
- **Paiement** : `paymentMethods` (tableau, ordre fixe), `togglePaymentMethod`, `paymentMethodHtml` (bloc billet seulement si « Espèces » est coché, `cashChangeFor` remis à `null` sinon), validation « au moins un moyen » en livraison (`orderProblem`).
- **Envoi** : `submitOrder` envoie `payment_methods` (tableau ; vide à emporter) et `cash_change_for`. Le panier n’est vidé qu’avec un `public_token` ; sans lui, rien n’est effacé et un message d’erreur demande d’appeler.
- **Verrou** : `orderBusy` évite un double envoi ; `pageshow` le relâche au retour arrière depuis le cache du navigateur.
- **Garde-fou** : `calzoneLineIncomplete` refuse une calzone sans garniture ou en moitié-moitié (anciens paniers enregistrés).
- **Récapitulatif** : titre « Mon panier » ; bouton Copier, `buildRecapText` et `copyToClipboard` supprimés ; « Envoyer à quelqu’un » conservé, affiché seulement si `navigator.share` existe.
- **Reprise après connexion** : `resumeOrderIfNeeded` restaure les moyens (liste JSON, filtrée) et le billet seulement si « Espèces » fait partie des moyens restaurés. Clés : `subito_pending_payment_methods`, `subito_pending_cash_change`, `subito_pending_order_mode`, `subito_pending_order_redirect`.

### `assets/js/commande.js`
- `paymentLabel` accepte un tableau (libellés joints par « · ») et échappe la valeur du billet (point ouvert depuis la session précédente).

### `assets/js/compte.js`
- `withQuery(url, param)` place le paramètre de reprise **avant** l’ancre (`#desserts`). Les deux redirections l’utilisent.

### `assets/css/cart.css`
- Pastilles de garniture (`pizza-widget__filler-btn`, vertes quand choisies, comme les moyens de paiement), indice, `:disabled` sur les boutons d’ajout, séparateur : `.customize__section:not([hidden]) ~ .customize__section:not([hidden])`.

## 3. Contrat d’API définitif (à implémenter côté PHP)

- `order_create.php` reçoit : `mode`, `payment_methods` (tableau de `card`, `cash`, `ticket`, `ticket_card` ; **toujours un tableau**, vide à emporter), `cash_change_for` (`null` si pas d’espèces, `0` pour l’appoint exact, sinon `10`, `20`, `50` ou `100`), `items`, `delivery_fee`, `total`.
- Succès = réponse 2xx avec `public_token`. Sans lui, le client voit une erreur et le panier reste intact.
- `order_status.php` doit renvoyer `payment_methods` et `cash_change_for` pour l’affichage du suivi.
- Schéma `orders` : ajouter `payment_methods_json` et `cash_change_for` (le plan n’en prévoyait aucun).
- La garniture est dans le nom de la ligne : aucune colonne supplémentaire.

## 4. Revues indépendantes et corrections

### Première revue (juge et adversaire)
- **Juge : FAIL** sur deux exigences du paiement : un état de session périmé pouvait faire partir une livraison avec des espèces non cochées ; la validation pouvait être contournée.
- **Adversaire** : un point bloquant (le panier était vidé avant la confirmation de l’API, et aucun message n’apparaissait) et huit non bloquants (double envoi, prix d’un supplément après changement de taille, ancre qui cassait la reprise, paniers anciens sans garniture, documentation, style).

### Corrections
| Point | Correction | Preuve |
|---|---|---|
| Paiement périmé (juge FAIL) | Clés effacées à chaque tentative invitée ; billet restauré seulement si « Espèces » est restauré | Navigation réelle : `["ticket_card"]` + billet 20 → après reprise, billet `null` |
| Confirmation (bloquant) | Panier vidé seulement avec `public_token` | Réponse sans jeton : panier intact, message d’erreur |
| Double envoi | Verrou `orderBusy` | Double-clic réel : une seule requête |
| Prix supplément | Recalage sur la taille affichée | « + thon » : 1,50 € → 4,00 € en XXL |
| Payload à emporter | `payment_methods: []` | Charge utile vérifiée |
| Ancre et reprise | `withQuery` | 5 / 5 cas |
| Anciens paniers | `calzoneLineIncomplete` | Message, aucune requête |
| Style de garniture | Pastille verte | Styles calculés vérifiés |
| Séparateur parasite | Sélecteur `:not([hidden])` | Première section sans bordure |
| Retour arrière (adversaire v2) | `pageshow` relâche le verrou | Non reproduit au navigateur (cache non déclenchable ici) ; correction de code |
| Documentation | Rapport et e2e corrigés ; anciens rapports marqués dépassés | — |

### Seconde revue (juge et adversaire sur le code corrigé)
- **Juge : PASS** sur les 19 exigences (calzone, récapitulatif, paiement, priorités a, b, c). Le rendu visuel, marqué UNVERIFIED, a été contrôlé au navigateur (suivi e2e, itération 3).
- **Adversaire** : les neuf points précédents sont **résolus** (P5 partiellement, car le contrat écrit disait `null` ; corrigé). Deux nouveaux points non bloquants, tous deux traités (retour arrière, documentation).

### Intégrité du texte (remplacement des emojis)
- `cart.js` : **PASS** (393 lignes résiduelles, toutes classées : modifications voulues ou artefacts de normalisation ; aucun mot perdu).
- Détail et décisions restantes : voir [2026-11-19-emoji-vers-icones-svg.md](2026-11-19-emoji-vers-icones-svg.md).

## 5. Tests sur la page réelle

Résumé (détail dans le suivi e2e) : parcours calzone complet (taille, garniture, supplément, recalage au changement de taille, ajout) ; récapitulatif (titre, absence de Copier) ; paiement (cumul espèces + carte ticket restaurant, billet, remise à zéro) ; envoi (à emporter, double-clic, ancienne calzone refusée, jeton de suivi et redirection) ; reprise (état périmé et reprise légitime) ; styles (séparateur, pastille) ; capteur d’erreurs : aucune erreur JavaScript pendant les parcours.

**Limites** : la session et l’API sont **simulées dans la page** pour l’envoi (l’API PHP n’existe pas encore) ; la connexion réelle n’a pas été faite (aucun identifiant utilisé) ; le retour arrière depuis le cache du navigateur n’a pas été reproduit.

## 6. Points à trancher

1. **« jaune d’œuf » pour les autres fiches** : je ne l’ai appliqué qu’à la calzone. `menu.html` contient encore « oeuf » pour les pizzas Kefta, L'Extravagante, Orientale, Subito et pour les salades Exotique, Niçoise, Printanière, Di Roma. Pour les pizzas, la demande peut s’étendre ; pour les salades, un œuf entier est servi, donc je ne le ferais pas sans votre accord.
2. **Promo livraison** : la calzone compte comme une pizza (2ᵉ à −50 %). C’était déjà le cas ; à confirmer si le restaurant veut l’exclure.
3. **Textes de la bannière** : « Le paiement se fait sur place, au retrait » et « 30 secondes à la création » ne figurent dans aucune source. À faire valider par le restaurant.
4. **Chantier disponibilité en parallèle** : un autre chantier modifie `menu.html`, lit `assets/data/disponibilite.json` et retire une garniture indisponible du choix (aujourd’hui, à 02:48, « jambon » et deux pizzas étaient marqués indisponibles). Ce comportement est conforme à sa règle. Je n’ai pas touché à ces fichiers.
5. **Maquette `commercant.js`** : l’ancien groupe « jambon|thon|kebab|viande hachée|poulet » reste dans la fiche calzone de la maquette ; à aligner au branchement du backend.
