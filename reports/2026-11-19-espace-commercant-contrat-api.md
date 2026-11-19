# Espace commerçant — contrat API (intégration de la maquette `commercant/`)

Date : 2026-11-19 · Dépôt : `sub99` · Statut : **contrat de travail entre les trois lots** (backend PHP, espace commerçant, site client). Tout écart doit être signalé avant d'être codé.

Mission et rapport final : [2026-11-19-espace-commercant-integration.md](2026-11-19-espace-commercant-integration.md) (à produire en fin de mission).

---

## 0. Principes

- **Hébergement cible** : OVH mutualisé (Apache, PHP 8.1+, MySQL). **Aucun service payant** : pas de push, pas d'e-mail, pas de CDN, pas de prestataire.
- **Local, tests seulement** : PHP 8.3 portable + SQLite. Le code doit rester compatible MySQL 5.7/8 et PHP 8.1+ (pas de `CHECK`, pas de type `JSON`, pas de `FOR UPDATE`, pas de `INSERT OR IGNORE`, pas de `ON DUPLICATE KEY`, pas de fonction `mb_*` réservée à PHP 8.2+).
- **PHP pur** : PDO, pas de composer, pas de framework.
- **Argent** : entiers en centimes, suffixe `_cents`. Jamais de flottant côté serveur.
- **Dates** : UTC au format `2026-11-19T18:03:12Z`. Jour de service : `YYYY-MM-DD` calculé à Europe/Paris.
- **Réponses** : toujours JSON (`Content-Type: application/json; charset=utf-8`), `Cache-Control: no-store`.
- **Enveloppe** : succès `{"ok": true, ...}` ; erreur `{"ok": false, "error": "<code>", "message": "<texte français>", ...détails}`.
- **Écritures en POST uniquement** (même pour une mise à jour). Corps JSON obligatoire, `Content-Type: application/json`, sinon `415`. Taille max du corps : 64 Ko (`413`).
- **Origine** : si l'en-tête `Origin` est présent, il doit être dans `app_origins` de la configuration, sinon `403 bad_origin`.
- **Authentification** : jeton aléatoire de 32 octets (base64url) placé dans un cookie `HttpOnly`. Seul le SHA-256 du jeton est stocké en base. Aucun jeton, mot de passe ou clé dans une URL, dans `localStorage` ou dans une réponse.
  - `subito_owner` : propriétaire, `SameSite=Strict`, `Path=/api/`.
  - `subito_customer` : client, `SameSite=Lax`, `Path=/api/`.
  - `Secure` si `cookie_secure` est vrai dans la configuration (vrai en production, faux en local `http://`).
