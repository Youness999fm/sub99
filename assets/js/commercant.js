/* Espace commerçant — relié à l'API /api/owner_*.php.
   La session est un cookie HttpOnly posé par le serveur : rien n'est gardé dans
   localStorage, sessionStorage ni dans un cookie lisible par JavaScript.
   Montants reçus en centimes, convertis en euros à l'affichage seulement. */
(() => {
  'use strict';

  const API = '/api/';
  const TZ = 'Europe/Paris';
  const DELAYS = [20, 30, 40, 50, 60];
  const SERVICE_START = '18h';
  const SERVICE_END = '23h';
  const POLL_VISIBLE_MS = 4000;
  const POLL_HIDDEN_MS = 15000;
  const POLL_MAX_MS = 30000;

  // Menu : copie statique de menu.html (noms et ingrédients), sert seulement à afficher les produits.
  // « a|b » veut dire « a ou b » : le produit n'est retiré que si toutes ses options sont indisponibles.
  const MENU = [
    { key: 'pizzas', label: 'Pizzas', items: [
      { name: "Végétarienne", ing: ["sauce tomate", "fromage", "poivrons", "champignons", "oignons", "olives"] },
      { name: "3 Jambons", ing: ["sauce tomate", "fromage", "jambon", "mortadelle", "chorizo"] },
      { name: "4 Saisons", ing: ["sauce tomate", "fromage", "jambon", "champignons", "poivrons", "olives", "artichauts"] },
      { name: "Calzone (soufflée)", ing: ["sauce tomate", "fromage", "jambon|thon|kebab|viande hachée|poulet", "jaune d’œuf"] },
      { name: "Campione", ing: ["sauce tomate", "fromage", "viande hachée", "champignons"] },
      { name: "Kebab", ing: ["sauce tomate", "fromage", "kebab", "oignons"] },
      { name: "Napolitaine", ing: ["sauce tomate", "fromage", "anchois", "câpres"] },
      { name: "Régina", ing: ["sauce tomate", "fromage", "jambon", "champignons"] },
      { name: "Chicken", ing: ["sauce tomate", "fromage", "poulet", "poivrons", "champignons"] },
      { name: "Kefta", ing: ["sauce tomate", "fromage", "oignons", "viande hachée", "oeuf"] },
      { name: "Neptune", ing: ["sauce tomate", "fromage", "thon", "olives", "oignons"] },
      { name: "4 Fromages", ing: ["sauce tomate", "fromage", "brie", "bleu", "parmesan"] },
      { name: "Carnivora", ing: ["sauce tomate", "fromage", "viande hachée", "merguez", "chorizo"] },
      { name: "L'Extravagante", ing: ["sauce tomate", "fromage", "jambon", "chorizo", "merguez", "champignons", "oeuf"] },
      { name: "Fruits de mer", ing: ["sauce tomate", "fromage", "cocktail de fruits de mer", "ail", "persil"] },
      { name: "Orientale", ing: ["sauce tomate", "fromage", "merguez", "oignons", "poivrons", "oeuf"] },
      { name: "Pacifico", ing: ["sauce tomate", "fromage", "saumon fumé", "crème fraîche"] },
      { name: "Subito", ing: ["sauce tomate", "fromage", "viande hachée", "chorizo", "oeuf", "oignons"] },
      { name: "Venezia", ing: ["crème fraîche", "fromage", "saumon fumé"] },
      { name: "Chèvre miel", ing: ["crème fraîche", "fromage", "fromage de chèvre", "miel"] },
      { name: "Chicken Chika", ing: ["crème fraîche", "fromage", "poulet", "poivrons", "oignons"] },
      { name: "Milano", ing: ["crème fraîche", "fromage", "jambon", "oignons", "pommes de terre"] },
      { name: "Normande", ing: ["crème fraîche", "fromage", "bleu", "fromage de chèvre", "parmesan"] },
      { name: "Fajitas", ing: ["crème fraîche", "fromage de chèvre", "viande hachée", "poivrons", "oignons"] },
      { name: "Maroilles", ing: ["crème fraîche", "fromage", "maroilles"] },
      { name: "Pollame", ing: ["crème fraîche", "fromage", "jambon", "poulet", "kebab"] },
      { name: "Savoyarde", ing: ["crème fraîche", "lardons", "pommes de terre", "oignons", "reblochons"] },
      { name: "Suisse", ing: ["crème fraîche", "jambon", "pommes de terre", "oignons", "fromage à raclette"] },
      { name: "Indienne", ing: ["base crème fraîche/curry", "fromage", "poulet", "oignons"] },
      { name: "Carolina", ing: ["base barbecue", "fromage", "viande hachée", "poivrons"] }
    ] },
    { key: 'pates', label: 'Pâtes', items: [
      { name: "Bolognaise", ing: ["sauce tomate", "viande hachée", "oignons"] },
      { name: "3 fromages", ing: ["crème fraîche", "brie", "bleu", "parmesan"] },
      { name: "Saumon", ing: ["crème fraîche", "saumon"] },
      { name: "Carbonara", ing: ["crème fraîche", "lardons"] }
    ] },
    { key: 'subitowichs', label: 'Subitowichs (paninis)', items: [
      { name: "Milano", ing: ["fromage", "poulet"] },
      { name: "Vesuvio", ing: ["fromage", "viande hachée"] },
      { name: "4 fromages", ing: ["fromage", "brie", "bleu", "parmesan"] },
      { name: "Rome", ing: ["fromage", "thon"] },
      { name: "Venise", ing: ["fromage", "jambon"] },
      { name: "Norvégien", ing: ["fromage", "saumon fumé"] },
      { name: "Kebab", ing: ["fromage", "kebab"] }
    ] },
    { key: 'tex-mex', label: 'Tex-Mex', items: [
      { name: "Wings (5 pièces)", ing: ["ailes de poulet frites", "poulet"] },
      { name: "Tenders (4 pièces)", ing: ["aiguillettes de poulet panées", "poulet"] },
      { name: "Nuggets (4 pièces)", ing: ["nuggets de poulet panés", "poulet"] },
      { name: "Oignon ring (8 pièces)", ing: ["rondelles d'oignon panées et frites", "oignons"] }
    ] },
    { key: 'salades', label: 'Salades', items: [
      { name: "Exotique", ing: ["salade", "tomates", "oeuf", "crevettes", "maïs"] },
      { name: "Niçoise", ing: ["salade", "tomates", "oeuf", "thon", "pommes de terre"] },
      { name: "Printanière", ing: ["salade", "tomates", "oeuf", "jambon", "fromage"] },
      { name: "Di Roma", ing: ["salade", "tomates", "oeuf", "thon", "artichauts"] }
    ] },
    { key: 'desserts', label: 'Desserts', items: [
      { name: "Tiramisubito Spéculoos", ing: ["crème mascarpone", "spéculoos"] },
      { name: "Tiramisubito Oreo", ing: ["crème mascarpone", "oreo"] },
      { name: "Tiramisubito M&M's", ing: ["crème mascarpone", "m&m's"] },
      { name: "Calzone Nutella", ing: ["pâte à pizza soufflée", "nutella"] },
      { name: "Part de Tarte au Daim", ing: ["biscuit croustillant", "caramel", "éclats de noisettes", "chocolat au lait"] }
    ] },
    { key: 'boissons', label: 'Boissons', items: [
      { name: "Boisson 33cl", ing: [] },
      { name: "Grande bouteille", ing: [] }
    ] }
  ];
  const PRODUCTS = [];
  MENU.forEach(cat => cat.items.forEach((it, i) => PRODUCTS.push({
    id: cat.key + '-' + i, cat: cat.key, kind: cat.key === 'pizzas' ? 'pizza' : 'product', name: it.name, ing: it.ing
  })));
  const INGREDIENT_LABEL = { "m&m's": "M&M's" };
  const INGREDIENTS = (() => {
    const keys = new Set();
    PRODUCTS.forEach(p => p.ing.forEach(g => g.split('|').forEach(m => keys.add(m))));
    return [...keys].sort((a, b) => a.localeCompare(b, 'fr'))
      .map(k => ({ key: k, label: INGREDIENT_LABEL[k] || k.charAt(0).toUpperCase() + k.slice(1) }));
  })();

  const PAYMENT_LABEL = { card: 'Carte bancaire', cash: 'Espèces', ticket: 'Ticket restaurant', ticket_card: 'Carte ticket restaurant' };

  const state = {
    authed: false,
    orders: [],
    ordersLoaded: false,
    serviceDay: dayKeyOf(new Date()),
    sending: new Set(),
    mutationSeq: 0,
    selectedId: null,
    editingId: null,
    draftDelay: null,
    view: 'orders',
    defaultDelay: 30,
    savingDefault: false,
    storeOpen: true,
    savingStoreOpen: false,
    soundOn: true,
    out: [],
    availLoaded: false,
    availError: false,
    availBusy: new Set(),
    catKey: MENU[0].key,
    patronTab: 'recap',
    clientQuery: '',
    customers: [],
    customersState: 'idle',
    selectedClientId: null,
    sessions: [],
    sessionsState: 'idle',
    netLost: false
  };

  const $ = sel => document.querySelector(sel);
  const el = {
    boot: $('#boot'),
    loginView: $('#login-view'),
    loginForm: $('#login-form'),
    loginPassword: $('#login-password'),
    loginRemember: $('#login-remember'),
    loginSubmit: $('#login-submit'),
    loginError: $('#login-error'),
    top: $('#app-top'),
    main: $('#main'),
    net: $('#net-banner'),
    clock: $('#clock'),
    queue: $('#queue'),
    detail: $('#order-detail'),
    decision: $('#decision'),
    notifSlot: $('#notif-slot'),
    catTabs: $('#cat-tabs'),
    catTitle: $('#cat-title'),
    prodGrid: $('#prod-grid'),
    availMsg: $('#avail-msg'),
    allIn: $('#avail-all-in'),
    patronBody: $('#patron-body'),
    live: $('#live'),
    toast: $('#toast'),
    dlg: $('#dlg'),
    dlgBody: $('#dlg-body')
  };

  let toastTimer = null;
  function toast(msg) {
    el.toast.textContent = msg;
    el.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.toast.hidden = true; }, 4000);
  }
  function alertMsg(msg) {
    toast(msg);
    announce(msg);
  }
  function announce(msg) {
    el.live.textContent = '';
    setTimeout(() => { el.live.textContent = msg; }, 50);
  }

  // Réécrit une zone seulement si son contenu a changé : un toucher en cours n'est jamais perdu.
  const lastHtml = new Map();
  function setHTML(node, html) {
    if (!node || lastHtml.get(node) === html) return;
    lastHtml.set(node, html);
    node.innerHTML = html;
  }

  // ---------- Utilitaires ----------
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function dayKeyOf(d) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  }
  function hm(d) {
    return new Intl.DateTimeFormat('fr-FR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).format(d);
  }
  function hms(d) {
    return new Intl.DateTimeFormat('fr-FR', { timeZone: TZ, hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(d);
  }
  function toDate(iso) {
    const d = iso ? new Date(iso) : null;
    return d && !isNaN(d) ? d : null;
  }
  function eur(cents) {
    return ((Number(cents) || 0) / 100).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
  }
  function delayLabel(m) {
    return m === 60 ? '1 heure' : m + ' min';
  }
  function dateFR(dayKey) {
    const [y, m, d] = dayKey.split('-');
    return `${d}/${m}/${y}`;
  }
  function dateTimeFR(iso) {
    const d = toDate(iso);
    return d ? `${dateFR(dayKeyOf(d))} à ${hm(d)}` : '—';
  }
  function dayLabel(dayKey) {
    return `Recette du ${Number(dayKey.split('-')[2])} de ${SERVICE_START} à ${SERVICE_END}`;
  }
  // « aujourd'hui » / « demain » / « lun. 23 nov. » à l'heure de Paris.
  function scheduledDayLabel(d) {
    const key = dayKeyOf(d);
    if (key === dayKeyOf(new Date())) return "aujourd'hui";
    if (key === dayKeyOf(new Date(Date.now() + 86400000))) return 'demain';
    return new Intl.DateTimeFormat('fr-FR', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' }).format(d);
  }
  function scheduledLabel(o) {
    const d = toDate(o.scheduled_for);
    return d ? `${scheduledDayLabel(d)} à ${hm(d)}` : '';
  }
  // Une commande programmée n'entre dans la file active que lorsqu'il est temps de la préparer
  // (créneau choisi moins le délai de préparation par défaut) ; avant ça, elle reste en « Programmées ».
  function surfaced(o) {
    if (o.status !== 'new') return false;
    const sched = toDate(o.scheduled_for);
    if (!sched) return true;
    return sched.getTime() - Date.now() <= state.defaultDelay * 60000;
  }
  function norm(s) {
    return String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
  }
  // Les commandes sont identifiées par le nom du client, jamais par un numéro seul.
  function customerLabel(o) {
    return (o && o.customer_name ? String(o.customer_name).trim() : '') || 'Client sans nom';
  }
  function receivedLabel(o) {
    const d = toDate(o.created_at);
    if (!d) return '';
    return dayKeyOf(d) === dayKeyOf(new Date()) ? `Reçue à ${hm(d)}` : `Reçue le ${dateFR(dayKeyOf(d))} à ${hm(d)}`;
  }
  function addressLine(a) {
    if (!a) return '';
    return [a.street, a.city].filter(Boolean).join(', ');
  }
  function paymentLabel(o) {
    if (o.mode !== 'delivery') return 'Au retrait';
    const methods = (o.payment_methods || []).map(m => PAYMENT_LABEL[m] || m);
    let txt = methods.length ? methods.join(' + ') : 'Non précisé';
    if ((o.payment_methods || []).includes('cash') && o.cash_change_for != null) {
      txt += Number(o.cash_change_for) === 0 ? ' · appoint' : ` · billet de ${o.cash_change_for} €`;
    }
    return txt;
  }
  function findOrder(id) {
    return state.orders.find(o => String(o.id) === String(id)) || null;
  }
  function openOrders() {
    return state.orders.filter(o => surfaced(o));
  }
  // Programmées : acceptées nulle part encore, mais trop en avance pour entrer dans la file active.
  function scheduledOrders() {
    return state.orders
      .filter(o => o.status === 'new' && o.scheduled_for && !surfaced(o))
      .sort((a, b) => String(a.scheduled_for).localeCompare(String(b.scheduled_for)));
  }
  // Recette du jour : commandes acceptées, qu'elles soient encore en préparation ou déjà prêtes.
  function recapOrders() {
    return state.orders
      .filter(o => (o.status === 'accepted' || o.status === 'ready') && o.service_day === state.serviceDay)
      .sort((a, b) => String(a.accepted_at).localeCompare(String(b.accepted_at)));
  }
  // En préparation : acceptées du jour, pas encore marquées prêtes.
  function prepOrders() {
    return state.orders
      .filter(o => o.status === 'accepted' && o.service_day === state.serviceDay)
      .sort((a, b) => String(a.accepted_at).localeCompare(String(b.accepted_at)));
  }
  function ensureOpenSelection() {
    const cur = findOrder(state.selectedId);
    if (cur && cur.status === 'new') return;
    const first = openOrders()[0];
    state.selectedId = first ? first.id : null;
    state.editingId = null;
    state.draftDelay = null;
  }

  // ---------- Appels à l'API ----------
  class NetworkError extends Error {}
  class StaleError extends Error {}
  const FETCH_TIMEOUT_MS = 10000;
  let authGen = 0;

  async function api(path, opts = {}) {
    const gen = authGen;
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS) : null;
    const init = { method: opts.method || 'GET', credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' } };
    if (ctrl) init.signal = ctrl.signal;
    if (opts.body !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    let res;
    let data = null;
    try {
      res = await fetch(API + path, init);
      try { data = await res.json(); } catch (e) { data = null; }
    } catch (e) {
      if (!opts.noGen && gen !== authGen) throw new StaleError('stale');
      throw new NetworkError('network');
    } finally {
      clearTimeout(timer);
    }
    if (!opts.noGen && gen !== authGen) throw new StaleError('stale');
    const unauth = res.status === 401 || (res.status === 403 && !!data && data.error === 'forbidden');
    if (unauth && !opts.allow401) onUnauthorized();
    return { status: res.status, unauth, ok: res.ok && !!data && data.ok === true, data: data || {} };
  }

  // ---------- Connexion ----------
  function showBoot(on) {
    el.boot.hidden = !on;
  }
  function showLogin(message) {
    state.authed = false;
    showBoot(false);
    el.top.hidden = true;
    el.main.hidden = true;
    el.loginView.hidden = false;
    el.loginError.textContent = message || '';
    el.loginSubmit.disabled = false;
    el.loginPassword.value = '';
    setTimeout(() => el.loginPassword.focus(), 0);
  }
  function showApp() {
    showBoot(false);
    el.loginView.hidden = true;
    el.loginError.textContent = '';
    el.top.hidden = false;
    el.main.hidden = false;
  }

  function clearPrivateData() {
    authGen += 1;
    stopPolling();
    clearTimeout(toastTimer);
    el.toast.textContent = '';
    el.toast.hidden = true;
    el.live.textContent = '';
    closeNotifications();
    state.orders = [];
    state.ordersLoaded = false;
    state.sending.clear();
    state.selectedId = null;
    state.editingId = null;
    state.draftDelay = null;
    state.customers = [];
    state.customersState = 'idle';
    state.selectedClientId = null;
    state.clientQuery = '';
    state.sessions = [];
    state.sessionsState = 'idle';
    state.out = [];
    state.availLoaded = false;
    state.availBusy.clear();
    state.view = 'orders';
    state.patronTab = 'recap';
    setNetLost(false);
    closeDialog();
    lastHtml.clear();
    [el.queue, el.detail, el.decision, el.prodGrid, el.patronBody, el.catTabs].forEach(n => { n.innerHTML = ''; });
    document.getElementById('print-area').innerHTML = '';
    patronSig = '';
    syncAlarm();
  }

  function onUnauthorized() {
    if (!state.authed) return;
    clearPrivateData();
    showLogin('Votre session a expiré. Reconnectez-vous.');
  }

  async function boot() {
    showBoot(true);
    try {
      const r = await api('owner_me.php', { allow401: true, noGen: true });
      if (r.ok) { startApp(); return; }
      showLogin(r.unauth ? '' : 'Le serveur ne répond pas correctement. Réessayez dans un instant.');
    } catch (e) {
      showLogin('Connexion au serveur impossible. Vérifiez le réseau puis réessayez.');
    }
  }

  el.loginForm.addEventListener('submit', async e => {
    e.preventDefault();
    if (el.loginSubmit.disabled) return;
    const code = el.loginPassword.value;
    if (!code) {
      el.loginError.textContent = 'Saisissez votre code.';
      el.loginPassword.focus();
      return;
    }
    el.loginSubmit.disabled = true;
    el.loginSubmit.textContent = 'Connexion…';
    el.loginError.textContent = '';
    try {
      const r = await api('owner_login.php', { method: 'POST', body: { code, remember: el.loginRemember.checked }, allow401: true, noGen: true });
      el.loginPassword.value = '';
      if (r.ok) {
        startApp();
        return;
      }
      const err = r.data.error;
      if (err === 'invalid_credentials') {
        el.loginError.textContent = 'Code incorrect.';
      } else if (err === 'too_many_attempts') {
        const min = Math.max(1, Math.ceil((Number(r.data.retry_after_seconds) || 60) / 60));
        el.loginError.textContent = `Trop de tentatives. Réessayez dans ${min} minute${min > 1 ? 's' : ''}.`;
      } else {
        el.loginError.textContent = r.data.message || 'Connexion impossible pour le moment. Réessayez.';
      }
      el.loginPassword.focus();
    } catch (e2) {
      el.loginError.textContent = 'Connexion au serveur impossible. Vérifiez le réseau puis réessayez.';
    } finally {
      el.loginSubmit.disabled = false;
      el.loginSubmit.textContent = 'Se connecter';
    }
  });

  function startApp() {
    state.authed = true;
    showApp();
    renderAll();
    loadSettings();
    state.ordersLoaded = true;
    poll();
  }

  async function logout() {
    let r;
    try {
      r = await api('owner_logout.php', { method: 'POST', body: {}, allow401: true, noGen: true });
    } catch (e) {
      alertMsg('Déconnexion impossible : vérifiez la connexion puis réessayez.');
      return;
    }
    if (!r.ok && r.status !== 401) {
      alertMsg('Déconnexion impossible pour le moment. Vous êtes toujours connecté, réessayez.');
      return;
    }
    clearPrivateData();
    showLogin('Vous êtes déconnecté.');
  }

  // ---------- Son (généré par Web Audio, aucun fichier) ----------
  let audioCtx = null;
  let alarmTimer = null;

  function getCtx() {
    if (!audioCtx) {
      try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      } catch (e) {
        audioCtx = null;
      }
    }
    return audioCtx;
  }

  function unlockAudio() {
    const ctx = getCtx();
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
    if (ctx && ctx.state === 'running') {
      ['pointerdown', 'keydown', 'touchstart'].forEach(ev => document.removeEventListener(ev, unlockAudio, true));
    }
  }

  function playBeep() {
    const ctx = getCtx();
    if (!ctx) return;
    if (ctx.state === 'suspended') { ctx.resume().catch(() => {}); return; }
    try {
      const now = ctx.currentTime;
      [[880, 0], [1175, 0.22]].forEach(([freq, delay]) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, now + delay);
        gain.gain.exponentialRampToValueAtTime(0.35, now + delay + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + delay + 0.25);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + delay);
        osc.stop(now + delay + 0.3);
      });
    } catch (e) { /* audio indisponible : l'alerte visuelle reste */ }
  }

  // L'alerte sonne tant qu'une commande attend une décision, 30 secondes au plus sans nouvelle commande.
  const ALARM_MAX_MS = 30000;
  let alarmStartedAt = 0;
  let alarmExpired = false;
  function stopAlarm() {
    clearInterval(alarmTimer);
    alarmTimer = null;
  }
  function alarmTick() {
    if (Date.now() - alarmStartedAt >= ALARM_MAX_MS) {
      alarmExpired = true;
      stopAlarm();
      return;
    }
    playBeep();
  }
  function syncAlarm() {
    const pending = state.authed && state.orders.some(o => o.status === 'new');
    if (!pending) alarmExpired = false;
    const shouldRing = pending && state.soundOn && !alarmExpired;
    if (shouldRing && !alarmTimer) {
      alarmStartedAt = Date.now();
      playBeep();
      alarmTimer = setInterval(alarmTick, 1800);
    } else if (!shouldRing && alarmTimer) {
      stopAlarm();
    }
  }
  function rearmAlarm() {
    state.soundOn = true;
    alarmExpired = false;
    alarmStartedAt = Date.now();
    if (alarmTimer) playBeep();
    syncAlarm();
  }
  function toggleSound() {
    state.soundOn = !state.soundOn;
    if (state.soundOn) alarmExpired = false;
    syncAlarm();
    announce(state.soundOn ? 'Son réactivé' : 'Son coupé');
  }

  // ---------- Notifications (onglet caché, permission accordée par un clic) ----------
  let swReg = null;
  function notifSupported() {
    return 'Notification' in window;
  }
  function notifyNew(list) {
    if (!document.hidden || !notifSupported() || Notification.permission !== 'granted') return;
    const title = 'Nouvelle commande';
    const opts = { body: list.length > 1 ? `${list.length} nouvelles commandes en attente` : '1 nouvelle commande en attente', tag: 'subito-nouvelle-commande', renotify: true, icon: '../assets/img/icons/icon-192.png' };
    const fallback = () => { try { new Notification(title, opts); } catch (e) { /* non pris en charge */ } };
    if (swReg && typeof swReg.showNotification === 'function') swReg.showNotification(title, opts).catch(fallback);
    else fallback();
  }
  function closeNotifications() {
    if (swReg && typeof swReg.getNotifications === 'function') {
      swReg.getNotifications({ tag: 'subito-nouvelle-commande' }).then(ns => ns.forEach(n => n.close())).catch(() => {});
    }
  }
  function alertNew(list) {
    if (!list.length) return;
    rearmAlarm();
    const activated = !navigator.userActivation || navigator.userActivation.hasBeenActive;
    if (typeof navigator.vibrate === 'function' && activated) {
      try { navigator.vibrate([250, 120, 250]); } catch (e) { /* ignoré */ }
    }
    announce(list.length > 1
      ? `${list.length} nouvelles commandes : ${list.map(customerLabel).join(', ')}`
      : `Nouvelle commande de ${customerLabel(list[0])}`);
    notifyNew(list);
  }

  // ---------- Interrogation des commandes ----------
  let pollTimer = null;
  let pollInFlight = false;
  let pollFails = 0;
  let pollGen = 0;

  function stopPolling() {
    pollGen += 1;
    clearTimeout(pollTimer);
    pollTimer = null;
    pollFails = 0;
  }
  function schedulePoll(ms) {
    clearTimeout(pollTimer);
    pollTimer = setTimeout(poll, ms);
  }
  function setNetLost(on) {
    state.netLost = on;
    el.net.hidden = !on;
  }

  async function poll() {
    if (!state.authed || pollInFlight) return;
    pollInFlight = true;
    clearTimeout(pollTimer);
    const gen = pollGen;
    const seq = state.mutationSeq;
    let next = null;
    try {
      const r = await api('owner_orders.php');
      if (gen !== pollGen || r.unauth) return;
      if (!r.ok) throw new Error('http ' + r.status);
      if (seq !== state.mutationSeq) {
        next = 0;
      } else {
        applyOrders(r.data);
        pollFails = 0;
        setNetLost(false);
        next = document.hidden ? POLL_HIDDEN_MS : POLL_VISIBLE_MS;
      }
    } catch (e) {
      if (gen !== pollGen || e instanceof StaleError) return;
      pollFails += 1;
      setNetLost(true);
      next = Math.min(POLL_VISIBLE_MS * Math.pow(2, pollFails), POLL_MAX_MS);
      if (document.hidden) next = Math.max(next, POLL_HIDDEN_MS);
    } finally {
      pollInFlight = false;
    }
    if (next !== null && state.authed && gen === pollGen) schedulePoll(next);
  }

  function applyOrders(data) {
    const list = Array.isArray(data.orders) ? data.orders : [];
    const now = toDate(data.server_now);
    state.serviceDay = dayKeyOf(now || new Date());
    const prevIds = new Set(state.orders.map(o => String(o.id)));
    const freshlyNew = state.ordersLoaded
      ? list.filter(o => o.status === 'new' && !prevIds.has(String(o.id)))
      : [];
    // Une commande programmée loin dans le temps ne déclenche pas l'alerte sonore « à traiter maintenant ».
    const arrivals = freshlyNew.filter(o => surfaced(o));
    const scheduledArrivals = freshlyNew.filter(o => !surfaced(o));
    state.orders = list;
    state.ordersLoaded = true;
    ensureOpenSelection();
    syncAlarm();
    scheduleRender();
    alertNew(arrivals);
    if (scheduledArrivals.length) {
      toast(scheduledArrivals.length > 1
        ? `${scheduledArrivals.length} nouvelles commandes programmées.`
        : `Commande programmée pour ${scheduledLabel(scheduledArrivals[0])}.`);
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && state.authed) poll();
  });

  // ---------- Décision ----------
  function replaceOrder(order) {
    if (!order) return;
    const i = state.orders.findIndex(o => String(o.id) === String(order.id));
    if (i >= 0) state.orders[i] = order;
    else state.orders.push(order);
  }

  async function decide(id, action, delay) {
    const key = String(id);
    if (state.sending.has(key)) return;
    const o = findOrder(id);
    if (!o || o.status !== 'new') return;
    const name = customerLabel(o);
    state.sending.add(key);
    state.mutationSeq += 1;
    scheduleRender();
    const body = action === 'accept' ? { id: o.id, action, delay_minutes: delay } : { id: o.id, action };
    try {
      const r = await api('owner_order_decide.php', { method: 'POST', body });
      if (r.unauth) return;
      if (r.ok) {
        replaceOrder(r.data.order);
        closeNotifications();
        const done = r.data.order || {};
        if (action === 'accept' && done.status === 'accepted') autoPrintAccepted(done);
        toast(done.status === 'accepted'
          ? `Commande de ${name} acceptée · délai annoncé : ${delayLabel(done.delay_minutes)}`
          : `Commande de ${name} refusée`);
      } else if (r.data.error === 'already_decided') {
        const cur = findOrder(id);
        if (cur) {
          cur.status = r.data.status || cur.status;
          cur.delay_minutes = r.data.delay_minutes != null ? r.data.delay_minutes : cur.delay_minutes;
        }
        toast(r.data.status === 'accepted'
          ? `La commande de ${name} était déjà acceptée (délai ${delayLabel(r.data.delay_minutes)}).`
          : `La commande de ${name} était déjà refusée.`);
      } else if (r.data.error === 'not_found') {
        alertMsg(`La commande de ${name} est introuvable.`);
      } else {
        alertMsg(r.data.message || 'La décision n\'a pas pu être enregistrée. Réessayez.');
      }
    } catch (e) {
      if (e instanceof StaleError) return;
      alertMsg('Connexion impossible : la décision n\'a pas été envoyée. Réessayez.');
    } finally {
      state.sending.delete(key);
      state.mutationSeq += 1;
      ensureOpenSelection();
      syncAlarm();
      scheduleRender();
      if (state.authed) poll();
    }
  }

  // Marque une commande acceptée « prête » : le suivi du client l'affiche tout seul, sans qu'il recharge.
  async function markReady(id) {
    const key = String(id);
    if (state.sending.has(key)) return;
    const o = findOrder(id);
    if (!o || o.status !== 'accepted') return;
    const name = customerLabel(o);
    state.sending.add(key);
    state.mutationSeq += 1;
    scheduleRender();
    try {
      const r = await api('owner_order_decide.php', { method: 'POST', body: { id: o.id, action: 'ready' } });
      if (r.unauth) return;
      if (r.ok) {
        replaceOrder(r.data.order);
        closeDialog();
        toast(`Commande de ${name} prête · le client est prévenu`);
      } else if (r.data.error === 'already_decided') {
        const cur = findOrder(id);
        if (cur) cur.status = r.data.status || cur.status;
        closeDialog();
        toast(`La commande de ${name} n'est plus en préparation.`);
      } else if (r.data.error === 'not_found') {
        alertMsg(`La commande de ${name} est introuvable.`);
      } else {
        alertMsg(r.data.message || 'Le changement n\'a pas pu être enregistré. Réessayez.');
      }
    } catch (e) {
      if (e instanceof StaleError) return;
      alertMsg('Connexion impossible : le changement n\'a pas été envoyé. Réessayez.');
    } finally {
      state.sending.delete(key);
      state.mutationSeq += 1;
      scheduleRender();
      if (state.authed) poll();
    }
  }

  // ---------- Réglages ----------
  async function loadSettings() {
    try {
      const r = await api('owner_settings.php');
      if (r.ok && DELAYS.includes(Number(r.data.default_delay_minutes))) {
        state.defaultDelay = Number(r.data.default_delay_minutes);
      }
      if (r.ok && typeof r.data.store_open === 'boolean') {
        state.storeOpen = r.data.store_open;
      }
      scheduleRender();
    } catch (e) { /* les réglages restent à leur dernière valeur connue */ }
  }

  async function saveStoreOpen(open) {
    if (state.savingStoreOpen) return;
    const previous = state.storeOpen;
    state.savingStoreOpen = true;
    state.storeOpen = open; // optimiste : le commerçant doit voir l'effet tout de suite
    scheduleRender();
    try {
      const r = await api('owner_settings.php', { method: 'POST', body: { store_open: open } });
      if (r.unauth) return;
      if (r.ok) {
        state.storeOpen = r.data.store_open;
        toast(state.storeOpen ? 'Prise de commandes ouverte.' : 'Prise de commandes fermée : les clients ne peuvent plus commander.');
      } else {
        state.storeOpen = previous;
        toast(r.data.message || 'Le réglage n\'a pas pu être enregistré.');
      }
    } catch (e) {
      if (e instanceof StaleError) return;
      state.storeOpen = previous;
      toast('Connexion impossible : le réglage n\'a pas été enregistré.');
    } finally {
      state.savingStoreOpen = false;
      scheduleRender();
    }
  }

  async function saveDefaultDelay(min) {
    if (state.savingDefault) return;
    state.savingDefault = true;
    refreshDefaultDialog();
    try {
      const r = await api('owner_settings.php', { method: 'POST', body: { default_delay_minutes: min } });
      if (r.unauth) return;
      if (r.ok) {
        state.defaultDelay = Number(r.data.default_delay_minutes) || min;
        closeDialog();
        toast(`Délai par défaut : ${delayLabel(state.defaultDelay)}`);
      } else {
        toast(r.data.message || 'Le délai par défaut n\'a pas pu être enregistré.');
      }
    } catch (e) {
      if (e instanceof StaleError) return;
      toast('Connexion impossible : le délai par défaut n\'a pas été enregistré.');
    } finally {
      state.savingDefault = false;
      refreshDefaultDialog();
      scheduleRender();
    }
  }

  // ---------- Rendu : commandes ----------
  function renderClock() {
    el.clock.textContent = hms(new Date());
  }

  function renderViews() {
    ['orders', 'avail', 'patron'].forEach(v => {
      document.getElementById('view-' + v).hidden = state.view !== v;
    });
    document.querySelectorAll('[data-action="view"]').forEach(b => {
      b.setAttribute('aria-pressed', b.dataset.view === state.view ? 'true' : 'false');
    });
  }

  function statusPill(status) {
    const map = {
      new: ['pill-new', 'Nouvelle'],
      accepted: ['pill-accepted', 'Acceptée'],
      ready: ['pill-ready', 'Prête'],
      refused: ['pill-refused', 'Refusée']
    };
    const [cls, label] = map[status] || ['pill-refused', String(status)];
    return `<span class="pill ${cls}">${esc(label)}</span>`;
  }

  function rankOf(o) {
    const i = openOrders().indexOf(o);
    return i >= 0 ? i + 1 : null;
  }

  function renderQueue() {
    let html;
    if (!state.ordersLoaded) {
      html = `<p class="queue-empty">Chargement des commandes…</p>`;
    } else {
      html = openOrders().map((o, i) => {
        const on = String(o.id) === String(state.selectedId) ? 'is-on' : '';
        const d = toDate(o.created_at);
        return `
        <button type="button" class="qchip is-new ${on}" data-action="select" data-id="${esc(o.id)}"
          aria-label="Commande ${i + 1} de la file, ${esc(customerLabel(o))}, ${esc(eur(o.total_cents))}">
          <span class="qchip-title">${esc(customerLabel(o))}</span>
          <span class="qchip-sub">${d ? esc(hm(d)) + ' · ' : ''}${esc(eur(o.total_cents))}</span>
        </button>`;
      }).join('') || `<p class="queue-empty">Aucune commande en attente.</p>`;
    }
    setHTML(el.queue, html);
  }

  // « En préparation » : commandes acceptées, à marquer prêtes (le suivi du client se met à jour tout seul).
  function renderPrep() {
    const strip = document.getElementById('prep-strip');
    const box = document.getElementById('prep-queue');
    if (!strip || !box) return;
    const list = prepOrders();
    strip.hidden = list.length === 0;
    setHTML(box, list.map(o => {
      const ready = toDate(o.ready_at);
      return `
        <button type="button" class="qchip is-prep" data-action="prep-open" data-id="${esc(o.id)}"
          aria-label="Commande de ${esc(customerLabel(o))}, en préparation, ${esc(eur(o.total_cents))}. Ouvrir pour la marquer prête">
          <span class="qchip-title">${esc(customerLabel(o))}</span>
          <span class="qchip-sub">${ready ? 'Prête vers ' + esc(hm(ready)) + ' · ' : ''}${esc(eur(o.total_cents))}</span>
        </button>`;
    }).join(''));
  }

  // « Programmées » : commandes planifiées par le client, pas encore entrées dans la file active.
  function renderScheduled() {
    const strip = document.getElementById('scheduled-strip');
    const box = document.getElementById('scheduled-queue');
    if (!strip || !box) return;
    const list = scheduledOrders();
    strip.hidden = list.length === 0;
    setHTML(box, list.map(o => `
        <button type="button" class="qchip is-scheduled" data-action="select" data-id="${esc(o.id)}"
          aria-label="Commande de ${esc(customerLabel(o))}, programmée pour ${esc(scheduledLabel(o))}, ${esc(eur(o.total_cents))}">
          <span class="qchip-title">${esc(customerLabel(o))}</span>
          <span class="qchip-sub">${esc(scheduledLabel(o))} · ${esc(eur(o.total_cents))}</span>
        </button>`).join(''));
  }

  function itemTitle(it) {
    return it.variant ? `${it.name} · ${it.variant}` : String(it.name || '');
  }
  function itemMods(it) {
    const mods = [];
    if (it.half && (it.half.flavor1 || it.half.flavor2)) {
      mods.push({ cls: 'mod-half', text: `Moitié ${it.half.flavor1 || '?'} / moitié ${it.half.flavor2 || '?'}` });
    }
    (it.removed || []).forEach(r => mods.push({ cls: 'mod-minus', text: `− ${r}` }));
    (it.extras || []).forEach(x => {
      const qty = Number(x.qty) || 1;
      const price = Number(x.price_cents) || 0;
      mods.push({ cls: 'mod-plus', text: `+ ${qty > 1 ? qty + '× ' : ''}${x.name}${price ? ` (${eur(price)}${qty > 1 ? ' pièce' : ''})` : ''}` });
    });
    if (it.note && String(it.note).trim()) mods.push({ cls: 'item-note', text: `Remarque : ${String(it.note).trim()}` });
    return mods;
  }

  function showDecision(on) {
    const col = el.decision.closest('.decide-col');
    if (col) col.hidden = !on;
    const stage = el.decision.closest('.orders-stage');
    if (stage) stage.classList.toggle('no-decision', !on);
  }

  function renderDetail() {
    const o = findOrder(state.selectedId);
    if (!o) {
      setHTML(el.detail, `
        <div class="empty">
          <div class="empty-mark" aria-hidden="true">●</div>
          <p>En attente de commande</p>
          <small>Les nouvelles commandes apparaissent ici, avec une alerte sonore.</small>
        </div>`);
      setHTML(el.decision, '');
      showDecision(false);
      return;
    }

    const itemsHtml = (o.items || []).map(it => `
      <li>
        <span class="qty">${esc(it.qty)}×</span>
        <span class="item-name">${esc(itemTitle(it))}${itemMods(it).map(m => `<small class="${m.cls}">${esc(m.text)}</small>`).join('')}</span>
        <span class="lp">${esc(eur(it.line_total_cents))}</span>
      </li>`).join('');

    const delivery = o.mode === 'delivery';
    const phone = o.customer_phone ? `<span>${esc(o.customer_phone)}</span>` : '';
    const addr = delivery ? `<span>${esc(addressLine(o.delivery_address) || 'Adresse non renseignée')}</span>` : '';
    const promo = Number(o.promo_cents) > 0 ? `<div class="od-sub"><span>Promotion</span><span>− ${esc(eur(o.promo_cents))}</span></div>` : '';
    const fee = Number(o.delivery_fee_cents) > 0 ? `<div class="od-sub"><span>Frais de livraison</span><span>${esc(eur(o.delivery_fee_cents))}</span></div>` : '';
    const rank = rankOf(o);

    setHTML(el.detail, `
      <div class="od-head">
        <div>
          <p class="eyebrow">${rank ? 'Commande ' + rank + ' de la file' : ''}</p>
          ${o.scheduled_for ? `<p class="eyebrow eyebrow-scheduled">Programmée pour ${esc(scheduledLabel(o))}</p>` : ''}
          <h3 class="od-num">${esc(customerLabel(o))}</h3>
          <p class="od-time">${esc(receivedLabel(o))}</p>
        </div>
        ${statusPill(o.status)}
      </div>

      <p class="pickup"><span aria-hidden="true">${delivery ? '➜' : '⌂'}</span> ${delivery ? 'Livraison' : 'À emporter · retrait au commerce'}</p>

      <div class="od-grid">
        <div class="od-block">
          <h4>Client</h4>
          <div class="od-client"><strong>${esc(customerLabel(o))}</strong>${phone}${addr}</div>
        </div>
        <div class="od-block">
          <h4>Paiement</h4>
          <p class="od-pay">${esc(paymentLabel(o))}</p>
        </div>
      </div>

      <div class="od-block od-items">
        <h4>Articles</h4>
        <ul class="items">${itemsHtml}</ul>
      </div>

      ${promo}${fee}
      <div class="od-total"><span>Total</span><strong>${esc(eur(o.total_cents))}</strong></div>
    `);

    const decisionHtml = renderDecision(o);
    setHTML(el.decision, decisionHtml);
    showDecision(!!decisionHtml);
  }

  // « Accepter » ouvre le choix du délai (présélection : délai par défaut), « Confirmer » envoie.
  function renderDecision(o) {
    if (o.status !== 'new') return '';
    const busy = state.sending.has(String(o.id));
    const dis = busy ? 'disabled' : '';
    const choosing = state.editingId === o.id;
    if (!choosing) {
      return `
        <p class="ask">Délai par défaut</p>
        <div class="dec-delay">
          <span class="dd-num">${state.defaultDelay === 60 ? '1 h' : state.defaultDelay + ' min'}</span>
          <span class="dd-sub">Le délai se choisit à l'étape suivante.</span>
        </div>
        <button type="button" class="btn btn-accept btn-xl dec-main" data-action="accept" data-id="${esc(o.id)}" ${dis}>${busy ? 'Envoi…' : 'Accepter'}</button>
        <button type="button" class="btn btn-refuse btn-xl" data-action="refuse" data-id="${esc(o.id)}" ${dis}>Refuser</button>`;
    }
    const m = state.draftDelay || state.defaultDelay;
    const tiles = DELAYS.map(v => `
      <button type="button" class="dl-tile ${m === v ? 'is-on' : ''}" aria-pressed="${m === v}"
        data-action="delay" data-min="${v}" ${dis}>
        <span class="dl-num">${v === 60 ? '1' : v}</span><span class="dl-unit">${v === 60 ? 'h' : 'min'}</span>
      </button>`).join('');
    return `
      <p class="ask" id="delay-ask">Délai annoncé au client</p>
      <div class="dl-grid" role="group" aria-labelledby="delay-ask">${tiles}</div>
      <button type="button" class="btn btn-accept btn-xl dec-main" data-action="accept-confirm" data-id="${esc(o.id)}" ${dis}>${busy ? 'Envoi…' : 'Confirmer · ' + (m === 60 ? '1 h' : m + ' min')}</button>
      <button type="button" class="btn btn-ghost" data-action="edit-cancel" ${dis}>Annuler</button>`;
  }

  function renderNotifSlot() {
    let html = '';
    if (notifSupported()) {
      if (Notification.permission === 'default') {
        html = `<button type="button" class="btn btn-soft btn-sm" data-action="notif-enable">Activer les notifications</button>`;
      } else if (Notification.permission === 'granted') {
        html = `<span class="notif-on">Notifications activées</span>`;
      }
    }
    setHTML(el.notifSlot, html);
  }

  // ---------- Disponibilité (états lus sur le serveur) ----------
  function outEntry(kind, name) {
    const n = norm(name);
    const today = dayKeyOf(new Date());
    return state.out.find(x => x.kind === kind && norm(x.name) === n
      && (x.status === 'out_manual' || (x.status === 'out_today' && (!x.service_day || x.service_day === today)))) || null;
  }
  function ingOut(key) {
    return !!outEntry('ingredient', key);
  }
  function groupBlocked(g) {
    return g.split('|').every(ingOut);
  }
  function groupLabel(g) {
    return g.split('|').map(m => m.charAt(0).toUpperCase() + m.slice(1)).join(' ou ');
  }
  function productState(p) {
    const blockers = p.ing.filter(groupBlocked);
    if (blockers.length) return { out: true, by: 'ingredient', blockers };
    const s = outEntry(p.kind, p.name);
    if (s) return { out: true, by: 'manual', until: s.status === 'out_today' ? 'today' : 'manual' };
    return { out: false };
  }
  function busyKey(kind, name) {
    return kind + '|' + name;
  }

  async function loadAvailability() {
    try {
      const r = await api('owner_availability.php');
      if (r.unauth) return;
      if (!r.ok) throw new Error('http');
      state.out = Array.isArray(r.data.out) ? r.data.out : [];
      state.availLoaded = true;
      state.availError = false;
    } catch (e) {
      if (e instanceof StaleError) return;
      state.availError = true;
    }
    scheduleRender();
  }

  async function setAvailability(kind, name, status) {
    const key = busyKey(kind, name);
    if (state.availBusy.has(key)) return false;
    state.availBusy.add(key);
    scheduleRender();
    let ok = false;
    try {
      const r = await api('owner_availability.php', { method: 'POST', body: { kind, name, status } });
      if (r.unauth) return false;
      ok = r.ok;
      if (!ok) toast(r.data.message || `« ${name} » n'a pas pu être mis à jour.`);
    } catch (e) {
      if (e instanceof StaleError) return false;
      toast(`Connexion impossible : « ${name} » n'a pas été mis à jour.`);
    } finally {
      state.availBusy.delete(key);
    }
    return ok;
  }

  async function changeAvailability(kind, name, status) {
    const gen = authGen;
    await setAvailability(kind, name, status);
    if (state.authed && gen === authGen) await loadAvailability();
  }

  let allInRunning = false;
  async function allBackIn() {
    if (allInRunning) return;
    const targets = state.catKey === 'ingredients'
      ? INGREDIENTS.filter(i => ingOut(i.key)).map(i => ['ingredient', i.key])
      : PRODUCTS.filter(p => p.cat === state.catKey && outEntry(p.kind, p.name)).map(p => [p.kind, p.name]);
    if (!targets.length) { toast('Tout est déjà disponible dans cette catégorie.'); return; }
    const gen = authGen;
    allInRunning = true;
    scheduleRender();
    for (const [kind, name] of targets) {
      if (!state.authed || gen !== authGen) break;
      await setAvailability(kind, name, 'available');
    }
    allInRunning = false;
    if (state.authed && gen === authGen) await loadAvailability();
  }

  function renderAvail() {
    const ingTab = `<button type="button" class="cat-tab" data-action="cat" data-cat="ingredients" aria-pressed="${state.catKey === 'ingredients'}">Ingrédients</button>`;
    setHTML(el.catTabs, MENU.map(c => `
      <button type="button" class="cat-tab" data-action="cat" data-cat="${c.key}" aria-pressed="${c.key === state.catKey}">${esc(c.label)}</button>`).join('') + ingTab);
    const cat = MENU.find(c => c.key === state.catKey);
    el.catTitle.textContent = cat ? cat.label : 'Ingrédients';
    if (!state.availLoaded) {
      el.availMsg.innerHTML = state.availError
        ? `Impossible de lire les disponibilités. <button type="button" class="btn btn-soft btn-sm" data-action="avail-retry">Réessayer</button>`
        : 'Chargement des disponibilités…';
      el.allIn.disabled = true;
      setHTML(el.prodGrid, '');
      return;
    }
    el.allIn.disabled = allInRunning;
    el.availMsg.innerHTML = state.availError
      ? `La dernière mise à jour a échoué : l'affichage peut être en retard. <button type="button" class="btn btn-soft btn-sm" data-action="avail-retry">Réessayer</button>`
      : '';
    if (!cat) { renderIngredients(); return; }
    setHTML(el.prodGrid, PRODUCTS.filter(p => p.cat === cat.key).map(p => {
      const st = productState(p);
      const locked = st.by === 'ingredient';
      const busy = state.availBusy.has(busyKey(p.kind, p.name));
      const stateTxt = st.by === 'ingredient'
        ? `Indisponible : ${st.blockers.map(groupLabel).join(', ')}`
        : st.until === 'today' ? 'Rupture aujourd\'hui · jusqu\'à la fin du service'
        : 'Rupture jusqu\'à réactivation';
      return `
      <div class="prod ${st.out ? 'is-out' : 'is-in'}">
        <div class="prod-name">${esc(p.name)}</div>
        <button type="button" class="switch ${st.out ? 'is-off' : 'is-on'}" role="switch" aria-checked="${!st.out}"
          data-action="toggle" data-id="${p.id}" ${locked || busy ? 'disabled' : ''} aria-label="${esc(p.name)} : ${st.out ? 'indisponible' : 'disponible'}">
          <span class="switch-track" aria-hidden="true"><span class="switch-knob"></span></span>
          <span class="switch-text">${st.out ? 'Indisponible' : 'Disponible'}</span>
        </button>
        ${st.out ? `<div class="prod-state">${esc(stateTxt)}</div>` : ''}
        ${st.by === 'manual' ? `<div class="prod-until" role="group" aria-label="Durée de la rupture de ${esc(p.name)}">
            <button type="button" data-action="until" data-id="${p.id}" data-mode="out_today" aria-pressed="${st.until === 'today'}" ${busy ? 'disabled' : ''}>Aujourd'hui seulement</button>
            <button type="button" data-action="until" data-id="${p.id}" data-mode="out_manual" aria-pressed="${st.until === 'manual'}" ${busy ? 'disabled' : ''}>Jusqu'à réactivation</button>
          </div>` : ''}
      </div>`;
    }).join(''));
  }

  function renderIngredients() {
    setHTML(el.prodGrid, INGREDIENTS.map(ing => {
      const out = ingOut(ing.key);
      const busy = state.availBusy.has(busyKey('ingredient', ing.key));
      const removed = PRODUCTS.filter(p => {
        const st = productState(p);
        return st.by === 'ingredient' && st.blockers.some(g => g.split('|').includes(ing.key));
      }).map(p => p.name);
      return `
      <div class="prod ${out ? 'is-out' : 'is-in'}">
        <div class="prod-name">${esc(ing.label)}</div>
        <button type="button" class="switch ${out ? 'is-off' : 'is-on'}" role="switch" aria-checked="${!out}"
          data-action="ing-toggle" data-key="${esc(ing.key)}" ${busy ? 'disabled' : ''} aria-label="${esc(ing.label)} : ${out ? 'indisponible' : 'disponible'}">
          <span class="switch-track" aria-hidden="true"><span class="switch-knob"></span></span>
          <span class="switch-text">${out ? 'Indisponible' : 'Disponible'}</span>
        </button>
        ${out ? `<div class="prod-state">${removed.length ? 'Retire : ' + esc(removed.join(', ')) : 'Aucun produit retiré'}</div>` : ''}
      </div>`;
    }).join(''));
  }

  // ---------- Espace patron ----------
  let patronSig = '';

  function patronTabs() {
    const tab = (k, label) => `<button type="button" class="sub-tab" data-action="patron-tab" data-tab="${k}" aria-pressed="${state.patronTab === k}">${label}</button>`;
    return `
      <nav class="sub-tabs" aria-label="Espace patron">
        ${tab('recap', 'Recette du jour')}${tab('clients', 'Clients')}${tab('devices', 'Appareils connectés')}
      </nav>`;
  }

  function recapShell() {
    return `
      <div class="recap-layout">
        <div class="recap-card">
          <div class="col-head">
            <h2>Recette du jour</h2>
            <p class="muted">Commandes acceptées du jour de service.</p>
          </div>
          <ul class="recap-list" id="recap-list"></ul>
        </div>
        <aside class="recap-summary">
          <p class="eyebrow-light">Total de la recette</p>
          <strong class="recap-total-amount" id="recap-total">0,00 €</strong>
          <p class="recap-note">Les commandes refusées ne sont pas comptées.</p>
          <div class="recap-actions">
            <button type="button" class="btn btn-light" data-action="copy-recap">Copier la recette</button>
            <button type="button" class="btn btn-light" data-action="print-recap">Imprimer la recette</button>
          </div>
        </aside>
      </div>`;
  }

  function clientsShell() {
    return `
      <div class="clients-layout">
        <div class="clients-card">
          <div class="col-head"><h2>Clients</h2></div>
          <label class="search-field">
            <span class="sr-only">Rechercher un client</span>
            <input type="search" id="client-search" placeholder="Nom, prénom, téléphone ou e-mail" autocomplete="off" maxlength="80" value="${esc(state.clientQuery)}">
          </label>
          <p class="muted client-status" id="client-status" role="status"></p>
          <ul class="client-list" id="client-list" aria-label="Liste des clients"></ul>
        </div>
        <section class="client-detail" id="client-detail" aria-live="polite" aria-label="Fiche client"></section>
      </div>`;
  }

  function devicesShell() {
    return `
      <div class="devices-card">
        <div class="col-head">
          <h2>Appareils connectés</h2>
        </div>
        <ul class="device-list" id="device-list"></ul>
        <div class="device-actions">
          <button type="button" class="btn btn-ghost" data-action="revoke-others">Déconnecter les autres appareils</button>
          <button type="button" class="btn btn-refuse" data-action="revoke-all">Déconnecter tous les appareils</button>
        </div>
      </div>`;
  }

  function renderPatron() {
    const sig = state.patronTab;
    if (sig !== patronSig) {
      patronSig = sig;
      const body = sig === 'clients' ? clientsShell() : sig === 'devices' ? devicesShell() : recapShell();
      setHTML(el.patronBody, patronTabs() + body);
    }
    if (state.patronTab === 'recap') fillRecap();
    if (state.patronTab === 'clients') fillClients();
    if (state.patronTab === 'devices') fillDevices();
  }

  function fillRecap() {
    const list = document.getElementById('recap-list');
    const total = document.getElementById('recap-total');
    if (!list || !total) return;
    const accepted = recapOrders();
    setHTML(list, accepted.length ? `
      <li class="recipe-day"><h3>${esc(dayLabel(state.serviceDay))}</h3></li>
      ${accepted.map(o => `
      <li>
        <button type="button" class="rcard" data-action="print-order" data-id="${esc(o.id)}" aria-label="Ticket de ${esc(customerLabel(o))}">
          <span class="rc-num">${esc(customerLabel(o))}</span>
          <span class="rc-info">
            <span>Acceptée à ${esc(toDate(o.accepted_at) ? hm(toDate(o.accepted_at)) : '—')}${o.status === 'ready' ? ' · Prête' : ''}</span>
            <span class="rc-delay">Délai ${esc(delayLabel(o.delay_minutes))}</span>
          </span>
          <span class="rc-amt">${esc(eur(o.total_cents))}</span>
        </button>
      </li>`).join('')}`
      : `<li class="recap-empty">${state.ordersLoaded ? 'Aucune commande acceptée pour le moment.' : 'Chargement…'}</li>`);
    total.textContent = eur(accepted.reduce((s, o) => s + (Number(o.total_cents) || 0), 0));
  }

  // Clients : recherche côté serveur, saisie avec un léger délai.
  let clientTimer = null;
  let clientReq = 0;
  async function loadCustomers() {
    const req = ++clientReq;
    state.customersState = 'loading';
    fillClients();
    try {
      const q = state.clientQuery.trim().slice(0, 80);
      const r = await api('owner_customers.php', { method: 'POST', body: { q } });
      if (req !== clientReq || r.unauth) return;
      if (!r.ok) throw new Error('http');
      state.customers = Array.isArray(r.data.customers) ? r.data.customers : [];
      state.customersState = 'ok';
      if (!state.customers.some(c => String(c.id) === String(state.selectedClientId))) state.selectedClientId = null;
    } catch (e) {
      if (req !== clientReq || e instanceof StaleError) return;
      state.customersState = 'error';
    }
    fillClients();
  }

  function fillClients() {
    const list = document.getElementById('client-list');
    const status = document.getElementById('client-status');
    const detail = document.getElementById('client-detail');
    if (!list || !status || !detail) return;
    const n = state.customers.length;
    status.innerHTML = state.customersState === 'loading' ? 'Recherche…'
      : state.customersState === 'error' ? 'Impossible de charger les clients. <button type="button" class="btn btn-soft btn-sm" data-action="clients-retry">Réessayer</button>'
      : state.customersState === 'ok' ? `${n} client${n > 1 ? 's' : ''}${n >= 500 ? ' (500 au plus, précisez la recherche)' : ''}` : '';
    setHTML(list, state.customers.map(c => {
      const name = `${c.last_name || ''} ${c.first_name || ''}`.trim() || 'Sans nom';
      const on = String(c.id) === String(state.selectedClientId);
      return `<li><button type="button" class="cl-btn" data-action="client" data-id="${esc(c.id)}" aria-pressed="${on}">
        <span>${esc(name)}</span><span class="cl-sub">${esc(c.phone || '')}</span></button></li>`;
    }).join('') || (state.customersState === 'ok' ? `<li class="client-empty">Aucun client ne correspond à cette recherche.</li>` : ''));
    const c = state.customers.find(x => String(x.id) === String(state.selectedClientId));
    const row = (label, value) => `<div><dt>${label}</dt><dd>${value ? esc(value) : '<span class="muted">—</span>'}</dd></div>`;
    setHTML(detail, c ? `
      <p class="eyebrow">Fiche client</p>
      <h3 class="cd-name">${esc(`${c.first_name || ''} ${c.last_name || ''}`.trim())}</h3>
      <dl class="cd-list">
        ${row('Prénom', c.first_name)}
        ${row('Nom', c.last_name)}
        ${row('Téléphone', c.phone)}
        ${row('E-mail', c.email)}
        ${row('Adresse', [c.street, c.city].filter(Boolean).join(', '))}
        ${row('Inscription', toDate(c.created_at) ? dateFR(dayKeyOf(toDate(c.created_at))) : '')}
        ${row('Dernière commande', c.last_order_at ? dateTimeFR(c.last_order_at) : 'Aucune commande')}
      </dl>`
      : `<div class="empty"><p>Fiche client</p><small>Touchez un client de la liste pour afficher sa fiche.</small></div>`);
  }

  // Appareils connectés.
  async function loadSessions() {
    state.sessionsState = 'loading';
    fillDevices();
    try {
      const r = await api('owner_sessions.php');
      if (r.unauth) return;
      if (!r.ok) throw new Error('http');
      state.sessions = Array.isArray(r.data.sessions) ? r.data.sessions : [];
      state.sessionsState = 'ok';
    } catch (e) {
      if (e instanceof StaleError) return;
      state.sessionsState = 'error';
    }
    fillDevices();
  }

  function fillDevices() {
    const list = document.getElementById('device-list');
    if (!list) return;
    if (state.sessionsState === 'loading' && !state.sessions.length) { setHTML(list, `<li class="client-empty">Chargement…</li>`); return; }
    if (state.sessionsState === 'error') {
      setHTML(list, `<li class="client-empty">Impossible de charger les appareils. <button type="button" class="btn btn-soft btn-sm" data-action="devices-retry">Réessayer</button></li>`);
      return;
    }
    setHTML(list, state.sessions.map(s => `
      <li class="device ${s.current ? 'is-current' : ''}">
        <div class="device-name">${esc(s.device || 'Appareil inconnu')}${s.current ? ' <span class="device-tag">Cet appareil</span>' : ''}</div>
        <div class="device-sub">Dernière activité : ${esc(dateTimeFR(s.last_seen_at))}</div>
        <div class="device-sub">Connecté le ${esc(dateTimeFR(s.created_at))}${s.remember ? ' · reste connecté' : ''}</div>
      </li>`).join('') || `<li class="client-empty">Aucun appareil connecté.</li>`);
  }

  async function revokeSessions(scope) {
    try {
      const r = await api('owner_sessions_revoke.php', { method: 'POST', body: { scope } });
      if (r.unauth) return;
      if (!r.ok) { toast(r.data.message || 'La déconnexion des appareils a échoué.'); return; }
      if (scope === 'all' || r.data.logged_out) {
        clearPrivateData();
        showLogin('Tous les appareils ont été déconnectés.');
        return;
      }
      const n = Number(r.data.revoked) || 0;
      toast(n ? `${n} autre${n > 1 ? 's' : ''} appareil${n > 1 ? 's' : ''} déconnecté${n > 1 ? 's' : ''}` : 'Aucun autre appareil n\'était connecté');
      loadSessions();
    } catch (e) {
      if (e instanceof StaleError) return;
      toast('Connexion impossible : aucun appareil n\'a été déconnecté.');
    }
  }

  // ---------- Copie ----------
  function legacyCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    ta.remove();
    return ok;
  }
  function copyText(text, doneMsg) {
    const done = () => toast(doneMsg);
    const fail = () => toast(legacyCopy(text) ? doneMsg : 'Copie impossible sur ce navigateur');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, fail);
    } else {
      fail();
    }
  }

  function recapPlainText() {
    const accepted = recapOrders();
    const lines = accepted.map(o => {
      const at = toDate(o.accepted_at);
      return `${customerLabel(o)}  ${at ? hm(at) : '—'}  délai ${delayLabel(o.delay_minutes)}  ${eur(o.total_cents)}`;
    });
    const sum = accepted.reduce((s, o) => s + (Number(o.total_cents) || 0), 0);
    return [dayLabel(state.serviceDay),
      ...(lines.length ? lines : ['Aucune commande acceptée.']),
      `TOTAL ${eur(sum)}`].join('\n');
  }

  // ---------- Rendu global ----------
  function renderAll() {
    if (!state.authed) return;
    renderViews();
    const dd = document.getElementById('default-delay-btn');
    if (dd) dd.textContent = 'Délai par défaut · ' + delayLabel(state.defaultDelay);
    const sb = document.getElementById('sound-btn');
    if (sb) sb.textContent = state.soundOn ? 'Couper le son' : 'Réactiver le son';
    const ob = document.getElementById('store-open-btn');
    if (ob) {
      ob.textContent = state.storeOpen ? 'Ouvert' : 'Fermé';
      ob.classList.toggle('is-open', state.storeOpen);
      ob.classList.toggle('is-closed', !state.storeOpen);
      ob.disabled = state.savingStoreOpen;
      ob.setAttribute('aria-pressed', String(!state.storeOpen));
    }
    renderNotifSlot();
    renderQueue();
    renderScheduled();
    renderPrep();
    renderDetail();
    if (state.view === 'avail') renderAvail();
    if (state.view === 'patron') renderPatron();
    syncAlarm();
  }

  let renderPending = false;
  function scheduleRender() {
    if (renderPending) return;
    renderPending = true;
    let done = false;
    const run = () => {
      if (done) return;
      done = true;
      renderPending = false;
      try {
        renderAll();
      } catch (err) {
        console.error('Rendu commerçant :', err);
      }
    };
    requestAnimationFrame(run);
    setTimeout(run, 50);
  }

  // ---------- Dialogues ----------
  function openDialog(html) {
    el.dlgBody.innerHTML = html;
    const title = el.dlgBody.querySelector('h3');
    if (title) title.id = 'dlg-title';
    if (!el.dlg.open) {
      if (typeof el.dlg.showModal === 'function') el.dlg.showModal();
      else el.dlg.setAttribute('open', '');
    }
    const first = el.dlgBody.querySelector('button:not(:disabled)');
    if (first) first.focus();
  }
  function closeDialog() {
    if (el.dlg.open) {
      if (typeof el.dlg.close === 'function') el.dlg.close();
      else el.dlg.removeAttribute('open');
    }
    el.dlgBody.innerHTML = '';
  }

  // Ticket de commande : mode (avec l'adresse en livraison), client, téléphone, heure, articles, total, délai.
  function ticketHtml(o) {
    const delivery = o.mode === 'delivery';
    const received = toDate(o.created_at);
    const ready = toDate(o.ready_at);
    const items = (o.items || []).map(it => `
      <div class="t-line t-item"><span>${esc(it.qty)}× ${esc(itemTitle(it))}</span><span>${esc(eur(it.line_total_cents))}</span></div>
      ${itemMods(it).map(m => `<div class="t-mod">${esc(m.text)}</div>`).join('')}`).join('');
    return `
      <div class="ticket">
        <div class="t-mode-box">
          <p class="t-mode">${delivery ? 'LIVRAISON' : 'EMPORTER'}</p>
          ${delivery ? `<p class="t-address">${esc(addressLine(o.delivery_address))}</p>` : ''}
        </div>
        <div class="t-line t-big"><span>Client</span><span>${esc(customerLabel(o))}</span></div>
        <div class="t-line t-big"><span>Téléphone</span><span>${esc(o.customer_phone || '')}</span></div>
        <div class="t-line t-big"><span>Entrée</span><span>${received ? esc(hm(received)) : '—'}</span></div>
        <div class="t-rule"></div>
        ${items}
        <div class="t-rule t-bottom"></div>
        ${Number(o.delivery_fee_cents) > 0 ? `<div class="t-line"><span>Frais de livraison</span><span>${esc(eur(o.delivery_fee_cents))}</span></div>` : ''}
        <div class="t-line"><strong>TOTAL</strong><strong>${esc(eur(o.total_cents))}</strong></div>
        ${o.delay_minutes ? `<div class="t-line"><span>Délai annoncé</span><span>${esc(delayLabel(o.delay_minutes))}</span></div>` : ''}
        ${ready ? `<div class="t-line"><span>Prête vers</span><span>${esc(hm(ready))}</span></div>` : ''}
        ${o.status === 'ready' ? `<div class="t-line"><span>État</span><span>Prête</span></div>` : ''}
      </div>`;
  }

  // Transforme une commande en texte structuré pour l'impression automatique (app Android + imprimante Bluetooth).
  function printerPayload(o) {
    const delivery = o.mode === 'delivery';
    const received = toDate(o.created_at);
    const items = (o.items || []).map(it => ({
      qty: Number(it.qty) || 1,
      title: itemTitle(it),
      lineTotal: eur(it.line_total_cents),
      mods: itemMods(it).map(m => m.text)
    }));
    return {
      shop: 'SUBITO PIZZA',
      mode: delivery ? 'LIVRAISON' : 'A EMPORTER',
      address: delivery ? addressLine(o.delivery_address) : null,
      customer: customerLabel(o),
      phone: o.customer_phone || '',
      receivedAt: received ? hm(received) : '',
      items,
      deliveryFee: Number(o.delivery_fee_cents) > 0 ? eur(o.delivery_fee_cents) : null,
      total: eur(o.total_cents),
      delay: o.delay_minutes ? delayLabel(o.delay_minutes) : null
    };
  }

  // Imprime automatiquement le ticket sur l'imprimante Bluetooth (app Android uniquement ; ignoré ailleurs, ex. navigateur).
  function autoPrintAccepted(o) {
    try {
      if (window.AndroidPrinter && typeof window.AndroidPrinter.printTicket === 'function') {
        window.AndroidPrinter.printTicket(JSON.stringify(printerPayload(o)));
      }
    } catch (e) { /* l'impression automatique ne doit jamais bloquer le flux de commande */ }
  }

  function openOrderTicket(o) {
    const busy = state.sending.has(String(o.id));
    openDialog(`
      <h3>Ticket — ${esc(customerLabel(o))}</h3>
      ${ticketHtml(o)}
      <div class="dlg-actions">
        ${o.status === 'accepted' ? `<button type="button" class="btn btn-accept" data-action="mark-ready" data-id="${esc(o.id)}" ${busy ? 'disabled' : ''}>${busy ? 'Envoi…' : 'Commande prête · prévenir le client'}</button>` : ''}
        <button type="button" class="btn btn-accept" data-action="print-ticket" data-id="${esc(o.id)}">Imprimer le ticket</button>
        <button type="button" class="btn btn-ghost" data-action="dlg-close">Fermer</button>
      </div>
    `);
  }

  function printInto(html) {
    document.getElementById('print-area').innerHTML = html;
    window.print();
  }

  function recapPrintHtml() {
    const accepted = recapOrders();
    const body = accepted.length ? `
      <div class="pa-day">
        <p class="pa-label">${esc(dayLabel(state.serviceDay))}</p>
        ${accepted.map(o => {
          const at = toDate(o.accepted_at);
          return `<div class="pa-line"><span>${esc(customerLabel(o))} · ${at ? esc(hm(at)) : '—'} · délai ${esc(delayLabel(o.delay_minutes))}</span><span>${esc(eur(o.total_cents))}</span></div>`;
        }).join('')}
      </div>`
      : '<p class="pa-label">Aucune commande acceptée.</p>';
    const sum = accepted.reduce((s, o) => s + (Number(o.total_cents) || 0), 0);
    return `${body}<div class="pa-total"><span>TOTAL</span><span>${esc(eur(sum))}</span></div>`;
  }

  function defaultDelayHtml() {
    const dis = state.savingDefault ? 'disabled' : '';
    const tiles = DELAYS.map(v => `
      <button type="button" class="dl-tile ${state.defaultDelay === v ? 'is-on' : ''}" aria-pressed="${state.defaultDelay === v}"
        data-action="set-default" data-min="${v}" ${dis}>
        <span class="dl-num">${v === 60 ? '1' : v}</span><span class="dl-unit">${v === 60 ? 'heure' : 'minutes'}</span>
      </button>`).join('');
    return `
      <h3>Délai par défaut</h3>
      <p>Ce délai est présélectionné quand vous acceptez une commande. Vous pouvez le changer commande par commande.</p>
      <div class="dl-grid">${tiles}</div>
      <div class="dlg-actions"><button type="button" class="btn btn-ghost" data-action="dlg-close">Fermer</button></div>`;
  }
  function refreshDefaultDialog() {
    if (el.dlg.open && el.dlgBody.querySelector('[data-action="set-default"]')) el.dlgBody.innerHTML = defaultDelayHtml();
  }

  function openRefuseConfirm(o) {
    openDialog(`
      <h3>Refuser la commande de ${esc(customerLabel(o))} ?</h3>
      <p>La commande sera marquée comme refusée et ne sera pas comptée dans la recette.</p>
      <div class="dlg-actions">
        <button type="button" class="btn btn-refuse" data-action="dlg-confirm-refuse" data-id="${esc(o.id)}">Oui, refuser</button>
        <button type="button" class="btn btn-ghost" data-action="dlg-close">Annuler</button>
      </div>
    `);
  }

  function openRevokeConfirm(scope) {
    const all = scope === 'all';
    openDialog(`
      <h3>${all ? 'Déconnecter tous les appareils ?' : 'Déconnecter les autres appareils ?'}</h3>
      <p>${all
        ? 'Tous les appareils, y compris celui-ci, devront se reconnecter avec l\'e-mail et le mot de passe.'
        : 'Les autres appareils devront se reconnecter. Cet appareil reste connecté.'}</p>
      <div class="dlg-actions">
        <button type="button" class="btn btn-refuse" data-action="dlg-confirm-revoke" data-scope="${all ? 'all' : 'others'}">Oui, déconnecter</button>
        <button type="button" class="btn btn-ghost" data-action="dlg-close">Annuler</button>
      </div>
    `);
  }

  // ---------- Changement d'onglet ----------
  function openView(v) {
    state.view = v;
    if (v === 'avail') loadAvailability();
    if (v === 'patron') openPatronTab(state.patronTab);
  }
  function openPatronTab(tab) {
    state.patronTab = tab;
    if (tab === 'clients') loadCustomers();
    if (tab === 'devices') loadSessions();
  }

  // ---------- Gestion des clics (délégation) ----------
  document.addEventListener('click', e => {
    const t = e.target.closest('[data-action]');
    if (!t || t.disabled || !state.authed) return;
    const action = t.dataset.action;
    const id = t.dataset.id;

    switch (action) {
      case 'sound-toggle':
        toggleSound();
        break;
      case 'store-open-toggle':
        saveStoreOpen(!state.storeOpen);
        break;
      case 'logout':
        logout();
        return;
      case 'view':
        openView(t.dataset.view);
        break;
      case 'select': {
        const o = findOrder(id);
        if (o && o.status === 'new' && String(state.selectedId) !== String(o.id)) {
          state.selectedId = o.id;
          state.editingId = null;
          state.draftDelay = null;
        }
        break;
      }
      case 'accept': {
        const o = findOrder(id);
        if (o && o.status === 'new' && !state.sending.has(String(o.id))) {
          state.editingId = o.id;
          state.draftDelay = state.defaultDelay;
        }
        break;
      }
      case 'delay':
        if (state.editingId != null) state.draftDelay = Number(t.dataset.min);
        break;
      case 'accept-confirm': {
        const o = findOrder(id);
        if (o && state.editingId === o.id) decide(o.id, 'accept', state.draftDelay || state.defaultDelay);
        return;
      }
      case 'edit-cancel':
        state.editingId = null;
        state.draftDelay = null;
        break;
      case 'refuse': {
        const o = findOrder(id);
        if (o && o.status === 'new' && !state.sending.has(String(o.id))) openRefuseConfirm(o);
        return;
      }
      case 'dlg-confirm-refuse':
        closeDialog();
        decide(id, 'refuse');
        return;
      case 'default-delay-open':
        openDialog(defaultDelayHtml());
        return;
      case 'set-default':
        saveDefaultDelay(Number(t.dataset.min));
        return;
      case 'notif-enable':
        if (notifSupported() && Notification.permission === 'default') {
          Promise.resolve(Notification.requestPermission()).catch(() => {}).then(() => scheduleRender());
        }
        return;

      // Disponibilité
      case 'cat':
        state.catKey = t.dataset.cat;
        break;
      case 'avail-retry':
        loadAvailability();
        return;
      case 'toggle': {
        const p = PRODUCTS.find(x => x.id === id);
        if (!p) return;
        const st = productState(p);
        if (st.by === 'ingredient') return;
        changeAvailability(p.kind, p.name, st.out ? 'available' : 'out_manual');
        return;
      }
      case 'until': {
        const p = PRODUCTS.find(x => x.id === id);
        if (p && productState(p).by === 'manual') changeAvailability(p.kind, p.name, t.dataset.mode === 'out_today' ? 'out_today' : 'out_manual');
        return;
      }
      case 'ing-toggle': {
        const k = t.dataset.key;
        changeAvailability('ingredient', k, ingOut(k) ? 'available' : 'out_manual');
        return;
      }
      case 'avail-all-in':
        allBackIn();
        return;

      // Espace patron
      case 'patron-tab':
        openPatronTab(t.dataset.tab);
        break;
      case 'client':
        state.selectedClientId = id;
        fillClients();
        return;
      case 'clients-retry':
        loadCustomers();
        return;
      case 'devices-retry':
        loadSessions();
        return;
      case 'revoke-others':
        openRevokeConfirm('others');
        return;
      case 'revoke-all':
        openRevokeConfirm('all');
        return;
      case 'dlg-confirm-revoke':
        closeDialog();
        revokeSessions(t.dataset.scope === 'all' ? 'all' : 'others');
        return;
      case 'copy-recap':
        copyText(recapPlainText(), 'Recette copiée dans le presse-papiers');
        return;
      case 'print-recap':
        printInto(recapPrintHtml());
        return;
      case 'print-order':
      case 'prep-open': {
        const o = findOrder(id);
        if (o) openOrderTicket(o);
        return;
      }
      case 'mark-ready':
        markReady(id);
        return;
      case 'print-ticket': {
        const o = findOrder(id);
        if (o) printInto(ticketHtml(o));
        return;
      }
      case 'dlg-close':
        closeDialog();
        return;
      default:
        return;
    }
    scheduleRender();
  });

  document.addEventListener('input', e => {
    if (e.target && e.target.id === 'client-search') {
      state.clientQuery = e.target.value;
      clearTimeout(clientTimer);
      clientTimer = setTimeout(loadCustomers, 350);
    }
  });

  window.addEventListener('afterprint', () => {
    document.getElementById('print-area').innerHTML = '';
  });

  let pressedInside = false;
  el.dlg.addEventListener('pointerdown', e => {
    pressedInside = e.target !== el.dlg;
  });
  el.dlg.addEventListener('click', e => {
    if (e.target === el.dlg && !pressedInside) closeDialog();
  });
  el.dlg.addEventListener('close', () => { if (!el.dlg.open) el.dlgBody.innerHTML = ''; });

  ['pointerdown', 'keydown', 'touchstart'].forEach(ev => document.addEventListener(ev, unlockAudio, true));

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js', { scope: './' }).then(reg => { swReg = reg; }).catch(e => {
      console.warn('Service worker non enregistré : ' + (e && e.name ? e.name + ': ' : '') + (e && e.message ? e.message : String(e)));
    });
  }

  renderClock();
  setInterval(renderClock, 1000);
  boot();
})();
