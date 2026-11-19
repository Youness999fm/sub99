// Batterie 14 : pilotage d'une page réelle comme un client (clics souris/tactiles réels, saisie au clavier, dialogues),
// lecture de ce que le client VOIT (panier, totaux, messages) et journal des requêtes du navigateur.
// Rien ici ne modifie le site : tout passe par le protocole DevTools (événements d'entrée, réseau, en-têtes de test).
import { sleep } from '../../e2e/lib/cdp.mjs';

/** Erreur réseau de la MACHINE (ports éphémères épuisés par d'autres tests, connexion réinitialisée) et non du produit. */
export const estTransitoire = (e) => /fetch failed|EADDRINUSE|EADDRNOTAVAIL|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ERR_ADDRESS_IN_USE|ERR_INSUFFICIENT_RESOURCES|ERR_CONNECTION_RESET|ERR_CONNECTION_REFUSED|ERR_TIMED_OUT|socket hang up/i
  .test(String(e && ((e.cause && (e.cause.code || e.cause.message)) || e.message || e)));

/** Rejoue fn tant que l'erreur est transitoire (au plus `essais` reprises, pauses croissantes) ; compte les reprises dans reprise.compte. */
export async function reprise(fn, essais = 10) {
  for (let i = 0; ; i++) {
    try { return await fn(); } catch (e) {
      if (!estTransitoire(e) || i >= essais) throw e;
      reprise.compte++;
      await sleep(200 * (i + 1));
    }
  }
}
reprise.compte = 0;

