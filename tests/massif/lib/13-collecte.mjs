// Aides de la batterie 13 (pages du site dans un navigateur réel) :
//  - instrumenter() : écoute réseau / console / exceptions d'UN onglet et bloque TOUT hôte non local (hermétique),
//  - attendreCalme() : attend que le réseau de l'onglet soit silencieux,
//  - analyserPage() / chargerImages() / parcourirPage() : fonctions exécutées DANS la page (sérialisées via toString),
//  - petits outils HTTP et binaires (dimensions PNG, extraction d'identifiants HTML).
// Aucune écriture hors de tests/massif/. Aucune requête vers Internet : tout hôte autre que le site local est refusé (Fetch.failRequest).
import { sleep } from '../../e2e/lib/cdp.mjs';
import { ClientIP } from './clients.mjs';
import { OWNER_CODE } from '../../api-vercel/lib/harness.mjs';

/** Hôtes tiers CONNUS (règle du produit : aucun autre) : Google Fonts et Google Maps, bloqués dans les tests. */
export const TIERS_CONNUS = ['fonts.googleapis.com', 'fonts.gstatic.com', 'www.google.com', 'maps.googleapis.com', 'maps.gstatic.com'];

export const VIEWPORTS = [
  { nom: 'mobile-320', l: 320, h: 640, mobile: true },
  { nom: 'mobile-390', l: 390, h: 844, mobile: true },
  { nom: 'tablette-768', l: 768, h: 1024, mobile: true },
  { nom: 'bureau-1440', l: 1440, h: 900, mobile: false }
];

/** Valeur d'un en-tête HTTP (nom insensible à la casse) ou null. */
export function entete(entetes, nom) {
  if (!entetes) return null;
  const k = Object.keys(entetes).find((x) => x.toLowerCase() === nom.toLowerCase());
  return k === undefined ? null : String(entetes[k]);
}

/** Poids d'une réponse : octets reçus, ou Content-Length quand la réponse vient du service worker (octets reçus non attribués à la page). */
export function poidsReponse(r) {
  if (r.octets > 0) return r.octets;
  const cl = Number(entete(r.entetes, 'content-length'));
  return Number.isFinite(cl) && cl > 0 ? cl : 0;
}

/** Course contre le temps : rejette avec une erreur lisible si la promesse ne se termine pas. */
export function avecDelai(promesse, ms, etiquette = 'opération') {
  let minuteur;
  const limite = new Promise((_, rejeter) => { minuteur = setTimeout(() => rejeter(new Error(`Délai de ${ms} ms dépassé : ${etiquette}`)), ms); });
  return Promise.race([promesse, limite]).finally(() => clearTimeout(minuteur));
}

const SCRIPT_PERF = `
window.__perf = { lcp: 0, cls: 0, longues: 0 };
try { new PerformanceObserver(function (l) { l.getEntries().forEach(function (e) { window.__perf.lcp = e.startTime; }); }).observe({ type: 'largest-contentful-paint', buffered: true }); } catch (e) {}
try { new PerformanceObserver(function (l) { l.getEntries().forEach(function (e) { if (!e.hadRecentInput) window.__perf.cls += e.value; }); }).observe({ type: 'layout-shift', buffered: true }); } catch (e) {}
try { new PerformanceObserver(function (l) { window.__perf.longues += l.getEntries().length; }).observe({ type: 'longtask', buffered: true }); } catch (e) {}
`;

/**
 * Branche l'écoute sur un onglet (page = objet renvoyé par ouvrirPage). À appeler AVANT la navigation.
 * Renvoie un collecteur : { etat, resume(), vider(), enCours() }.
 * Tout hôte autre que le site local est refusé (BlockedByClient) : les requêtes sont comptées (« tentatives ») mais ne sortent pas.
 */
