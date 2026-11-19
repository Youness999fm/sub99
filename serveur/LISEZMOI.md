# API JavaScript (Vercel + Supabase)

Réécriture de l'API PHP (`api/*.php`, `api/lib/*.php`) en JavaScript, avec le **même contrat HTTP** (noms de routes, formes JSON, codes d'erreur, messages) : le JavaScript du site (`assets/js/*.js`, `commercant/`) n'est pas modifié. Seuls changements voulus :

- le commerçant se connecte avec un **code patron** (`OWNER_CODE_HASH`, bcrypt), plus d'e-mail ni de mot de passe ;
- la base est **Postgres (Supabase)** ; les commandes sont purgées chaque jour par `pg_cron` (`supabase/001_schema.sql`).

## Organisation

| Fichier | Rôle |
|---|---|
| `api/[...route].js` | Seule fonction Vercel : `/api/<nom>` et `/api/<nom>.php` -> `serveur/routes/<nom>.js` |
| `serveur/router.js` | Routeur, vérification d'origine (`APP_ORIGINS`), réponses JSON, erreurs |
| `serveur/core.js` | `ok()`, `fail()`, `failValidation()`, `allowMethods()`, `readJsonBody()`, `setCookie()`, contexte `c` |
| `serveur/db.js` | `one`, `all`, `exec`, `insert` (placeholders `?`), `transaction`, `estViolationUnique` |
| `serveur/auth.js` | Sessions (cookie + SHA-256 en base), `requireCustomer`, `requireOwner`, `createSession`… |
| `serveur/throttle.js` | Limitation de débit (`throttleGuard`, `throttleHit`, `throttleRefund`, `throttleIpKey`) |
| `serveur/util.js` | Dates UTC (`nowUtc`, `utcAt`, `serviceDay`), zones de livraison, noms normalisés |
| `serveur/schema.js` | Tables (source unique) -> DDL Postgres |
| `serveur/routes/*.js` | Une route par fichier : `export default async function (c)` qui renvoie `ok({...}, status)` |
| `serveur/outils/pglite-*.mjs` | Base Postgres en mémoire pour les tests (jamais utilisée en production) |
| `tests/api-vercel/` | Tests : mêmes scénarios que `tests/api/` (version PHP, qui sert de référence) |

## Écrire une route

```js
import { allowMethods, readJsonBody, fail, failValidation, ok } from '../core.js';
import { one, exec, insert, transaction } from '../db.js';

export default async function maRoute(c) {
  allowMethods(c, ['POST']);
  const b = await readJsonBody(c);          // objet JSON, 64 Ko max (415, 413, 400 sinon)
  const row = await one('SELECT * FROM customers WHERE id = ?', [1]);
  if (row === null) fail(404, 'not_found', 'Introuvable.');   // lève : rien après n'est exécuté
  return ok({ customer: { id: 1 } }, 201);                    // à renvoyer
}
```

- `fail()` et `failValidation()` **lèvent** une erreur : pas de `return` nécessaire derrière.
- Contexte `c` : `c.method`, `c.headers`, `c.query` (URLSearchParams), `c.cookies`, `c.ip`, `c.setCookies`.
- Dans `transaction(async (t) => { ... })`, n'utilisez que `t.one/all/exec/insert` : en Postgres, une erreur (ex. unicité) **annule toute la transaction** ; rattrapez-la hors transaction.
- Jamais de donnée personnelle dans les journaux ni dans les messages d'erreur.
- Dates : texte UTC `2026-11-19T18:03:12Z` (comparaison lexicographique valide).

## Tests

```powershell
$env:SUBITO_TEST_PORT = '18420'
node --test "tests/api-vercel/*.test.mjs"
```

Le serveur de test tourne dans le processus du test, sur une base Postgres réelle en mémoire (PGlite) ; `openTestDb(ctx)` donne un accès **synchrone** à cette base (`prepare(sql).get/all/run`, placeholders `?`).