/** Code injecté dans CHAQUE page avant ses scripts (window.__t14) : recherche d'éléments, point de clic, lecture du panier affiché. */
function installerSondes() {
  const norm = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  const cents = (s) => {
    const m = /(\d+),(\d{2})\s*€/.exec(String(s));
    return m ? Number(m[1]) * 100 + Number(m[2]) : null;
  };
  const carte = (nom) => [...document.querySelectorAll('.menu-item')].find((a) => {
    const n = a.querySelector('.menu-item__name');
    return n && norm(n.textContent) === nom;
  }) || null;
  const visible = (e) => {
    const r = e.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    const cs = getComputedStyle(e);
    return cs.visibility !== 'hidden' && cs.display !== 'none';
  };
  // Spécification : { sel, carte?, dans?, texte?, debut?, contient?, index?, visible? }
  const trouver = (s) => {
    let racine = document;
    if (s.carte !== undefined) { racine = carte(s.carte); if (!racine) return null; }
    else if (s.dans !== undefined) { racine = document.querySelector(s.dans); if (!racine) return null; }
    let liste = [...racine.querySelectorAll(s.sel)];
    if (s.texte !== undefined) liste = liste.filter((e) => norm(e.textContent) === s.texte);
    if (s.debut !== undefined) liste = liste.filter((e) => norm(e.textContent).startsWith(s.debut));
    if (s.contient !== undefined) liste = liste.filter((e) => norm(e.textContent).includes(s.contient));
    if (s.visible !== false) liste = liste.filter(visible);
    return liste[s.index || 0] || null;
  };
  const nomCourt = (h) => (h ? h.tagName.toLowerCase() + (h.id ? '#' + h.id : '') + (typeof h.className === 'string' && h.className ? '.' + h.className.trim().split(/\s+/).join('.') : '') : null);
  // Défile l'élément dans la fenêtre puis cherche un point où le clic l'atteint réellement (rien ne le recouvre).
  const point = (s) => {
    const e = trouver(s);
    if (!e) return { etat: 'absent' };
    let dernier = null;
    for (const bloc of ['center', 'start', 'end']) {
      e.scrollIntoView({ block: bloc, inline: 'nearest', behavior: 'instant' });
      const r = e.getBoundingClientRect();
      const x0 = Math.max(r.left, 0); const x1 = Math.min(r.right, innerWidth);
      const y0 = Math.max(r.top, 0); const y1 = Math.min(r.bottom, innerHeight);
      if (x1 - x0 < 2 || y1 - y0 < 2) { dernier = { etat: 'hors_ecran' }; continue; }
      for (const [fx, fy] of [[0.5, 0.5], [0.25, 0.5], [0.75, 0.5], [0.5, 0.25], [0.5, 0.75], [0.15, 0.15], [0.85, 0.85]]) {
        const x = x0 + (x1 - x0) * fx; const y = y0 + (y1 - y0) * fy;
        const haut = document.elementFromPoint(x, y);
        const label = haut && haut.closest ? haut.closest('label') : null;
        if (haut && (haut === e || e.contains(haut) || (label && label.contains(e)))) {
          return { etat: 'ok', x, y, desactive: !!e.disabled, partielle: !(fx === 0.5 && fy === 0.5 && bloc === 'center') };
        }
        dernier = { etat: 'obstrue', haut: nomCourt(haut), x, y };
      }
    }
    return dernier || { etat: 'hors_ecran' };
  };
  // Le point désigné atteint-il toujours l'élément (la mise en page n'a pas bougé entre le calcul et le clic) ?
  const toujoursSous = (s, x, y) => {
    const e = trouver(s);
    const haut = document.elementFromPoint(x, y);
    const label = haut && haut.closest ? haut.closest('label') : null;
    return !!(e && haut && (haut === e || e.contains(haut) || (label && label.contains(e))));
  };
  // Ce que le client voit dans le tiroir du panier.
  const lirePanierAffiche = () => {
    const lignes = [...document.querySelectorAll('#cartDrawerBody .cart-line')].map((l) => {
      const nomEl = l.querySelector('.cart-line__name');
      const varEl = nomEl && nomEl.querySelector('.cart-line__variant');
      return {
        nom: nomEl ? norm(nomEl.childNodes[0] ? nomEl.childNodes[0].textContent : '') : '',
        variante: varEl ? norm(varEl.textContent).replace(/^\(|\)$/g, '') : '',
        details: [...l.querySelectorAll('.cart-line__details li')].map((li) => norm(li.textContent)),
        unitaire: cents(l.querySelector('.cart-line__unit') ? l.querySelector('.cart-line__unit').textContent : ''),
        qte: Number(norm(l.querySelector('.cart-line__qty-value') ? l.querySelector('.cart-line__qty-value').textContent : '0')),
        sousTotal: cents(l.querySelector('.cart-line__subtotal') ? l.querySelector('.cart-line__subtotal').textContent : '')
      };
    });
    const t = (sel) => { const e = document.querySelector(sel); return e ? norm(e.textContent) : null; };
    const spans = (sel) => { const e = document.querySelector(sel); return e ? [...e.querySelectorAll(':scope > span')].map((x) => norm(x.textContent)) : null; };
    const promoSpans = spans('.cart-drawer__promo');
    const sousSpans = spans('.cart-drawer__subtotal');
    const modeBtn = document.querySelector('.order-mode-toggle__btn.is-active');
    const statut = document.getElementById('checkoutOrderStatus');
    return {
      lignes,
      sousTotal: sousSpans ? cents(sousSpans[1]) : null,
      promo: promoSpans ? cents(promoSpans[1]) : null,
      promoLibelle: promoSpans ? promoSpans[0] : null,
      total: cents(t('#cartDrawerFooter .cart-drawer__total strong')),
      libelleTotal: t('#cartDrawerFooter .cart-drawer__total span'),
      statutLivraison: t('#deliveryStatus'),
      relance: t('.cart-drawer__nudge'),
      mode: modeBtn ? modeBtn.getAttribute('data-mode') : null,
      paiements: [...document.querySelectorAll('.payment-method__btn[data-method].is-active')].map((b) => b.getAttribute('data-method')),
      billet: (() => { const b = document.querySelector('.payment-method__btn[data-change].is-active'); return b ? Number(b.getAttribute('data-change')) : null; })(),
      message: statut && !statut.hidden ? norm(statut.textContent) : null,
      boutonCommander: (() => { const b = document.getElementById('checkoutOrder'); return b ? { actif: !b.disabled, texte: norm(b.textContent) } : null; })(),
      barre: { visible: !!document.getElementById('cartBar') && !document.getElementById('cartBar').hidden, nb: t('#cartBarCount'), total: cents(t('#cartBarTotal')) },
      tiroirOuvert: !!document.getElementById('cartOverlay') && !document.getElementById('cartOverlay').hidden
    };
  };
  const debordement = () => document.documentElement.scrollWidth - document.documentElement.clientWidth;
  window.__t14 = { norm, cents, carte, visible, trouver, point, toujoursSous, lirePanierAffiche, debordement };
}
const SOURCE_SONDES = '(' + installerSondes.toString() + ')()';

