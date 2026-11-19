// Lanceur de serveur de test pour l'API PHP et l'espace commerçant.
// Crée une base SQLite neuve dans un dossier temporaire HORS du dépôt, écrit une configuration
// de test (SUBITO_CONFIG), installe le schéma, crée le compte propriétaire de test, puis lance
// le serveur PHP intégré sur 127.0.0.1. Aucune donnée réelle, aucun identifiant de production.
//
// Variables d'environnement facultatives :
//   PHP_BIN   chemin de php.exe (défaut : PHP portable de la session de test)
//   PHP_INI   chemin du php.ini correspondant (SQLite activé)
//   SUBITO_TEST_PORT (ou PORT)  port du serveur de test (défaut 18091 : Windows réserve 8090 à 8092 sur cette machine)
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const RACINE = path.resolve(HERE, '..', '..');
const SCRATCH_PAR_DEFAUT = 'C:/Users/youne/AppData/Local/Temp/claude/d2849a14368d2415/d4a5721b-9890-4457-ba4a-e49920bf2706/scratchpad';
export const PHP_BIN = process.env.PHP_BIN || path.join(SCRATCH_PAR_DEFAUT, 'php', 'php.exe');
export const PHP_INI = process.env.PHP_INI || path.join(SCRATCH_PAR_DEFAUT, 'php', 'php.ini');
export const PORT = Number(process.env.SUBITO_TEST_PORT || process.env.PORT || 18091);
export const BASE = `http://127.0.0.1:${PORT}`;
// Mot de passe de test généré à chaque exécution (jamais écrit dans le code). SUBITO_TEST_OWNER_PASSWORD permet de le fixer.
export function genererMotDePasse() {
  const octets = globalThis.crypto.getRandomValues(new Uint8Array(18));
  return Buffer.from(octets).toString('base64url') + 'Aa1!';
}
export const PROPRIETAIRE = {
  email: 'proprietaire-test@example.test',
  password: process.env.SUBITO_TEST_OWNER_PASSWORD || genererMotDePasse(),
};

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Écrit la configuration de test (PHP, retour de tableau) et renvoie son chemin.
function ecrireConfig(dossier, dbFile) {
  const config = `<?php
return [
    'db' => [
        'dsn' => 'sqlite:${dbFile.replace(/\\/g, '/')}',
        'user' => null,
        'password' => null,
    ],
    'app_origins' => ['http://127.0.0.1:${PORT}', 'http://localhost:${PORT}'],
    'cookie_secure' => false,
    'timezone' => 'Europe/Paris',
];
`;
  const chemin = path.join(dossier, 'config-test.php');
  fs.writeFileSync(chemin, config, 'utf8');
  return chemin;
}

function phpEnv(configFile) {
  return { ...process.env, SUBITO_CONFIG: configFile };
}

function lancerOutil(script, configFile, entree = '') {
  const res = spawnSync(PHP_BIN, ['-c', PHP_INI, path.join(RACINE, 'api', 'tools', script)], {
    input: entree,
    env: phpEnv(configFile),
    encoding: 'utf8',
    timeout: 60000,
  });
  return { code: res.status, sortie: (res.stdout || '') + (res.stderr || '') };
}

// Crée un environnement de test complet et lance le serveur. Retourne { proc, dossier, dbFile, stop() }.
export async function demarrerServeurTest({ nom = 'test' } = {}) {
  // Refuse de réutiliser un serveur déjà présent sur le port : il garderait une base et des compteurs anciens
  // (limite d'inscriptions déjà consommée, par exemple).
  const occupe = await fetch(`${BASE}/api/availability.php`).then(() => true, () => false);
  if (occupe) {
    throw new Error(`Le port ${PORT} répond déjà : arrête le serveur existant ou choisis un autre port (variable PORT).`);
  }
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), `subito-${nom}-`));
  const dbFile = path.join(dossier, 'test.sqlite');
  const configFile = ecrireConfig(dossier, dbFile);

  const install = lancerOutil(path.join('install.php'), configFile);
  if (install.code !== 0) throw new Error('Installation de test échouée : ' + install.sortie);

  const owner = lancerOutil('create_owner.php', configFile, `${PROPRIETAIRE.email}\n${PROPRIETAIRE.password}\n`);
  if (owner.code !== 0) throw new Error('Création du propriétaire de test échouée : ' + owner.sortie);

  const proc = spawn(PHP_BIN, ['-c', PHP_INI, '-S', `127.0.0.1:${PORT}`, '-t', RACINE], {
    env: phpEnv(configFile),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let journal = '';
  proc.stdout.on('data', (d) => { journal += d.toString(); });
  proc.stderr.on('data', (d) => { journal += d.toString(); });

  let pret = false;
  for (let i = 0; i < 100 && !pret; i += 1) {
    try {
      const res = await fetch(`${BASE}/api/availability.php`);
      pret = res.ok;
    } catch (error) {
      // Le serveur n'écoute pas encore.
    }
    if (!pret) await sleep(150);
  }
  if (!pret) {
    proc.kill();
    throw new Error('Serveur de test non prêt. Journal : ' + journal.slice(-2000));
  }

  return {
    proc,
    dossier,
    dbFile,
    journal: () => journal,
    stop() {
      try { proc.kill(); } catch (error) { /* déjà arrêté */ }
    },
  };
}

// Extrait la valeur d'un cookie depuis les en-têtes Set-Cookie d'une réponse fetch.
export function cookieDe(res, nom) {
  const entetes = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [res.headers.get('set-cookie') || ''];
  for (const entete of entetes) {
    const m = entete.match(new RegExp('(?:^|[\\s,])' + nom + '=([^;]+)'));
    if (m) return m[1];
  }
  return null;
}

// Appel JSON vers l'API de test, avec cookie facultatif. Retourne { status, data, texte, res }.
export async function appel(route, { methode = 'GET', corps, cookie } = {}) {
  const entetes = {};
  if (corps !== undefined) entetes['Content-Type'] = 'application/json';
  if (cookie) entetes.Cookie = cookie;
  const res = await fetch(`${BASE}/api/${route}`, {
    method: methode,
    headers: entetes,
    body: corps === undefined ? undefined : JSON.stringify(corps),
    redirect: 'manual',
  });
  const texte = await res.text();
  let data = null;
  try { data = JSON.parse(texte); } catch (error) { data = null; }
  return { status: res.status, data, texte, res };
}