- **Rôles** : un seul propriétaire (table `owners`, créé en ligne de commande, aucune route d'inscription). Clients : table `customers`. Une session ne vaut que pour son rôle : une session client sur une route propriétaire donne `403 forbidden`, sans session donne `401 unauthorized`.

---

## 1. Codes d'erreur

| HTTP | `error` | Cas | Champs supplémentaires |
|---|---|---|---|
| 400 | `bad_request` | JSON illisible, corps absent | — |
| 401 | `unauthorized` | pas de session valide | — |
| 403 | `forbidden` | session d'un autre rôle | — |
| 403 | `bad_origin` | en-tête `Origin` non autorisé | — |
| 404 | `not_found` | ressource absente, ou pas à ce client | — |
| 405 | `method_not_allowed` | mauvaise méthode HTTP | — |
| 409 | `email_taken` | inscription avec un e-mail déjà pris | — |
| 409 | `price_mismatch` | total envoyé ≠ total calculé par le serveur | `server_products_cents`, `server_promo_cents`, `server_delivery_fee_cents`, `server_total_cents` |
| 409 | `already_decided` | commande déjà acceptée ou refusée autrement | `status`, `delay_minutes` |
| 409 | `idempotency_conflict` | même clé d'envoi, contenu différent | — |
| 413 | `payload_too_large` | corps > 64 Ko | — |
| 415 | `unsupported_media_type` | `Content-Type` ≠ `application/json` | — |
| 422 | `validation` | champs invalides | `fields` : `{champ: "message"}` |
| 422 | `empty_cart` | aucune ligne | — |
| 422 | `minimum_not_reached` | minimum de la ville non atteint | `minimum_cents`, `products_after_promo_cents` |
| 422 | `address_required` | livraison sans adresse, ou ville hors zone | — |
| 422 | `profile_incomplete` | téléphone manquant sur le compte | — |
| 422 | `unavailable_items` | pizza indisponible dans le panier | `unavailable`: `["Calzone (soufflée)"]` |
| 429 | `too_many_attempts` | limitation de débit | `retry_after_seconds` |
| 500 | `server_error` | erreur interne (détail seulement dans le journal serveur) | — |

Les messages `message` sont en français, courts, sans détail technique.

---

## 2. Modèle de données

Les tables sont décrites ici une fois ; `api/lib/schema.php` produit le SQL MySQL et le SQL SQLite à partir de cette liste.

| Table | Colonnes (type logique) | Contraintes |
|---|---|---|
| `owners` | id, email (texte ≤190), password_hash, created_at, updated_at | PK id, UNIQUE email |
| `customers` | id, email (≤190), password_hash, first_name (≤60), last_name (≤60), phone (≤20), street (≤150, nullable), city (≤60, nullable), created_at, updated_at, last_login_at (nullable) | PK id, UNIQUE email |
| `sessions` | id, token_hash (CHAR 64), user_type (`owner`\|`customer`), user_id, remember (0/1), created_at, last_seen_at, expires_at, revoked_at (nullable), device (≤120) | PK id, UNIQUE token_hash, INDEX (user_type, user_id) |
| `orders` | id, customer_id, idempotency_key (≤64), payload_hash (CHAR 64), status (`new`\|`accepted`\|`refused`), mode (`pickup`\|`delivery`), customer_first_name, customer_last_name, customer_phone, customer_email (snapshots), delivery_street (nullable), delivery_city (nullable), payment_methods (TEXT, tableau JSON), cash_change_for (entier nullable), products_cents, promo_cents, delivery_fee_cents, total_cents, delay_minutes (nullable), created_at, accepted_at (nullable), refused_at (nullable), service_day (CHAR 10) | PK id, UNIQUE (customer_id, idempotency_key), INDEX (service_day), INDEX (status), INDEX (customer_id, created_at) |
| `order_items` | id, order_id, position, name (≤160), variant (≤20), qty, unit_price_cents, line_total_cents, removed_json (TEXT), extras_json (TEXT), half_json (TEXT nullable), note (≤300) | PK id, INDEX (order_id) |
| `availability` | id, kind (`pizza`\|`product`\|`ingredient`), name (≤190), status (`out_today`\|`out_manual`), service_day (CHAR 10, nullable), updated_at | PK id, UNIQUE (kind, name) |
| `settings` | skey (≤64), svalue (≤255) | PK skey |
| `throttle` | id, bucket (≤190), attempts, window_start, locked_until (nullable) | PK id, UNIQUE bucket |

**Interdiction** : aucune route ne supprime une ligne de `customers` ni de `orders`. Clés étrangères en `RESTRICT`.

Valeur par défaut : `settings.default_delay_minutes = 30`.

---

## 3. Objets renvoyés

### 3.1 Commande — vue client (`customer_orders.php`, `order_status.php`, `order_create.php`)

```json
{
  "id": 42,
  "status": "new",
  "mode": "delivery",
  "customer_name": "Léo Démo",
  "delivery_address": {"street": "1 rue de l'exemple", "city": "Rouvroy"},
  "payment_methods": ["cash", "card"],
  "cash_change_for": 20,
  "items": [
    {
      "name": "Calzone (soufflée) — Thon",
      "variant": "Duo",
      "qty": 1,
      "unit_price_cents": 1600,
      "line_total_cents": 1600,
      "removed": ["oignons"],
      "extras": [{"name": "Thon", "price_cents": 150, "qty": 1}],
      "half": null,
      "note": ""
    }
  ],
  "products_cents": 1600,
  "promo_cents": 0,
  "delivery_fee_cents": 0,
  "total_cents": 1600,
  "created_at": "2026-11-19T18:03:12Z",
  "accepted_at": null,
  "refused_at": null,
  "delay_minutes": null,
  "ready_at": null,
  "service_day": "2026-11-19"
}
```

- `delivery_address` vaut `null` en mode `pickup`.
- `payment_methods` vaut `[]` en mode `pickup`. Valeurs possibles : `card`, `cash`, `ticket`, `ticket_card`.
- `cash_change_for` vaut `null` sauf si `cash` figure dans `payment_methods`.
- `ready_at` = `accepted_at` + `delay_minutes`, sinon `null`.
- `half` vaut `null` ou `{"flavor1": "...", "flavor2": "..."}`.

### 3.2 Commande — vue propriétaire (`owner_orders.php`, `owner_order_decide.php`)

Même objet, plus : `customer_id`, `customer_phone`, `customer_email` (snapshots pris au moment de la commande).

### 3.3 Client (`customer_*.php`)

```json
{"id": 7, "first_name": "Léo", "last_name": "Démo", "email": "leo@example.com", "phone": "06 00 00 00 01", "street": "1 rue de l'exemple", "city": "Rouvroy"}
```

Jamais : `password_hash`, jeton, lien, horodatage de connexion.

### 3.4 Fiche client côté propriétaire (`owner_customers.php`)

Même objet, plus `created_at` et `last_order_at` (nullable). Aucune statistique (pas de total, pas de moyenne).

---

## 4. Routes

Toutes sous `/api/`. Sauf mention contraire, les réponses de succès ont le code indiqué et l'enveloppe `ok: true`.

### 4.1 Publiques

**`GET availability.php`** — aucune session.
- 200 : `{"ok": true, "misAJourLe": "2026-11-19", "pizzasIndisponibles": ["Calzone (soufflée)"], "ingredientsIndisponibles": ["saumon"]}`
- Ne renvoie que les entrées **effectives aujourd'hui** : `out_manual`, et `out_today` dont `service_day` = jour courant. Les clés reprennent exactement celles de `assets/data/disponibilite.json` et **seulement celles-là** : une clé supplémentaire fait signaler « clé inconnue » par le garde-fou de `assets/js/disponibilite.js` (décision convenue avec la session disponibilité, 19/11). Les produits hors pizzas (`kind: product`) restent gérés par les routes propriétaire (§4.4) et n'apparaissent dans aucune réponse publique.

### 4.2 Propriétaire — connexion

**`POST owner_login.php`** — `{"email": "...", "password": "...", "remember": true}`
- 200 : `{"ok": true, "owner": {"email": "...", "remember": true}}` + `Set-Cookie: subito_owner=...`
- 401 `invalid_credentials` (message générique « Email ou mot de passe incorrect. »).
- 429 `too_many_attempts`.
- `remember: true` : cookie avec `Max-Age` de 30 jours, expiration serveur glissante de 30 jours.
- `remember: false` (défaut) : cookie de session (sans `Max-Age`), expiration serveur glissante de 12 heures.

**`GET owner_me.php`** — session propriétaire.
- 200 : `{"ok": true, "owner": {"email": "...", "remember": true, "session_id": 12}}`
- 401 sinon.

**`POST owner_logout.php`** — révoque la session courante, efface le cookie. 200 `{"ok": true}`.

**`GET owner_sessions.php`** — 200 : `{"ok": true, "sessions": [{"id": 12, "device": "Chrome · Android", "created_at": "...Z", "last_seen_at": "...Z", "expires_at": "...Z", "remember": true, "current": true}]}` (sessions actives seulement : non révoquées, non expirées).

**`POST owner_sessions_revoke.php`** — `{"scope": "others"}` ou `{"scope": "all"}`.
- `others` : révoque toutes les autres sessions propriétaire. 200 `{"ok": true, "revoked": 2}`.
- `all` : révoque toutes les sessions, y compris la courante, efface le cookie. 200 `{"ok": true, "revoked": 3, "logged_out": true}`.

### 4.3 Propriétaire — commandes

**`GET owner_orders.php`** — 200 : `{"ok": true, "server_now": "...Z", "orders": [...]}`
- Contient : toutes les commandes `new` (quel que soit leur jour), et toutes les commandes du `service_day` courant (acceptées, refusées, nouvelles).
- Tri : `created_at` croissant.

**`POST owner_order_decide.php`** — `{"id": 42, "action": "accept", "delay_minutes": 30}` ou `{"id": 42, "action": "refuse"}`
- `delay_minutes` obligatoire pour `accept`, parmi `20, 30, 40, 50, 60`. Sinon 422 `validation` (champ `delay_minutes`).
- 200 : `{"ok": true, "order": {...vue propriétaire...}, "replayed": false}`.
- Même décision déjà prise (même action, même délai) : 200 avec `"replayed": true`, sans rien modifier.
- Décision différente sur une commande déjà traitée : 409 `already_decided` avec `status` et `delay_minutes` actuels.
- Id inconnu : 404 `not_found`.
- Transition conditionnelle : `UPDATE ... WHERE id = ? AND status = 'new'`, puis contrôle du nombre de lignes modifiées.

**`GET owner_customers.php`** — `?q=` optionnel (≤ 80 caractères, recherche sur prénom, nom, téléphone, e-mail).
- 200 : `{"ok": true, "customers": [...]}` (fiches client, voir §3.4), trié par nom puis prénom, 500 au plus.

### 4.4 Propriétaire — disponibilités et réglages

**`GET owner_availability.php`** — 200 : `{"ok": true, "out": [{"kind": "pizza", "name": "Calzone (soufflée)", "status": "out_today", "service_day": "2026-11-19"}]}`
- Liste uniquement les entrées **enregistrées comme indisponibles** (les autres sont disponibles par défaut). `service_day` est `null` pour `out_manual`.

**`POST owner_availability.php`** — `{"kind": "pizza", "name": "Calzone (soufflée)", "status": "out_today"}`
- `kind` : `pizza`, `product` (autres catégories du menu), `ingredient`.
- `status` : `available` (supprime l'entrée), `out_today` (indisponible jusqu'à la fin du jour de service), `out_manual` (indisponible jusqu'à réactivation).
- `name` : 1 à 120 caractères, espaces réduits, sans contrôle.
- 200 : `{"ok": true, "out": [...]}` (même forme que GET).

**`GET owner_settings.php`** — 200 : `{"ok": true, "default_delay_minutes": 30}`.
**`POST owner_settings.php`** — `{"default_delay_minutes": 40}` (parmi `20, 30, 40, 50, 60`). 200 : même forme que GET.

### 4.5 Client — compte

**`POST customer_signup.php`** — `{"first_name", "last_name", "email", "phone", "password", "street", "city"}` (`street` et `city` facultatifs, `city` vide ou dans la liste des zones).
- 201 : `{"ok": true, "customer": {...}}` + cookie `subito_customer` (30 jours glissants).
- 409 `email_taken` ; 422 `validation` (`fields`) ; 429.
- Règles : prénom et nom 1 à 60 caractères ; téléphone 8 à 20 caractères parmi chiffres, `+`, espaces, `.`, `-`, `(`, `)`, avec au moins 8 chiffres ; e-mail valide, ≤ 190, mis en minuscules ; mot de passe 8 à 200 octets ; rue ≤ 150 caractères.

**`POST customer_login.php`** — `{"email", "password"}` → 200 `{"ok": true, "customer": {...}}` + cookie. 401 `invalid_credentials` ; 429.

**`POST customer_logout.php`** — révoque la session client courante, efface le cookie. Toujours 200 `{"ok": true}`.

**`GET customer_me.php`** — jamais 401 : 200 `{"ok": true, "customer": null}` si invité, sinon `{"ok": true, "customer": {...}}`.

**`POST customer_update_address.php`** — `{"street": "...", "city": "Rouvroy"}` (`city` vide = adresse effacée). 200 `{"ok": true, "customer": {...}}`. Ville hors zones : 422 `validation` (champ `city`).

**`GET customer_orders.php`** — 200 `{"ok": true, "orders": [...]}` : les commandes **de ce client seulement**, plus récentes d'abord, 50 au plus, vue client (§3.1).

### 4.6 Client — commande

**`POST order_create.php`** — corps :

```json
{
  "idempotency_key": "b3f1c2a0-5d4e-4f6a-9b8c-1234567890ab",
  "mode": "delivery",
  "payment_methods": ["cash", "card"],
  "cash_change_for": 20,
  "items": [
    {"name": "Calzone (soufflée) — Thon", "variant": "Duo", "qty": 1, "unit_price_cents": 1600,
     "removed": ["oignons"], "extras": [{"name": "Thon", "price_cents": 150, "qty": 1}],
     "half": null, "note": ""}
  ],
  "delivery_fee_cents": 0,
  "total_cents": 1600
}
```

- `idempotency_key` : 8 à 64 caractères, `[A-Za-z0-9-]`, obligatoire.
- `mode` : `pickup` (à emporter) ou `delivery`.
- `payment_methods` : tableau parmi `card, cash, ticket, ticket_card`, **toujours un tableau**. En `pickup` : ignoré, stocké `[]`. En `delivery` : au moins un moyen.
- `cash_change_for` : `null` si pas d'espèces ; `0` (appoint), `10`, `20`, `50` ou `100` si `cash` est coché. Obligatoire dans ce cas.
- `delivery_fee_cents` et `total_cents` : ce que le site affiche. Le serveur les **compare**, il n'utilise jamais ces valeurs pour facturer.

Réponses :
- 201 `{"ok": true, "replayed": false, "order": {...vue client...}}` — après enregistrement réussi, jamais avant.
- 200 `{"ok": true, "replayed": true, "order": {...}}` — même clé et même contenu : la commande existante est renvoyée, rien n'est créé.
- 409 `idempotency_conflict` — même clé, contenu différent.
- 409 `price_mismatch` — avec les champs `server_*`. Rien n'est enregistré.
- 422 `minimum_not_reached`, `unavailable_items`, `address_required`, `profile_incomplete`, `empty_cart`, `validation`.
- 401 `unauthorized` si pas de session client. 429 si plus de 20 envois en 10 minutes pour un même client.

Ordre des contrôles : session → forme du corps (validation) → **clé d'idempotence déjà connue** (rejeu ou conflit) → profil (téléphone) → adresse et zone → calcul serveur → disponibilités → comparaison des totaux → insertion dans une transaction.

**`GET order_status.php?id=42`** — session client, commande du client seulement.
- 200 : `{"ok": true, "server_now": "...Z", "order": {...vue client...}}`
- 404 `not_found` si absente **ou** appartenant à un autre client (ne pas distinguer les deux cas).

---

## 5. Calcul serveur (porté de `assets/js/cart.js`)

Le serveur ne fait confiance ni au total, ni aux frais. Il recalcule :

1. **Pizza** = ligne dont `variant` est non vide (même critère que `pizzaUnitPrices`), comptée `qty` fois, au prix `unit_price_cents` envoyé.
2. `gross_cents` = Σ `unit_price_cents × qty` sur toutes les lignes.
3. **Promo à emporter** (`pickup`) : trier les prix pizza par ordre décroissant ; pour chaque paire (1re et 2e, 3e et 4e…), la moins chère est offerte : `promo += prix[i+1]`.
4. **Promo livraison** (`delivery`) : même appariement, la moins chère à moitié prix, arrondie **par paire** (demi vers le haut) : `promo += floor((prix[i+1] + 1) / 2)`. Exemple : une paire à 1100 et 1125 centimes donne 1100 et 563 → promo de 563 (`floor(1126 / 2)`).
   - **Tous les calculs sont faits en centimes entiers, sans flottant** : le site client applique exactement ces mêmes règles pour `total_cents` et `delivery_fee_cents`, pour que la comparaison de l'étape 11 soit exacte (un écart d'un centime donnerait un faux `price_mismatch`).
5. `products_after_promo_cents` = `gross_cents − promo_cents`.
6. **Zone** = ville du compte client (table §6).
7. `has_pizza` = au moins une ligne dont `variant` ∈ {`Solo`, `Duo`, `Quatro`, `XXL`} (même critère que `hasPizza`).
8. `delivery_fee_cents` = `zone.fee_cents` si `delivery` **et** non `has_pizza` ; sinon `0`.
9. **Minimum** (livraison seulement) : `products_after_promo_cents ≥ zone.minimum_cents`, sinon 422 `minimum_not_reached`.
10. `total_cents` = `products_after_promo_cents + delivery_fee_cents`.
11. Comparaison : si `total_cents` envoyé ≠ calculé, **ou** `delivery_fee_cents` envoyé ≠ calculé → 409 `price_mismatch`.

**Limite connue, à signaler dans le rapport** : le serveur ne connaît pas encore le catalogue des prix (taille, supplément, composition). Il vérifie la cohérence des totaux et la règle promo/frais/minimum, pas que chaque `unit_price_cents` est le prix de la carte.

### 5.1 Zones de livraison (identiques à `DELIVERY_ZONES` de `cart.js`)

| Ville | Minimum (`minimum_cents`) | Frais (`fee_cents`) |
|---|---|---|
| Hénin-Beaumont | 1000 | 550 |
| Montigny-en-Gohelle | 1500 | 550 |
| Dourges | 1500 | 550 |
| Noyelles-Godault | 1500 | 550 |
| Courrières | 2000 | 800 |
| Billy-Montigny | 2000 | 800 |
| Fouquières-lès-Lens | 2500 | 800 |
| Rouvroy | 2500 | 800 |

Un test automatisé compare cette table à `DELIVERY_ZONES` de `cart.js`.

### 5.2 Validation des lignes

- `items` : tableau de 1 à 40 entrées ; Σ `qty` ≤ 60.
- `name` : 1 à 120 caractères après `trim`.
- `variant` : `""`, `Solo`, `Duo`, `Quatro` ou `XXL`.
- `qty` : entier de 1 à 20.
- `unit_price_cents` : entier de 1 à 50000.
- `removed` : tableau de 0 à 20 chaînes de 60 caractères au plus.
- `extras` : tableau de 0 à 20 objets `{name ≤ 60, price_cents entier 0–10000, qty entier 1–10}`.
- `half` : `null` ou `{flavor1 ≤ 120, flavor2 ≤ 120}`.
- `note` : chaîne de 300 caractères au plus (après `trim`).

### 5.3 Disponibilité côté serveur (première version)

- Une ligne est indisponible si son nom, **avant** le premier ` — ` (garniture), correspond à une entrée `availability` de `kind = pizza` effective aujourd'hui.
- Correspondance tolérante : casse, accents, apostrophes typographiques, `œ` = `oe` ; « Calzone » vaut pour « Calzone (soufflée) » (même règle que `disponibilite.js`).
- Les ruptures par ingrédient et par produit **ne sont pas** vérifiées côté serveur dans cette version (le catalogue n'existe pas encore côté serveur). Limite à signaler.

---

## 6. Sessions et sécurité

- Durées : session propriétaire 12 h glissantes (sans « rester connecté ») ou 30 jours glissants (avec) ; session client 30 jours glissants.
- `last_seen_at` mis à jour au plus une fois toutes les 5 minutes.
- Révocation : `revoked_at` renseigné ; une session révoquée ou expirée donne 401.
- Anti-abus (table `throttle`) :
  - `owner_login` et `customer_login` : 5 échecs en 15 minutes, par IP **et** par e-mail, puis verrou de 15 minutes (429 `too_many_attempts`, `retry_after_seconds`).
  - `customer_signup` : 10 inscriptions par heure et par IP.
  - `order_create` : 20 envois par 10 minutes et par client.
- Mots de passe : `password_hash(PASSWORD_DEFAULT)` / `password_verify`. Propriétaire : 12 caractères minimum. Client : 8 caractères minimum, 200 octets maximum.
- Journal serveur (`error_log`) : route, code d'erreur, horodatage. **Jamais** le mot de passe, le jeton, l'e-mail, ni le téléphone.
- En-têtes sur toutes les réponses : `X-Content-Type-Options: nosniff`, `Cache-Control: no-store`.
- Une erreur PHP non prévue donne toujours du JSON `500 server_error`, jamais une page HTML ni une trace.

---

## 7. Outils en ligne de commande (CLI uniquement)

Tous refusent de tourner si `PHP_SAPI !== 'cli'` (sortie 1, message dans la console).

- `php api/tools/install.php` : crée les tables (idempotent), insère `settings.default_delay_minutes = 30` s'il manque, et **recopie les indisponibilités existantes** de `assets/data/disponibilite.json` (`pizzasIndisponibles` → `kind=pizza`, `ingredientsIndisponibles` → `kind=ingredient`, `out_manual`) sans écraser une ligne déjà présente. Le fichier JSON n'est pas modifié.
- `php api/tools/create_owner.php` : demande l'e-mail puis le mot de passe sur l'entrée standard. Refuse s'il existe déjà un propriétaire. Avec `--reset-password` : remplace le mot de passe du propriétaire et **révoque toutes ses sessions**.

---

## 8. Configuration

`api/config.php` (ignoré par git, jamais publié) ; modèle versionné : `api/config.sample.php`.

```php
<?php
return [
    'db' => [
        'dsn'      => 'mysql:host=HOTE;dbname=NOM_BASE;charset=utf8mb4',
        'user'     => 'UTILISATEUR',
        'password' => 'MOT_DE_PASSE',
    ],
    'app_origins'   => ['https://subito-pizza-heninbeaumont.fr'],
    'cookie_secure' => true,
    'timezone'      => 'Europe/Paris',
];
```

- Variable d'environnement `SUBITO_CONFIG` : chemin d'un autre fichier de configuration (utilisé par les tests, avec SQLite hors du dépôt).
- Pour les tests locaux : `dsn = "sqlite:<chemin hors dépôt>"`, `cookie_secure = false`, `app_origins` contient `http://localhost:8091`.

---

## 9. Fichiers par lot

**Lot A — backend (PHP)** : `api/config.sample.php`, `api/.htaccess`, `api/README.md`, `api/lib/*.php`, `api/*.php` (routes), `api/tools/*.php`. **Aucun autre fichier.**

**Lot B — espace commerçant** : `commercant/index.html`, `commercant/manifest.webmanifest`, `commercant/sw.js`, `assets/js/commercant.js`, `assets/css/commercant.css`. **Aucun autre fichier.**

**Lot C — site client** : `assets/js/cart.js`, `assets/js/commande.js`, `commande.html`, `assets/js/account.js`, `assets/js/compte.js`, `compte.html`, `assets/css/compte.css`, `assets/css/cart.css`, `assets/css/commande.css` (seulement si un ajustement visuel est nécessaire). **Ne pas toucher** à `menu.html`, `assets/js/disponibilite.js`, `assets/data/disponibilite.json`, `assets/css/disponibilite.css`, ni aux autres pages.

**Hors lots** (fait par l'orchestrateur) : `robots.txt` (ajout `Disallow: /api/` et `/commercant/`), tests, rapport.

---

## 10. Ce qui n'est pas dans ce contrat (à traiter ensuite)

- Catalogue serveur des prix et des ingrédients (vérification des prix unitaires et des ruptures par ingrédient).
- Notifications push (écran verrouillé, appli fermée) : nécessitent HTTPS, des clés VAPID et un envoi côté serveur, non testables ici.
- Réinitialisation de mot de passe par e-mail (aucun e-mail n'est envoyé).
- Impression sur imprimante SUNMI ou thermique : non testée (aucun appareil).
- Mise en ligne sur OVH, HTTPS, suppression de `api/_phpinfo.php` et `api/_dbtest.php` (à faire par l'utilisateur ou son prestataire, sur accord).
