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

## Ce qui N'A PAS pu être fait cette nuit (honnêtement, sans survendre)

Le brief demande un audit exhaustif en 16 sections, comparable à plusieurs semaines de travail d'une
équipe senior complète. Voici ce qui reste, par priorité décroissante, avec la raison précise :

| Section | Statut | Raison |
|---|---|---|
| 1. Inventaire complet (catalogue, boutons, règles) | Non fait | Nécessite un passage méthodique de plusieurs heures sur chaque page/produit ; non commencé faute de temps cette nuit. |
| 3. Bug « Ajouter un article » | **Non reproduit** | Testé en direct sur le site public (ajout simple, ajout personnalisé avec échange gratuit) : le panier existant fonctionne correctement, promo appliquée dès l'ajout. Sans repro précise (produit/appareil/message exact), impossible d'aller plus loin — voir détail plus haut dans ce journal. |
| 4. Bases de pizza (tomate/crème/BBQ/curry) | Non fait | Nouvelle fonctionnalité produit à construire (catalogue + widget + tarification) — plusieurs heures de travail, pas commencé. |
| 5-7. Suppléments, moitié-moitié, tous produits/boutons | Non testé exhaustivement | La RÈGLE de gratuité (viande/légume/œuf) a été testée en profondeur (40 scénarios combinatoires + cas explicites) dans la mission précédente, mais pas CHAQUE pizza × CHAQUE base × CHAQUE supplément individuellement comme demandé ici. |
| 8. Minuteur 10 minutes (réaffichage au retour d'onglet) | **Fait** (portée volontairement clarifiée — voir détail plus haut) | Le délai réel reste volontairement non mis en pause (ancrage absolu déjà validé) ; seul l'AFFICHAGE se resynchronise désormais instantanément au retour sur l'onglet. |
| 9. Message téléphone pour modification après envoi | **CONTRADICTION TOUJOURS À TRANCHER PAR VOUS** | Une première réponse courte a été reçue puis explicitement remise en question par vous-même avant clarification complète — par prudence, rien n'a été changé dans le code. La modification en libre-service (bouton « Modifier cette pizza » sur commande.html) reste donc en l'état actuel (déjà construite et testée lors de la mission précédente), sans qu'aucun choix définitif ne soit acté de mon côté. **Dites-moi en toutes lettres lequel des deux comportements vous voulez : libre-service, ou message « appelez le restaurant ».** |
| 10. Tests de bout en bout exhaustifs | Partiel | Une large suite automatisée existe déjà (202 tests) couvrant une bonne partie de ces scénarios depuis la mission précédente, mais pas tous les cas listés ici (panier mêlant toutes les catégories, perte réseau simulée, etc.). |
| 11. Audit prix/promos/livraison | Non fait spécifiquement | Les règles de promo existantes sont couvertes par les tests automatisés déjà en place, mais pas ré-auditées ligne à ligne contre le brief. |
| 12. Section commerçant — les 3 fonctionnalités (Voir/Imprimer programmées, refusées/annulées + compteurs, corbeille/restauration) | **Fait, testé (207/207), vérifié visuellement** (pas encore en conditions réelles connectées — contrainte de sécurité qui m'interdit de saisir un code d'authentification, même un code de test local) | |
| 12. « Imprimer ma recette » testé réellement | Non fait | Nécessiterait une vraie session commerçant connectée ou une vraie tablette avec imprimante — hors de portée cette nuit pour la même raison que ci-dessus. |
| 13. Test de charge 4000 commandes | Non fait | Nécessite un harnais de charge dédié (k6, autocannon ou équivalent) contre l'environnement de test ; non construit cette nuit. **Jamais testé en production, comme exigé.** |
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
