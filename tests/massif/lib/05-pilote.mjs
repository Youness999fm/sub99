// Aides de la batterie 05 (file du commerçant qui se met à jour toute seule, décisions à l'écran).
// Tout passe par avecNavigateur() (lib/chrome.mjs) : ces fonctions ne font que piloter les pages déjà ouvertes.
//  - bilan : lignes PASS / FAIL, mesures, résumé ;
//  - sondes : observateurs injectés AVANT le script de la page (AudioContext, vibration, zones aria-live, pastilles, toasts) ;
//  - clics RÉELS : Input.dispatchMouseEvent aux coordonnées de l'élément (test de recouvrement compris) ;
//  - journal réseau d'une page, figeage du sondage d'une page (CDP « Fetch »).
import { sleep } from '../../e2e/lib/cdp.mjs';

export { sleep };

// ───────────────────────────── Bilan ─────────────────────────────

export function creerBilan() {
  const debut = Date.now();
  const b = {
    reussis: 0,
    echoues: 0,
    echecs: [],
    metriques: [],
    debut,
    duree: () => (Date.now() - debut) / 1000,
    /** Une ligne PASS ou FAIL, avec la valeur observée. Renvoie la condition. */
    controle(nom, condition, observe = '') {
      const ok = Boolean(condition);
      if (ok) b.reussis++;
      else { b.echoues++; b.echecs.push(observe === '' ? nom : `${nom} [${observe}]`); }
      console.log(`${ok ? 'PASS' : 'FAIL'}  ${nom}${observe !== '' ? `  [${observe}]` : ''}`);
      return ok;
    },
    info(texte) { console.log('      · ' + texte); },
    metrique(texte) { b.metriques.push(texte); console.log('      mesure : ' + texte); },
    section(titre) { console.log(`\n=== ${titre}  (t+${b.duree().toFixed(0)} s)`); }
  };
  return b;
}

// ───────────────────────────── Formats (mêmes règles que la page) ─────────────────────────────

export const norm = (s) => String(s ?? '').replace(/[  ]/g, ' ').replace(/\s+/g, ' ').trim();
export const eur = (cents) => norm((Number(cents) / 100).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' }));
const FHM = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' });
const FHMS = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', second: '2-digit' });
export const hm = (iso) => FHM.format(new Date(iso));
export const hms = (date) => FHMS.format(date);
export const libelleDelai = (m) => (m === 60 ? '1 heure' : m + ' min');
export const libelleDelaiCourt = (m) => (m === 60 ? '1 h' : m + ' min');

export function statistiques(valeurs) {
  const v = [...valeurs].sort((a, b) => a - b);
  if (!v.length) return { n: 0, min: NaN, p50: NaN, p95: NaN, max: NaN, moy: NaN };
  const q = (p) => v[Math.min(v.length - 1, Math.floor(p * v.length))];
  return { n: v.length, min: v[0], p50: q(0.5), p95: q(0.95), max: v[v.length - 1], moy: v.reduce((s, x) => s + x, 0) / v.length };
}
export const fmtStat = (s, unite = 'ms') => `n=${s.n} min=${Math.round(s.min)}${unite} p50=${Math.round(s.p50)}${unite} p95=${Math.round(s.p95)}${unite} max=${Math.round(s.max)}${unite}`;

/** Annonces d'une zone aria-live « Nouvelle commande de X » / « N nouvelles commandes : A, B » -> noms de clients, ou null. */
export function nomsAnnonces(texte) {
  let m = /^Nouvelle commande de (.+)$/.exec(texte);
  if (m) return [m[1]];
  m = /^(\d+) nouvelles commandes : (.+)$/.exec(texte);
  if (m) return m[2].split(', ');
  return null;
}

// ───────────────────────────── Attentes ─────────────────────────────

/** Attend que fn() renvoie une valeur vraie (au plus `timeout` ms). Renvoie { ok, valeur, ms }. */
export async function attendre(fn, timeout = 8000, pas = 80) {
  const t0 = Date.now();
  let valeur = null;
  for (;;) {
    try { valeur = await fn(); } catch (e) { valeur = null; }
    if (valeur) return { ok: true, valeur, ms: Date.now() - t0 };
    if (Date.now() - t0 > timeout) return { ok: false, valeur, ms: Date.now() - t0 };
    await sleep(pas);
  }
}

// ───────────────────────────── Sondes injectées dans les pages ─────────────────────────────
// Ces fonctions sont sérialisées (toString) et exécutées DANS la page : elles doivent être autonomes.

function sondeCommune() {
  const L = window.__sonde = { vib: [], osc: [], ctx: [], live: [], toasts: [], chips: {}, prep: {}, banner: [], clics: [], statuts: [], titres: [], erreurSonde: null };
  try {
    Object.defineProperty(navigator, 'vibrate', {
      configurable: true,
      value: function (p) { L.vib.push({ t: Date.now(), p: Array.isArray(p) ? p.slice() : p }); return true; }
    });
  } catch (e) { L.erreurSonde = String(e); }
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) {
      const creer = AC.prototype.createOscillator;
      AC.prototype.createOscillator = function () { L.osc.push(Date.now()); return creer.apply(this, arguments); };
      const Faux = function () { const inst = new AC(...arguments); L.ctx.push(inst); return inst; };
      Faux.prototype = AC.prototype;
      window.AudioContext = Faux;
      if (window.webkitAudioContext) window.webkitAudioContext = Faux;
    }
  } catch (e) { L.erreurSonde = String(e); }
  document.addEventListener('click', (e) => {
    const t = e.target && e.target.closest ? e.target.closest('[data-action]') : null;
    L.clics.push({ t: Date.now(), action: t ? t.getAttribute('data-action') : null, id: t ? t.getAttribute('data-id') : null, detail: e.detail });
  }, true);
}

