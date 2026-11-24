// Vérifie que assets/*/.min.* (générés par tools/minify-assets.mjs, décision du 24/11/2026 —
// voir reports/2026-11-24-audit-perf-optimisations.md) sont à jour par rapport à leur source.
// Si ce test échoue : quelqu'un a modifié un .js/.css source sans relancer
// `node tools/minify-assets.mjs` avant de committer — même principe que catalogue.test.mjs
// pour tools/build-catalogue.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('fichiers .min.js / .min.css à jour (node tools/minify-assets.mjs)', () => {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'minify-assets.mjs'), '--check'], { encoding: 'utf8', cwd: ROOT });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});
