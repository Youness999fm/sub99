# E2E — Calzone (garniture), moyens de paiement multiples, récapitulatif « Mon panier »

Date : 2026-11-19 · Mission : voir [2026-11-19-calzone-garniture-paiement-recap.md](2026-11-19-calzone-garniture-paiement-recap.md)

## Mission d'origine (formulation de l'utilisateur)

1. **Calzone** : pas de moitié-moitié, suppléments autorisés, garniture à choisir parmi jambon / thon / kebab / viande hachée / poulet, ingrédients retirables sauce tomate / fromage / jaune d’œuf.
2. **Récapitulatif** : le titre devient « Mon panier » ; le bouton « Copier » est retiré.
3. **Paiement** : plusieurs moyens cochables en même temps (par exemple espèces + carte ticket restaurant, 2 ou 3 choix) ; le bloc espèces (billet) apparaît dès qu'« Espèces » est coché.

## Environnement

- Serveur du dépôt : `http://localhost:8090` (configuration `sub99`), navigateur intégré.
- Panneau : 465 px (450 px utiles), densité 1,5 ; émulation mobile 375 × 812 pour la calzone.
- Panier de test : contenu d'origine sauvegardé avant les essais, puis restauré à l'identique (« Végétarienne ×4 Duo »).
- Captures : une capture par étape, prises pendant le test (elles ne sont pas enregistrées comme fichiers dans le dépôt).

## Itération 1 — parcours complet, avant correction

| Étape | Action réelle | Résultat |
|---|---|---|
| 1 | Ouverture de `menu.html` | Fiche « Calzone (soufflée) » avec « Garniture au choix : jambon, thon, kebab, viande hachée ou poulet » ✔ |
| 2 | Clic sur « Solo » | Bloc « Garniture au choix (obligatoire) » avec 5 choix ; « Ajouter telle quelle » désactivé ; aucune section moitié-moitié ✔ |
| 3 | Clic sur « Thon », puis « Ajouter telle quelle » | Bouton activé ; ligne « Calzone (soufflée) — Thon (Solo) » ✔ |
| 4 | Clic sur « Poulet », « Personnaliser », « Sans Sauce tomate », « Ajouter au panier » | « Sans » ne propose que sauce tomate, fromage, jaune d’œuf ; suppléments présents ; deuxième ligne « Calzone (soufflée) — Poulet », détail « Sans : Sauce tomate » ✔ |
| 5 | Ouverture du panier | Titre « Mon panier » ✔ ; aucun bouton « Copier » ✔ ; bouton « Envoyer à quelqu’un » absent car `navigator.share` est indisponible dans ce navigateur (rendu conditionnel, attendu) |
| 6 | Mode « Livraison », puis « Espèces » | Bloc « Moyens de paiement à la livraison » avec la phrase d’aide ; bloc billets (10/20/50/100 €, appoint exact) affiché ✔ |
| 7 | Clic sur « Carte Ticket Restaurant » | Les deux moyens sont actifs ; le bloc billets reste ✔ |
| 8 | Décochage d’« Espèces » | Bloc billets masqué ; « Carte Ticket Restaurant » toujours actif ✔ |
| 9 | Recochage, choix « 20 € », puis décochage et recochage | « 20 € » sélectionné ; après décochage/recochage, aucun billet sélectionné (remise à zéro) ✔ |
| 10 | « Commander en ligne » sans connexion | Redirection vers `compte.html?retour=…` ; `subito_pending_payment_method` = `["cash","ticket_card"]` (clé renommée ensuite `subito_pending_payment_methods`) ; panier conservé ✔ |
| 11 | Suivi de commande (réponse simulée côté page, API absente) | « Espèces (billet de 20 €) · Carte Ticket Restaurant » ; ligne, détail « Sans », frais et total corrects ✔ ; nom piégé affiché en texte, rien n’est exécuté ✔ |
| 12 | Non-régression pizzas | 29 pizzas gardent la moitié-moitié ; la liste des parfums ne contient pas la calzone ✔ |

**Verdict itération 1**
- **Technique** : aucune erreur JavaScript levée pendant le parcours (capteur `error` / `unhandledrejection` / `console.error`). Réseau : `supplements.html` en 200. Erreurs anciennes hors périmètre : `index.html` en `ERR_CONNECTION_REFUSED` (tests antérieurs) et appels `customer_me.php` / `order_status.php` en 404 (API pas encore construite, attendu).
- **UI** : **bloquant** — la garniture choisie s’affiche en rouge barré, le style réservé aux ingrédients retirés. Un client peut croire que son choix est retiré.
- **UX** : pas de friction supplémentaire relevée sur le parcours calzone ; bloc de paiement lisible.
- **Correction ciblée** : style dédié `pizza-widget__filler-btn` (pastille verte pleine, comme les moyens de paiement). Aucun autre élément modifié.

## Itération 2 — après correction

| Étape | Action réelle | Résultat |
|---|---|---|
| 13 | Clic sur « Solo », puis « Jambon » | Pastille active : fond vert plein, texte blanc, aucune barre ; « Ajouter telle quelle » activé ; indice masqué ✔ |
| 14 | Clic sur « Ajouter telle quelle » | Ligne « Calzone (soufflée) — Jambon » (Solo) ✔ |
| 15 | Mobile 375 × 812 | Garniture sur deux lignes, bouton d’ajout pleine largeur, aucun défilement horizontal (écart = 0) ✔ |
| 16 | Retour au bureau, relevé du capteur | Aucune erreur capturée sur le passage ✔ |

