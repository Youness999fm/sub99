# Mission — Petit mot d'excuse en cas de retard (page de suivi)

## Demande
Quand le minuteur arrive à zéro sur la page de suivi de commande, afficher une phrase sympathique demandant de ne pas en vouloir en cas de retard — différente pour le retrait ("on fait notre maximum") et la livraison ("ne pas en vouloir au livreur, il arrive").

## Ce qui a été fait
Dans `commande.html`, dès que le minuteur affiche "C'est prêt !", un encadré doré apparaît juste en dessous avec le bon message selon le mode :
- **À emporter** : *"🙏 S'il y a un peu de retard, ne nous en voulez pas — on fait notre maximum pour que ce soit toujours aussi bon !"*
- **Livraison** : *"🙏 S'il y a un peu de retard, ne nous en voulez pas — votre livreur arrive, promis !"*

Il reste bien caché tant que le délai n'est pas écoulé (vérifié) — jamais annoncé à l'avance, seulement si le temps est dépassé.

## Vérifications réellement effectuées
- Mode livraison, commande déjà en retard (simulé) : bon message affiché.
- Mode à emporter, même scénario : bon message affiché.
- Commande en cours (minuteur encore à 5:00) : message bien caché.
- Aucune nouvelle erreur de console.

## Verdict
**PASS.**

## À republier
`assets/js/commande.js`, `assets/css/commande.css`.
