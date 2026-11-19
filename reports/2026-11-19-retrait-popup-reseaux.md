# Mission — Retrait du pop-up "réseaux sociaux"

## Demande
Enlever le pop-up qui invite à suivre Subito Pizza sur les réseaux sociaux (TikTok/Snapchat), présent sur plusieurs pages.

## Ce qui a été fait
Retiré proprement (balisage, script et feuille de style) des 6 pages qui le chargeaient : `menu.html`, `composer.html`, `supplements.html`, `vegetarien.html`, `avis.html`, `faq.html`. Le nouveau pop-up "Commandez en ligne" (page d'accueil uniquement) n'est pas concerné, c'est un fichier totalement séparé.

Les fichiers `assets/js/subito-popup.js` et `assets/css/subito-popup.css` n'ont pas été supprimés du dépôt (juste débranchés de toutes les pages) — à dire si vous voulez que je les supprime aussi, ou les garder au cas où.

## Vérifications réellement effectuées
- Les 6 pages ne référencent plus aucun fichier ni balisage lié au pop-up (vérifié par recherche).
- Menu.html rechargé : aucune trace du pop-up dans la page, aucune nouvelle erreur de console.

## Verdict
**PASS.**

## À republier
`menu.html`, `composer.html`, `supplements.html`, `vegetarien.html`, `avis.html`, `faq.html`.
