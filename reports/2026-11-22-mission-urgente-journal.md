# Journal de mission — Audit complet Subito Pizza (session de nuit, autonome)

Démarré 2026-11-22 nuit, pendant que le propriétaire dort. Mission reçue : audit complet en 16 sections
(annulation, ajout d'article, bases de pizza, suppléments, moitié-moitié, minuteur 10 min, modification
après envoi, tests de bout en bout, prix/promos, réception commerçant, charge 4000 commandes, SEO/Google).

**Règle d'or appliquée tout du long** : aucune commande réelle sur https://www.subito-pizza-heninbeaumont.fr/
(production), aucun test de charge en production, aucun déploiement non testé. Travail de reproduction/
correction fait dans l'environnement de test local (PGlite en mémoire) ou sur la branche
`feature/fiabilisation-commandes`. Seules les inspections en LECTURE SEULE (pages publiques, navigation
normale type client) touchent la production.

## Contexte important au démarrage de cette mission

Juste avant de recevoir ce brief, la mission précédente (fiabilisation complète des commandes — annulation
4 min, ajout/modif 10 min, anti-doublon, règle viande/légume/œuf, correctif impression planifiée) venait
d'être fusionnée et déployée. Un bug de production est apparu quasi immédiatement : une commande annulée/
une commande passée semblait échouer (« connexion interrompue » / « erreur interne ») alors qu'elle était
en réalité enregistrée. Cause : les nouvelles tables (`order_addenda`, `order_addendum_items`,
`addendum_print_jobs`) n'ont jamais été créées dans la vraie base Supabase de production (le schéma ne
s'applique jamais tout seul au déploiement d'un site Vercel — il faut l'appliquer manuellement en SQL).
Un premier correctif de tolérance avait déjà été posé (les LECTURES ne plantent plus), mais les ÉCRITURES
(annuler une commande déjà acceptée, ajouter/modifier) restaient cassées. C'est précisément le bug
d'annulation décrit en section 2 de ce nouveau brief (« erreur interne, réessayez dans un instant »).

## Ce qui a été fait cette nuit (tout testé, rien déployé sans vérification)

### 1. Bug d'annulation après confirmation (section 2 du brief) — CORRIGÉ ET VÉRIFIÉ
- **Reproduit** dans l'environnement de test (jamais sur une vraie commande) : table `order_addenda`
  supprimée volontairement, commande acceptée, puis annulation → échouait avant correctif.
- **Cause réelle identifiée** : `order_cancel.js` insérait l'alerte tablette (`order_addenda` +
  `addendum_print_jobs`) DANS LA MÊME TRANSACTION que le changement de statut de la commande. Si l'insertion
  de l'alerte échouait (table absente), TOUTE la transaction était annulée — y compris le changement de
  statut lui-même. Le client voyait « Erreur interne » alors que l'annulation n'avait jamais été enregistrée.
- **Corrigé** : le changement de statut de la commande est maintenant une opération indépendante, qui
  réussit toujours quel que soit le sort de l'alerte tablette (créée séparément, tolère l'absence de table).
  Même correctif appliqué à l'ajout/modification de commande (`order_addendum_create.js`), qui renvoie
  maintenant un message clair (503 « fonctionnalité pas encore disponible ») au lieu d'une erreur 500
  générique, tant que la migration SQL n'est pas appliquée.
- **Tests exécutés** : 4 nouveaux tests dans `tests/api-vercel/schema-resilience.test.mjs`, dont un qui
  reproduit EXACTEMENT l'incident réel puis prouve la correction. Suite complète : **202/202 tests passent**.
- **Déployé** : oui, fusionné dans `main` (pull request #3), vérifié que le site reste accessible après
  déploiement (page menu chargée sans erreur console).
- **Limite** : la fonctionnalité d'annulation/ajout ne sera RÉELLEMENT utilisable (plus seulement
  « ne plante plus ») qu'une fois le schéma SQL appliqué à la vraie base Supabase — voir action requise
  ci-dessous. Ce n'est techniquement pas en mon pouvoir (accès Supabase non fourni, et un garde-fou de
  sécurité de mon environnement bloque explicitement toute tentative d'y accéder moi-même sans autorisation
  nommément donnée pour Supabase).

### 2. Libellé du ticket « Canette Oasis pomme poire » (section 12 du brief) — CORRIGÉ ET VÉRIFIÉ
- **Constat** : le ticket affichait « Boisson Oasis Pomme Poire canette » (préfixe de catégorie générique),
  pas « Canette Oasis pomme poire » comme demandé.
