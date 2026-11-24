#!/usr/bin/env node
// Génère assets/img/photos/*.webp à partir des .jpg sources (lecture seule) : même principe que
// tools/minify-assets.mjs — un artefact de build régénéré, jamais modifié à la main. Les .jpg
// restent dans le dépôt (source de la conversion) mais ne sont plus référencés par les pages :
// WebP est géré par tous les navigateurs ciblés par ce site (décision du 24/11/2026, voir
// reports/2026-11-24-audit-perf-optimisations.md pour le détail des gains mesurés).
//
// Usage : node tools/convert-images.mjs            → écrit les .webp
//         node tools/convert-images.mjs --check     → vérifie qu'ils sont à jour (code 1 sinon)
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PHOTOS_DIR = path.join(ROOT, 'assets', 'img', 'photos');
const CHECK = process.argv.includes('--check');
const QUALITY = 80;

const jpgFiles = readdirSync(PHOTOS_DIR).filter((f) => /\.jpe?g$/i.test(f));
// Logo (header/pied de page/intro) : affiché en entier (pas de recadrage), même conversion WebP
// que les photos — ajouté le 24/11/2026, voir reports/2026-11-24-audit-perf-optimisations.md.
const EXTRA_FILES = [path.join(ROOT, 'assets', 'img', 'logo.jpg')];

let changed = [];
for (const file of jpgFiles) {
  const src = path.join(PHOTOS_DIR, file);
  const out = path.join(PHOTOS_DIR, file.replace(/\.jpe?g$/i, '.webp'));
  const buffer = await sharp(src).webp({ quality: QUALITY }).toBuffer();
  const before = existsSync(out) ? readFileSync(out) : null;
  if (!before || !before.equals(buffer)) changed.push(out);
  if (!CHECK) writeFileSync(out, buffer);
}
for (const src of EXTRA_FILES) {
  const out = src.replace(/\.jpe?g$/i, '.webp');
  const buffer = await sharp(src).webp({ quality: QUALITY }).toBuffer();
  const before = existsSync(out) ? readFileSync(out) : null;
  if (!before || !before.equals(buffer)) changed.push(out);
  if (!CHECK) writeFileSync(out, buffer);
}

const total = jpgFiles.length + EXTRA_FILES.length;
if (CHECK) {
  if (changed.length) {
    console.error('Fichiers .webp à régénérer (node tools/convert-images.mjs) :');
    changed.forEach((f) => console.error('  - ' + path.relative(ROOT, f)));
    process.exit(1);
  }
  console.log('Tous les .webp sont à jour.');
} else {
  console.log(`${total} fichiers .webp écrits.`);
}
