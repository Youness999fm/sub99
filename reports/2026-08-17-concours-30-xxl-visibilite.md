# Mission — Faire du concours des 30 pizzas XXL l'événement central du site

## Demande initiale
Le concours "30 pizzas XXL" (30 pizzas de 50 cm à gagner, tirage le 30 août) existait déjà sur le site mais était invisible en dehors de `reseaux.html`. Mission : le rendre impossible à manquer pendant les 13 derniers jours, sans dégrader la conversion (commande) ni inventer d'information.

## Audit des données réelles (aucune invention)
Trouvées dans le code existant (`reseaux.html`, `menu.html`, `main.js`) :
- 30 pizzas XXL à gagner = 15 gagnants × 2 pizzas XXL chacun.
- Taille XXL réelle : 50 cm (prix normal 33,00 €, tableau des tailles de `menu.html`).
- Participation (3 étapes, 100% Snapchat) : ajouter `subito_henin` → partager le flyer posté sur sa story Snapchat → identifier `@subito_henin` sur sa propre story.
- Bonus : cadeaux surprise révélés en vidéo.
- Tirage : vidéo sur TikTok, le 30 août — `daysUntilContestDraw()` (déjà existant dans `main.js`) donne **13 jours** au 17/08/2026, cohérence confirmée avec la mission.
- Liens réels : Snapchat `snapchat.com/add/subito_henin`, TikTok `tiktok.com/@subitopizzaoriginal`.

**Information manquante signalée à l'utilisateur** : aucune photo réelle de la pizza XXL / du flyer du concours dans `assets/img/`. Le "demi-mètre monumental" a donc été construit en typographie + comparatif de tailles proportionnel (CSS, données réelles du menu), pas en photo inventée. Aucun système d'analytics n'est installé sur le site (pas de tracking d'événements proposé, rien à mesurer avec).

## Diagnostic et décision
3 pistes considérées : (1) bandeau événementiel global + carte d'impact accueil — retenue ; (2) pop-up d'entrée — écartée (risque de dégrader la conversion commande, non justifiable avec les infos dispo) ; (3) élément flottant persistant — écarté (le bouton "retour en haut" occupe déjà ce coin sur mobile).

## Système implémenté — 4 points de contact réels
1. **Bandeau événementiel** (`.event-ribbon`), tout en haut de **8 pages** (index, menu, avis, reseaux, composer, vegetarien, supplements, faq) — avant même le header. Countdown réel intégré. Lien vers `concours.html`.
2. **Carte d'impact sur l'accueil** (`.contest-teaser`, `index.html`), placée juste après le bouton d'appel (la commande reste le tout premier CTA) : chiffre "30" monumental (même langage visuel que le compteur "10 000 jours"), mention 50 cm, countdown réel, CTA "Comment participer ↗".
3. **Pastille contextuelle sur le menu** (`menu.html`), juste sous la ligne XXL du tableau des tailles.
4. **Ligne de relance en pied de page**, sur les mêmes 8 pages — dernière opportunité avant de quitter le site.
5. **Page dédiée `concours.html`** (nouvelle) : fiches rapides QUOI/COMBIEN/TAILLE/QUAND/COMMENT, comparatif d'échelle des 4 tailles réelles (26/31,5/40/50 cm), carte concours complète reprise de `reseaux.html`, avertissement honnête ("la participation se fait sur Snapchat, pas sur ce site").

**Tout est calculé depuis la vraie date du tirage** (`daysUntilContestDraw()`, déjà existant) — bandeau, carte, pastille et ligne de pied de page se masquent automatiquement après le 30 août (`initContestPresence()` dans `main.js`), sans action manuelle à prévoir.

**Choix délibérés d'exclusion** : pas de pop-up/interstitiel (coût de conversion non justifié), pas d'élément flottant sticky supplémentaire (conflit avec le bouton retour-en-haut), pas de 5ᵉ lien permanent dans la nav principale (le bandeau, plus visible et auto-expirant, remplit ce rôle sans laisser de lien mort après le 30 août).

## Vérifications réelles (navigateur, pas de simulation)
- Bandeau : visible en premier sur mobile (375px), countdown "plus que 13 jours" correct, aucune erreur console.
- Carte accueil : hiérarchie 30 → PIZZAS XXL → 50 cm → countdown → CTA confirmée par capture.
- Pastille menu : bien positionnée sous la ligne XXL à 33 €.
- `concours.html` : les 5 fiches, le comparatif de tailles, la carte complète (étapes, countdown, CTA Snapchat/TikTok) et l'avertissement de bonne foi s'affichent correctement ; pas de bandeau auto-référencé (choix voulu).
- Correctif appliqué en cours de route : la nouvelle ligne de pied de page pouvait passer sous le bouton flottant "retour en haut" en bas de page — padding du footer augmenté (34px → 70px) pour dégager l'espace, revérifié par capture.
- Aucune nouvelle erreur console sur les pages testées (index, menu, avis, concours).

## Suite — formulaire de réclamation redirigé vers SMS (même journée)

Demande séparée : le formulaire de réclamation (section "Un souci avec votre commande ?" de `avis.html`) envoyait par email (`contact@subito-pizza-heninbeaumont.fr`). L'utilisateur veut recevoir ces messages sur son numéro personnel (0765299386), sans que ce numéro soit visible par les clients.

**Contrainte technique clarifiée avec l'utilisateur** (site statique, sans serveur) : impossible d'envoyer un SMS "en coulisses" sans passer par l'appareil du client. Option choisie après clarification : un lien `sms:` pré-rempli — le numéro n'apparaît nulle part dans le HTML/texte visible de la page, mais s'affiche dans l'appli SMS du client au moment d'envoyer (comportement natif de tout lien `sms:`, inhérent au web, pas contournable sans backend).

Implémenté dans `initComplaintForm()` (`assets/js/main.js`) : construit `sms:+33765299386?body=...` (séparateur `&` au lieu de `?` sur iOS, sinon le message ne se pré-remplit pas). Vérifié : le numéro n'apparaît dans aucun fichier `.html` du site (grep), le formulaire se soumet sans erreur console, le panneau de confirmation s'affiche normalement.

## Reste à faire / suggestions pour l'utilisateur
- Envoyer une vraie photo de la pizza XXL ou du flyer si disponible, pour remplacer le comparatif typographique par un visuel encore plus fort.
- Si mesurer la performance de l'opération est souhaité, il faudra d'abord installer un outil d'analytics (aucun n'est présent actuellement) — sans quoi aucun événement ne peut être suivi.
