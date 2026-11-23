# Audit performance / UX — site client Subito Pizza (24/11/2026)

## Périmètre

Mission : améliorer l'expérience client du site de commande en ligne Subito Pizza — **côté client uniquement** (`https://www.subito-pizza-heninbeaumont.fr/`), explicitement distinct de l'espace commerçant (`/commercant/`, exclu du périmètre). Travail en lecture seule sur la production : aucune commande réelle, aucun paiement déclenché.

## Parcours testés et parcours bloqués

**Testés en conditions réelles (production, navigateur) :**
- Arrivée sur l'accueil : affichage, console, réseau, Core Web Vitals (lab).
- Navigation menu, catégories (Pizzas, Pâtes, Subitowichs, Tex-Mex…).
- Sélection d'une pizza, choix de taille, ajout "telle quelle" au panier.
- Retour visuel immédiat (toast de confirmation + barre panier persistante).
- Ajouts répétés rapidement (triple clic) : vérification qu'aucun double-ajout erroné ne se produit, et que le total affiché reste exact (voir plus bas — fausse alerte corrigée par la lecture du code).
- Poids des pages, compression des scripts/CSS, dimensions réelles des photos vs. leur taille affichée.

**Testés en conditions réelles sur un serveur local (base en mémoire, jamais Supabase/production), jusqu'à la création d'une vraie commande de test — deuxième passage d'audit, plus complet :**
- Personnalisation complète d'une pizza (`menu.html` → "Personnaliser") : retrait d'un ingrédient (jambon), ajout d'un supplément viande (mortadelle) — l'échange gratuit viande-contre-viande est correctement détecté et étiqueté "(échange offert)", prix inchangé (16,00 €). Texte d'aide, suppléments par groupe (légumes/sauces 1,50 €, viandes-poissons-fromages 2,00 €, œuf 1,00 €), champ "Autre demande" libre : tout fonctionne et s'affiche clairement.
- Panier modal : sélection du mode (à emporter/livraison) obligatoire avant de pouvoir commander (bouton désactivé tant que rien n'est choisi, message explicite) ; message incitatif correct sur la promo ("Ajoutez encore 1 pizza : elle sera offerte…") ; mention claire "paiement sur place, rien à régler en ligne".
- Création de compte (prénom/nom/email/téléphone/mot de passe + confirmation, adresse facultative) : validation en direct (bordure rouge tant que la confirmation ne correspond pas), aucune perte des champs déjà saisis.
- **Reprise automatique de la commande après création de compte** : après la création du compte, la commande en attente part automatiquement (aucun second clic sur "Commander" nécessaire), redirection directe vers le suivi de commande (`commande.html?id=…`).
- Page de suivi : statut "En attente de confirmation du restaurant…", récapitulatif exact (article, exclusion, supplément, total), minuteur d'annulation (4 min) qui décompte correctement, bouton "Annuler ma commande".
- **Une seule commande créée**, vérifié via `customer_orders.php` après coup (`count: 1`) — aucun doublon malgré le passage par la création de compte puis la redirection automatique.
- Rechargement de la page de suivi : état identique, minuteur continue correctement (pas de réinitialisation, pas de régression d'affichage).
- Même parcours réaffiché en émulation mobile (375 px) : mise en page propre, rien ne déborde, cible tactile du bouton "Annuler" confortable.

Ce passage répond au point laissé en suspens lors du premier audit ("formulaire de commande non parcouru jusqu'au bout") — réalisé en local précisément pour pouvoir aller jusqu'à la création réelle d'une commande sans jamais toucher à la production, conformément à la consigne.

**Partiellement testés :**
- Personnalisation : une seule combinaison détaillée testée en profondeur (retrait + supplément viande) ; les autres combinaisons (moitié-moitié, changement de base, retrait de légume, etc.) n'ont pas été reparcourues manuellement une par une — déjà largement couvertes par la suite de tests automatisés du projet (`tests/api-vercel/*.test.mjs`, combinatoire pizza/tailles/promos), que j'ai fait tourner (225/226 verts, voir plus bas) plutôt que de les re-tester manuellement en double.
- Mode livraison (adresse, zone, frais) : non parcouru dans ce passage (testé uniquement "à emporter") ; la logique de zones/frais est couverte côté serveur par les tests automatisés, mais pas revérifiée ici à l'écran.

**Bloqués / non réalisables avec les outils disponibles :**
- Simulation d'une connexion ralentie (3G/4G throttlé) : aucun outil de cette session ne permet de limiter la bande passante du navigateur piloté. Les mesures ci-dessous sont donc des mesures de laboratoire sur une connexion normale, pas une simulation réseau dégradé.
- LCP (Largest Contentful Paint) exact : non récupérable via l'API Performance sur cette page (aucune entrée retournée a posteriori) — estimée indirectement via le First Contentful Paint (348 ms) et le temps de chargement complet (726 ms), tous deux très en dessous du seuil.

## Problèmes trouvés

### 1. Photos du menu bien plus lourdes que nécessaire (impact : modéré, poids de page / LCP sur le menu)
- **Page** : `menu.html` (et toute page utilisant `assets/img/photos/*.jpg`).
- **Constat mesuré** : plusieurs photos (ex. `photo-84.jpg`) faisaient jusqu'à 1206×1216 px, soit ~190 Ko, alors que le plus grand affichage réel mesuré (mobile 375 px, rétina ×2) ne nécessite que ~670 px de large. 52 des 92 photos du dossier étaient dans ce cas.
- **Corrigé** : redimensionnement ciblé à 700 px de long côté le plus grand (marge de sécurité au-dessus du besoin mobile mesuré), recompression JPEG qualité 0.82 — **uniquement quand le résultat est réellement plus léger que l'original** (40 photos déjà bien dimensionnées n'ont pas été touchées, pour ne jamais risquer de dégrader une image sans gain). Aucune dépendance ajoutée : le redimensionnement a été fait via l'API Canvas du navigateur (script jetable, supprimé après usage), l'installation d'un paquet comme `sharp` ayant été refusée par le mode automatique de cette session.
- **Preuve** : 7,01 Mo → 5,96 Mo sur le dossier (-15 %), vérifié visuellement (capture d'écran avant/après, zéro artefact visible à la taille d'affichage réelle) et en conditions réelles sur `menu.html` (serveur local).

### 2. Fausse alerte écartée : total du panier "incohérent" après ajouts multiples
En testant des clics rapides répétés sur "Ajouter telle quelle" (4 pizzas identiques à 16,00 € ajoutées), le total affiché passait à 32,00 € au lieu des 64,00 € attendus (4 × 16). **Ce n'est pas un bug** : c'est la promotion "1 pizza achetée = 1 offerte" (à emporter), déjà annoncée sur le site et codée dans `pizzaPromo()` (`assets/js/cart.js`) — avec 4 pizzas identiques, 2 sont logiquement offertes (32 € de remise), total net 32 €. Vérifié en lisant le calcul (appariement prix décroissant par paires, la moins chère de chaque paire offerte) : le calcul est exact. Je le documente ici pour éviter qu'un futur audit ne reparte sur la même fausse piste.

## Corrections réalisées et fichiers modifiés

| Fichier | Changement |
|---|---|
| `assets/img/photos/*.jpg` (52 fichiers) | Redimensionnés/recompressés (voir ci-dessus) |

Aucun fichier de code modifié dans ce passage — le seul changement est sur les images statiques. Aucun test automatisé à ajuster (rien de comportemental n'a changé).

## Résultats des tests après correction

- Suite complète du projet (`node --test tests/api-vercel/*.test.mjs`) : relancée après la modification des images, pour confirmer l'absence de régression — résultat reporté dans le commit (225/226, le seul échec étant le faux positif CRLF déjà connu et documenté dans le dépôt, sans rapport avec ce changement).
- Vérification visuelle manuelle : `menu.html` servi en local avec les nouvelles images — rendu identique à l'original, aucune perte de netteté perceptible.
- Parcours ajout au panier re-testé après la correction des images (sans rapport direct, mais dans la même session de test) : fonctionne correctement, total exact compte tenu de la promotion.

## Mesures avant / après

**Conditions de mesure** : navigateur piloté (Claude Browser pane), connexion normale (pas de throttling simulé — limite d'outillage, voir "parcours bloqués"), production réelle (`www.subito-pizza-heninbeaumont.fr`), mesures de laboratoire via l'API Performance du navigateur — **pas des données d'utilisateurs réels (CrUX)**.

| Mesure | Avant | Après |
|---|---|---|
| Poids total `assets/img/photos/` | 7,01 Mo | 5,96 Mo (-15 %) |
| Accueil — TTFB | 143 ms | inchangé (page non modifiée) |
| Accueil — First Contentful Paint | 348 ms | inchangé |
| Accueil — chargement complet (`load`) | 726 ms | inchangé |
| Accueil — CLS cumulé | 0 | inchangé |
| `cart.js` transféré (Brotli) | 40,5 Ko | inchangé (déjà bien compressé) |

Les pages testées (accueil, menu) étaient déjà, avant toute correction, largement sous les seuils Core Web Vitals (LCP, INP, CLS) — la compression Brotli est déjà active sur Vercel pour tous les scripts/CSS, et le JavaScript n'est pas anormalement lourd. **Je n'affirme pas que le score Lighthouse ou ces mesures de laboratoire garantissent la même rapidité pour tous les clients réels** (réseau, appareil, conditions variables) — seule une mesure en conditions réelles (CrUX, Vercel Analytics…) le confirmerait, non disponible dans cette session.

## Problèmes restants, classés par urgence

1. **Faible — mode livraison non reparcouru à l'écran dans ce passage** (adresse, zone, frais, moyen de paiement à la livraison). Testé uniquement côté "à emporter" lors de la vérification manuelle complète ; la logique de zones/frais reste couverte par les tests automatisés serveur, mais pas revérifiée pas-à-pas à l'écran.
2. **Faible — pas de mesure en réseau dégradé.** Aucun outil de cette session ne permet de simuler une connexion lente ; si le client cible un public avec une connexion mobile fréquemment faible, une mesure WebPageTest ou Lighthouse en mode "Slow 4G" apporterait un signal que je n'ai pas pu produire ici.
3. **Très faible — 40 photos sur 92 n'ont pas pu être allégées** (déjà à une taille raisonnable ou dont la recompression Canvas n'apportait aucun gain) ; aucune action nécessaire, signalé pour mémoire.
4. **Non évalué — formats d'image modernes (WebP/AVIF).** Les 92 photos restent au format JPEG ; un passage à WebP apporterait un gain supplémentaire mais représente un changement plus large (génération de variantes, `<picture>`/`srcset`, décision de compatibilité navigateur) que je n'ai pas engagé dans ce passage ciblé — à envisager si la performance mobile devient un sujet prioritaire.

## Ce qui a été observé vs. supposé

**Observé directement** (mesuré, reproduit, vérifié) : poids des images avant/après, dimensions réelles vs. affichées, Core Web Vitals de laboratoire sur l'accueil, absence d'erreur console sur l'accueil et le menu, comportement correct du panier (ajout, clics répétés, promo), parcours complet de commande "à emporter" jusqu'à une vraie commande de test en local (personnalisation, création de compte, reprise automatique, suivi, absence de doublon, persistance au rechargement, rendu mobile).

**Supposé / non vérifié** : parcours livraison (adresse, zone, frais) à l'écran — couvert côté serveur par les tests automatisés, pas revérifié manuellement ici ; comportement du formulaire face à une vraie erreur réseau en plein envoi (coupure simulée non réalisée) ; performance sur connexion mobile dégradée ; rendu sur l'ensemble des navigateurs/appareils (testé uniquement sous Chromium piloté, desktop et émulation mobile 375 px).

Je n'affirme pas que le site est "sans bug" au-delà de ce qui a été vérifié ci-dessus.
