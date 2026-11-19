// Aides de la batterie 04 (suivi client dynamique) : pages de suivi réelles dans Chrome, instrumentées avant leur chargement.
//
//  - Un nom d'hôte *.localhost par client (suivi<N>.localhost) : Chrome partage UNE boîte à cookies par navigateur, et le cookie
//    de session client porte toujours le même nom ; un hôte par client permet donc d'ouvrir 8 clients différents en même temps.
//  - Emulation.setFocusEmulationEnabled : sans lui, seul l'onglet du premier plan est « visible » (les autres sont cachés et leurs
//    minuteurs sont ralentis à 1 s) ; avec lui, chaque page se comporte comme une page affichée au premier plan.
//  - Instrumentation injectée AVANT les scripts de la page : Notification et navigator.vibrate factices (appels enregistrés),
//    document.hidden pilotable, écritures de document.title, observateur de DOM (changements de data-order-status, minuteur).
//  - Côté Node : requêtes order_status (Network.requestWillBeSent), navigations de la page principale.
import { sleep } from '../../e2e/lib/cdp.mjs';

export { sleep };

/** Promesse avec délai maximal (la promesse d'origine n'est pas annulée, seulement abandonnée). */
export function avecDelai(promesse, ms, nom) {
  let minuteur;
  const limite = new Promise((_, rejeter) => { minuteur = setTimeout(() => rejeter(new Error('Délai dépassé (' + ms + ' ms) : ' + nom)), ms); });
  return Promise.race([promesse, limite]).finally(() => clearTimeout(minuteur));
}

/** Script injecté dans chaque document de la page, avant ses propres scripts. */
export function scriptInstrumentation({ cache = false } = {}) {
  return `(() => {
  if (window.__s) return;
  const realNow = Date.now.bind(Date);
  const S = (window.__s = {
    vib: [], notif: [], status: [], cd: [], titres: [], rebuilds: [],
    forceHidden: ${cache ? 'true' : 'false'},
    realNow: realNow,
    origine: performance.timeOrigin
  });
  function FauxNotification(titre, options) {
    S.notif.push({ t: realNow(), titre: String(titre), corps: options && options.body !== undefined ? String(options.body) : null, tag: options && options.tag !== undefined ? String(options.tag) : null, cache: document.hidden });
  }
  FauxNotification.permission = 'granted';
  FauxNotification.requestPermission = function () { return Promise.resolve('granted'); };
  Object.defineProperty(window, 'Notification', { value: FauxNotification, writable: true, configurable: true });
  Object.defineProperty(navigator, 'vibrate', { value: function (motif) { S.vib.push({ t: realNow(), motif: Array.isArray(motif) ? motif.slice() : motif }); return true; }, writable: true, configurable: true });
  const dh = Object.getOwnPropertyDescriptor(Document.prototype, 'hidden');
  const dv = Object.getOwnPropertyDescriptor(Document.prototype, 'visibilityState');
  S.vraiCache = function () { return dh.get.call(document); };
  Object.defineProperty(document, 'hidden', { configurable: true, get: function () { return S.forceHidden === null ? dh.get.call(document) : S.forceHidden; } });
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: function () { return S.forceHidden === null ? dv.get.call(document) : (S.forceHidden ? 'hidden' : 'visible'); } });
  const dt = Object.getOwnPropertyDescriptor(Document.prototype, 'title');
  Object.defineProperty(Document.prototype, 'title', { configurable: true, enumerable: dt.enumerable, get: function () { return dt.get.call(this); }, set: function (v) { S.titres.push({ t: realNow(), v: String(v) }); dt.set.call(this, v); } });
  new MutationObserver(function (enregistrements) {
    const t = realNow();
    let reconstruit = false;
    for (const r of enregistrements) {
      if (r.type === 'attributes' && r.attributeName === 'data-order-status') S.status.push({ t: t, v: r.target.getAttribute('data-order-status') });
      else if (r.type === 'childList' && r.target.id === 'orderTrackBody') reconstruit = true;
      else if (r.type === 'childList' && r.target.id === 'orderCountdown') S.cd.push({ t: t, v: r.target.textContent });
      else if (r.type === 'characterData' && r.target.parentNode && r.target.parentNode.id === 'orderCountdown') S.cd.push({ t: t, v: r.target.parentNode.textContent });
    }
    if (reconstruit) S.rebuilds.push({ t: t });
  }).observe(document, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['data-order-status'] });
})();`;
}