function sondePatron() {
  const L = window.__sonde;
  const demarrer = () => {
    const q = (s) => document.querySelector(s);
    const suivre = (noeud, options, fn) => { if (noeud) new MutationObserver(fn).observe(noeud, options); };
    suivre(q('#queue'), { childList: true, subtree: true }, () => {
      const now = Date.now();
      for (const b of document.querySelectorAll('#queue .qchip')) {
        const id = b.getAttribute('data-id');
        if (!(id in L.chips)) L.chips[id] = now;
      }
    });
    suivre(q('#prep-queue'), { childList: true, subtree: true }, () => {
      const now = Date.now();
      for (const b of document.querySelectorAll('#prep-queue .qchip')) {
        const id = b.getAttribute('data-id');
        if (!(id in L.prep)) L.prep[id] = now;
      }
    });
    suivre(q('#live'), { childList: true, characterData: true, subtree: true }, () => {
      const texte = q('#live').textContent;
      if (texte) L.live.push({ t: Date.now(), texte });
    });
    suivre(q('#toast'), { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['hidden'] }, () => {
      const el = q('#toast');
      if (!el.hidden && el.textContent) L.toasts.push({ t: Date.now(), texte: el.textContent });
    });
    suivre(q('#net-banner'), { attributes: true, attributeFilter: ['hidden'] }, () => {
      L.banner.push({ t: Date.now(), visible: !q('#net-banner').hidden });
    });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', demarrer); else demarrer();
}

function sondeSuivi() {
  const L = window.__sonde;
  const demarrer = () => {
    const corps = document.getElementById('orderTrackBody');
    if (!corps) return;
    new MutationObserver(() => {
      const bloc = corps.querySelector('.order-track-status');
      const compte = document.getElementById('orderCountdown');
      L.statuts.push({
        t: Date.now(),
        statut: corps.getAttribute('data-order-status'),
        classe: bloc ? bloc.className : null,
        compte: compte ? compte.textContent : null
      });
    }).observe(corps, { attributes: true, attributeFilter: ['data-order-status'], childList: true });
    new MutationObserver(() => { L.titres.push({ t: Date.now(), titre: document.title }); }).observe(document.querySelector('title'), { childList: true });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', demarrer); else demarrer();
}

/** À appeler sur une page about:blank, AVANT de la faire naviguer. type : 'patron' | 'suivi'. */
export async function installerSondes(page, type) {
  const source = `(${sondeCommune.toString()})();(${(type === 'patron' ? sondePatron : sondeSuivi).toString()})();`;
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source });
}

