# Mission — Automatisation hebdomadaire du Panuzo + correction ingrédients

## Demande initiale
Centraliser toute la communication du Panuzo (offre éphémère du lundi) autour d'une logique unique pilotée par le jour de la semaine réel (fuseau Europe/Paris, sans date en dur) : mode "AUJOURD'HUI + 9,90 €" le lundi, mode "TOUS LES LUNDIS" le reste de la semaine, transition automatique à minuit, aucune intervention manuelle nécessaire. Remplacer partout "roquette" par "salade fraîche" et adopter la liste d'ingrédients officielle (pesto, salade fraîche, charcuterie de bœuf, burrata, huile d'olive).

## Analyse préalable
Site statique sans framework ni SSR — les remarques "hydratation/SSR" de la demande ne s'appliquent pas ici (confirmé, pas de Next.js/React/Vue dans le projet), donc pas de risque de décalage serveur/client à gérer.

Recensement complet des mentions Panuzo : section vedette sur `index.html` (`#panuzo-teaser` — bandeau défilant, badge sur l'assiette, liste d'ingrédients, ribbons, étapes, bouton rappel), fiche produit sur `menu.html` (`.panuzo-menu-feature`), carte sur `reseaux.html` (`.panuzo-card`), et une ligne de pied de page identique dupliquée sur **9 pages** (`index`, `menu`, `composer`, `vegetarien`, `avis`, `reseaux`, `faq`, `supplements`, `concours` — absente de `mentions-legales.html` et `404.html`, vérifié). Le prix n'existait nulle part sur le site (une note disait même explicitement "Pas encore de prix ni de commande en ligne") : ajouté à ces 3 emplacements, jamais en dur, toujours via la config centrale.

**Écart avec le brief signalé ici plutôt que corrigé en silence** : la liste d'ingrédients officielle demandée (pesto, salade fraîche, charcuterie de bœuf, burrata, huile d'olive) ne contient plus "mozzarella", présente dans l'ancienne liste du site. Traité comme une mise à jour de recette assumée par le client (burrata remplace mozzarella), pas comme une suppression arbitraire — mais à confirmer si ce n'était pas voulu.

## Logique centrale

**`assets/js/main.js`**, bloc `PANUZO_CONFIG` / `getParisWeekday()` / `getPanuzoStatus()` / `applyPanuzoStatus()` / `initPanuzoStatus()` (juste avant `initPanuzoReminder()`) :

- `getParisWeekday()` calcule le jour réel à Hénin-Beaumont via `Intl.DateTimeFormat(..., { timeZone: 'Europe/Paris' })` — jamais l'heure de l'appareil du visiteur, et le passage heure d'été/hiver est géré nativement par la base de fuseaux IANA (aucune librairie ajoutée).
- `getPanuzoStatus()` est la **source unique de vérité** : elle compare ce jour au jour de disponibilité configuré et retourne tous les textes/prix dérivés (badge, prix, bandeau défilant, pied de page). Aucun composant ne teste le jour lui-même.
- `applyPanuzoStatus()` écrit ce statut dans le DOM via des sélecteurs `data-panuzo="..."` (marquee, tag, price-line) et quelques ids ciblés (badge à deux lignes, pied de page) — chaque point de contact n'est mis à jour que s'il existe sur la page courante.
- `initPanuzoStatus()` s'exécute au chargement puis se revérifie toutes les 60 secondes (comparaison avec le dernier état connu, aucune réécriture DOM si rien n'a changé) : un onglet laissé ouvert de lundi soir à mardi minuit bascule tout seul en mode normal, sans polling lourd.

## Ce qui a été modifié

