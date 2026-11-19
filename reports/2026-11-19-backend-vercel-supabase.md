# API JavaScript sur Vercel + Supabase, comptes clients conservés — 2026-11-19

## Demande et décisions

- Brief collé par l'utilisateur : prise de commandes sur Supabase (Postgres, Irlande) et Vercel, code patron haché, purge quotidienne des commandes, aucune donnée de commande dans les journaux.
- Décisions de l'utilisateur : **garder les comptes clients** ; **Vercel + Supabase** plutôt qu'OVH (le compte OVH n'a pas d'hébergement web).
- Conséquence : l'API PHP (`api/*.php`) est réécrite en JavaScript avec le **même contrat HTTP** (mêmes routes, mêmes JSON, mêmes messages) ; le JavaScript du site n'a pas changé, sauf l'écran de connexion du commerçant (champ « Code » à la place de l'e-mail et du mot de passe).

## Écarts avec le brief (voulus)

| Brief | Réalisé | Pourquoi |
|---|---|---|
| Table unique `commandes` (jsonb) | Tables `customers`, `sessions`, `orders`, `order_items`, `availability`, `settings`, `throttle` | Garder comptes, suivi de commande, prix vérifiés par le serveur. `public.commandes` n'est pas utilisée. |
| Routes `/api/commande`, `/api/patron/*` | Routes d'origine (`order_create`, `owner_login`, `owner_orders`…), avec ou sans `.php` | Le site les appelle déjà : aucune modification des pages. |
| Purge `purge-commandes-hors-jour` | Nouvelle tâche `purge-orders-hors-jour` (même règle : avant minuit de Paris), en plus de la vôtre | Les commandes sont dans `orders` / `order_items`. Les comptes clients ne sont pas purgés. |
| `SESSION_SECRET`, `SUPABASE_SERVICE_ROLE_KEY` | Inutiles | Sessions en base (jeton aléatoire, seul le SHA-256 est stocké) ; connexion par `DATABASE_URL`. |
| Cookie de session patron 12 h | 12 h, ou 30 jours si « Rester connecté » est coché | Comportement existant. À retirer si vous préférez 12 h strictes. |
| Historique des commandes client | Limité à la journée (purge) | Conséquence de la purge. |

## Ce qui est fait