/** Instantané lisible de la page de suivi (expression évaluée dans la page, renvoie une chaîne JSON). */
const LIRE_PAGE = `JSON.stringify((() => {
  const b = document.getElementById('orderTrackBody');
  const q = (s) => (b ? b.querySelector(s) : null);
  const txt = (el) => (el ? el.textContent.replace(/\\s+/g, ' ').trim() : null);
  const cdEl = document.getElementById('orderCountdown');
  const soEl = document.getElementById('orderSorry');
  const st = q('.order-track-status');
  const tel = q('a[href^="tel:"]');
  return {
    statut: b ? b.getAttribute('data-order-status') : null,
    classe: st ? st.className : null,
    texteStatut: txt(st),
    titreStatut: txt(q('.order-track-status__title')),
    indice: txt(q('.order-track-hint')),
    cd: cdEl ? txt(cdEl) : null,
    cdLive: cdEl ? cdEl.getAttribute('aria-live') : null,
    sorry: soEl ? { cache: soEl.hidden, texte: txt(soEl) } : null,
    numero: txt(q('.order-track-number')),
    total: txt(q('.order-track-total strong')),
    nbLignes: b ? b.querySelectorAll('.order-track-item').length : 0,
    paiement: txt(q('.order-track-payment')),
    tel: tel ? { href: tel.getAttribute('href'), texte: txt(tel) } : null,
    notice: txt(document.getElementById('orderTrackNotice')),
    corps: txt(b),
    titre: document.title,
    vraiCache: window.__s ? window.__s.vraiCache() : null,
    activation: navigator.userActivation ? navigator.userActivation.hasBeenActive : null,
    url: location.href
  };
})())`;

export class Suivi {
  constructor(page, meta) {
    this.page = page;
    Object.assign(this, meta);
    this.reqs = [];        // { t, id } : requêtes order_status (instant d'émission, epoch ms)
    this.reponses = [];    // { t, id, status }
    this.echecs = [];      // requêtes order_status en échec réseau
    this.navs = [];        // navigations de la fenêtre principale
    this.navsDoc = [];     // navigations dans le même document (hash, pushState)
    this.manuels = [];     // instants des événements visibilitychange envoyés par le test (exclus des mesures de cadence)
    this.idsStatus = new Set();
    this.marqueur = null;
    this.origineMarqueur = null;
    this.navsAuMarqueur = null;
    page.cdp.on((msg) => this.surEvenement(msg));
  }

  surEvenement(msg) {
    const p = msg.params || {};
    if (msg.method === 'Network.requestWillBeSent' && p.request && String(p.request.url).includes('/api/order_status')) {
      this.reqs.push({ t: Math.round(p.wallTime * 1000), id: p.requestId });
      this.idsStatus.add(p.requestId);
    } else if (msg.method === 'Network.responseReceived' && p.response && String(p.response.url).includes('/api/order_status')) {
      this.reponses.push({ t: Date.now(), id: p.requestId, status: p.response.status });
    } else if (msg.method === 'Network.loadingFailed' && this.idsStatus.has(p.requestId)) {
      this.echecs.push({ t: Date.now(), id: p.requestId, erreur: p.errorText });
    } else if (msg.method === 'Page.frameNavigated' && p.frame && !p.frame.parentId) {
      this.navs.push({ t: Date.now(), url: p.frame.url });
    } else if (msg.method === 'Page.navigatedWithinDocument') {
      this.navsDoc.push({ t: Date.now(), url: p.url });
    }
  }

  eval(expression, ms = 10000) {
    return avecDelai(this.page.evaluate(expression), ms, String(expression).slice(0, 70));
  }

  async json(expression, ms = 10000) {
    return JSON.parse(await this.eval('JSON.stringify(' + expression + ')', ms));
  }

  /** Instantané du DOM de la page (voir LIRE_PAGE). */
  async lire() {
    return JSON.parse(await this.eval(LIRE_PAGE));
  }

  /** Journaux de l'instrumentation : signaux, changements de statut, minuteur, titres, reconstructions du DOM. */
  async journal() {
    return this.json('(() => { const S = window.__s; return { vib: S.vib, notif: S.notif, status: S.status, cd: S.cd, titres: S.titres, rebuilds: S.rebuilds, origine: S.origine, forceHidden: S.forceHidden }; })()');
  }

  /** Attend (sondage rapide) qu'un statut soit apparu dans le DOM ; renvoie l'instant (epoch ms) du changement du DOM. */
  async attendreStatut(valeur, ms = 12000) {
    const debut = Date.now();
    for (;;) {
      let vus = null;
      try { vus = await this.json('window.__s.status', 5000); } catch (e) { vus = null; }
      const trouve = vus && vus.find((e) => e.v === valeur);
      if (trouve) return trouve.t;
      if (Date.now() - debut > ms) throw new Error(`[${this.etiquette}] statut « ${valeur} » jamais affiché en ${ms} ms (vu : ${JSON.stringify((vus || []).map((e) => e.v))})`);
      await sleep(100);
    }
  }

  /** Attend qu'une expression de la page devienne vraie ; renvoie la durée d'attente en ms. */
  async attendre(expression, ms, nom) {
    const debut = Date.now();
    for (;;) {
      let ok = false;
      try { ok = await this.eval('!!(' + expression + ')', 5000); } catch (e) { ok = false; }
      if (ok) return Date.now() - debut;
      if (Date.now() - debut > ms) throw new Error(`[${this.etiquette}] condition jamais atteinte en ${ms} ms : ${nom || expression}`);
      await sleep(100);
    }
  }

  /** Geste utilisateur réel (clic) : donne l'activation utilisateur à la page. */
  async cliquer(x = 150, y = 300) {
    await this.page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await this.page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  }

