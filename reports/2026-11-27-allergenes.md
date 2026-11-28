# Allergènes — accordéon sur les fiches produits et page dédiée (27/11/2026)

## Ce qui était demandé

Permettre aux clients de consulter les allergènes, par un **accordéon dépliant** sur chaque fiche produit (jamais de fenêtre, jamais de redirection), plus une page dédiée, un lien en pied de page et deux questions dans la FAQ. Règle prioritaire du cahier des charges : **ne rien modifier de l'existant**, uniquement ajouter.

## 1. Fonctionnalités ajoutées

- **Accordéon « Allergènes »** sur 47 fiches produits (`menu.html`) et sur `vegetarien.html`, fermé par défaut, replié/déplié par `<details>/<summary>` **natif** — aucun JavaScript d'ouverture, donc aucun événement intercepté.
- **Page « Nos allergènes »** (`allergenes.html`) : recherche instantanée, filtres par catégorie, 47 fiches dépliables, légende des 14 catégories, accordéon « Notre engagement qualité ».
- **Lien « Allergènes »** ajouté au pied de page des 15 pages, à côté de « Mentions légales ».
- **Deux questions** dans la FAQ, dans la catégorie « Le menu », avec le mécanisme existant.
- **14 pictogrammes SVG** dessinés dans la grammaire des icônes du site (viewBox 24×24, trait 1.8, `currentColor`), toujours accompagnés du nom écrit.

## 2. Nouveaux fichiers

| Fichier | Rôle |
|---|---|
| `assets/js/allergenes/donnees.js` | Transcription du tableau. **Seule source de vérité** — pour mettre à jour, modifier ce fichier uniquement. |
| `assets/js/allergenes/pictos.js` | Les 14 pictogrammes. |
| `assets/js/allergenes/accordeon.js` | Insère l'accordéon dans les fiches produits. |
| `assets/js/allergenes/page.js` | Recherche et filtres de la page dédiée (confort seulement). |
| `assets/css/allergenes.css` | Styles, **tous préfixés `subito-allergen-`**. |
| `allergenes.html` | Page dédiée (générée). |
| `tools/build-allergenes.mjs` | Génère `allergenes.html` à partir de la coquille de `faq.html` + des données. |

## 3. Insertions dans les fichiers existants

| Fichier | Insertion | Pourquoi |
|---|---|---|
| `menu.html` | 4 lignes dans le `<head>` (1 CSS, 3 scripts) | Charger le module. |
| `vegetarien.html` | Les mêmes 4 lignes + l'attribut `data-subito-allergen-categorie="pizzas"` sur `.menu-grid` | Cette page n'a pas de `<section class="menu-category">` : l'attribut indique la catégorie. |
| `faq.html` | 2 blocs `<details class="faq-item">` | Les deux questions demandées, avec le mécanisme existant. |
| 15 pages HTML | `<a href="allergenes.html">Allergènes</a> — ` devant « Mentions légales » | Le lien discret en pied de page. |

**Aucune ligne existante n'a été supprimée ni réécrite.** Aucune fonction JavaScript, aucun événement, aucun style existant n'a été modifié.

## 4. Choix techniques et leurs raisons

- **`<details>/<summary>` natif** plutôt qu'un accordéon maison : c'est déjà l'idiome du site (la FAQ l'utilise 13 fois). Zéro JS d'ouverture, donc zéro risque pour le panier, et le clavier fonctionne tout seul.
- **Point d'insertion : juste après `<p class="menu-item__ingredients">`.** Vérifié avant d'écrire la moindre ligne : `cart.js` lit `.menu-item__ingredients` (élément distinct, non modifié) puis empile ses widgets avec `body.appendChild()` — insérer avant ne change donc ni sa lecture ni l'ordre de ses ajouts.
- **La page dédiée est générée depuis `faq.html`** : sa coquille ne peut pas diverger du site, et une future modification de l'en-tête ou du pied de page s'y propage en relançant le script.
- **Contenu de la page écrit en dur** (pas rendu par JS) : lisible sans JavaScript, référençable, accessible. Le JS ne sert qu'à la recherche et aux filtres.
- **Clé de données = catégorie + nom** : trois produits portent des noms voisins (pizza « 4 Fromages », pâtes « 3 fromages », subitowich « 4 fromages »). Les confondre serait une faute alimentaire.
- **Fichiers non minifiés** (~14 Ko au total) : évite de toucher `tools/minify-assets.mjs`. À ajouter plus tard si souhaité.

## 5. Tests réellement effectués

Tous dans un vrai navigateur, sur le serveur local, code identique à celui du dépôt.

