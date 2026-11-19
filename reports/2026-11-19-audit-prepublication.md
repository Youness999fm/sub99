# Audit complet avant publication — Subito Pizza : site de commande et interface commerçant

| | |
|---|---|
| Date | 19 novembre 2026 (heure locale du poste, Europe/Paris) |
| Dépôt | `sub99`, dossier local |
| Statut | **Non publiable en l'état.** Points bloquants : sections 4 et 12 |
| Périmètre | Pages publiques, parcours de commande, comptes clients, suivi, maquette commerçant, backend en construction (`api/`), hébergement et exploitation (contrôles de documents), tests locaux |
| Revue indépendante | Première revue terminée (section 6.5) ; seconde revue en cours au moment de cette version (section 6.6) |

Légende des preuves : **[P]** constat prouvé par le code ou un réglage visible · **[T]** test réellement exécuté · **[H]** hypothèse · **[R]** recommandation · **[NV]** non vérifiable (raison indiquée).

Ce rapport n'est pas une certification. Aucune formation n'est revendiquée. Les textes juridiques cités doivent être confirmés par un professionnel.

**Le dépôt a changé pendant l'audit.** Plusieurs intervenants ont modifié des fichiers (commande, compte, maquette commerçant, API, pages HTML). Chaque constat indique la version observée, et les tests ont été rejoués sur l'état final.

## Résumé

