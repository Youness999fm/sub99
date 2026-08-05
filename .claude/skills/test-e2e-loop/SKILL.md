---
name: test-e2e-loop
description: Boucle de test end-to-end réelle dans un navigateur, avec capture d'écran à chaque étape, audit Technique → UI → UX, correction et re-test jusqu'à validation complète (boucle bornée à 5 itérations, avec escalade si ça ne converge pas). Se déclenche systématiquement quand l'utilisateur dit "test e2e", "teste en réel", "valide sur le site/le web", ou avant de déclarer terminée toute mission qui touche à ce que l'utilisateur voit ou manipule dans le navigateur.
---

# Boucle de test e2e réel

Cette procédure ne se fait jamais "à moitié". Elle utilise le navigateur intégré à la session (`mcp__Claude_Browser__*`) — pas de suite de test simulée, pas d'audit basé uniquement sur la lecture du code.

## Pré-requis

- Avoir une mission clairement formulée (ce qui doit être vrai à la fin).
- L'app doit être accessible : si c'est un projet local, démarre-la avec `preview_start` (utilise ou crée `.claude/launch.json` si besoin) ; si c'est un site déjà en ligne, `navigate` directement.
- Un compteur d'itération à 0, et un fichier de suivi `reports/e2e-<slug-mission>.md` où chaque tour vient s'ajouter (ne pas écraser les tours précédents — ça sert de trace de ce qui a déjà été essayé).

## Boucle (max 5 itérations)

Incrémente le compteur à chaque passage par l'étape 1. **Avant chaque itération, relis la formulation d'origine de la mission** — pas la version que tu as en tête après plusieurs tours, la vraie demande initiale. Ça évite la dérive de contexte sur une boucle longue.

### 1. Exécution réelle + capture

Pour chaque étape clé du parcours utilisateur concerné (ex : arriver sur la page, remplir un formulaire, cliquer, voir le résultat) :
- Agis réellement via `computer` (clicks, type, scroll…) ou `navigate`/`form_input`.
- Prends une capture d'écran (`computer` action `screenshot`) juste après l'action, avant de passer à la suivante.
- Numérote les étapes (Étape 1, Étape 2…) pour pouvoir y référer dans l'audit.

Teste au minimum le chemin nominal (golden path) et un cas limite pertinent à la mission (champ vide, erreur réseau simulée, mauvaise saisie…).

### 2. Audit — dans cet ordre strict, jamais dans le désordre

**a. Technique** — avant même de regarder l'image :
- `read_console_messages` (filtre erreurs) : aucune nouvelle erreur JS non expliquée.
- `read_network_requests` : pas de requête en échec (4xx/5xx) ou anormalement lente sur le parcours testé.

**b. UI** — en regardant chaque capture :
- Rendu correct (pas d'élément cassé, chevauchement, texte tronqué, image manquante).
- Responsive : reprends le parcours critique en `resize_window` mobile (375x812) si la mission touche une page publique/utilisateur final, pas seulement en desktop.
- Cohérence visuelle avec le reste du site (espacement, typographie, couleurs) si un design existant est à respecter.

**c. UX** — en te mettant à la place d'un utilisateur réel :
- Le parcours est-il compréhensible sans explication ?
- Y a-t-il un feedback pour chaque action (chargement, succès, erreur) ?
- Combien d'étapes/clics superflus par rapport au nécessaire ?

Note chaque problème trouvé avec : l'étape concernée, la catégorie (Technique/UI/UX), la sévérité (bloquant/mineur), et une description assez précise pour qu'un dev corrige sans deviner.

### 3. Verdict de l'itération

- **Aucun problème bloquant** → mission validée en e2e. Passe à la section "Sortie — succès".
- **Au moins un problème bloquant** → passe à l'étape 4.

### 4. Correction ciblée

- Envoie les problèmes bloquants (pas la liste complète, juste eux) au(x) agent(s) `frontend-dev`/`backend-dev` concerné(s), avec l'étape et la capture en référence.
- N'élargis pas le périmètre pendant la correction : on corrige ce que l'audit a trouvé, pas d'occasion pour "améliorer" autre chose au passage (sinon ça relance un besoin de re-validation par `adversary`/`validator` sur du hors-scope).
- Une fois corrigé, retourne à l'étape 1 pour un nouveau tour (compteur +1).

## Sortie — succès

- Consigne dans `reports/e2e-<slug-mission>.md` : liste des étapes testées, captures référencées, verdict Technique/UI/UX, nombre d'itérations effectuées.
- Annonce à l'utilisateur que la mission est validée en e2e réel, avec un résumé court (pas besoin de recoller toutes les captures dans le message — le rapport suffit, mentionne juste les points notables trouvés puis corrigés).

## Sortie — plafond atteint (5 itérations sans validation)

Ne continue **jamais** au-delà de 5 tours en silence. À la 5e itération sans PASS :
- Arrête la boucle.
- Écris dans le rapport ce qui bloque encore précisément, et ce qui a été essayé aux tours précédents (pour ne pas répéter les mêmes tentatives dans une session future).
- Remonte clairement à l'utilisateur : quel est le problème persistant, pourquoi les tentatives précédentes n'ont pas suffi, et une hypothèse sur la cause (ex : la mission est peut-être mal cadrée, ou il y a une dépendance externe cassée) plutôt que de continuer à boucler à l'aveugle.
