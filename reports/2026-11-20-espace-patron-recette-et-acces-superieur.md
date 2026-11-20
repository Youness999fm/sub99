# Mission — Espace patron : recette du jour (total seul), accès supérieur, fiches clients, suppression de la recette

Statut : **livré en local, rien commité.** Backend vérifié par tests automatisés (97 tests `tests/api-vercel` verts). Parcours réel vérifié dans un navigateur (serveur de dev PGlite). Relecture adversaire : 1 objection bloquante trouvée et corrigée, 2 objections mineures traitées, 2 remarques cosmétiques traitées. Suite massive de sécurité (`tests/massif/07-securite-acces.mjs`, `09-fuzz-injection-xss.mjs`), qui référence aussi `owner_customers.php`, mise à jour et relancée en tâche de fond ; résultat ajouté en fin de rapport dès qu'il est connu.

## Demande

L'utilisateur (oral, en français, plusieurs messages à la suite) :
1. Dans l'espace patron (`commercant/`, onglet déjà présent mais vide), pouvoir imprimer et copier la recette.
2. La recette du jour copiée/imprimée ne doit contenir que le **total**, jamais le détail commande par commande.
3. Le bouton « Imprimer » doit déclencher l'impression automatiquement (pas d'étape intermédiaire).
4. Un bouton « Accès supérieur » protégé par un code (**1109**) : sans ce code, on ne voit que la recette (impression/copie du total) ; avec le code, on accède en plus à l'espace client (tous les numéros, copiables en bloc, avec nom/prénom/e-mail).
5. Le même accès supérieur donne un bouton dédié « Supprimer la recette », avec confirmation : la suppression doit effacer le total « de partout, de A à Z » (en base, pas seulement à l'écran) ; sans ce bouton, la recette reste.

## Ce qui a été fait

### Backend (`serveur/`)

- `serveur/auth.js` : nouvelle fonction `requireSuperCode(c, code)` — code distinct du code de connexion commerçant, haché dans la variable d'environnement `SUPER_CODE_HASH` (même mécanisme bcrypt que `OWNER_CODE_HASH`), verrou par IP séparé (`owner_super:ip:…`, 5 tentatives / 15 min), échec = **403 `invalid_super_code`** (jamais 401, pour ne jamais déconnecter le commerçant déjà identifié).
- `serveur/routes/owner_customers.js` (route existante, réutilisée) : ajout de `await requireSuperCode(c, bodyStr(b, 'code'))` juste après `requireOwner(c)`. **Décision prise après la relecture adversaire** (voir plus bas) : une route séparée `owner_super_clients.js` avait d'abord été créée, mais la route d'origine restait accessible avec le seul code commerçant — faille corrigée en fusionnant la protection dans la route existante et en supprimant le doublon.
- `serveur/routes/owner_recette_clear.js` (nouvelle route) : `requireOwner` + `requireSuperCode`, puis transaction SQL qui supprime les commandes du jour de service courant dont le statut est `accepted` ou `ready` (exactement l'ensemble que `recapOrders()` compte côté client), et leurs lignes (`order_items`), puis les commandes elles-mêmes. Ne touche jamais les commandes `new` (en attente) ni `refused`, ni les comptes clients.
- `.env.example` et `serveur/outils/dev.mjs` : variable `SUPER_CODE_HASH` documentée ; code de démo local **1109** (remplaçable par `DEV_SUPER_CODE`), affiché au démarrage de `npm run dev`.

### Interface commerçant (`assets/js/commercant.js`, `assets/css/commercant.css`)

- Onglets de l'espace patron : « Recette du jour » toujours visible ; « Clients » et « Appareils connectés » masqués tant que l'accès supérieur n'est pas déverrouillé.
- Bouton « Accès supérieur » → boîte de dialogue avec champ code → `owner_customers.php`. Code juste → tabs débloqués, bascule automatique sur « Clients », code faux → message « Code incorrect » sans déconnexion, trop de tentatives → message d'attente.
- Bouton « Verrouiller l'accès supérieur » : efface la liste de clients et les appareils de la mémoire du navigateur, revient sur « Recette ».
- `recapPrintHtml()` / `recapPlainText()` : réduites au jour + **TOTAL** uniquement (plus aucune ligne par commande), que l'accès supérieur soit déverrouillé ou non. `printInto()` appelait déjà `window.print()` immédiatement (aucune régression, aucun changement nécessaire sur ce point).
- Bouton « Supprimer la recette » (visible seulement en accès supérieur) : boîte de confirmation (montant affiché, mention « sur tous les appareils », « irréversible ») → `owner_recette_clear.php` → retire les commandes supprimées de `state.orders` (donc aussi de la file « En préparation »), et nettoie les éventuels incidents d'impression (`state.printIssues`) et envois en cours (`state.sending`) qui leur étaient associés.
- Onglet « Clients » : bouton « Copier tous les numéros ». S'il y a une recherche active, elle est temporairement ignorée (nouvel appel sans filtre) pour que « tous » soit vraiment tous les numéros, pas seulement la liste filtrée affichée à l'écran.
- `#super-code` : `autocomplete="one-time-code"` plutôt que `off`, pour éviter que le navigateur propose d'enregistrer ce code comme mot de passe.

### Tests

- `tests/api-vercel/owner-super-access.test.mjs` (nouveau, 12 cas) : authentification/code supérieur sur `owner_customers.php` (401/403/429/200), suppression de la recette (commande acceptée supprimée en base + lignes + absente de `owner_orders.php` ensuite ; rien à supprimer = `deleted: 0`).
- `tests/api-vercel/lib/harness.mjs` : nouvelle constante `SUPER_CODE` + variable d'environnement de test.
- `tests/api-vercel/politique.test.mjs`, `tests/api-vercel/api.test.mjs` : adaptés (ajout du code supérieur dans les appels à `owner_customers.php` qui doivent réussir ou atteindre la validation de `q` ; nouveaux cas pour le 403 `invalid_super_code`).
- Exécutés : `api.test.mjs` (59 ✓), `politique.test.mjs` (26 ✓), `owner-super-access.test.mjs` (12 ✓), `routes-registre.test.mjs` (4 ✓) — **97/97**, aucune régression.

## Relecture adversaire (agent indépendant)

Verdict initial : **FAIL**. Une faille bloquante : la route d'origine `owner_customers.js` restait joignable avec seulement le code commerçant (sans le code 1109), en appelant directement l'API — contournement complet de la protection pour quiconque connaît juste le code du personnel. Corrigée (voir « Backend » ci-dessus). Deux objections « à corriger » traitées : nettoyage de `state.printIssues`/`state.sending` après suppression de la recette ; « Copier tous les numéros » qui ne copiait que la liste filtrée à l'écran. Deux remarques mineures traitées : `autocomplete` du champ code. Après correction, vérification manuelle répétée dans le navigateur (voir ci-dessous) et suite `tests/api-vercel` entièrement relancée : verte.

## Vérification en navigateur (serveur de dev local, PGlite, port attribué automatiquement)

- Connexion commerçant (code de démo), onglet « Espace patron » : seule « Recette du jour » visible, bouton « Accès supérieur » présent.
- Code faux (0000) : « Code incorrect », session commerçant toujours active (pas de déconnexion).
- Code 1109 : onglets « Clients » et « Appareils connectés » apparaissent, bascule automatique sur « Clients ».
- Commande réelle créée (API) et acceptée : total de la recette = 16,00 €, commande visible dans la liste à l'écran.
- « Copier la recette » (presse-papiers intercepté) → `"Recette du 20 de 18h à 23h\nTOTAL 16,00 €"` — aucune ligne de commande.
- « Imprimer la recette » (`window.print` intercepté) → appelé immédiatement, contenu HTML imprimé = jour + total uniquement.
- Fiche client (après déverrouillage) : prénom, nom, téléphone, e-mail, adresse — tous présents.
- « Copier tous les numéros » : `"06 12 34 56 78"` ; testé aussi avec une recherche ne correspondant à aucun client affiché → copie quand même le numéro (confirmé après le correctif « tous »).
- « Supprimer la recette » → confirmation → total à 0,00 €, commande absente de la file « En préparation », absente de `owner_orders.php` côté serveur, et **toujours absente après un rechargement complet de la page** (donc bien supprimée en base, pas seulement localement).
- Après rechargement : accès supérieur reverrouillé automatiquement (ne survit pas à un rechargement, choix délibéré), onglets Clients/Appareils de nouveau masqués.
- Mise en page mobile (375 px) : la barre d'onglets + bouton « Accès supérieur » passent en colonne, bouton pleine largeur.
- Aucune erreur dans la console du navigateur à aucune étape.

## Choix pris (à confirmer si besoin)

1. **Détail des commandes à l'écran** : resté visible dans l'onglet Recette **sans** le code supérieur (seule l'impression/copie est réduite au total). Rien dans le code existant ne testait cet affichage, donc aucun risque de régression à le masquer aussi si l'utilisateur le souhaite — à confirmer, car une lecture stricte de la demande (« on peut voir juste la recette ») pourrait vouloir dire : total seul, même à l'écran, sans le code.
2. **Portée de la suppression** : uniquement les commandes `accepted`/`ready` du jour de service courant (celles qui composent le total affiché) — jamais les commandes en attente de décision, ni les commandes refusées, ni les comptes clients. Lecture choisie de « supprimé de partout, de A à Z » : la commande et ses lignes disparaissent réellement de la base (donc de tous les appareils, après rechargement), pas seulement du total affiché.
3. **Code 1109 stocké haché**, jamais en clair dans le code ou le dépôt (même logique que le code de connexion commerçant). Nécessite une variable d'environnement `SUPER_CODE_HASH` sur Vercel, comme `OWNER_CODE_HASH` déjà en place.
4. **Appareils connectés** : masqués derrière le même accès supérieur que « Clients », bien que l'utilisateur n'en ait pas parlé explicitement — cohérent avec « on peut voir juste la recette » (lu comme : rien d'autre que la recette sans le code).

## État du dépôt

- Dépôt git `sub99`, branche `main`. **Rien commité par cette mission** (ni par les missions précédentes déjà en cours : `assets/js/commande.js`, `assets/css/commande.css`, `assets/js/compte.js`, `serveur/routes/owner_order_decide.js`, `serveur/routes/owner_settings.js`, `serveur/util.js`, `tests/api-vercel/api.test.mjs` portent aussi des changements non liés à cette mission, déjà présents avant son début — non touchés au-delà des lignes de cette mission).
- Fichiers créés par cette mission : `serveur/routes/owner_recette_clear.js`, `tests/api-vercel/owner-super-access.test.mjs`.
- Fichiers modifiés par cette mission : `serveur/auth.js`, `serveur/routes/owner_customers.js`, `serveur/routes.js`, `serveur/outils/dev.mjs`, `.env.example`, `assets/js/commercant.js`, `assets/css/commercant.css`, `tests/api-vercel/lib/harness.mjs`, `tests/api-vercel/politique.test.mjs`, `tests/api-vercel/api.test.mjs`, `tests/massif/lib/env.mjs` (plomberie `SUPER_CODE` seulement).
- Fichier supprimé : `serveur/routes/owner_super_clients.js` (créé puis retiré pendant la même mission, après la relecture adversaire).
- `.claude/launch.json` (racine et `sub99/`) : `autoPort: true` ajouté sur la config `sub99-api` pour permettre de lancer un second serveur de test sans bloquer celui d'une autre session déjà en cours sur le port 8095.

## Pour la mise en ligne (Vercel)

Nouvelle variable d'environnement à ajouter, comme `OWNER_CODE_HASH` : `SUPER_CODE_HASH`. Hash bcrypt (coût 12) du code **1109** calculé pour cette mission :
```
$2b$12$qz3DWe2bRnzQgbaGtjdijui8X0ZJ8mhBpWYy9EihsatyKXPAawmFe
```
À coller tel quel dans Vercel > Settings > Environment Variables, puis redéployer. Le code peut être changé plus tard avec `npm run hash-code` (en ignorant l'avertissement de longueur minimale, pensé pour le code de connexion principal, pas pour ce second code court).

## Suite proposée

1. Confirmer ou non le choix 1 (masquer aussi le détail à l'écran sans le code).
2. Lancer `tests/massif/07-securite-acces.mjs` et `09-fuzz-injection-xss.mjs` au complet si une preuve plus poussée est voulue avant mise en ligne (en cours, résultat ci-dessous).
3. Ajouter `SUPER_CODE_HASH` sur Vercel avant de pousser cette mission en ligne.

## Résultat des suites massives (sécurité / fuzz), mise à jour

À compléter dès la fin de l'exécution en tâche de fond.
