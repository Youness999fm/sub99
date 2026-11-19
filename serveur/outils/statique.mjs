// Service de fichiers statiques du site pour les outils locaux (dev.mjs, tests de navigateur). Jamais déployé.
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml'
};
const INTERDITS = /^\/(\.|node_modules|serveur|tests|reports|tools|supabase|api\/(lib|tools)|package)/;

/** Sert le fichier demandé sous la racine du dépôt (404 sinon). Les dossiers de code et de test sont interdits. */
export async function servirStatique(req, res) {
  const url = new URL(req.url || '/', 'http://localhost');
  let chemin;
  try { chemin = decodeURIComponent(url.pathname); } catch { res.statusCode = 400; res.end('Requête invalide'); return; }
  if (INTERDITS.test(chemin) || chemin.includes('..') || chemin.includes('\0')) { res.statusCode = 404; res.end('Introuvable'); return; }
  let fichier = path.join(RACINE, chemin);
  try {
    if ((await stat(fichier)).isDirectory()) fichier = path.join(fichier, 'index.html');
    const donnees = await readFile(fichier);
    res.setHeader('Content-Type', TYPES[path.extname(fichier).toLowerCase()] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-store');
    res.end(donnees);
  } catch {
    res.statusCode = 404;
    res.end('Introuvable');
  }
}