const TOUCHES = {
  Enter: { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' },
  Tab: { key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 },
  Escape: { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 },
  Backspace: { key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 },
  ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 },
  ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', windowsVirtualKeyCode: 38 }
};

/** Cible d'un clic : un sélecteur CSS, ou { sel, carte, dans, texte, debut, contient, index }. */
const spec = (cible) => (typeof cible === 'string' ? { sel: cible } : cible);
const decrire = (cible) => (typeof cible === 'string' ? cible : JSON.stringify(cible));

export class Ui {
  /**
   * Ouvre un onglet vierge réglé pour ce parcours : fenêtre (largeur × hauteur), adresse IP simulée du client (en-tête de test),
   * sondes injectées, journal réseau, dialogues du navigateur traités (confirm : voir reponseDialogue).
   */
  static async ouvrir(nav, { largeur, hauteur = 844, mobile = largeur < 700, ip, base }) {
    const page = await reprise(() => nav.ouvrirPage('about:blank', { largeur, hauteur, mobile }));
    const ui = new Ui(page, { largeur, hauteur, mobile, ip, base });
    await ui.init();
    return ui;
  }

  constructor(page, { largeur, hauteur, mobile, ip, base }) {
    this.page = page;
    this.cdp = page.cdp;
    this.largeur = largeur;
    this.hauteur = hauteur;
    this.mobile = mobile;
    this.ip = ip;
    this.base = base;
    this.reqs = [];
    this.dialogues = [];
    this.reponseDialogue = false; // false : annuler/refuser ; true : accepter
    this.obstructions = [];
    this.ferme = false;
    this.coupure = null; // { mode: 'avant' | 'apres', n, statuts, corps } : coupure réseau simulée sur l'envoi de commande
  }

  /** Met cet onglet au premier plan (utile quand plusieurs onglets sont ouverts). */
  async activer() { await this.cdp.send('Page.bringToFront'); }

  /**
   * Coupure réseau sur l'envoi d'une commande (order_create), pour le prochain appui :
   *  - 'avant' : le client passe hors ligne au moment de l'envoi, la requête ne part pas ;
   *  - 'apres' : la requête arrive au serveur (qui enregistre la commande) mais la réponse est perdue pour la page.
   */
  async couper(mode) {
    this.coupure = { mode, n: 0, statuts: [], corps: [] };
    await this.cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*order_create*', requestStage: mode === 'apres' ? 'Response' : 'Request' }] });
  }

  /** Rétablit le réseau et retire l'interception. */
  async retablir() {
    this.coupure = null;
    await this.cdp.send('Fetch.disable').catch(() => {});
    await this.hors_ligne(false);
  }

  surFetch(p) {
    const { cdp } = this;
    const c = this.coupure;
    if (!c) { cdp.send('Fetch.continueRequest', { requestId: p.requestId }).catch(() => {}); return; }
    c.n++;
    c.corps.push(p.request.postData || null);
    if (p.responseStatusCode !== undefined) c.statuts.push(p.responseStatusCode);
    if (c.mode === 'avant') {
      cdp.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
        .then(() => cdp.send('Fetch.failRequest', { requestId: p.requestId, errorReason: 'InternetDisconnected' })).catch(() => {});
    } else {
      cdp.send('Fetch.failRequest', { requestId: p.requestId, errorReason: 'InternetDisconnected' }).catch(() => {});
    }
  }

