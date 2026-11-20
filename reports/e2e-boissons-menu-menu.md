# E2E — Section Boissons (menu.html) — 10 boissons individuelles

Date : 2026-11-20
Branche testée : claude/adoring-gates-tqq04c (commit cb2df6f)
Outil : Chromium piloté via Playwright (navigateur réel, pas de simulation), serveur local `npm run dev` (port 8095)
Itérations : 1/5 (validé dès le premier tour, aucune correction nécessaire)

## Mission

Remplacer les 2 cases génériques "Boisson 33cl" / "Grande bouteille" de la section `#boissons` de `menu.html` par 10 cases individuelles (une par boisson), chacune avec photo propre, nom précisant "(canette)" ou "(grande bouteille)", et prix (1,50€ canette / 3,00€ grande bouteille).

## Étapes testées

1. Démarrage serveur dev (`npm run dev`, port 8095) — OK.
2. Navigation vers `menu.html#boissons`, scroll jusqu'à la section — capture desktop (1400x1000).
3. Lecture DOM : 10 `.menu-item` dans `#boissons`, noms/prix extraits.
4. Responsive mobile (375x812) : scroll complet de la section (captures m1 à m6, jusqu'au footer).
5. Chemin nominal : clic "Ajouter" sur "Oasis Pomme Poire (canette)" puis sur "Coca-Cola Original (grande bouteille)", ouverture du panier.
6. Lecture du `localStorage` (`subito_cart_v1`) pour vérifier les lignes du panier.

## Résultat des 10 cases (extrait DOM réel)

| Nom affiché | Prix | Image | Naturelle (W×H) |
|---|---|---|---|
| Oasis Pomme Poire (canette) | 1,50 € | photo-74.jpg | 1206×1188 |
| Fanta Orange (canette) | 1,50 € | photo-80.jpg | 1206×1198 |
| Coca-Cola Original (canette) | 1,50 € | photo-83.jpg | 1206×1198 |
| Coca-Cola Zero (canette) | 1,50 € | photo-77.jpg | 1206×1210 |
| Tropico Orange & Ananas (canette) | 1,50 € | photo-75.jpg | 1206×1193 |
| Lipton Peach Ice Tea (canette) | 1,50 € | photo-81.jpg | 1206×1194 |
| Oasis Pomme Cassis Framboise (canette) | 1,50 € | photo-82.jpg | 1206×1195 |
| Coca-Cola Original (grande bouteille) | 3,00 € | photo-79.jpg | 1206×1197 |
| Fanta Orange (grande bouteille) | 3,00 € | photo-78.jpg | 1206×1188 |
| Tropico Orange & Ananas (grande bouteille) | 3,00 € | photo-76.jpg | 1206×1172 |

10/10 cases conformes à la mission (une boisson = une case, format explicite dans le nom, prix correct par format).

## Audit Technique

- `read_console_messages` (via listener `console`/`pageerror`) : **aucune erreur JS** sur tout le parcours (chargement, scroll, resize mobile, ajout panier, ouverture panier).
- `read_network_requests` (via listener `response`) : **aucune requête ≥400**. Les 10 images `photo-74.jpg` à `photo-83.jpg` répondent toutes, `img.complete === true` et dimensions naturelles cohérentes (~1206×1170-1210, pas de 0×0 ni d'image cassée).
- Panier (`localStorage.subito_cart_v1`) après ajout des 2 boissons : deux lignes bien distinctes, aucune fusion malgré le nom de marque partagé ("Coca-Cola Original") :
  - `Boisson Oasis Pomme Poire (canette)` — basePrice 1.5 — qty 1
  - `Boisson Coca-Cola Original (grande bouteille)` — basePrice 3 — qty 1
  - Identifiants internes distincts (`"canette"` vs `"grande bouteille"` dans le `id`), donc pas de risque de collision future entre les deux formats du même Coca-Cola.

**Verdict Technique : PASS.**

## Audit UI

- **Desktop (1400px)** : grille 4 colonnes, 10 cartes bien alignées, photo/bandeau rouge-vert cohérent avec le reste du menu, bouton "Ajouter" + stepper quantité homogènes avec les autres sections.
- **Mobile (375×812)** : une colonne, cartes lisibles, images non déformées (ratio conservé), scroll jusqu'au footer sans rupture de mise en page ni chevauchement. Les deux variantes de Coca-Cola Original (canette rouge vs bouteille grand format) sont visuellement bien différenciées par la photo.
- Panier (modal "Mon panier") : les 2 lignes ajoutées s'affichent clairement avec prix unitaire et sous-total, total "4,50 €" correct (1,50 + 3,00).
- Aucun élément cassé, tronqué ou qui déborde sur les deux résolutions testées.

**Verdict UI : PASS.**

## Audit UX

- Le client voit immédiatement, boisson par boisson, le format exact (texte "(canette)" / "(grande bouteille)" directement dans le nom, pas une mention annexe) — aucune ambiguïté, en particulier entre les deux fiches "Coca-Cola Original" qui auraient pu prêter à confusion : elles sont visuellement distinctes (canette vs bouteille 1,5L) et le panier le confirme avec des libellés complets.
- Parcours d'ajout identique au reste du site (bouton "Ajouter" + feedback toast "Boisson X ajouté ✓" + barre panier sticky en bas) : pas de rupture d'expérience entre les boissons et le reste de la carte.
- Pas d'étape superflue : un clic suffit pour ajouter une boisson précise, contre un choix générique + ambiguïté de marque dans l'ancienne version à 2 cases.

**Verdict UX : PASS.**

## Problèmes trouvés

Aucun problème bloquant ni mineur. Aucune correction n'a été nécessaire.

## Verdict global

**VALIDÉ** en e2e réel (1 itération). La section Boissons de `menu.html` expose bien 10 boissons individuelles, chacune avec photo, nom explicite du format et prix correct ; le chemin nominal d'ajout au panier (une canette + une grande bouteille) produit deux lignes distinctes aux bons montants ; aucune erreur technique, aucun défaut UI, parcours UX clair.
