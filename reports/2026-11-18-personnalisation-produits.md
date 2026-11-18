# Mission — Personnalisation des produits (retraits, suppléments, moitié-moitié)

## Demande initiale
Ajouter une personnalisation des pizzas/pâtes/Subitowichs ("paninis") — retrait d'ingrédients, suppléments, moitié-moitié — sans transformer le panier en tunnel de commande : il reste un pense-bête pour préparer l'appel téléphonique. Précisions apportées en cours de mission par l'utilisateur :
- "Speedopids" (mentionné dans la consigne collée) était une faute de frappe sans rapport — mission bien exécutée sur Subito Pizza.
- Moitié-moitié uniquement sur les tailles **Duo, Quatro, XXL** (pas Solo) ; retraits et suppléments sur **toutes les pizzas**.
- Toute la personnalisation doit se faire **directement sous le produit** sur la page carte — pas dans le panier, qui reste un pur récapitulatif en lecture (aucun bouton "modifier" dans le panier).

## Analyse préalable du projet (avant tout code)
- Prix des pizzas : grille partagée par taille (`.size-chart`, Solo/Duo/Quatro/XXL), identique pour toutes les recettes — confirmé en lisant `menu.html`, `vegetarien.html`, `composer.html`.
- Ingrédients réels : lus depuis `.menu-item__ingredients` de chaque fiche (aucune liste inventée).
- Suppléments réels et leurs prix : seule source trouvée = `supplements.html` (dupliqué visuellement sur `composer.html`), deux groupes — « Légumes et sauces » (1,00 à 3,50 € selon taille) et « Viandes, poissons et fromages » (1,50 à 4,00 € selon taille). Aucune donnée de supplément pour Pâtes/Subitowichs : pas de prix inventé pour ces catégories.
- Moitié-moitié : la mention existait déjà textuellement sur `menu.html` ("À partir de la taille Duo, possibilité de moitié-moitié entre deux pizzas différentes") — confirme la règle Duo/Quatro/XXL donnée par l'utilisateur, sans avoir besoin de l'inventer.
- Aucune règle de prix pour une pizza moitié-moitié nulle part sur le site : j'ai appliqué le prix standard de la taille choisie, **par cohérence avec la règle déjà en vigueur sur tout le menu** (chaque pizza, quelle que soit sa recette, coûte le même prix pour une taille donnée) — **à confirmer avec le restaurant**, ce n'est pas une règle explicitement écrite.

