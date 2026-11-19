# Préproduction sur le sous-domaine — checklist pas à pas

Destinée à l'utilisateur (ou à son prestataire), à exécuter **sur le sous-domaine de préproduction**. Aucun accès OVH ni serveur n'a été utilisé pour préparer ce document. Rien n'est publié tant que cette checklist n'est pas terminée et que les points bloquants du rapport de mission ne sont pas tranchés.

**Version figée du paquet (19/11/2026)** : commit `d19c4c7` (arbre git `a31340b2eaba262e6e69da72cec5773c24ec0896`, même contenu hors `reports/`). Les commits suivants ne changent pas le paquet (tests et rapports seulement).
- Archive `preproduction-subito-2026-11-19.zip` : 172 fichiers, SHA-256 `839c6dce04f7dc8d1ead9e1337c285bdb8ce68b92c492ac8252a5addddd785ad`.
- Manifeste `preproduction-MANIFESTE-SHA256.txt` : une empreinte par fichier (172 lignes), à vérifier (section 0.2).
- Dossier `preproduction-paquet` : la même copie, dépliée. C'est son **contenu** qu'on téléverse.

**Éléments non figés, à revalider avant publication** : noms des avis (`avis.html`, `index.html`), réduits à prénom et initiale ; galerie de la page d'accueil, sans agrandissement tant que les photos manquent ; moitié-moitié du composeur, décidée mais pas encore implémentée (après le commit). Décidés et intégrés : concours exclu du paquet, `subito-popup/` exclu, prix des desserts et des boissons, minimums par ville, règle d'échange (une portion gratuite par pizza), catalogue serveur (testé : 26 tests).

**Remplacer avant de commencer** : `SOUS-DOMAINE` (par exemple `preprod.votre-domaine.fr`), `CHEMIN_DU_SOUS_DOMAINE` (le dossier indiqué par OVH pour ce sous-domaine), `HOTE_SSH` et `UTILISATEUR` (identifiants fournis par OVH), `CHEMIN` (dossiers sur le PC). Les libellés exacts des menus OVH peuvent varier : suivre l'interface en vigueur.

**Règle absolue** : ne jamais mettre `api/config.php` dans le dépôt, dans un message, un e-mail ou une capture d'écran. Ce fichier ne vit que sur le serveur.

## 0. Vérifier le paquet (sur le PC)

**0.1 Vérifier l'archive** :

```powershell
Get-FileHash 'CHEMIN\preproduction-subito-2026-11-19.zip' -Algorithm SHA256
```

Résultat attendu : `839c6dce04f7dc8d1ead9e1337c285bdb8ce68b92c492ac8252a5addddd785ad`. Si l'empreinte diffère, ne pas décompresser ni téléverser.

**0.2 Décompresser l'archive dans un dossier vide** (par exemple `CHEMIN\preproduction-decompressee`), puis contrôler chaque fichier contre le manifeste.

Avec Git Bash (ou Linux) :

```bash
cd 'CHEMIN/preproduction-decompressee'
sha256sum -c 'CHEMIN/preproduction-MANIFESTE-SHA256.txt'
```

Attendu : une ligne `OK` par fichier (172 lignes) et aucune ligne `FAILED`. Le manifeste est en UTF-8 sans BOM, fins de ligne LF : `sha256sum` le lit tel quel.

Avec PowerShell seul :

```powershell
Set-Location -LiteralPath 'CHEMIN\preproduction-decompressee'
$m = Get-Content -LiteralPath 'CHEMIN\preproduction-MANIFESTE-SHA256.txt' -Encoding UTF8
$echec = 0
foreach ($ligne in $m) { $h, $chemin = $ligne -split '  ', 2; if ((Get-FileHash -LiteralPath $chemin -Algorithm SHA256).Hash.ToLower() -ne $h) { $echec++; "ECHEC : $chemin" } }
"Fichiers contrôlés : $($m.Count) ; échecs : $echec"
```

Attendu : `échecs : 0`.

**0.3 Reconstruire le paquet (seulement si nécessaire)**. La reconstruction part toujours d'une version figée, jamais du dossier de travail, dont les fichiers peuvent changer pendant l'opération :

