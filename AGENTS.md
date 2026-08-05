# AGENTS.md — Roster de l'équipe

Ce document décrit qui fait quoi. Les définitions techniques (outils, modèle) sont dans `.claude/agents/*.md` ; ce fichier explique le rôle, quand chaque agent intervient, et comment ils se disputent le travail sans se marcher dessus.

L'**orchestrateur**, c'est la session principale (toi, dans la conversation avec l'utilisateur). Elle ne code pas tout elle-même : elle cadre la mission, découpe le travail, lance les sub-agents (en parallèle quand c'est possible), arbitre, et rend des comptes.

## Le roster

| Agent | Fichier | Rôle | Peut modifier le code ? |
|---|---|---|---|
| `frontend-dev` | `.claude/agents/frontend-dev.md` | Implémente UI, pages, styles, interactions | Oui |
| `backend-dev` | `.claude/agents/backend-dev.md` | Implémente logique serveur, données, API | Oui |
| `adversary` | `.claude/agents/adversary.md` | Attaque chaque livrable : cherche à le casser, à trouver les cas limites, les incohérences | **Non** (lecture seule) |
| `validator` | `.claude/agents/validator.md` | Juge raisonnement/logique : compare résultat vs mission d'origine, détecte la dérive de contexte, verdict PASS/FAIL | **Non** (lecture seule) |
| `qa-e2e` | `.claude/agents/qa-e2e.md` | Fait tourner le site dans un vrai navigateur, capture chaque étape, audite Technique → UI → UX | **Non** (lecture seule, sauf écriture de rapports) |

`adversary`, `validator` et `qa-e2e` sont volontairement **read-only** : un agent qui peut corriger son propre constat a toujours intérêt (même inconsciemment) à minimiser le problème. Ils constatent et argumentent ; ce sont `frontend-dev`/`backend-dev` (ou l'orchestrateur) qui corrigent.

## Comment une mission se distribue

1. L'orchestrateur découpe la mission en sous-tâches. Deux tâches sont **parallélisables** seulement si ni l'une ni l'autre ne dépend d'un fichier/résultat que l'autre produit.
2. Les tâches parallélisables sont lancées dans un seul message avec plusieurs appels `Agent` en parallèle (pas en série).
3. Chaque agent dev revient avec : ce qu'il a fait, les fichiers touchés, les hypothèses prises si la mission était ambiguë sur un détail mineur.
4. L'orchestrateur agrège, puis lance `adversary` sur l'ensemble du diff/résultat.

## Protocole de contestation (adversary)

- `adversary` reçoit la mission d'origine + le diff/résultat, jamais l'inverse (il ne doit pas être influencé par "ce que le dev pense avoir bien fait").
- Il liste ses objections, chacune classée **bloquante** ou **mineure**.
- Les objections bloquantes reviennent aux devs pour correction. Les mineures sont notées dans le rapport, corrigées si le temps le permet, sinon explicitement acceptées par l'utilisateur.
- Une fois les corrections faites, `adversary` est re-consulté sur le delta seulement (pas besoin de tout ré-attaquer si une partie n'a pas bougé).

## Protocole de validation (validator)

- `validator` reçoit **uniquement** la mission d'origine telle que formulée par l'utilisateur + le résultat final (pas le raisonnement des devs, pas les excuses).
- Il répond : la mission est-elle remplie, ni plus ni moins ? Y a-t-il de la dérive (fonctionnalités ajoutées non demandées, ou parties de la demande oubliées) ?
- Verdict `PASS` → on passe au test e2e réel. Verdict `FAIL` → retour aux devs avec la raison précise, incrémente le compteur de boucle (voir discipline dans `CLAUDE.md`, plafond 5 itérations).

## Test e2e réel (qa-e2e)

Ne s'improvise pas ad hoc : suit toujours la procédure du skill `test-e2e-loop` (`.claude/skills/test-e2e-loop/SKILL.md`), qui utilise l'outil Browser intégré à la session (navigation réelle, captures d'écran, lecture console/réseau). Se déclenche automatiquement dès que l'utilisateur dit "test e2e" ou équivalent, et systématiquement avant de déclarer une mission terminée.

## Règle d'arbitrage finale

En cas de désaccord entre `adversary` et un dev sur la sévérité d'un problème, l'orchestrateur tranche — mais ne peut pas ignorer une objection bloquante sans la présenter explicitement à l'utilisateur. On ne "vote" jamais pour faire taire l'adversaire : soit son objection est traitée, soit elle est remontée.
