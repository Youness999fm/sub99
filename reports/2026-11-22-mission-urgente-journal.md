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

## Ce qui N'A PAS pu être fait cette nuit (honnêtement, sans survendre)

Le brief demande un audit exhaustif en 16 sections, comparable à plusieurs semaines de travail d'une
équipe senior complète. Voici ce qui reste, par priorité décroissante, avec la raison précise :

| Section | Statut | Raison |
|---|---|---|
| 1. Inventaire complet (catalogue, boutons, règles) | Non fait | Nécessite un passage méthodique de plusieurs heures sur chaque page/produit ; non commencé faute de temps cette nuit. |
| 3. Bug « Ajouter un article » | Partiellement clarifié, pas corrigé | **Ambiguïté importante à trancher** : le brief décrit un bouton « Ajouter à ma commande » qui garde le client sur le menu et accumule les articles avant une validation finale distincte — cela correspond au panier EXISTANT (avant envoi), pas à la nouvelle fonctionnalité d'ajout post-envoi construite cette nuit-même (mission précédente). Le panier existant (`cart.js`, boutons « Ajouter au panier ») a été vérifié visuellement en direct sur le site public : la page se charge et s'affiche sans erreur, mais je n'ai pas testé le clic réel du bouton d'ajout (temps insuffisant). À reproduire et corriger en priorité à la prochaine session. |
| 4. Bases de pizza (tomate/crème/BBQ/curry) | Non fait | Nouvelle fonctionnalité produit à construire (catalogue + widget + tarification) — plusieurs heures de travail, pas commencé. |
| 5-7. Suppléments, moitié-moitié, tous produits/boutons | Non testé exhaustivement | La RÈGLE de gratuité (viande/légume/œuf) a été testée en profondeur (40 scénarios combinatoires + cas explicites) dans la mission précédente, mais pas CHAQUE pizza × CHAQUE base × CHAQUE supplément individuellement comme demandé ici. |
| 8. Minuteur 10 minutes (pause sur onglet masqué) | Non fait | Le minuteur existant compte depuis `created_at` sans interruption ; la mise en pause sur `visibilitychange` n'existe pas encore. Fonctionnalité à ajouter, non commencée. |
| 9. Message téléphone pour modification après envoi | **CONTRADICTION À TRANCHER PAR VOUS** | Ce brief demande d'afficher un message invitant à appeler plutôt que de permettre une modification en libre-service. Or la mission précédente (cette nuit même) a justement construit une modification en libre-service dans les 10 minutes (bouton « Modifier cette pizza » sur commande.html), testée et déployée. Je n'ai PAS désactivé cette fonctionnalité qui vient d'être validée et testée, en l'absence d'une instruction confirmée dans ce sens — supprimer un travail validé sur une simple ambiguïté m'a semblé plus risqué que de vous signaler le conflit. **Dites-moi laquelle des deux règles commerciales vous voulez vraiment.** |
| 10. Tests de bout en bout exhaustifs | Partiel | Une large suite automatisée existe déjà (202 tests) couvrant une bonne partie de ces scénarios depuis la mission précédente, mais pas tous les cas listés ici (panier mêlant toutes les catégories, perte réseau simulée, etc.). |
| 11. Audit prix/promos/livraison | Non fait spécifiquement | Les règles de promo existantes sont couvertes par les tests automatisés déjà en place, mais pas ré-auditées ligne à ligne contre le brief. |
| 12. Section commerçant (refusées/annulées en haut, suppression avec corbeille, boutons planifiées Voir/Imprimer) | Non fait | Trois fonctionnalités neuves d'interface commerçant, chacune comparable en ampleur à une mission complète. Non commencées faute de temps — à prioriser à la prochaine session. |
| 13. Test de charge 4000 commandes | Non fait | Nécessite un harnais de charge dédié (k6, autocannon ou équivalent) contre l'environnement de test ; non construit cette nuit. **Jamais testé en production, comme exigé.** |
| 14. Google Business Profile + SEO | Non fait | Aucun accès à la fiche Google Business Profile (ni identifiants, ni accès fourni) — à signaler précisément comme demandé : **accès manquant, impossible de le faire sans lui**. L'audit SEO on-site (robots.txt, sitemap, meta, structured data) n'a pas été commencé non plus faute de temps. |

## Verdict honnête

**Le site n'est PAS prêt à 100 % selon les critères de ce brief.** Ce qui a été accompli cette nuit :
- Un vrai bug de production (annulation qui échouait) a été diagnostiqué, corrigé, testé (4 tests dédiés +
  202/202 au total) et déployé.
- Un écart de libellé sur ticket a été corrigé et vérifié.
- Une vraie contradiction métier a été repérée et signalée plutôt que tranchée en silence.
- Une action bloquante (schéma SQL manquant) a été identifiée précisément, avec la marche à suivre exacte,
  plutôt que contournée ou ignorée.

**Ce qui reste est substantiel** (bases de pizza, minuteur avec pause, 3 fonctionnalités commerçant neuves,
test de charge, SEO/Google) et nécessitera plusieurs sessions de travail supplémentaires, menées avec la
même rigueur (reproduire, corriger, tester, vérifier) que cette nuit plutôt que bâclées pour aller vite.
