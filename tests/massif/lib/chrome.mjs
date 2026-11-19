// Navigateur Chrome headless BORNÉ EN MÉMOIRE : au plus 3 navigateurs en même temps sur la machine, toutes sessions confondues
// (verrous dans le dossier temporaire), 8 onglets au plus par navigateur, drapeaux « petite empreinte ».
// Pourquoi : la machine de test a peu de mémoire libre ; plusieurs agents qui lancent Chrome sans limite la feraient plier.
//
//   await avecNavigateur(async (nav) => {
//     const page = await nav.ouvrirPage(site.base + '/commande.html?id=1', { cookies: client });   // cookies d'un ClientIP
//     ... await page.evaluate('document.title') ... await page.waitFor("document.querySelector('.x')", 8000)
//   });
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { findChrome, Cdp, sleep } from '../../e2e/lib/cdp.mjs';

const MAX_NAVIGATEURS = 3;
const DOSSIER = path.join(os.tmpdir(), 'subito-massif-chrome');
fs.mkdirSync(DOSSIER, { recursive: true });

function vivant(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

async function prendreEmplacement(attenteMax = 20 * 60 * 1000) {
  const debut = Date.now();
  for (;;) {
    for (let i = 0; i < MAX_NAVIGATEURS; i++) {
      const verrou = path.join(DOSSIER, 'slot-' + i);
      try {
        fs.mkdirSync(verrou);
        fs.writeFileSync(path.join(verrou, 'pid'), String(process.pid));
        return { i, verrou };
      } catch {
        try {
          const pid = Number(fs.readFileSync(path.join(verrou, 'pid'), 'utf8'));
          if (!vivant(pid)) fs.rmSync(verrou, { recursive: true, force: true });
        } catch { /* verrou en cours de création ou de suppression */ }
      }
    }
    if (Date.now() - debut > attenteMax) throw new Error('Aucun emplacement de navigateur libre après 20 minutes.');
    await sleep(700);
  }
}

/** Copie les cookies d'un client HTTP (boîte à cookies du harnais) dans la page. */
async function injecterCookies(cdp, client, hote) {
  for (const [nom, valeur] of client.cookies) {
    await cdp.send('Network.setCookie', {
      name: nom, value: valeur, domain: hote, path: '/api/', httpOnly: true,
      sameSite: nom.includes('owner') ? 'Strict' : 'Lax', expires: Math.floor(Date.now() / 1000) + 86400
    });
  }
}

export async function avecNavigateur(fn, { pagesMax = 8, largeur = 390, hauteur = 844, mobile = true } = {}) {
  const slot = await prendreEmplacement();
  const port = 9450 + slot.i + (process.pid % 40) * 3;
  const profil = path.join(DOSSIER, `profil-${process.pid}-${slot.i}`);
  fs.mkdirSync(profil, { recursive: true });
  const exe = findChrome();
  if (!exe) { fs.rmSync(slot.verrou, { recursive: true, force: true }); throw new Error('Chrome introuvable (CHROME_PATH).'); }
  const proc = spawn(exe, [
    '--headless=new', '--remote-debugging-port=' + port, '--user-data-dir=' + profil,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-sync', '--disable-gpu',
    '--disable-dev-shm-usage', '--mute-audio', '--disable-background-networking', '--disable-component-update',
    '--disable-features=Translate,OptimizationHints,MediaRouter', '--js-flags=--max-old-space-size=96',
    '--window-size=' + largeur + ',' + hauteur
  ], { stdio: 'ignore' });
  const pages = new Set();
  const nettoyer = () => {
    for (const p of pages) { try { p.cdp.close(); } catch { /* déjà fermé */ } }
    try { proc.kill(); } catch { /* déjà arrêté */ }
    try { fs.rmSync(slot.verrou, { recursive: true, force: true }); } catch { /* ignoré */ }
    try { fs.rmSync(profil, { recursive: true, force: true }); } catch { /* ignoré */ }
  };
  process.once('exit', nettoyer);
  try {
    let version = null;
    for (let i = 0; i < 150 && !version; i++) {
      try { const res = await fetch(`http://127.0.0.1:${port}/json/version`); if (res.ok) version = await res.json(); } catch { /* pas prêt */ }
      if (!version) await sleep(150);
    }
    if (!version) throw new Error('Chrome ne répond pas sur le port ' + port);

    const nav = {
      version: version.Browser,
      /** Ouvre un onglet. options : cookies (ClientIP), largeur, hauteur, mobile. Renvoie { cdp, erreurs, evaluate, waitFor, navigate, screenshot, fermer }. */
      async ouvrirPage(url = 'about:blank', options = {}) {
        if (pages.size >= pagesMax) throw new Error(`Limite de ${pagesMax} onglets atteinte : fermer des pages avant d'en ouvrir.`);
        const res = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' });
        const cible = await res.json();
        const cdp = new Cdp(cible.webSocketDebuggerUrl);
        await cdp.open();
        await cdp.send('Page.enable');
        await cdp.send('Runtime.enable');
        await cdp.send('Network.enable');
        // Hermétique : polices et carte Google non chargées.
        await cdp.send('Network.setBlockedURLs', { urls: ['*fonts.googleapis.com*', '*fonts.gstatic.com*', '*www.google.com*', '*maps.googleapis.com*'] });
        await cdp.setViewport(options.largeur || largeur, options.hauteur || hauteur, options.mobile ?? mobile);
        const erreurs = [];
        cdp.on((msg) => {
          if (msg.method === 'Runtime.exceptionThrown') {
            const d = msg.params.exceptionDetails;
            erreurs.push('exception: ' + (d.exception ? d.exception.description : d.text));
          }
          if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
            erreurs.push('console.error: ' + msg.params.args.map((a) => a.value || a.description || '').join(' '));
          }
        });
        if (options.cookies) await injecterCookies(cdp, options.cookies, 'localhost');
        const page = {
          cdp, erreurs,
          evaluate: (e) => cdp.evaluate(e),
          waitFor: (e, t, s) => cdp.waitFor(e, t, s),
          navigate: (u, ms) => cdp.navigate(u, ms),
          screenshot: (f) => cdp.screenshot(f),
          send: (m, p) => cdp.send(m, p),
          async fermer() {
            pages.delete(page);
            cdp.close();
            try { await fetch(`http://127.0.0.1:${port}/json/close/${cible.id}`); } catch { /* déjà fermé */ }
          }
        };
        pages.add(page);
        if (url !== 'about:blank') await cdp.navigate(url);
        return page;
      }
    };
    return await fn(nav);
  } finally {
    nettoyer();
    process.removeListener('exit', nettoyer);
  }
}
