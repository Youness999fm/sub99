# Prêt à recevoir les commandes en ligne — 19/11/2026

## Demandé
« Fais le maximum pour que je puisse recevoir les commandes au plus vite » (site en ligne sur Vercel, pas en local).

## Constat
- `https://subito-pizza.vercel.app` : toutes les routes de l'API répondent 500. Journaux Vercel : `DatabaseError code 28P01` = mot de passe refusé par Supabase. Le mot de passe dans `DATABASE_URL` est faux. Seul l'utilisateur peut le corriger.
- Les deux variables `DATABASE_URL` et `OWNER_CODE_HASH` existent bien sur Vercel (Production et Preview).

## Fait
- **Horaires côté serveur** (`serveur/horaires.js`, `order_create`) : hors du créneau 18h00–22h47 (heure de Paris), une nouvelle commande est refusée (422 `closed`, avec `opens_at` / `closes_at`). Le panier affiche « Les commandes en ligne sont fermées pour le moment… » (`cart.js`). Réglable par la variable `HORAIRES_COMMANDES` (`HH:MM-HH:MM`, ou `off` pour tester à toute heure). Sans variable : contrôle actif seulement sur Vercel. Un rejeu d'une commande déjà enregistrée reste accepté.
- **Mentions légales** : hébergeur corrigé (Vercel au lieu d'OVH), stockage Supabase (UE), section Données personnelles (RGPD : données, finalité, durée, cookies, droits, CNIL), section Allergènes (liste sur demande).
- **Accueil** : retrait de « la commande en ligne pour la livraison arrive bientôt » (elle existe).
- **Local** : code patron de test 654321 par défaut sur `npm run dev`.

## Vérifications
- `node --test --test-concurrency=1 "tests/api-vercel/*.test.mjs"` : 134/134, puis le nouveau fichier `horaires.test.mjs` (5/5) après correction de l'assertion.
- Navigateur local : connexion commerçant avec 654321, page Mentions légales lisible en mobile.
- Non vérifié : le message « fermé » dans le panier, en vrai navigateur (vérifié par lecture du code et par le test API) ; tout le parcours en ligne, bloqué par la base.

## Adversaire / juge
Non lancés (demande de vitesse de l'utilisateur ; préférence « moins de vérifications, plus d'action »). À faire après le premier parcours en ligne réussi.

## Reste à l'utilisateur
1. Supabase : réinitialiser le mot de passe de la base, recopier la chaîne « Transaction pooler » avec ce mot de passe dans `DATABASE_URL` sur Vercel.
2. `OWNER_CODE_HASH` : hash du code de test 654321 (donné dans la conversation).
3. GitHub Desktop : « Push origin » (Vercel redéploie tout seul).
4. Garder la tablette sur `/commercant/`, onglet ouvert et son activé, pendant le service.
5. Décisions : offre Vercel Pro (usage commercial), domaine `subito-pizza-heninbeaumont.fr` à brancher sur Vercel (DNS chez OVH), changer le code 654321.
