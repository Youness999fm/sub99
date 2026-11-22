# Journal de mission — Audit complet Subito Pizza (en cours)

Démarré : 2026-11-22, nuit. Mission reçue du propriétaire pendant qu'il dort — travail autonome, pas de validation intermédiaire, retour uniquement à la fin ou en cas de blocage dur.

**Règle d'or appliquée tout du long** : jamais de commande réelle sur https://www.subito-pizza-heninbeaumont.fr/ (production), jamais de test de charge en production, jamais de déploiement non testé. Tout le travail de reproduction/correction se fait dans l'environnement de test local (PGlite en mémoire) ou sur une branche isolée. Seules les inspections en LECTURE SEULE (pages publiques, code) touchent la production.

## État au démarrage (avant cette mission)
- Branche `main` à jour, déployée en production ce soir même (fusion de la mission de fiabilisation des commandes : annulation client 4 min, ajout/modif 10 min, anti-doublon, règle viande/légume/œuf, correctif impression planifiée).
- Un correctif d'urgence a aussi été fusionné (tables order_addenda absentes en prod → tolérance ajoutée) suite à un bug observé en conditions réelles par l'utilisateur ce soir (commande réussie mais "connexion interrompue" affiché).
- **Point d'attention critique pour cette nouvelle mission** : les tables order_addenda/order_addendum_items/addendum_print_jobs ne sont TOUJOURS PAS créées dans la vraie base Supabase de production (seule la tolérance au code a été déployée, pas la vraie migration SQL). Donc en production actuellement : l'annulation client et l'ajout de commande échouent probablement silencieusement (pas d'erreur 500 grâce au correctif, mais la fonctionnalité elle-même ne peut pas fonctionner sans ces tables). À vérifier et probablement corriger dans cette mission (section 2/3 du nouveau brief recoupent ça).

## Matrice de suivi (une ligne par exigence du nouveau brief)
| # | Exigence | Constat | Correction | Test exécuté | Résultat | Preuve | Limite restante |
|---|---|---|---|---|---|---|---|
| (à remplir au fil de l'eau) | | | | | | | |

## Journal chronologique
- [en cours] Investigation du bug "annulation commerçant → erreur interne" (section 2 du brief) : recherche du code concerné côté tablette commerçant.
