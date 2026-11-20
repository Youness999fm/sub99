# Moyen de paiement affiché sur le ticket de livraison

Date : 2026-11-20 · Dépôt : `sub99`

## Demande

En livraison, le client choisit déjà son moyen de paiement (carte bancaire, espèces, ticket restaurant, carte ticket restaurant) et, s'il paie en espèces, le billet avec lequel il règle (10 €, 20 €, 50 €, 100 € ou appoint exact) — voir [2026-11-19-calzone-garniture-paiement-recap.md](2026-11-19-calzone-garniture-paiement-recap.md). Ce choix était déjà enregistré (`payment_methods`, `cash_change_for`) et affiché dans le panneau de détail commerçant (`od-pay`), mais **absent du ticket imprimé** : le livreur n'avait aucun moyen de savoir, sur le papier qu'il emporte, s'il doit prévoir de la monnaie.

## Ce qui a été fait

Le ticket de livraison affiche maintenant le moyen de paiement (et le billet le cas échéant) juste sous l'adresse, dans le même encadré bien visible « LIVRAISON » — en réutilisant `paymentLabel(o)`, déjà utilisé et vérifié dans le panneau de détail, pour ne pas dupliquer la logique des libellés :

- `assets/js/commercant.js` :
  - `ticketHtml(o)` (aperçu HTML à l'écran) : ligne `.t-payment` ajoutée dans `.t-mode-box`.
  - `printerPayload(o)` (charge transmise à l'appli Android) : champ `payment` ajouté, rempli seulement en livraison.
  - `buildTicketBytes(o)` (trame ESC/POS imprimée) : la ligne de paiement est imprimée en gras juste après l'adresse, dans le même bloc LIVRAISON.
- `assets/css/commercant.css` : style `.t-mode-box .t-payment` (même emplacement que `.t-address`, séparateur fin au-dessus).

À l'emporter, rien ne change : `paymentLabel(o)` renvoie `'Au retrait'` et le bloc `.t-mode-box` entier ne s'affiche que si `o.mode === 'delivery'`.

## Vérification

Relecture de code : les trois fonctions restent cohérentes entre elles (même source `paymentLabel(o)`, même emplacement relatif à l'adresse). Aucune erreur de syntaxe (`node -c`).

**Non fait** : vérification visuelle réelle dans l'espace commerçant (nécessite de se connecter avec le code marchand, même en test local) — hors de portée pour moi, voir la consigne permanente sur les identifiants. Le premier test réel en livraison après mise en ligne confirmera visuellement la ligne de paiement sur le ticket ; si le rendu ne convient pas (position, taille), dites-le et j'ajuste.

## À republier

`assets/js/commercant.js`, `assets/css/commercant.css`.
