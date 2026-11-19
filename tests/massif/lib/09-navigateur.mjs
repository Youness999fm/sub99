// Aides navigateur de la batterie 09 (au-dessus de lib/chrome.mjs, qui limite le nombre de navigateurs et d'onglets).
// - ouvrir() : onglet préparé (détecteur window.__pwn, impression et boîtes de dialogue neutralisées, aucune requête hors
//   localhost : tout autre hôte est refusé et noté, service worker contourné, adresse IP simulée, journaux réseau et console) ;
// - auditer() : cherche dans la page ce qu'une injection laisserait (attributs d'événement, balises dangereuses, liens javascript:, window.__pwn) ;
// - petites aides de lecture et de clic.
const HOTES_LOCAUX = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
const HOTES_BLOQUES_ATTENDUS = /fonts\.googleapis\.com|fonts\.gstatic\.com|www\.google\.com|maps\.googleapis\.com/;

/** Script exécuté dans chaque page AVANT les siens : détecteur d'exécution et neutralisation des boîtes bloquantes. */
const SCRIPT_INIT = `(() => {
  let v;
  Object.defineProperty(window, '__pwn', { configurable: true, enumerable: true, get() { return v; }, set(x) { v = x; (window.__pwnJournal = window.__pwnJournal || []).push(String(x)); } });
  window.__dialogues = [];
  window.alert = window.confirm = window.prompt = function (m) { window.__dialogues.push(String(m)); return false; };
  window.__impressions = [];
  window.print = function () { const z = document.getElementById('print-area'); window.__impressions.push(z ? z.textContent : null); };
})();`;

/**
 * Ouvre un onglet prêt pour les attaques. options : cookies (ClientIP), largeur, hauteur, mobile, ip (adresse simulée de la page).
 * Renvoie la page de chrome.mjs, enrichie de page.journal = { requetes, externes, bloques, logs, dialogues }.
 */
export async function ouvrir(nav, url, { cookies = null, largeur = 1180, hauteur = 820, mobile = false, ip = null } = {}) {
  const page = await nav.ouvrirPage('about:blank', { cookies, largeur, hauteur, mobile });
  const cdp = page.cdp;
  const journal = { requetes: [], externes: [], bloques: [], logs: [], dialogues: [] };
  page.journal = journal;
  await cdp.send('Log.enable');
  await cdp.send('Network.setBypassServiceWorker', { bypass: true });
  if (ip) await cdp.send('Network.setExtraHTTPHeaders', { headers: { 'x-subito-test-ip': ip } });
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: SCRIPT_INIT });
  cdp.on((msg) => {
    if (msg.method === 'Fetch.requestPaused') {
      const { requestId, request } = msg.params;
      let hote = '';
      try { hote = new URL(request.url).hostname; } catch { /* adresse illisible : traitée comme externe */ }
      const local = HOTES_LOCAUX.has(hote) || /^(data|blob|about):/.test(request.url);
      if (local) cdp.send('Fetch.continueRequest', { requestId }).catch(() => {});
      else {
        (HOTES_BLOQUES_ATTENDUS.test(request.url) ? journal.bloques : journal.externes).push(request.url);
        cdp.send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' }).catch(() => {});
      }
    } else if (msg.method === 'Network.requestWillBeSent') {
      journal.requetes.push(msg.params.request.url);
    } else if (msg.method === 'Log.entryAdded') {
      const e = msg.params.entry;
      if (e.level === 'error' || e.level === 'warning') journal.logs.push({ niveau: e.level, source: e.source, texte: String(e.text).slice(0, 220), url: String(e.url || '').slice(0, 200) });
    } else if (msg.method === 'Page.javascriptDialogOpening') {
      journal.dialogues.push(String(msg.params.message || ''));
      cdp.send('Page.handleJavaScriptDialog', { accept: false }).catch(() => {});
    }
  });
  await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
  if (url) await page.navigate(url);
  return page;
}

/** Fonction exécutée DANS la page (sérialisée par toString) : anomalies d'injection dans les zones racines données. */
function auditerPage(racines, scriptsAttendus) {
  const res = { pwn: typeof window.__pwn, pwnJournal: window.__pwnJournal || [], onAttrs: [], dangereux: [], liens: [], dialogues: window.__dialogues || [], scriptsEnLigne: 0 };
  const DANGER = 'script,iframe,object,embed,img,form,input,textarea,select,video,audio,source,link,meta,base,style,frame,frameset,applet,portal';
  const verifier = (e, ctx) => {
    for (const a of e.getAttributeNames()) if (/^on/i.test(a)) res.onAttrs.push(ctx + ' <' + e.tagName.toLowerCase() + ' ' + a + '>');
    for (const a of ['href', 'src', 'action', 'formaction', 'data', 'srcdoc', 'xlink:href']) {
      const h = e.getAttribute(a);
      if (h && /^\s*(javascript|vbscript|data):/i.test(h)) res.liens.push(ctx + ' ' + a + '=' + h.slice(0, 60));
    }
  };
  for (const sel of racines) {
    for (const r of document.querySelectorAll(sel)) {
      verifier(r, sel);
      for (const e of r.querySelectorAll('*')) verifier(e, sel);
      for (const e of r.querySelectorAll(DANGER)) res.dangereux.push(sel + ' <' + e.tagName.toLowerCase() + '>');
    }
  }
  for (const e of document.querySelectorAll('*')) {
    if (e.tagName === 'SCRIPT' && e.getAttribute('src')) continue;
    for (const a of e.getAttributeNames()) if (/^on/i.test(a)) res.onAttrs.push('document <' + e.tagName.toLowerCase() + ' ' + a + '>');
  }
  res.scriptsEnLigne = [...document.querySelectorAll('script:not([src])')].filter((s) => s.type !== 'application/ld+json').length;
  res.scriptsEnTrop = Math.max(0, res.scriptsEnLigne - scriptsAttendus);
  return res;
}

