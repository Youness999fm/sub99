# E2E — Disponibilité des pizzas côté client (reprise du site, étape 1)

Mission : [reports/2026-11-19-reprise-site-disponibilite.md](2026-11-19-reprise-site-disponibilite.md).
Outil : navigateur intégré. Session d'origine : serveur d'aperçu « sub99 » sur http://localhost:8091/menu.html (port attribué par l'outil ; `.claude/launch.json` déclare 8090). Cette session : serveur propre sur http://localhost:8092/menu.html (le port 8090 était occupé).
Captures : examinées pendant la session (images renvoyées par l'outil navigateur), non enregistrées en fichiers.
Vocabulaire : « carte retirée » ou « pizza retirée » signifie ici que la pizza est marquée indisponible (bouton retiré, carte grisée) ; la carte reste affichée.

Limite de test : pendant qu'un script attend, le volet ne fait pas avancer les animations (horloge figée, pas de focus). Les essais de la version à délai de 8 s (E17, première partie de E22) ne mesurent donc pas le délai réel. La version actuelle n'a plus de délai (voir E22).

Facteur du bandeau : `calc((100cqi - 28px) * 0,12)`. Le facteur 0,13 n'a existé qu'au passage E14 (correction intermédiaire) ; avant, le bandeau avait une taille fixe de 2 rem (E12 et E13). Le passage E18 et les suivants utilisent 0,12 (voir E18).

## Passage 1 — source vide (état livré), volet par défaut (465 px)

| Étape | Action | Résultat | Audit |
|---|---|---|---|
| E1 | Chargement de menu.html | 30 cartes pizza avec leur bouton, 0 carte grisée, fiche Calzone inchangée. Trois fichiers de disponibilité chargés en 200. | Technique : aucune erreur console (seuls les messages existants d'intro-fx). |

## Passage 2 — source de test T1 : « Végétarienne » et « Bolognaise » listées, ingrédient « jambon »

| Étape | Action | Résultat | Audit |
|---|---|---|---|
| E2 | Chargement, volet par défaut (465 px) | 8 cartes retirées : Végétarienne, 3 Jambons, 4 Saisons, Régina, L'Extravagante, Milano, Pollame, Suisse. Chacune : 0 bouton, 1 bandeau (version à pansement à ce moment-là). Les 8 pizzas retirées ne sont plus proposées en deuxième moitié (21 parfums restants = 29 − 8). Mot « rupture » absent. | Un avertissement attendu, pour « Bolognaise » (pas une pizza). |
| E3 | 375 px : clic réel sur la taille « Solo » de la Calzone | Garnitures : Thon, Kebab, Viande hachée, Poulet. Jambon absent. « Ajouter » inactif sans garniture. | UX : OK. |
| E4 | Clic réel sur « Poulet », puis sur « Ajouter telle quelle — 11,00 € » | Panier : 1 ligne « Calzone (soufflée) — Poulet », taille Solo, quantité 1. | Régression : OK. |
| E5 | 375 px, carte grisée | Pas de débordement (375 pour 375). | UI : OK. |
| E6 | 1280 px | 4 colonnes. Pas de débordement (1265 pour 1280). | UI : OK. |

## Passage 3 — T2 : toutes les garnitures de la Calzone indisponibles

Source T2 : « jambon », « thon », « kebab », « viande hachée », « poulet » (les cinq garnitures de la Calzone), listées en ingrédients.

| Étape | Action | Résultat | Audit |
|---|---|---|---|
| E7 | Chargement, 1280 px | 19 cartes retirées, dont la Calzone. 11 parfums restants (29 − 18). Aucune fuite. | Technique et UI : OK. |

## Passage 4 — pannes (filet à 4 s, version à pansement)

| Étape | Action | Résultat | Audit |
|---|---|---|---|
| E8 | Fichier JSON invalide (virgule vide) | Avertissement « Disponibilité non lue (…) : aucune pizza n'est retirée. » 30 widgets visibles. Aucune exception. | Décision de l'utilisateur : commandables (appliquée, voir E25). |
| E9 | Classe dispo-pret retirée à la main | Cachés pendant l'attente, visibles après 4 s. | Technique : OK (version à 4 s, remplacée depuis, voir E17 et E22). |

## Passage 5 — pastille rouge (version intermédiaire, avant le bandeau)

| Étape | Action | Résultat | Audit |
|---|---|---|---|
| E10 | 375 px, Végétarienne et Subito retirées | Pastille Caveat en bas à gauche de la photo, pansement en haut à droite. Badge « Notre signature » masqué sur Subito. | UI : OK. |
| E11 | 1280 px | Pastille sur une ligne dans des cartes de 228 px. | UI : OK. |

## Passage 6 — bandeau rouge, sans pansement

| Étape | Action | Résultat | Audit |
|---|---|---|---|
| E12 | 375 px, source « Végétarienne, Subito » + « jambon » | 9 cartes retirées. Bandeau de 335 × 56 px, texte à 32 px, centré dans la photo (126 sur 252 px). Aucun svg dans les cartes retirées. Pas de débordement (375 pour 375). | UI : OK. Capture examinée. |
| E13 | 1280 px, même source | Bandeau sur deux lignes : 228 × 89 px, plus de la moitié de la photo. Jugé trop lourd. | UI : à corriger. |
| E14 | Correction : taille liée à la largeur de la carte (unités cqi, repli 2rem), **facteur 0,13 à ce moment**. 1280 px, source « Regina, L’Extravagante (apostrophe typographique), Calzone » + ingrédient « Oeuf » | 6 cartes retirées : Calzone (soufflée), Régina, Kefta, L'Extravagante, Orientale, Subito. 0 widget, 0 bouton sur les retirées. 24 parfums restants (29 − 5), aucune fuite. Bandeau de 26 px sur une ligne, 49 px de haut (carte de 228 px : texte à 94 % de la largeur utile). Mot « rupture » absent. Aucun nouvel avertissement. | Noms tolérants : OK. Facteur ensuite ramené à 0,12 (voir E18). |
| E15 | Liste écrite comme chaîne (« pizzasIndisponibles »: « Régina ») | Avertissement « doit être une liste entre crochets ». Rien retiré. 30 widgets visibles. | Technique : OK. |
| E16 | Retour à la source vide, 1280 px | 0 carte retirée. 30 widgets visibles. Fiche Calzone inchangée. Aucune erreur console. Panier de test vidé, volet remis en largeur bureau. | Contrôle final : OK. |
| E17 | Filet de sécurité, fin de l'animation forcée (version à délai de 8 s, **remplacée depuis**) | Cachés pendant l'attente, visibles une fois l'animation terminée. Délai de 8000 ms et « forwards » lus dans l'animation. Délai réel non observé. | Technique : OK pour cette version ; remplacée (voir E22 et le bilan). |

## Passage 7 — mesures finales du bandeau (facteur 0,12)

| Étape | Action | Résultat | Audit |
|---|---|---|---|
| E18 | Volet 1000 px (4 colonnes), source T1 (Végétarienne, Subito, jambon) | Carte de 224 px. Bandeau sur une ligne : police 23,5 px, hauteur 47 px. 9 cartes retirées. Pas de débordement (985 pour 1000). Largeur de texte mesurée : Caveat, 7,26 px par px de police ; 171 px utiles sur 196 (87 %). Passages intermédiaires : 940 px, 3 colonnes, carte 284 px, police 30,7 px, une ligne (54 px) ; 960 px, 3 colonnes, carte 291 px, police 31,5 px, une ligne (55 px). | UI : OK. Le texte tient sur une ligne avec 13 % de marge. |
| E19 | Téléphone 360 px, même source | Une colonne, carte de 320 px. Bandeau sur une ligne : police plafonnée à 32 px, hauteur 56 px. Pas de débordement (360 pour 360). Capture examinée. | UI : OK. |

## Passage 8 — contrôles de données et de filet, version actuelle

| Étape | Action | Résultat | Audit |
|---|---|---|---|
| E20 | Source en tableau (`[]`), 1280 px | Avertissement « le fichier doit être un objet { … }. Rien n'est retiré. » 0 carte retirée. 30 widgets visibles. | Technique : OK. |
| E21 | Clé mal orthographiée (`{ "pizzaIndisponibles": ["Régina"] }`), 1280 px | Avertissement « clé inconnue « pizzaIndisponibles » (ignorée) ». Régina reste disponible. 30 widgets visibles. | Technique : OK. |
| E22 | Filet de sécurité, version actuelle : pas de délai ; repli uniquement sur échec explicite (attribut `onerror` de menu.html), serveur de cette session (8092) | (a) Fonctionnement normal : 30 widgets visibles, aucune animation, 0 carte retirée, attribut `onerror` présent. (b) Script en attente de lecture (`dispo-pret` retiré) : widgets cachés, aucune animation, aucun délai. (c) Échec de chargement du script (élément de test pointant sur un fichier absent, avec le même `onerror`) : classe `dispo-echec` posée, widgets visibles ; état restauré ensuite. Le 404 de ce test vient du fichier volontairement absent. | Technique : OK. |
| E23 | Erreurs 404 relevées dans la session d'origine, reprise dans un nouvel onglet | Chargement de menu.html : aucune ressource en échec (entrées de chargement sans statut d'erreur). 67 références du même site (images, scripts, feuilles de style, favicon, manifeste) répondent 200 ou 206, aucune 404. Aucune 404 dans la console de cet onglet. Une seule 404 est connue dans les journaux réseau de la session d'origine : `/api/customer_me.php`, appelée par `compte.html` (API absente du projet). | Hors disponibilité : rien à corriger ici. Non corrigé. |
| E24 | Console, cette session | Un message « Blocked call to navigator.vibrate » et des messages [intro-fx] viennent d'un autre code du site. | Hors périmètre : non traité. |
| E25 | Erreurs de script, version avec écouteur d'erreurs de la fenêtre (menu.html, avant le script) | Chargement normal : 30 pizzas visibles, `dispo-echec` absente, aucune alerte. Avant chaque essai, `dispo-pret` retirée (script en attente). Erreur de syntaxe dans un script nommé `autre-script.js` (script de données) : aucun effet, boutons toujours masqués. Erreur de syntaxe dans un script dont le chemin contient `/assets/js/disponibilite.js` (script de données, le fichier livré n'est pas altéré) : `dispo-echec` posée, boutons visibles. Un script nommé `disponibilite.json` ne déclenche pas le repli (filtre resserré après la vérification de l'adversaire, testé). État restauré ensuite. | Technique : OK. Le navigateur fournit bien le nom du fichier fautif pour ce type d'erreur (message « Uncaught SyntaxError »). |

## Bilan

- Bloquants e2e sur les parcours du menu, version actuelle : 0.
- Constats de la revue finale par workflow : si la source met plus de 8 s à répondre, les boutons pizza redeviennent visibles avant la lecture, et une pizza indisponible peut être ajoutée au panier, qui la garde après le retrait. Confirmé par deux refuteurs, dont un par reproduction.
  - Première correction : une classe posée par le script (`dispo-en-cours`) et un repli de 8 s, armé seulement si le script n'a jamais démarré. Testée (E22 ancien). **Insuffisante** : l'adversaire a montré qu'un script arrivant après 8 s révèle les boutons avant de marquer les cartes (fenêtre cliquable, constat B1).
  - Correction actuelle : plus aucun délai. Le repli sans lecture de la source passe seulement par `onerror` (échec de chargement du script) ; les boutons se révèlent aussi après une lecture réussie (`dispo-pret`). Testée en E22.
- Décisions de l'utilisateur, appliquées : fichier ou script de disponibilité absent, illisible ou en erreur, erreur de syntaxe comprise : pizzas commandables (E25).
- Non résolu, à trancher par l'utilisateur (non traité ici) :
  - source qui ne répond jamais : les boutons restent masqués, sans délai ni message (constat B2) ; une erreur HTTP, elle, les affiche sans retrait ;
  - règle de correspondance des ingrédients (D4) et panier déjà rempli (D5).
- Corrections faites pendant la session : libellé de l'avertissement (« Bolognaise ») ; bandeau trop haut sur bureau (E13 → E14, puis facteur ramené à 0,12, E18) ; noms tolérants (contestation adverse, passe 1) ; avertissement pour une liste mal écrite ; avertissements pour une racine qui n'est pas un objet et pour une clé inconnue (E20, E21) ; filet de sécurité remplacé, puis revu après la contestation (E22).
- À arbitrer, non bloquant : la pizza indisponible (carte grisée) affiche toujours la liste complète de ses ingrédients, ingrédient indisponible compris. C'est la fiche de la recette, pas une commande.
