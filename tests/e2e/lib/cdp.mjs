// Pilotage d'un Chrome (ou Edge) installé, via le protocole DevTools.
// Aucune dépendance npm : Node 22+ fournit WebSocket et fetch.
// Ne sert qu'en local (serveur sub99 sur http://localhost:8090). Ne visite jamais le site public.
import { spawn } from 'node:child_process';
import fs from 'node:fs';

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ].filter(Boolean);
  return candidates.find((p) => fs.existsSync(p)) || null;
}

export async function launchChrome({ port = 9333, profileDir, width = 1280, height = 900, headless = true }) {
  const chromePath = findChrome();
  if (!chromePath) throw new Error('Chrome ou Edge introuvable : définir la variable CHROME_PATH.');
  fs.mkdirSync(profileDir, { recursive: true });
  const args = [
    '--remote-debugging-port=' + port,
    '--user-data-dir=' + profileDir,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-sync',
    '--window-size=' + width + ',' + height,
  ];
  if (headless) args.push('--headless=new');
  const proc = spawn(chromePath, args, { stdio: 'ignore' });
  for (let i = 0; i < 150; i += 1) {
    try {
      const res = await fetch('http://127.0.0.1:' + port + '/json/version');
      if (res.ok) {
        const info = await res.json();
        return { proc, port, browser: info.Browser };
      }
    } catch (error) {
      // Chrome n'écoute pas encore : on réessaie.
    }
    await sleep(150);
  }
  proc.kill();
  throw new Error('Chrome ne répond pas sur le port ' + port + '.');
}

export async function newPage(port, url = 'about:blank') {
  const res = await fetch('http://127.0.0.1:' + port + '/json/new?' + encodeURIComponent(url), { method: 'PUT' });
  if (!res.ok) throw new Error('Impossible d\'ouvrir un onglet (HTTP ' + res.status + ').');
  const target = await res.json();
  const cdp = new Cdp(target.webSocketDebuggerUrl);
  await cdp.open();
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  return cdp;
}

export class Cdp {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.nextId = 0;
    this.pending = new Map();
    this.listeners = [];
  }

  open() {
    this.ws = new WebSocket(this.wsUrl);
    this.ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id !== undefined && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message + (msg.error.data ? ' ' + msg.error.data : '')));
        else resolve(msg.result);
      } else if (msg.method) {
        for (const listener of this.listeners) listener(msg);
      }
    };
    return new Promise((resolve, reject) => {
      this.ws.onopen = () => resolve(this);
      this.ws.onerror = () => reject(new Error('Connexion DevTools impossible.'));
    });
  }

  send(method, params = {}) {
    const id = ++this.nextId;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }

  on(listener) {
    this.listeners.push(listener);
  }

  async evaluate(expression) {
    const res = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (res.exceptionDetails) {
      const detail = res.exceptionDetails.exception ? res.exceptionDetails.exception.description : res.exceptionDetails.text;
      throw new Error('Erreur JavaScript dans la page : ' + detail);
    }
    return res.result.value;
  }

  waitForEvent(method, timeout = 15000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Délai dépassé : ' + method)), timeout);
      const listener = (msg) => {
        if (msg.method === method) {
          clearTimeout(timer);
          this.listeners.splice(this.listeners.indexOf(listener), 1);
          resolve(msg.params);
        }
      };
      this.on(listener);
    });
  }

  async navigate(url, settleMs = 300) {
    const loaded = this.waitForEvent('Page.loadEventFired');
    const res = await this.send('Page.navigate', { url });
    if (res.errorText) throw new Error('Navigation refusée : ' + res.errorText);
    await loaded;
    await sleep(settleMs);
  }

  async waitFor(expression, timeout = 10000, step = 100) {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      try {
        if (await this.evaluate('!!(' + expression + ')')) return true;
      } catch (error) {
        // La page n'est pas encore prête : on réessaie.
      }
      await sleep(step);
    }
    throw new Error('Condition jamais atteinte : ' + expression);
  }

  async setViewport(width, height, mobile = false, deviceScaleFactor = 1) {
    await this.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor, mobile });
    await this.send('Emulation.setTouchEmulationEnabled', { enabled: mobile });
  }

  async screenshot(file) {
    const { data } = await this.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(file, Buffer.from(data, 'base64'));
    return file;
  }

  close() {
    try {
      this.ws.close();
    } catch (error) {
      // Déjà fermé.
    }
  }
}
