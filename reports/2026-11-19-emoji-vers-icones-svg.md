# Remplacement des emojis par les icônes SVG du jeu commun

Date : 2026-11-19 · Dépôt : `sub99` · Workflow : `wf_ce95da0e-356` (« emoji-vers-icones-svg ») · Rapport lié : [2026-11-19-calzone-garniture-paiement-recap.md](2026-11-19-calzone-garniture-paiement-recap.md)

## 1. Demande

Remplacer les petits emojis du site par des icônes SVG cohérentes (« je veux les meilleurs ») : un seul jeu, `assets/js/icons.js`, avec le même balisage partout.

## 2. Contrôle du journal du workflow

- **Statut** : `completed`. **Groupes** : 7 sur 7 terminés, 0 échec, 0 nouvelle tentative. Durée : 537 s. 7 agents, 174 appels d’outils.
- **Groupes et bilans rendus par les agents** :

| Groupe | Fichiers | Remplacés | Points signalés par l’agent | Suite |
|---|---|---|---|---|
| cart.js | `assets/js/cart.js` | 41 (5 retirés des textes copiés) | Toast HTML, statuts en `innerHTML`, libellés de paiement | Vérifié (section 3) |
| Commande et compte | `commande.js`, `compte.html` | 12 + 3 | `cash_change_for` non échappé dans `paymentLabel` | Corrigé dans la mission calzone |
| Accueil | `index.html` | 22 | `↺` (U+21BA) absent de la table, laissé en l’état | Décision (section 5) |
| Carte | `menu.html`, `composer.html`, `vegetarien.html` | 9 + 2 + 3 | Doublon d’appareil photo sur « Part de Tarte au Daim » ; taille de l’icône du lien « Végétarien » | Doublon confirmé au navigateur (décision) ; taille mesurée : 24 px, identique aux autres liens, point clos |
| Avis, FAQ, etc. | `avis`, `faq`, `concours`, `reseaux`, `main.js` | 24 | Étoiles ★ conservées (caractère typographique) | Vérifié (section 3) |
| Grand tirage | `grand-tirage.html`, `tirage.css` | 22 + 1 | Icônes en trait monochrome, rendu à vérifier ; fond SVG de l’easter egg | Rendu non vérifié (décision) |
| Tirage JS | `tirage/main.js`, `tirage/reveal.js`, `tirage/data.js` | 12 + 6 ; `data.js` non modifié | Valeurs de données `🍕🍕`, `🍰` conservées (règle 6) | Décision (section 5) |

## 3. Vérifications indépendantes

### 3.1 Scan global (44 fichiers HTML, JS, CSS du site)
- **Pictogrammes restants** : 7 candidats, tous justifiés ou à décider :
  - `assets/js/commercant.js` (maquette interne du commerçant, hors périmètre) : `➜` (U+279C), `⌂` (U+2302), `⌫` (U+232B) ;
  - `assets/js/tirage/data.js` : `🍕🍕` et `🍰` (valeurs de données, non affichées) ;
  - `index.html` : `↺` (U+21BA).
- **Icônes en ligne** : 143 contrôlées ; 142 reprennent exactement un tracé de `icons.js`. Le 143ᵉ est un faux positif (le code de la fonction `svg()` lui-même).
- **Noms d’icônes appelés** : 0 nom inconnu.

### 3.2 Intégrité du texte (diff normalisé, icônes et emojis retirés, contre la sauvegarde pré-emoji ou la version git de référence)

| Fichier | Lignes résiduelles | Verdict | Commentaire |
|---|---|---|---|
| `avis.html`, `faq.html`, `concours.html`, `reseaux.html` | 0 | PASS | Seules les icônes ont changé |
| `index.html` | 0 | PASS | Idem |
| `grand-tirage.html` | 0 | PASS | Idem |
| `assets/js/main.js` | 2 | PASS | Une légende de carrousel |
| `assets/js/tirage/reveal.js` | 26 | PASS | `decorHtml` et `prizeIconHtml` (voulus) |
| `assets/css/tirage.css` | 8 | PASS | Pseudo-élément de l’easter egg en fond SVG (voulu) |
| `assets/js/tirage/data.js` | 0 | PASS | Non modifié |
| `assets/js/cart.js` | 393 | PASS | Toutes les différences classées : modifications de la mission calzone ou artefacts de normalisation ; aucun mot perdu |
| `menu.html` | 104 | FLAG | Ajouts non listés : lien « Mon compte » et `account.js` (fonctionnalité compte), `disponibilite.css` et `.js` (autre chantier). Deux affirmations de la bannière à faire valider (voir `2026-11-19-calzone-garniture-paiement-recap.md`) |
| `composer.html`, `vegetarien.html`, `supplements.html` | 92 chacun | FLAG | Seuls `account.js` et le lien « Mon compte » sont à confirmer (fonctionnalité compte) |
| `404.html`, `mentions-legales.html` | 3 chacun | FLAG | Idem |
| `assets/js/tirage/main.js` | 31 | FLAG | Deux textes de partage ont perdu leur emoji (règle 4 : texte copié, sans icône : voulu). L’annonce « Merci d’avoir vécu le Grand Tirage jusqu’au bout. » a perdu son 🍕 sans icône : décision |
| `commande.js`, `compte.html` | — | Non comparés | Pas de sauvegarde ; contrôle par lecture seulement |

**Lecture** : aucun mot n’a été perdu ni modifié par le remplacement. Les FLAG portent sur des ajouts de fonctionnalités d’autres chantiers, à classer, et sur deux emojis retirés sans icône.

### 3.3 Contrôle au navigateur
- Carte (`menu.html`) : doublon d’appareil photo confirmé sur « Part de Tarte au Daim » (la vignette et le texte « Shooting en cours » en ont chacun une) ; liens de la barre de navigation : 24 px, identique pour les neuf liens.
- Non vérifié au navigateur : grand tirage (icônes monochromes), pieds de page des autres pages, `commande.js` et `compte.html`.

## 4. Verdict

- **Remplacement** : conforme. Aucun pictogramme ne reste dans les pages publiques, hors cas listés à la section 5.
- **Texte** : aucun mot perdu ou modifié par le remplacement.
- **Décisions** : 6 points à trancher (section 5).

## 5. Décisions à prendre

1. **Doublon d’appareil photo** (`menu.html`, « Part de Tarte au Daim ») : supprimer l’icône de la vignette ou celle du texte « Shooting en cours » ?
2. **Annonce du tirage** : remettre une icône pizza dans « Merci d’avoir vécu le Grand Tirage jusqu’au bout. » ?
3. **Textes de partage du tirage** : garder sans emoji (règle 4, défaut actuel) ou ajouter un emoji ?
4. **`↺` dans `index.html`** (« toucher le chiffre pour revivre l’instant ») : garder le caractère ou utiliser l’icône `repeat` du jeu commun ?
5. **`assets/js/tirage/data.js`** (`🍕🍕`, `🍰`, valeurs non affichées) : les supprimer ou les garder ?
6. **Maquette `commercant.js`** (`➜`, `⌂`, `⌫`) : à remplacer au branchement de la page commerçant ?

Vérification au navigateur à faire : grand tirage (icônes monochromes), pieds de page des pages secondaires.
