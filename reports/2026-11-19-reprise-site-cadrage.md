# Mission — Reprise du site : démarrage et cadrage

Statut : **cadrage terminé, en attente de réponse sur la première étape. Aucun code modifié.**

## Demande
« Démarre » : lancer la reprise du site Subito Pizza Hénin-Beaumont (dépôt `sub99`), après la décision sur la carte client d'une pizza indisponible.

Règle décidée pour le site client :
- la pizza reste visible, **grisée**, **non commandable** ;
- elle porte un **petit pansement** et la mention **« Victime de son succès »** ;
- le mot « rupture » n'apparaît jamais côté client ;
- pour une garniture au choix (Calzone : jambon, thon, kebab, viande hachée, poulet), seule la garniture indisponible disparaît du choix ; la Calzone reste commandable tant qu'une garniture reste ;
- la tablette commerçant (`commercant/`) garde « Indisponible » : cycle séparé.

## Constat sur le dépôt (19/11/2026)
- **Commande en ligne, comptes clients, livraison** : interfaces faites côté navigateur et testées avec des réponses d'API simulées (rapports du 19/11). **Le backend n'existe pas encore** : le dossier `api/` ne contient que deux fichiers de test.
- **Aucune notion de disponibilité des pizzas côté site.** Seul un texte statique dit que les pâtes et salades peuvent être temporairement indisponibles (`menu.html`).
- **Beaucoup de fichiers modifiés ou non commités** (plusieurs sessions travaillent sur le dépôt). Pour éviter les conflits, la première étape ne touchera qu'aux fichiers qu'elle nomme.
- **À retirer avant la mise en ligne** : `api/_phpinfo.php` (affiche la configuration du serveur) et `api/_dbtest.php` (test de connexion à la base). Ils servent peut-être aux tests d'hébergement : je ne les supprime pas sans votre accord.

## Proposition pour la première étape (à confirmer)
Affichage client de la disponibilité, **sans backend** :
1. Une source de disponibilité en fichier statique, `assets/data/disponibilite.json` : liste des pizzas et des ingrédients indisponibles, mise à jour à la main pour l'instant. Elle sera remplacée par l'API à l'étape de connexion.
2. Menu (`menu.html`) : carte grisée, pansement, « Victime de son succès », non commandable.
3. Calzone : seule la garniture indisponible disparaît du choix.
4. Aucun changement de la tablette commerçant.

## Questions bloquantes
1. La première étape est-elle bien l'affichage client de la disponibilité, avec le fichier statique comme source en attendant le backend ?
2. Qui mettra à jour ce fichier au quotidien, en attendant la connexion ? (Par défaut : vous ou l'équipe, à la main.)

## Méthode (CLAUDE.md du dépôt)
Découpage, contestation par un agent adversaire, validation par un agent juge, test réel dans le navigateur avec captures, puis rapport final dans ce dossier. Aucune mission n'est « terminée » sans ces preuves.