/** Audit d'une page. Renvoie la liste des anomalies (vide = rien d'exécuté ni d'injecté). */
export async function auditer(page, racines, { scriptsAttendus = 0 } = {}) {
  const r = await page.evaluate('(' + auditerPage.toString() + ')(' + JSON.stringify(racines) + ',' + scriptsAttendus + ')');
  const anomalies = [];
  if (r.pwn !== 'undefined') anomalies.push('window.__pwn = ' + r.pwn);
  if (r.pwnJournal.length) anomalies.push('affectations de window.__pwn : ' + r.pwnJournal.length);
  if (r.onAttrs.length) anomalies.push('attributs d\'événement : ' + r.onAttrs.slice(0, 3).join(', '));
  if (r.dangereux.length) anomalies.push('balises injectées : ' + r.dangereux.slice(0, 4).join(', '));
  if (r.liens.length) anomalies.push('liens dangereux : ' + r.liens.slice(0, 3).join(', '));
  if (r.dialogues.length) anomalies.push('alert/confirm/prompt appelés : ' + r.dialogues.length);
  if (r.scriptsEnTrop > 0) anomalies.push('balises <script> en ligne en trop : ' + r.scriptsEnTrop);
  if (page.journal) {
    if (page.journal.externes.length) anomalies.push('requêtes hors localhost : ' + page.journal.externes.slice(0, 3).join(', '));
    if (page.journal.dialogues.length) anomalies.push('boîtes de dialogue natives : ' + page.journal.dialogues.length);
  }
  return anomalies;
}

/** Erreurs de console et exceptions d'une page depuis le dernier appel à purgerErreurs(). Ignore les ressources bloquées par le test. */
export function erreursPage(page) {
  const sorties = [...page.erreurs];
  for (const l of page.journal.logs) {
    if (l.niveau !== 'error') continue;
    if (/ERR_BLOCKED_BY_CLIENT/.test(l.texte) && (HOTES_BLOQUES_ATTENDUS.test(l.url) || HOTES_BLOQUES_ATTENDUS.test(l.texte) || l.url === '')) continue;
    sorties.push(`${l.source}: ${l.texte} ${l.url}`);
  }
  return sorties;
}
export function purgerErreurs(page) {
  page.erreurs.length = 0;
  page.journal.logs.length = 0;
}

const exprChamp = (mode) => (mode === 'text' ? 'e.textContent' : mode === 'value' ? 'e.value' : `e.getAttribute(${JSON.stringify(mode)})`);

/** Texte (ou valeur, ou attribut) du premier élément correspondant ; null s'il n'existe pas. */
export const lire = (page, sel, mode = 'text') => page.evaluate(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return e ? ${exprChamp(mode)} : null; })()`);
/** Texte (ou valeur, ou attribut) de tous les éléments correspondants. */
export const lireTous = (page, sel, mode = 'text') => page.evaluate(`[...document.querySelectorAll(${JSON.stringify(sel)})].map((e) => ${exprChamp(mode)})`);
export const compter = (page, sel) => page.evaluate(`document.querySelectorAll(${JSON.stringify(sel)}).length`);
export const noms = (page, sel) => page.evaluate(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return e ? e.getAttributeNames() : null; })()`);

/** Clic « logiciel » (événement click qui remonte jusqu'au document, comme un toucher). Renvoie faux si l'élément manque. */
export const cliquer = (page, sel) => page.evaluate(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; e.click(); return true; })()`);

/** Attend une condition JavaScript dans la page ; renvoie vrai/faux (ne lève pas). */
export async function attendre(page, expression, ms = 12000) {
  try { await page.waitFor(expression, ms, 80); return true; } catch { return false; }
}

/** Saisie « clavier » dans un champ : focus, vidage, insertion du texte (déclenche l'événement input). */
export async function saisir(page, sel, texte) {
  const ok = await page.evaluate(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; e.focus(); e.select && e.select(); return true; })()`);
  if (!ok) return false;
  await page.send('Input.insertText', { text: texte });
  return true;
}
