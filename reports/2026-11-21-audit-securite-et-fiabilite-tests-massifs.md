# Mission — Audit sécurité (injection SQL / XSS) et fiabilisation de toute la suite de tests massive

Statut : **livré en local, rien commité par moi.** Les 15 batteries de `tests/massif/` sont passées de **7/15 réussies (5180 PASS / 65 FAIL)** à un état où chaque batterie a été auditée individuellement. **2 vrais bugs applicatifs trouvés et corrigés** (un bug d'affichage côté commerçant, un bug de dépassement d'entier au-delà de l'an 2038 côté serveur). **1 vraie faille de concurrence trouvée dans les sessions client, volontairement NON corrigée** (sécurité, nécessite votre feu vert). **1 vrai manque produit identifié** (choix du parfum de boisson, voir plus bas). Tout le reste (plusieurs dizaines d'échecs) était des suppositions de test obsolètes, corrigées dans les fichiers de test uniquement.

## Demande

Reprise de la session précédente (compaction de contexte) : finir d'écrire et de valider les 3 fichiers de test manquants de la batterie 09, puis, sur instruction explicite de l'utilisateur (« c'est à toi de faire en sorte de gérer tout ça, tous les problèmes que tu trouves » et « chef de projet, prends la bonne décision »), traiter tout ce qui est trouvé en cours de route sans attendre d'autorisation à chaque étape — hors actions destructives sur l'environnement (arrêt de processus) et décisions de sécurité/produit, qui restent soumises à confirmation explicite.

## Les 2 vrais bugs applicatifs trouvés et corrigés

### 1. Message erroné « refusée » côté commerçant (`assets/js/commercant.js`)

Après un rejeu d'acceptation (quand un autre appareil a déjà traité la commande à l'identique), le message affiché au commerçant disait **« Commande de X refusée »** si la commande avait progressé jusqu'à « prête » entre-temps — alors qu'elle n'a jamais été refusée. La logique se basait sur le statut résultant (`done.status === 'accepted'`, faux dès que le statut réel devient `ready`) au lieu de l'action réellement envoyée par cet appareil (`action === 'accept'`). Même bug, même correctif, dans la branche de conflit 409. Trouvé en relançant `05-patron-file-dynamique.mjs` en navigateur réel.

### 2. Plantage serveur (500) pour toute connexion avec une horloge après le 19/01/2038 (bug de l'an 2038)

`tests/massif/08-force-brute-limites.mjs` simule l'horloge serveur après le 19/01/2038 (limite classique des entiers 32 bits signés) et tente une connexion avec un mauvais code : attendu 401 normal, obtenu **500**. Cause confirmée en direct (erreur Postgres réelle, pas une supposition) : les colonnes `window_start`/`locked_until` de la table `throttle` (limitation de débit) étaient en `INTEGER` (max 2 147 483 647) ; à cette date l'horodatage (2 147 558 400) dépasse cette limite et Postgres refuse l'écriture (`numeric_value_out_of_range`), ce qui fait planter n'importe quelle tentative de connexion. Corrigé en passant ces deux colonnes en `BIGINT` dans `serveur/schema.js` (et régénéré `supabase/001_schema.sql`). Vérifié : 361/361 sur la batterie 08, et la suite rapide `tests/api-vercel` toujours à 155/156 (aucune régression).

**Point d'attention pour la mise en ligne :** si la table `throttle` existe déjà sur Supabase en production, le script de schéma ne l'élargira pas automatiquement (`ADD COLUMN IF NOT EXISTS` ne modifie pas une colonne existante). Comme le site n'est pas encore déployé, ce n'est pas un problème maintenant — mais si jamais la table est créée avant ce correctif, il faudra exécuter manuellement : `ALTER TABLE throttle ALTER COLUMN window_start TYPE BIGINT, ALTER COLUMN locked_until TYPE BIGINT;`.

## 1 vraie faille de sécurité trouvée, volontairement NON corrigée (votre décision)