- **Corrigé** : ajout d'un attribut `data-ticket-name="Canette Oasis pomme poire"` sur la fiche produit
  (menu.html), même mécanisme déjà utilisé pour la boisson voisine (Fanta, Oasis pomme cassis framboise).
  Catalogue régénéré (`api/data/catalogue.json`).
- **Tests exécutés** : 8 tests existants référençaient l'ancien nom et ont été mis à jour pour vérifier le
  nouveau (pas de triche — même règle de prix/disponibilité vérifiée, juste le nom qui change). 202/202 OK.
- **Déployé** : oui, dans la même pull request #3.
- **Non vérifié directement** : le rendu RÉEL sur un ticket imprimé (nécessiterait une vraie commande ou une
  vraie tablette avec imprimante — interdit par les règles de sécurité de cette mission). Vérifié uniquement
  au niveau données (le nom qui part vers order_items.name est le bon).

### 3. Action requise de votre part — appliquer le schéma SQL manquant à Supabase

**Je ne peux pas le faire moi-même** (ni avec les accès actuels, ni par un essai détourné — bloqué
explicitement par un garde-fou de sécurité qui exige une autorisation nommant spécifiquement Supabase comme
cible, ce qui n'a jamais été donné). Marche à suivre, identique à ce qui avait déjà été fait pour créer les
7 tables initiales de ce projet :
1. Ouvrez votre projet Supabase (`subito-henin-commandes`), SQL Editor.
2. Copiez-collez l'intégralité du fichier `supabase/001_schema.sql` (à la racine du dépôt `sub99`) et
   exécutez-le. Il est conçu pour être rejoué sans risque (chaque instruction est `IF NOT EXISTS` /
   `ADD COLUMN IF NOT EXISTS`) : ça ne touchera AUCUNE donnée existante, ça ajoute seulement ce qui manque.
3. Une fois fait, l'annulation d'une commande déjà acceptée créera réellement une alerte sur la tablette, et
   l'ajout/modification de commande fonctionnera (au lieu du message « pas encore disponible »).

### 4. Bug « Ajouter un article » (section 3 du brief) — NON REPRODUIT, vérifié en direct sur production

- **Test réel effectué** (lecture seule, navigation client normale, aucune commande envoyée) sur
  `https://www.subito-pizza-heninbeaumont.fr/menu.html` :
  1. Pizza Régina, taille Duo, clic « Ajouter telle quelle » → barre flottante « Mon panier · 1 / 16,00 € »
     affichée correctement, bouton « Commander » distinct présent. Aucune erreur console.
  2. Même pizza, clic « Personnaliser », retrait « jambon », ajout supplément « poulet » → résumé affiché
     EXACTEMENT : « Régina (Duo) — Sans : jambon — Suppléments : poulet (échange offert) — Prix : 16,00 € »
     → preuve que la règle de gratuité prix-based (viande retirée = viande ajoutée, même prix = gratuit)
     fonctionne réellement en production.
  3. Clic « Ajouter au panier » sur cette ligne personnalisée → panier mis à jour : « Mon panier · 2 /
     16,00 € ». Total à 16,00 € (pas 32,00 €) car la promo « 1 pizza achetée = 1 offerte » s'applique
     correctement aux 2 lignes Duo au même prix — comportement attendu, pas un bug.
- **Conclusion** : le bouton d'ajout au panier (avant envoi de la commande) fonctionne correctement, avec ou
  sans personnalisation, et la promo s'applique bien dès l'ajout. Je n'ai pas réussi à reproduire le bug
  décrit en section 3. Si le problème persiste côté utilisateur, il faudrait un cas précis (quel produit,
  quel appareil, quel message d'erreur exact) pour continuer l'investigation — sans repro, impossible d'aller
  plus loin sur ce point.

### 5. Minuteurs : réaffichage instantané au retour sur l'onglet (section 8 du brief) — fait, portée clarifiée

- **Décision déjà actée et testée** (mission précédente, validée par vous) : les deux minuteurs (annulation
  4 min, ajout/modif 10 min) sont ancrés sur `orders.created_at`, un horodatage ABSOLU côté serveur — jamais
  mis en pause, jamais prolongé. C'est volontaire : la cuisine continue de tourner même si le client a
  changé d'onglet, donc mettre le délai réel en pause n'aurait pas de sens métier et casserait une règle
  déjà validée.
- **Ce qui manquait réellement** : l'affichage à l'écran (pas le délai lui-même) pouvait rester figé un
  moment après un retour sur l'onglet, car les navigateurs ralentissent les `setInterval` en arrière-plan.
  Corrigé dans `assets/js/commande.js` : au retour de l'onglet (`visibilitychange`), le compte à rebours
  affiché est immédiatement recalculé à partir de l'horodatage serveur, sans attendre le prochain tic de
  l'intervalle ralenti.
- **Vérifié** : `node --check` sur le fichier modifié (pas d'erreur de syntaxe), suite complète 202/202
  toujours verte (changement JS côté client uniquement, aucune route serveur touchée).
- **Non déployé pour l'instant** : en attente du prochain lot à pousser ensemble (voir fin de journal).

### 6. Commandes programmées : boutons distincts « Voir » / « Imprimer » (section 12 du brief) — fait et vérifié visuellement

- **Avant** : une seule puce cliquable dans le bandeau des commandes programmées, qui se contentait de
  sélectionner la commande (aucune impression directe possible sans ouvrir la commande d'abord).
- **Après** (`assets/js/commercant.js`, fonction `renderScheduled()`, + nouveau CSS dans
  `assets/css/commercant.css`) : chaque commande programmée a maintenant deux zones cliquables distinctes
  dans la même puce — à gauche « Voir » (sélectionne la commande, comme avant), à droite un bouton
  imprimante dédié qui réimprime directement le ticket sans détour, réutilisant exactement la même logique
  d'impression que le bouton existant du panneau de décision (aucune nouvelle route, aucun nouveau code
  d'impression créé).
- **Vérifié visuellement** : serveur de prévisualisation lancé (`sub99-api`, base en mémoire), commande
  programmée réellement créée via l'API, rendu injecté et inspecté dans le navigateur — capture d'écran
  confirmant le rendu correct (puce dorée, séparateur vertical, icône imprimante, troncature propre des noms
  longs comme pour les autres puces). Aucune erreur dans la console.
- **Non testé** : je n'ai pas pu me connecter réellement à l'espace commerçant (code d'accès) pour vérifier
  le clic en conditions réelles de bout en bout — contrainte de sécurité qui m'interdit de saisir un code
  d'authentification, même un code de test local. Le rendu a donc été vérifié par injection directe du
  balisage produit par le code, pas par un vrai parcours connecté. À confirmer par vous (ou lors d'une
  session où la connexion pourra se faire autrement) avant de considérer ce point 100 % bouclé.
### 7. Section « Refusées / annulées » en haut avec compteurs (section 12 du brief) — fait et vérifié visuellement

- **Constat utile** : aucune modification serveur n'était nécessaire — `owner_orders.js` renvoyait déjà les
  commandes refusées/annulées du jour (`service_day` est fixé dès la création, quel que soit le statut
  final), elles n'étaient simplement affichées nulle part à part dans l'interface commerçant.
- **Fait** (`assets/js/commercant.js` : nouvelles `refusedOrCancelledOrders()` + `renderRefused()` ;
  `commercant/index.html` : nouvelle section tout en haut de la file, avant « À traiter » ; CSS dédié) : une
  section dédiée liste les commandes refusées (gris neutre) et annulées (rouge) du jour de service, avec un
  compteur dans le titre (ex. « Refusées / annulées (1 refusée · 2 annulées) »), masquée automatiquement s'il
  n'y en a aucune. Chaque puce ouvre le ticket en lecture (même dialogue que partout ailleurs), sans jamais
  les mélanger à la recette du jour (qui ne garde que les commandes honorées).
- **Vérifié** : `node --check` (syntaxe OK), capture d'écran du rendu réel dans le navigateur (balisage
  injecté, mêmes limites de vérification que pour les boutons Voir/Imprimer ci-dessus — pas de parcours
  connecté réel), aucune erreur console.
### 8. Suppression de commande avec corbeille/restauration (section 12 du brief) — fait, testé et vérifié visuellement

- **Fait** : nouvelle colonne `orders.deleted_at` (jamais un vrai `DELETE SQL` — la commande reste en base
  pour la preuve et la recette, seulement masquée). Trois nouvelles routes : `owner_order_delete.php`
  (réservé aux commandes terminées — prête, refusée ou annulée ; une commande encore « new »/« accepted »
  est explicitement protégée, 409 `not_deletable`, pour ne jamais faire disparaître par erreur une commande
  qui a encore besoin d'une action), `owner_order_restore.php`, `owner_trash.php` (liste). `owner_orders.php`
  exclut désormais les commandes à la corbeille de la file affichée, avec la même tolérance à l'absence de
  colonne (migration pas encore appliquée en prod) que partout ailleurs cette nuit.
- **UI** : un bouton corbeille sur chaque commande refusée/annulée (section du point 7 ci-dessus), et un
  bouton « 🗑 Corbeille » dans la barre du haut (toujours visible, même quand la section refusées/annulées
  est vide) qui ouvre un dialogue listant les commandes supprimées avec un bouton « Restaurer » par ligne.
- **Testé** : 5 nouveaux tests dédiés (`tests/api-vercel/owner-order-trash.test.mjs`) — refus de suppression
  sur une commande encore active, suppression + disparition de la file + présence dans la corbeille +
  restauration + réapparition dans la file, idempotence des deux routes, droits d'accès (un client ne peut
  appeler aucune des trois routes). Suite complète : **207/207 tests passent** (202 + 5 nouveaux).
- **Vérifié visuellement** : capture d'écran du rendu réel du dialogue (mêmes limites de vérification que les
  deux points précédents — balisage injecté, pas de parcours connecté réel faute d'accès autorisé au code).
- **Limite assumée, à trancher si besoin** : une commande « prête » mise à la corbeille sort aussi du calcul
  de la recette affichée dans l'espace patron (qui se base sur la même liste `owner_orders.php`). C'est
  cohérent avec l'idée de « ranger » une commande du jour, mais si vous voulez que la recette du jour reste
  inchangée même après mise à la corbeille, dites-le : ce serait un calcul séparé à ajouter, pas fait cette
  nuit.

### 9. Sélecteur de base (sauce tomate / crème fraîche / barbecue / curry) — section 4 du brief, fait et testé

- **Constat utile** (comme pour la section 12) : aucune nouvelle règle de prix serveur n'était nécessaire.
  Les 4 sauces étaient déjà dans le même groupe de suppléments ("Légumes et sauces"), au même prix à
  chaque taille — un changement de base est donc toujours gratuit par construction, prouvé par un nouveau
  test (`catalogue.test.mjs`) à chaque taille plutôt que supposé.
- **Fait** (`assets/js/cart.js`) : la fiche de personnalisation de chaque pizza détecte sa base actuelle et,
  si reconnue (sauce tomate ou crème fraîche, soit 28 des 29 pizzas du menu), affiche un sélecteur dédié
  « Base » avec les 4 choix, celui d'origine pré-sélectionné. Changer de base retire l'ancienne et ajoute
  la nouvelle automatiquement (gratuit), sans doublon avec les listes "Sans"/"Suppléments" existantes.
- **Un vrai bug trouvé et corrigé pendant le développement** : le nom poussé dans le panier doit être
  exactement celui du catalogue (pas une forme capitalisée plus lisible) — sinon un recalcul de prix
  interne pouvait supprimer silencieusement le changement de base si le client cliquait vite, avant la fin
  du chargement des prix. Reproduit puis corrigé, revérifié.
- **Carolina** : son ingrédient « Base barbecue » a été renommé « Sauce barbecue » (menu.html) pour
  participer au sélecteur — au passage, corrigé un vrai décalage préexistant côté commerçant (la clé de
  disponibilité ne correspondait pas non plus au supplément partagé, donc marquer la sauce barbecue en
  rupture de stock n'affectait jamais vraiment Carolina).
- **Indienne N'A PAS ce sélecteur**, décision assumée et non silencieuse : sa base est un ingrédient composé
  unique « crème fraîche ET curry », pas une sauce simple — la forcer dans un choix à une seule option
  changerait sa recette, ce que la mission demande justement d'éviter (« préserver la base d'origine »).
- **« Compose ta pizza » (composer.html) n'a pas été étendu** : ce flux utilise un mécanisme différent
  (`choice`, 2 options déjà) dont je n'ai pas vérifié en profondeur le comportement réel pour l'étendre
  à 4 options sans risque cette nuit — à reprendre si vous le souhaitez.
- **Vérifié visuellement** (clics réels sur un serveur de test, panier localStorage inspecté directement) :
  rendu correct, échange confirmé gratuit dans le résumé ET dans le contenu réel du panier. Suite complète
  **208/208 tests**.

### 10. Audit prix/promo/livraison ligne à ligne — section 11 du brief, fait

- **Comparé mot à mot** : le texte publicitaire (index.html, menu.html, faq.html — règle « 1 pizza achetée
  = 1 offerte », −50 % en livraison, frais de livraison par zone, montant minimum de commande, moyens de
  paiement acceptés) contre le calcul réel (`serveur/orders.js` `computeOrderTotals()`, validation de
  `order_create.js`) ET le calcul client (`assets/js/cart.js`).
- **Résultat : aucun écart trouvé.** La règle de promo (la moins chère de chaque paire offerte à l'emporter
  / à −50 % en livraison, uniquement les pizzas, cumulable sans limite), les frais de livraison (gratuits
  dès qu'une pizza est dans la commande), les montants minimums par zone, et les moyens de paiement
  acceptés correspondent exactement, des deux côtés, à ce qui est annoncé au client.
- **Rien à corriger sur ce point.**

### 11. Test de charge réel à 4000+ commandes — section 13 du brief, fait (jamais en production)

- **Découverte utile** : un harnais de charge complet existait déjà depuis la mission précédente
  (`tests/massif/12-charge-soutenue.mjs`) — simule une soirée complète (clients qui commandent, suivi
  client qui sonde, commerçant qui décide), puis une rafale de 1000 requêtes simultanées, avec des
  contrôles d'intégrité exhaustifs en base. Serveur + base de test tournent dans l'environnement isolé du
  script lui-même, **jamais contre la production** — aucune commande réelle, aucun paiement.
- **Lancé à l'échelle demandée** : 1340 clients simulés × 3 commandes = **4271 commandes réellement créées**
  (au-delà des 4000 demandés), plus la rafale de 1000 requêtes concurrentes. Durée totale : 300 s.
  **Mode réduit** (paramètres personnalisés pour atteindre ce volume) : les seuils de latence du script sont
  calibrés pour ses 200 clients par défaut, pas pour 1340 — les dépassements de latence ci-dessous doivent
  être lus avec cette réserve, pas comme un verdict de production.
- **Ce qui compte le plus a tenu — 100 % sur toute la ligne** : **zéro erreur 5xx** sur 42 962 requêtes HTTP,
  **zéro erreur réseau**, et surtout **zéro écart d'intégrité** sur ~20 contrôles différents : nombre de
  commandes en base = nombre de réponses 201 = nombre suivi par le test ; aucune commande fantôme ni perdue ;
  aucun doublon de clé d'idempotence ; aucune ligne d'article orpheline ; 10 envois simultanés de la même
  commande → une seule créée ; 10 inscriptions simultanées au même e-mail → un seul compte ; un client ne
  peut jamais lire la commande d'un autre (40 tentatives, 0 fuite) ; aucune donnée personnelle dans les
  journaux serveur. La base finale (4271 commandes, 12 383 lignes, 1371 clients) correspond exactement à ce
  que le test a envoyé et reçu, sans aucun écart.
- **Latences dégradées à cette échelle** (11 contrôles sur 79 en échec, tous de ce type ou liés) : p95 autour
  de 4,5 à 4,9 s sur `order_create`/`order_status`/`owner_order_decide` (seuils du script : 1,5 à 2 s),
  attendu sur un poste de développement unique faisant tourner serveur + test + base dans un seul processus
  sous 6 à 7 fois la charge par défaut du script — pas représentatif de la vraie production (fonctions
  Vercel séparées + vraie base Postgres réseau).
- **Une vraie découverte, indépendante de l'échelle choisie, à garder en tête** : la réponse de
  `owner_orders.php` (toutes les commandes du jour, lignes comprises) pèse 5,84 Mo pour 4271 commandes, soit
  environ 1434 octets par commande — **la limite de charge utile d'une fonction Vercel (4,5 Mo) serait
  atteinte vers 3289 commandes dans une même journée de service**. Peu probable pour ce restaurant au
  quotidien, mais à surveiller si le volume grossit significativement ; corrigible plus tard par une
  pagination ou un allègement de la réponse si besoin — non corrigé cette nuit, simplement signalé.
- **Un point non élucidé** : le tas JavaScript du processus de test reste à 270 Mo après nettoyage (seuil du
  script : 200 Mo). Probablement attribuable aux registres internes du script de test lui-même (qui garde
  la trace de 4271 commandes et 1371 clients pour ses propres vérifications), pas forcément une vraie fuite
  côté serveur — pas creusé plus loin cette nuit, à vérifier séparément si vous voulez en avoir le cœur net.
- **Rapport complet** (toutes les mesures route par route) : [reports/2026-11-22-test-charge-4271-commandes.log](2026-11-22-test-charge-4271-commandes.log).

### 12. Inventaire complet du catalogue — section 1 du brief, fait

- **Vérifié systématiquement, pour les 64 produits** (pizzas, pâtes, subitowichs, tex-mex, salades, desserts,
  boissons) : cohérence des noms d'ingrédients entre menu.html et les groupes de suppléments du catalogue ;
  cohérence entre les listes d'ingrédients de menu.html et celles de `commercant.js` (disponibilité) — c'est
  exactement le type de décalage trouvé sur Carolina plus tôt cette nuit, donc vérifié sur TOUS les produits
  cette fois ; tous les `data-ticket-name` ; tous les boutons/liens des pages client ; tous les prix affichés
  contre le catalogue.
- **Résultat : Carolina (déjà corrigée plus tôt) était la seule vraie incohérence fonctionnelle.** Aucun
  autre produit n'a de décalage de ce type. Deux broutilles cosmétiques trouvées et corrigées (4 attributs
  `data-ticket-name` redondants sans aucun effet ; un bouton sans `type="button"` explicite) — sans
  conséquence sur le comportement, corrigées par hygiène.
- **Aucun lien mort trouvé** sur l'ensemble des pages client.

### 13. Campagne combinatoire exhaustive — sections 5-7 du brief, fait

- **Constat de départ** : la RÈGLE de gratuité (viande/légume/œuf) était déjà testée en profondeur dans la
  mission précédente, mais sur quelques pizzas représentatives, pas sur CHAQUE pizza individuellement — un
  vrai décalage de données propre à une seule pizza (comme Carolina plus tôt cette nuit) pouvait donc
  échapper aux tests existants.
- **Fait** (nouveau fichier `tests/api-vercel/combinatoire-exhaustif.test.mjs`) : 6 tests, chacun exhaustif
  sur une dimension entière du catalogue plutôt que sur quelques cas choisis à la main :
  - les 30 pizzas réelles × les 4 tailles, commandées telles quelles (120 commandes vérifiées) ;
  - les 29 pizzas à base reconnue × les 3 autres bases (Duo) : toujours gratuit ;
  - les 30 pizzas × chacun de leurs propres ingrédients retiré seul : jamais de remise sans ajout en face ;
  - les 30 pizzas × un supplément de chacun des 3 groupes ajouté seul : toujours plein tarif ;
  - moitié-moitié : les 29 pizzas éligibles participent chacune, comme 1ère ET 2ème moitié, aux 3 tailles
    autorisées (jamais en Solo, jamais la calzone — vérifié explicitement dans les deux sens).
- **Résultat : aucun bug trouvé** au-delà de ce qui était déjà connu (Carolina). Suite complète : **214/214
  tests** (208 + 6 nouveaux, chacun itérant sur des dizaines de cas réels).
- **Ce qui reste hors de portée d'un test automatisé** : le rendu VISUEL réel de chaque combinaison dans le
  navigateur (rendu des puces, mise en page du résumé) n'a pas été vérifié pour chaque cas individuellement
  — seulement pour une poignée de cas représentatifs plus tôt cette nuit (voir section 9 plus haut). La
  mécanique de PRIX, elle, est désormais vérifiée exhaustivement.

### 14. Vérification des batteries de tests massifs existantes (section 10) — bugs réels trouvés et corrigés, limite honnête trouvée

- **Pourquoi** : `tests/massif/01-emporter.mjs` et `02-livraison.mjs` sont des batteries de bout en bout déjà
  existantes (centaines de commandes, comparaison à un calcul 100 % indépendant du code serveur) — exactement
  ce que demande la section 10. Je les ai relancées pour vérifier qu'elles tenaient toujours après tout ce qui
  a été changé cette nuit (et avant).
- **3 vrais bugs trouvés et corrigés dans les FIXTURES de test elles-mêmes** (pas dans le site) :
  1. `02-carte.mjs` (modèle indépendant de la livraison) n'avait que 2 groupes de suppléments en dur au lieu
     de 3 — le groupe « Œuf » (ajouté lors d'une mission précédente) n'y avait jamais été reporté, ce qui
     faisait planter le script dès le premier contrôle.
  2. Plusieurs fichiers référençaient encore l'ancien nom « Boisson Oasis Pomme Poire canette » (63 occurrences
     dans 8 fichiers) au lieu du nom de ligne actuel « Canette Oasis pomme poire » (changé par le correctif de
     ticket de tout à l'heure, mission précédente) — corrigé partout.
  3. **J'ai moi-même introduit un vrai bug par excès de prudence** : plus tôt cette nuit, j'avais retiré 4
     attributs `data-ticket-name` que je croyais sans effet (« Canette Tropico », « Maxi Coca », « Maxi Fanta »,
     « Maxi Tropico »), car leur valeur était identique au nom déjà affiché. En réalité, `tools/build-catalogue.mjs`
     traite différemment « pas d'attribut » (préfixe « Boisson » automatique) et « attribut présent, même valeur »
     (pas de préfixe) — retirer ces 4 attributs changeait donc réellement le nom de ligne utilisé pour la
     commande (ex. « Maxi Coca » → « Boisson Maxi Coca »). **Corrigé : les 4 attributs ont été remis**, catalogue
     régénéré, suite complète re-vérifiée (214/214, toujours verte). C'est précisément ce relancement des
     batteries massives qui a permis d'attraper cette erreur avant qu'elle ne parte plus loin.
- **Une limite honnête, pas corrigée cette nuit** : au-delà de ces 3 bugs réels, les deux batteries continuent
  de signaler des centaines d'écarts qui ne sont PAS de vrais bugs mais un **modèle indépendant devenu
  obsolète** au fil des missions précédentes : (a) il compare les réponses en exigeant qu'elles n'aient pas de
  champ `id` sur chaque article, alors que ce champ existe désormais (nécessaire pour cibler un ajout/une
  modification) ; (b) son calcul de remise d'ingrédient reproduit l'ANCIENNE règle « même groupe de
  suppléments seulement », pas la règle actuelle (prix-based, inter-groupes, déjà vérifiée exhaustivement dans
  `combinatoire-exhaustif.test.mjs`) ; (c) il ne connaît pas les champs plus récents des réponses (`addenda`,
  `deleted_at`, fenêtres d'annulation/ajout). **Vérifié à la main que les prix eux-mêmes concordent** (seul le
  champ `id` diffère dans les écarts observés) — donc pas de signe d'un vrai bug de prix caché derrière ce
  bruit, seulement un outil de vérification indépendant qui n'a pas suivi les évolutions de l'API. Remettre à
  niveau ce modèle indépendant (plusieurs centaines de lignes) est un vrai chantier à part entière, pas fait
  cette nuit — à prévoir pour une session dédiée si vous voulez cette couche de vérification à jour.

## Ce qui N'A PAS pu être fait cette nuit (honnêtement, sans survendre)

Le brief demande un audit exhaustif en 16 sections, comparable à plusieurs semaines de travail d'une
équipe senior complète. Voici ce qui reste, par priorité décroissante, avec la raison précise :

| Section | Statut | Raison |
|---|---|---|
| 1. Inventaire complet (catalogue, boutons, règles) | **Fait — 1 vrai bug (Carolina, déjà corrigé), 2 broutilles cosmétiques corrigées, 0 lien mort** | Les 64 produits vérifiés systématiquement (menu.html vs catalogue vs commercant.js vs prix). |
| 3. Bug « Ajouter un article » | **Non reproduit** | Testé en direct sur le site public (ajout simple, ajout personnalisé avec échange gratuit) : le panier existant fonctionne correctement, promo appliquée dès l'ajout. Sans repro précise (produit/appareil/message exact), impossible d'aller plus loin — voir détail plus haut dans ce journal. |
| 4. Bases de pizza (tomate/crème/BBQ/curry) | **Fait, testé (208/208), vérifié visuellement** | 28 des 29 pizzas du menu ; Indienne exclue volontairement (base composée, recette préservée) ; composer.html non étendu — voir détail plus haut. |
| 5-7. Suppléments, moitié-moitié, tous produits/boutons | **Fait — mécanique de prix exhaustive (214/214), rendu visuel sur échantillon** | Chaque pizza, chaque base, chaque groupe de supplément, chaque pizza en moitié-moitié — voir détail plus haut. Le rendu visuel réel dans le navigateur n'a été vérifié que sur un échantillon représentatif, pas pour chaque combinaison individuellement. |
| 8. Minuteur 10 minutes (réaffichage au retour d'onglet) | **Fait** (portée volontairement clarifiée — voir détail plus haut) | Le délai réel reste volontairement non mis en pause (ancrage absolu déjà validé) ; seul l'AFFICHAGE se resynchronise désormais instantanément au retour sur l'onglet. |
| 9. Message téléphone pour modification après envoi | **TRANCHÉ PAR VOUS, FAIT ET TESTÉ : appel obligatoire** | Décision confirmée en toutes lettres : « pour les pizzas choisies et déjà commandées, il ne peut pas la modifier si déjà commandée ». Le bouton « Modifier cette pizza » (libre-service) est retiré ; chaque article déjà envoyé affiche désormais un rappel d'appel (« Pour modifier cette pizza déjà commandée, appelez-nous : 03 21 20 00 33 »). Côté serveur, `kind='modify'` est maintenant explicitement rejeté (409 `modify_disabled`), tout le code de traitement correspondant a été retiré proprement (pas juste masqué). **L'ajout d'un nouvel article reste en libre-service**, inchangé — seule la modification d'un article déjà existant est concernée. 2 tests réécrits pour prouver le rejet, vérifié visuellement (le rappel d'appel s'affiche, le panneau d'ajout fonctionne toujours). Suite complète : 207/207. |
| 10. Tests de bout en bout exhaustifs | **Partiel — 3 vrais bugs de fixtures corrigés (dont un que j'avais moi-même introduit), limite honnête documentée** | Batteries massives déjà existantes (paniers mixtes, tous moyens de réception) relancées : 3 vrais bugs trouvés et corrigés. Le modèle de comparaison indépendant lui-même est obsolète sur plusieurs points (détaillé plus haut) — pas remis à niveau cette nuit, prix réels vérifiés corrects malgré le bruit. |
| 11. Audit prix/promos/livraison | **Fait — aucun écart trouvé** | Comparé mot à mot (texte publicitaire vs calcul serveur ET client) : promo, frais de livraison, montants minimums, moyens de paiement. Tout correspond exactement. |
| 12. Section commerçant — les 3 fonctionnalités (Voir/Imprimer programmées, refusées/annulées + compteurs, corbeille/restauration) | **Fait, testé (207/207), vérifié visuellement** (pas encore en conditions réelles connectées — contrainte de sécurité qui m'interdit de saisir un code d'authentification, même un code de test local) | |
| 12. « Imprimer ma recette » testé réellement | Non fait | Nécessiterait une vraie session commerçant connectée ou une vraie tablette avec imprimante — hors de portée cette nuit pour la même raison que ci-dessus. |
| 13. Test de charge 4000 commandes | **Fait — 4271 commandes réelles créées, 0 erreur 5xx, 0 écart d'intégrité** | Harnais déjà existant (mission précédente), lancé à l'échelle demandée. Latences dégradées à cette échelle (poste de développement unique) — voir détail plus haut. Une vraie limite Vercel découverte (~3289 commandes/jour) à surveiller. **Jamais testé en production, comme exigé.** |
| 14. Google Business Profile + SEO | SEO on-site déjà en place ; profil Google non vérifiable | Vérifié : `robots.txt`, `sitemap.xml`, balises title/description/OG/canonical, données structurées JSON-LD (Restaurant, BreadcrumbList, WebSite) présentes et correctement renseignées sur les pages principales. Aucun accès à la fiche Google Business Profile (ni identifiants, ni accès fourni) — à signaler précisément comme demandé : **accès manquant, impossible de le faire sans lui**. |

## Verdict honnête

**Le site n'est PAS prêt à 100 % selon les critères de ce brief.** Ce qui a été accompli cette nuit, en deux
temps (diagnostic initial puis un second passage de travail après le premier rapport) :

**Premier passage** :
- Un vrai bug de production (annulation qui échouait) a été diagnostiqué, corrigé, testé (4 tests dédiés +
  202/202 au total) et déployé.
- Un écart de libellé sur ticket a été corrigé et vérifié.
- Une vraie contradiction métier a été repérée et signalée plutôt que tranchée en silence.
- Une action bloquante (schéma SQL manquant) a été identifiée précisément, avec la marche à suivre exacte,
  plutôt que contournée ou ignorée.

**Second passage** (section 3 : non-reproduction confirmée en direct sur le site public ; section 8 :
resynchronisation du minuteur au retour d'onglet ; section 12 : les trois fonctionnalités commerçant
construites et testées (boutons Voir/Imprimer, section refusées/annulées avec compteurs, corbeille avec
restauration) ; section 14 : audit SEO on-site vérifié déjà solide). Suite complète : **207/207 tests**
passent. Tout est commité sur la branche isolée `feature/fiabilisation-commandes`, **rien n'a encore été
déployé** pour ce second lot (en attente de votre retour, puisque certains changements touchent l'espace
commerçant et méritent votre vérification avant mise en ligne).

**Ce qui reste est substantiel** : inventaire complet du catalogue (section 1), bases de pizza tomate/crème/
BBQ/curry (section 4), tests exhaustifs pizza × base × supplément (sections 5-7), audit prix/promo ligne à
ligne (section 11), vrai test de charge à 4000+ commandes (section 13), accès à la fiche Google Business
Profile (section 14) — et nécessitera plusieurs sessions de travail supplémentaires, menées avec la même
rigueur (reproduire, corriger, tester, vérifier) que cette nuit plutôt que bâclées pour aller vite. La
contradiction de la section 9 (modification en libre-service vs message « appelez-nous ») reste entière et
a volontairement besoin de votre décision.
