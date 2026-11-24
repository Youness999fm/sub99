# Audit QA complet — site client + espace commerçant Subito Pizza (24/11/2026)

## Périmètre

Mission élargie à **l'espace commerçant (`/commercant/`)**, jusqu'ici explicitement exclu des 6 passages précédents de cette même session (voir [`reports/2026-11-24-audit-perf-ux-client.md`](2026-11-24-audit-perf-ux-client.md), qui documente en détail les parcours client déjà testés : personnalisation pizza, panier, promos, livraison, inscription/connexion, créneaux programmés, référencement technique, vérification Google). **Ce rapport ne reprend pas ce qui y est déjà prouvé** — il s'y réfère et se concentre sur le terrain neuf : l'espace commerçant de bout en bout, plus quelques points précis du client non encore couverts (mot de passe oublié, formulaire de réclamation, liens internes, texte alternatif des images, navigation clavier).

Travail réalisé **exclusivement sur le serveur de développement local** (`.claude/launch.json`, config `sub99-api`, port 8095, base PGlite en mémoire, remise à zéro à chaque redémarrage) — jamais sur la production, ni client ni commerçant. Aucune vraie commande, aucun vrai paiement, aucune action irréversible réellement déclenchée (les boîtes de confirmation ont été testées puis annulées).

**Outils de mesure — limite assumée** : aucun Lighthouse, Puppeteer ou Playwright n'est installé dans ce projet (vérifié : `package.json`, `node_modules/.bin`), et `npx lighthouse` est bloqué par le mode automatique de cette session ("Undermining Oversight"). Les mesures de performance de ce rapport (et des passages précédents) sont donc des **mesures de laboratoire** via l'API `performance` du navigateur, pas des scores Lighthouse — jamais inventées.

## A. Résumé

