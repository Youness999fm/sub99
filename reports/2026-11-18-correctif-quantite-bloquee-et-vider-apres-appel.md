# Mission — Correctif critique (+/- bloqué), écran trop pris par le pied, vider le panier après l'appel

## Signalement
Après la mission précédente (plein écran + fluidité), le client remonte 3 problèmes :
1. En ouvrant le récapitulatif avec plusieurs pizzas, impossible de bien voir/gérer la liste : « ça m'affiche plus le dessous ».
2. Bug réel : en appuyant plusieurs fois sur "−" pour baisser la quantité d'une pizza, **ça se bloque après le premier appui**.
3. Nouvelle demande : quand le client a appelé pour commander, que le panier se vide tout seul, pour ne pas avoir à le refaire à la prochaine visite.

## Cause réelle du bug (confirmée, pas supposée)
C'est une régression introduite par le correctif de fluidité de la mission précédente. Pour éviter de reconstruire toute la liste à chaque +/-, les boutons gardent leurs gestionnaires de clic d'origine au lieu d'être recréés à chaque fois. Mais ces gestionnaires avaient été écrits en se basant sur la quantité *telle qu'elle était au moment de l'affichage initial* (`line.qty`), jamais mise à jour ensuite. Résultat : le premier clic fonctionne (3 → 2), mais le deuxième clic recalcule à partir de ce même chiffre périmé (qui dit toujours "3"), donc redemande "2" au lieu de "1" : plus aucun effet visible, ça semble bloqué.

**Corrigé** : chaque clic relit maintenant la quantité réellement enregistrée au moment même du clic, plus jamais une valeur figée.

## Cause réelle du problème d'affichage (confirmée)
Le pied du récapitulatif (sous-total, promo, bouton Appeler, Copier/Envoyer, les 2 mentions explicatives, "Vider le panier") était toujours affiché en entier et en permanence à l'écran. Avec tout ce contenu, il prenait plus de la moitié de la hauteur de l'écran sur téléphone, ne laissant qu'une toute petite fenêtre (vérifié : à peine 215 pixels sur un écran de 812) pour voir et toucher la liste des pizzas — d'où l'impression de ne plus rien voir en dessous.

## Correctifs
- **`assets/js/cart.js`** : les boutons +/- relisent toujours la quantité actuelle avant de l'ajuster (fin du blocage après le premier appui).
- **`assets/js/cart.js` + `assets/css/cart.css`** : le pied fixe du récapitulatif ne garde plus que l'essentiel toujours visible — le total et le bouton "Appeler pour commander". Tout le reste (sous-total, remise, nudge, Copier/Envoyer, mentions, Vider le panier) défile désormais avec la liste des pizzas, juste en dessous. Résultat : la liste des pizzas dispose de presque tout l'écran pour que le client puisse facilement voir et ajuster ce qu'il a pris.
- **`assets/js/cart.js`** : après un appui sur "Appeler pour commander", si le client revient ensuite sur l'onglet (signe qu'il a quitté la page pour son téléphone), le site lui demande "Commande bien passée au téléphone ? On vide votre panier pour la prochaine fois." Une confirmation plutôt qu'un vidage automatique silencieux : un site web ne peut techniquement pas savoir si l'appel a vraiment abouti (il peut avoir raccroché, changé d'avis, ou juste changé d'onglet sans raison) — vider sans demander risquerait d'effacer une commande que le client a mis du temps à préparer. Un "Oui" suffit pour tout vider.

## Vérifications réellement effectuées (serveur local, viewport mobile 375×812 puis desktop)
- Reproduction du scénario exact signalé : 5 pizzas/articles dans le panier, appui répété sur "−" d'une ligne à 4 → vérifié par script que le chiffre descend bien à chaque appui (4 → 3 → 2 → 1 → suppression), plus aucun blocage.
- Avec 5 articles dans le panier, les 5 lignes sont maintenant visibles quasiment sans défiler (avant : seulement 2 lignes visibles, le reste caché par un pied trop grand).
- Défilement jusqu'en bas : sous-total, remise, bouton Copier, mentions, "Vider le panier" s'affichent bien à la suite de la liste ; le total et "Appeler pour commander" restent fixes et visibles en bas à tout moment.
- Simulation complète du scénario "appel puis retour sur l'onglet" : le message de confirmation s'affiche avec le bon texte ; en répondant "Oui" le panier se vide réellement ; en répondant "Non" le panier reste intact ; sans avoir appuyé sur "Appeler" au préalable, revenir sur l'onglet ne déclenche aucune demande.
- Desktop (fenêtre large) : le récapitulatif reste une carte centrée classique, inchangée.
- Aucune erreur console. `node --check` : syntaxe valide.

## Verdict
Bug critique corrigé et vérifié en conditions réelles (pas seulement relu). Problème d'affichage résolu avec une vraie mesure de l'espace disponible avant/après. Nouvelle fonctionnalité livrée avec un choix de sécurité (confirmation) expliqué ci-dessus. **PASS.**

## À republier
`assets/js/cart.js`, `assets/css/cart.css`, par FTP.