export async function instrumenter(page, base) {
  const origine = new URL(base).origin;
  const origines = new Set([origine, origine.replace('//localhost:', '//127.0.0.1:')]);
  const estLocal = (url) => {
    try { const u = new URL(url); return origines.has(u.origin); } catch { return false; }
  };
  const interne = (url) => /^(data|blob|about|chrome-extension|chrome|devtools):/i.test(url);
  const e = {
    reqs: new Map(), // requestId -> info
    hist: [], // sauts de redirection
    exceptions: [],
    consoleErreurs: [],
    consoleAvert: [],
    journal: [], // entrées Log (erreurs du navigateur : ressource introuvable, contenu mixte, etc.)
    dialogues: [],
    navigations: [],
    derniereActivite: Date.now(),
    docPrincipal: null
  };
  const cdp = page.cdp;
  const envoyer = (m, p) => page.send(m, p).catch(() => {});
  // Sans cela, les onglets en arrière-plan sont « hidden » : temporisateurs ralentis à 1 Hz, aucun rendu (mesuré).
  await page.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await page.send('Log.enable');
  await page.send('Page.setLifecycleEventsEnabled', { enabled: true }).catch(() => {});
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: SCRIPT_PERF });
  // Hermétique : seul le site local sort ; tout le reste est refusé après avoir été enregistré par Network.requestWillBeSent.
  await page.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });

  cdp.on((msg) => {
    const p = msg.params || {};
    switch (msg.method) {
      case 'Fetch.requestPaused': {
        const url = p.request.url;
        if (interne(url) || estLocal(url)) envoyer('Fetch.continueRequest', { requestId: p.requestId });
        else envoyer('Fetch.failRequest', { requestId: p.requestId, errorReason: 'BlockedByClient' });
        break;
      }
      case 'Network.requestWillBeSent': {
        e.derniereActivite = Date.now();
        if (p.redirectResponse) {
          const prec = e.reqs.get(p.requestId);
          if (prec) { prec.statut = p.redirectResponse.status; prec.redirigeVers = p.request.url; e.hist.push({ ...prec }); }
        }
        const info = {
          id: p.requestId, url: p.request.url, methode: p.request.method, type: p.type || 'Other', frameId: p.frameId,
          local: estLocal(p.request.url), interne: interne(p.request.url), debut: p.timestamp, statut: null, mime: null,
          octets: 0, fini: false, echec: null, annule: false, bloque: null, depuisSW: false, depuisCache: false, entetes: null,
          initiateur: p.initiator ? (p.initiator.type + (p.initiator.url ? ' ' + p.initiator.url : '')) : ''
        };
        e.reqs.set(p.requestId, info);
        if (!e.docPrincipal && p.type === 'Document' && p.requestId === p.loaderId) e.docPrincipal = info;
        break;
      }
      case 'Network.responseReceived': {
        e.derniereActivite = Date.now();
        const r = e.reqs.get(p.requestId);
        if (r) {
          r.statut = p.response.status; r.mime = p.response.mimeType; r.entetes = p.response.headers || {};
          r.depuisSW = !!p.response.fromServiceWorker; r.depuisCache = !!(p.response.fromDiskCache || p.response.fromPrefetchCache);
        }
        break;
      }
      case 'Network.loadingFinished': {
        e.derniereActivite = Date.now();
        const r = e.reqs.get(p.requestId);
        if (r) { r.fini = true; r.octets = p.encodedDataLength || 0; r.fin = p.timestamp; }
        break;
      }
      case 'Network.loadingFailed': {
        e.derniereActivite = Date.now();
        const r = e.reqs.get(p.requestId);
        if (r) { r.fini = true; r.echec = p.errorText || 'échec'; r.annule = !!p.canceled; r.bloque = p.blockedReason || null; r.fin = p.timestamp; }
        break;
      }
      case 'Network.requestServedFromCache': {
        const r = e.reqs.get(p.requestId);
        if (r) r.depuisCache = true;
        break;
      }
      case 'Runtime.exceptionThrown': {
        const d = p.exceptionDetails || {};
        const desc = d.exception ? (d.exception.description || d.exception.value || '') : (d.text || '');
        e.exceptions.push(String(desc).split('\n')[0].slice(0, 300) + (d.url ? ' @ ' + d.url + ':' + d.lineNumber : ''));
        break;
      }
      case 'Runtime.consoleAPICalled': {
        const texte = (p.args || []).map((a) => (a.value !== undefined ? String(a.value) : (a.description || a.type || ''))).join(' ').slice(0, 300);
        const lieu = p.stackTrace && p.stackTrace.callFrames && p.stackTrace.callFrames[0] ? ' @ ' + p.stackTrace.callFrames[0].url + ':' + p.stackTrace.callFrames[0].lineNumber : '';
        if (p.type === 'error' || p.type === 'assert') e.consoleErreurs.push(texte + lieu);
        else if (p.type === 'warning') e.consoleAvert.push(texte + lieu);
        break;
      }
      case 'Log.entryAdded': {
        const en = p.entry || {};
        if (en.level === 'error') e.journal.push({ source: en.source, texte: String(en.text || '').slice(0, 300), url: en.url || '' });
        break;
      }
      case 'Page.javascriptDialogOpening': {
        e.dialogues.push(p.type + ' : ' + String(p.message || '').slice(0, 120));
        envoyer('Page.handleJavaScriptDialog', { accept: false });
        break;
      }
      case 'Page.frameNavigated': {
        if (!p.frame.parentId) e.navigations.push(p.frame.url);
        break;
      }
      default:
    }
  });

  const col = {
    etat: e,
    enCours() {
      let n = 0;
      for (const r of e.reqs.values()) if (!r.fini && !r.interne && r.type !== 'WebSocket' && r.type !== 'EventSource') n++;
      return n;
    },
    vider() {
      e.reqs.clear(); e.hist.length = 0; e.exceptions.length = 0; e.consoleErreurs.length = 0; e.consoleAvert.length = 0;
      e.journal.length = 0; e.dialogues.length = 0; e.docPrincipal = null; e.derniereActivite = Date.now();
    },
    /** Synthèse du réseau de l'onglet jusqu'à présent. */
    resume() {
      const locales = [];
      const tiers = new Map();
      for (const r of e.reqs.values()) {
        if (r.interne) continue;
        if (r.local) { locales.push(r); continue; }
        let hote = '?';
        try { hote = new URL(r.url).hostname; } catch { /* url invalide */ }
        if (!tiers.has(hote)) tiers.set(hote, { hote, n: 0, types: new Set(), exemples: [] });
        const t = tiers.get(hote);
        t.n++; t.types.add(r.type);
        if (t.exemples.length < 3) t.exemples.push(r.url.length > 110 ? r.url.slice(0, 107) + '…' : r.url);
      }
      const echecs = locales.filter((r) => (r.statut !== null && r.statut >= 400) || (r.echec && !r.annule));
      const annulees = locales.filter((r) => r.echec && r.annule);
      const finies = locales.filter((r) => r.fini && !r.echec);
      return {
        locales, echecs, annulees, tiers: [...tiers.values()],
        octets: finies.reduce((s, r) => s + poidsReponse(r), 0),
        nbRequetes: locales.length,
        api: locales.filter((r) => { try { return new URL(r.url).pathname.startsWith('/api/'); } catch { return false; } })
      };
    }
  };
  return col;
}

