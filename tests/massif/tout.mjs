// Exécution groupée de toutes les batteries massives (tests/massif/NN-*.mjs), par le lanceur, avec résumé.
//   node tests/massif/tout.mjs [--parallele=3] [--timeout=480] [--seulement=01,04,12] [--sauf=13]
// Code de sortie : 0 si toutes les batteries réussissent, 1 sinon.
import { readdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ICI = path.dirname(fileURLToPath(import.meta.url));
const arg = (nom, defaut) => {
  const a = process.argv.find((x) => x.startsWith('--' + nom + '='));
  return a ? a.slice(nom.length + 3) : defaut;
};
const parallele = Number(arg('parallele', 3));
const delai = Number(arg('timeout', 480));
const seulement = arg('seulement', '').split(',').filter(Boolean);
const sauf = arg('sauf', '').split(',').filter(Boolean);

const scripts = readdirSync(ICI)
  .filter((f) => /^\d\d-.*\.mjs$/.test(f))
  .filter((f) => !seulement.length || seulement.includes(f.slice(0, 2)))
  .filter((f) => !sauf.includes(f.slice(0, 2)))
  .sort();

if (!scripts.length) { console.error('Aucune batterie trouvée.'); process.exit(2); }
console.log(`${scripts.length} batteries, ${parallele} en parallèle, délai ${delai} s chacune.\n`);

function lancer(fichier) {
  return new Promise((resolve) => {
    const debut = Date.now();
    const enfant = spawn(process.execPath, [path.join(ICI, 'lancer.mjs'), path.join('tests', 'massif', fichier), '--timeout=' + delai],
      { cwd: path.resolve(ICI, '..', '..'), stdio: ['ignore', 'pipe', 'pipe'] });
    let sortie = '';
    enfant.stdout.on('data', (d) => { sortie += d; });
    enfant.stderr.on('data', (d) => { sortie += d; });
    enfant.on('exit', (code) => {
      const passes = (sortie.match(/^\s*PASS\b/gm) || []).length;
      const fails = (sortie.match(/^\s*FAIL\b/gm) || []).length;
      resolve({ fichier, code: code ?? 1, passes, fails, duree: Math.round((Date.now() - debut) / 1000), sortie });
    });
  });
}

const resultats = [];
let suivant = 0;
async function ouvrier() {
  for (;;) {
    const i = suivant++;
    if (i >= scripts.length) return;
    const r = await lancer(scripts[i]);
    resultats.push(r);
    console.log(`${r.code === 0 ? 'OK  ' : 'ECHEC'}  ${r.fichier.padEnd(42)} ${String(r.passes).padStart(4)} PASS ${String(r.fails).padStart(3)} FAIL  ${String(r.duree).padStart(4)} s`);
    if (r.code !== 0) {
      const lignes = r.sortie.split('\n').filter((l) => /^\s*FAIL\b/.test(l)).slice(0, 8);
      for (const l of lignes) console.log('        ' + l.trim().slice(0, 220));
      if (!lignes.length) console.log('        ' + r.sortie.trim().split('\n').slice(-4).join('\n        ').slice(0, 600));
    }
  }
}
await Promise.all(Array.from({ length: Math.min(parallele, scripts.length) }, ouvrier));

const total = resultats.reduce((s, r) => ({ p: s.p + r.passes, f: s.f + r.fails }), { p: 0, f: 0 });
const echecs = resultats.filter((r) => r.code !== 0);
console.log(`\nBilan : ${resultats.length - echecs.length}/${resultats.length} batteries réussies · ${total.p} contrôles PASS · ${total.f} FAIL`);
process.exit(echecs.length ? 1 : 0);