**Verdict itération 2 : PASS** (Technique, UI et UX).

## Itération 3 — code corrigé après la revue indépendante (2026-11-19)

Cause de ce tour : la revue (juge et adversaire) a rendu FAIL sur deux exigences du paiement (état de session périmé) et signalé un point bloquant sur la confirmation de commande, plus des points non bloquants (double envoi, prix d'un supplément après changement de taille, ancre, anciens paniers).

Environnement du tour : navigation réelle sur `menu.html`. Le fichier `assets/data/disponibilite.json`, édité par un autre chantier pendant le test (disponibilité des produits), contenait à certains moments `jambon` et deux pizzas indisponibles. La garniture affichée sans « Jambon » ce jour-là est donc le comportement attendu (une garniture indisponible disparaît du choix). Les étapes ci-dessous n'en dépendent pas.

| Étape | Action réelle ou contrôle | Résultat |
|---|---|---|
| 17 | Clic sur « Solo » | Garniture visible (Thon, Kebab, Viande hachée, Poulet), indice visible, « Ajouter telle quelle » désactivé, moitié-moitié masquée ✔ |
| 18 | Clic sur « Thon » | Ajout rapide activé, indice masqué ✔ |
| 19 | « Personnaliser » puis « + thon » (Solo) | Résumé « Prix : 12,50 € » ✔ |
| 20 | Clic sur « XXL » avec « + thon » coché | Supplément recalé à 4,00 € / ingrédient, résumé « Prix : 37,00 € », « + thon » toujours coché ✔ (correction P4) |
| 21 | « Ajouter au panier » | Ligne « Calzone (soufflée) — Thon », taille XXL, supplément « thon » enregistré à 4 € ✔ |
| 22 | Ouverture du panier | Titre « Mon panier » ✔ ; aucun bouton Copier ✔ |
| 23 | « Commander en ligne » à emporter (session et API simulées, sans jeton) | Une seule requête ; `mode: pickup`, `payment_methods: []` ✔ (correction P5) ; message d'erreur ; panier conservé ; bouton réactivé ✔ (correction P1) |
| 24 | Livraison, « Espèces », billet 20 €, **double-clic** sur « Commander en ligne » | Une seule requête (verrou) ✔ (correction P3) ; charge utile `payment_methods: ["cash"]`, `cash_change_for: 20` ✔ |
| 25 | Ancienne ligne « Calzone (soufflée) » sans garniture dans le panier, « Commander en ligne » | Message « Une de vos calzones n’a pas de garniture choisie… » ; aucune requête ✔ (correction P7) |
| 26 | Panier valide, API simulée renvoyant un jeton | Redirection vers `commande.html?token=TESTTOKEN42` ; panier vidé ✔ |
| 27 | Session de reprise périmée : `["ticket_card"]` et billet « 20 » restés en session, puis `menu.html?subito_resume=1` (sans connexion) | Redirection vers la connexion ; session après : `["ticket_card"]`, billet `null` ✔ (correction P2 : le billet n'est pas repris) |
| 28 | Reprise avec `["cash","ticket_card"]` et billet « 20 » | Session après : `["cash","ticket_card"]`, billet `"20"` ✔ (la reprise légitime fonctionne toujours) |
| 29 | Fonction de retour `withQuery` testée isolément (5 cas : avec ou sans `?`, avec ancre) | 5 / 5 ✔ (correction P6 ; la connexion réelle n'est pas faisable ici) |
| 30 | Styles calculés d'un panneau calzone ouvert | Section « Sans » (première visible) : pas de bordure, pas de marge ✔ ; « Suppléments » et « Autre demande » : séparateur pointillé normal ✔ (correction P9) |

**Verdict itération 3**
- **Technique** : aucune erreur JavaScript captée sur les étapes 17 à 26 (capteur `error`, `unhandledrejection`, `console.error`). Réseau : `supplements.html` en 200. Les 404 de `customer_me.php` et `order_status.php` restent attendus (API non construite).
- **UI** : rien à corriger sur le parcours calzone. Le double bandeau appareil photo de « Part de Tarte au Daim » est confirmé (décision à prendre, voir le rapport).
- **UX** : le message d'erreur d'envoi dit quoi faire (« merci d'appeler directement ») et le message de garniture dit précisément quoi corriger.

**Verdict itération 3 : PASS** (sur les points du parcours calzone, paiement et commande).

## Limites de vérification (honnêtes)

- L’envoi réel de la commande (`order_create.php`), la connexion client, la validation « billet obligatoire » après connexion et la restauration des moyens de paiement au retour de connexion ne sont pas testables de bout en bout : l’API PHP n’existe pas encore. Ils sont vérifiés ainsi : (a) par des doubles dans la page, session simulée et API simulée (étapes 23 à 26) ; (b) par une reprise réelle sans connexion (étapes 27 et 28) ; (c) par lecture de code pour le retour après une vraie connexion.
- Aucun identifiant n’a été saisi ; aucune session n’a été ouverte.
- L’état du navigateur de prévisualisation a été remis dans son état d’origine à la fin du test (panier et clés de session de test retirées).

## Nombre d’itérations

3. Tour 1 : un défaut bloquant d’interface (garniture barrée) corrigé. Tour 2 : validé. Tour 3 (après revue indépendante) : défauts de paiement, de confirmation et de prix corrigés, puis validé. Plafond de 5 non atteint.
