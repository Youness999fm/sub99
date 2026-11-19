// Contrôle Lighthouse (performance, accessibilité, bonnes pratiques, référencement) en local.
// Les scores mesurent le site servi depuis localhost : ils ne préjugent pas des performances chez l'hébergeur.
//
// Usage : LIGHTHOUSE_DIR=<dossier contenant node_modules/lighthouse> node tests/accessibilite/lighthouse.mjs
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { launchChrome, sleep } from '../e2e/lib/cdp.mjs';

const BASE = process.env.BASE_URL || 'http://localhost:8090';
const LH_DIR = process.env.LIGHTHOUSE_DIR;
const OUT_DIR = process.env.OUT_DIR || 'C:/Users/youne/AppData/Local/Temp/claude/d2849a14368d2415/08c4bdcd-b229-432e-a6eb-0a56026f18ee/scratchpad/e2e';
// Noms sans barre initiale : Git Bash transforme « /page » en chemin Windows dans les variables d'environnement.
const PAGES = (process.env.PAGES || 'index.html,menu.html,commande.html').split(',').map((p) => '/' + p.trim().replace(/^\/+/, ''));

if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/.test(BASE)) {
  console.error('Refus : ce test ne s\'exécute que sur localhost.');
  process.exit(2);
}
if (!LH_DIR || !fs.existsSync(LH_DIR + '/node_modules/lighthouse/package.json')) {
  console.error('Définir LIGHTHOUSE_DIR vers un dossier contenant node_modules/lighthouse.');
  process.exit(2);
}
fs.mkdirSync(OUT_DIR, { recursive: true });
const lhPackage = JSON.parse(fs.readFileSync(LH_DIR + '/node_modules/lighthouse/package.json', 'utf8'));
const mod = await import(pathToFileURL(LH_DIR + '/node_modules/lighthouse/' + lhPackage.main).href);
const lighthouse = mod.default || mod;

const chrome = await launchChrome({ port: 9337, profileDir: OUT_DIR + '/chrome-profile-lh', headless: true });
const summary = [];
try {
  for (const path of PAGES) {
    const url = BASE + path;
    const run = await lighthouse(url, {
      port: chrome.port,
      output: 'json',
      logLevel: 'error',
      onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo'],
    });
    const lhr = run.lhr;
    const scores = {};
    for (const [id, cat] of Object.entries(lhr.categories)) scores[id] = Math.round(cat.score * 100);
    const audits = lhr.audits;
    const metrics = {
      LCP_ms: Math.round(audits['largest-contentful-paint'].numericValue),
      CLS: Number(audits['cumulative-layout-shift'].numericValue.toFixed(3)),
      TBT_ms: Math.round(audits['total-blocking-time'].numericValue),
      FCP_ms: Math.round(audits['first-contentful-paint'].numericValue),
    };
    const failed = Object.values(audits).filter((a) => a.score !== null && a.score < 1 && a.scoreDisplayMode !== 'notApplicable' && a.scoreDisplayMode !== 'informative').map((a) => a.id);
    summary.push({ page: path, scores, metrics, auditsEnEchec: failed });
    console.log(path.padEnd(16) + ' perf=' + scores.performance + ' accessibilité=' + scores.accessibility + ' bonnes-pratiques=' + scores['best-practices'] + ' seo=' + scores.seo + ' · LCP=' + metrics.LCP_ms + 'ms CLS=' + metrics.CLS + ' TBT=' + metrics.TBT_ms + 'ms');
    fs.writeFileSync(OUT_DIR + '/lighthouse-' + path.replace(/[^a-z0-9]/gi, '_') + '.json', JSON.stringify(lhr, null, 2));
    await sleep(500);
  }
} finally {
  chrome.proc.kill();
}
fs.writeFileSync(OUT_DIR + '/lighthouse-resume.json', JSON.stringify({ lighthouse: lhPackage.version, reglages: 'émulation par défaut de Lighthouse (mobile, réseau et CPU bridés), site servi en local', pages: summary }, null, 2));
console.log('Lighthouse ' + lhPackage.version + ' · détail : ' + OUT_DIR + '/lighthouse-resume.json');