  /** Simule document.hidden (true = onglet caché) puis, par défaut, l'événement visibilitychange que le navigateur enverrait. */
  async cacher(cache, { evenement = true } = {}) {
    if (!cache) this.manuels.push(Date.now());
    await this.eval(`(() => { window.__s.forceHidden = ${cache ? 'true' : 'false'}; ${evenement ? "document.dispatchEvent(new Event('visibilitychange'));" : ''} return true; })()`);
  }

  /** Avance l'horloge de la PAGE (Date.now) de ms millisecondes (le serveur n'est pas touché). */
  async avancerHorlogePage(ms) {
    await this.eval(`(() => { const r = window.__s.realNow; Date.now = function () { return r() + ${Number(ms)}; }; return true; })()`);
  }

  /** Marqueur dans la page : s'il a disparu à la fin, la page a été rechargée ou remplacée. */
  async poserMarqueur(valeur) {
    this.marqueur = valeur;
    await this.eval(`window.__marqueur = ${JSON.stringify(valeur)}`);
    this.origineMarqueur = await this.eval('performance.timeOrigin');
    this.navsAuMarqueur = this.navs.length;
    this.navsDocAuMarqueur = this.navsDoc.length;
  }

  async fermer() {
    try { await this.page.fermer(); } catch (e) { /* déjà fermée */ }
  }
}

/**
 * Ouvre la page de suivi d'une commande pour un client (cookies injectés pour son hôte *.localhost).
 * options : etiquette, cache (document.hidden simulé dès le chargement), geste (activation utilisateur AVANT le chargement :
 * clic sur une page de même origine puis navigation lancée par la page, comme le fait le panier après l'envoi d'une commande),
 * hote (nom d'hôte à utiliser, par défaut suivi<N>.localhost).
 */
export async function ouvrirSuivi(nav, site, client, commandeId, { etiquette = 'page', cache = false, geste = true, hote = null } = {}) {
  const page = await nav.ouvrirPage('about:blank');
  const nomHote = hote || `suivi${client.num}.localhost`;
  const s = new Suivi(page, { etiquette, commandeId, hote: nomHote, client });
  try {
    await page.send('Emulation.setFocusEmulationEnabled', { enabled: true });
    for (const [nom, valeur] of client.cookies) {
      const rep = await page.send('Network.setCookie', {
        name: nom, value: valeur, domain: nomHote, path: '/api/', httpOnly: true, sameSite: 'Lax', expires: Math.floor(Date.now() / 1000) + 86400
      });
      if (!rep.success) throw new Error('Cookie refusé par Chrome pour ' + nomHote);
    }
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: scriptInstrumentation({ cache }) });
    const base = `http://${nomHote}:${site.port}`;
    if (geste) {
      await page.navigate(base + '/robots.txt', 0);
      await s.cliquer();
      await sleep(60);
      const charge = page.cdp.waitForEvent('Page.loadEventFired', 20000);
      await page.evaluate(`location.assign('/commande.html?id=${Number(commandeId)}')`);
      await charge;
    } else {
      await page.navigate(`${base}/commande.html?id=${Number(commandeId)}`, 0);
    }
    s.tOuverture = Date.now();
  } catch (e) {
    await s.fermer();
    throw e;
  }
  return s;
}

/** Statistiques simples sur une liste de nombres. */
export function stats(valeurs) {
  if (!valeurs.length) return null;
  const somme = valeurs.reduce((a, b) => a + b, 0);
  return { n: valeurs.length, min: Math.min(...valeurs), moy: somme / valeurs.length, max: Math.max(...valeurs) };
}

export const sec = (ms) => (ms / 1000).toFixed(2) + ' s';

export function texteStats(st) {
  return st ? `n=${st.n} · min ${sec(st.min)} · moy ${sec(st.moy)} · max ${sec(st.max)}` : 'aucune mesure';
}

/**
 * Intervalles entre requêtes order_status successives, rangés selon le statut AFFICHÉ au moment de la requête suivante
 * (c'est lui qui fixe le délai du sondage : 4 s en attente, 5 s une fois acceptée). Les intervalles qui encadrent un événement
 * visibilitychange envoyé par le test sont écartés.
 */
export function intervallesSondage(suivi, statuts) {
  const reqs = [...suivi.reqs].sort((a, b) => a.t - b.t);
  const sortie = { new: [], accepted: [] };
  for (let i = 1; i < reqs.length; i++) {
    const avant = reqs[i - 1].t;
    const apres = reqs[i].t;
    if (suivi.manuels.some((m) => m >= avant - 100 && m <= apres + 100)) continue;
    let courant = null;
    for (const e of statuts) if (e.t <= apres) courant = e.v;
    if (courant === 'new' || courant === 'accepted') sortie[courant].push(apres - avant);
  }
  return sortie;
}

/** Valeur du minuteur « M:SS » en secondes, ou null. */
export function secondesMinuteur(texte) {
  const m = /^(\d+):(\d{2})$/.exec(String(texte || '').trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}
