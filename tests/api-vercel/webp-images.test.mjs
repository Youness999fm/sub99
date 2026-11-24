// Vérifie que assets/img/photos/*.webp (générés par tools/convert-images.mjs, décision du
// 24/11/2026 — voir reports/2026-11-24-audit-perf-optimisations.md) sont à jour par rapport
// aux .jpg sources. Même principe que minified-assets.test.mjs / catalogue.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('fichiers .webp à jour (node tools/convert-images.mjs)', () => {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'convert-images.mjs'), '--check'], { encoding: 'utf8', cwd: ROOT });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});
