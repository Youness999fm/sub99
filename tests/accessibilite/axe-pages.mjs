// Contrôle d'accessibilité automatique (axe-core) des pages publiques, en local.
// Ce test ne prouve PAS la conformité WCAG : il relève les défauts détectables automatiquement.
// Une partie des critères (lecture à l'oreille, clavier réel, sens des libellés) demande un test humain.
//
// Usage :  AXE_PATH=<chemin>/node_modules/axe-core/axe.min.js node tests/accessibilite/axe-pages.mjs
// Prérequis : serveur local sub99 sur http://localhost:8090 ; Chrome ou Edge ; axe-core (npm, version 4.14.1 utilisée).
import fs from 'node:fs';
import { launchChrome, newPage, sleep } from '../e2e/lib/cdp.mjs';

const BASE = process.env.BASE_URL || 'http://localhost:8090';
const AXE_PATH = process.env.AXE_PATH;
const OUT_DIR = process.env.OUT_DIR || 'C:/Users/youne/AppData/Local/Temp/claude/d2849a14368d2415/08c4bdcd-b229-432e-a6eb-0a56026f18ee/scratchpad/e2e';
const PAGES = ['/index.html', '/menu.html', '/vegetarien.html', '/composer.html', '/supplements.html', '/avis.html', '/faq.html', '/concours.html', '/grand-tirage.html', '/reseaux.html', '/mentions-legales.html', '/404.html', '/commande.html', '/compte.html'];
const MOBILE_PAGES = ['/index.html', '/menu.html', '/compte.html'];
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/.test(BASE)) {
  console.error('Refus : ce test ne s\'exécute que sur localhost.');
  process.exit(2);
}
if (!AXE_PATH || !fs.existsSync(AXE_PATH)) {
  console.error('Définir AXE_PATH vers axe.min.js (npm install axe-core@4.14.1).');
  process.exit(2);
}
fs.mkdirSync(OUT_DIR, { recursive: true });
const axeSource = fs.readFileSync(AXE_PATH, 'utf8');

async function auditPage(page, path, label) {
  await page.navigate(BASE + path + '?a11y=1');
  await sleep(1200);
  await page.evaluate(axeSource + ';true');
  const result = await page.evaluate(`axe.run(document, { runOnly: { type: 'tag', values: ${JSON.stringify(TAGS)} } }).then(function (r) {
    return { violations: r.violations.map(function (v) { return { id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length, sample: v.nodes.slice(0, 3).map(function (n) { return { target: n.target.join(' '), html: n.html.slice(0, 160), summary: (n.failureSummary || '').slice(0, 240), data: n.any && n.any[0] ? n.any[0].data : null }; }) }; }), passes: r.passes.length, incomplete: r.incomplete.length };
  });`);
  return { page: path, mode: label, ...result };
}

const chrome = await launchChrome({ port: 9336, profileDir: OUT_DIR + '/chrome-profile-axe', width: 1280, height: 900 });
const page = await newPage(chrome.port, 'about:blank');
const all = [];
try {
  for (const path of PAGES) {
    const r = await auditPage(page, path, 'bureau');
    all.push(r);
    const serious = r.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious').length;
    console.log(path.padEnd(22) + ' bureau · violations=' + r.violations.length + ' (critiques/graves=' + serious + ') · réussis=' + r.passes);
  }
  await page.setViewport(375, 812, true, 1);
  for (const path of MOBILE_PAGES) {
    const r = await auditPage(page, path, 'téléphone');
    all.push(r);
    const serious = r.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious').length;
    console.log(path.padEnd(22) + ' téléphone · violations=' + r.violations.length + ' (critiques/graves=' + serious + ')');
  }
} finally {
  page.close();
  chrome.proc.kill();
}
fs.writeFileSync(OUT_DIR + '/axe-resultats.json', JSON.stringify({ axe: '4.14.1', tags: TAGS, date: new Date().toISOString(), pages: all }, null, 2));
console.log('Détail : ' + OUT_DIR + '/axe-resultats.json');