/** Attend que plus aucune requête ne soit en cours pendant `silence` ms (au plus `max` ms au total). Renvoie la durée attendue. */
export async function attendreCalme(col, { silence = 600, max = 10000 } = {}) {
  const debut = Date.now();
  for (;;) {
    const maintenant = Date.now();
    if (col.enCours() === 0 && maintenant - col.etat.derniereActivite >= silence) return maintenant - debut;
    if (maintenant - debut > max) return maintenant - debut;
    await sleep(100);
  }
}

/** Évalue une expression dans la page avec un délai maximal (la page peut être figée ou plantée). */
export function evaluerAvecDelai(page, expression, ms = 30000, etiquette = 'évaluation') {
  return avecDelai(page.evaluate(expression), ms, etiquette);
}

/** Sérialise une fonction (sans fermeture) en expression à évaluer dans la page. */
export function enExpression(fn, ...args) {
  return `(${fn.toString()})(${args.map((a) => JSON.stringify(a)).join(',')})`;
}

// ---------------------------------------------------------------------------------------------------------------------
// Fonctions exécutées DANS la page. Elles ne doivent dépendre d'AUCUNE variable du module.
// ---------------------------------------------------------------------------------------------------------------------

/** Parcourt toute la page par défilement (déclenche les images paresseuses et les révélations) et mesure le débordement horizontal au passage. */
export async function parcourirPage() {
  const de = document.documentElement;
  const pas = Math.max(240, Math.floor(window.innerHeight * 0.8));
  let y = 0;
  let maxScroll = de.scrollWidth;
  let tours = 0;
  while (y < de.scrollHeight && tours < 400) {
    window.scrollTo(0, y);
    await new Promise((r) => setTimeout(r, 40));
    maxScroll = Math.max(maxScroll, de.scrollWidth);
    y += pas;
    tours++;
  }
  const hauteur = de.scrollHeight;
  window.scrollTo(0, 0);
  await new Promise((r) => setTimeout(r, 150));
  return { hauteur, maxScrollWidth: maxScroll, clientWidth: de.clientWidth, tours };
}