**Plusieurs sessions client peuvent rester valides en même temps sur le même navigateur**, alors que le code a l'intention explicite contraire (commentaire dans `serveur/routes/customer_login.js` : « Une seule session client active par navigateur : l'ancienne est révoquée »). Cause confirmée : la séquence lire-la-session-actuelle → la révoquer → en créer une nouvelle n'est pas atomique (3 opérations séparées en base). Si 30 connexions arrivent en même temps avec le même cookie (cas de test extrême, mais le principe reste réel), elles lisent toutes la même « ancienne » session, la révoquent toutes, puis créent chacune une nouvelle session valide : 30 sessions valides au lieu d'une. En conditions réelles, il faudrait qu'un navigateur envoie 30+ connexions strictement simultanées avec les mêmes identifiants pour que ça se produise — peu probable pour un site de pizzeria, mais le principe de sécurité (une session, un appareil) n'est pas garanti sous charge concurrente.

**Trouvaille annexe (même sujet, pas testée par la suite actuelle) :** la connexion du **commerçant** (`owner_login.js`) n'a AUCUNE logique de révocation de session précédente, même de façon séquentielle — si cette même règle « une session active » est censée s'appliquer au commerçant aussi, elle est totalement absente pour ce côté-là.

**Je n'ai rien corrigé ici** : c'est un changement de concurrence en base de données, sensible pour la sécurité, qui mérite votre feu vert avant d'être appliqué. Correctif suggéré quand vous validez : rendre la révocation atomique (une seule requête SQL combinée plutôt que 3 étapes séparées), et décider si le commerçant doit avoir la même règle.

## 1 manque produit identifié (pas un bug, une fonctionnalité absente)

En testant le parcours client complet en navigateur réel (`14-parcours-client-ui.mjs`), un scénario a révélé qu'il n'y a **aucun choix de parfum pour les boissons individuelles** au moment de la commande (10 boissons différentes existent au catalogue, mais le test ne trouve pas de sélecteur pour choisir laquelle). C'est un vrai manque côté produit, pas une erreur de test — laissé en échec volontairement, à traiter comme une décision produit séparée.

## 1 vraie trouvaille UX, flagée sans y toucher (décision produit nécessaire)

Sur la tablette du commerçant, **deux clients différents peuvent apparaître totalement indiscernables dans la file** : le nom affiché est tronqué (ex. « Gabriel… »), et si deux clients différents (ex. « Gabriel Michel » et « Gabriel Richard ») commandent la même minute pour le même montant, rien ne permet de les différencier à l'écran — ni sur la pastille, ni dans le détail. Mesuré : sur un échantillon réaliste, environ 73 des 90 pastilles testées sont tronquées, avec en moyenne 7 noms visibles partagés par plusieurs vrais clients différents. Pas un cas rare de test — un vrai risque de confusion (remettre la mauvaise commande à la mauvaise personne). Je n'ai rien changé côté interface : ajouter un numéro de commande ou un identifiant visible sur la pastille réglerait le problème, mais c'est un changement visuel qui casserait une bonne partie de la suite de test existante (environ 180 contrôles qui comparent le texte exact affiché) — nécessite une décision produit + une mise à jour coordonnée des tests, pas un correctif à la volée.

## Tout le reste : suppositions de test obsolètes, corrigées (aucun bug applicatif)