```powershell
git -C 'CHEMIN\sub99' -c core.eol=lf -c core.autocrlf=false archive --format=tar --output='CHEMIN\copie-figee.tar' a31340b2eaba262e6e69da72cec5773c24ec0896
New-Item -ItemType Directory -Path 'CHEMIN\copie-figee' | Out-Null
tar -xf 'CHEMIN\copie-figee.tar' -C 'CHEMIN\copie-figee'
powershell -NoProfile -ExecutionPolicy Bypass -File 'CHEMIN\copie-figee\tools\construire-preproduction.ps1' -Source 'CHEMIN\copie-figee' -Sortie 'CHEMIN\sortie'
```

Le script efface le dossier `preproduction-paquet` du dossier de sortie avant de le reconstruire. Après reconstruction, refaire 0.1 et 0.2, et noter la nouvelle empreinte de l'archive.

Si une page de la carte a changé, relancer d'abord, dans le dépôt : `node tools/build-catalogue.mjs`, puis `node tools/build-catalogue.mjs --check` (doit répondre « Catalogue à jour »). Une nouvelle version figée est alors nécessaire.

## 1. Créer le sous-domaine et activer HTTPS (interface OVH)

1. Créer le sous-domaine `SOUS-DOMAINE`, dont le dossier est `CHEMIN_DU_SOUS_DOMAINE`. **Ne pas utiliser la racine du domaine principal.**
2. Activer le certificat HTTPS (Let's Encrypt, inclus dans l'offre, à confirmer dans l'interface) pour ce sous-domaine, puis attendre l'activation.

## 2. Créer la base MySQL (interface OVH)

1. Créer une base MySQL. Noter, sur papier ou dans un gestionnaire de mots de passe : l'hôte, le nom de la base, l'utilisateur et le mot de passe.
2. Ne rien écrire de ces valeurs dans le dépôt, dans un fichier partagé ou dans un message.

## 3. Décompresser puis téléverser le contenu

Ne pas téléverser l'archive `.zip`. Procédure :

1. Décompresser l'archive **sur votre ordinateur**, dans un dossier vide (par exemple `CHEMIN\preproduction-decompressee`).
2. Téléverser **le contenu** de ce dossier (fichiers et sous-dossiers, pas le dossier lui-même) dans `CHEMIN_DU_SOUS_DOMAINE`, par FTP/SFTP ou par le gestionnaire de fichiers OVH. **Dans `CHEMIN_DU_SOUS_DOMAINE` uniquement**, jamais à la racine du domaine principal. Le client doit transférer aussi les fichiers qui commencent par un point (`.htaccess`, `.user.ini`).
3. **Créer à la main le dossier vide `assets/img/placeholders`** dans `CHEMIN_DU_SOUS_DOMAINE` : une archive ne peut pas transporter un dossier vide.
4. Vérifier que `.htaccess`, `.user.ini` et le dossier `api/` (avec `api/tools/` et `api/data/`) sont bien présents à la racine du sous-domaine.
5. Ne **pas** téléverser ce qui n'est pas dans le paquet : `subito-popup/`, `concours.html`, `grand-tirage.html`, `assets/js/tirage/`, `assets/js/winners-data.js`, `api/README.md`, `tests/`, `tools/`, `reports/`. Ils restent dans le dépôt (décisions du 19/11).

## 4. Créer `api/config.php` sur le serveur (jamais dans le dépôt)

Se connecter en SSH, puis :

```bash
cd ~/CHEMIN_DU_SOUS_DOMAINE/api
cp config.sample.php config.php
nano config.php
```

Dans `nano`, remplacer **toutes** les valeurs « À REMPLACER » (elles sont à deux endroits : dans `db` et dans `app_origins`) :
- dans `'db'` : `'dsn' => 'mysql:host=HOTE_MYSQL;dbname=NOM_BASE;charset=utf8mb4'`, puis `'user'` et `'password'` (valeurs de l'étape 2) ;
- `'app_origins'` : un tableau, avec l'origine HTTPS exacte, sans barre finale : `['https://SOUS-DOMAINE']` ;
- `'cookie_secure'` : doit rester `true` ;
- `'timezone'` : laisser `'Europe/Paris'`.

Puis :

```bash
chmod 600 config.php
cd ~/CHEMIN_DU_SOUS_DOMAINE
php -v
php -l api/config.php
```

`php -v` doit afficher PHP 8.1 ou plus récent. Si l'hébergement propose plusieurs versions, utiliser le chemin PHP indiqué par OVH pour une version récente. `php -l` doit répondre « No syntax errors ».

## 5. Installer le schéma, une seule fois

```bash
cd ~/CHEMIN_DU_SOUS_DOMAINE
php api/tools/install.php
```

Le script crée les tables manquantes sans effacer les données existantes, puis recopie les indisponibilités du fichier `assets/data/disponibilite.json`. Ce fichier est vide dans ce paquet : le script affiche `0 ajoutée(s)`. Il doit se terminer sans erreur. Les tests du dépôt ont tourné sur MariaDB 11.8 et sur SQLite, pas sur MySQL OVH : si le script échoue ici, le signaler avec le message exact.

## 6. Créer le compte propriétaire

```bash
cd ~/CHEMIN_DU_SOUS_DOMAINE
php api/tools/create_owner.php
```

Saisir l'adresse e-mail du propriétaire, puis le mot de passe choisi par l'utilisateur (12 caractères au minimum). Sous Unix, la saisie n'est masquée que si la commande `stty` est disponible sur l'hébergement ; sinon **le mot de passe s'affiche pendant la saisie**. Dans tous les cas, ne pas le faire pendant un partage d'écran, et fermer la session SSH après.

## 7. Vérifications sur le sous-domaine (sur le PC)

**7.0 La page d'accueil répond** :

```powershell
(Invoke-WebRequest -Uri 'https://SOUS-DOMAINE/' -UseBasicParsing).StatusCode
```

Attendu : `200`. Si la réponse est une erreur `500`, le `.htaccess` est en cause : voir 7.6.

**7.1 L'API répond en JSON** :

```powershell
Invoke-WebRequest -Uri 'https://SOUS-DOMAINE/api/availability.php' -UseBasicParsing | Select-Object -ExpandProperty Content
```

Attendu : un JSON contenant `misAJourLe`, `pizzasIndisponibles` et `ingredientsIndisponibles` (sans autre clé).

**7.2 Les fichiers internes sont refusés (403)** :

```powershell
foreach ($c in 'api/config.php', 'api/lib/db.php', 'api/tools/install.php', 'api/config.sample.php') {
  try { $r = Invoke-WebRequest -Uri "https://SOUS-DOMAINE/$c" -UseBasicParsing; "$c -> $($r.StatusCode) (ANORMAL)" }
  catch { "$c -> " + [int]$_.Exception.Response.StatusCode }
}
```

Attendu : `403` pour chacun. Si l'un répond `200`, arrêter et signaler : le fichier est accessible.

**7.3 Les fichiers absents ou refusés** :

```powershell
foreach ($c in 'api/_phpinfo.php', 'api/_dbtest.php', 'api/README.md') {
  try { $r = Invoke-WebRequest -Uri "https://SOUS-DOMAINE/$c" -UseBasicParsing; "$c -> $($r.StatusCode) (ANORMAL)" }
  catch { "$c -> " + [int]$_.Exception.Response.StatusCode }
}
foreach ($c in 'subito-popup/index.html', 'concours.html', 'grand-tirage.html', 'assets/js/tirage/main.js', 'assets/js/winners-data.js', 'tirage-au-sort') {
  try { $r = Invoke-WebRequest -Uri "https://SOUS-DOMAINE/$c" -UseBasicParsing; "$c -> $($r.StatusCode) (ANORMAL)" }
  catch { "$c -> " + [int]$_.Exception.Response.StatusCode }
}
```

Attendu, premier groupe : `403` (la règle de `api/.htaccess` refuse ces noms avant de chercher le fichier). Tout code autre que `200` est acceptable, mais `403` est le résultat normal. Attendu, second groupe : `404`, car ces pages ne sont pas dans le paquet et l'ancienne adresse `tirage-au-sort` n'a plus de redirection. Si un fichier répond `200`, arrêter et signaler.

**7.4 Redirection HTTP vers HTTPS, et non-indexation** :

```powershell
curl.exe -I http://SOUS-DOMAINE/
curl.exe -I https://SOUS-DOMAINE/
```

Attendu : la première réponse est `301` avec `Location: https://SOUS-DOMAINE/` ; la seconde contient `X-Robots-Tag: noindex, nofollow`.

```powershell
Invoke-WebRequest -Uri 'https://SOUS-DOMAINE/robots.txt' -UseBasicParsing | Select-Object -ExpandProperty Content
```

Attendu : `User-agent: *` puis `Disallow: /`.

**7.5 L'espace commerçant sur téléphone** :

1. Ouvrir `https://SOUS-DOMAINE/commercant/` sur le téléphone.
2. Se connecter avec le compte propriétaire créé à l'étape 6. Un mauvais mot de passe doit afficher un message, sans rien révéler.
3. Ajouter l'espace à l'écran d'accueil, ou l'enregistrer en favori :
   - iPhone (Safari) : bouton Partager, puis « Sur l'écran d'accueil ».
   - Android (Chrome) : menu ⋮, puis « Ajouter à l'écran d'accueil » (ou « Installer l'application »).
4. Vérifier que l'icône ouvre bien l'espace, sur la même page.

**Limite connue** : le service worker s'enregistre sur `/commercant/`, mais son cache a échoué sur les profils neufs du poste de développement. Sur le téléphone, vérifier que le favori ouvre l'espace sans réseau. Si ce n'est pas le cas, le signaler : l'utilisation hors ligne n'est pas garantie.

**7.6 Le `.htaccess` (protections)**. Le `.htaccess` du paquet contient, après la redirection HTTPS, un bloc « Protections » : `Options -Indexes`, puis les règles qui refusent les fichiers cachés, les fichiers `config*`, la documentation (`.md`), les sauvegardes (`.bak`, `.old`, `.orig`, `.swp`, `~`), les `.sql` et `.log`. Le dossier `/.well-known/` (validation HTTPS) reste accessible.
- Si la page d'accueil répond `500` (7.0), retirer ce bloc du `.htaccess` du sous-domaine (de « Options -Indexes » jusqu'à la balise `</FilesMatch>`), puis demander à OVH si `Options` et `Require` sont autorisés. Le site reste alors fonctionnel, mais les protections 7.2 ne tiennent plus : le signaler.

## 7 bis. Contrôles complémentaires

Sur le serveur, modules PHP nécessaires :

```bash
cd ~/CHEMIN_DU_SOUS_DOMAINE
php -m | grep -i -E "intl|pdo_mysql|openssl"
```

Attendu : `pdo_mysql` et `openssl` présents. `intl` est recommandé (accents des disponibilités) ; s'il manque, le signaler.

**Erreurs PHP** : elles ne doivent jamais s'afficher aux visiteurs. Vérification sans fichier de diagnostic : envoyer une requête volontairement mal formée à une route de commande, puis regarder la réponse.

```powershell
try { Invoke-WebRequest -Uri 'https://SOUS-DOMAINE/api/order_create.php' -Method Post -ContentType 'application/json' -Body '{}' -UseBasicParsing | Out-Null; 'réponse 2xx' } catch { "code : " + [int]$_.Exception.Response.StatusCode; $flux = $_.Exception.Response.GetResponseStream(); (New-Object System.IO.StreamReader($flux)).ReadToEnd() }
```

Attendu : du JSON (`{"ok":false,...}`), jamais une page avec un chemin de fichier ou une trace PHP.

**Adresse vue par PHP** : la limitation des connexions compte par adresse IP. Si OVH transmet l'adresse d'un proxy au lieu de celle du visiteur, toutes les connexions partagent un seul compteur. Test : depuis le téléphone (réseau mobile), faire six mauvais mots de passe ; depuis le PC (autre réseau), une connexion doit encore fonctionner. Si le PC est bloqué aussi, le signaler : c'est un verrou partagé.

**Son de l'espace commerçant**, sur téléphone, avec une commande de test fictive : l'alerte sonore retentit, puis s'arrête d'elle-même après 30 secondes. Le bouton « Couper le son » (en haut de l'écran) la coupe ; une nouvelle commande la rétablit (choix à confirmer). Ce comportement est testé sur navigateur ; il reste à vérifier sur un vrai téléphone.

**Notifications** : l'alerte apparaît dans la page ouverte. Une notification du navigateur n'apparaît que si l'onglet est caché et si la permission est accordée. **Il n'y a pas de notification push** : ne pas compter sur l'écran verrouillé ni sur l'appli fermée.

**Réinitialisation d'un mot de passe client**, sur le serveur, une fois la version déployée :

```bash
cd ~/CHEMIN_DU_SOUS_DOMAINE
php api/tools/reset_customer.php
```

## 8. Points restants (à trancher par l'utilisateur, non tranchés ici)

1. **Catalogue serveur des prix** : implémenté et testé (26 tests, dont la parité entre le navigateur et le serveur). Les décisions du 19/11 sont intégrées (`reports/2026-11-19-catalogue-tableau-prix-a-valider.md`, section 15). À vérifier sur le sous-domaine avec une commande de test fictive : le prix et le total affichés doivent correspondre.
2. **Source des disponibilités** : le menu lit d'abord l'API (`api/availability.php`), puis, seulement si elle ne répond pas, `assets/data/disponibilite.json`. Ce fichier ne sert que de secours (listes vides = tout disponible) : **ne pas l'utiliser pour gérer les ruptures**, c'est le rôle de l'espace commerçant. À vérifier sur le sous-domaine : une rupture saisie doit disparaître du menu.
3. **Service worker** : s'enregistre sur `/commercant/` ; cache à vérifier sur téléphone (voir 7.5).
4. **Son de l'alerte** : arrêt après 30 secondes, rétablissement à chaque nouvelle commande : à confirmer.
5. **Éléments non figés** (voir en tête) : à revalider avant publication.
6. **Décidé, à implémenter** : la moitié-moitié du composeur (à partir de Duo, comme le menu), après le commit. Elle n'est pas dans cette version.

**La préproduction reste réservée aux données de test.** Ne pas y faire commander de vrais clients.

## 8 bis. Avant une mise en ligne réelle (domaine principal)

Ces points ne sont pas techniques : ils relèvent du propriétaire, et aucun texte n'a été rédigé ici.
- **Horaires d'ouverture** : les pages donnent trois versions contradictoires (18 h–23 h ; fin à 22 h 47 ; livraison de 19 h à 22 h). À trancher, puis à appliquer (rapport d'audit, P-06).
- **Mentions légales, politique de confidentialité et information sur les allergènes** : à rédiger avec un professionnel (rapport d'audit, P-04).
- **Durée de conservation des commandes** : à décider (rapport d'audit, P-09).
- **Carte Google Maps** sur la page d'accueil : elle charge un service tiers. À mentionner dans la politique de confidentialité, ou à remplacer par un lien.

## 9. Avant toute publication sur le domaine principal

- Publier les **fichiers du site**, pas le dépôt entier : mêmes exclusions que la section 3 (`tests/`, `tools/`, `reports/`, `subito-popup/`, `concours.html`, `grand-tirage.html`, `assets/js/tirage/`, `assets/js/winners-data.js`, `api/README.md`). Utiliser le `robots.txt` et le `.htaccess` **du dépôt** : le `robots.txt` autorise l'indexation des pages publiques, et le `.htaccess` n'a pas les lignes de préproduction.
- Le `.htaccess` du dépôt n'a pas de redirection HTTP vers HTTPS. Si l'hébergeur ne la force pas, ajouter les lignes 2 à 7 du `.htaccess` du paquet (la redirection) avant de publier.
- Vérifier une dernière fois `api/` et supprimer tout fichier de test ou de diagnostic qui s'y trouverait (`api/_phpinfo.php`, `api/_dbtest.php`).
- Rappel : la publication se fait sur accord explicite de l'utilisateur.