| Test | Résultat |
|---|---|
| Accordéons posés sur `menu.html` | **47** sur 64 fiches |
| Tous fermés au chargement | ✅ 0 ouvert |
| Fermé : seul « Allergènes » est rendu (`innerText`) | ✅ |
| Mention fromages invisible tant que fermé | ✅ |
| Hauteur de fiche : fermée → ouverte → refermée | 419 → 694 → **419 px** (aucun espace vide) |
| Widget panier présent et dans le bon ordre | ✅ `nom → ingrédients → allergènes → widget` |
| Erreurs console | ✅ aucune |
| Page dédiée : 47 fiches, 6 catégories, 7 filtres | ✅ |
| Recherche « kefta » | ✅ 1 résultat |
| Filtre « Salades » | ✅ 4 résultats, puis retour à 47 |
| Suite de tests du serveur | **240/241**, identique à avant (le seul échec est le faux positif de fins de ligne CRLF déjà connu) |

**Vérification des données, produit par produit** contre le tableau : Carolina (gluten, lait, moutarde, sulfites), Indienne (+ céleri), Orientale (+ œufs, sulfites), Wings (6 allergènes), Fruits de mer (5 dont crustacés et mollusques), Tarte au Daim (+ fruits à coque), Napolitaine, Kebab — **tout correspond**.

**Un défaut trouvé et corrigé en cours de route** : le libellé de la recherche utilisait une classe `sr-only` qui n'existe pas sur ce site ; il s'affichait donc à l'écran. Corrigé en `visually-hidden`, la classe réellement définie dans `style.css`.

## 6. Tests impossibles à réaliser

- **Paiement et commande réelle** : non testés, aucune transaction déclenchée (conformément au cahier des charges).
- **Rendu sur tablette physique et téléphone physique** : vérifié par redimensionnement du navigateur uniquement.

## 7. Produits renseignés — 47

Pizzas 29 · Pâtes 2 · Subitowichs 6 · Tex-Mex 4 · Salades 4 · Desserts 2.

## 8. Produits NON renseignés — et pourquoi

Ces produits n'affichent **aucune ligne « Allergènes »** : une case vide n'est jamais transformée en « sans allergène ».

| Produit | Raison |
|---|---|
| Pizza **Suisse** | Absente du tableau. |
| Pâtes **Carbonara** | Absente du tableau. |
| Pâtes **3 fromages** | Le tableau liste « 4 FROMAGES » en pâtes — nom différent. |
| Subitowich **4 fromages** | Le tableau liste « 3 FROMAGES » en paninis — nom différent. |
| **Tiramisubito** Spéculoos, Oreo, M&M's | Le tableau n'a qu'un « TIRAMISU » générique : trois recettes ne peuvent pas hériter d'une seule ligne. |
| Les **10 boissons** | Chaque référence doit être vérifiée individuellement auprès du fabricant. |

## 9. Incohérences détectées — à confirmer

1. **« 3 fromages » / « 4 fromages » semblent inversés** entre vos pâtes et vos subitowichs par rapport au tableau. Je ne l'ai pas corrigé de moi-même : ce serait une déduction sur une donnée alimentaire.
2. **Pizza « 4 Fromages »** : le tableau indique « Brie, bleu, parmesan, mozzarella », le site affiche « Sauce tomate, fromage, brie, bleu, parmesan ». Les allergènes publiés (gluten, lait) sont ceux du tableau et restent valables dans les deux cas.
3. **Les Tiramisubito** : trois variantes sur le site, une seule ligne au tableau.

## 10. Sources

- **Tableau de Présence des Allergènes** SUBITO PIZZA, 4 pages (document interne — **non publié sur le site**, conformément au cahier des charges).
- **Calzone Nutella** : composition Nutella (nutella.com) — noisettes, lait, soja — plus le gluten de la pâte traditionnelle. **À confirmer** : la recette réelle ne doit contenir aucun autre ingrédient.
- **Canettes** : aucune recherche effectuée pour l'instant, les références exactes n'ont pas été vérifiées.

## 11. À valider avant publication

1. Les trois incohérences du point 9.
2. La composition réelle de la Calzone Nutella.
3. La mention « lait pasteurisé » doit être confirmée par les fiches techniques de **tous** les fromages réellement utilisés, en particulier ceux sous appellation protégée (maroilles, reblochon, bleu, chèvre).
4. Les références exactes des canettes, si vous souhaitez les documenter.

## 12. Comment retirer la fonctionnalité

1. Supprimer les 4 lignes ajoutées dans le `<head>` de `menu.html` et de `vegetarien.html`, plus l'attribut `data-subito-allergen-categorie` dans `vegetarien.html`.
2. Supprimer le lien `<a href="allergenes.html">Allergènes</a> — ` des 15 pieds de page.
3. Supprimer les 2 blocs `<details>` ajoutés dans `faq.html`.
4. Supprimer `allergenes.html`, `assets/css/allergenes.css`, `assets/js/allergenes/`, `tools/build-allergenes.mjs`.

Aucune autre trace : rien d'existant n'a été modifié.