  async init() {
    const { cdp } = this;
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: SOURCE_SONDES });
    await cdp.send('Network.setExtraHTTPHeaders', { headers: { 'x-subito-test-ip': this.ip } });
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    const parId = new Map();
    cdp.on((msg) => {
      const p = msg.params || {};
      if (msg.method === 'Page.javascriptDialogOpening') {
        this.dialogues.push({ type: p.type, message: p.message });
        cdp.send('Page.handleJavaScriptDialog', { accept: !!this.reponseDialogue }).catch(() => {});
      } else if (msg.method === 'Network.requestWillBeSent') {
        const r = { id: p.requestId, url: p.request.url, methode: p.request.method, corps: p.request.postData || null, statut: null, echec: null, t: Date.now() };
        parId.set(p.requestId, r);
        this.reqs.push(r);
      } else if (msg.method === 'Network.responseReceived') {
        const r = parId.get(p.requestId);
        if (r) r.statut = p.response.status;
      } else if (msg.method === 'Network.loadingFailed') {
        const r = parId.get(p.requestId);
        if (r) r.echec = p.errorText || 'échec';
      } else if (msg.method === 'Fetch.requestPaused') {
        this.surFetch(p);
      }
    });
  }

  get erreurs() { return this.page.erreurs; }

  /** Requêtes du navigateur dont l'adresse contient `motif` (ex. 'order_create'). */
  requetes(motif, depuis = 0) {
    return this.reqs.filter((r) => r.t >= depuis && r.url.includes(motif) && r.methode !== 'OPTIONS');
  }

  /** Efface le journal réseau et renvoie l'instant de départ. */
  marquer() { return Date.now(); }

  async evaluer(expr) { return this.page.evaluate(expr); }

  /** Attend une condition (expression JavaScript évaluée dans la page) ; renvoie true, ou false à l'expiration (jamais d'exception). */
  async attendre(expr, ms = 8000) {
    try { await this.page.waitFor(expr, ms, 60); return true; } catch { return false; }
  }

  url() { return this.evaluer('location.pathname + location.search'); }

  /**
   * Charge une page du site et attend qu'elle soit prête : événement « load » (30 s au plus), puis, sur les pages de menu,
   * boutons de commande construits et disponibilité lue (sans quoi les boutons pizza restent cachés).
   */
  async aller(chemin, { menu = false, ms = 30000 } = {}) {
    await reprise(async () => {
      const charge = this.cdp.waitForEvent('Page.loadEventFired', ms).catch(() => null);
      const rep = await this.cdp.send('Page.navigate', { url: this.base + chemin });
      if (rep.errorText) throw new Error('Navigation refusée : ' + rep.errorText + ' (' + chemin + ')');
      await charge;
    });
    if (!(await this.attendre("document.readyState === 'complete' && !!window.__t14", ms))) throw new Error('Page non chargée : ' + chemin);
    if (menu) {
      const ok = await this.attendre("document.querySelectorAll('.pizza-widget').length > 0 && (document.documentElement.classList.contains('dispo-pret') || document.documentElement.classList.contains('dispo-echec'))", ms);
      if (!ok) throw new Error('Page de menu non prête : ' + chemin);
    }
  }

  async recharger(options) { return this.aller(await this.url(), options); }

  /** Texte visible (espaces réduits) du premier élément trouvé, ou null. */
  async texte(cible) {
    return this.evaluer(`(() => { const e = window.__t14.trouver(${JSON.stringify(spec(cible))}); return e ? window.__t14.norm(e.textContent) : null; })()`);
  }

  async existe(cible) {
    return this.evaluer(`!!window.__t14.trouver(${JSON.stringify(spec(cible))})`);
  }

  async compte(cible) {
    return this.evaluer(`(() => { const s = ${JSON.stringify(spec(cible))}; s.visible = s.visible === undefined ? true : s.visible; const racine = s.carte !== undefined ? window.__t14.carte(s.carte) : (s.dans !== undefined ? document.querySelector(s.dans) : document); return racine ? [...racine.querySelectorAll(s.sel)].filter((e) => s.visible === false || window.__t14.visible(e)).length : 0; })()`);
  }

  async valeur(cible) {
    return this.evaluer(`(() => { const e = window.__t14.trouver(${JSON.stringify({ ...spec(cible), visible: false })}); return e ? e.value : null; })()`);
  }

  async actif(cible) {
    return this.evaluer(`(() => { const e = window.__t14.trouver(${JSON.stringify(spec(cible))}); return e ? !e.disabled : null; })()`);
  }

  async attribut(cible, nom) {
    return this.evaluer(`(() => { const e = window.__t14.trouver(${JSON.stringify({ ...spec(cible), visible: false })}); return e ? e.getAttribute(${JSON.stringify(nom)}) : null; })()`);
  }

  async debordement() { return this.evaluer('window.__t14.debordement()'); }

  /**
   * Clic réel : défile jusqu'à l'élément, vérifie que rien ne le recouvre, puis envoie les événements souris
   * (ou un appui tactile sur mobile). Renvoie { ok, etat, desactive }. Une obstruction est consignée (this.obstructions).
   * options : fois (2 = double clic rapide, 3 = triple), tactile (forcer/inhiber), attente (ms pour que l'élément apparaisse).
   */
  async cliquer(cible, { fois = 1, tactile = this.mobile, attente = 4000 } = {}) {
    const s = spec(cible);
    const debut = Date.now();
    let pt = null;
    for (;;) {
      pt = await this.evaluer(`window.__t14.point(${JSON.stringify(s)})`);
      if (pt.etat === 'ok' || Date.now() - debut > attente) break;
      await sleep(80);
    }
    if (pt.etat !== 'ok') {
      if (pt.etat === 'obstrue' || pt.etat === 'hors_ecran') this.obstructions.push({ cible: decrire(cible), ...pt, url: await this.url() });
      return { ok: false, etat: pt.etat, haut: pt.haut || null };
    }
    let { x, y } = pt;
    if (!tactile) {
      await this.cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
      // La mise en page a-t-elle bougé (image chargée, défilement terminé) ? On recalcule une fois.
      const sous = await this.evaluer(`window.__t14.toujoursSous(${JSON.stringify(s)}, ${x}, ${y})`);
      if (!sous) {
        const p2 = await this.evaluer(`window.__t14.point(${JSON.stringify(s)})`);
        if (p2.etat !== 'ok') return { ok: false, etat: p2.etat };
        x = p2.x; y = p2.y;
        await this.cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
      }
      for (let k = 1; k <= fois; k++) {
        await this.cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: k });
        await this.cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: k });
      }
    } else {
      // Même contrôle qu'à la souris : la mise en page n'a pas bougé entre le calcul du point et l'appui.
      const sous = await this.evaluer(`window.__t14.toujoursSous(${JSON.stringify(s)}, ${x}, ${y})`);
      if (!sous) {
        const p2 = await this.evaluer(`window.__t14.point(${JSON.stringify(s)})`);
        if (p2.etat !== 'ok') return { ok: false, etat: p2.etat };
        x = p2.x; y = p2.y;
      }
      for (let k = 1; k <= fois; k++) {
        await this.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
        await this.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      }
    }
    return { ok: true, etat: 'ok', desactive: pt.desactive };
  }

  /** Touche du clavier (Enter, Tab, Escape, Backspace, flèches) sur l'élément qui a le focus. */
  async touche(nom, fois = 1) {
    const t = TOUCHES[nom];
    if (!t) throw new Error('Touche inconnue : ' + nom);
    for (let i = 0; i < fois; i++) {
      await this.cdp.send('Input.dispatchKeyEvent', { type: t.text ? 'keyDown' : 'rawKeyDown', ...t });
      await this.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: t.key, code: t.code, windowsVirtualKeyCode: t.windowsVirtualKeyCode });
    }
  }

  /** Saisie réelle : clic dans le champ (focus), sélection du contenu existant, puis frappe du texte. */
  async saisir(cible, texte) {
    const r = await this.cliquer(cible);
    if (!r.ok) return r;
    await this.evaluer('(() => { const e = document.activeElement; if (e && typeof e.select === "function") e.select(); return true; })()');
    if (texte === '') { await this.touche('Backspace'); return r; }
    await this.cdp.send('Input.insertText', { text: texte });
    return r;
  }

  /** Choix dans une liste déroulante : focus, puis flèches du clavier jusqu'à l'option voulue (texte exact). */
  async choisir(cible, texteOption) {
    const s = spec(cible);
    const info = await this.evaluer(`(() => { const e = window.__t14.trouver(${JSON.stringify(s)}); if (!e) return null; e.scrollIntoView({ block: 'center', behavior: 'instant' }); e.focus(); const opts = [...e.options].map((o) => window.__t14.norm(o.textContent)); return { opts, courant: e.selectedIndex }; })()`);
    if (!info) return { ok: false, etat: 'absent' };
    const cibleIdx = info.opts.indexOf(texteOption);
    if (cibleIdx === -1) return { ok: false, etat: 'option_absente', options: info.opts };
    const delta = cibleIdx - info.courant;
    if (delta !== 0) await this.touche(delta > 0 ? 'ArrowDown' : 'ArrowUp', Math.abs(delta));
    const lu = await this.evaluer(`(() => { const e = window.__t14.trouver(${JSON.stringify({ ...s, visible: false })}); return e ? window.__t14.norm(e.options[e.selectedIndex].textContent) : null; })()`);
    if (lu === texteOption) return { ok: true, clavier: true };
    // Repli : le clavier n'a pas changé la valeur (navigateur sans liste native) : valeur posée puis événements input/change.
    await this.evaluer(`(() => { const e = window.__t14.trouver(${JSON.stringify({ ...s, visible: false })}); e.selectedIndex = ${cibleIdx}; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    return { ok: true, clavier: false };
  }

  /** Lit le tiroir du panier tel que le client le voit. */
  async lirePanierAffiche() { return this.evaluer('window.__t14.lirePanierAffiche()'); }

  /** Panier enregistré dans le navigateur (localStorage), tel que le code du site le lit. */
  async panierStocke() {
    return this.evaluer("(() => { try { return JSON.parse(localStorage.getItem('subito_cart_v1') || '[]'); } catch (e) { return 'illisible'; } })()");
  }

  async stockage(cle, session = false) {
    return this.evaluer(`(() => { try { return ${session ? 'sessionStorage' : 'localStorage'}.getItem(${JSON.stringify(cle)}); } catch (e) { return 'bloque'; } })()`);
  }

  async ouvrirTiroir() {
    const r = await this.cliquer('#cartBarOpen');
    if (!r.ok) return false;
    return this.attendre("(() => { const o = document.getElementById('cartOverlay'); return !!o && !o.hidden && o.classList.contains('is-visible') && !!document.querySelector('#cartDrawerBody .cart-line'); })()", 6000);
  }

  async fermerTiroir() {
    await this.cliquer('#cartDrawerClose');
    return this.attendre("(() => { const o = document.getElementById('cartOverlay'); return !o || o.hidden; })()", 3000);
  }

  /** Bouton « À emporter » / « Livraison » du tiroir. */
  async basculer(mode) {
    const r = await this.cliquer(`.order-mode-toggle__btn[data-mode="${mode}"]`);
    await this.attendre(`(() => { const b = document.querySelector('.order-mode-toggle__btn.is-active'); return !!b && b.getAttribute('data-mode') === '${mode}'; })()`, 3000);
    if (mode === 'delivery') await this.attendre("(() => { const s = document.getElementById('deliveryStatus'); return !!s && !/V.rification de votre adresse/.test(s.textContent); })()", 6000);
    return r;
  }

  /** Efface cookies et stockage du site pour repartir d'une session vide (appelé sur un onglet déjà chargé sur le site). */
  async sessionVide() {
    await this.cdp.send('Network.clearBrowserCookies');
    await this.cdp.send('Storage.clearDataForOrigin', { origin: this.base, storageTypes: 'all' });
    this.reqs.length = 0;
    this.dialogues.length = 0;
    this.obstructions.length = 0;
  }

  /** Coupe ou rétablit le réseau de l'onglet (hors ligne). */
  async hors_ligne(coupe) {
    await this.cdp.send('Network.emulateNetworkConditions', { offline: !!coupe, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  }

  async capture(fichier) { return this.page.screenshot(fichier); }

  async fermer() {
    if (this.ferme) return;
    this.ferme = true;
    await this.page.fermer();
  }
}

/** « 11,00 € » -> 1100 ; null si illisible. */
export function enCentimes(texte) {
  const m = /(\d+),(\d{2})\s*€/.exec(String(texte));
  return m ? Number(m[1]) * 100 + Number(m[2]) : null;
}

/** 1100 -> « 11,00 € » (espace insécable évité : le site écrit une espace simple). */
export function enEuros(cents) {
  return (cents / 100).toFixed(2).replace('.', ',') + ' €';
}