## Ce qui a été fait
**Panneau "✏️ Personnaliser" dépliable sous chaque produit concerné** (menu.html, vegetarien.html, composer.html), replié par défaut, à côté des boutons d'ajout rapide existants (inchangés, toujours un ajout immédiat sans option) :
- **Pizzas** (y compris la base de `composer.html`) : sélection de taille, case "moitié-moitié" activée seulement sur Duo/Quatro/XXL (sur Solo, l'option reste visible mais désactivée avec l'explication "Disponible à partir de la taille Duo"), puces "Sans X" (ingrédients réels de la ou des pizzas concernées, fusionnés si moitié-moitié), suppléments groupés avec le prix réel de la taille choisie, champ "Autre demande" libre. Le bouton "Ajouter au panier" reste désactivé tant que la taille — et les deux moitiés si l'option est cochée — ne sont pas choisies, avec le motif affiché.
- **Pâtes et Subitowichs** : puces "Sans X" + "Autre demande" uniquement (pas de suppléments, aucune donnée de prix fiable pour ces catégories).
- **Tex-Mex, Salades, Desserts, Boissons** : strictement inchangés, hors périmètre de la demande.
- Bandeau "🆕 Nouveau" déjà présent en haut de `menu.html` (ajouté lors d'une mission précédente) : pas retouché, reste pertinent.

**Dans le panier** (resté un pur récapitulatif, aucune action d'édition) : chaque article personnalisé affiche le détail complet —
```
1 × Végétarienne (Duo)
Moitié 1 : Végétarienne
Moitié 2 : Chicken
Sans : oignons
Suppléments : Champignons
Autre demande : sauce à part
```
Même format dans le texte copié. Deux articles identiques en tout point se regroupent (quantité++) ; la moindre différence (un ingrédient en moins, un supplément, une moitié différente, une note différente) crée une ligne séparée — jamais fusionné silencieusement. Le numéro de téléphone, le bouton d'appel et la phrase "ce n'est pas une commande en ligne" restent inchangés.

## Bugs trouvés et corrigés en testant réellement (pas en relisant le code)
1. **Perte de sélection à chaque clic** : cocher une puce "Sans X" ou un supplément déclenchait une reconstruction complète du panneau qui effaçait la sélection qu'on venait de faire. Corrigé : le panneau ne se reconstruit que lorsque la liste réelle change (taille, choix de la deuxième moitié), jamais sur un simple clic.
2. **Affichage cassé dans le panier** : l'identifiant technique de la ligne (un JSON contenant des guillemets) était inséré tel quel dans un attribut HTML, cassant la mise en page et faisant fuiter du texte brut à l'écran. Corrigé (échappement HTML).
3. **Section moitié-moitié jamais masquée** : même piège CSS que lors d'une mission précédente (`display:flex` qui écrase `[hidden]`) — corrigé.
4. **`composer.html`** proposait une case "moitié-moitié" sans aucun parfum réel à choisir (pas de catalogue de pizzas sur cette page) : la section est maintenant masquée là où elle n'a pas de sens plutôt que de proposer un choix vide.
5. Accessibilité : champ "Autre demande" sans étiquette correctement associée (`for=""`) — corrigé avec un identifiant unique par panneau.

## Vérifications réellement effectuées (serveur local, vrais clics/événements)
- Parcours complet moitié-moitié XXL (Végétarienne / Carnivora) avec un retrait + deux suppléments de groupes différents : prix exact vérifié (33 + 4 + 3,50 = 40,50 €), affichage et texte copié conformes.
- Solo → case moitié-moitié désactivée + message explicatif ; Duo → activée, message disparu.
- Bouton "Ajouter au panier" bloqué tant que les deux moitiés ne sont pas choisies, débloqué une fois la deuxième sélectionnée.
- Pâtes (Bolognaise) : même config ajoutée deux fois → fusion (qty 2) ; config modifiée → ligne séparée (qty 1).
- `vegetarien.html` : liste de parfums pour la deuxième moitié limitée aux 5 pizzas réellement présentes sur cette page (pas le catalogue complet).
- `composer.html` : suppléments fonctionnels, moitié-moitié masquée (pas de catalogue), prix de base distinct (9/13/17,50/25,50 €) bien utilisé.
- Catégories hors périmètre (Tex-Mex, Salades, Desserts, Boissons) : aucun panneau ajouté, confirmé.
- Mobile (375 px) : panneau replié par défaut, lisible, puces confortables au doigt une fois déplié.
- Aucune erreur console sur `menu.html`, `vegetarien.html`, `composer.html`, `index.html` après toutes ces manipulations.
- `node --check` sur `cart.js` : syntaxe valide tout au long.

## Auto-critique (section 8 de la demande)
1. Panier ≠ commande en ligne : phrase et bouton d'appel inchangés, toujours visibles en bas du récap. ✅
2. Retrait d'ingrédient : puces explicites "Sans X", pas d'icône seule. ✅
3. Suppléments visuellement distincts des retraits (couleur différente, pas de texte barré). ✅
4. Moitié-moitié uniquement Duo/Quatro/XXL, jamais Solo, vérifié en conditions réelles. ✅
5. Le panier restitue exactement les choix (vérifié ligne par ligne, y compris le texte copié). ✅
6. Aucun prix ni ingrédient inventé — tout vient du DOM des pages existantes ou de `supplements.html`. ✅
7. Testé au doigt sur viewport mobile, panneau non intrusif par défaut. ✅

## Informations manquantes à signaler
- **Prix d'une pizza moitié-moitié** : aucune règle écrite sur le site. J'ai appliqué le prix standard de la taille (cohérent avec le reste du menu où toutes les recettes coûtent le même prix à taille égale) — à confirmer.
- **Aucun prix de supplément pour Pâtes et Subitowichs** : ces catégories n'ont que le retrait d'ingrédients et la demande libre, pas de suppléments chiffrés, faute de données fiables sur le site.
- La signification de l'astérisque (`*`) après certains suppléments carnés dans `supplements.html` (ex. "chorizo*") n'est expliquée nulle part sur le site — reproduite telle quelle, sans interprétation.

## Verdict
Fonctionnalité testée en conditions réelles (vrais clics, vrais événements, pas seulement relue), conforme au périmètre demandé et à vos précisions. Panier inchangé dans son rôle de pense-bête. **PASS.**

## À republier
`menu.html` (bandeau déjà en place, non retouché ici), `assets/js/cart.js`, `assets/css/cart.css`, par FTP. Aucune autre page HTML modifiée.