export const lireSonde = (page) => page.evaluate(`(() => {
  const L = window.__sonde;
  if (!L) return null;
  return {
    vib: L.vib, osc: L.osc, live: L.live, toasts: L.toasts, chips: L.chips, prep: L.prep, banner: L.banner, clics: L.clics,
    statuts: L.statuts, titres: L.titres, erreurSonde: L.erreurSonde,
    ctx: L.ctx.map((c) => c.state),
    activation: navigator.userActivation ? navigator.userActivation.hasBeenActive : null,
    visibilite: document.visibilityState
  };
})()`);

export const lireToasts = (page) => page.evaluate('window.__sonde ? window.__sonde.toasts.slice(-12) : []');
export const lireLive = (page) => page.evaluate('window.__sonde ? window.__sonde.live : []');

// ───────────────────────────── Journal réseau d'une page ─────────────────────────────

/** Enregistre les requêtes /api/ de la page. Renvoie le tableau (alimenté en continu). corps : lit les réponses de owner_order_decide. */
export function suivreReseau(page, { corps = false } = {}) {
  const journal = [];
  const parId = new Map();
  page.cdp.on((m) => {
    const p = m.params || {};
    if (m.method === 'Network.requestWillBeSent') {
      const r = p.request;
      if (!r.url.includes('/api/')) return;
      const route = r.url.split('/api/')[1].split('?')[0].replace(/\.php$/, '');
      const e = { requestId: p.requestId, t: Date.now(), methode: r.method, route, url: r.url, donnees: null, status: null, fin: null, erreur: null, reponse: null };
      if (r.postData) { try { e.donnees = JSON.parse(r.postData); } catch (x) { e.donnees = r.postData; } }
      journal.push(e);
      parId.set(p.requestId, e);
    } else if (m.method === 'Network.responseReceived') {
      const e = parId.get(p.requestId);
      if (e) e.status = p.response.status;
    } else if (m.method === 'Network.loadingFinished') {
      const e = parId.get(p.requestId);
      if (!e) return;
      e.fin = Date.now();
      if (corps && e.route === 'owner_order_decide') {
        page.send('Network.getResponseBody', { requestId: p.requestId })
          .then((r) => { try { e.reponse = JSON.parse(r.body); } catch (x) { e.reponse = r.body; } })
          .catch(() => {});
      }
    } else if (m.method === 'Network.loadingFailed') {
      const e = parId.get(p.requestId);
      if (e) { e.fin = Date.now(); e.erreur = p.errorText; }
    }
  });
  return journal;
}

// ───────────────────────────── Clics réels ─────────────────────────────

function expressionCible(selecteur) {
  return `(() => {
    const el = document.querySelector(${JSON.stringify(selecteur)});
    if (!el) return { ok: false, raison: 'absent' };
    if (el.disabled) return { ok: false, raison: 'désactivé' };
    el.scrollIntoView({ block: 'center', inline: 'center' });
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return { ok: false, raison: 'invisible' };
    const x = Math.round(r.left + r.width / 2);
    const y = Math.round(r.top + r.height / 2);
    const haut = document.elementFromPoint(x, y);
    if (!haut || !(haut === el || el.contains(haut))) {
      const nom = haut ? (haut.id ? '#' + haut.id : haut.tagName.toLowerCase() + '.' + String(haut.className).split(' ')[0]) : 'rien';
      return { ok: false, raison: 'recouvert par ' + nom, recouvertPar: haut ? (haut.id || haut.tagName) : null };
    }
    return { ok: true, x, y };
  })()`;
}

/** Statistiques sur les éléments recouverts par le message d'action (toast) au moment d'un clic. */
export const recouvrements = { toast: 0, autres: 0, attenteMs: 0, exemples: [] };