/** Force le chargement des images paresseuses puis attend que toutes les images à source non vide soient terminées. */
export async function chargerImages(maxMs) {
  const imgs = Array.from(document.images);
  imgs.forEach((i) => { if (i.getAttribute('loading') === 'lazy') i.loading = 'eager'; });
  const debut = Date.now();
  while (Date.now() - debut < maxMs) {
    if (imgs.every((i) => !i.getAttribute('src') || i.complete)) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  return imgs.map((i) => ({
    src: i.getAttribute('src') || '',
    cur: i.currentSrc || '',
    complete: i.complete,
    w: i.naturalWidth,
    h: i.naturalHeight,
    lazy: i.getAttribute('loading') === 'lazy'
  }));
}

/** Analyse complète de la page (structure, accessibilité, liens, champs, débordement, références externes). */
export async function analyserPage(options) {
  const doc = document;
  const ref = (options && options.largeur) || window.innerWidth; // largeur émulée : innerWidth grandit quand la page déborde (Chrome mobile)
  const nettoyer = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  const visible = (el) => { try { return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length); } catch (e) { return false; } };
  const masque = (el) => { for (let n = el; n && n.nodeType === 1; n = n.parentElement) { if (n.hidden || n.getAttribute('aria-hidden') === 'true') return true; } return false; };
  const decrire = (el) => {
    let s = el.tagName.toLowerCase();
    if (el.id) s += '#' + el.id;
    const c = typeof el.className === 'string' ? nettoyer(el.className).split(' ').filter(Boolean).slice(0, 2).join('.') : '';
    if (c) s += '.' + c;
    return s;
  };
  const texteVisible = (el) => {
    let t = '';
    for (const n of el.childNodes) {
      if (n.nodeType === 3) { t += n.nodeValue; continue; }
      if (n.nodeType !== 1) continue;
      if (n.hidden || n.getAttribute('aria-hidden') === 'true') continue;
      const cs = getComputedStyle(n);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const al = nettoyer(n.getAttribute('aria-label'));
      if (al) { t += ' ' + al; continue; }
      if (n.tagName === 'IMG') { t += ' ' + (n.getAttribute('alt') || ''); continue; }
      if (n instanceof SVGElement) { const ti = n.querySelector('title'); if (ti) t += ' ' + ti.textContent; continue; }
      t += ' ' + texteVisible(n);
    }
    return nettoyer(t);
  };
  const nomAccessible = (el) => {
    const lb = el.getAttribute('aria-labelledby');
    if (lb) { const t = nettoyer(lb.split(/\s+/).map((id) => { const r = doc.getElementById(id); return r ? r.textContent : ''; }).join(' ')); if (t) return t; }
    const al = nettoyer(el.getAttribute('aria-label')); if (al) return al;
    if (el.tagName === 'INPUT') { const v = nettoyer(el.getAttribute('value')); if (v) return v; const a = nettoyer(el.getAttribute('alt')); if (a) return a; }
    const t = texteVisible(el); if (t) return t;
    return nettoyer(el.getAttribute('title'));
  };
  const texteLabel = (l) => { const c = l.cloneNode(true); c.querySelectorAll('input,select,textarea,button').forEach((n) => n.remove()); return nettoyer(c.textContent); };

  const R = {};
  const de = doc.documentElement;
  const bo = doc.body;
  R.url = location.href;
  R.titre = doc.title;
  R.lang = de.getAttribute('lang');
  R.etat = doc.readyState;
  R.contentType = doc.contentType;
  R.charset = doc.characterSet;
  const meta = (sel, attr) => { const m = doc.querySelector(sel); return m ? m.getAttribute(attr) : null; };
  R.meta = {
    viewport: meta('meta[name=viewport]', 'content'),
    description: meta('meta[name=description]', 'content'),
    canonical: meta('link[rel=canonical]', 'href'),
    robots: meta('meta[name=robots]', 'content'),
    themeColor: meta('meta[name=theme-color]', 'content'),
    manifest: meta('link[rel=manifest]', 'href')
  };

  // Titres et repères
  const h1 = Array.from(doc.querySelectorAll('h1'));
  R.h1 = { total: h1.length, visibles: h1.filter((h) => visible(h) && !masque(h)).length, textes: h1.map((h) => nettoyer(h.textContent).slice(0, 80)) };
  R.nbMain = doc.querySelectorAll('main, [role=main]').length;
  R.niveaux = Array.from(doc.querySelectorAll('h1,h2,h3,h4,h5,h6')).filter((h) => visible(h)).map((h) => Number(h.tagName[1]));

  // Identifiants (cibles d'ancres) et doublons
  const compte = new Map();
  doc.querySelectorAll('[id]').forEach((el) => { compte.set(el.id, (compte.get(el.id) || 0) + 1); });
  R.ids = Array.from(compte.keys());
  R.noms = Array.from(doc.querySelectorAll('a[name]')).map((a) => a.getAttribute('name'));
  R.idsDoublons = Array.from(compte.entries()).filter(([k, v]) => k !== '' && v > 1).map(([k, v]) => k + ' x' + v);

  // Images
  R.images = Array.from(doc.images).map((i) => {
    const parent = i.closest('a[href],button');
    return {
      src: i.getAttribute('src') || '',
      aSrc: i.hasAttribute('src'),
      alt: i.hasAttribute('alt') ? i.getAttribute('alt') : null,
      role: i.getAttribute('role'),
      masque: masque(i),
      dansLien: parent ? parent.tagName.toLowerCase() : null,
      nomParent: parent ? nomAccessible(parent) : null,
      largeurAffichee: Math.round(i.getBoundingClientRect().width),
      visible: visible(i)
    };
  });

  // Liens et boutons
  R.liens = Array.from(doc.querySelectorAll('a[href], area[href]')).map((a) => ({
    href: a.getAttribute('href'), abs: a.href, cible: a.getAttribute('target'), rel: a.getAttribute('rel'),
    nom: nomAccessible(a), visible: visible(a), masque: masque(a)
  }));
  R.boutons = Array.from(doc.querySelectorAll('button, [role=button], input[type=button], input[type=submit], input[type=reset]'))
    .map((b) => ({ desc: decrire(b), nom: nomAccessible(b), visible: visible(b), masque: masque(b) }));

  // Champs de formulaire
  R.champs = Array.from(doc.querySelectorAll('input, select, textarea'))
    .filter((el) => !(el.tagName === 'INPUT' && ['hidden', 'submit', 'button', 'reset', 'image'].includes(el.type)))
    .map((el) => {
      const lb = el.getAttribute('aria-labelledby');
      const lbTexte = lb ? nettoyer(lb.split(/\s+/).map((id) => { const r = doc.getElementById(id); return r ? r.textContent : ''; }).join(' ')) : '';
      const labels = Array.from(el.labels || []).map(texteLabel).filter(Boolean);
      const al = nettoyer(el.getAttribute('aria-label'));
      const ti = nettoyer(el.getAttribute('title'));
      const ph = nettoyer(el.getAttribute('placeholder'));
      let via = null;
      if (lbTexte) via = 'aria-labelledby'; else if (al) via = 'aria-label'; else if (labels.length) via = 'label'; else if (ti) via = 'title';
      return {
        desc: decrire(el) + (el.name ? '[name=' + el.name + ']' : ''), type: el.type || el.tagName.toLowerCase(), id: el.id || '',
        libelle: lbTexte || al || labels[0] || ti || '', via, placeholderSeul: !via && !!ph, visible: visible(el), masque: masque(el)
      };
    });
  R.etiquettesOrphelines = Array.from(doc.querySelectorAll('label[for]')).filter((l) => !doc.getElementById(l.getAttribute('for'))).map((l) => l.getAttribute('for'));
  R.formulaires = Array.from(doc.forms).map((f) => ({ id: f.id || '', action: f.getAttribute('action'), methode: f.getAttribute('method') }));

  // Toutes les balises link (icônes, manifeste, feuilles de style) : pour vérifier que les fichiers existent
  R.liensLink = Array.from(doc.querySelectorAll('link[href]')).map((l) => ({ rel: l.getAttribute('rel') || '', href: l.href }));

  // Références externes présentes dans le DOM
  const hors = (u) => { try { const x = new URL(u, location.href); return x.origin !== location.origin && /^https?:$/.test(x.protocol); } catch (e) { return false; } };
  R.externes = {
    scripts: Array.from(doc.scripts).map((s) => s.src).filter((s) => s && hors(s)),
    feuilles: Array.from(doc.querySelectorAll('link[rel~=stylesheet]')).map((l) => l.href).filter(hors),
    iframes: Array.from(doc.querySelectorAll('iframe')).map((f) => ({ src: f.getAttribute('src') || '', title: f.getAttribute('title') })),
    images: Array.from(doc.images).map((i) => i.currentSrc || i.src).filter(hors),
    formulaires: Array.from(doc.forms).map((f) => f.action).filter(hors),
    indices: Array.from(doc.querySelectorAll('link[rel=preconnect],link[rel=dns-prefetch],link[rel=preload],link[rel=prefetch]')).map((l) => l.rel + ' ' + l.href)
  };
  const globauxAnalytics = ['ga', 'gtag', 'dataLayer', '_gaq', 'fbq', '_fbq', '_paq', 'Piwik', 'hj', 'clarity', 'plausible', 'umami', 'mixpanel', 'amplitude', 'Sentry', 'Intercom', '$crisp', 'Tawk_API', '_hsq', 'ttq', 'snaptr', 'twq', 'pintrk'];
  R.analyticsGlobaux = globauxAnalytics.filter((k) => { try { return typeof window[k] !== 'undefined'; } catch (e) { return false; } });

  // Débordement horizontal
  const utile = Math.min(ref, de.clientWidth);
  R.debord = {
    reference: ref, innerWidth: window.innerWidth, clientWidth: de.clientWidth, scrollWidth: de.scrollWidth,
    bodyScrollWidth: bo ? bo.scrollWidth : 0, depasse: Math.max(0, de.scrollWidth - utile),
    overflowXHtml: getComputedStyle(de).overflowX, overflowXBody: bo ? getComputedStyle(bo).overflowX : ''
  };
  const lim = ref + 1;
  const dansFixe = (el) => { for (let n = el; n && n !== de; n = n.parentElement) { const p = getComputedStyle(n).position; if (p === 'fixed') return true; } return false; };
  const fautifs = [];
  if (R.debord.depasse > 0 || (bo && bo.scrollWidth > utile)) {
    for (const el of doc.body.querySelectorAll('*')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.right <= lim && r.left >= -1) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none') continue;
      if (dansFixe(el)) continue;
      let coupe = false;
      for (let p = el.parentElement; p && p !== bo && p !== de; p = p.parentElement) {
        const ps = getComputedStyle(p);
        if (/(hidden|auto|scroll|clip)/.test(ps.overflowX)) {
          const pr = p.getBoundingClientRect();
          if (pr.right <= lim && pr.left >= -1) { coupe = true; break; }
        }
      }
      if (coupe) continue;
      fautifs.push({ el: decrire(el), droite: Math.round(r.right), gauche: Math.round(r.left), largeur: Math.round(r.width), texte: nettoyer(el.textContent).slice(0, 40) });
    }
    fautifs.sort((a, b) => b.droite - a.droite);
  }
  R.debord.fautifs = fautifs.slice(0, 6);

  // Texte brut visible : valeurs de gabarit non remplies et textes de remplissage
  const txt = bo ? (bo.innerText || '') : '';
  R.texteLongueur = txt.length;
  const motifs = [];
  const re = /\bundefined\b|\[object Object\]|\bNaN\b|\bnull\b|lorem ipsum|\bTODO\b|\bFIXME\b/gi;
  let m;
  while ((m = re.exec(txt)) && motifs.length < 5) motifs.push(txt.slice(Math.max(0, m.index - 25), m.index + m[0].length + 25).replace(/\s+/g, ' '));
  R.motifsSuspects = motifs;

  // Mesures de chargement
  const nav = performance.getEntriesByType('navigation')[0];
  const paint = performance.getEntriesByType('paint').find((p) => p.name === 'first-contentful-paint');
  R.perf = {
    dcl: nav ? Math.round(nav.domContentLoadedEventEnd) : null,
    load: nav ? Math.round(nav.loadEventEnd) : null,
    reponse: nav ? Math.round(nav.responseEnd) : null,
    fcp: paint ? Math.round(paint.startTime) : null,
    lcp: window.__perf ? Math.round(window.__perf.lcp) : null,
    cls: window.__perf ? Math.round(window.__perf.cls * 1000) / 1000 : null,
    tachesLongues: window.__perf ? window.__perf.longues : null
  };

  // Service workers vus depuis cette page
  try {
    const regs = navigator.serviceWorker ? await navigator.serviceWorker.getRegistrations() : [];
    R.sw = { controle: !!(navigator.serviceWorker && navigator.serviceWorker.controller), scopes: regs.map((r) => r.scope) };
  } catch (e) { R.sw = { controle: false, scopes: [], erreur: String(e) }; }

  R.hauteurPage = de.scrollHeight;
  R.splashPresent = !!doc.getElementById('intro-splash');
  return R;
}

