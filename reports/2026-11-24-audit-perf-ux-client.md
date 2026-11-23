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

**Troisième passage ("retravaille au maximum, pousse et teste au max") : mode livraison testé à l'écran jusqu'au bout — un vrai bug trouvé et corrigé :**
- Parcours livraison complet : panier → "Livraison" → question sauce piquante → zone/minimum vérifiés en direct ("✓ Livraison disponible à Hénin-Beaumont (minimum 10,00 €)") → livraison gratuite correctement appliquée (une pizza dans le panier) → choix du moyen de paiement (carte, espèces avec montant du billet, ticket restaurant, carte ticket restaurant, plusieurs combinables) → création de compte avec adresse de livraison.
- **Bug trouvé et corrigé** (voir "Problèmes trouvés" #3) : après la reprise automatique de la commande suite à la création de compte, si le moyen de paiement n'avait pas encore été choisi, le message d'erreur "Choisissez au moins un moyen de paiement pour la livraison" restait affiché même après que le client ait choisi un moyen de paiement — jusqu'à ce qu'il clique une seconde fois sur "Commander en ligne". Corrigé : le message s'efface dès que le client agit sur le paiement.
- Après correction : commande livraison créée du premier clic, moyen de paiement (carte bancaire) correctement enregistré et affiché sur le suivi.

**Quatrième passage ("retravaille au max des max jusqu'à tu trouve 0 erreur") : panier (quantités/suppression), commande programmée — le bug le plus sérieux du dossier trouvé et corrigé :**
- Panier : diminution de quantité (2 → 1, total recalculé juste), suppression d'une ligne (icône corbeille), diminution jusqu'à 0 (retire la ligne automatiquement, état panier vide propre et accueillant : "Votre panier est vide pour le moment — parcourez la carte et ajoutez vos envies 🍕"). Recalcul de la promo vérifié à chaque étape (toujours exact).
- **Bug trouvé et corrigé, le plus sérieux de l'audit** (voir "Problèmes trouvés" #4) : une commande programmée ("Plus tard", jour + heure choisis) **perdait silencieusement son créneau** si le client n'était pas encore connecté au moment de valider — elle repartait "dès que possible" sans que rien ne le signale, ni avant l'envoi ni sur le suivi. Reproduit très concrètement : créneau "demain 19h30" choisi, commande créée malgré tout en commande immédiate (`scheduled_for: null` côté serveur, vérifié par l'API).
- Après correction : même parcours rejoué à l'identique, le suivi affiche "⏰ Commande programmée pour demain à 19:30" et `scheduled_for` contient bien l'horaire choisi côté serveur.
- Composer.html (page dédiée "composer sa pizza") : chargement sans erreur console, accessible depuis le menu.

**Partiellement testés :**
- Personnalisation : une seule combinaison détaillée testée en profondeur (retrait + supplément viande) ; les autres combinaisons (moitié-moitié, changement de base, retrait de légume, etc.) n'ont pas été reparcourues manuellement une par une — déjà largement couvertes par la suite de tests automatisés du projet (`tests/api-vercel/*.test.mjs`, combinatoire pizza/tailles/promos), que j'ai fait tourner (225/226 verts, voir plus bas) plutôt que de les re-tester manuellement en double.
- Zones de livraison hors Hénin-Beaumont (frais, minimum différents par ville) : non reparcourues une par une à l'écran — une seule ville testée directement ; la logique est couverte côté serveur par les tests automatisés.
- Composer.html : page ouverte et vérifiée sans erreur, mais le parcours de composition complet (choix base, ingrédients, ajout au panier) n'a pas été rejoué en détail — couvert par les tests automatisés serveur (mêmes fonctions de calcul que menu.html).
- vegetarien.html, avis.html, faq.html, reseaux.html : non visitées dans cet audit.

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