async function viser(page, selecteur, timeout, nom) {
  const t0 = Date.now();
  let derniere = 'jamais essayé';
  let recouvrementToast = false;
  while (Date.now() - t0 < timeout) {
    const p = await page.evaluate(expressionCible(selecteur));
    if (p && p.ok) {
      if (recouvrementToast) recouvrements.attenteMs += Date.now() - t0;
      return p;
    }
    derniere = p ? p.raison : 'pas de réponse';
    if (p && p.recouvertPar === 'toast') {
      if (!recouvrementToast) { recouvrements.toast++; if (recouvrements.exemples.length < 5) recouvrements.exemples.push(nom || selecteur); }
      recouvrementToast = true;
    } else if (p && p.raison && p.raison.startsWith('recouvert')) {
      recouvrements.autres++;
    }
    await sleep(60);
  }
  throw new Error(`Clic impossible sur « ${nom || selecteur} » : ${derniere}`);
}

const souris = (page, type, x, y, clickCount = 1) => page.send('Input.dispatchMouseEvent', {
  type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: type === 'mouseMoved' ? 0 : clickCount
});

/** Clic réel (souris) au centre de l'élément. Attend qu'il soit présent, actif et non recouvert. Renvoie { x, y, t }. */
export async function cliquer(page, selecteur, { timeout = 6000, nom } = {}) {
  const p = await viser(page, selecteur, timeout, nom);
  await souris(page, 'mouseMoved', p.x, p.y);
  await souris(page, 'mousePressed', p.x, p.y);
  const t = Date.now();
  await souris(page, 'mouseReleased', p.x, p.y);
  return { x: p.x, y: p.y, t };
}

/** Double-clic réel. ecartMs = 0 : les quatre événements partent d'une traite ; sinon pause entre les deux clics (humain : 80 à 150 ms). */
export async function doubleCliquer(page, selecteur, { ecartMs = 0, timeout = 6000, nom } = {}) {
  const p = await viser(page, selecteur, timeout, nom);
  await souris(page, 'mouseMoved', p.x, p.y);
  const t = Date.now();
  if (ecartMs === 0) {
    await Promise.all([
      souris(page, 'mousePressed', p.x, p.y, 1), souris(page, 'mouseReleased', p.x, p.y, 1),
      souris(page, 'mousePressed', p.x, p.y, 2), souris(page, 'mouseReleased', p.x, p.y, 2)
    ]);
  } else {
    await souris(page, 'mousePressed', p.x, p.y, 1);
    await souris(page, 'mouseReleased', p.x, p.y, 1);
    await sleep(ecartMs);
    await souris(page, 'mousePressed', p.x, p.y, 2);
    await souris(page, 'mouseReleased', p.x, p.y, 2);
  }
  return { x: p.x, y: p.y, t };
}

export const mettreAuPremierPlan = (page) => page.send('Page.bringToFront');

// ───────────────────────────── Réseau coupé / sondage figé ─────────────────────────────

export const coupureReseau = (page, hors) => page.send('Network.emulateNetworkConditions', {
  offline: hors, latency: 0, downloadThroughput: -1, uploadThroughput: -1
});

/**
 * Fige le sondage de la file d'une page : chaque GET owner_orders.php reçoit `corps` (instantané ancien du serveur) au lieu de
 * la réponse réelle. Simule « l'autre tablette n'a pas encore rafraîchi sa file ». Renvoie { relacher(), servis() }.
 */
export async function figerSondage(page, corpsTexte) {
  let actif = true;
  let servis = 0;
  const base64 = Buffer.from(corpsTexte, 'utf8').toString('base64');
  page.cdp.on((m) => {
    if (m.method !== 'Fetch.requestPaused') return;
    if (!actif) { page.send('Fetch.continueRequest', { requestId: m.params.requestId }).catch(() => {}); return; }
    servis++;
    page.send('Fetch.fulfillRequest', {
      requestId: m.params.requestId,
      responseCode: 200,
      responseHeaders: [
        { name: 'Content-Type', value: 'application/json; charset=utf-8' },
        { name: 'Cache-Control', value: 'no-store' }
      ],
      body: base64
    }).catch(() => {});
  });
  await page.send('Fetch.enable', { patterns: [{ urlPattern: '*/api/owner_orders.php*', requestStage: 'Request' }] });
  return {
    servis: () => servis,
    async relacher() {
      actif = false;
      await page.send('Fetch.disable');
    }
  };
}
