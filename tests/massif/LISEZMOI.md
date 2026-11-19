# Tests massifs (API + navigateur réel)

Objectif : prouver que la commande en ligne tient en rafale, que tous les types de commandes arrivent correctement chez le commerçant, que les statuts changent **sans recharger la page** et que le site résiste à des usages abusifs.

Tout tourne en local, dans un seul processus par script : pages du site + API JavaScript + base **Postgres réelle en mémoire** (PGlite). Rien n'est envoyé sur Internet, aucun compte réel n'est utilisé.

## Lancer

```powershell
node tests/massif/lancer.mjs tests/massif/00-socle.mjs
```

Le lanceur attribue un port libre (`SUBITO_TEST_PORT`), limite à **3 scripts simultanés** sur la machine (au-delà, des dizaines de milliers de connexions locales restent en TIME_WAIT et faussent les mesures), applique un délai maximal (`--timeout=600`) et garde la sortie dans `%TEMP%\subito-massif-logs`.

## Briques (`tests/massif/lib/`)

| Fichier | Rôle |
|---|---|
| `env.mjs` | `demarrerSite()` : site complet local ; `db` = accès **synchrone** à la base, `journal()` = erreurs écrites par le serveur |
| `clients.mjs` | `ClientIP` (cookies + adresse IP simulée par client), `creerClients(n)`, `patronConnecte()`, `enParallele()` |
| `commandes.mjs` | Générateur de commandes **valides** à partir du vrai catalogue (`construireCommande`, `lignePizza`, `ligneProduit`, `rng`) |
| `chrome.mjs` | `avecNavigateur()` : Chrome headless, **3 navigateurs et 8 onglets au plus** (mémoire) ; `ouvrirPage(url, { cookies })` |

## Règles

- Un script = un fichier `tests/massif/NN-nom.mjs` qui affiche `PASS` / `FAIL` par contrôle et se termine par `process.exit(code)` (0 = tout bon).
- Les mots de passe et le code patron sont des valeurs fabriquées pour le test (jamais un vrai).
- Ne pas appeler `site.db` pendant une rafale de requêtes (appel bloquant).
- Statuts d'une commande : `new` -> `accepted` (avec délai) -> `ready` (prête), ou `new` -> `refused`. Le suivi client interroge le serveur toutes les 4 s (en attente) puis 5 s (acceptée) et s'arrête à `ready` / `refused`.