### 3. Message d'erreur du paiement livraison qui reste affiché après correction (impact : faible-modéré, confusion possible au moment de payer)
- **Page** : `menu.html`/`composer.html`/`vegetarien.html` (partout où le panier de livraison s'ouvre), étape paiement.
- **Étapes de reproduction** : panier avec au moins 1 pizza → "Livraison" → créer un compte avec une adresse de livraison **sans encore choisir de moyen de paiement** → la commande en attente est reprise automatiquement après l'inscription, échoue avec "Choisissez au moins un moyen de paiement pour la livraison" → le client choisit alors un moyen de paiement (ex. carte bancaire) → **le message d'erreur reste affiché**, alors que le problème est résolu.
- **Impact** : le bouton "Commander en ligne" fonctionne en réalité dès ce moment (il n'est jamais désactivé), mais le message laisse croire au client que son choix n'a pas été pris en compte — risque d'hésitation, de clics répétés inutiles, ou d'appel téléphonique évitable. Pas de commande bloquée ni de prix faux.
- **Cause** : `setOrderStatus()` (`assets/js/cart.js`) mémorise le dernier message pour qu'il survive aux rafraîchissements pendant un envoi en cours (comportement voulu, pour ne jamais perdre une erreur "pending") — mais rien ne l'effaçait quand le client changeait justement le moyen de paiement ou le montant du billet qui avait causé l'erreur.
- **Corrigé** : `assets/js/cart.js`, `wirePaymentMethodEvents()` — le message d'erreur s'efface dès que le client clique sur un moyen de paiement ou un montant de billet, sans toucher à un message "pending" (envoi en cours) ni à une erreur sans rapport avec le paiement.
- **Preuve** : reproduit puis corrigé en local (base en mémoire) ; avant la correction, l'erreur restait affichée après avoir choisi "Carte bancaire" et il fallait recliquer sur "Commander en ligne" pour que la commande parte ; après correction, le message disparaît dès le choix du moyen de paiement et la commande part du premier clic.

### 4. Une commande programmée ("Plus tard") repart "dès que possible" si le client se connecte à ce moment-là — bug le plus sérieux de l'audit (impact : élevé)
- **Page** : `menu.html`/`composer.html`/`vegetarien.html`, partout où le panier propose "Plus tard" (jour + heure).
- **Étapes de reproduction** : panier avec 1 pizza → "À emporter" → "Plus tard" → choisir un jour et une heure (ex. demain 19h30) → "Commander en ligne" alors qu'on n'est pas encore connecté → créer un compte → la commande en attente repart automatiquement. **Résultat observé avant correction** : la commande est bien créée, mais en commande IMMÉDIATE — `scheduled_for` vaut `null` côté serveur (vérifié via `order_status.php`), aucune trace du jour/heure choisi, ni dans la commande ni sur l'écran de suivi.
- **Impact** : c'est le problème le plus grave trouvé dans cet audit — le client croit avoir programmé sa commande pour le lendemain soir, mais le restaurant la reçoit comme une commande à préparer tout de suite. Selon l'heure, ça peut vouloir dire une commande traitée en pleine nuit, ou simplement une pizza prête bien avant que le client ne vienne la chercher — sans qu'aucun écran ne signale quoi que ce soit d'anormal.
- **Cause** : la fonction qui sauvegarde l'état du panier avant de renvoyer un client non connecté vers la création de compte (`redirectToLogin()`, `assets/js/cart.js`) sauvegardait déjà le mode (à emporter/livraison), le moyen de paiement, le billet et la sauce piquante — mais jamais le choix "Plus tard" ni le créneau sélectionné. Au retour de l'inscription, ces deux valeurs repartaient donc à leur état par défaut ("dès que possible").
- **Corrigé** : `assets/js/cart.js` — `redirectToLogin()` sauvegarde désormais aussi `scheduleChoice`/`scheduledFor` (nouvelles clés `subito_pending_schedule_choice`/`subito_pending_scheduled_for`), et `resumeOrderIfNeeded()` les restaure avant de retenter l'envoi — exactement le même principe déjà utilisé pour le moyen de paiement, étendu au créneau programmé.
- **Preuve** : reproduit puis corrigé en local (base en mémoire). Avant la correction : créneau "demain 19h30" choisi, commande créée avec `scheduled_for: null`. Après correction, même parcours rejoué à l'identique : le suivi affiche "⏰ Commande programmée pour demain à 19:30" et `scheduled_for` contient `2026-11-24T18:30:00Z` (19h30 heure de Paris) côté serveur — vérifié par un appel direct à l'API, pas seulement à l'écran.

## Corrections réalisées et fichiers modifiés

| Fichier | Changement |
|---|---|
| `assets/img/photos/*.jpg` (52 fichiers) | Redimensionnés/recompressés (voir problème #1) |
| `assets/js/cart.js` | Efface le message d'erreur de paiement dès que le client change de moyen de paiement/montant de billet (voir problème #3) ; sauvegarde et restaure le créneau "Plus tard" à travers la connexion/inscription (voir problème #4) |

Aucun test automatisé ajouté pour les problèmes #3 et #4 : ce sont des comportements d'interface pure (état client, sessionStorage, DOM), pas des règles serveur — le projet n'a pas de suite de tests navigateur automatisée à ce jour, uniquement `tests/api-vercel/*.test.mjs` (côté serveur, qui couvre déjà très largement `scheduled_for` une fois la commande reçue). Vérifiés manuellement à la place, avant/après, par reproduction exacte de chaque scénario (voir "Preuve" de chaque problème), y compris une vérification de la valeur réelle `scheduled_for` côté serveur pour le problème #4, pas seulement à l'écran.

## Résultats des tests après correction

- Suite complète du projet (`node --test tests/api-vercel/*.test.mjs`) : relancée après chaque correction de ce rapport (images, message de paiement, créneau programmé), pour confirmer l'absence de régression — 225/226 à chaque fois, le seul échec étant le faux positif CRLF déjà connu et documenté dans le dépôt, sans rapport avec ces changements.
- Vérification visuelle manuelle : `menu.html` servi en local avec les nouvelles images — rendu identique à l'original, aucune perte de netteté perceptible.
- Parcours ajout au panier re-testé après la correction des images (sans rapport direct, mais dans la même session de test) : fonctionne correctement, total exact compte tenu de la promotion.
- Parcours livraison complet (personnalisation → panier → compte avec adresse → moyen de paiement → commande) rejoué intégralement après la correction du message d'erreur : commande créée du premier clic, aucune régression sur le parcours "à emporter" déjà validé au passage précédent.
- Panier (quantité, suppression, vidage) rejoué après la correction du créneau programmé : aucune régression.
- Parcours "Plus tard" (jour + heure → compte → reprise automatique) rejoué intégralement après la correction du problème #4 : `scheduled_for` correctement transmis au serveur, affiché correctement sur le suivi, aucune régression sur le parcours "dès que possible" déjà validé aux passages précédents.

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

1. **Faible — pas de mesure en réseau dégradé.** Aucun outil de cette session ne permet de simuler une connexion lente ; si le client cible un public avec une connexion mobile fréquemment faible, une mesure WebPageTest ou Lighthouse en mode "Slow 4G" apporterait un signal que je n'ai pas pu produire ici.
2. **Faible — autres villes de livraison non reparcourues à l'écran** (Montigny-en-Gohelle, Dourges… chacune avec son propre minimum/frais). Une seule ville (Hénin-Beaumont) vérifiée manuellement ; la logique reste couverte par les tests automatisés serveur.
3. **Faible — pages non visitées** : vegetarien.html, avis.html, faq.html, reseaux.html n'ont pas été ouvertes dans cet audit (aucune raison de les soupçonner, simplement pas de preuve directe à leur sujet).
4. **Très faible — 40 photos sur 92 n'ont pas pu être allégées** (déjà à une taille raisonnable ou dont la recompression Canvas n'apportait aucun gain) ; aucune action nécessaire, signalé pour mémoire.
5. **Non évalué — formats d'image modernes (WebP/AVIF).** Les 92 photos restent au format JPEG ; un passage à WebP apporterait un gain supplémentaire mais représente un changement plus large (génération de variantes, `<picture>`/`srcset`, décision de compatibilité navigateur) que je n'ai pas engagé dans ce passage ciblé — à envisager si la performance mobile devient un sujet prioritaire.

## Ce qui a été observé vs. supposé

**Observé directement** (mesuré, reproduit, vérifié) : poids des images avant/après, dimensions réelles vs. affichées, Core Web Vitals de laboratoire sur l'accueil, absence d'erreur console sur l'accueil, le menu et composer.html, comportement correct du panier (ajout, modification de quantité, suppression, panier vide, clics répétés, promo), parcours complet de commande "à emporter", "livraison" **et** "programmée" jusqu'à une vraie commande de test en local (personnalisation, zone/minimum, moyen de paiement, créneau jour/heure, création de compte, reprise automatique, suivi, absence de doublon, persistance au rechargement, rendu mobile), les bugs du message d'erreur de paiement et du créneau programmé perdu (tous deux reproduits puis corrigés, avant/après vérifié y compris côté serveur).

**Supposé / non vérifié** : villes de livraison autres que Hénin-Beaumont à l'écran — couvertes côté serveur par les tests automatisés, pas revérifiées manuellement ici ; comportement du formulaire face à une vraie erreur réseau en plein envoi (coupure simulée non réalisée) ; performance sur connexion mobile dégradée ; rendu sur l'ensemble des navigateurs/appareils (testé uniquement sous Chromium piloté, desktop et émulation mobile 375 px) ; pages vegetarien.html, avis.html, faq.html, reseaux.html (non visitées).

Quatre passages de plus en plus approfondis sur ce dépôt, deux vrais bugs reproductibles trouvés et corrigés (dont un sérieux : une commande programmée pouvait repartir comme immédiate), un troisième écarté après vérification (ce n'était pas un bug). Je ne peux pas garantir "zéro erreur" au sens absolu — certains parcours (livraison hors Hénin-Beaumont, réseau dégradé, certaines pages) restent non vérifiés faute de temps ou d'outil, comme indiqué ci-dessus — mais je n'ai plus, à ce stade, de problème reproductible identifié et non corrigé dans ce que j'ai pu tester.

Je n'affirme pas que le site est "sans bug" au-delà de ce qui a été vérifié ci-dessus.