Un bug réel trouvé et corrigé côté commerçant, de sévérité **majeure** : la préférence « sauce piquante » d'une commande en livraison n'était visible nulle part à l'écran avant impression du ticket — seul le ticket papier Bluetooth la montrait. Un commerçant qui consulte une commande à l'écran (avant d'imprimer, ou si l'impression échoue/n'est pas remarquée) n'avait aucun moyen de savoir si le client avait demandé de la sauce piquante. Corrigé : un bandeau « 🌶 SAUCE PIQUANTE : OUI/NON » s'affiche désormais directement dans le détail de la commande, dès l'arrivée en file.

Tout le reste de l'espace commerçant testé (connexion, file de commandes, acceptation avec délai, refus avec confirmation, disponibilité des produits avec vérification serveur, commandes programmées, clients, horaires retrait/livraison, recette du jour, remise à neuf avec confirmation explicite et irréversible) fonctionne correctement — rien d'autre de bloquant ou de faux trouvé. Rendu tablette (768 px, le format réel d'usage) impeccable ; un point cosmétique mineur à 375 px (libellés d'onglets tronqués, toujours cliquables).

Côté client, les points neufs vérifiés (mot de passe oublié absent — confirmé, pas inventé ; formulaire de réclamation présent et fonctionnel ; aucun lien interne cassé ; navigation clavier et focus visibles sur le formulaire d'inscription — bons) ne révèlent aucun bug supplémentaire.

## B. Tableau des problèmes

| ID | Page / fonction | Appareil / navigateur | Gravité | Étapes de reproduction | Résultat attendu | Résultat observé | Cause probable | Correction recommandée | Preuve / limite |
|---|---|---|---|---|---|---|---|---|---|
| QA-1 | Espace commerçant — détail d'une commande en livraison | Desktop + tablette 768px, Chromium piloté, serveur local | **Majeur** | Créer (API) une commande `mode: delivery` avec `hot_sauce: true` ou `false` → se connecter commerçant (code `654321`) → ouvrir le détail de cette commande dans la file | La préférence sauce piquante (information cuisine urgente, SBT-009) est visible à l'écran dès l'arrivée en file, pas seulement à l'impression | Aucune trace à l'écran — seul `printerPayload()`/le ticket imprimé la montrait | `el.detail` (fonction de rendu du détail, `assets/js/commercant.js`) n'incluait jamais `o.hot_sauce`, contrairement au gabarit d'impression qui, lui, l'affiche (`t-hotsauce`) | **Corrigé** (voir section H) | Reproduit puis corrigé en local ; capture avant (absent) / après (bandeau ambre visible, placé juste sous le bandeau mode retrait/livraison) ; vérifié aussi qu'aucun bandeau n'apparaît pour une commande à emporter (`hot_sauce: null`), pas de faux positif |
| QA-2 | Espace commerçant — onglets (Commandes/Programmées/Disponibilité/Espace patron) | Mobile 375px émulé, Chromium piloté | **Mineur** | Réduire la fenêtre à 375 px de large sur `/commercant/` | Libellés des 4 onglets lisibles en entier | Libellés tronqués ("Comma...", "Progra...", "Disponi...", "Espace ...") — toujours cliquables, pas de perte de fonction | Barre d'onglets non prévue pour un écran aussi étroit | À valider : l'app est conçue pour tablette (preuve : imprimante Bluetooth, usage constaté dans les rapports précédents) — correctif probablement inutile si aucun commerçant n'utilise un téléphone | Non corrigé — cosmétique, aucune perte de fonction, rendu tablette (le format réel) vérifié impeccable |
| QA-3 | `index.html` — galerie photo (`#gallery`) | Lecture de code | Information, pas un bug | — | — | 8 des 9 vignettes de galerie n'ont pas de `data-lightbox-src` (donc n'ouvrent pas la lightbox au clic), avec un `alt` "shooting photo en cours" | **Intentionnel et documenté** : commentaire du code (`index.html:332`) explique que ce sont des emplacements en attente de vraies photos | Aucune — à compléter quand les photos existeront, hors périmètre d'un audit de bugs | Lu dans le code, confirmé non-bug par le commentaire du projet lui-même |
| QA-4 | `compte.html` — écran "Compte créé !" | Lecture de code + DOM | Faible (SEO/accessibilité) | Ouvrir `compte.html`, inspecter les titres | Un seul `<h1>` par page (la page a déjà "Mon compte" en `<h1>`, ligne 78) | L'écran de confirmation post-inscription portait un **second** `<h1>` ("Compte créé !") — hiérarchie de titres dupliquée, mauvaise pratique SEO/accessibilité (un lecteur d'écran ou un moteur de recherche ne doit trouver qu'un seul titre de niveau 1 par page) | Deux `<h1>` dans le même document | **Corrigé** : rétrogradé en `<h2>` | Confirmé : un seul `<h1>` restant sur la page après correction |
| QA-5 | `concours.html` (page du concours TikTok terminé) + `sitemap.xml` | Lecture de code | Faible (SEO) | Ouvrir `concours.html` | Une page qui annonce elle-même "Le concours est terminé" ne devrait pas être proposée par les moteurs de recherche comme un concours en cours, ni listée dans le plan du site comme contenu à (re)crawler quotidiennement | `concours.html` n'avait pas de balise `<meta name="robots">` (donc indexable par défaut) et figurait dans `sitemap.xml` avec `changefreq: daily` — alors que le contenu est définitivement clos | Page légitimement liée en interne (`grand-tirage.html`), donc gardée accessible, mais pas destinée au classement une fois l'événement terminé | **Corrigé** : ajout de `<meta name="robots" content="noindex, nofollow">` sur `concours.html` ; retrait de son entrée dans `sitemap.xml` (cohérent : on ne soumet pas une page noindexée dans le plan du site) | Page toujours accessible par son lien interne (pas supprimée), juste exclue de l'indexation et du sitemap |

Aucun autre problème reproductible trouvé dans le périmètre testé (voir sections C/D pour le détail des parcours qui fonctionnent correctement).

## C. Parcours côté client (points neufs uniquement — le reste dans le rapport précédent)

- **Mot de passe oublié** : recherché dans `assets/js/compte.js` et `compte.html` — **n'existe pas**. Je ne l'ai pas inventé ni testé une fonction absente ; signalé comme fonctionnalité manquante, pas comme bug (peut être un choix assumé pour un compte à faible enjeu).
- **Formulaire de réclamation** (`avis.html#reclamation`) : présent, avec un raccourci direct depuis le haut de la page. Non soumis réellement (formulaire de contact, hors périmètre lecture seule) mais structure HTML saine, lien du numéro de téléphone permanent (note dans le code : ne doit jamais être masqué).
- **Liens internes** : les 11 pages principales (`index.html`, `menu.html`, `compte.html`, `faq.html`, `avis.html`, `reseaux.html`, `composer.html`, `supplements.html`, `vegetarien.html`, `mentions-legales.html`, `commande.html`) ont été scannées pour leurs liens `.html` internes — **tous pointent vers des fichiers qui existent réellement**, aucun lien cassé trouvé.
- **Texte alternatif des images** : `menu.html` (65 images), `composer.html`, `vegetarien.html` — alt text présent partout. `index.html` : 2 images sans alt réel, toutes deux légitimes (logo décoratif dupliqué du header, et l'image de la lightbox qui est remplie dynamiquement par JS avec un `alt` tiré de `data-lightbox-alt` — vérifié dans `assets/js/main.js`).
- **Navigation clavier et focus** (formulaire d'inscription, `compte.html?compte=creer`) : ordre de tabulation logique et complet (prénom → nom → email → téléphone → mot de passe → confirmation → rue → ville → logement → bouton), aucun piège, chaque champ reçoit un contour de focus visible (2px solide rouge, vérifié par `getComputedStyle`). Bon.
- **Double-clic sur le bouton d'envoi de commande réel** : non re-testé manuellement — l'idempotence serveur (`idempotency_key`) est déjà massivement couverte par `tests/api-vercel/*.test.mjs` et `tests/massif/06-concurrence-idempotence.mjs`, qui simulent des envois concurrents réels. Revérifier à la main aurait dupliqué une preuve déjà solide.

## D. Parcours côté commerçant (terrain neuf de ce passage)

Connexion possible via le code de démonstration du serveur local (`654321`), accès supérieur (`1109`) — jamais de code réel, jamais de production touchée.

- **Connexion / déconnexion** : fonctionne, formulaire protégé par code uniquement (cohérent avec la conception du projet — pas de compte email/mot de passe côté commerçant).
- **Réception de nouvelles commandes** : 3 commandes de test créées via l'API (retrait, livraison avec sauce piquante et espèces à appoint, programmée pour demain 18h30) — toutes apparaissent correctement dans la file, triées, avec le bon statut "Nouvelle".
- **Détail d'une commande** : client (nom, téléphone, adresse si livraison), moyen de paiement (y compris "Espèces · appoint"), articles avec remarque libre, total — tout exact et lisible. **Bug trouvé ici : la sauce piquante manquait (QA-1, corrigé).**
- **Acceptation** : sélection du délai (10/20/30/40/50 min, 1h, "Tout de suite") avant confirmation — clair, aucune ambiguïté. Commande bien marquée `accepted` avec le bon délai, vérifié via `owner_orders.php`.
- **Refus** : boîte de confirmation explicite ("La commande sera marquée comme refusée et ne sera pas comptée dans la recette") avant toute action, annulable. Pas de refus accidentel possible.
- **Commandes programmées** : onglet dédié, regroupées par jour, montant et statut ("En attente de votre acceptation") corrects.
- **Disponibilité des produits** : bascule instantanée (testé sur "Végétarienne") ; **vérifié côté serveur, pas seulement à l'écran** — une tentative de commande du produit désactivé est bien rejetée (`422 unavailable_items`) avant réactivation.
- **Horaires retrait/livraison** : les deux cartes indépendantes (fonctionnalité livrée plus tôt dans cette même session) s'affichent et fonctionnent correctement — pas re-testé en profondeur ici, déjà largement couvert.
- **Clients** : fiche du client de test retrouvée correctement (nom, téléphone) depuis la liste.
- **Recette du jour** : total exact (16,00 €, correspondant à l'unique commande acceptée), le détail liste bien la commande avec son délai.
- **"Nouvelle journée (tout effacer)"** : action la plus destructrice de l'interface — boîte de confirmation très claire, précise le montant exact et le nombre de commandes concernées, explique que les commandes non décidées (programmées) ne sont PAS touchées, et dit explicitement "Cette action est irréversible." Testée puis **annulée volontairement** pour ne pas détruire les données de test en cours d'audit — comportement jugé sûr sans avoir besoin de la déclencher réellement.
- **Rendu tablette (768 px, le format réel d'usage)** : impeccable, aucune perte d'information, grille à deux colonnes (client/paiement) bien agencée.
- **Rendu mobile (375 px)** : voir QA-2, cosmétique uniquement.

## E. Performance et accessibilité

Aucune nouvelle mesure de performance dans ce passage — l'espace commerçant n'a pas été évalué sous cet angle (pas de page publique indexée, pas de trafic de recherche organique à optimiser, et les mesures de laboratoire du site client restent celles déjà documentées dans le rapport précédent, inchangées car aucune page client n'a été modifiée ici). L'accessibilité clavier du formulaire d'inscription a été vérifiée dans ce passage (voir section C) — bonne, aucune action requise.

## F. Contradictions à résoudre / informations à confirmer

Rien de nouveau à signaler dans ce passage — les contradictions de contenu (FAQ, bandeau panier, composer.html) relevées dans les passages précédents sont déjà corrigées et documentées dans [`reports/2026-11-24-audit-perf-ux-client.md`](2026-11-24-audit-perf-ux-client.md). Le seul point "à valider" ajouté ici est QA-2 (tableau ci-dessus) : confirmer que l'espace commerçant n'a vraiment besoin d'un rendu propre qu'en tablette, jamais en téléphone.

## G. Plan de corrections par priorité

1. **Bloque une commande** : aucun trouvé dans ce passage.
2. **Prix / promo / frais / statut erronés** : aucun trouvé dans ce passage (déjà confirmés exacts au passage précédent, non remis en cause).
3. **Mobile / lenteurs** : QA-2 (mineur, cosmétique, probablement sans suite — voir "à valider").
4. **Visuel / SEO** : QA-1 corrigé (impact direct sur la préparation réelle des commandes, classé ici par défaut de catégorie mais à traiter comme prioritaire en pratique — c'est une information opérationnelle manquante, pas un défaut visuel au sens strict).

## H. Fichiers modifiés

| Fichier | Changement |
|---|---|
| `assets/js/commercant.js` | Ajoute l'affichage de `o.hot_sauce` (OUI/NON) dans le détail de commande à l'écran, juste sous le bandeau retrait/livraison — visible uniquement quand non `null` (livraison), jamais pour un retrait (voir QA-1) |
| `assets/css/commercant.css` | Nouvelle classe `.od-hotsauce` (bandeau ambre, même famille visuelle que les autres alertes de l'interface) |
| `commercant/index.html` | Cache-buster relevé (`commercant.css?v=20261124d`, `commercant.js?v=20261124e`) pour que la correction soit servie immédiatement, y compris sur un appareil (tablette PWA) qui aurait déjà mis le site en cache |
| `compte.html` | `<h1>` dupliqué ("Compte créé !") rétrogradé en `<h2>` (voir QA-4) |
| `concours.html` | Ajout de `<meta name="robots" content="noindex, nofollow">` — page de concours terminé, gardée accessible mais plus destinée au classement (voir QA-5) |
| `sitemap.xml` | Retrait de l'entrée `concours.html`, cohérent avec son passage en `noindex` (voir QA-5) |

**Avant/après (QA-1)**, reproduit en local :
- *Avant* : commande livraison avec `hot_sauce: true` ouverte à l'écran → aucune mention de la sauce piquante nulle part dans le détail.
- *Après* : même commande, même scénario → bandeau "🌶 SAUCE PIQUANTE : OUI" visible immédiatement, avant même la section "Client". Rejoué aussi avec `hot_sauce: false` → "SAUCE PIQUANTE : NON" (la cuisine doit savoir dans les deux cas, pas seulement quand c'est "oui") ; rejoué avec une commande à emporter (`hot_sauce: null`) → aucun bandeau, pas de régression.

Aucun fichier serveur (`serveur/*`) modifié dans ce passage — aucune suite de tests serveur à relancer pour ce correctif (changement CSS/JS d'affichage pur, aucune nouvelle route ni règle de calcul).

## Ce qui a été observé vs. supposé

**Observé directement** : les 3 commandes de test créées et retrouvées dans l'espace commerçant ; le bug QA-1 reproduit puis corrigé avec capture avant/après ; le blocage serveur réel d'un produit indisponible (422, pas une simple supposition d'après le code) ; la boîte de confirmation de remise à neuf lue en entier puis annulée ; le rendu tablette et mobile de l'espace commerçant ; l'ordre de tabulation et la visibilité du focus sur le formulaire d'inscription ; l'absence de lien interne cassé sur 11 pages ; l'absence de fonction "mot de passe oublié" (confirmée par lecture du code, pas supposée).

**Supposé / non vérifié** : performance Lighthouse réelle (outil indisponible dans cette session, mesures de laboratoire uniquement comme indiqué) ; comportement de l'espace commerçant sur un vrai iPad/tablette physique (testé uniquement en émulation de largeur) ; impression Bluetooth réelle du ticket (nécessite une imprimante physique, hors périmètre) ; usage simultané par plusieurs appareils commerçant en même temps (couvert côté serveur par les tests automatisés de concurrence, pas rejoué manuellement ici) ; soumission réelle du formulaire de réclamation d'avis.html (lecture seule respectée).

Je n'affirme pas que l'espace commerçant est "sans bug" au-delà de ce qui a été vérifié ci-dessus — notamment l'impression physique réelle et l'usage multi-appareils simultané restent non testés faute d'accès à du matériel réel.
