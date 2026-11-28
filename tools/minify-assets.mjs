#!/usr/bin/env node
// Génère assets/js/*.min.js et assets/css/*.min.css à partir des fichiers sources (lecture seule) :
// le code source, commenté, reste la seule chose qu'on modifie à la main ; ces fichiers *.min.*
// sont un artefact de build, comme api/data/catalogue.json (voir tools/build-catalogue.mjs) —
// jamais modifiés à la main, régénérés par ce script.
//
// Pourquoi un fichier .min.* à côté plutôt qu'une minification à la volée sur Vercel : ce dépôt
// sert les fichiers statiques tels quels (pas de bundler, voir vercel.json), donc le fichier déployé
// EST le fichier du dépôt. Minifier en place écraserait les commentaires source pour de bon.
//
// Usage : node tools/minify-assets.mjs            → écrit les *.min.js / *.min.css
//         node tools/minify-assets.mjs --check     → vérifie qu'ils sont à jour (code 1 sinon)
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = process.argv.includes('--check');

// Uniquement les fichiers chargés par les pages du site (pas les scripts de test/outillage,
// pas subito-popup.js/.css : aucune page ne le charge actuellement — rien à gagner à le minifier ;
// pas assets/js/tirage/ : modules ES qui s'importent entre eux, régénérés séparément si besoin).
const JS_FILES = ['main', 'icons', 'cart', 'account', 'compte', 'commande', 'order-launch', 'commercant', 'disponibilite'];
// 'allergenes' ajouté le 28/11/2026 : il était chargé non minifié par menu.html,
// vegetarien.html et allergenes.html — seul fichier CSS du site dans ce cas.
const CSS_FILES = ['style', 'cart', 'commande', 'commercant', 'compte', 'disponibilite', 'order-launch', 'tirage', 'allergenes'];

async function minifyJs(name) {
  const src = path.join(ROOT, 'assets', 'js', `${name}.js`);
  const out = path.join(ROOT, 'assets', 'js', `${name}.min.js`);
  const code = readFileSync(src, 'utf8');
  const result = await esbuild.transform(code, { loader: 'js', minify: true, target: 'es2019' });
  return { out, content: result.code };
}

async function minifyCss(name) {
  const src = path.join(ROOT, 'assets', 'css', `${name}.css`);
  const out = path.join(ROOT, 'assets', 'css', `${name}.min.css`);
  const code = readFileSync(src, 'utf8');
  const result = await esbuild.transform(code, { loader: 'css', minify: true });
  return { out, content: result.code };
}

let changed = [];
for (const name of JS_FILES) {
  const { out, content } = await minifyJs(name);
  const before = existsSync(out) ? readFileSync(out, 'utf8') : null;
  if (before !== content) changed.push(out);
  if (!CHECK) writeFileSync(out, content);
}
for (const name of CSS_FILES) {
  const { out, content } = await minifyCss(name);
  const before = existsSync(out) ? readFileSync(out, 'utf8') : null;
  if (before !== content) changed.push(out);
  if (!CHECK) writeFileSync(out, content);
}

if (CHECK) {
  if (changed.length) {
    console.error('Fichiers minifiés à régénérer (node tools/minify-assets.mjs) :');
    changed.forEach((f) => console.error('  - ' + path.relative(ROOT, f)));
    process.exit(1);
  }
  console.log('Tous les fichiers .min. sont à jour.');
} else {
  console.log(`${JS_FILES.length + CSS_FILES.length} fichiers minifiés écrits.`);
}
