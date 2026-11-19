// Tests de parcours de commande sur le site local (navigateur réel, Chrome headless).
// Garanties : aucune requête vers un serveur réel (l'envoi est simulé dans la page), aucune connexion
// à un compte, aucun identifiant, aucune impression. Les valeurs attendues sont recalculées à partir
// de la page (tailles, suppléments) et des règles documentées (promo à emporter, minimum et frais).
//
// Usage :  node tests/e2e/parcours-commande.mjs
// Prérequis : serveur local sub99 sur http://localhost:8090 (.claude/serve.ps1) ; Chrome ou Edge installé.
import fs from 'node:fs';
import { launchChrome, newPage, sleep } from './lib/cdp.mjs';

const BASE = process.env.BASE_URL || 'http://localhost:8090';
const OUT_DIR = process.env.OUT_DIR || 'C:/Users/youne/AppData/Local/Temp/claude/d2849a14368d2415/08c4bdcd-b229-432e-a6eb-0a56026f18ee/scratchpad/e2e';
const PROFILE = OUT_DIR + '/chrome-profile';
fs.mkdirSync(OUT_DIR, { recursive: true });

if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/.test(BASE)) {
  console.error('Refus : ce test ne s\'exécute que sur localhost (BASE_URL=' + BASE + ').');
  process.exit(2);
}

const results = [];
function check(id, ok, detail) {
  results.push({ id, ok: Boolean(ok), detail: String(detail === undefined ? '' : detail) });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + id + (detail === undefined ? '' : '  — ' + detail));
}
const fmt = (n) => n.toFixed(2).replace('.', ',') + ' €';
const parseEuro = (s) => parseFloat(String(s).replace(/[^0-9,]/g, '').replace(',', '.'));

// ---- Expressions exécutées dans la page ----
const CAL = "document.querySelector('article[data-no-half] .pizza-widget')";
const sizeBtnCal = (label) => "[...document.querySelectorAll('article[data-no-half] .pizza-widget__size')].find(b => b.textContent.indexOf('" + label + "') === 0)";
const fillerCal = (label) => "[...document.querySelectorAll('article[data-no-half] .pizza-widget__filler-btn')].find(b => b.textContent === '" + label + "')";
const extraCal = (label) => "[...document.querySelectorAll('article[data-no-half] .customize__chip--extra')].find(c => c.textContent === '" + label + "')";
const PIZZA = "[...document.querySelectorAll('.pizza-widget')].find(w => !w.closest('article[data-no-half]'))";
const SESSION_MOCK = "(() => { window.SubitoAccount.me = function () { return Promise.resolve({ city: 'Hénin-Beaumont', first_name: 'Test' }); }; return true; })()";
const GUEST = "(() => { window.SubitoAccount.me = function () { return Promise.resolve(null); }; return true; })()";
// Envoi simulé : aucune requête réseau. Chaque charge utile est enregistrée dans window.__posts.
const ORDER_MOCK = (mode) => "(() => { window.__posts = []; const orig = window.fetch.bind(window); window.fetch = function (url, opts) { if (String(url).indexOf('order_create') !== -1) { window.__posts.push(JSON.parse(opts.body)); if ('" + mode + "' === 'network') return Promise.reject(new TypeError('Failed to fetch (simulé)')); const body = '" + mode + "' === 'token' ? { ok: true, order: { id: 4812 } } : { ok: true, display_number: 12 }; return new Promise(function (resolve) { setTimeout(function () { resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })); }, 400); }); } return orig(url, opts); }; return true; })()";

// ---- Outils de pilotage ----
async function open(page, path = '/menu.html') {
  await page.navigate(BASE + path + (path.indexOf('?') === -1 ? '?t=' : '&t=') + Date.now());
  await page.waitFor("document.querySelectorAll('.pizza-widget').length > 0", 15000);
  await sleep(400);
}
async function resetCart(page) {
  await open(page);
  await page.evaluate("(() => { localStorage.removeItem('subito_cart_v1'); ['subito_pending_order_redirect','subito_pending_order_mode','subito_pending_payment_methods','subito_pending_payment_method','subito_pending_cash_change'].forEach(function (k) { sessionStorage.removeItem(k); }); return true; })()");
  await open(page);
}
async function click(page, expr, label) {
  await page.evaluate("(() => { const el = " + expr + "; if (!el) throw new Error('élément introuvable : " + label + "'); el.click(); return true; })()");
}
const readCart = (page) => page.evaluate("JSON.parse(localStorage.getItem('subito_cart_v1') || '[]')");
const text = (page, expr) => page.evaluate("(() => { const el = " + expr + "; return el ? el.textContent : null; })()");
async function openDrawer(page) {
  await click(page, "document.getElementById('cartBarOpen')", 'barre panier');
  await page.waitFor("!document.getElementById('cartOverlay').hidden", 5000);
  await sleep(200);
}
async function setMode(page, mode) {
  await click(page, "document.querySelector('.order-mode-toggle__btn[data-mode=\"" + mode + "\"]')", 'bascule ' + mode);
  await sleep(300);
}