- **Front client** : fonctionne en local avec une API simulée (prix, promotions, minimums, frais, panier, double clic, erreurs réseau, redirections, compte, suivi, fenêtre d'accueil). Parcours : 15 contrôles sur 18 ; les 3 échecs sont des constats réels (horaires, disponibilité, cibles tactiles).
- **Corrections sûres appliquées** : compte client (erreurs réseau, retour limité au même site, échappement, validation), panier (stockage refusé, verrou pendant l'envoi), suivi, fenêtre d'accueil (focus clavier), accessibilité (libellés, rôles, contrastes, cibles), référencement, fichiers de configuration. Régression : 19 contrôles sur 19. Accessibilité automatique (axe-core) : 0 violation sur 17 contrôles.
- **Bloquant 1** : le backend (`api/`) a été construit pendant l'audit. Il a été exécuté en local (PHP 8.3.36 portable, base SQLite de test), mais les tests API sont **instables et non concluants** (échecs de connexion au serveur de test, échecs en cascade ; section 6.2). MySQL n'a pas été testé. La commande réelle n'est donc pas prouvée.
- **Bloquant 2** : prix, horaires et disponibilité ne sont pas appliqués côté serveur.
- **Bloquant 3** : mentions légales, politique de confidentialité, information sur les allergènes et conditions de commande sont absentes.
- **Bloquant 4** : fichiers de diagnostic et outils dans `api/`, identifiants FTP dans le README, liste d'envoi ambiguë. Rien de ce dossier ne doit partir tel quel vers l'hébergement.
- **Capacité de 100 commandes par minute : test impossible.** Aucune mesure n'a été faite ; la capacité est donc **non démontrée**.

## 1. État actuel

Classement : **site statique avec un front de commande et une maquette commerçant ; backend en construction, exécuté seulement en local avec des résultats non concluants.** Ce n'est pas un système complet.

| Élément | Niveau | Détail |
|---|---|---|
| Pages publiques | Inspecté et testé | 14 pages contrôlées en bureau et 3 en téléphone (axe-core), plus parcours |
| Menu, options, suppléments, calzone, zones de livraison, frais, minimums | Inspecté et testé | T01 à T06 ; valeurs identiques entre pages (lecture du code) |
| Panier et envoi (côté navigateur) | Inspecté et testé | T04 à T11, API simulée |
| Compte client (inscription, connexion, retour) | Inspecté et testé côté interface | R01 à R07, API simulée |
| Suivi de commande | Inspecté et testé côté interface | R10 à R12, API simulée |
| Fenêtre « Commandez en ligne » | Inspecté et testé | R09 |
| Maquette commerçant (`commercant/`) | Inspectée ; **non testée** de bout en bout ; non testée sur téléphone réel | Branchée sur `owner_login.php` et les routes propriétaire ; quelques cas testés via l'API en local, suite instable |
| Backend `api/` (PHP) | Inspecté (code) ; exécution locale **tentée, non concluante** | 24 entrées à la racine (dont `.htaccess` et README), plus `lib/` (11 fichiers) et `tools/` (2 fichiers), créées entre 03 h 44 et 03 h 56 ; sondes `_phpinfo.php` et `_dbtest.php` datées de 00 h 23 ; PHP 8.3.36 portable utilisé pour les tests (PHP absent du PATH, section 6.1) |
| Base de données | **Non accessible** en production | Aucune base déployée. Une base SQLite de test a été créée en local (tests API) ; le schéma MySQL (`api/lib/schema.php`) n'a pas été exécuté |
| Hébergement OVH (PHP, MySQL, HTTPS, sauvegardes) | **Non accessible** | Aucun accès au compte ; aucun réglage consulté |
| Authentification client et propriétaire | Inspectée (code) | Non testée de bout en bout |
| E-mail, notifications push, SMS | **Absents** | Aucun envoi dans le code actuel |
| Impression | **Non connectée** | Aperçus seulement ; modèle d'imprimante non tranché |
| Journaux, alertes, surveillance | **Absents** | — |
| Scripts de test | Inspectés et exécutés | `tests/` (section 6) |

Pour recevoir de vraies commandes, il manque : un backend exécuté et testé en préproduction, la base, l'enregistrement avec contrôle serveur, l'écran commerçant branché et testé, et les décisions de la section 13.

## 2. Carte du parcours d'une commande et services utilisés

```text
CLIENT (navigateur)                         SERVEUR (api/, en construction, non fiable)      COMMERÇANT
-------------------                         --------------------------------------------     ----------
menu.html, composer.html, vegetarien.html
  panier (localStorage)
  prix, promotion, minimum, frais : calculés PAR LE NAVIGATEUR
  « Commander en ligne »
    compte requis ───────────────────────►   customer_login.php / customer_signup.php
    retour après connexion (?retour)          (session par cookie)
  envoi ───────────────────────────────────►  order_create.php
    (clé d'idempotence, lignes, total)         recalcul prix, minimum, horaires : PRÉVU, NON VÉRIFIÉ
                                               enregistrement : PRÉVU, NON VÉRIFIÉ
  ◄── réponse avec identifiant de commande ─
  commande.html?id=…  ◄───── order_status.php (sondage toutes les 4 s)
                                              ▲
                                              │ accepter, refuser, délai
                                              └── owner_orders.php, owner_order_decide.php ◄── commercant/ (e-mail + mot de passe)
                                                                                    │
                                                                       impression : NON CONNECTÉE
```

Services utilisés :
- **Hébergement** OVH mutualisé, annoncé par le contrat ; non vérifié.
- **Google** : carte intégrée sur l'accueil (`index.html:258`) et polices Google Fonts sur 14 pages.
- **Réseaux sociaux** : liens seulement.
- **Paiement** : aucun paiement en ligne. La règle est respectée : le paiement se fait chez le commerçant.
- **E-mail, SMS, notifications** : aucun service prévu dans le code actuel.

## 3. Tableau des contrôles

| Domaine | Contrôle | Résultat | Preuve |
|---|---|---|---|
| Prix | Tailles, suppléments, promotion à emporter, promotion livraison, minimum, frais | Vérifié (T01 à T06) | [T] |
| Horaires | Commande refusée hors horaires | **Échec** : commande possible alors que le bandeau indique « fermé » (T13) | [T] |
| Disponibilité | Produit indisponible non envoyé | **Échec** (T14). `vegetarien.html` et `composer.html` ne chargent pas le script de disponibilité | [T][P] |
| Envoi | Double clic, erreur réseau, réponse sans identifiant, réponse avec identifiant | Vérifié (T07 à T10, R02, R03) | [T] |
| Panier | Stockage refusé : message d'erreur, jamais « ajouté ✓ » | Vérifié (R08) | [T] |
| Panier | Modification pendant l'envoi | Verrou vérifié par le code ; non testé en navigateur | [P] |
| Compte | Erreur réseau, 401 et 500 ne sont jamais traités comme des invités | Vérifié (R01, R01b, R02, R03) | [T] |
| Compte | Retour vers un autre site refusé ; retour local accepté | Vérifié (R04, R05) | [T] |
| Compte | Historique : valeurs de l'API échappées | Vérifié (R06) | [T] |
| Compte | Inscription : prénom, nom et e-mail vérifiés avant tout appel | Vérifié (R07) | [T] |
| Compte | Mot de passe oublié | **Absent** | [P] |
| Suivi | Panne réseau après affichage : commande gardée, bandeau affiché | Vérifié (R10) | [T] |
| Suivi | Identifiant numérique accepté | Vérifié (R12), après une correction faite par un autre intervenant | [T] |
| Suivi | Libellé « livreur » en fin de minuteur | Vérifié (R11) | [T] |
| Fenêtre d'accueil | Focus à l'ouverture, Tab, Échap, retour du focus | Vérifié (R09) | [T] |
| Backend | Routes, base, idempotence, recalcul serveur, horaires, disponibilité | **Non concluant** : tests API instables en local (section 6.2) ; MySQL non testé | [T] partiel, [NV] |
| Sécurité | Contrôle d'accès client et propriétaire côté serveur | **Non vérifiable de façon fiable** : des cas 401 et 403 réussissent, d'autres échouent sur une suite instable (section 6.2) | [T] partiel |
| Outils d'installation (`api/tools/`) | Refus hors ligne de commande | Réussi en passe 2 ; garde présente à la relecture (P-11 retiré) | [T][P] |
| Sécurité | En-têtes HTTPS, HSTS, CSP | Absents du dépôt ; état réel de l'hébergeur **non vérifiable** | [P][NV] |
| Données | Politique de confidentialité, information au moment de la collecte | **Absentes** | [P] |
| Données | Mentions RCS, SIRET, TVA | **Absentes** (aucune occurrence) | [P] |
| Données | Information sur les allergènes | **Absente** (aucune page ne contient le mot) | [P] |
| Données | Conditions de commande, CGV | **Absentes** | [P] |
| Données | Google Maps et Google Fonts | Chargés sans information ni consentement | [P] |
| Accessibilité | axe-core 4.14.1, 17 contrôles page × mode | 0 violation | [T] |
| Accessibilité | Contrastes recalculés | Corrigés (section 5.2) | [T][P] |
| Accessibilité | Cibles tactiles de 24 px (critère 2.5.8, niveau AA) | Boutons corrigés ; 5 liens dans une phrase restent à arbitrer | [T] |
| Accessibilité | Parcours complet au clavier, lecteur d'écran | **Non vérifiable** : pas de test humain | [NV] |
| Performance | Lighthouse 13.6.0, émulation mobile, local | Voir section 6.3 | [T] |
| Référencement | Canonique, données structurées, robots.txt | Corrigés (section 5.1) ; données dupliquées à traiter | [P] |
| Impression | Ticket et connexion de l'imprimante | **Non connectée** | [P] |
| Alertes | Alarme commerçant lorsque l'onglet est fermé ou l'écran verrouillé | **Non fiable** : dépend de l'onglet ouvert ; non testé sur téléphone | [P][H] |
| Charge | 100 commandes par minute | **Test impossible** (sections 7 et 9) | [NV] |

## 4. Problèmes classés par priorité

Gravité : **critique** (bloque la mise en ligne), **élevé** (à traiter avant la mise en ligne), **moyen**, **faible**.

| N° | Gravité | Constat | Preuve | Conséquence | Correction proposée | Statut |
|---|---|---|---|---|---|---|
| P-01 | Critique (résolu) | Identifiant de suivi numérique refusé | `commande.js:37` utilisait `/^d+$/` au lieu de `/^\d+$/`. Corrigé par un autre intervenant : R12 passe | Après commande, le client voyait « lien non valide » | Aucune. Le contrôle R12 reste dans les tests | **Résolu**, constaté par R12 |
| P-02 | Critique | Parcours publiable avant exécution fiable du backend | `api/` construit pendant l'audit ; tests API instables en local (P-55) ; aucune base MySQL ; aucune préproduction | Commandes non enregistrées ou non vérifiées | Ne pas publier le parcours avant des tests API en préproduction | Décision du propriétaire |
| P-03 | Élevé | Espace commerçant publiable sans contrôle d'accès vérifié | La maquette passe désormais par `owner_login.php`, mais ce contrôle n'a été exécuté que partiellement, sur une suite instable (P-55) ; `robots.txt` ne protège rien | Accès à l'écran commerçant si `commercant/` est publié avant les tests du backend | Ne pas publier `commercant/` ni `api/tools/` avant les tests du backend | Décision du propriétaire |
| P-04 | Critique | Mentions obligatoires et information des personnes absentes | `mentions-legales.html` sans RCS, SIRET ni TVA ; aucune politique de confidentialité ; aucun allergène sur les pages | Écarts possibles avec les obligations de vente à distance et de protection des données (textes à confirmer, annexe) | Rédiger avec un professionnel ; fournir les allergènes produit par produit | Décision du propriétaire et validation humaine |
| P-05 | Élevé | Prix, frais, minimum et total calculés par le navigateur | `cart.js` envoie `unit_price`, `delivery_fee` et `total_cents`. Le contrat en construction prévoit un refus en cas d'écart (`price_mismatch`) | Montants modifiables tant que le serveur ne recalcule pas | Recalcul serveur à partir d'une grille de référence, refus en cas d'écart | Ouvert, lot backend |
| P-06 | Élevé | Horaires non appliqués | T13 : commande possible alors que le bandeau indique « fermé », contrôlé à plusieurs heures de la journée. Trois versions : « 18h–23h » (`index.html:186`), fin à 22 h 47 (`main.js:307-308`), livraison « 19h–22h » | Commandes hors service ; textes contradictoires | Décision sur les horaires, puis application côté serveur | Décision du propriétaire |
| P-07 | Élevé | Disponibilité non appliquée de bout en bout | T14 : une pizza marquée indisponible part dans la commande. `vegetarien.html` et `composer.html` ne chargent pas `disponibilite.js` | Produit indisponible commandé | Étendre aux pages et à l'envoi (chantier disponibilité, autre intervenant) | Ouvert, hors de cet audit |
| P-08 | Élevé | Frais de livraison contradictoires | `faq.html:54` et `faq.html:126` : « livraison offerte, sans frais supplémentaires ». Accueil et panier : 5,50 € ou 8 € sans pizza | Information de prix fausse, reprise dans les données structurées | Aligner la FAQ sur la règle décidée | Décision du propriétaire (texte) |
| P-09 | Élevé | Durée de conservation des commandes non décidée et contradictoire | Plan : purge quotidienne. Décision du 19/11 : historique consultable dans « Mon compte » | Les deux exigences ne peuvent pas coexister ; durée RGPD indéfinie | Trancher : durée, anonymisation ou purge | Décision du propriétaire |
| P-10 | Élevé | Fichiers de diagnostic PHP dans `api/` | `api/_phpinfo.php` (affiche la configuration PHP) et `api/_dbtest.php` (test de connexion). Protégés en théorie par `api/.htaccess`, non testable ici | Exposition de la configuration si la protection échoue | Exclure de tout envoi ; suppression après accord (cadrage du 19/11) ; vérifier la protection chez OVH | Décision du propriétaire |
| P-11 | Retiré | Constat initial infirmé : garde en ligne de commande présente | `api/tools/install.php` (ligne 7) et `create_owner.php` (ligne 6) répondent 403 hors ligne de commande (relecture finale, 12 h 37). Test « outils CLI » réussi en passe 2 | Aucune garde à ajouter. Les outils restent à exclure de l'envoi (P-12, section 12) | Exclure `tools/` de l'envoi | **Constat retiré** |
| P-12 | Élevé | Identifiants FTP dans le README suivi par git ; procédure d'envoi du dossier complet | `README.md`, lignes 12 et 16 (valeurs non reproduites) | Fichiers privés envoyés (rapports, tests, API, maquette) ; identifiants exposés dans le dépôt | Retirer les identifiants ; changer le mot de passe FTP si le dépôt a été partagé ; liste d'envoi explicite (section 12) | Décision du propriétaire |
| P-13 | Élevé | Alarme commerçant liée à l'onglet ouvert | Maquette : intervalle et son Web Audio, pas de notification, pas de maintien de l'écran. Le plan prévoit un sondage « tant que la page est visible » | Une commande peut arriver sans son si le téléphone est verrouillé ou l'onglet fermé | Canal d'alerte à choisir : tablette sans veille, notification web installée, ou SMS de secours | Décision du propriétaire |
| P-14 | Élevé | Son bloqué sans geste de l'utilisateur | Règle de Chrome : un `AudioContext` créé sans geste démarre suspendu (annexe) | Pas de son au démarrage de la maquette | Bouton « activer le son » ; test sur téléphone réel | Ouvert, lot commerçant |
| P-15 | Élevé | Compte obligatoire sans « mot de passe oublié » ni envoi d'e-mail | Aucune route ni texte de récupération ; aucun enregistrement SPF, DKIM ou DMARC prévu | Client bloqué s'il oublie son mot de passe | Parcours par e-mail (avec SPF, DKIM, DMARC) ou repli par téléphone | Décision du propriétaire |
| P-16 | Élevé | Version PHP du contrat non supportée | Contrat : « PHP 8.1+ ». php.net (19/11/2026) : 8.1 n'apparaît plus dans les branches supportées ; 8.2 en sécurité seule jusqu'au 31/12/2026 ; 8.3 en sécurité jusqu'au 31/12/2027 ; 8.4 actif jusqu'au 31/12/2026, sécurité jusqu'au 31/12/2028 ; 8.5 actif jusqu'au 31/12/2027, sécurité jusqu'au 31/12/2029 | Pas de correctifs de sécurité sur une branche arrêtée | Viser PHP 8.4 ou 8.5 si OVH le permet, 8.3 au minimum ; vérifier la version réelle | Décision du propriétaire et vérification chez l'hébergeur |
| P-17 | Élevé | Google Maps et Google Fonts sans information ni consentement | `index.html:258` (iframe Google Maps). 14 pages chargent Google Fonts | Transfert de données à un tiers sans information | Image statique de la carte ; polices hébergées sur le site ; ou consentement | Décision du propriétaire |
| P-18 | Élevé | HTTPS forcé, HSTS et CSP absents du dépôt | `.htaccess` ne contient ni redirection HTTPS, ni HSTS, ni CSP | Trafic en clair possible si OVH ne force pas HTTPS | Vérifier chez l'hébergeur, puis ajouter les règles après test | Décision du propriétaire et vérification |
| P-19 | Élevé | Impression : modèle et mode de connexion non tranchés | Maquette du 18/11 : SUNMI. Plan : Epson TM-m30III (ePOS). Une page HTTPS ne peut pas appeler une imprimante du réseau local sans contrainte (contenu mixte, accès au réseau privé) | Impression impossible en l'état | Confirmer le modèle ; prototype avant la phase impression | Décision du propriétaire |
| P-20 | Élevé | Modifications concurrentes pendant l'audit | Au moins 4 fichiers JavaScript, plusieurs pages et des fichiers `api/` modifiés par d'autres intervenants | Écrasement possible, corrections contradictoires | Une branche par chantier ; commit avant correction ; un responsable par fichier | Décision du propriétaire |
| P-21 | Moyen | Minimum calculé après la promotion livraison, non indiqué au client | `cart.js` : le minimum porte sur le total après −50 % | Contestation probable du minimum | Décider avant ou après promotion et l'écrire | Décision du propriétaire |
| P-22 | Moyen | Pas de conditions de commande | Aucune page CGV ; règles (minimum, frais, refus, paiement) écrites nulle part | Information contractuelle insuffisante | Rédiger avec un professionnel | Décision du propriétaire |
| P-23 | Moyen | Performance mobile | Lighthouse (section 6.3) : images sans dimensions, CSS et JavaScript non minifiés, code inutilisé | Chargement lent sur téléphone | Dimensionner les images, formats modernes, minifier, versionner les ressources | Recommandation |
| P-24 | Moyen | Données structurées « Restaurant » dupliquées, sans identifiant commun | Constat de l'audit (`@id`, pages multiples), à reconfirmer ; accueil en `/index.html` ou `/` | Signaux de référencement contradictoires | Une entité `@id` unique, un seul hôte canonique | Recommandation et décision |
| P-25 | Moyen | Note et avis déclarés dans les données structurées de `avis.html` | Constat de l'audit, à reconfirmer | Avis non sourcés en données structurées | Retirer ou sourcer | Décision du propriétaire |
| P-26 | Moyen | Sauvegardes, surveillance et retour arrière non prévus | Aucune procédure dans le dépôt ni dans le README ; aucune alerte | Perte de données sans récupération | Sauvegarde de la base et des fichiers ; procédure de retour arrière ; alertes simples | Décision du propriétaire |
| P-27 | Moyen | Tests non intégrés, aucune intégration continue | Tests lancés à la main | Régressions non détectées | Lancer les suites avant chaque envoi (section 12) | Recommandation |
| P-28 | Faible | Maquette sans persistance | Rien n'est enregistré : un rechargement efface tout | Ne doit pas servir de preuve de fonctionnement | Remplacer par le backend | Ouvert, lot commerçant |
| P-29 | Élevé | Redirection hors site par un chemin `/.//hôte` après connexion | `compte.js` : `safeReturnUrl` acceptait `/.//hôte`, normalisé en `//hôte` (constat de la revue, confirmé par le juge) | Le client quittait le site après connexion ou enregistrement d'adresse | Refus des chemins commençant par `//` après normalisation | **Corrigé**, contrôle R04b |
| P-30 | Élevé | Commande relancée sans clic par `?subito_resume=1` | `cart.js` : la reprise ne vérifiait que le paramètre (constat de la revue, confirmé par le juge) | Un lien piégé pouvait faire partir une commande d'un client connecté ayant un panier | Reprise seulement si `compte.js` a posé `subito_resume_ok` au retour légitime de connexion | **Corrigé**, contrôles R13 et R14 |
| P-31 | Élevé | Article ajouté pendant l'envoi perdu, clé d'envoi effacée | `addLine` et « Vider le panier » n'étaient pas gardés par `orderBusy` | Article absent de la commande, sans message ; risque de doublon après une panne | Garde pendant l'envoi, avec message explicite | **Corrigé** ; à re-tester avec le backend réel |
| P-32 | Moyen | Bouton « Commander » désactivé après une panne | Référence obsolète au bouton dans `submitOrder` | Impossible de renvoyer la commande sans recharger | Bouton relu au moment d'agir (`setCheckoutDisabled`) | **Corrigé** |
| P-33 | Moyen | Réponse réussie sans JSON traitée comme client invité, puis mise en cache | `account.js` : `json().catch(() => ({}))` | Client connecté envoyé vers la connexion pour toute la durée de la page | Code `bad_response` ; réponse sans `customer` refusée | **Corrigé**, contrôles R01 et R01b |
| P-34 | Moyen | Suivi qui ne se termine pas 2 h après l'heure prévue quand le sondage est arrêté | `commande.js` : contrôle seulement dans `render()` | Onglet resté ouvert : suivi périmé affiché | Contrôle appliqué dans le minuteur | **Corrigé** |
| P-35 | Moyen | Compte à rebours relu en continu par les lecteurs d'écran | Compte à rebours dans une zone `role="status"` | Annonces répétées chaque seconde (à confirmer avec un lecteur d'écran) | `aria-live="off"` sur le compte à rebours | **Corrigé** ; effet au lecteur d'écran non confirmé |
| P-36 | Moyen | Textes dorés et états sous 4,5:1 | `order-launch.css`, `cart.css`, `commande.css`, `compte.css` | Lisibilité insuffisante | Teintes foncées (section 5.2) | **Corrigé** pour les composants listés ; voir P-37 |
| P-37 | Moyen | Date dorée de la section finale sur un dégradé clair (environ 1,9:1 au mieux) | `style.css` : `.finale__date`, pré-existant | Lisibilité insuffisante | Décision de design : fond ou couleur | **Ouvert** |
| P-38 | Moyen | Tab sort du tiroir du panier (dialogue `aria-modal` sans piège de focus) | `cart.js` : aucune gestion de Tab, pré-existant | Clavier : le focus passe à la page derrière | Piège de focus dans le tiroir | **Ouvert** |
| P-39 | Faible | Couverture des tests incomplète | R09 ne couvre ni Maj+Tab ni la croix ; T15b ne mesure ni la fenêtre ni le tiroir | Régression possible non vue | Étendre les contrôles | **Ouvert** |
| P-40 | Faible | Tiroir : fermeture différée de 280 ms non annulée à la réouverture | `cart.js` : délai de fermeture, pré-existant | Tiroir masqué alors qu'il reste affiché (rare) | Annuler le délai à l'ouverture | **Ouvert** |
| P-41 | Faible | Quantité du panier lue sans contrôle de type | `cart.js` : `readCart` | Une quantité texte se concatène (« 1 » + 1 = « 11 ») | Normalisation en entier positif | **Corrigé** |
| P-42 | Faible | Quantité affichée sur le suivi non échappée | `commande.js` : rendu des lignes | Défense en profondeur (la quantité est déjà validée par l'API) | Échappement | **Corrigé** |
| P-43 | Faible | Fenêtre d'accueil réapparaissant après « Créer mon compte » | `order-launch.js` : seule la fermeture marquait la fenêtre comme vue | Dérangement au retour sur l'accueil | Le lien marque la fenêtre comme vue | **Corrigé** |
| P-44 | Élevé | Commande pouvant partir en double entre deux onglets ou après une réponse perdue | La clé d'envoi était en `sessionStorage` (propre à l'onglet), le panier en `localStorage` (partagé). Constat de la re-vérification, confirmé par le juge | Deux commandes pour un même panier | Clé d'envoi partagée entre onglets (`localStorage`, 24 h), liée à l'empreinte du contenu. Le serveur doit dédoublonner par clé : **à valider sur le backend réel** | **Corrigé côté interface** ; validation serveur ouverte |
| P-45 | Moyen | Panier figé sans limite pendant la vérification du compte | `account.js` : aucun délai sur les requêtes de compte, alors que le verrou d'envoi est posé avant | Panier bloqué jusqu'au délai réseau du navigateur | Délai de 10 s, traité comme une panne réseau | **Corrigé** |
| P-46 | Moyen | Intention de commande qui survit à une déconnexion, à une commande directe ou à un abandon | `subito_pending_order_redirect` n'était purgée qu'au retour réussi | Une connexion ultérieure pouvait relancer une commande sans clic | Intention horodatée, valable 30 minutes ; purge à la déconnexion, après une commande directe et en cas de reprise non autorisée | **Corrigé** |
| P-47 | Moyen | Limite de 2 h du suivi non appliquée dans un onglet resté ouvert | Le minuteur s'arrêtait à zéro ; le contrôle des 2 h ne tournait plus. **Le rapport annonçait à tort ce point comme corrigé** | Suivi périmé affiché sans fin | Minuteur maintenu après « prête » ; limite de 2 h appliquée | **Corrigé** (correction annoncée à tort précédemment) |
| P-48 | Moyen | Fin du compte à rebours non annoncée aux lecteurs d'écran | Le compte à rebours portait `aria-live="off"` | Le lecteur ne signale pas que la commande est prête | Annonce une seule fois à la fin (`aria-live` passe à `polite`) | **Corrigé** ; effet au lecteur d'écran à confirmer |
| P-49 | Faible | Gardes incomplètes pendant l'envoi | `SubitoCart.clear` et le rappel téléphonique (`checkCallFollowup`) vidaient le panier sans garde | Panier vidé pendant l'envoi | Gardes ajoutées | **Corrigé** |
| P-50 | Faible | Verrou et bouton non relâchés après un 401 ou un retour arrière | `fail()` et le gestionnaire `pageshow` | Bouton bloqué jusqu'au rechargement | Remise à zéro du verrou et du bouton | **Corrigé** |
| P-51 | Faible | Vidange par un autre onglet après une réponse positive | `clearCart` efface aussi les lignes ajoutées ailleurs pendant l'envoi | Article perdu sans message | Comparer le contenu envoyé avant de vider | **Ouvert** |
| P-52 | Faible | Quantité sans plafond côté interface | Le serveur refuse plus de 20 exemplaires par ligne, avec un message générique | Commande refusée sans explication | Décider du plafond affiché et du message | **Ouvert**, règle à confirmer |
| P-53 | Décision propriétaire | Envoi au premier clic, sans récapitulatif ni confirmation, et reprise automatique après connexion | Constat de la re-vérification (choix produit pré-existant) | Envoi involontaire possible | Ajouter une confirmation avant envoi, ou assumer le choix | **Décision du propriétaire** |
| P-54 | Faible | Cookie de session non conservé par le navigateur | Hypothèse : la connexion réussit mais la session reste absente ; pas de message dédié | Boucle sans issue visible | Test sur navigateur réel | **Non vérifié** (hypothèse) |
| P-55 | Élevé | Suite de tests API instable en local : résultats différents d'une passe à l'autre | `node --test tests/api/` sur une copie du dépôt (PHP 8.3.36 portable, SQLite). Passe 1 : 44 réussies, 13 échouées sur 57 entrées. Passe 2 (séquentielle) : 36 réussies, 21 échouées. Échecs `connect ETIMEDOUT 127.0.0.1`, puis cascades probables : un test qui échoue avant son nettoyage peut laisser un verrou aux suivants. Quatre requêtes successives réussissent dans un test isolé | Aucune conclusion fiable sur le produit. Cause non établie (serveur `php -S` mono-processus sous Windows, base SQLite partagée : hypothèses non confirmées) | Serveur de test isolé, tests indépendants, base réinitialisée à chaque cas ; relancer | Ouvert, lot backend |

Corrigés pendant l'audit (détail en section 5) : libellés d'en-tête, titres, rôles d'alerte, contrastes, cibles tactiles, canonique, données structurées de moyens de paiement, page 404, `robots.txt`, fichiers de configuration, commentaires contenant des codes.

## 5. Fichiers modifiés et fonctions corrigées

### 5.1 Corrections faites pendant l'audit

| Fichier | Modification | Constat traité | Vérification |
|---|---|---|---|
| `assets/js/account.js` (`me()`) | Une panne n'est plus prise pour un invité ; rien n'est mis en cache en cas d'erreur | Erreur réseau envoyant le client vers la connexion | R01, R01b, R02, R03 |
| `assets/js/compte.js` | `safeReturnUrl` : retour limité au même site ; `escText` pour l'historique et les villes ; liste blanche des statuts ; validation de l'inscription (prénom, nom, e-mail) avant tout appel ; repli si la session ne répond pas | Redirection ouverte ; échappement ; validation | R04 à R07 |
| `assets/js/cart.js` | `saveCart` et `writeCart` renvoient leur état ; `addLine` explique l'échec si le stockage est refusé ; `setQty` et `removeItem` refusés pendant l'envoi ; `renderStickyFooter` garde le message et désactive le bouton ; `renderDeliveryStatus` affiche une erreur au lieu d'attendre ; appels au stockage protégés ; rôles `status` et `alert` ; commentaire périmé corrigé | Stockage refusé ; état bloqué pendant l'envoi ; message figé | R08 ; T07 à T11 |
| `assets/js/commande.js` | Rendu seulement si la commande change ; bandeau « connexion perdue » ; erreur en `role="alert"` ; libellé « livreur » en livraison ; `role="status"` sur les états | Panne effaçant la commande ; annonces | R10, R11 |
| `assets/js/order-launch.js` | Focus à l'ouverture sur le bouton Fermer ; Tab et Maj+Tab restent dans la fenêtre ; Échap et fermeture rendent le focus | Piège clavier | R09 |
| `compte.html` | `role="alert"` sur les trois zones d'erreur ; `role="status"` sur le message de succès | Messages non annoncés | axe ; R07 |
| `index.html` | Données structurées : moyens de paiement « Cash, Credit Card, Ticket Restaurant » | Liste incomplète | Lecture |
| `grand-tirage.html` | Canonique et `og:url` vers `grand-tirage.html` (l'ancienne adresse ne fait que rediriger) ; nom accessible du bouton « Tirer le levier » contenant le texte visible | Référencement ; libellé (2.5.3) | axe |
| `404.html` | 22 chemins rendus absolus | Chemins cassés sur les adresses imbriquées | Lecture |
| 14 pages (en-tête) | `aria-label` retirés des deux liens de l'en-tête : le nom accessible est le texte visible | Libellé (2.5.3) | axe, 0 violation |
| `vegetarien.html` | 6 titres de plats passés de niveau 3 à niveau 2 | Saut de niveau (h1 vers h3) | axe, 0 violation |
| `robots.txt` | Interdiction d'exploration de `/api/`, `/commercant/`, `/reports/`, `/tests/`, `/.claude/`, `/subito-popup/` | Dossiers internes explorables | Lecture. Ce fichier n'est pas une protection |
| `.gitattributes` | Ligne parasite « jj » retirée | Hygiène du dépôt | Lecture |
| `.gitignore` | `api/_*.php` ajouté | Sondes non suivies par git | Lecture |
| `commercant/index.html` et `assets/js/commercant.js` | Une ligne de commentaire contenant des codes d'accès supprimée dans chacun (valeurs non reproduites) | Codes dans le code source | Recherche masquée |
| `assets/css/style.css` | `--gold-ink` et `--field-border` ajoutés ; texte doré foncé ; indice de rejouabilité, signature et bordure des champs ajustés | Contrastes (5.2) | Calcul ; axe |
| `assets/css/compte.css` | Message d'erreur en `--red-dark` | Contraste (5.2) | Calcul |
| `assets/css/cart.css` | Bouton « retirer » et « vider le panier » à 24 px au moins | Cible tactile (2.5.8, AA) | Mesure en navigateur |
| `tests/README.md` (nouveau) | Mode d'emploi des tests et garanties | Traçabilité | Lecture |
| `tests/e2e/regressions-audit.mjs` (nouveau) | 19 contrôles de régression | Traçabilité | Exécuté, 19/19 |
| `tests/e2e/parcours-commande.mjs` | Attentes T08 à T10 et T09 alignées sur le contrat en vigueur (message réseau distinct, identifiant numérique de commande) | Attentes périmées | Exécuté, 15/18 |
| `assets/js/compte.js` (suite) | `safeReturnUrl` refuse les chemins commençant par `//` ; le retour légitime après connexion pose `subito_resume_ok` | Redirection hors site ; reprise sans clic (P-29, P-30) | R04b, R13, R14 |
| `assets/js/cart.js` (suite) | `resumeOrderIfNeeded` ne relance rien sans `subito_resume_ok` (drapeau consommé) ; `setCheckoutDisabled` ; `addLine` et « Vider le panier » refusés pendant l'envoi ; `readCart` normalise la quantité | Reprise ; panier figé ; bouton ; quantité (P-30 à P-32, P-41) | R13, R14 ; T07 à T11 |
| `assets/js/account.js` (suite) | `request` : réponse réussie sans JSON = `bad_response` ; `me` : réponse sans `customer` = erreur | Client invité par erreur (P-33) | R01, R01b, R02, R03 |
| `assets/js/commande.js` (suite) | Limite de 2 h dans le minuteur (`renderExpired`) ; `aria-live="off"` sur le compte à rebours ; quantité échappée | Suivi périmé ; annonces ; échappement (P-34, P-35, P-42) | R10, R11, R12 |
| `assets/js/order-launch.js` (suite) | Le lien « Créer mon compte » marque la fenêtre comme vue | Réapparition de la fenêtre (P-43) | R09 (ce cas n'est pas couvert) |
| `assets/css/order-launch.css`, `cart.css`, `commande.css`, `compte.css` (suite) | Couleurs foncées pour les textes dorés et les états ; boutons du tiroir à 24 px au moins | Contrastes et cibles (P-36) | Calcul ; axe |
| `tests/e2e/regressions-audit.mjs` (suite) | R04 : domaine `.invalid` (jamais résolu) ; R04b ; R13 ; R14 | Tests non hermétiques ; reprise non couverte (P-29, P-30) | Exécuté, 19/19 |
| `tests/e2e/parcours-commande.mjs` (suite) | T05b (statut positif), T12 (drapeau de reprise), T13 (concordance indicateur et bouton), T14 (envoi sans produit, ou blocage avec message) | Assertions pouvant passer à vide (revue) | Voir section 6.2 |
| `assets/js/cart.js` (2e passe) | Clé d'envoi partagée entre onglets (`localStorage`, 24 h, empreinte du contenu) ; intention de commande horodatée, purgée à la déconnexion, après une commande directe et en cas de reprise non autorisée ; verrou et bouton relâchés après un 401 et au retour arrière ; `SubitoCart.clear` et le rappel téléphonique gardés pendant l'envoi | P-44, P-46, P-49, P-50 | R13, R14, R15 ; T07 à T12 |
| `assets/js/compte.js` (2e passe) | Intention de commande valable 30 minutes ; purge des clés de commande à la déconnexion | P-46 | R04, R04b, R05, R15 |
| `assets/js/account.js` (2e passe) | Délai de 10 s sur les requêtes de compte, traité comme une panne réseau | P-45 | R02, R16 |
| `assets/js/commande.js` (2e passe) | Minuteur maintenu après « prête » (limite de 2 h appliquée) ; fin annoncée une seule fois (`aria-live` passe à `polite`) | P-47, P-48 | R10, R11 |
| `tests/e2e/regressions-audit.mjs` (2e passe) | R04 et R04b : navigations du document enregistrées ; R06 : fixture alignée sur le contrat ; R15 (chaîne réelle connexion → panier → envoi) ; R16 (200 sans JSON ou sans `customer`) ; R17 (« Créer mon compte ») | P-29, P-30, P-33, P-43 | Voir section 6.2 |

### 5.2 Contrastes (valeurs calculées, formule WCAG)

| Élément | Avant | Après | Couleurs |
|---|---|---|---|
| Surtitre « ★ Livraison ★ » (`.delivery-section__eyebrow`) | 2,08:1 | 5,03:1 | `#D4AF64` → `#8A6A2C`, sur `#FFFFFF` |
| Indice « toucher le chiffre » (`.finale__replay-hint`) | 2,66:1 (pire cas calculé) | 5,58:1 | blanc à 32 % → 60 %, sur les verts du fond |
| Signature du pied de page | 4,35:1 | 4,94:1 | blanc à 50 % → 55 %, sur `#0E3B27` |
| Message d'erreur du compte | 4,38:1 | 6,39:1 | `#D62828` → `#A81E1E`, sur `#FCECEC` |
| Bordure des champs (critère 1.4.11, 3:1) | 1,26:1 | 3,60:1 (3,26:1 sur le fond du champ) | `#E7E5E1` → `#8C8680`, sur `#FFFFFF` |
| Titre de groupe du tiroir (`.cart-group-label`) et bandeau « Nouveau » | 2,08:1 | 5,03:1 | `#D4AF64` → `#8A6A2C`, sur blanc |
| Avertissement « il manque… » (`.delivery-status--warn`) et statut « En attente » | 4,26:1 | 6,23:1 | `#9A6B00` → `#7A5300`, sur `#FFF3DA` |
| « Commande refusée », « Impossible de vérifier votre adresse » | 4,38:1 | 6,39:1 | `#D62828` → `#A81E1E`, sur `#FCECEC` |

L'audit initial donnait 2,82:1 pour l'indice, sur un autre point du dégradé. Le calcul retenu ici est le pire cas.

### 5.3 Modifications d'autres intervenants observées pendant l'audit

Ces modifications ne sont pas auditées en détail dans ce rapport. Elles sont listées parce qu'elles changent l'état du dépôt :

- `assets/js/account.js` : contrat d'API en construction. Un invité est une réponse 200 avec client `null` ; les erreurs portent un code et un statut.
- `assets/js/commande.js` : identifiant numérique (`?id=`), validation `/^\d+$/` (défaut corrigé), échéance serveur (`ready_at`), horloge serveur (`server_now`).
- `assets/js/cart.js` : clé d'idempotence dans l'envoi, messages d'erreur distincts pour le réseau, redirection vers `commande.html?id=…` à partir de `data.order.id`.
- `assets/js/commercant.js` : la maquette s'authentifie par e-mail et mot de passe (`owner_login.php`) et appelle les routes propriétaire. Les données de démonstration et l'objet de codes ont été retirés.
- `compte.html`, `index.html`, `grand-tirage.html` : modifications d'un autre intervenant, contenu non détaillé ici.
- `api/` : code du backend, dont 24 entrées à la racine, `lib/` (11 fichiers), `tools/` (2 fichiers), créés entre 03 h 44 et 03 h 56.
- `reports/2026-11-19-espace-commercant-contrat-api.md` et `reports/2026-11-19-espace-commercant-integration.md`.

### 5.4 Non modifié volontairement

Ces points relèvent d'une décision du propriétaire, ou d'un autre chantier :

- horaires de prise de commande ; texte de la FAQ sur les frais ; minimum avant ou après promotion ; prix de la pizza moitié-moitié ;
- suppression des sondes `_phpinfo.php` et `_dbtest.php` ;
- Google Maps, Google Fonts, politique de confidentialité, CGV, mentions légales, allergènes ;
- disponibilité (chantier séparé) : `disponibilite.js` et `disponibilite.json` ne sont pas touchés ;
- mise en cache versionnée des ressources, optimisation des images, entité Restaurant unique.

## 6. Tests réellement exécutés

### 6.1 Environnement

- Windows 11 Home 10.0.26200 ; Node 24.19 ; Chrome 157.0.8103.51 en mode sans fenêtre, par le protocole DevTools, sans dépendance npm.
- axe-core 4.14.1 ; Lighthouse 13.6.0 (émulation mobile par défaut, réseau et processeur bridés).
- Serveur local `sub99` sur `http://localhost:8090` (`.claude/launch.json`, `.claude/serve.ps1`). Serveur statique du site : pas de PHP (les tests API lancent leur propre serveur PHP de test).
- PHP n'est pas dans le PATH du poste. Un PHP 8.3.36 portable, décompressé dans le dossier temporaire d'une session précédente (empreinte vérifiée par son auteur, rapport `reports/2026-11-19-espace-commercant-integration.md`), a servi aux tests API, sur une copie du dépôt et avec une base SQLite temporaire hors du dépôt. Aucune base MySQL. Aucune requête vers le site public.

### 6.2 Résultats

| Suite | Commande | Résultat | Échecs |
|---|---|---|---|
| Parcours de commande | `node tests/e2e/parcours-commande.mjs` | **15/18** | T13 horaires ; T14 disponibilité ; T15b cibles tactiles (5 liens dans une phrase) |
| Régression ajoutée | `node tests/e2e/regressions-audit.mjs` | **19/19** | — |
| Accessibilité automatique | `node tests/accessibilite/axe-pages.mjs` | **0 violation** sur 17 contrôles (14 pages en bureau, 3 en téléphone) | — |
| Tests API (serveur de test local) | `node --test --test-concurrency=1 tests/api/`, sur une copie, PHP 8.3.36 portable, SQLite | **Non concluant** : passe 1 (`node --test tests/api/`) 44 réussies, 13 échouées ; passe 2 (séquentielle) 36 réussies, 21 échouées (sur 57 entrées) | Échecs `ETIMEDOUT`, cascades entre tests (P-55) |
| Performance et accessibilité | `node tests/accessibilite/lighthouse.mjs` | Voir 6.3 | — |

Les suites finales ont été exécutées sur des copies du dossier `tests/`. Seul changement par rapport au dépôt : le port Chrome, pour ne pas entrer en conflit avec des instances restées ouvertes ; profils neufs. Dates (heure de Paris) : régression et Lighthouse de 12 h 25 à 12 h 26 ; parcours et axe de 12 h 31 à 12 h 32. Aucun fichier du site n'a été modifié après 12 h 22 : ces résultats portent donc sur l'état final du site.

### 6.3 Lighthouse (émulation mobile, serveur local)

| Page | Performance | Accessibilité | Bonnes pratiques | SEO | Remarques |
|---|---|---|---|---|---|
| `index.html` | 74 | 100 | 96 | 100 | LCP 4,7 s ; temps de blocage 270 ms ; images sans dimensions ; CSS et JavaScript non minifiés |
| `menu.html` | 89 | 100 | 100 | 100 | LCP 2,7 s ; temps de blocage 208 ms |
| `commande.html` | 98 | 100 | 100 | 66 | LCP 2,0 s ; SEO 66 attendu : page volontairement non indexable (`noindex`) |

Passe finale, la dernière faite après toutes les corrections : `index.html` 74, `menu.html` 89, `commande.html` 98. Une passe intermédiaire avait donné 56 pour le suivi, avec un LCP de 8,0 s ; une re-mesure isolée avait donné 98. Cette valeur isolée est jugée probablement due au bruit de mesure pendant la chaîne de tests, non démontré. Les scores de l'accueil ont varié de 73 à 84 selon les passes ; ils ne sont donc à lire qu'à quelques points près.

Mesure avant corrections (première passe) : `index.html` 81, `menu.html` 92, `commande.html` 97 (SEO 66).

### 6.4 Notes sur les tests

- Les attentes T08 à T10 ont été alignées sur le contrat en vigueur. Aucune logique d'application n'a été modifiée pour ces tests.
- R01 suit le contrat (invité = réponse 200 avec client `null`). R10 à R12 utilisent des identifiants numériques.
- R04 utilise le domaine `retour-test.invalid`, qui ne se résout jamais : aucun site public n'est contacté, même si le garde-fou régressait. R04b, R13 et R14 ont été ajoutés (section 5.1).
- Les assertions T05b, T12, T13 et T14 ont été renforcées à la suite de la revue. T13 compare désormais l'indicateur « fermé » et le bouton : il échoue hors horaires tant que le défaut est présent. T14 n'est plus validée quand aucune commande n'est envoyée sans message explicite. T12 vérifie le drapeau de reprise posé avant la connexion. T05b exige le statut positif.
- R09 ne couvre ni Maj+Tab ni la croix de la fenêtre (P-39).
- R05 : à 12 h 23, le test posait l'ancien format de l'intention de commande (« 1 »), désormais refusé comme périmé (P-46). Le test a été aligné sur le format horodaté ; le produit n'a pas été modifié pour ce test. Passe suivante : 19/19 à 12 h 25.
- Tests API : résultats non concluants (section 6.2). Les cas en échec ne sont pas corrigés ici, le backend relevant d'un autre chantier. Le harnais suppose un serveur PHP de test et une base SQLite temporaire ; il ne couvre pas MySQL.
- Captures : le test parcours enregistre deux captures d'écran (menu et panier, 375 px). Elles ont été relues (section 6.7).
- Exécutions interrompues : pendant la session, quelques instances Chrome sans fenêtre, restées ouvertes après des essais interrompus, n'ont pas pu être arrêtées ; leur arrêt a été refusé par le contrôle de sécurité de l'environnement et n'a pas été forcé. Les résultats présentés proviennent d'exécutions sur des ports et des profils neufs (copie du dossier `tests/`).
- Le premier fichier de résultats axe a été écrasé par une exécution ultérieure. La comparaison avant ou après n'est donc disponible que par la première passe : 35 nœuds `label-content-name-mismatch`, 1 nœud `heading-order` (`vegetarien.html`) et 2 nœuds `aria-allowed-role` (un attribut que j'avais ajouté, retiré depuis).
- T15b : les 5 cibles restantes sont des liens dans une phrase (pied de page, « ou appelez-nous »). L'exception « inline » du critère 2.5.8 peut les exclure, sous réserve d'interprétation. Non tranché.
- `node --check` : aucune erreur sur les fichiers JavaScript (vérification finale).

### 6.5 Revue indépendante (adversaire puis juge)

Une première revue confiée à un agent indépendant n'a pas abouti. Elle a été relancée sous forme de workflow : trois angles adversaires (régressions fonctionnelles, sécurité, accessibilité et UX), puis un juge qui vérifie chaque constat et le statut de la mission. **Résultat de la revue : terminée.** Le juge a conclu à un statut **partiel**. Exigences non tenues : la redirection hors site par `/.//hôte` et les assertions de tests pouvant passer à vide. Exigences partielles : une réponse sans JSON traitée comme client invité, l'article perdu pendant l'envoi (et le bouton resté désactivé après une panne), et des contrastes insuffisants. Le juge a confirmé que les défauts connus (horaires, disponibilité, cibles inline) restaient présents.

**Corrections appliquées ensuite** (sections 4 et 5) : redirection bloquée ; reprise de commande soumise à un drapeau posé au seul retour légitime de connexion ; panier figé pendant l'envoi ; bouton rétabli après une panne ; réponse sans JSON traitée comme erreur ; limite de 2 heures appliquée au minuteur ; assertions de tests rendues non vacuus ; contrastes corrigés.

**Re-vérification indépendante** : deux adversaires ciblés et un juge ont relu ces corrections, sans navigateur. Le résultat de cette re-vérification est présenté ci-dessous (section 6.6). Tant qu'il n'est pas rendu, les corrections ne sont pas validées au sens strict.

### 6.6 Re-vérification indépendante

En cours au moment de cette version (12 h 38) : deux adversaires ciblés (sécurité et flux de commande, tests, accessibilité et CSS) sont actifs ; le juge, qui statuera point par point sur les blocages de la revue, n'est pas encore lancé. Le résultat sera intégré ici dès son retour.

### 6.7 Audit de bout en bout : technique, interface, parcours

Le dépôt demande un passage technique, un passage d'interface et un passage de parcours, avec une boucle de correction et de re-test bornée à cinq cycles.

- **Technique** : 0 erreur JavaScript captée pendant le parcours ; 0 violation axe-core sur 17 contrôles. Les envois de commande sont interceptés par le test (API simulée) : aucune réponse réelle du serveur n'a été observée.
- **Interface** : deux captures à 375 px (menu, panier) relues. Pas de défilement horizontal (T15 : 0 px). Deux constats : (1) le menu affiche « Commandes fermées » pendant que le bouton « Commander en ligne » du panier reste actif (défaut T13 visible) ; (2) la notification « ajouté ✓ » recouvre le titre du tiroir pendant quelques secondes (faible, à arbitrer).
- **Parcours** : trois échecs confirmés (T13 horaires, T14 disponibilité, T15b cibles tactiles). Le texte « Un compte gratuit est nécessaire pour commander (30 secondes à la création) », affiché sur le menu, est à valider par le propriétaire.
- **Boucle** : deux cycles de correction et de re-test depuis la première passe complète (11 h 48), dans la limite de cinq. Passes finales : régression 19/19 (12 h 25), Lighthouse (12 h 26), parcours et axe (12 h 32). Les défauts restants sont classés en section 4 et ne sont pas validés.

## 7. Résultats de charge

**Aucun test de charge n'a été exécuté.** Motifs :
- pas d'API exécutable de façon fiable ici (tests API instables, aucune base MySQL) ;
- pas de préproduction ;
- pas d'accord écrit du propriétaire ni de l'hébergeur ;
- les effets externes (SMS, e-mail, impression) et les coûts n'ont pas été levés.

Scénarios préparés, non exécutés :
1. Test de fumée : quelques commandes fictives.
2. Montée progressive du débit.
3. 100 commandes valides par minute pendant 30 minutes.
4. 200 commandes par minute pendant 5 minutes, seulement comme scénario indicatif.
5. Test de longue durée (5 heures), seulement si le propriétaire le demande et si coût et environnement sont acceptables.

Arithmétique (calculée, non mesurée) :
- 100 commandes par minute = 1,67 commande par seconde ;
- 5 heures à 100 par minute = 30 000 commandes ;
- 100 acceptations par minute = une décision humaine toutes les 0,6 seconde : la limite de cuisine et d'organisation vient avant celle du serveur ;
- page de suivi : une requête toutes les 4 secondes pour chaque commande suivie ouverte.

| Scénario | Débit | Durée | Volumes | Erreurs | Doublons | Latences | Ressources | Coût |
|---|---|---|---|---|---|---|---|---|
| Tous | non mesuré | — | — | — | — | — | — | inconnu |

## 8. Conclusion distincte par composant

- **Site client** : le comportement de l'interface est vérifié en local, avec une API simulée. Échecs connus : horaires, disponibilité, cibles en ligne de texte. Accessibilité automatique : 0 violation. Mentions légales, politique de confidentialité, allergènes et CGV absents. **Non publiable en l'état.**
- **Backend** : code en construction dans `api/`. Exécution locale tentée (PHP 8.3 portable, SQLite) : résultats instables, non concluants (P-55). La garde en ligne de commande des outils est présente (P-11 retiré). Les protections prévues (`.htaccess`, contrôle des sessions) ne sont pas vérifiées sur l'hébergement ; MySQL n'a pas été testé. **Non vérifiable de façon fiable.**
- **Écran commerçant** : la maquette est branchée sur la connexion propriétaire par e-mail et mot de passe. Les codes d'accès ne figurent plus dans le code source de la maquette. Non testé de bout en bout, ni sur téléphone réel. Pas de persistance tant que le backend n'est pas testé.
- **Alertes** : l'alarme ne fonctionne que si l'onglet est ouvert. Le son est suspendu sans geste de l'utilisateur. Aucune notification hors de l'écran. **Non fiable hors écran** ; décision à prendre.
- **Impression** : non connectée. Modèle d'imprimante non tranché. Contraintes HTTPS et réseau local à prototyper.

## 9. Conclusion de capacité

**Conclusion : test impossible. La capacité de 100 commandes par minute est donc non démontrée.**

Preuves :
1. Aucun point d'entrée de commande n'a été exécuté de façon fiable : les tests API sont instables en local (P-55), et aucune base MySQL n'a été testée.
2. Aucune préproduction disponible.
3. Interdiction de tester le site public.
4. Aucun accord du propriétaire ni de l'hébergeur.
5. La cadence humaine (une acceptation toutes les 0,6 seconde) limite la capacité avant le serveur.
6. Un test local ou un test de la page statique ne mesure pas l'enregistrement d'une commande.

## 10. Limites du test

- Local uniquement : site servi par un serveur statique ; tests API sur PHP 8.3 portable et SQLite (pas MySQL) ; navigateur sans fenêtre. Aucun test en préproduction ni en production.
- L'API est simulée dans la page (interception des requêtes). Le test valide le comportement de l'interface, pas celui du serveur.
- Les horaires ont été contrôlés avec l'horloge réelle du poste.
- axe-core et Lighthouse sont des outils automatiques : ils ne couvrent pas tous les critères.
- Un test local ne prouve aucune capacité en production.
- Le dépôt a été modifié pendant l'audit : les constats documentent un état daté.
- Aucun test sur téléphone réel, tablette, ni navigateurs iOS et Android : les comportements d'alarme, d'impression et de notification restent à vérifier.

## 11. Coûts et réglages de compte

- **Aucun compte consulté ou modifié** : OVH, GitHub, Google, messagerie, SMS, impression. Aucun forfait changé, aucune facturation, aucune ressource payante créée, aucun DNS touché.
- **Réglages à identifier par le propriétaire** :
  - offre OVH : version de PHP, MySQL, HTTPS, sauvegardes, limites de processus ;
  - visibilité du dépôt GitHub : public ou privé, non vérifié ;
  - usage de Google Maps : aucune clé trouvée dans le code ;
  - adresse de contact annoncée dans le README : existence non vérifiée.
- **Coût des tests de charge** : inconnu (dépend de l'offre et des notifications).

## 12. Checklist avant publication

**Bloquant : à cocher avant toute mise en ligne du parcours de commande**

- [ ] Backend exécuté et testé en préproduction (PHP et base), avec tests d'idempotence, de recalcul des prix, du minimum, des horaires, de la disponibilité et des accès.
- [ ] Prix, frais, minimum et total recalculés côté serveur, avec refus en cas d'écart.
- [ ] Horaires de prise de commande décidés et appliqués côté serveur.
- [ ] Disponibilité appliquée sur toutes les pages et à l'envoi (T14 réussi).
- [ ] Mentions légales complètes (RCS, SIRET, TVA, directeur de publication), validées par un professionnel.
- [ ] Politique de confidentialité et information au moment de la collecte, validées.
- [ ] Information sur les 14 allergènes pour chaque produit vendu à distance, avec le contenu fourni par le propriétaire.
- [ ] Conditions de commande (CGV) rédigées et validées.
- [ ] FAQ alignée sur les frais de livraison décidés.
- [ ] Outils `api/tools/` : garde en ligne de commande présente (vérifiée) ; `api/tools/` et `api/lib/` exclus de l'envoi.
- [ ] Sondes `api/_phpinfo.php` et `api/_dbtest.php` supprimées après accord, ou au minimum exclues de l'envoi.
- [ ] `commercant/` non publié tant que les contrôles d'accès du backend ne sont pas testés.
- [ ] README : identifiants FTP retirés ; mot de passe FTP changé si le dépôt a été partagé.
- [ ] Liste d'envoi explicite, sans `reports/`, `tests/`, `.claude/`, `subito-popup/`, `commercant/` (sauf décision), `api/` (sauf fichiers nécessaires), les fichiers `*.md`, `CLAUDE.md`, `AGENTS.md` et les dossiers de travail.
- [ ] HTTPS forcé, HSTS et en-têtes de sécurité vérifiés chez l'hébergeur.
- [ ] Version de PHP dans une branche supportée (8.4 ou 8.5 si possible, 8.3 au minimum), version de MySQL confirmée.
- [ ] Sauvegarde de la base et des fichiers, et procédure de retour arrière écrite.
- [ ] Mot de passe oublié traité (parcours par e-mail avec SPF, DKIM, DMARC, ou repli par téléphone).
- [ ] Carte Google et polices : image statique ou consentement ; polices hébergées sur le site ou consentement.
- [ ] Durée de conservation des commandes décidée (P-09 : historique ou purge).
- [ ] Impression : modèle confirmé et prototype validé, ou abandon de l'impression automatique.
- [ ] Canal d'alerte du commerçant décidé (tablette sans veille, notification, SMS de secours), et son activé par un geste de l'utilisateur.
- [ ] Tous les tests rejoués sur la version finale, résultats joints.

**Recommandé, non bloquant**

- [ ] Images dimensionnées, formats modernes, ressources minifiées et versionnées.
- [ ] Une seule entité Restaurant (`@id`) et un seul hôte canonique.
- [ ] Tests manuels : clavier complet, lecteur d'écran, parcours sur téléphone réel.
- [ ] Intégration continue, ou au minimum lancement des suites avant chaque envoi.

## 13. Prochaines étapes, par priorité

1. **Décisions du propriétaire**, dans cet ordre :
   - publication du parcours en ligne ;
   - horaires de prise de commande ;
   - texte de la FAQ sur les frais, minimum avant ou après promotion ;
   - allergènes, mentions légales, politique de confidentialité, CGV ;
   - durée de conservation des commandes ;
   - canal d'alerte du commerçant ;
   - modèle d'imprimante ;
   - mot de passe oublié ;
   - Google Maps et polices ;
   - suppression des sondes PHP et exclusion des outils ;
   - retrait des identifiants du README.
2. **Lot backend** : stabiliser la suite de tests API (serveur de test isolé, tests indépendants, base réinitialisée à chaque cas), la faire tourner sur MySQL ou MariaDB (SQLite ne suffit pas pour le schéma MySQL), corriger les échecs réels, puis passer en préproduction chez OVH.
3. **Lot disponibilité** : étendre aux pages et à l'envoi (T14).
4. **Lot commerçant** : protection serveur réellement testée, son activé par un geste, canal d'alerte choisi.
5. **Hygiène du dépôt** : une branche par chantier, commits réguliers, README sans identifiants, liste d'envoi explicite.
6. **Hébergement** : vérifier HTTPS, HSTS, PHP, MySQL et sauvegardes, en lecture seule, sans modifier de réglage.
7. **Revue humaine** : clavier, lecteur d'écran, téléphone réel, juridique.
8. **Charge** : seulement après une préproduction autorisée et un accord écrit.

## Annexe — Sources et versions consultées

- **W3C, WCAG 2.2**, pages « Understanding », consultées le 19/11/2026 : 2.5.8 Target Size (Minimum), niveau AA, 24 × 24 px, exception « inline » (page datée du 2 novembre 2026) ; 1.4.3 Contrast (Minimum), 4,5:1 et 3:1 pour le grand texte (datée du 4 octobre 2026) ; 1.4.11 Non-text Contrast, 3:1 (même date) ; 2.5.3 Label in Name, niveau A ; 4.1.3 Status Messages, niveau AA.
- **OWASP Top 10:2025**, `https://top10.owasp.org/2025` (redirection depuis `owasp.org/Top10/2025/`). Catégories : A01 Contrôle d'accès défaillant ; A02 Mauvaises configurations de sécurité ; A03 Défaillances de la chaîne d'approvisionnement logicielle ; A04 Défaillances cryptographiques ; A05 Injection ; A06 Conception non sécurisée ; A07 Défaillances d'authentification ; A08 Défaillances d'intégrité des logiciels et des données ; A09 Défaillances de journalisation et d'alerte ; A10 Mauvaise gestion des situations exceptionnelles. Date de publication non affichée.
- **PHP, branches supportées**, `https://www.php.net/supported-versions.php`, affichage « Today: 19 Nov 2026 » (voir P-16).
- **MySQL 8.4 Reference Manual**, §1.7.2.3 « FOREIGN KEY Constraint Differences » : les clauses `REFERENCES` écrites dans la définition d'une colonne sont analysées mais ignorées. Le schéma `api/lib/schema.php` utilise des contraintes `FOREIGN KEY` explicites ; non exécuté sur MySQL (seulement sur SQLite, en test).
- **Google Search Central**, données structurées LocalBusiness : `name` et `address` requis ; `telephone` et `openingHoursSpecification` recommandés. Date non affichée.
- **Chrome for Developers**, politique d'autoplay : un `AudioContext` créé sans geste démarre suspendu ; `resume()` après un clic. Date non affichée.
- **WebKit**, « Web Push for Web Apps on iOS and iPadOS », 16 février 2023 : installation sur l'écran d'accueil, autorisation demandée après un geste de l'utilisateur, iOS et iPadOS 16.4 au minimum.
- **Règlement (UE) n° 1169/2011**, EUR-Lex, version consolidée du 1er avril 2025 : articles 9 (mentions et allergènes), 14 (vente à distance) et 44 (denrées non préemballées). **Lecture partielle**, à confirmer sur le texte officiel.
- **Règlement (UE) 2016/679 (RGPD)**, EUR-Lex, article 13 (information au moment de la collecte). **Lecture partielle**, à confirmer.
- **CNIL**, « cookies et autres traceurs » : page non accessible au moment de la consultation (erreur HTTP 503). Non citée.
- **Non vérifiés ici**, à confirmer avant tout usage : décret n° 2015-447 (France, denrées non préemballées), article 6 de la loi pour la confiance dans l'économie numérique (mentions légales), article L221-28 du Code de la consommation (denrées périssables).
