# Espace commerçant — maquette (étape 1 : interface seule)

## Demandé
Interface de gestion pour Subito N1, trois espaces : Commandes (écran par défaut), Disponibilité des produits, Espace patron (Clients + Recette du jour). Maquette uniquement : aucune connexion aux commandes, comptes, menu, API, base, localStorage, sessionStorage, cookies ni imprimante. Données de démonstration clairement identifiées. Parcours client inchangé.

## Fait
- `commercant/index.html` : trois espaces dans la barre du haut ; l'ancien onglet « Acceptées aujourd'hui » est devenu une partie de l'Espace patron.
- Commandes : file à traiter, détail (articles, options, remarques, total, client, retrait au commerce), Accepter → choix 20 / 30 / 40 / 50 min ou 1 heure, Refuser avec confirmation. Alerte sonore et visuelle tant que la commande est « nouvelle ». Aperçu d'impression marqué « MAQUETTE — aucun ticket n'est imprimé ».
- Disponibilité : trois états (Disponible, Rupture aujourd'hui, Rupture jusqu'à réactivation), changement visuel temporaire.
- Espace patron, sous-onglets « Recette du jour » et « Clients » (séparés).
  - Recette : commandes acceptées, total (refusées exclues), copier (presse-papiers réel), imprimer (aperçu simulé), enregistrer en image (simulé), effacer avec confirmation (ne touche pas aux clients).
  - Clients : liste fictive, recherche par nom, fiche avec seuls les champs fournis. Aucun mot de passe, jeton ou donnée de paiement.
- Remise à zéro quotidienne (heure de Paris) : recette et ruptures « aujourd'hui » uniquement ; les clients ne sont pas concernés.
- `assets/css/commercant.css`, `assets/js/commercant.js` : styles et logique de la maquette.

## Vérification
- Syntaxe JS validée (`node --check`).
- Testé dans le navigateur intégré via serveur local (port 8090) : création de commandes démo, navigation entre espaces, recherche/sélection client, recette sur téléphone (375 px).
- Correctif trouvé et appliqué : sur téléphone, la grille de la recette était écrasée par une règle de tablette, et les onglets débordaient.

## Non fait / à noter
- Agents adversaire, juge et QA e2e (CLAUDE.md) non lancés : cette passe est une maquette sans logique métier.
- Pas de captures de chaque étape ni d'audit complet tablette/téléphone.
- Les fichiers ont été modifiés pendant la session par une autre source (écran plein format « Traiter », rangs dans la file). Ces modifications ont été conservées, non annulées.
- Aucune connexion réelle : commandes, comptes, menu, synchronisation et impression SUNMI restent à faire à l'étape suivante.
