/* Espace commerçant — relié à l'API /api/owner_*.php.
   La session est un cookie HttpOnly posé par le serveur : rien n'est gardé dans
   localStorage, sessionStorage ni dans un cookie lisible par JavaScript.
   Montants reçus en centimes, convertis en euros à l'affichage seulement. */
(() => {
  'use strict';

  const API = '/api/';
  const TZ = 'Europe/Paris';
  const DELAYS = [10, 20, 30, 40, 50, 60];
  // Valeur spéciale pour « venir tout de suite » (le client est invité à venir sans attendre,
  // ex. le restaurant va bientôt fermer) : jamais un délai par défaut, seulement au cas par cas.
  const DELAY_IMMEDIATE = 0;
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
  // "immeuble" n'est plus proposé à la saisie côté client mais reste affiché si un compte l'avait déjà choisi.
  const HOUSING_TYPE_LABELS = { maison: 'Maison', appartement: 'Appartement', immeuble: 'Immeuble' };

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
    superUnlocked: false,
    superCode: '',
    superBusy: false,
    recetteClearBusy: false,
    clientQuery: '',
    customers: [],
    customersState: 'idle',
    selectedClientId: null,
    sessions: [],
    sessionsState: 'idle',
    netLost: false,
    printIssues: new Map() // id commande -> { label, error } : tickets qui n'ont pas pu s'imprimer malgré les tentatives automatiques
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
    printIssueBtn: $('#print-issue-btn'),
    printIssueCount: $('#print-issue-count'),
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
    if (m === DELAY_IMMEDIATE) return 'tout de suite';
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
    state.superUnlocked = false;
    state.superCode = '';
    state.recetteClearBusy = false;
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
    // ordersLoaded reste faux jusqu'au premier sondage réel (applyOrders) : sinon les commandes déjà
    // présentes au chargement sont annoncées comme « nouvelles » (vues comme arrivées après un état vide).
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
        if (action === 'accept' && done.status === 'accepted') printOrderOnPrinter(done);
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
    const m = state.draftDelay != null ? state.draftDelay : state.defaultDelay;
    const tiles = DELAYS.map(v => `
      <button type="button" class="dl-tile ${m === v ? 'is-on' : ''}" aria-pressed="${m === v}"
        data-action="delay" data-min="${v}" ${dis}>
        <span class="dl-num">${v === 60 ? '1' : v}</span><span class="dl-unit">${v === 60 ? 'h' : 'min'}</span>
      </button>`).join('');
    // « Venir tout de suite » (restaurant qui va fermer, par ex.) : seulement en retrait, le client
    // vient lui-même — n'a pas de sens pour une livraison où c'est le livreur qui se déplace.
    const immediateTile = o.mode !== 'delivery' ? `
      <button type="button" class="dl-tile dl-tile--urgent ${m === DELAY_IMMEDIATE ? 'is-on' : ''}" aria-pressed="${m === DELAY_IMMEDIATE}"
        data-action="delay" data-min="${DELAY_IMMEDIATE}" ${dis}>
        <span class="dl-unit">Tout de suite</span>
      </button>` : '';
    const confirmLabel = m === DELAY_IMMEDIATE ? 'tout de suite' : m === 60 ? '1 h' : m + ' min';
    return `
      <p class="ask" id="delay-ask">Délai annoncé au client</p>
      <div class="dl-grid" role="group" aria-labelledby="delay-ask">${tiles}${immediateTile}</div>
      <button type="button" class="btn btn-accept btn-xl dec-main" data-action="accept-confirm" data-id="${esc(o.id)}" ${dis}>${busy ? 'Envoi…' : 'Confirmer · ' + confirmLabel}</button>
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
    const locked = !state.superUnlocked;
    return `
      <div class="patron-head">
        <nav class="sub-tabs" aria-label="Espace patron">
          ${tab('recap', 'Recette du jour')}${locked ? '' : tab('clients', 'Clients')}${locked ? '' : tab('devices', 'Appareils connectés')}
        </nav>
        <button type="button" class="btn btn-soft btn-sm super-btn ${locked ? '' : 'is-active'}" data-action="${locked ? 'super-open' : 'super-lock'}" aria-label="Paramètres" title="Paramètres">
          <span aria-hidden="true">⚙️</span>
        </button>
      </div>`;
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
          <p class="recap-note">Les commandes refusées ne sont pas comptées. L’impression et la copie ne reprennent que le total, jamais le détail des commandes.</p>
          <div class="recap-actions">
            <button type="button" class="btn btn-light" data-action="copy-recap">Copier la recette</button>
            <button type="button" class="btn btn-light" data-action="print-recap">Imprimer la recette</button>
            ${state.superUnlocked ? `<button type="button" class="btn btn-refuse" data-action="recette-clear-open" ${state.recetteClearBusy ? 'disabled' : ''}>Supprimer la recette</button>` : ''}
          </div>
        </aside>
      </div>`;
  }

  function clientsShell() {
    return `
      <div class="clients-layout">
        <div class="clients-card">
          <div class="col-head">
            <h2>Clients</h2>
            <button type="button" class="btn btn-light btn-sm" data-action="copy-client-numbers">Copier tous les numéros</button>
          </div>
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
    // Un onglet verrouillé ne doit jamais rester affiché (ex. verrouillage pendant qu'il était ouvert).
    if (!state.superUnlocked && state.patronTab !== 'recap') state.patronTab = 'recap';
    const sig = state.patronTab + '|' + state.superUnlocked;
    if (sig !== patronSig) {
      patronSig = sig;
      const body = state.patronTab === 'clients' ? clientsShell() : state.patronTab === 'devices' ? devicesShell() : recapShell();
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

  // Clients : réservé à l'accès supérieur (code 1109 par défaut en local), recherche côté serveur,
  // saisie avec un léger délai.
  let clientTimer = null;
  let clientReq = 0;
  async function loadCustomers() {
    if (!state.superUnlocked) return;
    const req = ++clientReq;
    state.customersState = 'loading';
    fillClients();
    try {
      const q = state.clientQuery.trim().slice(0, 80);
      const r = await api('owner_customers.php', { method: 'POST', body: { code: state.superCode, q } });
      if (req !== clientReq || r.unauth) return;
      if (!r.ok) {
        // Le code supérieur a changé ou n'est plus valide entre-temps : on reverrouille plutôt que
        // d'afficher une simple erreur réseau.
        if (r.data.error === 'invalid_super_code') { superLock('Accès supérieur invalide, reverrouillé.'); return; }
        throw new Error('http');
      }
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
        ${row('Type de logement', HOUSING_TYPE_LABELS[c.housing_type] || '')}
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

  // Copie et impression de la recette : seulement le total du jour, jamais le détail commande par commande.
  function recapPlainText() {
    const sum = recapOrders().reduce((s, o) => s + (Number(o.total_cents) || 0), 0);
    return [dayLabel(state.serviceDay), `TOTAL ${eur(sum)}`].join('\n');
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

  // Nom de ligne tel qu'imprimé sur le ticket, demande du 20/11. Le catalogue (api/data/catalogue.json,
  // champ line_name) préfixe déjà le nom enregistré selon la catégorie — jamais pour les pizzas/calzones
  // (ex. « Kebab »), « Pâtes X », « Subitowich X », « Tex-Mex X », « Salade X », « Dessert X » pour le reste :
  // pas besoin de redeviner la catégorie, juste adapter ce préfixe déjà présent dans it.name.
  //  - Pizza (a une taille) : jamais « Pizza » devant, taille écrite en entier (assez de place sur le ticket).
  //  - « Subitowich » renommé « Panini » (demande explicite). Pâtes/Tex-Mex/Salade : préfixe inchangé.
  //  - Dessert : préfixe inchangé, mais traité à part (voir splitTicketItems, isTicketDessert ci-dessous).
  const TICKET_PREFIX_RENAME = { Subitowich: 'Panini' };
  function ticketItemTitle(it) {
    const name = String(it.name || '');
    if (it.variant) {
      return `${name} ${it.variant}`;
    }
    const m = /^(\S+)\s+(.+)$/.exec(name);
    if (m && TICKET_PREFIX_RENAME[m[1]]) return `${TICKET_PREFIX_RENAME[m[1]]} ${m[2]}`;
    return name;
  }
  // Un dessert (jamais de taille, nom déjà préfixé « Dessert » par le catalogue) — identifié ainsi pour
  // le mettre à part : c'est la personne à l'accueil qui le donne, pas celle qui prépare les pizzas.
  function isTicketDessert(it) {
    return !it.variant && /^Dessert\s/.test(String(it.name || ''));
  }
  // Rang de taille pour regrouper les pizzas entre elles, peu importe l'ordre de saisie de la commande
  // (demande du 20/11) : toutes les Solo ensemble, puis les Duo, etc. ; le reste (sans taille) à la fin.
  const TICKET_SIZE_RANK = { Solo: 0, Duo: 1, Quatro: 2, XXL: 3 };
  function ticketSizeRank(it) {
    return it.variant && TICKET_SIZE_RANK[it.variant] !== undefined ? TICKET_SIZE_RANK[it.variant] : 4;
  }
  // Sépare les articles courants (lus par la personne qui prépare) des desserts (donnés par la personne
  // à l'accueil), puis regroupe les premiers par taille (tri stable : l'ordre d'origine est conservé
  // entre deux articles de même taille).
  function splitTicketItems(items) {
    const plats = [], desserts = [];
    (items || []).forEach(it => (isTicketDessert(it) ? desserts : plats).push(it));
    plats.sort((a, b) => ticketSizeRank(a) - ticketSizeRank(b));
    return { plats, desserts };
  }
  // Préfixe quantité : jamais « 1× » (inutile), affiché à partir de 2 — fait déjà partie du nom en gros/gras.
  // « x » en ASCII simple pour l'imprimante thermique (escAscii retire le « × » typographique, hors ASCII).
  function ticketQtyPrefix(it, sep) {
    const qty = Number(it.qty) || 1;
    return qty >= 2 ? `${qty}${sep || '×'} ` : '';
  }

  // Modifications d'un article pour le ticket : moitié-moitié « saveur1 / saveur2 » (jamais le mot
  // « moitié »), ingrédients retirés en gras encadrés de noir (bien visible), suppléments et remarque
  // (préfixée #) en gras.
  function ticketItemModsHtml(it) {
    const parts = [];
    if (it.half && (it.half.flavor1 || it.half.flavor2)) {
      parts.push(`<div class="t-mod t-mod-half">${esc(it.half.flavor1 || '?')} / ${esc(it.half.flavor2 || '?')}</div>`);
    }
    if (it.removed && it.removed.length) {
      parts.push(`<div class="t-mod-removed">${it.removed.map(r => `<div>− ${esc(r)}</div>`).join('')}</div>`);
    }
    (it.extras || []).forEach(x => {
      const qty = Number(x.qty) || 1;
      const price = Number(x.price_cents) || 0;
      parts.push(`<div class="t-mod t-mod-plus">+ ${qty > 1 ? qty + '× ' : ''}${esc(x.name)}${price ? ` (${esc(eur(price))}${qty > 1 ? ' pièce' : ''})` : ''}</div>`);
    });
    if (it.note && String(it.note).trim()) parts.push(`<div class="t-mod t-mod-note">#${esc(String(it.note).trim())}</div>`);
    return parts.join('');
  }

  // Ticket de commande : en-tête petit (logo + nom), client/tél/heure compacts en haut, PUIS les
  // articles en très gros et gras (l'inverse de l'ancien ticket) pour une lecture en un coup d'œil en
  // cuisine, regroupés par taille (Solo avec Solo, Duo avec Duo…) avec un trait fin entre les tailles,
  // le total toujours tout en bas, et les desserts dans leur propre bloc après le total (c'est la
  // personne à l'accueil qui les donne, pas celle qui prépare — ils ne doivent pas se mélanger).
  function ticketHtml(o) {
    const delivery = o.mode === 'delivery';
    const received = toDate(o.created_at);
    const ready = toDate(o.ready_at);
    const { plats, desserts } = splitTicketItems(o.items);
    const itemLine = (it, i, arr) => `
      ${i > 0 && ticketSizeRank(arr[i - 1]) !== ticketSizeRank(it) ? '<div class="t-size-break"></div>' : ''}
      <div class="t-item">
        <span class="t-item-name">${esc(ticketQtyPrefix(it))}${esc(ticketItemTitle(it))}</span>
        <span class="t-item-price">${esc(eur(it.line_total_cents))}</span>
      </div>
      ${ticketItemModsHtml(it)}`;
    return `
      <div class="ticket">
        <div class="t-head">
          <img class="t-logo" src="../assets/img/logo.jpg" alt="" width="30" height="30">
          <span class="t-brand">Subito Pizza</span>
        </div>
        <div class="t-top">
          <span>${esc(customerLabel(o))} · ${esc(o.customer_phone || '')}</span>
          <span>Reçue à ${received ? esc(hm(received)) : '—'}</span>
        </div>
        ${delivery ? `
        <div class="t-mode-box">
          <p class="t-mode">LIVRAISON</p>
          <p class="t-address">${esc(addressLine(o.delivery_address))}</p>
          <p class="t-payment">${esc(paymentLabel(o))}</p>
        </div>` : ''}
        <div class="t-items">${plats.map(itemLine).join('')}</div>
        <div class="t-rule t-bottom"></div>
        ${Number(o.delivery_fee_cents) > 0 ? `<div class="t-line"><span>Frais de livraison</span><span>${esc(eur(o.delivery_fee_cents))}</span></div>` : ''}
        <div class="t-line t-total"><strong>TOTAL</strong><strong>${esc(eur(o.total_cents))}</strong></div>
        ${o.delay_minutes != null ? `<div class="t-line"><span>Délai annoncé</span><span>${esc(delayLabel(o.delay_minutes))}</span></div>` : ''}
        ${ready ? `<div class="t-line"><span>Prête vers</span><span>${esc(hm(ready))}</span></div>` : ''}
        ${o.status === 'ready' ? `<div class="t-line"><span>État</span><span>Prête</span></div>` : ''}
        ${desserts.length ? `
        <div class="t-dessert">
          <p class="t-dessert-label">Dessert</p>
          ${desserts.map(itemLine).join('')}
        </div>` : ''}
      </div>`;
  }

  // Transforme une commande en texte structuré pour l'impression (app Android + imprimante Bluetooth).
  function printerPayload(o) {
    const delivery = o.mode === 'delivery';
    const received = toDate(o.created_at);
    const asLine = it => ({
      qty: Number(it.qty) || 1,
      qtyPrefix: ticketQtyPrefix(it, 'x'),
      title: ticketItemTitle(it),
      lineTotal: eur(it.line_total_cents),
      half: (it.half && (it.half.flavor1 || it.half.flavor2)) ? `${it.half.flavor1 || '?'} / ${it.half.flavor2 || '?'}` : null,
      removed: (it.removed || []).slice(),
      extrasText: (it.extras || []).map(x => {
        const qty = Number(x.qty) || 1;
        const price = Number(x.price_cents) || 0;
        return `+ ${qty > 1 ? qty + 'x ' : ''}${x.name}${price ? ` (${eur(price)}${qty > 1 ? ' piece' : ''})` : ''}`;
      }),
      note: it.note && String(it.note).trim() ? String(it.note).trim() : null
    });
    const { plats, desserts } = splitTicketItems(o.items);
    const itemsWithBreaks = plats.map((it, i) => ({ ...asLine(it), sizeBreakBefore: i > 0 && ticketSizeRank(plats[i - 1]) !== ticketSizeRank(it) }));
    return {
      orderId: String(o.id),
      shop: 'Subito Pizza',
      mode: delivery ? 'LIVRAISON' : 'A EMPORTER',
      address: delivery ? addressLine(o.delivery_address) : null,
      payment: delivery ? paymentLabel(o) : null,
      customer: customerLabel(o),
      phone: o.customer_phone || '',
      receivedAt: received ? hm(received) : '',
      items: itemsWithBreaks,
      desserts: desserts.map(asLine),
      deliveryFee: Number(o.delivery_fee_cents) > 0 ? eur(o.delivery_fee_cents) : null,
      total: eur(o.total_cents),
      delay: o.delay_minutes != null ? delayLabel(o.delay_minutes) : null
    };
  }

  // ---------- Impression thermique (ESC/POS) ----------
  // Tout est construit ici, côté site web : l'appli Android ne fait plus que transmettre des
  // octets bruts déjà prêts sur la connexion Bluetooth (voir PrinterBridge.kt, sendBytes()).
  // But : qu'une évolution de la mise en forme du ticket ou des tentatives de renvoi se déploie
  // avec le site, sans jamais devoir réinstaller l'appli sur la tablette.
  const PRINT_WIDTH = 42; // colonnes : 42 ~ rouleau 80mm police standard. 32 = 58mm, 48 = 80mm police fine.
  const PRINT_WIDTH_X2 = Math.floor(PRINT_WIDTH / 2); // largeur en caractères une fois le texte imprimé en largeur x2
  const PRINT_RETRY_DELAYS_MS = [0, 2500, 6000]; // 1re tentative immédiate, puis +2,5s, +6s avant d'abandonner.

  function escAscii(s) {
    // Les imprimantes thermiques n'ont pas d'UTF-8 fiable sans régler la bonne page de code :
    // on retire les accents pour garantir un rendu correct sur tous les modèles.
    const norm = String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '');
    return norm.replace(/œ/g, 'oe').replace(/Œ/g, 'OE').replace(/€/g, 'EUR')
      .split('').filter(ch => { const c = ch.charCodeAt(0); return (c >= 32 && c <= 126) || ch === '\n'; }).join('');
  }
  function escTwoColAt(left, right, width) {
    const l = escAscii(left), r = escAscii(right);
    const maxLeft = Math.max(1, width - r.length - 1);
    const lTrim = l.length > maxLeft ? l.slice(0, maxLeft) : l;
    const spaces = Math.max(1, width - lTrim.length - r.length);
    return lTrim + ' '.repeat(spaces) + r + '\n';
  }
  const escTwoCol = (left, right) => escTwoColAt(left, right, PRINT_WIDTH);
  function escRow(label, value) {
    return escAscii(label.padEnd(10) + ': ' + value) + '\n';
  }
  // Découpe aux espaces (jamais au milieu d'un mot, sauf mot isolé trop long) : pour les lignes en
  // gros caractères, où une coupure en plein milieu d'un mot serait beaucoup plus visible et moche.
  function escWrapWordsAt(s, width) {
    const a = escAscii(s);
    if (a.length <= width) return a;
    const lines = [];
    let line = '';
    for (const word of a.split(' ')) {
      const candidate = line ? line + ' ' + word : word;
      if (candidate.length > width) {
        if (line) lines.push(line);
        line = word;
        while (line.length > width) { lines.push(line.slice(0, width)); line = line.slice(width); }
      } else {
        line = candidate;
      }
    }
    if (line) lines.push(line);
    return lines.join('\n');
  }

  // ---------- Logo du ticket : image -> bitmap ESC/POS, converti une seule fois au chargement de la page ----------
  // Le logo a un fond vert foncé et un texte blanc : à l'impression thermique (encre noire sur papier
  // blanc), ce sont les pixels CLAIRS du logo qui doivent devenir de l'encre noire (le texte « SUbiTO »),
  // et les pixels sombres (le fond vert/rouge) qui doivent rester en blanc — l'inverse d'un seuillage classique.
  const LOGO_PRINT_WIDTH_PX = 160; // ~20mm à 8 points/mm : petit, pour un en-tête dans un coin, pas une bannière.
  let logoRasterBytes = null;

  function buildRasterCommand(pixels, widthPx, heightPx) {
    const widthBytes = Math.ceil(widthPx / 8);
    const bytes = [0x1D, 0x76, 0x30, 0x00, widthBytes & 0xFF, (widthBytes >> 8) & 0xFF, heightPx & 0xFF, (heightPx >> 8) & 0xFF];
    for (let y = 0; y < heightPx; y++) {
      for (let xByte = 0; xByte < widthBytes; xByte++) {
        let b = 0;
        for (let bit = 0; bit < 8; bit++) {
          const x = xByte * 8 + bit;
          if (x < widthPx) {
            const i = (y * widthPx + x) * 4;
            const luma = pixels[i] * 0.299 + pixels[i + 1] * 0.587 + pixels[i + 2] * 0.114;
            if (luma > 150) b |= (1 << (7 - bit)); // clair sur le logo -> encre noire sur le ticket
          }
        }
        bytes.push(b);
      }
    }
    return bytes;
  }

  function prepareLogoRaster() {
    try {
      const img = new Image();
      img.onload = () => {
        try {
          const w = LOGO_PRINT_WIDTH_PX;
          const h = Math.max(1, Math.round(img.height * (w / img.width)));
          const canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, w, h);
          logoRasterBytes = buildRasterCommand(ctx.getImageData(0, 0, w, h).data, w, h);
        } catch (e) { logoRasterBytes = null; } // conversion impossible (ex. canvas bloqué) : ticket sans logo plutôt que planté
      };
      img.onerror = () => { logoRasterBytes = null; };
      img.src = '../assets/img/logo.jpg';
    } catch (e) { logoRasterBytes = null; }
  }
  prepareLogoRaster();

  // Construit la trame ESC/POS complète d'un ticket : en-tête petit (logo + nom), client/tél/heure
  // compacts, PUIS les articles en très gros et gras (l'inverse de l'ancien ticket, demande du 20/11),
  // livraison bien visible avec l'adresse, total toujours en dernier, et un ticket nettement plus long
  // (espacements généreux) pour une lecture en un coup d'œil en cuisine plutôt qu'un ticket surchargé.
  function buildTicketBytes(o) {
    const bytes = [];
    const push = (...vals) => vals.forEach(v => bytes.push(v & 0xFF));
    const raw = arr => arr.forEach(v => bytes.push(v & 0xFF));
    const text = s => { for (const ch of escAscii(s)) bytes.push(ch.charCodeAt(0)); };
    const align = n => push(0x1B, 0x61, n); // 0 gauche, 1 centré, 2 droite
    const bold = on => push(0x1B, 0x45, on ? 1 : 0);
    const charSize = (w, h) => push(0x1D, 0x21, (((w - 1) & 7) << 4) | ((h - 1) & 7)); // GS ! n : x1 à x8
    const feed = n => push(0x1B, 0x64, n);
    const cut = () => { feed(4); push(0x1D, 0x56, 0x00); };
    const sep = () => text('-'.repeat(PRINT_WIDTH) + '\n');
    const thinSep = () => text('.'.repeat(PRINT_WIDTH) + '\n'); // trait fin : sépare les tailles entre elles, sans peser comme sep()
    const reverse = on => push(0x1D, 0x42, on ? 1 : 0); // GS B : vidéo inversée (blanc sur noir) = le « cadre noir » des ingrédients retirés
    const blank = (n = 1) => text('\n'.repeat(n));
    // Moitié-moitié (saveur1 / saveur2, jamais « moitié »), ingrédients retirés en gras sur fond noir,
    // suppléments et remarque (préfixée #) en gras — mêmes règles que ticketItemModsHtml (aperçu HTML).
    const printMods = it => {
      if (it.half) text('  ' + escAscii(it.half) + '\n');
      if (it.removed && it.removed.length) {
        bold(true); reverse(true);
        it.removed.forEach(r => text('  - ' + escAscii(r) + ' \n'));
        reverse(false); bold(false);
      }
      (it.extrasText || []).forEach(e => { bold(true); text('  ' + escAscii(e) + '\n'); bold(false); });
      if (it.note) { bold(true); text('  #' + escAscii(it.note) + '\n'); bold(false); }
    };

    push(0x1B, 0x40); // initialisation

    // En-tête : petit, dans un coin, logo juste au-dessus du nom.
    if (logoRasterBytes) { align(1); raw(logoRasterBytes); blank(1); }
    align(0);
    text((o.shop || 'Subito Pizza') + '\n');
    blank(1);

    // Client / téléphone / heure reçue : compact, lisible, ne prend pas de place.
    if (o.customer) text(escRow('Client', o.customer));
    if (o.phone) text(escRow('Tel', o.phone));
    if (o.receivedAt) text(escRow('Recue a', o.receivedAt));
    blank(1);
    sep();
    blank(1);

    // Livraison : bien visible, avec l'adresse (rien de plus ici pour un retrait au commerce).
    if (o.mode === 'LIVRAISON') {
      align(1); bold(true); charSize(2, 2);
      text('LIVRAISON\n');
      charSize(1, 1); bold(false);
      if (o.address) { align(0); text(escWrapWordsAt(o.address, PRINT_WIDTH) + '\n'); }
      if (o.payment) { align(0); bold(true); text(escWrapWordsAt(o.payment, PRINT_WIDTH) + '\n'); bold(false); }
      blank(1); sep(); blank(1);
    }

    // Articles : le cœur du ticket — très gros, gras, bien espacés pour se voir de loin, regroupés par
    // taille (Solo avec Solo, Duo avec Duo…) avec un trait fin entre deux tailles différentes.
    align(0);
    (o.items || []).forEach(it => {
      if (it.sizeBreakBefore) thinSep();
      bold(true); charSize(2, 3);
      text(escWrapWordsAt(`${it.qtyPrefix}${it.title}`, PRINT_WIDTH_X2) + '\n');
      charSize(1, 1); bold(false);
      printMods(it);
      blank(1);
    });
    sep();
    blank(1);

    // Total : toujours la dernière information du ticket, avant la coupe.
    if (o.deliveryFee) text(escTwoCol('Frais de livraison', o.deliveryFee));
    bold(true); charSize(2, 2);
    text(escTwoColAt('TOTAL', o.total, PRINT_WIDTH_X2));
    charSize(1, 1); bold(false);
    blank(1);
    if (o.delay) text(escRow('Delai annonce', o.delay));

    // Dessert : bloc à part, après le total — donné par la personne à l'accueil, pas par celle qui
    // prépare les pizzas ; il ne doit jamais se mélanger aux articles lus pendant la préparation.
    if (o.desserts && o.desserts.length) {
      blank(2); sep();
      align(1); bold(true); charSize(2, 2);
      text('DESSERT\n');
      charSize(1, 1); bold(false);
      align(0);
      o.desserts.forEach(it => {
        text(escTwoCol(`${it.qtyPrefix}${it.title}`, it.lineTotal));
        printMods(it);
      });
    }

    blank(3); // espace généreux avant la coupe : un ticket nettement plus long, pas tassé.
    cut();

    return bytes;
  }

  function bytesToBase64(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }

  // true si l'appli Android (pont Bluetooth brut) est disponible ; false dans un navigateur normal.
  function hasAndroidPrinter() {
    return !!(window.AndroidPrinter && typeof window.AndroidPrinter.sendBytes === 'function');
  }

  let printRequestSeq = 0;
  const pendingPrints = new Map(); // requestId -> { orderId, label, base64, attempt }

  // Lance l'impression d'une commande (depuis l'acceptation, ou depuis "Réessayer"/"Réimprimer").
  function printOrderOnPrinter(o) {
    if (!o || !hasAndroidPrinter()) return;
    try {
      const payload = printerPayload(o);
      const base64 = bytesToBase64(buildTicketBytes(payload));
      const requestId = 'p' + (++printRequestSeq) + '-' + payload.orderId;
      pendingPrints.set(requestId, { orderId: payload.orderId, label: customerLabel(o), base64, attempt: 0 });
      sendAttempt(requestId);
    } catch (e) { /* l'impression ne doit jamais bloquer le flux de commande */ }
  }

  function sendAttempt(requestId) {
    const job = pendingPrints.get(requestId);
    if (!job) return;
    try { window.AndroidPrinter.sendBytes(job.base64, requestId); }
    catch (e) { finalizePrint(requestId, false, e.message || 'erreur appli'); }
  }

  // Rappelé depuis l'appli Android (PrinterBridge.kt) après chaque tentative d'envoi brut.
  // Les nouvelles tentatives sont gérées ici, côté web : elles se mettent à jour avec le site.
  window.onPrinterSendResult = function (requestId, ok, error) {
    const job = pendingPrints.get(requestId);
    if (!job) return;
    if (ok) { finalizePrint(requestId, true, null); return; }
    const nextAttempt = job.attempt + 1;
    if (nextAttempt < PRINT_RETRY_DELAYS_MS.length) {
      job.attempt = nextAttempt;
      setTimeout(() => sendAttempt(requestId), PRINT_RETRY_DELAYS_MS[nextAttempt]);
    } else {
      finalizePrint(requestId, false, error);
    }
  };

  function finalizePrint(requestId, ok, error) {
    const job = pendingPrints.get(requestId);
    if (!job) return;
    pendingPrints.delete(requestId);
    if (ok) {
      state.printIssues.delete(job.orderId);
      renderPrintIssues();
      toast(`Ticket imprimé · ${job.label}`);
      return;
    }
    state.printIssues.set(job.orderId, { label: job.label, error: error || 'erreur inconnue' });
    renderPrintIssues();
    // N'ouvre la fenêtre que si aucune autre n'est déjà affichée, pour ne jamais interrompre une autre action.
    if (!el.dlg.open) openPrintIssuesDialog();
  }

  function renderPrintIssues() {
    const n = state.printIssues.size;
    el.printIssueBtn.hidden = n === 0;
    el.printIssueCount.textContent = String(n);
    if (el.dlg.open && el.dlgBody.querySelector('[data-print-issues]')) {
      if (n === 0) closeDialog(); else el.dlgBody.innerHTML = printIssuesHtml();
    }
  }

  function printIssuesHtml() {
    const rows = [...state.printIssues.entries()].map(([id, issue]) => `
      <div class="print-issue-row">
        <div class="pi-text">
          <p class="pi-label">${esc(issue.label)}</p>
          <p class="pi-error">${esc(issue.error)}</p>
        </div>
        <button type="button" class="btn btn-accept btn-sm" data-action="print-retry" data-id="${esc(id)}">Réessayer</button>
      </div>`).join('');
    return `
      <div data-print-issues="1">
        <h3>Ticket(s) non imprimé(s)</h3>
        <p>L'imprimante n'a pas pu recevoir ces tickets malgré plusieurs tentatives automatiques. Vérifiez qu'elle est allumée, à portée, et toujours associée en Bluetooth, puis réessayez.</p>
        ${rows}
        <div class="dlg-actions"><button type="button" class="btn btn-ghost" data-action="dlg-close">Fermer</button></div>
      </div>`;
  }

  function openPrintIssuesDialog() {
    openDialog(printIssuesHtml());
  }

  function openOrderTicket(o) {
    const busy = state.sending.has(String(o.id));
    openDialog(`
      <h3>Ticket — ${esc(customerLabel(o))}</h3>
      ${ticketHtml(o)}
      <div class="dlg-actions">
        ${o.status === 'accepted' ? `<button type="button" class="btn btn-accept" data-action="mark-ready" data-id="${esc(o.id)}" ${busy ? 'disabled' : ''}>${busy ? 'Envoi…' : 'Commande prête · prévenir le client'}</button>` : ''}
        <button type="button" class="btn btn-accept" data-action="print-ticket" data-id="${esc(o.id)}">${hasAndroidPrinter() ? 'Réimprimer le ticket' : 'Imprimer le ticket'}</button>
        <button type="button" class="btn btn-ghost" data-action="dlg-close">Fermer</button>
      </div>
    `);
  }

  function printInto(html) {
    document.getElementById('print-area').innerHTML = html;
    window.print();
  }

  function recapPrintHtml() {
    const sum = recapOrders().reduce((s, o) => s + (Number(o.total_cents) || 0), 0);
    return `<div class="pa-day"><p class="pa-label">${esc(dayLabel(state.serviceDay))}</p></div>`
      + `<div class="pa-total"><span>TOTAL</span><span>${esc(eur(sum))}</span></div>`;
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

  // ---------- Accès supérieur (espace patron : clients, appareils, suppression de la recette) ----------
  function openSuperDialog() {
    openDialog(`
      <h3>Paramètres</h3>
      <form id="super-form" novalidate>
        <div class="field">
          <label for="super-code">Code</label>
          <input type="password" id="super-code" name="code" inputmode="numeric" autocomplete="one-time-code" autocapitalize="none" spellcheck="false" required>
        </div>
        <p class="login-error" id="super-error" role="alert" aria-live="assertive"></p>
        <div class="dlg-actions">
          <button type="submit" class="btn btn-accept" id="super-submit">Valider</button>
          <button type="button" class="btn btn-ghost" data-action="dlg-close">Annuler</button>
        </div>
      </form>
    `);
    const input = document.getElementById('super-code');
    const form = document.getElementById('super-form');
    if (input) setTimeout(() => input.focus(), 0);
    if (!form) return;
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const submitBtn = document.getElementById('super-submit');
      const errEl = document.getElementById('super-error');
      const code = input ? input.value : '';
      if (!code) {
        if (errEl) errEl.textContent = 'Saisissez le code.';
        if (input) input.focus();
        return;
      }
      if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Vérification…'; }
      if (errEl) errEl.textContent = '';
      try {
        const r = await api('owner_customers.php', { method: 'POST', body: { code, q: '' } });
        if (r.unauth) return;
        if (r.ok) {
          state.superUnlocked = true;
          state.superCode = code;
          state.customers = Array.isArray(r.data.customers) ? r.data.customers : [];
          state.customersState = 'ok';
          state.patronTab = 'clients';
          closeDialog();
          toast('Accès supérieur déverrouillé');
          scheduleRender();
          return;
        }
        const err = r.data.error;
        if (errEl) {
          errEl.textContent = err === 'invalid_super_code' ? 'Code incorrect.'
            : err === 'too_many_attempts'
              ? `Trop de tentatives. Réessayez dans ${Math.max(1, Math.ceil((Number(r.data.retry_after_seconds) || 60) / 60))} minute(s).`
              : (r.data.message || 'Connexion impossible pour le moment. Réessayez.');
        }
        if (input) { input.value = ''; input.focus(); }
      } catch (e2) {
        if (e2 instanceof StaleError) return;
        if (errEl) errEl.textContent = 'Connexion au serveur impossible. Vérifiez le réseau puis réessayez.';
      } finally {
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Valider'; }
      }
    });
  }

  function superLock(message) {
    state.superUnlocked = false;
    state.superCode = '';
    state.customers = [];
    state.customersState = 'idle';
    state.selectedClientId = null;
    state.clientQuery = '';
    state.sessions = [];
    state.sessionsState = 'idle';
    state.patronTab = 'recap';
    toast(message || 'Accès supérieur verrouillé');
    scheduleRender();
  }

  async function copyAllClientNumbers() {
    // « Tous » : si une recherche filtre la liste affichée, on recharge sans filtre pour ne pas en copier
    // qu'une partie sous un intitulé qui promet le total.
    let list = state.customers;
    if (state.clientQuery.trim() !== '') {
      try {
        const r = await api('owner_customers.php', { method: 'POST', body: { code: state.superCode, q: '' } });
        if (r.unauth) return;
        if (!r.ok) {
          if (r.data.error === 'invalid_super_code') { superLock('Accès supérieur invalide, reverrouillé.'); return; }
          toast('Impossible de charger tous les clients, copie annulée.');
          return;
        }
        list = Array.isArray(r.data.customers) ? r.data.customers : [];
      } catch (e) {
        if (e instanceof StaleError) return;
        toast('Connexion impossible, copie annulée.');
        return;
      }
    }
    const nums = list.map(c => (c.phone || '').trim()).filter(Boolean);
    if (!nums.length) { toast('Aucun numéro à copier.'); return; }
    copyText(nums.join('\n'), `${nums.length} numéro${nums.length > 1 ? 's' : ''} copié${nums.length > 1 ? 's' : ''}`);
  }

  function openRecetteClearConfirm() {
    const sum = recapOrders().reduce((s, o) => s + (Number(o.total_cents) || 0), 0);
    openDialog(`
      <h3>Supprimer la recette du jour ?</h3>
      <p>Le total actuel (${esc(eur(sum))}) et les commandes qui le composent seront supprimés définitivement,
      sur tous les appareils. Cette action est irréversible.</p>
      <div class="dlg-actions">
        <button type="button" class="btn btn-refuse" data-action="dlg-confirm-recette-clear" ${state.recetteClearBusy ? 'disabled' : ''}>
          ${state.recetteClearBusy ? 'Suppression…' : 'Oui, supprimer'}
        </button>
        <button type="button" class="btn btn-ghost" data-action="dlg-close">Annuler</button>
      </div>
    `);
  }

  async function clearRecette() {
    if (state.recetteClearBusy) return;
    state.recetteClearBusy = true;
    scheduleRender();
    try {
      const r = await api('owner_recette_clear.php', { method: 'POST', body: { code: state.superCode } });
      if (r.unauth) return;
      if (!r.ok) {
        if (r.data.error === 'invalid_super_code') { closeDialog(); superLock('Accès supérieur invalide, reverrouillé.'); return; }
        toast(r.data.message || 'Suppression impossible pour le moment. Réessayez.');
        return;
      }
      const removedIds = new Set(recapOrders().map(o => o.id));
      state.orders = state.orders.filter(o => !removedIds.has(o.id));
      // Les commandes supprimées ne doivent plus laisser de trace ailleurs (sélection, envois en cours,
      // incidents d'impression affichés) : sinon un incident resterait affiché pour une commande qui n'existe plus.
      removedIds.forEach(id => { state.sending.delete(id); state.printIssues.delete(id); });
      if (removedIds.has(state.selectedId)) state.selectedId = null;
      closeDialog();
      toast('Recette supprimée');
    } catch (e) {
      if (e instanceof StaleError) return;
      toast('Connexion impossible : la recette n\'a pas été supprimée.');
    } finally {
      state.recetteClearBusy = false;
      scheduleRender();
    }
  }

  // ---------- Changement d'onglet ----------
  function openView(v) {
    state.view = v;
    if (v === 'avail') loadAvailability();
    if (v === 'patron') openPatronTab(state.patronTab);
  }
  function openPatronTab(tab) {
    const t = (tab === 'clients' || tab === 'devices') && !state.superUnlocked ? 'recap' : tab;
    state.patronTab = t;
    if (t === 'clients') loadCustomers();
    if (t === 'devices') loadSessions();
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
        if (o && state.editingId === o.id) decide(o.id, 'accept', state.draftDelay != null ? state.draftDelay : state.defaultDelay);
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
      case 'super-open':
        openSuperDialog();
        return;
      case 'super-lock':
        superLock();
        return;
      case 'copy-client-numbers':
        copyAllClientNumbers();
        return;
      case 'recette-clear-open':
        openRecetteClearConfirm();
        return;
      case 'dlg-confirm-recette-clear':
        clearRecette();
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
        if (!o) return;
        if (hasAndroidPrinter()) printOrderOnPrinter(o);
        else printInto(ticketHtml(o));
        return;
      }
      case 'print-issues-open':
        openPrintIssuesDialog();
        return;
      case 'print-retry': {
        const o = findOrder(id);
        if (o) printOrderOnPrinter(o);
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
