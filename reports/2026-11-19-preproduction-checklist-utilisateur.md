# Préproduction sur le sous-domaine — checklist pas à pas

Destinée à l'utilisateur (ou à son prestataire), à exécuter **sur le sous-domaine de préproduction**. Aucun accès OVH ni serveur n'a été utilisé pour préparer ce document. Rien n'est publié tant que cette checklist n'est pas terminée et que les points bloquants du rapport de mission ne sont pas tranchés.

**Version figée du paquet (19/11/2026)** : commit `d19c4c7` (arbre git `a31340b2eaba262e6e69da72cec5773c24ec0896`, même contenu hors `reports/`) (contenu du site, hors `reports/`).
- Archive `preproduction-subito-2026-11-19.zip` : 172 fichiers, SHA-256 `839c6dce04f7dc8d1ead9e1337c285bdb8ce68b92c492ac8252a5addddd785ad`.
- Manifeste `preproduction-MANIFESTE-SHA256.txt` : une empreinte par fichier (172 lignes), à vérifier (section 0).

**Éléments non figés, à revalider avant publication** : publication des gagnants du concours (question en cours) ; noms des avis (`avis.html`, `index.html`), réduits à prénom et initiale ; galerie de la page d'accueil (`index.html`), sans agrandissement ; moitié-moitié du composeur, décidée mais pas encore implémentée (après le commit). Les prix des desserts et des boissons, les minimums par ville et la règle d'échange (une portion par pizza) sont validés.

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

Avec PowerShell seul (testé sur le paquet du 19/11) :

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
2. Téléverser **le contenu** de ce dossier (fichiers et sous-dossiers, pas le dossier lui-même) dans `CHEMIN_DU_SOUS_DOMAINE`, par FTP/SFTP ou par le gestionnaire de fichiers OVH. **Dans `CHEMIN_DU_SOUS_DOMAINE` uniquement**, jamais à la racine du domaine principal.
3. **Créer à la main le dossier vide `assets/img/placeholders`** dans `CHEMIN_DU_SOUS_DOMAINE` : une archive ne peut pas transporter un dossier vide.
4. Vérifier que `.htaccess` (fichier caché) et le dossier `api/` sont bien présents à la racine du sous-domaine.
5. Ne **pas** téléverser `subito-popup/`, `concours.html`, `grand-tirage.html` ni `assets/js/tirage/` : ils ne sont pas dans le paquet (décision du responsable). Ils restent dans le dépôt.

## 4. Créer `api/config.php` sur le serveur (jamais dans le dépôt)

Se connecter en SSH, puis :

```bash
cd ~/CHEMIN_DU_SOUS_DOMAINE/api
cp config.sample.php config.php
nano config.php
```

Dans `nano`, remplacer **toutes** les valeurs « À REMPLACER » :
- `dsn` : `mysql:host=HOTE_MYSQL;dbname=NOM_BASE;charset=utf8mb4` (valeurs de l'étape 2) ;
- `user` et `password` : utilisateur et mot de passe de l'étape 2 ;
- `app_origins` : `https://SOUS-DOMAINE` exactement, sans barre finale ;
- `cookie_secure` : doit rester `true`.

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

Le script crée les tables et ne touche pas aux données existantes. Il doit se terminer sans erreur. Les tests du dépôt ont tourné sur MariaDB 11.8 et sur SQLite, pas sur MySQL OVH : si le script échoue ici, le signaler avec le message exact.

## 6. Créer le compte propriétaire

```bash
cd ~/CHEMIN_DU_SOUS_DOMAINE
php api/tools/create_owner.php
```

Saisir l'adresse e-mail du propriétaire, puis le mot de passe choisi par l'utilisateur (12 caractères au minimum). **Le terminal affiche le mot de passe pendant la saisie** (sauf sous Unix, où la saisie est masquée) : ne pas le faire pendant un partage d'écran, puis fermer la session SSH après.

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

**7.3 Les fichiers absents du paquet répondent 404** :

```powershell
foreach ($c in 'api/_phpinfo.php', 'api/_dbtest.php', 'api/README.md', 'subito-popup/index.html', 'concours.html', 'grand-tirage.html', 'assets/js/tirage/main.js', 'assets/js/winners-data.js', 'tirage-au-sort') {
  try { $r = Invoke-WebRequest -Uri "https://SOUS-DOMAINE/$c" -UseBasicParsing; "$c -> $($r.StatusCode) (ANORMAL)" }
  catch { "$c -> " + [int]$_.Exception.Response.StatusCode }
}
```

Attendu : `404` pour chacun. `tirage-au-sort` est l'ancienne adresse de la page du concours : sa redirection n'est pas dans le paquet, donc 404 sur le serveur. Ce n'est pas le cas pour le dépôt, qui la garde.

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

**7.6 Le `.htaccess` (protections)**. Le fichier `.htaccess` racine contient, après la redirection HTTPS, un bloc « Protections » : `Options -Indexes`, puis les règles qui refusent les fichiers cachés, les fichiers `config*`, la documentation (`.md`), les sauvegardes (`.bak`, `.old`, `.orig`, `.swp`, `~`), les `.sql` et `.log`. Le dossier `/.well-known/` (validation HTTPS) reste accessible.
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

1. **Catalogue serveur des prix** : bloquant pour toute commande réelle. Les prix, promotions, minimums et frais sont des décisions par défaut à confirmer (`reports/2026-11-19-catalogue-serveur-proposition.md`, « Reste à confirmer »).
2. **Source des disponibilités** : le menu lit d'abord l'API (`api/availability.php`), puis, seulement si elle ne répond pas, `assets/data/disponibilite.json`. Ce fichier ne sert que de secours (listes vides = tout disponible) : **ne pas l'utiliser pour gérer les ruptures**, c'est le rôle de l'espace commerçant. À vérifier sur le sous-domaine : une rupture saisie doit disparaître du menu.
3. **Service worker** : s'enregistre sur `/commercant/` ; cache à vérifier sur téléphone (voir 7.5).
4. **Son de l'alerte** : arrêt après 30 secondes, rétablissement à chaque nouvelle commande : à confirmer.
5. **Éléments non figés** (voir en tête) : à revalider avant publication.
6. **Décidé, à implémenter** : la moitié-moitié du composeur (à partir de Duo, comme le menu), après le commit. Elle n'est pas dans cette version.

**Tant que les points 1 et 2 ne sont pas tranchés et vérifiés, ne pas laisser de vrais clients commander sur la préproduction.** Utiliser des données de test uniquement.

## 9. Avant toute publication sur le domaine principal

- Remplacer `robots.txt` par la version publique du dépôt (`sub99/robots.txt`), qui autorise l'indexation des pages publiques.
- Retirer les lignes de préproduction du `.htaccess` (redirection HTTPS conservée, `X-Robots-Tag` retiré) ; le bloc « Protections » reste.
- Vérifier une dernière fois `api/` et supprimer tout fichier de test ou de diagnostic qui s'y trouverait.
- Rappel : la publication se fait sur accord explicite de l'utilisateur.
