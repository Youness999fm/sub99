// Contrôles de régression ajoutés pendant l'audit pré-publication (19/11/2026).
// Couvrent : le compte client (panne réseau, retour après connexion, échappement de l'historique,
// validation de l'inscription), le panier (stockage refusé), le suivi de commande (panne réseau,
// libellé livraison) et la fenêtre « Commandez en ligne » (focus clavier).
// Garanties : refus si BASE_URL n'est pas localhost ; les réponses de l'API sont simulées dans la
// page ; aucun compte, aucun identifiant réel, aucun envoi, aucune impression.
//
// Usage : node tests/e2e/regressions-audit.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launchChrome, newPage, sleep } from './lib/cdp.mjs';

const BASE = process.env.BASE_URL || 'http://localhost:8090';
const OUT_DIR = process.env.OUT_DIR || path.join(os.tmpdir(), 'subito-tests');

if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/.test(BASE)) {
  console.error('Refus : ce test ne s\'exécute que sur localhost (BASE_URL=' + BASE + ').');
  process.exit(2);
}
fs.mkdirSync(OUT_DIR, { recursive: true });

const results = [];
function check(id, ok, detail) {
  results.push({ id, ok: Boolean(ok), detail: String(detail === undefined ? '' : detail) });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + id + (detail === undefined ? '' : '  — ' + detail));
}

// Mot de passe fictif, sans valeur réelle.
const FAKE_PASSWORD = '0'.repeat(8);

const KEYS = { Tab: { code: 'Tab', vk: 9 }, Escape: { code: 'Escape', vk: 27 } };
async function pressKey(page, key) {
  const k = KEYS[key];
  const base = { key: key, code: k.code, windowsVirtualKeyCode: k.vk, nativeVirtualKeyCode: k.vk };
  await page.send('Input.dispatchKeyEvent', Object.assign({ type: 'keyDown' }, base));
  await page.send('Input.dispatchKeyEvent', Object.assign({ type: 'keyUp' }, base));
  await sleep(150);
}

async function tryWait(page, expression, ms) {
  try {
    await page.waitFor(expression, ms);
    return true;
  } catch (e) {
    return false;
  }
}

// Soumet le formulaire de connexion avec un service de connexion simulé qui réussit.
const LOGIN_MOCK = "(() => { window.SubitoAccount.login = () => Promise.resolve({ first_name: 'Test', last_name: 'Client', email: 'test@example.org', city: 'Rouvroy' }); document.getElementById('loginEmail').value = 'test@example.org'; document.getElementById('loginPassword').value = '" + FAKE_PASSWORD + "'; document.getElementById('loginForm').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true })); return true; })()";

// Simulation du suivi : 1re réponse « en attente », 2e panne réseau, 3e « acceptée ».
const SRC_PANNE = "(() => { const realFetch = window.fetch; let calls = 0; window.__track = { calls: 0 };" +
  " window.fetch = function (url, opts) {" +
  " if (String(url).indexOf('order_status') === -1) return realFetch(url, opts);" +
  " calls += 1; window.__track.calls = calls;" +
  " const base = { customer_name: 'Test', mode: 'pickup', items: [{ name: 'Solo', qty: 1, unit_price: 11 }], total: 11, delivery_fee: 0 };" +
  " const json = { 'Content-Type': 'application/json' };" +
  " if (calls === 1) return Promise.resolve(new Response(JSON.stringify({ order: Object.assign({ status: 'new' }, base) }), { status: 200, headers: json }));" +
  " if (calls === 2) return Promise.reject(new TypeError('Failed to fetch (simulé)'));" +
  " return Promise.resolve(new Response(JSON.stringify({ order: Object.assign({ status: 'accepted', accepted_at: new Date().toISOString(), delay_minutes: 20 }, base) }), { status: 200, headers: json }));" +
  " }; })();";

// Simulation d'une livraison acceptée dont le délai est déjà écoulé.
const SRC_LIVREUR = "(() => { const realFetch = window.fetch; window.fetch = function (url, opts) {" +
  " if (String(url).indexOf('order_status') === -1) return realFetch(url, opts);" +
  " const order = { status: 'accepted', ready_at: new Date(Date.now() - 2 * 60000).toISOString(), mode: 'delivery', customer_name: 'Test', items: [{ name: 'Solo', qty: 1, unit_price: 11 }], total: 16.5, delivery_fee: 5.5, payment_methods: ['cash'], cash_change_for: 20 };" +
  " return Promise.resolve(new Response(JSON.stringify({ order: order, server_now: new Date().toISOString() }), { status: 200, headers: { 'Content-Type': 'application/json' } }));" +
  " }; })();";

