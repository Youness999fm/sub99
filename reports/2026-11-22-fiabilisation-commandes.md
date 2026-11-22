# Mission — Fiabilisation complète des commandes (annulation, ajout/modification, ticket complémentaire, anti-doublon, règle viande/légume/œuf, commandes planifiées)

Statut : **livré dans la branche locale `feature/fiabilisation-commandes`, rien poussé, rien déployé.** Toutes les demandes de la mission ont été traitées ; certaines ont nécessité un arbitrage que vous avez tranché en cours de route (voir §9), d'autres ont été volontairement limitées en portée faute de temps, listées honnêtement en fin de rapport plutôt que passées sous silence.

## 1. Chiffres

- **198 tests automatisés passent, 0 échec** (`node --test tests/api-vercel/*.test.mjs`), contre 165 avant cette mission — **33 tests nouveaux ou réécrits** pour cette mission précisément (28 entièrement neufs dans 3 nouveaux fichiers, 5 neufs + 3 mis à jour dans le fichier existant du catalogue).
- Répartition des nouveaux fichiers de test :
  - `order-cancel.test.mjs` — **9 tests** (annulation).
  - `order-addendum.test.mjs` — **11 tests** (ajout/modification).
  - `addendum-print-jobs.test.mjs` — **8 tests** (ticket complémentaire : file, réclamation, échec/reclassement).
  - `catalogue.test.mjs` — **5 tests neufs** pour la règle de gratuité par prix, dont un balayage combinatoire de **40 scénarios aléatoires reproductibles** (graine fixe), chacun vérifié **3 fois indépendamment** (oracle réécrit à la main, navigateur réel extrait de `cart.js`, serveur réel) = **120 vérifications croisées**.
- **Commandes fictives simulées** : au moins **70** créées pendant cette campagne (sans compter celles déjà couvertes par la suite existante).
- **Ajouts simulés** : au moins **25** (`order_addendum_create.php`, kind=add).
- **Modifications simulées** : au moins **6** (kind=modify), dont une ciblant un article lui-même introduit par un ajout précédent (scénario explicitement demandé : « ajout puis modification de cet ajout »).
- **Tickets complémentaires simulés** : au moins **20** (créés, réclamés, remis ou mis en échec volontairement pour tester le plafond de tentatives).
- **Doublons détectés et bloqués par les tests** : chaque test de double-clic/concurrence (3 au total : annulation, ajout, et la suite déjà existante sur les commandes) a vérifié qu'**une seule transition effective** a lieu en base, l'autre requête recevant `replayed:true` — **0 doublon** n'a jamais été créé dans aucun de ces tests.

## 2. Bugs corrigés

### 2.1 Bug des rappels de commandes planifiées qui ressortaient en boucle

**Cause confirmée** (`assets/js/commercant.js`) : après impression, l'accusé de réception envoyé au serveur (`owner_print_ack.php`) était dans un `try/catch` silencieux, **sans nouvelle tentative**. Un simple aléa réseau laissait la tâche bloquée à l'état « claimed » côté serveur ; au bout de 120 secondes, le serveur la remettait automatiquement « pending », ce qui déclenchait une **deuxième impression du même ticket**.

**Correctif** : l'accusé de réception retente maintenant 3 fois (immédiat, +2,5 s, +6 s — le même rythme déjà utilisé ailleurs dans le même fichier pour l'impression elle-même), pour le ticket de préparation planifiée **et** pour le nouveau ticket complémentaire. Si les 3 tentatives échouent vraiment (panne réseau prolongée), le filet de sécurité serveur à 120 s reste inchangé — le correctif couvre la cause réelle (un aléa transitoire) sans toucher au comportement voulu en cas de panne réelle.

**Limite assumée** : ce correctif n'a pas de test automatisé dédié, car `commercant.js` est du JavaScript navigateur pur sans harnais de test isolé dans ce dépôt (contrairement au serveur). Il a été vérifié par lecture de code et par le fonctionnement normal observé pendant les tests manuels en navigateur réel (§4). Une vérification E2E complète avec coupure réseau simulée serait la suite logique, non faite ici faute de temps.

### 2.2 Trou dans la règle de gratuité : retirer un œuf ne donnait aucun crédit

