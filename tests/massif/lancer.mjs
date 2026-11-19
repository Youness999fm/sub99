// Lanceur des scripts de test massif : au plus 5 scripts en même temps sur la machine (mémoire limitée),
// un port libre attribué (SUBITO_TEST_PORT), délai maximal, sortie recopiée dans un fichier.
//   node tests/massif/lancer.mjs tests/massif/mon-test.mjs [--timeout=600]  [arguments du script…]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const MAX_SIMULTANES = 3; // 34 000 connexions en TIME_WAIT constatées avec 5 : la pile TCP locale sature
const DOSSIER = path.join(os.tmpdir(), 'subito-massif-scripts');
fs.mkdirSync(DOSSIER, { recursive: true });
const journaux = path.join(os.tmpdir(), 'subito-massif-logs');
fs.mkdirSync(journaux, { recursive: true });

const args = process.argv.slice(2);
const script = args.shift();
if (!script) { console.error('Usage : node tests/massif/lancer.mjs <script.mjs> [--timeout=secondes] [args…]'); process.exit(2); }
let delai = 600;
const restants = args.filter((a) => { const m = /^--timeout=(\d+)$/.exec(a); if (m) { delai = Number(m[1]); return false; } return true; });

const vivant = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

async function prendre() {
  for (;;) {
    for (let i = 0; i < MAX_SIMULTANES; i++) {
      const verrou = path.join(DOSSIER, 'slot-' + i);
      try {
        fs.mkdirSync(verrou);
        fs.writeFileSync(path.join(verrou, 'pid'), String(process.pid));
        return { i, verrou };
      } catch {
        try { if (!vivant(Number(fs.readFileSync(path.join(verrou, 'pid'), 'utf8')))) fs.rmSync(verrou, { recursive: true, force: true }); } catch { /* en cours */ }
      }
    }
    await attendre(800);
  }
}

const slot = await prendre();
// Port neuf à chaque lancement : réutiliser un port rempli de connexions TIME_WAIT donne EADDRINUSE (Windows).
const port = 20000 + Math.floor(Math.random() * 20000) * 1;
const nom = path.basename(script).replace(/\.mjs$/, '');
const fichier = path.join(journaux, `${nom}-${new Date().toISOString().replace(/[:.]/g, '-')}.log`);
const sortie = fs.createWriteStream(fichier);
console.log(`[lanceur] ${script} · port ${port} · journal ${fichier}`);

const enfant = spawn(process.execPath, [script, ...restants], {
  env: { ...process.env, SUBITO_TEST_PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe']
});
enfant.stdout.on('data', (d) => { process.stdout.write(d); sortie.write(d); });
enfant.stderr.on('data', (d) => { process.stderr.write(d); sortie.write(d); });
const minuteur = setTimeout(() => { console.error(`[lanceur] délai de ${delai} s dépassé : arrêt du script`); enfant.kill(); }, delai * 1000);
const liberer = () => { try { fs.rmSync(slot.verrou, { recursive: true, force: true }); } catch { /* ignoré */ } };
process.on('exit', liberer);
enfant.on('exit', (code) => { clearTimeout(minuteur); sortie.end(); liberer(); process.exit(code ?? 1); });
