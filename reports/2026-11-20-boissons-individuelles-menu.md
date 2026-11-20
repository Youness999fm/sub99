# Boissons individuelles dans le menu

Date : 2026-11-20
Branche : claude/adoring-gates-tqq04c
Commits : cb2df6f (10 boissons), 2e5bf45 (photo Tarte au Daim)

## Demande d'origine

L'utilisateur a fourni 10 photos de boissons (Oasis Pomme Poire canette, Tropico Orange & Ananas canette et grande bouteille, Coca-Cola Zero canette, Fanta Orange grande bouteille 1,5L, Coca-Cola Original grande bouteille, Fanta Orange canette, Lipton Peach Ice Tea canette, Oasis Pomme Cassis Framboise canette, Coca-Cola Goût Original canette) et a demandé de les insérer dans le menu, une par une, avec le bon nom précisant "canette" ou "grande bouteille", pour que le client choisisse sa boisson individuellement plutôt qu'un choix générique par format.

En cours de mission, une demande annexe a été ajoutée : remplacer le placeholder "shooting en cours" de la "Part de Tarte au Daim" par la vraie photo fournie.

## Ce qui a été fait

- Section `#boissons` de `menu.html` : les 2 cases génériques ("Boisson 33cl" listant 11 marques, "Grande bouteille" listant 4 marques) ont été remplacées par 10 cases individuelles `<article class="menu-item">`, chacune avec :
  - une photo dédiée (`assets/img/photos/photo-74.jpg` à `photo-83.jpg`, copiées depuis les uploads utilisateur) ;
  - un nom précisant la marque/saveur et le format : "(canette)" ou "(grande bouteille)" ;
  - un prix repris des prix génériques précédents : 1,50 € canette / 3,00 € grande bouteille.
- Suppression du commentaire HTML devenu obsolète qui demandait un arbitrage sur le regroupement par saveur.
- Section desserts : remplacement du placeholder "shooting en cours" de "Part de Tarte au Daim" par la photo réelle (`assets/img/photos/photo-84.jpg`).

## Verdict adversaire

Aucune objection bloquante. Mapping photo/nom vérifié byte-à-byte (cmp) conforme à l'ordre attendu, rien d'autre cassé dans le fichier, prix cohérents avec l'existant, panier JS (`cart.js`) fonctionnel sans collision entre les deux formats "Coca-Cola Original". Remarques mineures non bloquantes : texte alt légèrement différent du nom affiché pour 2 produits (cosmétique), doublons "Kebab"/"Milano" préexistants ailleurs dans le fichier (hors périmètre).

## Verdict juge (validator)

**PASS.** Exactement 10 cases, ni plus ni moins, dérive de périmètre nulle (diff isolé à la section boissons). Chaque nom précise explicitement le format demandé. Plus aucun regroupement générique : le client choisit boisson par boisson comme demandé.

## Audit e2e réel (navigateur, Playwright/Chromium sur `npm run dev`)

Itérations : 1/5 (validé dès le premier tour, aucune correction nécessaire). Rapport détaillé : `reports/e2e-boissons-menu-menu.md`.

- **Technique** : 0 erreur console JS, 0 requête réseau en échec, les 10 images se chargent (dimensions naturelles cohérentes, aucune image 0×0).
- **UI** : grille propre en desktop (4 colonnes) et en mobile (375×812, colonne unique), images non déformées, rien de cassé/tronqué/chevauchant.
- **UX** : format toujours explicite dans le nom affiché (aucune ambiguïté, y compris entre les deux fiches "Coca-Cola Original"), ajout au panier en un clic, panier reflétant bien 2 lignes distinctes (1,50 € + 3,00 € = 4,50 € total correct).

## Vérification complémentaire — photo Tarte au Daim

Changement ponctuel vérifié indépendamment (fichier identique à l'upload via `cmp`, remplacement localisé au seul article concerné, structure cohérente avec les autres items, plus aucune référence au placeholder "shooting en cours"). PASS, aucune anomalie.

## Definition of Done

- [x] Périmètre exact (10 boissons + 1 photo dessert, rien de plus)
- [x] Adversaire sans objection bloquante
- [x] Juge : PASS
- [x] Test e2e réel avec captures (desktop + mobile)
- [x] Audit technique OK
- [x] Audit UI OK
- [x] Audit UX OK
- [x] Rapport écrit dans `reports/`