- **`assets/js/main.js`** : nouveau bloc Panuzo (config + logique, ~85 lignes), appel `initPanuzoStatus()` ajouté au `DOMContentLoaded`.
- **`assets/css/style.css`** : styles des nouveaux éléments prix (`.panuzo-teaser__price`, `.panuzo-menu-feature__price`, `.panuzo-card__price`), état `.is-panuzo-today` (liseré doré + prix mis en évidence sur les 3 cartes, pulsation très discrète du badge accueil — neutralisée automatiquement par la règle `prefers-reduced-motion` déjà présente dans le fichier), grille d'ingrédients adaptée à 5 éléments (le 5ᵉ centré pleine largeur).
- **`index.html`** : liste d'ingrédients remise à jour (icônes réutilisées intelligemment — mozzarella→burrata et roquette→salade fraîche gardent leurs pictos existants, nouvelle icône "goutte" pour l'huile d'olive), texte alternatif de la photo, hooks `data-panuzo`/`id` sur le bandeau défilant, le badge et le pied de page, nouvelle ligne de prix.
- **`menu.html`** : fiche Panuzo mise à jour (tag, nouvelle ligne de prix, ingrédients, suppression de la mention "pas encore de prix" devenue fausse, texte alternatif), pied de page.
- **`reseaux.html`** : carte Panuzo mise à jour (tag, nouvelle ligne de prix, ingrédients), pied de page.
- **7 autres pages** (`composer`, `vegetarien`, `avis`, `faq`, `supplements`, `concours` + `index`/`menu`/`reseaux` déjà comptées) : uniquement la ligne de pied de page rendue dynamique.
- **Zéro** occurrence de "roquette" restante sur l'ensemble du site (vérifié par recherche globale après coup).

## Configuration facile

Tout se modifie à un seul endroit : `assets/js/main.js`, objet `PANUZO_CONFIG` (juste avant `initPanuzoReminder()`) — `name`, `price`, `weekday` (jour de disponibilité), `ingredients` (tableau, ordre = ordre d'affichage). Le jour de disponibilité lui-même n'est jamais codé en dur ailleurs que dans ce champ `weekday`.

## Tests effectués (navigateur réel, serveur `sub99`)

Le 24 août 2026 étant un **vrai lundi**, le mode "aujourd'hui" a d'abord été vérifié en conditions réelles (aucune simulation) sur `index.html`, `menu.html` et `reseaux.html` : badge "C'est aujourd'hui / 9,90 € !", tag "🔥 C'est aujourd'hui !", prix "Aujourd'hui seulement — 9,90 €", bandeau défilant, pied de page ("🔥 Aujourd'hui : le Panuzo, 9,90 € !"), classe `is-panuzo-today` posée sur les 3 conteneurs — tous cohérents entre eux.

- **Les 7 jours de la semaine** rejoués via le vrai code de `getPanuzoStatus()` (interception temporaire de `Intl.DateTimeFormat`, restaurée après coup) : seul lundi passe en mode "aujourd'hui", les 6 autres jours donnent identiquement "Tous les lundis · En éphémère" / "9,90 € le lundi" — jamais "aujourd'hui" hors du lundi, jamais "0 jour" ou formulation incohérente.
- **Rendu visuel du mode "mardi → dimanche"** appliqué réellement au DOM et capturé : tag et prix reviennent au mode normal, le liseré doré `is-panuzo-today` disparaît.
- **Mobile (375 px)** : aucun débordement horizontal, badge et prix lisibles immédiatement, grille d'ingrédients à 5 éléments bien composée.
- **9 pages** vérifiées par fetch : pied de page dynamique présent partout, aucune ancienne version figée restante, aucune occurrence de "roquette".
- **Animation** : `getComputedStyle` confirme que `panuzoTodayPulse` est bien appliquée au badge en mode "aujourd'hui" (neutralisée sous `prefers-reduced-motion`, règle globale déjà en place).
- **Console/réseau** : aucune erreur JS imputable à ces changements (les 2 requêtes en échec observées concernent l'iframe Google Maps, préexistantes et sans rapport).
- **CTA existants** ("Découvrir en avant-première", ancre `#panuzo-teaser`, bouton "Me rappeler lundi à 19h") non modifiés, non cassés.

## Verdict
Conforme au périmètre demandé. Un écart de contenu (mozzarella retirée de la liste officielle fournie) a été identifié et appliqué tel que demandé, mais signalé au client plutôt que traité en silence. **PASS.**