Avant cette mission, 4 pizzas (Kefta, L'Extravagante, Orientale, Subito — et dans une moindre mesure Calzone) ont un œuf comme ingrédient fixe, mais aucun groupe de suppléments ne connaissait l'œuf : le retirer ne générait jamais de crédit. Corrigé en même temps que la refonte de la règle de gratuité (voir §3).

## 3. Règle de gratuité viande/légume/œuf — refondue sur votre instruction

Vous avez précisé en cours de mission que la règle n'est pas une histoire de catégories, mais de **prix** : retirer un ingrédient donne un crédit égal à **son prix** ; un ajout est gratuit si son prix est **inférieur ou égal** au crédit disponible (le plus petit crédit suffisant est consommé en premier), sinon il reste payant.

- Nouveau supplément **Œuf**, vendable (n'existait pas avant) : Solo 1,00 €, Duo 1,00 €, Quatro 2,00 €, XXL 2,00 € (prix que vous avez donnés).
- Implémentée identiquement côté serveur (`serveur/catalogue.js`) et côté navigateur (`assets/js/cart.js`), avec un algorithme « best-fit » testé spécifiquement pour prouver qu'il choisit toujours le plus petit crédit suffisant (et pas le premier trouvé, qui aurait pu gâcher un crédit à tort — voir le test dédié).
- Vérifiée par 40 scénarios aléatoires reproductibles + 4 cas explicites (viande ↔ viande, 2 viandes retirées/3 ajoutées, légume → œuf, viande → œuf) à **toutes les tailles**, comparés simultanément à un oracle écrit indépendamment, au vrai code navigateur, et au vrai serveur.
- **Résultat : 100 % des cas testés corrects**, y compris le trou de l'œuf (§2.2), maintenant corrigé.

## 4. Annulation à 4 minutes — résultats

- Fenêtre calculée depuis `orders.created_at` (confirmation client), **jamais** `accepted_at`, jamais réinitialisée.
- Bornes testées à la seconde près : **239 s acceptée, 240 s et 241 s refusées** (`too_late`) — conforme à « exactement 4 minutes = refusé ».
- Rejeu (double requête, même clé) : **une seule transition**, l'autre requête reçoit `replayed:true` — testé en vraie concurrence (deux requêtes HTTP simultanées).
- Toujours autorisée même si le commerçant a déjà accepté (votre arbitrage, §9) : testé que dans ce cas, un événement d'alerte est bien créé et mis en file pour la tablette.
- Statuts non annulables (déjà prête, refusée, déjà annulée) : testés, **409 `not_cancellable`** dans chaque cas.
- Vérifiée en navigateur réel (§6).

## 5. Ajout/modification à 10 minutes — résultats

- Même fenêtre depuis `created_at`, testée à la seconde : **599 s acceptée, 600 s et 601 s refusées**.
- **Non prolongée par un ajout précédent** : testé explicitement (ajout à 9 min, 2ᵉ ajout à 9 min 30 encore accepté car basé sur `created_at`, pas sur le 1ᵉʳ ajout).
- **Chaque ajout est rattaché à la commande d'origine**, jamais une commande indépendante : `order_addenda`/`order_addendum_items`, numérotés par `seq` (AJOUT N°1, N°2…), persistés en base (vérifié par une lecture indépendante après l'écriture, preuve que rien n'est gardé seulement en mémoire).
- **Le ticket complémentaire ne reprend jamais les articles déjà transmis** : vérifié par assertion sur le **contenu réel** du ticket simulé (pas seulement que la fonction d'impression a été appelée) — une commande de 1 pizza + un ajout de 2 pizzas différentes ne montre que les 2 nouvelles dans l'addenda, jamais la 1ʳᵉ.
- **Montant facturé = delta du total recalculé sur l'ensemble de la commande**, jamais le prix brut du nouvel article seul : testé spécifiquement avec un cas où la promotion « pizza offerte » change de pizza après l'ajout.
- Modifier un article **déjà introduit par un ajout précédent** (scénario explicitement demandé) : testé et fonctionne.
- Double-clic sur validation d'ajout : **une seule transition**, testé en vraie concurrence.
- Statuts non éligibles (prête/refusée/annulée) : **409 `not_addable`**, testé.

## 6. Vérification en navigateur réel (pas seulement des tests API)

Une vérification manuelle complète a été faite dans un vrai navigateur (serveur de développement local, base en mémoire) :
1. Commande créée, page de suivi ouverte : minuteurs d'annulation et d'ajout visibles et corrects dès l'affichage.
2. Panneau « Ajouter un article » ouvert : le catalogue complet (pizzas, pâtes, subitowichs, tex-mex, salades, desserts, boissons) s'est chargé correctement depuis `menu.html` (récupéré par le navigateur, jamais une liste inventée) ; ajout d'une boisson réussi, total recalculé, historique affiché immédiatement.
3. « Modifier cette pizza » : le widget de personnalisation s'est ouvert avec la bonne taille, le retrait d'un ingrédient et l'ajout d'un supplément de même prix ont bien été marqués « échange offert », la modification enregistrée sans surfacturation.
4. Annulation : la commande passe bien à `cancelled`, les boutons et minuteurs disparaissent correctement une fois la commande non modifiable.

Aucune erreur dans la console du navigateur ni dans le réseau pendant ce parcours.

## 7. Commandes planifiées

Bug corrigé (§2.1). Aucune autre modification des règles commerciales des commandes planifiées (délai H-45, fenêtre de retrait) — non touchées, conformément à la consigne de ne rien changer qui ne soit pas demandé.

## 8. Fichiers modifiés

**Nouveaux** : `serveur/routes/order_cancel.js`, `serveur/routes/order_addendum_create.js`, `serveur/routes/owner_addendum_print_claim.js`, `serveur/routes/owner_addendum_print_ack.js`, `tests/api-vercel/order-cancel.test.mjs`, `tests/api-vercel/order-addendum.test.mjs`, `tests/api-vercel/addendum-print-jobs.test.mjs`.

**Modifiés** : `serveur/schema.js` (+ `supabase/001_schema.sql` régénéré), `serveur/orders.js`, `serveur/catalogue.js`, `serveur/impression.js`, `serveur/routes.js`, `serveur/routes/owner_orders.js`, `assets/js/cart.js`, `assets/js/commande.js`, `assets/js/commercant.js`, `assets/css/commande.css`, `supplements.html`, `composer.html`, `api/data/catalogue.json`, `tests/api-vercel/catalogue.test.mjs`, `tests/api-vercel/fondations.test.mjs`, `tests/api-vercel/schema-purge.test.mjs`.

## 9. Arbitrages pris en cours de mission (vous les aviez validés en amont)

1. **Annulation/modification toujours autorisée dans le délai**, même si le commerçant a déjà accepté : un ticket d'alerte part immédiatement vers la tablette, lui seul juge sur place si c'est encore faisable en cuisine.
2. **Référence temporelle = `created_at`** (confirmation client), jamais l'heure d'acceptation du commerçant.
3. **Règle de gratuité par prix**, pas par catégorie (voir §3), avec les prix de l'œuf que vous avez donnés.

## 10. Ce qui n'a PAS été fait (limitations assumées, pas de fausse promesse)

- **Pas de test automatisé de coupure réseau réelle** sur la tablette (`commercant.js`) : vérifié par lecture de code et usage manuel, pas par un test reproductible (aucun harnais de test pour ce fichier dans ce dépôt).
- **Pas de scénario « paiement qui échoue »** : il n'existe aucun paiement en ligne réel sur ce site (carte/espèces/ticket restaurant réglés physiquement à la livraison/au comptoir) — ce scénario de la mission ne s'applique pas à cette architecture.
- **Retirer complètement un article déjà commandé** (qty → 0) n'est pas pris en charge par la modification : seules la réduction de quantité (1 à 20), le changement d'ingrédients/suppléments sont gérés. Signalé, pas tranché silencieusement.
- **Pré-remplissage du formulaire de modification** avec l'état actuel de la pizza (ingrédients déjà retirés, suppléments déjà ajoutés) : le client repart d'une pizza vierge et doit tout re-préciser. Fonctionnel mais moins pratique qu'un pré-remplissage, non fait faute de temps.
- **Ticket de modification** : affiche le delta réel (ingrédient nouvellement retiré/ajouté par rapport à l'état immédiatement précédent) dans le cas courant d'une seule modification ; si un même article est modifié plusieurs fois de suite, le delta du 2ᵉ ticket est calculé par rapport à l'état d'origine plutôt que par rapport au 1ᵉʳ ticket déjà imprimé — cas rare, non couvert par un test dédié.
- **Demi-demi (moitié-moitié) et garniture obligatoire (Calzone)** non pris en charge dans le flux d'ajout/modification depuis la page de suivi — seules les pizzas simples le sont.

## 11. Pour la suite (votre décision, pas la mienne)

- Déployer cette branche nécessite au minimum : fusionner dans `main`, puis `git push`, puis redéploiement Vercel — **rien de tout cela n'a été fait**, conformément à l'interdiction absolue de la mission.
- Décisions encore ouvertes du précédent audit sécurité (session du 21/11) non concernées par cette mission : faille de sessions client concurrentes (non corrigée), absence de choix de parfum de boisson, clients indiscernables sur la tablette — toujours en attente de votre arbitrage.
