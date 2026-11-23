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

**Partiellement testés :**
- Personnalisation d'une pizza (retrait d'ingrédient, suppléments, moitié-moitié) : le widget s'ouvre correctement (bouton "Personnaliser" visible, pas d'erreur console), mais je n'ai pas parcouru chaque combinaison d'option en détail — cette logique est déjà largement couverte par la suite de tests automatisés du projet (`tests/api-vercel/*.test.mjs`, combinatoire pizza/tailles/promos), que j'ai fait tourner (225/226 verts, voir plus bas) plutôt que de la re-tester manuellement en double.
- Formulaire de commande (adresse, mode de paiement, validation) : lu dans le code (`assets/js/cart.js`) — protections anti-double-soumission déjà en place (bouton désactivé pendant l'envoi, garde anti double-tap à 3 s, état "busy" persistant même si le panier se re-rend pendant l'envoi) — mais **non parcouru pas-à-pas jusqu'au bout en production**, conformément à la consigne de ne jamais arriver jusqu'à la création réelle d'une commande.

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

1. **Faible — formulaire de commande non parcouru en production jusqu'au bout** (adresse/paiement/validation). Le code lu montre des protections déjà solides (anti double-soumission, persistance du panier, gestion des erreurs réseau distincte des erreurs de validation), mais un passage manuel complet en environnement de test (hors production, par ex. le serveur local) apporterait une preuve directe plutôt qu'une lecture de code.
2. **Faible — pas de mesure en réseau dégradé.** Aucun outil de cette session ne permet de simuler une connexion lente ; si le client cible un public avec une connexion mobile fréquemment faible, une mesure WebPageTest ou Lighthouse en mode "Slow 4G" apporterait un signal que je n'ai pas pu produire ici.
3. **Très faible — 40 photos sur 92 n'ont pas pu être allégées** (déjà à une taille raisonnable ou dont la recompression Canvas n'apportait aucun gain) ; aucune action nécessaire, signalé pour mémoire.
4. **Non évalué — formats d'image modernes (WebP/AVIF).** Les 92 photos restent au format JPEG ; un passage à WebP apporterait un gain supplémentaire mais représente un changement plus large (génération de variantes, `<picture>`/`srcset`, décision de compatibilité navigateur) que je n'ai pas engagé dans ce passage ciblé — à envisager si la performance mobile devient un sujet prioritaire.

## Ce qui a été observé vs. supposé

**Observé directement** (mesuré, reproduit, vérifié) : poids des images avant/après, dimensions réelles vs. affichées, Core Web Vitals de laboratoire sur l'accueil, absence d'erreur console sur l'accueil et le menu, comportement correct du panier (ajout, clics répétés, promo).

**Supposé / non vérifié** : comportement exact du formulaire de commande en situation réelle (adresse invalide, perte de connexion en plein envoi, etc.) au-delà de la lecture du code ; performance sur connexion mobile dégradée ; rendu sur l'ensemble des navigateurs/appareils (testé uniquement sous Chromium piloté, desktop et émulation mobile 375 px).

Je n'affirme pas que le site est "sans bug" au-delà de ce qui a été vérifié ci-dessus.