- `api/[...route].js` : une seule fonction Vercel. `serveur/router.js` : routage, origine (`APP_ORIGINS` + le site lui-même), réponses JSON, erreurs sans donnée personnelle.
- `serveur/routes/*.js` : 20 routes (clients, commandes, commerçant, disponibilité). Bibliothèques : `catalogue.js` (prix vérifiés), `orders.js`, `auth.js`, `throttle.js`, `customers.js`, `availability.js`, `schema.js`.
- Connexion commerçant : `owner_login { code }`, bcrypt contre `OWNER_CODE_HASH`, 5 essais par 15 minutes et par adresse (IPv6 réduite au /64), comptés avant la vérification. Le code n'existe en clair nulle part.
- `supabase/001_schema.sql` (généré par `node serveur/outils/schema-sql.mjs`) : tables, index, Row Level Security sur chaque table sans politique, purge `pg_cron`.
- `vercel.json` : région Dublin (`dub1`), réécriture des anciennes adresses `.php`, inclusion de `serveur/` et `api/data/`, installation sans dépendances de test (`npm ci --omit=dev`). `.vercelignore` : code PHP, tests, rapports et pages exclues non publiés.
- `serveur/routes.js` : registre STATIQUE des routes (Vercel ne suit pas les imports dynamiques : sans cela `bcryptjs` et `pg` manqueraient en production). Contrôlé avec seulement les dépendances de production : la fonction démarre, répond, refuse les origines étrangères.
- `serveur/outils/hash-code.mjs` (`npm run hash-code`), `reset-customer.mjs` (réinitialiser le mot de passe d'un client), `dev.mjs` (serveur local, base en mémoire).
- `serveur/LISEZMOI.md` : conventions pour écrire ou modifier une route.

## Statut « prête » et suivi en direct (ajout du 19/11)

- `owner_order_decide { id, action: "ready" }` : `accepted -> ready` (`prepared_at` renseigné, rejeu sans effet, `409 already_decided` depuis `new` ou `refused`). Statuts : `new -> accepted -> ready`, ou `new -> refused`. Nouvelle colonne `orders.prepared_at` (déjà dans `supabase/001_schema.sql`).
- Tablette commerçant : bande « En préparation » (commandes acceptées du jour) ; toucher une commande ouvre son ticket avec le bouton « Commande prête · prévenir le client » ; « Recette du jour » compte acceptées et prêtes.
- Page de suivi du client : sondage toutes les 4 s en attente, puis 5 s une fois acceptée (jusqu'à « prête » ou « refusée », sans limite de 30 min pour une commande acceptée) ; l'écran se met à jour tout seul (`data-order-status`), le titre de l'onglet change si la page est en arrière-plan, l'appareil vibre si le navigateur l'autorise, une notification système n'est envoyée que si la permission a déjà été accordée (aucune demande de permission, décision antérieure du propriétaire).
- Mesuré dans Chrome (socle des tests massifs) : « acceptée » apparaît en moins de 4 s, « prête » en moins de 5 s, sans recharger la page.

## Vérification

- `node --test --test-concurrency=1 "tests/api-vercel/*.test.mjs"` : **129 / 129**, sur un vrai Postgres en mémoire (PGlite). Les scénarios sont ceux de `tests/api/` (version PHP, restée la référence) : comptes, sessions, commandes, catalogue (26), politique de limitation (25), disponibilité, journaux sans donnée personnelle, schéma, purge.
- Parcours réel dans le navigateur, sur `serveur/outils/dev.mjs` : création de compte, ajout d'une Végétarienne Solo au panier, commande en ligne (201), page de suivi, espace commerçant (mauvais code refusé, bon code accepté), commande visible (« Nouvelle »), acceptation avec délai de 30 min, page client mise à jour (« Commande acceptée ! »). Seule erreur console : `navigator.vibrate` (antérieure).

## Non vérifié (à contrôler au premier déploiement)

- **Supabase et Vercel réels** : jamais exercés (pooleur de connexions et SSL, `includeFiles`, réécriture `.php`, Node 22 de Vercel contre Node 24 en local, en-têtes d'adresse du client).
- Un JSON invalide envoyé à Vercel peut être refusé par la plateforme avant notre code (réponse non JSON) : sans effet pour le site, qui envoie du JSON valide.
- L'empreinte d'idempotence n'a pas été comparée octet pour octet à celle du PHP (PHP absent de la machine) ; sans conséquence pour les nouvelles commandes.
- `reset-customer` en ligne de commande n'a pas été essayé sur un vrai Postgres.

## À faire par vous

1. **Supabase** → SQL Editor → coller le contenu de `supabase/001_schema.sql` → Run. Puis `select * from cron.job;` : les tâches `purge-commandes-hors-jour` et `purge-orders-hors-jour` doivent apparaître.
2. **Sur votre PC**, dans le dossier du dépôt : `npm install`, puis `npm run hash-code` (saisie masquée) et copier la valeur affichée. Le code lui-même ne doit apparaître nulle part.
3. **Vercel** → New Project → importer le dépôt GitHub → Framework « Other » → Environment Variables : `DATABASE_URL` (Supabase > Connect > **Transaction pooler**, port 6543) et `OWNER_CODE_HASH`. Déployer.
4. Sur l'adresse `*.vercel.app` donnée par Vercel : créer un compte, passer une commande test, ouvrir `/commercant/`, se connecter avec le code, accepter la commande. Seulement ensuite, ajouter le domaine dans Vercel et changer les enregistrements DNS chez OVH.

## Points ouverts

- **Offre Vercel** : l'offre gratuite (Hobby) est réservée à un usage non commercial ; un restaurant relève de l'offre Pro (payante). Décision de coût.
- **Horaires** : toujours aucune vérification côté serveur ; une commande est acceptée à toute heure. Horaires contradictoires dans le site (18h–23h ou 18h–22h47).
- **Longueur du code patron** : 5 essais par 15 minutes et par adresse protègent bien un code de 8 caractères ou plus, beaucoup moins un code de 6 chiffres.
- **Google Fonts et Google Maps** sur les pages client : le brief interdit les scripts tiers.
- **Textes légaux** (mentions légales, politique de confidentialité, allergènes) toujours à fournir.
- L'ancien backend PHP et ses tests restent dans le dépôt (non publiés sur Vercel) ; à retirer plus tard si OVH est définitivement abandonné.
- Des modifications non commitées d'une autre session (`cart.js`, `commande.js`, `account.js`, test e2e) sont dans le même dossier : à vérifier avant de commiter « tout ».
