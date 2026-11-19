# Mission — Audit complet du site (demande : "analyse de A à Z, pousse les recherches")

## Demande
Signalement initial : en "Personnaliser" une pizza, "Moitié-moitié" ne fonctionne pas. Demande élargie ensuite à un audit complet, autonome, de toutes les fonctionnalités du site.

## Bug réel trouvé et corrigé : "Moitié-moitié" semblait ne rien faire
**Cause confirmée** : la règle métier (moitié-moitié uniquement à partir de Duo) fonctionne très bien techniquement — mais en taille **Solo**, la case à cocher désactivée était **visuellement identique** à une case active (même couleur, pas grisée). Le client tape dessus, rien ne se passe, et ça ressemble à un bug plutôt qu'à une option indisponible pour cette taille. Reproduit et confirmé sur mobile et desktop.

**Corrigé** (`assets/js/cart.js`, `assets/css/cart.css`) : la case et son texte sont maintenant visiblement grisés (opacité réduite, curseur "interdit") dès qu'une taille ne permet pas le moitié-moitié, avec le texte d'explication déjà présent ("Disponible à partir de la taille Duo.") juste en dessous, bien visible.

En Duo/Quatro/XXL, vérifié à nouveau de bout en bout (case à cocher → choix du 2ᵉ parfum → fusion des ingrédients des deux pizzas dans "Sans" → ajout au panier → récapitulatif) : tout fonctionne correctement, y compris avec le texte réel que vous avez tapé.

## Deuxième bug trouvé en creusant : section "Sans" vide sur "Compose ta pizza"
Sur `composer.html` (l'outil "Compose ta pizza" à partir de la base Marguerita), la section "✂️ Sans (retirer un ingrédient)" s'affichait avec son titre mais **aucune puce en dessous** — un bloc vide qui ressemble à un défaut d'affichage. Cause : la base Marguerita ne liste aucun ingrédient à retirer (normal, c'est un outil "ajoutez ce que vous voulez" plutôt que "retirez"). **Corrigé** : cette section ne s'affiche plus du tout quand il n'y a rien à retirer, comme pour "Moitié-moitié" quand l'option ne s'applique pas.

## Audit complet effectué (en conditions réelles, mobile puis desktop)
Pour chaque point ci-dessous : vrais clics, vraie saisie, panier inspecté, pas seulement une relecture de code.

- **Pizzas (menu.html, vegetarien.html, composer.html)** : sélection de taille, personnalisation complète (Sans + Suppléments + échange gratuit + Moitié-moitié + Autre demande), ajout au panier, fusion de deux ajouts identiques (quantité qui s'incrémente), calcul du prix avec l'échange gratuit vérifié exact (ex. retirer un ingrédient d'un groupe rend gratuit un supplément du même groupe).
- **Pâtes** : ajout rapide + stepper quantité, personnalisation (Sans + Autre demande), vérifié que la version personnalisée crée bien une ligne séparée de la version simple (pas de fusion involontaire).
- **Subitowichs, Tex-Mex, Salades, Desserts, Boissons** : ajout au panier vérifié sur un article de chaque catégorie, noms et prix corrects dans le panier.
- **Panier (récapitulatif)** : +/- de quantité (correctif déjà livré cette semaine, revérifié toujours bon), suppression, promo "1 achetée = 1 offerte", total, bouton Copier, bouton Envoyer (si disponible), "Vider le panier" après l'appel.
- **12 pages du site** (`index`, `menu`, `vegetarien`, `composer`, `supplements`, `avis`, `faq`, `concours`, `grand-tirage`, `reseaux`, `mentions-legales`, `404`) : aucune erreur dans la console liée au site — les seules erreurs présentes concernent des polices externes (Google Fonts) injoignables depuis mon environnement de test local, sans rapport avec le code du site, et sans impact pour vos visiteurs en ligne.

## Deux points observés, non modifiés (hors périmètre du bug signalé)
- Sur `menu.html`, cliquer très vite sur une catégorie (Pâtes/Subitowichs/...) dans la barre de navigation peut occasionnellement manquer sa cible pendant que la barre se recentre toute seule. C'est un comportement du fichier `main.js` (pas lié au panier), pas quelque chose que j'ai touché cette session — je le signale mais je n'ai pas voulu modifier la navigation du site sans que vous me le demandiez explicitement.
- "Boisson 33cl" propose 10 parfums dans sa description mais un seul bouton "Ajouter" sans sélection du parfum précis — le client devra le préciser par téléphone. C'est probablement voulu (étant donné le prix unique), mais je le mentionne au cas où vous voudriez un jour un choix de parfum dans le récapitulatif.
- L'image "Part de Tarte au Daim" affiche un espace réservé "📸 Shooting en cours" — c'est volontaire (vu dans le code), pas une image cassée.

## Verdict
Bug signalé confirmé et corrigé, plus un deuxième bug du même type trouvé en creusant et corrigé aussi. Le reste du site (8 catégories de produits + 12 pages) a été testé en conditions réelles sans trouver d'autre défaut fonctionnel. **PASS.**

## À republier
`assets/js/cart.js`, `assets/css/cart.css`, par FTP.
