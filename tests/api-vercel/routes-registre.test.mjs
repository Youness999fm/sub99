// Le registre statique serveur/routes.js (requis pour que Vercel inclue chaque route et ses paquets) doit lister
// exactement les fichiers de serveur/routes/, et la configuration Vercel doit rester cohérente avec le code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { ROUTES } from '../../serveur/routes.js';

test('chaque fichier de serveur/routes/ est enregistré, et rien d\'autre', () => {
  const fichiers = readdirSync(new URL('../../serveur/routes/', import.meta.url)).filter((f) => f.endsWith('.js')).map((f) => f.slice(0, -3)).sort();
  assert.deepEqual(Object.keys(ROUTES).sort(), fichiers);
  for (const [nom, route] of Object.entries(ROUTES)) assert.equal(typeof route, 'function', nom);
});

test('toutes les routes utilisées par le navigateur existent', () => {
  const noms = new Set();
  for (const f of ['assets/js/account.js', 'assets/js/cart.js', 'assets/js/commande.js', 'assets/js/commercant.js', 'assets/js/compte.js', 'assets/js/disponibilite.js', 'assets/js/main.js']) {
    const texte = readFileSync(new URL('../../' + f, import.meta.url), 'utf8');
    for (const m of texte.matchAll(/([a-z_]+)\.php/g)) noms.add(m[1]);
  }
  for (const nom of noms) assert.ok(Object.hasOwn(ROUTES, nom), 'route appelée par le site mais absente : ' + nom);
});

test('vercel.json : réécriture .php, une seule fonction, fichiers inclus, installation sans dépendances de test', () => {
  const v = JSON.parse(readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8'));
  assert.ok(v.rewrites.some((r) => r.source === '/api/(.*)\\.php' && r.destination === '/api/$1'));
  assert.equal(v.installCommand, 'npm ci --omit=dev');
  const [motif, config] = Object.entries(v.functions)[0];
  assert.equal(motif, 'api/**/*.js');
  assert.match(config.includeFiles, /serveur/);
  assert.match(config.includeFiles, /api\/data/);
});

test('package.json : Node 22, dépendances d\'exécution minimales (pas de pilote de test en production)', () => {
  const p = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  assert.equal(p.type, 'module');
  assert.deepEqual(Object.keys(p.dependencies).sort(), ['bcryptjs', 'pg']);
  assert.ok(p.devDependencies['@electric-sql/pglite']);
  assert.equal(p.engines.node, '22.x');
});