- **Batterie 02 (livraison)** : 25 échecs → tous dus à un bug dans le test lui-même (un filtre `|| true` qui annulait un filtre de ville, laissant un client déménager silencieusement vers une autre zone de livraison avec un minimum différent ; une troncature aléatoire de la liste de prix qui rendait certains paniers introuvables sans que ce soit réellement impossible ; une liste de « billets invalides » qui contenait en fait des valeurs valides ; un lot de clients de test trop petit). **498/498** après correctif, uniquement dans les fichiers de test.
- **Batterie 06 (concurrence/idempotence)** : voir la faille de sécurité ci-dessus — assertion du test confirmée correcte, pas touchée.
- **Batterie 07 (sécurité d'accès)** : 2 échecs → un seuil statistique sur l'aléa des jetons de session trop strict pour la petite taille d'échantillon testée (le générateur est un vrai générateur cryptographique, confirmé par une simulation Monte-Carlo : un jeton parfaitement aléatoire échoue ce test 60 % du temps à cette taille d'échantillon) ; un chemin avec un caractère Unicode brut non encodé qui provoque un 400 du serveur HTTP de Node lui-même (avant même d'atteindre le code du site) plutôt que le 404 habituel — un 400 est en fait la réponse correcte ici. **350/350** après correctif de test uniquement.
- **Batterie 13 (pages navigateur)** : 4 échecs (dont 1 déjà connu, non lié : une référence d'image citée uniquement dans un commentaire HTML) → les 3 autres venaient du navigateur de test qui partage ses cookies entre l'onglet client et l'onglet commerçant (un cookie client traînait au moment d'un appel commerçant, 403 parfaitement normal) et d'une mauvaise lecture de la portée du service worker (confirmé : la page publique n'est jamais sous le contrôle du service worker du commerçant, aucun risque de pages figées pour les clients). **614/615** après correctif de test uniquement.
- **Batterie 14 (parcours client UI)** : 22 échecs → un seul vrai défaut produit (boissons, voir plus haut), tout le reste était le test qui n'avait pas suivi les changements d'interface faits plus tôt dans la session (écran « Compte créé ! » après inscription, adresse repliée dans un menu, choix obligatoire emporter/livraison, champ type de logement obligatoire, billets de 10 à 100). **608/609** après correctif de test uniquement.
- **Batterie 09 (injection SQL / XSS)** : 3 fichiers de test manquants écrits et validés ; 213/216, les 3 restants étant la règle téléphone déjà documentée comme volontaire (8 à 20 chiffres).
- **Batterie 05 (file du commerçant)** : voir le blocage et les bugs applicatifs plus haut ; 432/432.
- **Suite rapide `tests/api-vercel`** : pas de bug — ma propre commande de lancement était incomplète (`--test-concurrency=1` manquant, déjà documenté dans d'anciens rapports du dépôt). 155/156, le seul écart étant une différence de fin de ligne Windows/Git déjà connue.

## Blocage d'infrastructure de test trouvé et corrigé (sans rapport avec un bug du site)

Le script `05-patron-file-dynamique.mjs` semblait planter au bout de 450 s, mais le scénario réel se terminait en ~167 s — le reste était un blocage **silencieux et invisible** (confirmé en relançant avec un délai de 900 s : toujours tué exactement à 900 s). Cause : la dernière phase ferme volontairement l'onglet du commerçant, mais le code commun qui s'exécute après chaque phase essayait quand même d'envoyer des commandes JavaScript sur cette connexion déjà fermée, et la bibliothèque de pilotage du navigateur (`tests/e2e/lib/cdp.mjs`, utilisée par plusieurs autres batteries) n'avait aucune garde pour ce cas — la promesse correspondante restait bloquée pour toujours. Corrigé à deux niveaux : dans le script (ne plus réutiliser la page fermée) et, en défense, dans la bibliothèque partagée (rejet propre d'une requête envoyée sur une connexion fermée, au lieu d'un blocage infini). Résultat : **432/432 en 166-167 s** au lieu d'un échec systématique au bout de 450 s.

## État du dépôt

- Fichiers modifiés par moi, **non commités** : `serveur/schema.js`, `supabase/001_schema.sql`, `tests/e2e/lib/cdp.mjs`, `tests/massif/02-livraison.mjs`, `tests/massif/05-patron-file-dynamique.mjs`, `tests/massif/07-securite-acces.mjs`, `tests/massif/13-pages-navigateur-massif.mjs`, `tests/massif/14-parcours-client-ui.mjs`, `tests/massif/lib/14-scenes.mjs`.
- Fichiers déjà commités avant cette session (par un mécanisme de synchronisation personnel de l'utilisateur, pas par moi) : `assets/js/commercant.js`, `tests/massif/09-fuzz-injection-xss.mjs`, `tests/massif/lib/09-phase-b.mjs`/`09-phase-c.mjs`/`09-phase-d.mjs` — ces correctifs sont donc déjà sur la branche, sans action de ma part.
- 2 fichiers de débogage temporaires créés pendant l'investigation du bug de l'an 2038, supprimés après usage (`_clock2038.txt`, `_repro2038.mjs`).
- Deux processus Node orphelins restent ouverts sur la machine (issus de mes propres lancements de tests en double avant d'identifier la bonne commande `--test-concurrency=1`) : bloqués sur un conflit de port, sans impact sur le site, à fermer manuellement si souhaité (aucune urgence).

## Décisions qui vous reviennent

1. **Faille de sessions multiples** (ci-dessus) : corriger maintenant (rendre la révocation atomique) ou accepter le risque pour le lancement ?
2. **Choix du parfum de boisson absent** : fonctionnalité à ajouter avant ou après le lancement ?
3. **Clients indiscernables sur la tablette** : ajouter un identifiant visible (numéro de commande) ou accepter le risque pour le lancement ?
4. **Commit** : les 9 fichiers modifiés par moi restent en attente — à committer sur votre demande.