async function main() {
  const chrome = await launchChrome({ port: 9333, profileDir: PROFILE, width: 1280, height: 900 });
  const page = await newPage(chrome.port, 'about:blank');
  const errors = [];
  page.on((msg) => {
    if (msg.method === 'Runtime.exceptionThrown') errors.push('exception: ' + (msg.params.exceptionDetails.exception ? msg.params.exceptionDetails.exception.description : msg.params.exceptionDetails.text));
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') errors.push('console.error: ' + msg.params.args.map((a) => a.value || a.description || '').join(' '));
  });
  await page.send('Page.enable');
  console.log('Navigateur : ' + chrome.browser + ' · cible : ' + BASE);

  try {
    // T01 — calzone Solo + Thon : ligne, nom et prix
    await resetCart(page);
    await click(page, sizeBtnCal('Solo'), 'taille Solo');
    await click(page, fillerCal('Thon'), 'garniture Thon');
    await click(page, CAL + ".querySelector('.pizza-widget__quickadd')", 'ajout rapide');
    let cart = await readCart(page);
    check('T01 calzone Solo + Thon : nom de ligne et prix', cart.length === 1 && cart[0].name === 'Calzone (soufflée) — Thon' && cart[0].variant === 'Solo' && cart[0].basePrice === 11, JSON.stringify(cart.map((l) => [l.name, l.variant, l.basePrice])));

    // T02 — supplément « + thon » puis changement de taille : prix recalé (4 € en XXL)
    await resetCart(page);
    await click(page, sizeBtnCal('Solo'), 'taille Solo');
    await click(page, fillerCal('Thon'), 'garniture Thon');
    await click(page, CAL + ".querySelector('.pizza-widget__toggle')", 'Personnaliser');
    await page.waitFor(extraCal('+ thon') + " !== undefined", 5000);
    await click(page, extraCal('+ thon'), '+ thon');
    const soloSummary = await text(page, "document.querySelector('article[data-no-half] .customize__summary')");
    await click(page, sizeBtnCal('XXL'), 'taille XXL');
    await page.waitFor("document.querySelector('article[data-no-half] .customize__summary').textContent.indexOf('37,00') !== -1", 5000).catch(() => {});
    const xxlSummary = await text(page, "document.querySelector('article[data-no-half] .customize__summary')");
    await click(page, "document.querySelector('article[data-no-half] .customize__panel .customize__add')", 'Ajouter au panier');
    cart = await readCart(page);
    const extraPrice = cart[0] && cart[0].extras[0] ? cart[0].extras[0].price : null;
    check('T02 supplément recalé : 1,50 € en Solo, 4 € en XXL', soloSummary.indexOf('12,50') !== -1 && extraPrice === 4 && cart[0].basePrice === 33, 'Solo : ' + soloSummary.slice(-22) + ' · XXL : ' + xxlSummary.slice(-22) + ' · extra=' + extraPrice);

    // T03 — sans garniture : ajout bloqué
    await resetCart(page);
    await click(page, sizeBtnCal('Solo'), 'taille Solo');
    const quickDisabled = await page.evaluate("document.querySelector('article[data-no-half] .pizza-widget__quickadd').disabled");
    await click(page, CAL + ".querySelector('.pizza-widget__quickadd')", 'ajout rapide bloqué').catch(() => {});
    cart = await readCart(page);
    check('T03 calzone sans garniture : ajout rapide désactivé et panier vide', quickDisabled === true && cart.length === 0, 'désactivé=' + quickDisabled + ' lignes=' + cart.length);

    // T04 — pizza à emporter : 2 identiques, une offerte (promo 1 achetée = 1 offerte)
    await resetCart(page);
    const pizzaName = await page.evaluate("(() => { const w = " + PIZZA + "; return w.closest('.menu-item').querySelector('.menu-item__name').textContent.trim(); })()");
    await click(page, PIZZA + ".querySelectorAll('.pizza-widget__size')[0]", 'taille Solo pizza');
    await click(page, PIZZA + ".querySelector('.pizza-widget__quickadd')", 'ajout rapide pizza');
    await click(page, PIZZA + ".querySelector('.pizza-widget__quickadd')", 'ajout rapide pizza (2e)');
    await sleep(300);
    cart = await readCart(page);
    const barTotal = await text(page, "document.getElementById('cartBarTotal')");
    const soloPrice = cart[0] ? cart[0].basePrice : null;
    check('T04 à emporter : 2 pizzas identiques = 1 ligne, total d\'une pizza', cart.length === 1 && cart[0].qty === 2 && barTotal === fmt(soloPrice), pizzaName + ' · qté=' + (cart[0] && cart[0].qty) + ' · barre=' + barTotal + ' · attendu=' + fmt(soloPrice));

    // T05 — livraison : minimum de Hénin-Beaumont (10 €) et frais de 5,50 € sans pizza
    await resetCart(page);
    const cheapest = await page.evaluate(`(() => {
      const items = [...document.querySelectorAll('.menu-item')].filter(function (a) { return a.querySelector('.menu-item__price') && !a.closest('#pizzas') && a.querySelector('.add-to-cart__btn'); });
      if (!items.length) return null;
      items.sort(function (x, y) { return parseFloat(x.querySelector('.menu-item__price').textContent.replace(/[^0-9,]/g, '').replace(',', '.')) - parseFloat(y.querySelector('.menu-item__price').textContent.replace(/[^0-9,]/g, '').replace(',', '.')); });
      items[0].setAttribute('data-e2e', 'produit-test');
      return { name: items[0].querySelector('.menu-item__name').textContent.trim(), price: items[0].querySelector('.menu-item__price').textContent.trim() };
    })()`);
    if (!cheapest) {
      check('T05 produit hors pizza à prix fixe trouvé', false, 'aucun produit à prix fixe avec bouton d\'ajout');
    } else {
      const unit = parseEuro(cheapest.price);
      await click(page, "document.querySelector('[data-e2e=\"produit-test\"] .add-to-cart__btn')", 'produit à prix fixe');
      await sleep(200);
      await session(page);
      await openDrawer(page);
      await setMode(page, 'delivery');
      await page.waitFor("document.getElementById('deliveryStatus') && document.getElementById('deliveryStatus').textContent.indexOf('Vérification') === -1", 5000).catch(() => {});
      await sleep(300);
      const status1 = await text(page, "document.getElementById('deliveryStatus')");
      const total1 = await text(page, "document.querySelector('#cartDrawerFooter .cart-drawer__total strong')");
      const expected1 = unit + 5.5;
      check('T05a livraison sans pizza : frais 5,50 € ajoutés au total', total1 === fmt(expected1), 'statut=' + (status1 || '').trim().slice(0, 90) + ' · total=' + total1 + ' · attendu=' + fmt(expected1));
      // Quantité jusqu'au minimum
      const needed = Math.ceil(10 / unit);
      for (let i = 1; i < needed; i += 1) await click(page, "document.querySelector('.cart-line__inc')", '+ quantité');
      await sleep(300);
      const status2 = await text(page, "document.getElementById('deliveryStatus')");
      const total2 = await text(page, "document.querySelector('#cartDrawerFooter .cart-drawer__total strong')");
      const expected2 = needed * unit + 5.5;
      check('T05b minimum atteint : statut sans manque et total = produits + 5,50 €', (status2 || '').indexOf('il manque') === -1 && /Livraison disponible/.test(status2 || '') && total2 === fmt(expected2), 'quantité=' + needed + ' · statut=' + (status2 || '').trim().slice(0, 70) + ' · total=' + total2 + ' · attendu=' + fmt(expected2));
    }

    // T06 — livraison avec pizza : pas de frais
    await resetCart(page);
    await session(page);
    await click(page, PIZZA + ".querySelectorAll('.pizza-widget__size')[0]", 'taille Solo pizza');
    await click(page, PIZZA + ".querySelector('.pizza-widget__quickadd')", 'ajout pizza');
    await openDrawer(page);
    await setMode(page, 'delivery');
    await sleep(500);
    const totalPizza = await text(page, "document.querySelector('#cartDrawerFooter .cart-drawer__total strong')");
    const pizzaSolo = (await readCart(page))[0].basePrice;
    check('T06 livraison avec pizza : aucun frais ajouté', totalPizza === fmt(pizzaSolo), 'total=' + totalPizza + ' · attendu=' + fmt(pizzaSolo));

    // T07 — double clic sur « Commander en ligne » : une seule commande envoyée
    await resetCart(page);
    await session(page);
    await click(page, sizeBtnCal('Solo'), 'taille Solo');
    await click(page, fillerCal('Thon'), 'garniture Thon');
    await click(page, CAL + ".querySelector('.pizza-widget__quickadd')", 'ajout');
    await page.evaluate(ORDER_MOCK('ok'));
    await openDrawer(page);
    await page.evaluate("(() => { const b = document.getElementById('checkoutOrder'); if (!b) return false; b.click(); b.click(); return true; })()");
    await sleep(1500);
    const posts7 = await page.evaluate('window.__posts.length');
    check('T07 double clic : une seule requête d\'envoi', posts7 === 1, 'requêtes=' + posts7);

    // T08 — erreur réseau : message clair, panier conservé
    await resetCart(page);
    await session(page);
    await click(page, sizeBtnCal('Solo'), 'taille Solo');
    await click(page, fillerCal('Thon'), 'garniture Thon');
    await click(page, CAL + ".querySelector('.pizza-widget__quickadd')", 'ajout');
    await page.evaluate(ORDER_MOCK('network'));
    await openDrawer(page);
    await page.evaluate("document.getElementById('checkoutOrder').click()");
    await sleep(1200);
    const status8 = await text(page, "document.getElementById('checkoutOrderStatus')");
    const cart8 = await readCart(page);
    check('T08 erreur réseau : message d\'erreur et panier conservé', /Connexion interrompue/.test(status8 || '') && cart8.length === 1, 'message=' + (status8 || '').trim().slice(0, 60) + ' · lignes=' + cart8.length);

    // T09 — réponse sans jeton : aucun faux succès, panier conservé
    await resetCart(page);
    await session(page);
    await click(page, sizeBtnCal('Solo'), 'taille Solo');
    await click(page, fillerCal('Thon'), 'garniture Thon');
    await click(page, CAL + ".querySelector('.pizza-widget__quickadd')", 'ajout');
    await page.evaluate(ORDER_MOCK('ok'));
    await openDrawer(page);
    await page.evaluate("document.getElementById('checkoutOrder').click()");
    await sleep(1500);
    const status9 = await text(page, "document.getElementById('checkoutOrderStatus')");
    const cart9 = await readCart(page);
    check('T09 réponse sans jeton : erreur, panier intact, bouton réactivé', /Connexion interrompue|n.a pas fonctionné/.test(status9 || '') && cart9.length === 1 && (await page.evaluate("document.getElementById('checkoutOrder').disabled")) === false, 'message=' + (status9 || '').trim().slice(0, 70) + ' · lignes=' + cart9.length + ' · bouton=' + (await page.evaluate("(document.getElementById('checkoutOrder') || {}).disabled")));

    // T10 — réponse avec jeton : redirection vers le suivi, panier vidé
    await resetCart(page);
    await session(page);
    await click(page, sizeBtnCal('Solo'), 'taille Solo');
    await click(page, fillerCal('Thon'), 'garniture Thon');
    await click(page, CAL + ".querySelector('.pizza-widget__quickadd')", 'ajout');
    await page.evaluate(ORDER_MOCK('token'));
    await openDrawer(page);
    await page.evaluate("document.getElementById('checkoutOrder').click()");
    await page.waitFor("location.pathname.indexOf('commande.html') !== -1", 8000).catch(() => {});
    await sleep(400);
    const url10 = await page.evaluate('location.pathname + location.search');
    const cart10 = await page.evaluate("localStorage.getItem('subito_cart_v1')");
    check('T10 réponse avec identifiant : redirection vers le suivi (commande.html?id=4812) et panier vidé', url10 === '/commande.html?id=4812' && (cart10 === '[]' || cart10 === null), 'url=' + url10 + ' · panier=' + cart10);

    // T11 — actualisation : le panier est conservé
    await resetCart(page);
    await click(page, sizeBtnCal('Solo'), 'taille Solo');
    await click(page, fillerCal('Poulet'), 'garniture Poulet');
    await click(page, CAL + ".querySelector('.pizza-widget__quickadd')", 'ajout');
    await open(page);
    const cart11 = await readCart(page);
    check('T11 actualisation : panier conservé', cart11.length === 1 && cart11[0].name === 'Calzone (soufflée) — Poulet', 'lignes=' + cart11.length);

    // T12 — sans compte : la commande redirige vers la connexion (exigence explicite), aucun envoi
    await page.evaluate("localStorage.removeItem('subito_order_attempt')");
    await resetCart(page);
    await page.evaluate(GUEST);
    await click(page, sizeBtnCal('Solo'), 'taille Solo');
    await click(page, fillerCal('Thon'), 'garniture Thon');
    await click(page, CAL + ".querySelector('.pizza-widget__quickadd')", 'ajout');
    await page.evaluate(ORDER_MOCK('ok'));
    await openDrawer(page);
    await page.evaluate("document.getElementById('checkoutOrder').click()");
    await page.waitFor("location.pathname.indexOf('compte.html') !== -1", 8000).catch(() => {});
    const url12 = await page.evaluate('location.pathname + location.search');
    // Le drapeau de reprise posé avant la connexion prouve que la branche invité s'est arrêtée avant l'envoi.
    const pending12 = await page.evaluate("sessionStorage.getItem('subito_pending_order_redirect')");
    // Pas de clé d'envoi créée : la branche invité s'arrête avant submitOrder (aucune requête d'envoi possible).
    const tentative12 = await page.evaluate("localStorage.getItem('subito_order_attempt')");
    check('T12 invité : redirection vers compte.html avec retour, aucun envoi', url12.indexOf('compte.html?retour=') !== -1 && /^\d{10,}$/.test(pending12 || '') && tentative12 === null, 'url=' + url12 + ' · drapeau=' + pending12 + ' · tentative=' + tentative12);

    // T13 — restaurant : l'indicateur « COMMANDES FERMÉES » et le bouton de commande doivent concorder
    await resetCart(page);
    await session(page);
    const closedBanner = await page.evaluate("/commandes\\s+ferm/i.test(document.body.textContent)");
    const hour = await page.evaluate("new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' }).format(new Date())");
    await click(page, sizeBtnCal('Solo'), 'taille Solo');
    await click(page, fillerCal('Thon'), 'garniture Thon');
    await click(page, CAL + ".querySelector('.pizza-widget__quickadd')", 'ajout');
    await openDrawer(page);
    const orderEnabled = await page.evaluate("!document.getElementById('checkoutOrder').disabled");
    check("T13 horaires : l'indicateur « fermé » et le bouton de commande concordent (hors horaires, la commande doit être bloquée)", closedBanner === !orderEnabled, 'heure Paris=' + hour + ' · bandeau fermé=' + closedBanner + ' · commande possible=' + orderEnabled);

    // T14 — produit devenu indisponible après ajout au panier
    await resetCart(page);
    await session(page);
    const pizzaLabel = await page.evaluate("(() => { const w = " + PIZZA + "; return w.closest('.menu-item').querySelector('.menu-item__name').textContent.trim(); })()");
    await click(page, PIZZA + ".querySelectorAll('.pizza-widget__size')[0]", 'taille pizza');
    await click(page, PIZZA + ".querySelector('.pizza-widget__quickadd')", 'ajout pizza');
    await setDispo(page, { pizzasIndisponibles: [pizzaLabel], ingredientsIndisponibles: [] });
    await page.evaluate(ORDER_MOCK('ok'));
    await openDrawer(page);
    await page.evaluate("document.getElementById('checkoutOrder').click()");
    await sleep(1500);
    const posts14 = await page.evaluate('window.__posts.length ? window.__posts[0].items.map(function (i) { return i.name; }) : []');
    const statut14 = await text(page, "document.getElementById('checkoutOrderStatus')");
    await clearDispo(page);
    // Passe seulement si la commande est partie sans ce produit, ou si elle a été bloquée avec un message explicite.
    const sansProduit = posts14.length === 1 && !posts14.some((n) => n.indexOf(pizzaLabel) !== -1);
    const bloqueeAvecMessage = posts14.length === 0 && /indisponible|retir|plus disponible/i.test(statut14 || '');
    check('T14 produit indisponible : ne doit pas partir dans une commande', sansProduit || bloqueeAvecMessage, 'pizza=' + pizzaLabel + ' · articles envoyés=' + JSON.stringify(posts14) + ' · message=' + (statut14 || '').trim().slice(0, 60));

    // T15 — mobile : pas de défilement horizontal, cibles tactiles
    await page.setViewport(375, 812, true, 1);
    await resetCart(page);
    await sleep(500);
    const overflow = await page.evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth');
    await page.screenshot(OUT_DIR + '/mobile-menu.png');
    const small = await page.evaluate(`(() => {
      const els = [...document.querySelectorAll('button, a[href], input, select')].filter(function (e) { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
      const under24 = els.filter(function (e) { const r = e.getBoundingClientRect(); return r.width < 24 || r.height < 24; }).length;
      const under44 = els.filter(function (e) { const r = e.getBoundingClientRect(); return r.width < 44 || r.height < 44; }).length;
      return { total: els.length, under24: under24, under44: under44 };
    })()`);
    check('T15 mobile 375 px : pas de défilement horizontal', overflow <= 0, 'débordement=' + overflow + 'px');
    check('T15b cibles tactiles visibles au moins 24 px (WCAG 2.2 2.5.8, niveau AA)', small.under24 === 0, 'trop petites (<24 px)=' + small.under24 + ' sur ' + small.total + ' · sous 44 px=' + small.under44);
    await page.setViewport(1280, 900, false, 1);

    // T16 — mobile : le panier et la validation tiennent dans l'écran
    await session(page);
    await click(page, sizeBtnCal('Solo'), 'taille Solo');
    await click(page, fillerCal('Thon'), 'garniture Thon');
    await click(page, CAL + ".querySelector('.pizza-widget__quickadd')", 'ajout');
    await page.setViewport(375, 812, true, 1);
    await openDrawer(page);
    await sleep(300);
    const drawerOverflow = await page.evaluate("(() => { const d = document.querySelector('.cart-drawer'); return d ? d.scrollWidth - d.clientWidth : 0; })()");
    await page.screenshot(OUT_DIR + '/mobile-panier.png');
    check('T16 mobile : le tiroir du panier ne déborde pas', drawerOverflow <= 0, 'débordement=' + drawerOverflow + 'px');
  } catch (error) {
    check('ERREUR D\'EXÉCUTION', false, error.message);
  } finally {
    await page.send('Fetch.disable').catch(() => {});
    page.close();
    chrome.proc.kill();
  }

  const passed = results.filter((r) => r.ok).length;
  const summary = { base: BASE, date: new Date().toISOString(), navigateur: 'Chrome headless', total: results.length, passes: passed, echecs: results.length - passed, pageErrors: errors.slice(0, 20), resultats: results };
  fs.writeFileSync(OUT_DIR + '/resultats-parcours.json', JSON.stringify(summary, null, 2));
  console.log('\nBilan : ' + passed + ' / ' + results.length + ' réussis · erreurs JavaScript captées : ' + errors.length);
  console.log('Détail : ' + OUT_DIR + '/resultats-parcours.json');
  process.exitCode = passed === results.length ? 0 : 1;
}

// Session simulée (aucun compte réel) ; utilisée seulement sur la page courante.
async function session(page) {
  await page.evaluate(SESSION_MOCK);
}

// Disponibilité simulée par interception (la source réelle n'est jamais modifiée).
async function setDispo(page, data) {
  await page.send('Fetch.enable', { patterns: [{ urlPattern: '*disponibilite.json*', requestStage: 'Request' }] });
  page.on((msg) => {
    if (msg.method === 'Fetch.requestPaused') {
      const body = Buffer.from(JSON.stringify(Object.assign({ commentaire: 'test', misAJourLe: '2026-11-19' }, data))).toString('base64');
      page.send('Fetch.fulfillRequest', { requestId: msg.params.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }], body });
    }
  });
  await open(page);
  await page.waitFor("document.documentElement.classList.contains('dispo-pret')", 8000).catch(() => {});
  await session(page);
}
async function clearDispo(page) {
  await page.send('Fetch.disable').catch(() => {});
}

main().catch((error) => {
  console.error('Échec du lancement : ' + error.message);
  process.exit(1);
});
