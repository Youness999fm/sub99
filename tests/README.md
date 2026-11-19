# Tests locaux de sub99

Ce dossier contient des vérifications qui tournent **en local**, sur un serveur de test,
dans un vrai navigateur (Chrome ou Edge, en mode sans fenêtre).

**Ce dossier ne se publie pas.** Il est exclu de l'envoi FTP et bloqué dans `robots.txt`
(voir la checklist du rapport `reports/2026-11-19-audit-prepublication.md`).

## Prérequis

- Node.js 22 ou plus récent (WebSocket et `fetch` sont intégrés, aucune dépendance npm).
- Chrome ou Edge installé. Pour un autre chemin : définir la variable `CHROME_PATH`.
- Le site servi en local sur `http://localhost:8090` (voir `.claude/launch.json` et `.claude/serve.ps1`).

## Lancer les tests

Parcours de commande (18 vérifications) :

```powershell
node tests/e2e/parcours-commande.mjs
```

Contrôles de régression ajoutés pendant l'audit du 19/11 (compte client, panier, suivi, popup) :

```powershell
node tests/e2e/regressions-audit.mjs
```

Accessibilité automatique (axe-core, à installer une fois : `npm install axe-core@4.14.1` dans un dossier de travail hors du site) :

```powershell
$env:AXE_PATH = "C:\chemin\vers\node_modules\axe-core\axe.min.js"
node tests/accessibilite/axe-pages.mjs
```

Performance et accessibilité avec Lighthouse (à installer une fois hors du site) :

```powershell
$env:LIGHTHOUSE_DIR = "C:\chemin\vers\dossier-lighthouse"
node tests/accessibilite/lighthouse.mjs
```

Les résultats détaillés sont écrits dans le dossier défini par `OUT_DIR`
(par défaut : un dossier temporaire de la session). Les scripts affichent PASS ou FAIL pour chaque vérification.

## Garanties de sécurité des scripts

- Refus immédiat si `BASE_URL` ne pointe pas vers `localhost` ou `127.0.0.1`.
- Aucun envoi réel : la commande est interceptée dans la page, aucun e-mail, SMS ou impression.
- Aucun compte n'est utilisé, aucun identifiant n'est lu ni écrit.
- Les réponses de l'API (absente sur ce site pour l'instant) sont simulées dans la page.

## Ce que ces tests ne prouvent pas

- Ils ne prouvent pas qu'une commande réelle est enregistrée : l'API n'existe pas encore.
- axe-core ne couvre qu'une partie des critères WCAG ; les autres demandent un test humain.
- Lighthouse mesure le site servi en local, pas les performances chez l'hébergeur.
- Aucun test de charge : une charge doit être menée sur un environnement de préproduction autorisé.
