# Construit la copie de preproduction a partir d'une version figee du depot. Hors du depot :
# rien n'est televerse, le depot n'est jamais modifie.
#
# Usage :
#   powershell -ExecutionPolicy Bypass -File tools\construire-preproduction.ps1
#   powershell -ExecutionPolicy Bypass -File <copie figee>\tools\construire-preproduction.ps1 -Source <copie figee> -Sortie <dossier de sortie>
#
# Produit dans le dossier de sortie (par defaut : dossier parent du depot) :
#   preproduction-paquet\                  dossier du site (sans concours, sans subito-popup, sans documentation .md)
#   preproduction-subito-2026-11-19.zip    archive, chemins avec barres obliques
#   preproduction-MANIFESTE-SHA256.txt     empreintes : UTF-8 sans BOM, fins de ligne LF (sha256sum -c)
param(
    [string]$Source = '',
    [string]$Sortie = ''
)
$ErrorActionPreference = 'Stop'
$depot = if ($Source -ne '') { (Resolve-Path -LiteralPath $Source).Path } else { Split-Path -Parent $PSScriptRoot }
$sortie = if ($Sortie -ne '') { (Resolve-Path -LiteralPath $Sortie).Path } else { Split-Path -Parent $depot }
$pkg = Join-Path $sortie 'preproduction-paquet'
$zip = Join-Path $sortie 'preproduction-subito-2026-11-19.zip'
$manifeste = Join-Path $sortie 'preproduction-MANIFESTE-SHA256.txt'

# Decisions du responsable (19/11/2026) : ces elements restent dans le depot, mais hors du paquet.
$pagesConcours = @('concours.html', 'grand-tirage.html')
$horsPaquet = @('assets\js\tirage', 'assets\js\winners-data.js')

if (Test-Path -LiteralPath $pkg) { Remove-Item -LiteralPath $pkg -Recurse -Force }
New-Item -ItemType Directory -Path $pkg | Out-Null

# 1. Fichiers racine du site (sans les pages du concours)
Get-ChildItem -LiteralPath $depot -File | Where-Object { ($_.Extension -eq '.html' -and $pagesConcours -notcontains $_.Name) -or $_.Name -in @('.htaccess', 'favicon.ico', 'manifest.json', 'robots.txt', 'sitemap.xml') } | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $pkg }

# 2. Dossiers du site. subito-popup/ reste dans le depot, hors du paquet.
foreach ($d in 'assets', 'commercant', 'api') { Copy-Item -LiteralPath (Join-Path $depot $d) -Destination $pkg -Recurse }
foreach ($h in $horsPaquet) { $c = Join-Path $pkg $h; if (Test-Path -LiteralPath $c) { Remove-Item -LiteralPath $c -Recurse -Force } }

# 3. Exclusions : outils de verification, vrai fichier de configuration, documentation (tous les .md, README compris)
foreach ($f in 'api\_phpinfo.php', 'api\_dbtest.php', 'api\config.php') { $c = Join-Path $pkg $f; if (Test-Path -LiteralPath $c) { Remove-Item -LiteralPath $c -Force } }
Get-ChildItem -LiteralPath $pkg -Recurse -File -Filter '*.md' | Remove-Item -Force

# 3 bis. Plan du site : la page du concours n'est plus annoncee dans le paquet
$plan = Join-Path $pkg 'sitemap.xml'
if (Test-Path -LiteralPath $plan) {
    $xml = [System.IO.File]::ReadAllText($plan)
    $sansConcours = [regex]::Replace($xml, '\s*<url>\s*<loc>[^<]*/concours\.html</loc>.*?</url>', '', [System.Text.RegularExpressions.RegexOptions]::Singleline)
    if ($sansConcours -match 'concours\.html') { throw 'sitemap.xml : une entree concours.html subsiste' }
    [System.IO.File]::WriteAllText($plan, $sansConcours, (New-Object System.Text.UTF8Encoding $false))
}

# 3 ter. Garde-fous : rien d'interdit ne doit etre dans le paquet
foreach ($interdit in 'subito-popup', 'reports', 'tests', 'tools', '.claude', '.git') {
    if (Test-Path -LiteralPath (Join-Path $pkg $interdit)) { throw "Dossier interdit dans le paquet : $interdit" }
}
foreach ($interdit in ($pagesConcours + $horsPaquet + @('api\README.md'))) {
    if (Test-Path -LiteralPath (Join-Path $pkg $interdit)) { throw "Element interdit dans le paquet : $interdit" }
}

# 4. Remplacements de preproduction (copie seulement, jamais dans le depot)
Copy-Item -LiteralPath (Join-Path $depot 'tools\preproduction\robots.txt') -Destination (Join-Path $pkg 'robots.txt') -Force
Copy-Item -LiteralPath (Join-Path $depot 'tools\preproduction\htaccess.txt') -Destination (Join-Path $pkg '.htaccess') -Force

# 5. Archive avec barres obliques (compatible Linux : sinon les chemins peuvent etre decompresses a plat)
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
if (Test-Path -LiteralPath $zip) { Remove-Item -LiteralPath $zip -Force }
$fichiers = @(Get-ChildItem -LiteralPath $pkg -Recurse -File | Sort-Object FullName)
$archive = [System.IO.Compression.ZipFile]::Open($zip, [System.IO.Compression.ZipArchiveMode]::Create)
try {
    foreach ($f in $fichiers) {
        $nom = $f.FullName.Substring($pkg.Length + 1).Replace('\', '/')
        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $f.FullName, $nom, [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
    }
} finally { $archive.Dispose() }

# 6. Manifeste SHA-256 : une ligne par fichier, « empreinte, deux espaces, chemin » (format sha256sum).
#    UTF-8 sans BOM, fins de ligne LF, chemins avec barres obliques, relatifs a la racine du paquet.
$lignes = @(foreach ($f in $fichiers) { (Get-FileHash -LiteralPath $f.FullName -Algorithm SHA256).Hash.ToLower() + '  ' + $f.FullName.Substring($pkg.Length + 1).Replace('\', '/') })
$texte = (($lignes -join "`n") + "`n")
[System.IO.File]::WriteAllText($manifeste, $texte, (New-Object System.Text.UTF8Encoding $false))

# 7. Controles de l'archive et du manifeste
$octets = [System.IO.File]::ReadAllBytes($manifeste)
$avecBom = ($octets.Length -ge 3 -and $octets[0] -eq 0xEF -and $octets[1] -eq 0xBB -and $octets[2] -eq 0xBF)
$avecCr = ($octets -contains 13)
if ($avecBom -or $avecCr) { throw "Manifeste non conforme : BOM = $avecBom, retours chariot = $avecCr" }
$entrees = [System.IO.Compression.ZipFile]::OpenRead($zip)
try { $total = $entrees.Entries.Count; $avecAntislash = @($entrees.Entries | Where-Object { $_.FullName -match '\\' }).Count } finally { $entrees.Dispose() }
"Paquet : $pkg ($($fichiers.Count) fichiers)"
"Archive : $zip (entrees : $total ; entrees avec antislash : $avecAntislash)"
"SHA256 de l'archive : " + (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLower()
"Manifeste : $manifeste (UTF-8 sans BOM, fins de ligne LF, $($lignes.Count) lignes)"