// ---------------------------------------------------------------------------------------------------------------------
// Outils côté Node
// ---------------------------------------------------------------------------------------------------------------------

/** Dimensions d'un PNG (lecture de l'en-tête IHDR) ou null. */
export function dimensionsPng(buf) {
  if (!buf || buf.length < 24 || buf.toString('latin1', 1, 4) !== 'PNG') return null;
  return { l: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

/** Identifiants (id=) et ancres nommées (name=) d'un texte HTML. */
export function idsDuHtml(html) {
  const s = new Set();
  for (const m of html.matchAll(/\bid\s*=\s*"([^"]*)"|\bid\s*=\s*'([^']*)'/gi)) s.add(m[1] ?? m[2]);
  for (const m of html.matchAll(/<a\b[^>]*\bname\s*=\s*"([^"]*)"/gi)) s.add(m[1]);
  return s;
}

// ---------------------------------------------------------------------------------------------------------------------
// Robustesse du poste de test : la machine est partagée par de nombreux scripts qui saturent les ports TCP éphémères
// (EADDRINUSE / ECONNREFUSED sur des connexions locales, mesurés avec 30 000 sockets en TIME_WAIT). Ces erreurs surviennent
// AVANT l'envoi de la requête : la rejouer est sans risque (jamais de commande ou de compte en double).
// ---------------------------------------------------------------------------------------------------------------------
const CODES_CONNEXION = new Set(['EADDRINUSE', 'ECONNREFUSED', 'EADDRNOTAVAIL', 'ENETUNREACH', 'EAI_AGAIN', 'UND_ERR_CONNECT_TIMEOUT']);

/** Vrai si l'erreur est un échec d'ÉTABLISSEMENT de connexion (rien n'a été envoyé). */
export function estErreurConnexion(err) {
  let c = err;
  for (let i = 0; c && i < 6; i++, c = c.cause) {
    if (c.code && CODES_CONNEXION.has(c.code)) return true;
    if (Array.isArray(c.errors) && c.errors.some((x) => x && CODES_CONNEXION.has(x.code))) return true;
  }
  return false;
}

/** Rejoue fn() tant que l'échec est un échec de connexion (pauses croissantes, environ 12 s au plus). */
export async function avecReprise(fn, { essais = 14 } = {}) {
  for (let i = 0; ; i++) {
    try { return await fn(); } catch (err) {
      if (!estErreurConnexion(err) || i >= essais) throw err;
      await sleep(Math.min(1500, 200 * (i + 1)));
    }
  }
}

/** Client HTTP du harnais (cookies + adresse IP simulée) dont les échecs de connexion sont rejoués. */
export class ClientRobuste extends ClientIP {
  request(method, route, opts = {}) { return avecReprise(() => super.request(method, route, opts)); }
}

/** Commerçant connecté (code patron d'essai du harnais) depuis une adresse fictive à part ; connexions rejouées en cas d'échec réseau. */
export async function patronConnecteRobuste(ip = '10.250.250.250') {
  const patron = new ClientRobuste('patron-13', ip);
  const r = await patron.post('owner_login.php', { code: OWNER_CODE, remember: false });
  if (r.status !== 200) throw new Error('Connexion du patron refusée : ' + r.status + ' ' + r.text);
  return patron;
}

/** GET HTTP (sans suivre les redirections) : { statut, type, taille, corps (Buffer), entetes }. Jamais d'exception : statut 0 si échec. */
export async function recuperer(url, { methode = 'GET', delai = 15000 } = {}) {
  const cible = url.replace(/^(https?:\/\/)localhost(?=[:/])/, (m, schema) => schema + '127.0.0.1'); // évite la résolution ::1 / 127.0.0.1 du poste
  try {
    return await avecReprise(async () => {
      const rep = await avecDelai(fetch(cible, { method: methode, redirect: 'manual' }), delai, methode + ' ' + url);
      const corps = methode === 'HEAD' ? Buffer.alloc(0) : Buffer.from(await avecDelai(rep.arrayBuffer(), delai, 'corps ' + url));
      return { statut: rep.status, type: rep.headers.get('content-type') || '', taille: corps.length, corps, entetes: rep.headers };
    });
  } catch (err) {
    return { statut: 0, type: '', taille: 0, corps: Buffer.alloc(0), entetes: new Headers(), erreur: err.message + (err.cause && err.cause.code ? ' (' + err.cause.code + ')' : '') };
  }
}

export const ko = (n) => (n / 1024).toFixed(0) + ' Ko';
export const mo = (n) => (n / 1048576).toFixed(2) + ' Mo';
export const ms = (n) => (n === null || n === undefined ? '?' : n + ' ms');