const chrome = await launchChrome({ port: 9339, profileDir: OUT_DIR + '/chrome-profile-regress', width: 1280, height: 900 });
try {
  // R01 — contrat du 19/11 : invité = réponse 200 avec customer null.
  {
    const page = await newPage(chrome.port, 'about:blank');
    await page.navigate(BASE + '/menu.html');
    const r = await page.evaluate("(async () => { const realFetch = window.fetch; window.fetch = () => Promise.resolve(new Response('{\"ok\":true,\"customer\":null}', { status: 200, headers: { 'Content-Type': 'application/json' } })); try { return { ok: true, value: await window.SubitoAccount.me(true) }; } catch (e) { return { ok: false, error: String(e) }; } finally { window.fetch = realFetch; } })()");
    check('R01 compte : invité = réponse 200 avec customer null (contrat du 19/11)', r.ok === true && r.value === null, JSON.stringify(r));
    page.close();
  }

  // R01b — une réponse 401 n'est plus confondue avec un invité : elle est signalée.
  {
    const page = await newPage(chrome.port, 'about:blank');
    await page.navigate(BASE + '/menu.html');
    const r = await page.evaluate("(async () => { const realFetch = window.fetch; window.fetch = () => Promise.resolve(new Response('{}', { status: 401, headers: { 'Content-Type': 'application/json' } })); let out; try { const v = await window.SubitoAccount.me(true); out = { resolu: true, valeur: v }; } catch (e) { out = { resolu: false, statut: e.status }; } finally { window.fetch = realFetch; } return out; })()");
    check('R01b compte : 401 signalé comme erreur (statut 401)', r.resolu === false && r.statut === 401, JSON.stringify(r));
    page.close();
  }

  // R02 — panne réseau : erreur signalée et non mise en cache.
  {
    const page = await newPage(chrome.port, 'about:blank');
    await page.navigate(BASE + '/menu.html');
    const r = await page.evaluate("(async () => { const realFetch = window.fetch; const out = {}; window.fetch = () => Promise.reject(new TypeError('Failed to fetch (simulé)')); try { await window.SubitoAccount.me(true); out.reseau = 'resolu'; } catch (e) { out.reseau = 'erreur'; } window.fetch = () => Promise.resolve(new Response(JSON.stringify({ customer: { city: 'Rouvroy' } }), { status: 200, headers: { 'Content-Type': 'application/json' } })); const v = await window.SubitoAccount.me(); out.apres = v && v.city; window.fetch = realFetch; return out; })()");
    check('R02 compte : panne réseau signalée (erreur), puis nouvel essai réussi sans cache d’erreur', r.reseau === 'erreur' && r.apres === 'Rouvroy', JSON.stringify(r));
    page.close();
  }

  // R03 — erreur serveur 500 : erreur signalée, pas un « invité ».
  {
    const page = await newPage(chrome.port, 'about:blank');
    await page.navigate(BASE + '/menu.html');
    const r = await page.evaluate("(async () => { const realFetch = window.fetch; window.fetch = () => Promise.resolve(new Response('{}', { status: 500, headers: { 'Content-Type': 'application/json' } })); let out; try { const v = await window.SubitoAccount.me(true); out = { resolu: true, valeur: v }; } catch (e) { out = { resolu: false, statut: e.status }; } finally { window.fetch = realFetch; } return out; })()");
    check('R03 compte : erreur 500 = erreur signalée (statut 500), jamais « invité »', r.resolu === false && r.statut === 500, JSON.stringify(r));
    page.close();
  }

  // R04 — retour vers un autre site refusé : la page reste sur le compte.
  {
    const page = await newPage(chrome.port, 'about:blank');
    await page.navigate(BASE + '/compte.html?retour=' + encodeURIComponent('https://retour-test.invalid/'));
    await page.evaluate("(() => { sessionStorage.setItem('subito_pending_order_redirect', String(Date.now())); return true; })()");
    // Toute navigation du document principal est enregistrée : une sortie du site est un échec, même brève.
    const navigations = [];
    page.on(function (msg) { if (msg.method === 'Page.frameNavigated' && !msg.params.frame.parentId) navigations.push(msg.params.frame.url); });
    await page.evaluate(LOGIN_MOCK);
    await sleep(1500);
    const hors = navigations.filter(function (u) { return u.indexOf('localhost') === -1; });
    const r = await page.evaluate("({ chemin: location.pathname, hote: location.hostname, connecte: !document.getElementById('accountLoggedIn').hidden })");
    check('R04 compte : retour vers un autre site refusé (aucune navigation hors du site)', r.chemin === '/compte.html' && r.hote === 'localhost' && r.connecte === true && hors.length === 0, JSON.stringify({ r, hors }));
    page.close();
  }

  // R04b — retour en apparence local mais qui sort du site (chemin commençant par //) : refusé.
  // Le domaine .invalid ne se résout jamais : même en cas de régression, aucun site public n'est contacté.
  {
    const page = await newPage(chrome.port, 'about:blank');
    await page.navigate(BASE + '/compte.html?retour=' + encodeURIComponent('/.//retour-test.invalid/'));
    await page.evaluate("(() => { sessionStorage.setItem('subito_pending_order_redirect', String(Date.now())); return true; })()");
    const navigations = [];
    page.on(function (msg) { if (msg.method === 'Page.frameNavigated' && !msg.params.frame.parentId) navigations.push(msg.params.frame.url); });
    await page.evaluate(LOGIN_MOCK);
    await sleep(1500);
    const hors = navigations.filter(function (u) { return u.indexOf('localhost') === -1; });
    const r = await page.evaluate("({ chemin: location.pathname, hote: location.hostname, connecte: !document.getElementById('accountLoggedIn').hidden })");
    check('R04b compte : retour « /.//hôte » refusé (aucune navigation hors du site)', r.chemin === '/compte.html' && r.hote === 'localhost' && r.connecte === true && hors.length === 0, JSON.stringify({ r, hors }));
    page.close();
  }

  // R05 — retour local accepté : reprise sur la bonne page, ancre conservée.
  {
    const page = await newPage(chrome.port, 'about:blank');
    await page.navigate(BASE + '/compte.html?retour=' + encodeURIComponent('/menu.html#desserts'));
    await page.evaluate("(() => { sessionStorage.setItem('subito_pending_order_redirect', String(Date.now())); return true; })()");
    await page.evaluate(LOGIN_MOCK);
    await sleep(1200);
    // cart.js retire le paramètre subito_resume après l'avoir lu : seul le chemin et l'ancre restent.
    const ou = await page.evaluate("location.pathname + location.search + location.hash");
    check('R05 compte : retour local accepté, reprise sur menu.html avec ancre conservée', ou === '/menu.html#desserts', ou);
    page.close();
  }

  // R06 — historique : valeurs renvoyées par l'API échappées, aucun élément injecté.
  {
    const page = await newPage(chrome.port, 'about:blank');
    await page.navigate(BASE + '/compte.html');
    await page.evaluate("(() => { window.__xss = 0; window.SubitoAccount.myOrders = () => Promise.resolve([{ status: '\"><img src=x onerror=\"window.__xss=1\">', id: 7, created_at: '2026-11-19T10:00:00Z', total_cents: 1100, delay_minutes: '<b>5</b>'}]); return true; })()");
    await page.evaluate(LOGIN_MOCK);
    await sleep(700);
    const r = await page.evaluate("(() => { const s = document.querySelector('#accountOrders .account-order__status'); return { img: !!document.querySelector('#accountOrders img'), xss: window.__xss, libelle: s ? s.textContent : null }; })()");
    check('R06 historique : valeurs de l’API échappées, aucun élément injecté', r.img === false && r.xss === 0 && /En attente/.test(r.libelle || ''), JSON.stringify(r));
    page.close();
  }

  // R07 — inscription : prénom vide et e-mail invalide refusés, sans appel au service.
  {
    const page = await newPage(chrome.port, 'about:blank');
    await page.navigate(BASE + '/compte.html');
    const r = await page.evaluate("(() => { window.__inscriptions = 0; window.SubitoAccount.signup = () => { window.__inscriptions += 1; return Promise.resolve({}); }; document.getElementById('tabSignup').click(); const f = document.getElementById('signupForm'); const erreur = document.getElementById('signupError'); document.getElementById('signupFirstName').value = ''; document.getElementById('signupLastName').value = 'Client'; document.getElementById('signupEmail').value = 'test@example.org'; document.getElementById('signupPhone').value = '0600000000'; document.getElementById('signupPassword').value = '" + FAKE_PASSWORD + "'; document.getElementById('signupPasswordConfirm').value = '" + FAKE_PASSWORD + "'; f.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true })); const premier = { visible: !erreur.hidden, texte: erreur.textContent, role: erreur.getAttribute('role') }; document.getElementById('signupFirstName').value = 'Test'; document.getElementById('signupEmail').value = 'pas-une-adresse'; f.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true })); const second = { visible: !erreur.hidden, texte: erreur.textContent }; return { premier: premier, second: second, appels: window.__inscriptions }; })()");
    const ok = r.premier.visible && /prénom/.test(r.premier.texte) && r.premier.role === 'alert' && r.second.visible && /e-mail/.test(r.second.texte) && r.appels === 0;
    check('R07 inscription : prénom vide et e-mail invalide refusés, aucun appel au service', ok, JSON.stringify(r));
    page.close();
  }

  // R08 — panier : stockage refusé = message d'erreur, jamais « ajouté ✓ ».
  {
    const page = await newPage(chrome.port, 'about:blank');
    await page.navigate(BASE + '/menu.html');
    const r = await page.evaluate("(async () => { const realSet = Storage.prototype.setItem; Storage.prototype.setItem = function () { throw new DOMException('quota (simulé)', 'QuotaExceededError'); }; try { const widget = [...document.querySelectorAll('.pizza-widget')].find(w => !w.closest('article[data-no-half]')); const taille = widget.querySelector('.pizza-widget__size'); if (taille) taille.click(); await new Promise(res => setTimeout(res, 150)); const bouton = widget.querySelector('.pizza-widget__quickadd'); bouton.click(); await new Promise(res => setTimeout(res, 400)); const toast = document.getElementById('cartToast'); return { toast: toast ? toast.textContent : null }; } finally { Storage.prototype.setItem = realSet; } })()");
    check('R08 panier : stockage refusé = message d’erreur, jamais « ajouté ✓ »', !!r.toast && /Impossible d/.test(r.toast) && !/ajouté ✓/.test(r.toast), JSON.stringify(r));
    page.close();
  }

  // R09 — fenêtre « Commandez en ligne » : focus dans la fenêtre, Tab bouclé, Échap rend le focus.
  {
    const page = await newPage(chrome.port, 'about:blank');
    await page.navigate(BASE + '/index.html');
    await page.evaluate("localStorage.removeItem('subito_order_launch_popup_seen')");
    await page.navigate(BASE + '/index.html');
    await page.evaluate("(() => { document.querySelector('.site-nav__link[href=\"menu.html\"]').focus(); return true; })()");
    const ouverte = await tryWait(page, "!document.getElementById('orderPopupOverlay').hidden", 8000);
    const ouverture = await page.evaluate("document.activeElement.id");
    await pressKey(page, 'Tab');
    const tab1 = await page.evaluate("document.activeElement.className");
    await pressKey(page, 'Tab');
    const tab2 = await page.evaluate("document.activeElement.id");
    await pressKey(page, 'Tab');
    const tab3 = await page.evaluate("document.activeElement.id");
    await pressKey(page, 'Escape');
    const apres = await page.evaluate("({ cachee: document.getElementById('orderPopupOverlay').hidden, actif: document.activeElement.className, drapeau: localStorage.getItem('subito_order_launch_popup_seen') })");
    const ok = ouverte && ouverture === 'orderPopupClose' && /order-popup__cta/.test(tab1) && tab2 === 'orderPopupDismiss' && tab3 === 'orderPopupClose' && apres.cachee === true && /site-nav__link/.test(apres.actif) && apres.drapeau === '1';
    check('R09 popup « Commandez en ligne » : focus dans la fenêtre, Tab bouclé, Échap rend le focus', ok, JSON.stringify({ ouverture, tab1, tab2, tab3, apres }));
    page.close();
  }

  // R10 — suivi : une panne réseau garde la commande affichée et annonce le problème.
  {
    const page = await newPage(chrome.port, 'about:blank');
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: SRC_PANNE });
    // Identifiant numérique de test, conforme au contrat (commande.js n'accepte que des chiffres).
    await page.navigate(BASE + '/commande.html?id=12');
    const e1 =await tryWait(page, "window.__track && window.__track.calls >= 1 && /En attente/.test(document.getElementById('orderTrackBody').textContent)", 6000);
    const e2 = await tryWait(page, "window.__track && window.__track.calls >= 2 && !!document.getElementById('orderTrackNotice')", 9000);
    const pendant = await page.evaluate("(() => { const n = document.getElementById('orderTrackNotice'); return { corps: document.getElementById('orderTrackBody').textContent, notice: n ? n.textContent : null, role: n ? n.getAttribute('role') : null }; })()");
    const e3 = await tryWait(page, "window.__track && window.__track.calls >= 3 && /Commande acceptée/.test(document.getElementById('orderTrackBody').textContent)", 9000);
    const fin = await page.evaluate("({ bandeauRetire: !document.getElementById('orderTrackNotice'), corps: document.getElementById('orderTrackBody').textContent })");
    const ok = e1 && e2 && /En attente/.test(pendant.corps) && /Connexion perdue/.test(pendant.notice || '') && pendant.role === 'status' && e3 && fin.bandeauRetire;
    check('R10 suivi : une panne réseau garde la commande affichée, annonce le problème, puis se rétablit', ok, JSON.stringify({ e1, e2, notice: pendant.notice, role: pendant.role, e3, bandeauRetire: fin.bandeauRetire }));
    page.close();
  }

  // R11 — suivi livraison : fin du minuteur = « Votre livreur devrait arriver ».
  {
    const page = await newPage(chrome.port, 'about:blank');
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: SRC_LIVREUR });
    await page.navigate(BASE + '/commande.html?id=12');
    const atteint = await tryWait(page, "document.getElementById('orderCountdown') && document.getElementById('orderCountdown').textContent === 'Votre livreur devrait arriver'", 6000);
    const texte = await page.evaluate("(() => { const c = document.getElementById('orderCountdown'); return c ? c.textContent : null; })()");
    check('R11 suivi livraison : fin du minuteur = « Votre livreur devrait arriver »', atteint, texte);
    page.close();
  }

  // R13 — reprise : un lien ?subito_resume=1 arrivé d'ailleurs n'envoie jamais la commande.
  // R14 — témoin : après un retour légitime de connexion (drapeau posé par compte.js), la commande part et le suivi s'ouvre.
  // Simulation : session client et réponse d'envoi dans la page ; panier de test seulement (aucune requête réelle).
  const SRC_SESSION_COMMANDE = "(() => { const realFetch = window.fetch; const json = { 'Content-Type': 'application/json' };"
    + " window.fetch = function (url, opts) {"
    + " if (String(url).indexOf('customer_me') !== -1) return Promise.resolve(new Response(JSON.stringify({ ok: true, customer: { first_name: 'Test', last_name: 'Client', email: 'test@example.org', city: 'Hénin-Beaumont' } }), { status: 200, headers: json }));"
    + " if (String(url).indexOf('order_create') !== -1) return Promise.resolve(new Response(JSON.stringify({ ok: true, order: { id: 4812 } }), { status: 201, headers: json }));"
    + " return realFetch(url, opts); }; })();"
    + "localStorage.setItem('subito_cart_v1', JSON.stringify([{ id: 'test-veg-solo', name: 'Végétarienne', variant: 'Solo', basePrice: 11, qty: 1, removed: [], extras: [], half: null, note: '' }]));";
  {
    const page = await newPage(chrome.port, 'about:blank');
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: SRC_SESSION_COMMANDE });
    await page.navigate(BASE + '/menu.html');
    await page.evaluate("sessionStorage.removeItem('subito_resume_ok')");
    await page.navigate(BASE + '/menu.html?subito_resume=1');
    await sleep(2500);
    const ou = await page.evaluate("location.pathname + location.search");
    check('R13 reprise : un lien ?subito_resume=1 venu d’ailleurs n’envoie pas la commande', ou === '/menu.html', ou);
    page.close();
  }
  {
    const page = await newPage(chrome.port, 'about:blank');
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: SRC_SESSION_COMMANDE });
    await page.navigate(BASE + '/menu.html');
    await page.evaluate("sessionStorage.setItem('subito_resume_ok', '1')");
    await page.evaluate("sessionStorage.setItem('subito_pending_cart', localStorage.getItem('subito_cart_v1'))");
    await page.navigate(BASE + '/menu.html?subito_resume=1');
    const atteint = await tryWait(page, "location.pathname === '/commande.html'", 8000);
    const ou = await page.evaluate("location.pathname + location.search");
    check('R14 témoin : après un retour légitime de connexion, la commande part et le suivi s’ouvre', atteint && ou === '/commande.html?id=4812', ou);
    page.close();
  }

  // R15 — chaîne réelle : depuis compte.html, une connexion après une intention de commande (horodatée au départ
  // vers la connexion, posée comme le fait redirectToLogin) renvoie vers le panier, qui envoie alors la commande.
  {
    const page = await newPage(chrome.port, 'about:blank');
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: SRC_SESSION_COMMANDE });
    await page.navigate(BASE + '/menu.html');
    await page.evaluate("sessionStorage.setItem('subito_pending_order_redirect', String(Date.now()))");
    await page.evaluate("sessionStorage.setItem('subito_pending_cart', localStorage.getItem('subito_cart_v1'))");
    await page.navigate(BASE + '/compte.html?retour=' + encodeURIComponent('/menu.html'));
    await page.evaluate(LOGIN_MOCK);
    const atteint = await tryWait(page, "location.pathname === '/commande.html'", 10000);
    const ou = await page.evaluate("location.pathname + location.search");
    check('R15 chaîne réelle : connexion depuis compte.html, retour au panier, commande envoyée', atteint && ou === '/commande.html?id=4812', ou);
    page.close();
  }

  // R16 — réponse réussie sans JSON (page d'erreur, maintenance) ou sans clé customer : erreur bad_response,
  // jamais un client invité mis en cache.
  {
    const page = await newPage(chrome.port, 'about:blank');
    await page.navigate(BASE + '/menu.html');
    const r = await page.evaluate("(async () => { const realFetch = window.fetch; window.fetch = () => Promise.resolve(new Response('<html>maintenance</html>', { status: 200, headers: { 'Content-Type': 'text/html' } })); let out; try { const v = await window.SubitoAccount.me(true); out = { resolu: true, valeur: v }; } catch (e) { out = { resolu: false, code: e.code || null }; } finally { window.fetch = realFetch; } return out; })()");
    const r2 = await page.evaluate("(async () => { const realFetch = window.fetch; window.fetch = () => Promise.resolve(new Response('{\"ok\":true}', { status: 200, headers: { 'Content-Type': 'application/json' } })); let out; try { const v = await window.SubitoAccount.me(true); out = { resolu: true, valeur: v }; } catch (e) { out = { resolu: false, code: e.code || null }; } finally { window.fetch = realFetch; } return out; })()");
    check('R16 compte : réponse 200 sans JSON ou sans customer = erreur bad_response, jamais un invité', r.resolu === false && r.code === 'bad_response' && r2.resolu === false && r2.code === 'bad_response', JSON.stringify({ r, r2 }));
    page.close();
  }

  // R17 — « Créer mon compte » dans la fenêtre d'accueil marque la fenêtre comme vue (elle ne revient pas).
  {
    const page = await newPage(chrome.port, 'about:blank');
    await page.navigate(BASE + '/index.html');
    await page.evaluate("localStorage.removeItem('subito_order_launch_popup_seen')");
    await page.navigate(BASE + '/index.html');
    const ouverte = await tryWait(page, "!document.getElementById('orderPopupOverlay').hidden", 8000);
    await page.evaluate("document.querySelector('.order-popup__cta').click()");
    const suivie = await tryWait(page, "location.pathname === '/compte.html'", 8000);
    const drapeau = await page.evaluate("localStorage.getItem('subito_order_launch_popup_seen')");
    check('R17 fenêtre d’accueil : « Créer mon compte » la marque comme vue', ouverte && suivie && drapeau === '1', JSON.stringify({ ouverte, suivie, drapeau }));
    page.close();
  }

  // R12 — identifiant numérique réel : la commande doit s'afficher (défaut connu : commande.js ligne 37).
  {
    const page = await newPage(chrome.port, 'about:blank');
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: SRC_PANNE });
    await page.navigate(BASE + '/commande.html?id=12');
    const affichee = await tryWait(page, "window.__track && window.__track.calls >= 1 && /En attente/.test(document.getElementById('orderTrackBody').textContent)", 6000);
    const texte = await page.evaluate("(() => { const b = document.getElementById('orderTrackBody'); return b ? b.textContent.slice(0, 90) : null; })()");
    check('R12 suivi : un identifiant numérique (12) affiche la commande', affichee, texte);
    page.close();
  }
  // Panier de test (une pizza à emporter) et session client simulée, pour les contrôles R18 à R22.
  const PANIER_TEST = "localStorage.setItem('subito_cart_v1', JSON.stringify([{ id: 'test-veg-solo', name: 'Végétarienne', variant: 'Solo', basePrice: 11, qty: 1, removed: [], extras: [], half: null, note: '' }]));";
  const SESSION_TEST = "window.SubitoAccount.me = function () { return Promise.resolve({ city: 'Hénin-Beaumont', first_name: 'Test', last_name: 'Client' }); }; true;";
  const OUVRIR_TIROIR = "(() => { document.getElementById('cartBarOpen').click(); return true; })()";

  // R18 — deux onglets : pendant l'envoi, l'autre onglet modifie le panier puis la réponse se perd ; le renvoi du
  // même contenu ne doit pas créer une seconde commande. Le serveur est simulé avec un dédoublonnage par clé
  // (même clé = même commande, comme le contrat) ; la première requête est créée côté serveur, puis gardée en attente.
  {
    const SERVEUR_R18 = "(() => { const realFetch = window.fetch; const json = { 'Content-Type': 'application/json' };"
      + " window.fetch = function (url, opts) {"
      + " if (String(url).indexOf('order_create') === -1) return realFetch(url, opts);"
      + " const corps = JSON.parse(opts.body); const commandes = JSON.parse(localStorage.getItem('r18_commandes') || '{}');"
      + " if (commandes[corps.idempotency_key]) return Promise.resolve(new Response(JSON.stringify({ ok: true, order: { id: commandes[corps.idempotency_key] } }), { status: 200, headers: json }));"
      + " const id = 7001 + Object.keys(commandes).length; commandes[corps.idempotency_key] = id; localStorage.setItem('r18_commandes', JSON.stringify(commandes));"
      + " if (!window.__r18Premiere) { window.__r18Premiere = true; return new Promise(function (resolve, reject) { window.__r18Liberer = function () { reject(new TypeError('Failed to fetch (réponse perdue, simulée)')); }; }); }"
      + " return Promise.resolve(new Response(JSON.stringify({ ok: true, order: { id: id } }), { status: 201, headers: json }));"
      + " }; })();";
    const a = await newPage(chrome.port, 'about:blank');
    await a.navigate(BASE + '/menu.html');
    await a.evaluate("localStorage.removeItem('r18_commandes')");
    await a.evaluate(PANIER_TEST);
    await a.navigate(BASE + '/menu.html');
    await a.evaluate(SESSION_TEST);
    await a.evaluate(SERVEUR_R18);
    await a.evaluate(OUVRIR_TIROIR);
    await tryWait(a, "!document.getElementById('cartOverlay').hidden", 5000);
    await a.evaluate("document.getElementById('checkoutOrder').click()");
    // La première requête reste en attente : la commande est créée côté serveur, la réponse n'arrive pas encore.
    const enAttente = await tryWait(a, "typeof window.__r18Liberer === 'function'", 6000);
    // (Une modification du panier par un autre onglet pendant ce vol est refusée : voir R24 ; après l'échec : R29.)
    // La réponse se perd (coupure) ; le client renvoie le même panier.
    await a.evaluate("window.__r18Liberer()");
    const coupure = await tryWait(a, "/Connexion interrompue/.test(document.getElementById('checkoutOrderStatus').textContent)", 6000);
    await a.evaluate("document.getElementById('checkoutOrder').click()");
    const suivi = await tryWait(a, "location.pathname === '/commande.html'", 8000);
    const crees = await a.evaluate("Object.keys(JSON.parse(localStorage.getItem('r18_commandes') || '{}')).length");
    check('R18 envoi : coupure en vol puis renvoi du même contenu, une seule commande créée', enAttente && coupure && suivi && crees === 1, 'en attente=' + enAttente + ' · coupure=' + coupure + ' · suivi=' + suivi + ' · commandes créées=' + crees);
    a.close();
  }

  // R19 — suivi : une requête de suivi suspendue (réseau mobile) est abandonnée après 10 s ; le suivi ne reste pas bloqué.
  {
    const page = await newPage(chrome.port, 'about:blank');
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: "(() => { const realFetch = window.fetch; window.__abandons = 0; window.fetch = function (url, opts) { if (String(url).indexOf('order_status') === -1) return realFetch(url, opts); return new Promise(function (resolve, reject) { if (opts && opts.signal) opts.signal.addEventListener('abort', function () { window.__abandons += 1; reject(new DOMException('abandon simulé', 'AbortError')); }); }); }; })();" });
    await page.navigate(BASE + '/commande.html?id=12');
    const abandonnee = await tryWait(page, "window.__abandons >= 1", 13000);
    const abandons = await page.evaluate("window.__abandons");
    check('R19 suivi : une requête suspendue est abandonnée après 10 s', abandonnee, 'abandons=' + abandons);
    page.close();
  }

  // R20 — compte : un corps de réponse qui n'arrive jamais est lui aussi interrompu après 10 s (panne réseau).
  {
    const page = await newPage(chrome.port, 'about:blank');
    await page.navigate(BASE + '/menu.html');
    await page.evaluate("(() => { const realFetch = window.fetch; window.fetch = function (url, opts) { if (String(url).indexOf('customer_me') === -1) return realFetch(url, opts); return Promise.resolve({ ok: true, status: 200, json: function () { return new Promise(function (resolve, reject) { if (opts && opts.signal) opts.signal.addEventListener('abort', function () { reject(new DOMException('abandon simulé', 'AbortError')); }); }); } }); }; return true; })()");
    const r = await page.evaluate("Promise.race([window.SubitoAccount.me(true).then(function () { return { resolu: true }; }, function (e) { return { resolu: false, code: e && e.code }; }), new Promise(function (resolve) { setTimeout(function () { resolve({ resolu: false, code: 'toujours_en_attente' }); }, 15000); })])");
    check('R20 compte : un corps de réponse suspendu devient une panne réseau après 10 s', r.resolu === false && r.code === 'network', JSON.stringify(r));
    page.close();
  }

  // R21 — suivi : la limite de 2 h s'applique quand la page est déjà ouverte (minuteur), pas seulement au chargement.
  {
    const page = await newPage(chrome.port, 'about:blank');
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: "(() => { const realFetch = window.fetch; window.fetch = function (url, opts) { if (String(url).indexOf('order_status') === -1) return realFetch(url, opts); const maintenant = Date.now(); const commande = { id: 12, status: 'accepted', mode: 'pickup', customer_name: 'Test', items: [], total_cents: 1100, created_at: new Date(maintenant).toISOString(), accepted_at: new Date(maintenant).toISOString(), delay_minutes: 1, ready_at: new Date(maintenant - (2 * 60 * 60 * 1000 - 3000)).toISOString() }; return Promise.resolve(new Response(JSON.stringify({ order: commande, server_now: new Date(maintenant).toISOString() }), { status: 200, headers: { 'Content-Type': 'application/json' } })); }; })();" });
    await page.navigate(BASE + '/commande.html?id=12');
    const expire = await tryWait(page, "/plus disponible/.test(document.body.textContent)", 12000);
    check('R21 suivi : la limite de 2 h s’applique page ouverte (minuteur)', expire, 'expire=' + expire);
    page.close();
  }

  // R22 — un article ajouté dans un autre onglet pendant l'envoi reste dans le panier : il n'est ni vidé ni présenté
  // comme commandé, et la page de suivi ne s'ouvre pas à la place du client.
  {
    const page = await newPage(chrome.port, 'about:blank');
    await page.navigate(BASE + '/menu.html');
    await page.evaluate(PANIER_TEST);
    await page.navigate(BASE + '/menu.html');
    await page.evaluate(SESSION_TEST);
    await page.evaluate("(() => { const realFetch = window.fetch; const json = { 'Content-Type': 'application/json' }; window.fetch = function (url, opts) { if (String(url).indexOf('order_create') === -1) return realFetch(url, opts); const panier = JSON.parse(localStorage.getItem('subito_cart_v1') || '[]'); panier.push({ id: 'test-coca', name: 'Coca', variant: '', basePrice: 2.5, qty: 1, removed: [], extras: [], half: null, note: '' }); localStorage.setItem('subito_cart_v1', JSON.stringify(panier)); return Promise.resolve(new Response(JSON.stringify({ ok: true, order: { id: 6001 } }), { status: 201, headers: json })); }; return true; })()");
    await page.evaluate(OUVRIR_TIROIR);
    await tryWait(page, "!document.getElementById('cartOverlay').hidden", 5000);
    await page.evaluate("document.getElementById('checkoutOrder').click()");
    // Le client est conduit au suivi, qui lui dit que l'article ajouté reste dans le panier (le message ne dépend pas du tiroir).
    const suivi = await tryWait(page, "location.pathname === '/commande.html' && /ne font pas partie de cette commande/.test(document.body.textContent)", 8000);
    const etat = await page.evaluate("(() => ({ url: location.pathname + location.search, panier: JSON.parse(localStorage.getItem('subito_cart_v1') || '[]').map(function (l) { return l.name + ' x' + l.qty; }) }))()");
    check('R22 envoi : un article ajouté pendant l’envoi reste dans le panier, et le suivi le signale', suivi && /reste=1/.test(etat.url) && JSON.stringify(etat.panier) === '["Coca x1"]', JSON.stringify(etat));
    page.close();
  }
  // R23 — reprise après connexion : un panier modifié depuis la demande n'est pas envoyé à la place du client.
  {
    const page = await newPage(chrome.port, 'about:blank');
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: SRC_SESSION_COMMANDE });
    await page.navigate(BASE + '/menu.html');
    await page.evaluate("sessionStorage.setItem('subito_resume_ok', '1')");
    await page.evaluate("sessionStorage.setItem('subito_pending_cart', JSON.stringify([]))");
    await page.navigate(BASE + '/menu.html?subito_resume=1');
    await sleep(2500);
    const etat = await page.evaluate("(() => ({ url: location.pathname + location.search, message: (document.getElementById('checkoutOrderStatus') || { textContent: '' }).textContent }))()");
    check('R23 reprise : un panier modifié depuis la demande n’est pas envoyé à la place du client', etat.url === '/menu.html' && /Votre panier a changé/.test(etat.message), JSON.stringify(etat).slice(0, 160));
    page.close();
  }

  // Mise en place commune de R24 à R28 : panier d'une pizza, session simulée, serveur de commande simulé (script en paramètre).
  async function pageCommande(script) {
    const p = await newPage(chrome.port, 'about:blank');
    await p.navigate(BASE + '/menu.html');
    await p.evaluate("localStorage.clear()");
    await p.evaluate(PANIER_TEST);
    await p.navigate(BASE + '/menu.html');
    await p.evaluate(SESSION_TEST);
    await p.evaluate(script);
    await p.evaluate(OUVRIR_TIROIR);
    await tryWait(p, "!document.getElementById('cartOverlay').hidden", 5000);
    return p;
  }
  const FETCH = "const realFetch = window.fetch; const json = { 'Content-Type': 'application/json' }; window.fetch = function (url, opts) { if (String(url).indexOf('order_create') === -1) return realFetch(url, opts); const corps = JSON.parse(opts.body); ";

  // R24 — verrou entre onglets : pendant qu'un envoi est en vol, l'autre onglet ne peut ni renvoyer ni modifier le panier.
  {
    const a = await pageCommande("(() => { " + FETCH + "localStorage.setItem('r24_envois', String(Number(localStorage.getItem('r24_envois') || '0') + 1)); return new Promise(function (resolve, reject) { window.__r24Liberer = function () { reject(new TypeError('Failed to fetch (simulée)')); }; }); }; return true; })()");
    await a.evaluate("document.getElementById('checkoutOrder').click()");
    const enAttente = await tryWait(a, "typeof window.__r24Liberer === 'function'", 6000);
    const b = await newPage(chrome.port, 'about:blank');
    await b.navigate(BASE + '/menu.html');
    await b.evaluate(OUVRIR_TIROIR);
    await tryWait(b, "!document.getElementById('cartOverlay').hidden", 5000);
    await b.evaluate("document.getElementById('checkoutOrder').click()");
    await sleep(600);
    const messageB = await b.evaluate("document.getElementById('checkoutOrderStatus').textContent");
    await b.evaluate("document.querySelector('.cart-line__remove').click()");
    await sleep(300);
    const lignes = await b.evaluate("JSON.parse(localStorage.getItem('subito_cart_v1') || '[]').length");
    const envois = await b.evaluate("localStorage.getItem('r24_envois')");
    await a.evaluate("window.__r24Liberer()");
    check('R24 deux onglets : pendant l’envoi, l’autre onglet ne renvoie rien et ne modifie pas le panier', enAttente && /autre onglet/.test(messageB) && lignes === 1 && envois === '1', 'en attente=' + enAttente + ' · message=' + String(messageB).trim().slice(0, 60) + ' · lignes=' + lignes + ' · envois=' + envois);
    a.close();
    b.close();
  }

  // R25 — une quantité augmentée dans un autre onglet pendant l'envoi : seule l'unité envoyée est retirée du panier.
  {
    const a = await pageCommande("(() => { " + FETCH + "const panier = JSON.parse(localStorage.getItem('subito_cart_v1')); panier[0].qty = 2; localStorage.setItem('subito_cart_v1', JSON.stringify(panier)); return Promise.resolve(new Response(JSON.stringify({ ok: true, order: { id: 6002 } }), { status: 201, headers: json })); }; return true; })()");
    await a.evaluate("document.getElementById('checkoutOrder').click()");
    const suivi = await tryWait(a, "location.pathname === '/commande.html'", 8000);
    const etat = await a.evaluate("(() => ({ url: location.search, panier: JSON.parse(localStorage.getItem('subito_cart_v1') || '[]').map(function (l) { return l.qty; }) }))()");
    check('R25 envoi : une quantité ajoutée pendant l’envoi ne laisse que l’unité non commandée', suivi && /reste=1/.test(etat.url) && JSON.stringify(etat.panier) === '[1]', JSON.stringify(etat));
    a.close();
  }

  // R26 — cinq issues inconnues déjà gardées : la clé d'un nouvel envoi dont la réponse se perd est bien conservée.
  {
    const a = await pageCommande("(() => { " + FETCH + "localStorage.setItem('r26_cle', corps.idempotency_key); return Promise.reject(new TypeError('Failed to fetch (simulée)')); }; const liste = [1, 2, 3, 4, 5].map(function (i) { return { key: 'r26-' + i, fp: 'f' + i, at: Date.now(), unknown: true, warned: true }; }); localStorage.setItem('subito_order_attempt', JSON.stringify(liste)); return true; })()");
    await a.evaluate("document.getElementById('checkoutOrder').click()");
    const coupure = await tryWait(a, "/Connexion interrompue/.test(document.getElementById('checkoutOrderStatus').textContent)", 6000);
    const etat = await a.evaluate("(() => { const liste = JSON.parse(localStorage.getItem('subito_order_attempt') || '[]'); const cle = localStorage.getItem('r26_cle'); return { longueur: liste.length, gardee: liste.some(function (x) { return x.key === cle && x.unknown; }) }; })()");
    check('R26 tentatives : la clé du sixième envoi perdu est conservée, jamais évincée', coupure && etat.gardee === true && etat.longueur === 6, JSON.stringify(etat));
    a.close();
  }

  // R27 — commande rejouée par le serveur (même clé, même contenu) : le suivi dit qu'aucune nouvelle commande n'a été créée.
  {
    const a = await pageCommande("(() => { " + FETCH + "return Promise.resolve(new Response(JSON.stringify({ ok: true, replayed: true, order: { id: 7001 } }), { status: 200, headers: json })); }; return true; })()");
    await a.evaluate("document.getElementById('checkoutOrder').click()");
    const suivi = await tryWait(a, "location.pathname === '/commande.html' && /déjà été enregistrée/.test(document.body.textContent)", 8000);
    const url = await a.evaluate("location.search");
    check('R27 envoi : une commande rejouée par le serveur est signalée, sans confirmation neuve', suivi && /deja=1/.test(url), url);
    a.close();
  }

  // R28 — une issue inconnue de plus de 24 h garde sa clé : le même contenu renvoyé après 25 h reprend la même clé.
  {
    const a = await pageCommande("(() => { " + FETCH + "const cles = JSON.parse(localStorage.getItem('r28_cles') || '[]'); cles.push(corps.idempotency_key); localStorage.setItem('r28_cles', JSON.stringify(cles)); if (cles.length === 1) return Promise.reject(new TypeError('Failed to fetch (simulée)')); return Promise.resolve(new Response(JSON.stringify({ ok: true, replayed: true, order: { id: 7002 } }), { status: 200, headers: json })); }; return true; })()");
    await a.evaluate("document.getElementById('checkoutOrder').click()");
    await tryWait(a, "/Connexion interrompue/.test(document.getElementById('checkoutOrderStatus').textContent)", 6000);
    await a.evaluate("(() => { const liste = JSON.parse(localStorage.getItem('subito_order_attempt') || '[]'); liste.forEach(function (x) { x.at = Date.now() - 25 * 3600 * 1000; }); localStorage.setItem('subito_order_attempt', JSON.stringify(liste)); return true; })()");
    await a.evaluate("document.getElementById('checkoutOrder').click()");
    await tryWait(a, "location.pathname === '/commande.html'", 8000);
    const cles = await a.evaluate("JSON.parse(localStorage.getItem('r28_cles') || '[]')");
    check('R28 tentatives : une issue inconnue de 25 h reprend sa clé (pas de seconde commande)', cles.length === 2 && cles[0] === cles[1], JSON.stringify(cles.map(function (c) { return String(c).slice(0, 8); })));
    a.close();
  }

  // R29 — perte de réponse, puis modification du panier dans l'autre onglet APRÈS l'échec, puis renvoi : une seule commande.
  {
    const SERVEUR_R29 = "(() => { " + FETCH + "const commandes = JSON.parse(localStorage.getItem('r29_commandes') || '{}'); if (commandes[corps.idempotency_key]) return Promise.resolve(new Response(JSON.stringify({ ok: true, replayed: true, order: { id: commandes[corps.idempotency_key] } }), { status: 200, headers: json })); const id = 7101 + Object.keys(commandes).length; commandes[corps.idempotency_key] = id; localStorage.setItem('r29_commandes', JSON.stringify(commandes)); if (!window.__r29Perdue) { window.__r29Perdue = true; return Promise.reject(new TypeError('Failed to fetch (simulée)')); } return Promise.resolve(new Response(JSON.stringify({ ok: true, order: { id: id } }), { status: 201, headers: json })); }; return true; })()";
    const a = await pageCommande(SERVEUR_R29);
    await a.evaluate("document.getElementById('checkoutOrder').click()");
    const coupure = await tryWait(a, "/Connexion interrompue/.test(document.getElementById('checkoutOrderStatus').textContent)", 6000);
    // L'envoi est terminé : l'autre onglet peut modifier le panier (un article de plus, retiré à la corbeille).
    const b = await newPage(chrome.port, 'about:blank');
    await b.navigate(BASE + '/menu.html');
    await b.evaluate("localStorage.setItem('subito_cart_v1', JSON.stringify(JSON.parse(localStorage.getItem('subito_cart_v1') || '[]').concat([{ id: 'test-coca', name: 'Coca', variant: '', basePrice: 2.5, qty: 1, removed: [], extras: [], half: null, note: '' }])))");
    await b.navigate(BASE + '/menu.html');
    await b.evaluate(OUVRIR_TIROIR);
    await tryWait(b, "!document.getElementById('cartOverlay').hidden", 5000);
    await b.evaluate("(() => { const ligne = [...document.querySelectorAll('.cart-line')].filter(function (l) { return /Coca/.test(l.textContent); })[0]; ligne.querySelector('.cart-line__remove').click(); return true; })()");
    await sleep(300);
    await a.evaluate("document.getElementById('checkoutOrder').click()");
    const suivi = await tryWait(a, "location.pathname === '/commande.html'", 8000);
    const crees = await a.evaluate("Object.keys(JSON.parse(localStorage.getItem('r29_commandes') || '{}')).length");
    check('R29 deux onglets : perte, modification après l’échec, renvoi : une seule commande', coupure && suivi && crees === 1, 'coupure=' + coupure + ' · suivi=' + suivi + ' · commandes créées=' + crees);
    a.close();
    b.close();
  }

} finally {
  chrome.proc.kill();
}

const echecs = results.filter((r) => !r.ok).length;
fs.writeFileSync(OUT_DIR + '/regressions-resultats.json', JSON.stringify({ date: new Date().toISOString(), resultats: results }, null, 2));
console.log('\nBilan : ' + (results.length - echecs) + ' / ' + results.length + ' réussis');
console.log('Détail : ' + OUT_DIR + '/regressions-resultats.json');
process.exitCode = echecs ? 1 : 0;
