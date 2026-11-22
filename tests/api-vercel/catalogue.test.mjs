// Catalogue serveur des prix et disponibilités (api/data/catalogue.json, serveur/catalogue.js, serveur/orders.js).
// Version JavaScript (Vercel + Postgres) de tests/api/catalogue.test.mjs. Lancer depuis la racine du dépôt :
//   $env:SUBITO_CATALOGUE_TEST_PORT='18420'; node --test "tests/api-vercel/catalogue.test.mjs"
// Port : SUBITO_CATALOGUE_TEST_PORT, sinon SUBITO_TEST_PORT + 2 (les fichiers de tests tournent en parallèle, chacun son port).
// Le port 18091 (tests navigateur) n'est jamais utilisé.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';

let port = Number(process.env.SUBITO_CATALOGUE_TEST_PORT || (Number(process.env.SUBITO_TEST_PORT || 8091) + 2));
while (port === 18091) port += 1;

process.env.SUBITO_TEST_PORT = String(port);
const { ROOT, Client, OWNER_CODE, makeEnv, openTestDb, runTool, startServer, stopServer } = await import('./lib/harness.mjs');
const { DELIVERY_ZONES, normName } = await import('../../serveur/util.js');
const { computeOrderTotals } = await import('../../serveur/orders.js');

const CATALOGUE_FILE = path.join(ROOT, 'api', 'data', 'catalogue.json');
const catalogue = JSON.parse(readFileSync(CATALOGUE_FILE, 'utf8'));
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');
const randomPassword = () => Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(18))).toString('base64url') + 'Aa1!';
const CUSTOMER_PASSWORD = randomPassword();

let ctx;
let server;
let db;
const owner = new Client('owner');
const cust = new Client('cust');

let keySeq = 0;
const newKey = () => `cat-key-${Date.now()}-${++keySeq}`;
const line = (name, variant, cents, extra = {}) => ({ name, variant, qty: 1, unit_price_cents: cents, removed: [], extras: [], half: null, note: '', ...extra });

// Total attendu, mêmes règles que orderTotalsCents() de cart.js (à emporter / livraison sans frais).
function totalCents(items, mode = 'pickup') {
  let gross = 0;
  const units = [];
  for (const it of items) {
    gross += it.unit_price_cents * it.qty;
    if (it.variant) for (let i = 0; i < it.qty; i++) units.push(it.unit_price_cents);
  }
  units.sort((a, b) => b - a);
  let promo = 0;
  for (let i = 0; i + 1 < units.length; i += 2) promo += mode === 'delivery' ? Math.floor((units[i + 1] + 1) / 2) : units[i + 1];
  return gross - promo;
}
const body = (items, over = {}) => ({
  idempotency_key: newKey(), mode: 'pickup', payment_methods: [], cash_change_for: null,
  hot_sauce: over.mode === 'delivery' ? true : null,
  items, delivery_fee_cents: 0, total_cents: totalCents(items), ...over,
});
const countOrders = () => Number(db.prepare('SELECT COUNT(*) AS n FROM orders').get().n);
// La limite de 20 envois / 10 min par client n'est pas l'objet de ces tests.
const resetThrottle = () => db.exec('DELETE FROM throttle');
async function order(items, over = {}) {
  resetThrottle();
  return cust.post('order_create.php', body(items, over));
}
function expectError(r, status, code) {
  assert.equal(r.status, status, `${r.method} ${r.route} : ${r.text}`);
  assert.equal(r.json?.ok, false);
  assert.equal(r.json?.error, code, r.text);
  assert.equal(typeof r.json?.message, 'string');
}
async function setAvailability(kind, name, status) {
  const r = await owner.post('owner_availability.php', { kind, name, status });
  assert.equal(r.status, 200, r.text);
}

async function prepare(env) {
  assert.equal((await runTool(env, 'install.php')).code, 0);
  const s = await startServer(env);
  const su = await cust.post('customer_signup.php', {
    first_name: 'Cata', last_name: 'Logue', email: `cata${Date.now()}@example.test`, phone: '06 00 00 00 09',
    password: CUSTOMER_PASSWORD, street: '1 rue du test', city: 'Hénin-Beaumont', housing_type: 'maison',
  });
  assert.equal(su.status, 201, su.text);
  return s;
}

before(async () => {
  ctx = makeEnv();
  server = await prepare(ctx);
  // Pas d'outil create_owner : le commerçant se connecte avec le code patron (OWNER_CODE_HASH du harnais).
  assert.equal((await owner.post('owner_login.php', { code: OWNER_CODE, remember: false })).status, 200);
  db = openTestDb(ctx);
});

after(() => {
  stopServer(server);
  try { db?.close(); } catch { /* déjà fermée */ }
});

// ---------------------------------------------------------------- génération
test('le script de build, relancé, produit le même JSON', () => {
  const dir = mkdtempSync(path.join(process.env.SUBITO_TEST_DIR || tmpdir(), 'subito-cat-'));
  const out = path.join(dir, 'catalogue.json');
  const r = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'build-catalogue.mjs'), '--out', out], { encoding: 'utf8', cwd: ROOT });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readFileSync(out, 'utf8'), readFileSync(CATALOGUE_FILE, 'utf8'));
  const check = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'build-catalogue.mjs'), '--check'], { encoding: 'utf8', cwd: ROOT });
  assert.equal(check.status, 0, check.stderr);
});

test('catalogue conforme aux pages (lecture indépendante)', () => {
  const menu = read('menu.html');
  const euros = (t) => { const m = t.match(/(\d+)(?:,(\d{2}))?\s*€/); return Number(m[1]) * 100 + Number(m[2] || 0); };
  // Tailles : menu.html, lignes 166 à 184.
  const sizes = [...menu.matchAll(/size-chart__name">([^<]+)<[\s\S]*?size-chart__price">([^<]+)</g)].map((m) => ({ name: m[1], price_cents: euros(m[2]) }));
  assert.deepEqual(catalogue.sizes, sizes);
  // Prix de fiche (desserts, boissons).
  const own = [...menu.matchAll(/menu-item__name"[^>]*>([^<]+)<\/h3>(?:(?!<\/article>)[\s\S])*?menu-item__price">([^<]+)</g)]
    .map((m) => [m[1].replace(/&amp;/g, '&'), euros(m[2])]);
  assert.ok(own.length >= 7);
  for (const [name, cents] of own) {
    const p = catalogue.products.find((x) => x.name === name);
    assert.ok(p, name);
    assert.equal(p.price_cents, cents, name);
  }
  // Suppléments : supplements.html, lignes 83 à 101.
  const supp = read('supplements.html');
  const rows = [...supp.matchAll(/compose-price-row__name">([^<]+)<\/span><span class="compose-price-row__price">([^<]+)</g)].map((m) => [m[1], euros(m[2])]);
  const fromCat = catalogue.supplement_groups.flatMap((g) => Object.entries(g.prices_by_size));
  assert.deepEqual(fromCat, rows);
  // Zones : identiques à DELIVERY_ZONES (serveur/util.js, qui reprend util.php) et à cart.js.
  const zones = Object.entries(DELIVERY_ZONES).map(([city, z]) => ({ city, minimum_cents: z.minimum_cents, fee_cents: z.fee_cents }));
  assert.equal(zones.length, 8);
  assert.deepEqual(catalogue.zones, zones);
  // vegetarien.html commande les mêmes pizzas : mêmes noms, mêmes ingrédients, mêmes tailles.
  const veg = read('vegetarien.html');
  const vegSizes = [...veg.matchAll(/size-chart__name">([^<]+)<[\s\S]*?size-chart__price">([^<]+)</g)].map((m) => ({ name: m[1], price_cents: euros(m[2]) }));
  assert.deepEqual(vegSizes, catalogue.sizes);
  const vegPizzas = [...veg.matchAll(/menu-item__name">([^<]+)<\/h2>\s*<p class="menu-item__ingredients">([^<]+)</g)];
  assert.ok(vegPizzas.length >= 5);
  for (const [, name, ings] of vegPizzas) {
    const p = catalogue.products.find((x) => x.kind === 'pizza' && x.name === name);
    assert.ok(p, name);
    assert.deepEqual(p.ingredients, ings.split(',').map((s) => s.trim()), name);
  }
});

// ---------------------------------------------------------------- positifs
test('chaque article commandable, au prix affiché, est accepté', async () => {
  const lines = [];
  for (const p of catalogue.products.filter((x) => x.orderable)) {
    if (p.kind === 'pizza') {
      catalogue.sizes.forEach((s, k) => {
        const name = p.choice ? `${p.line_name} — ${p.choice.options[k % p.choice.options.length].replace(/^./, (c) => c.toUpperCase())}` : p.line_name;
        lines.push(line(name, s.name, p.prices_by_size[s.name]));
      });
      if (p.choice) for (const opt of p.choice.options) lines.push(line(`${p.line_name} — ${opt.charAt(0).toUpperCase()}${opt.slice(1)}`, 'Duo', p.prices_by_size.Duo));
    } else {
      lines.push(line(p.line_name, '', p.price_cents));
    }
  }
  assert.ok(lines.length > 100, `lignes : ${lines.length}`);
  let created = 0;
  for (let i = 0; i < lines.length; i += 40) {
    const chunk = lines.slice(i, i + 40);
    const r = await order(chunk);
    assert.equal(r.status, 201, r.text);
    assert.deepEqual(r.json.order.items.map((x) => [x.name, x.unit_price_cents]), chunk.map((x) => [x.name, x.unit_price_cents]));
    created++;
  }
  assert.ok(created >= 3);
});

test('remise de substitution : prix calculé comme cart.js (applySwapDiscount)', async () => {
  // Calcul à la main d'après applySwapDiscount() (cart.js, ligne 634) :
  // Régina Solo 11,00 € (sauce tomate, fromage, jambon, champignons), sans jambon ni champignons
  // → 1 crédit « viandes, poissons et fromages » (jambon) et 1 crédit « légumes et sauces » (Champignons).
  // Suppléments, dans l'ordre : poulet (viandes, crédit → 0), oignons (légumes, crédit → 0),
  // thon (viandes, plus de crédit → 1,50 € en Solo), olives (légumes, plus de crédit → 1,00 € en Solo).
  // Prix unitaire : 11,00 + 0 + 0 + 1,50 + 1,00 = 13,50 €.
  const swap = line('Régina', 'Solo', 1350, {
    removed: ['jambon', 'champignons'],
    extras: [
      { name: 'poulet', price_cents: 0, qty: 1 },
      { name: 'oignons', price_cents: 0, qty: 1 },
      { name: 'thon', price_cents: 150, qty: 1 },
      { name: 'olives', price_cents: 100, qty: 1 },
    ],
  });
  const ok = await order([swap]);
  assert.equal(ok.status, 201, ok.text);
  assert.equal(ok.json.order.items[0].unit_price_cents, 1350);

  // Jamais d'un groupe à l'autre : retirer des champignons (légumes) ne paie pas du jambon (viandes).
  // Régina Solo 11,00 + jambon 1,50 = 12,50 €. Une astérisque résiduelle (« jambon* ») reste reconnue.
  const cross = { removed: ['champignons'], extras: [{ name: 'jambon*', price_cents: 150, qty: 1 }] };
  assert.equal((await order([line('Régina', 'Solo', 1250, cross)])).status, 201);
  const crossFree = await order([line('Régina', 'Solo', 1100, { ...cross, extras: [{ name: 'jambon', price_cents: 0, qty: 1 }] })]);
  expectError(crossFree, 422, 'price_mismatch_line');
  assert.equal(crossFree.json.expected_unit_cents, 1250);

  // Un retrait d'ingrédient absent de la pizza est refusé (Régina n'a pas de thon) : pas de crédit fantôme.
  const ghost = await order([line('Régina', 'Solo', 1100, { removed: ['thon'], extras: [{ name: 'thon', price_cents: 0, qty: 1 }] })]);
  expectError(ghost, 422, 'validation');
  assert.ok(ghost.json.fields['items[0].removed']);

  // Moitié-moitié Duo (16,00 €) Régina / 4 Fromages : retirer le brie de la deuxième moitié
  // paie un « bleu » (même groupe) → 16,00 €.
  const half = line('Régina', 'Duo', 1600, {
    half: { flavor1: 'Régina', flavor2: '4 Fromages' }, removed: ['brie'], extras: [{ name: 'bleu', price_cents: 0, qty: 1 }],
  });
  assert.equal((await order([half])).status, 201);
});

// Section 4 de la mission du 22/11/2026 : 4 bases proposées (tomate/crème fraîche/barbecue/curry) sur
// "Personnaliser ma pizza" (assets/js/cart.js, buildPizzaWidget). Implémenté entièrement au-dessus du
// mécanisme d'échange existant (removed + extras + applySwapDiscount) : aucune route ni règle de prix
// nouvelle côté serveur — ce test le prouve plutôt que de le supposer, à toutes les tailles, puisque les 4
// sauces partagent un seul groupe de suppléments ("Légumes et sauces") avec un prix identique chacune.
test('changement de base (tomate/crème fraîche/barbecue/curry) : toujours gratuit, à toutes les tailles', async () => {
  const prices = { Solo: 1100, Duo: 1600, Quatro: 2300, XXL: 3300 };
  for (const variant of Object.keys(prices)) {
    const r = await order([line('Régina', variant, prices[variant], {
      removed: ['Sauce tomate'], extras: [{ name: 'sauce curry', price_cents: 0, qty: 1 }]
    })]);
    assert.equal(r.status, 201, `${variant} : ${r.text}`);
    assert.equal(r.json.order.items[0].unit_price_cents, prices[variant]);
  }

  // Carolina (menu.html renommé « Base barbecue » -> « Sauce barbecue » le 22/11/2026, pour que cette
  // pizza participe au même sélecteur) : son barbecue d'origine retiré, curry ajouté, toujours gratuit.
  const carolina = catalogue.products.find((p) => p.name === 'Carolina');
  assert.equal(carolina.ingredients[0], 'Sauce barbecue', 'le catalogue doit refléter le renommage du menu');
  const carolinaPrice = carolina.prices_by_size.Duo;
  const rCarolina = await order([line('Carolina', 'Duo', carolinaPrice, {
    removed: ['Sauce barbecue'], extras: [{ name: 'sauce tomate', price_cents: 0, qty: 1 }]
  })]);
  assert.equal(rCarolina.status, 201, rCarolina.text);

  // Indienne garde sa base composée telle quelle (pas de sélecteur, décision assumée) : son ingrédient
  // "Base crème fraîche/curry" n'est volontairement reconnu par aucun des 4 noms de base.
  const indienne = catalogue.products.find((p) => p.name === 'Indienne');
  assert.equal(indienne.ingredients[0], 'Base crème fraîche/curry');
});

// ---------------------------------------------------------------- négatifs
test('prix faux d\'un centime : 422 price_mismatch_line avec l\'index, rien d\'enregistré', async () => {
  const before = countOrders();
  const items = [line('Régina', 'Solo', 1100), line('Canette Oasis pomme poire', '', 151)];
  const r = await order(items);
  expectError(r, 422, 'price_mismatch_line');
  assert.equal(r.json.index, 1);
  assert.equal(r.json.name, 'Canette Oasis pomme poire');
  assert.equal(r.json.expected_unit_cents, 150);
  assert.equal(r.json.sent_unit_cents, 151);
  const low = await order([line('Régina', 'Quatro', 2299)]);
  expectError(low, 422, 'price_mismatch_line');
  assert.equal(low.json.index, 0);
  assert.equal(low.json.expected_unit_cents, 2300);
  // Taille vraie, mais prix d'une autre taille.
  expectError(await order([line('Régina', 'XXL', 2300)]), 422, 'price_mismatch_line');
  // La base composée a ses propres prix (composer.html), pas ceux de la carte.
  expectError(await order([line('Marguerita (base)', 'Solo', 1100)]), 422, 'price_mismatch_line');
  assert.equal((await order([line('Marguerita (base)', 'Solo', 900)])).status, 201);
  assert.equal(countOrders(), before + 1);
});

test('supplément au prix modifié : refusé', async () => {
  const before = countOrders();
  // olives en Duo : 1,50 € ; envoyé à 1,00 € avec un prix unitaire cohérent avec ce faux prix.
  const r = await order([line('Régina', 'Duo', 1700, { extras: [{ name: 'olives', price_cents: 100, qty: 1 }] })]);
  expectError(r, 422, 'price_mismatch_line');
  assert.equal(r.json.expected_unit_cents, 1750);
  assert.equal(r.json.sent_unit_cents, 1700);
  // Prix unitaire juste mais supplément annoncé gratuit sans substitution.
  const r2 = await order([line('Régina', 'Duo', 1750, { extras: [{ name: 'olives', price_cents: 0, qty: 1 }] })]);
  expectError(r2, 422, 'price_mismatch_line');
  assert.equal(countOrders(), before);
  assert.equal((await order([line('Régina', 'Duo', 1750, { extras: [{ name: 'olives', price_cents: 150, qty: 1 }] })])).status, 201);
});

test('article inconnu : 422 unknown_item', async () => {
  const before = countOrders();
  const r = await order([line('Régina', 'Solo', 1100), line('Pizza Licorne', 'Duo', 1600)]);
  expectError(r, 422, 'unknown_item');
  assert.equal(r.json.name, 'Pizza Licorne');
  expectError(await order([line('Margherita', 'Duo', 1600)]), 422, 'unknown_item');
  // Une pizza sans taille, un produit avec une taille : inconnus sous cette forme.
  expectError(await order([line('Régina', '', 1100)]), 422, 'unknown_item');
  expectError(await order([line('Canette Oasis pomme poire', 'Solo', 150)]), 422, 'unknown_item');
  // Calzone sans garniture, ou avec une garniture absente de la fiche.
  expectError(await order([line('Calzone (soufflée)', 'Duo', 1600)]), 422, 'unknown_item');
  expectError(await order([line('Calzone (soufflée) — Saumon', 'Duo', 1600)]), 422, 'unknown_item');
  // Supplément absent de supplements.html, ou ajouté à un produit sans taille.
  const ex = await order([line('Régina', 'Duo', 1800, { extras: [{ name: 'caviar', price_cents: 200, qty: 1 }] })]);
  expectError(ex, 422, 'unknown_item');
  assert.equal(ex.json.name, 'caviar');
  expectError(await order([line('Pâtes Bolognaise', '', 1000, { extras: [{ name: 'olives', price_cents: 150, qty: 1 }] })]), 422, 'unknown_item');
  // Moitié-moitié avec un parfum absent, ou sur la calzone.
  const h = await order([line('Régina', 'Duo', 1600, { half: { flavor1: 'Régina', flavor2: 'Hawaïenne' } })]);
  expectError(h, 422, 'unknown_item');
  assert.equal(h.json.name, 'Hawaïenne');
  assert.equal(countOrders(), before);
});

test('moitié-moitié en Solo ou sur la calzone : 422 validation, champ items[i].half', async () => {
  const before = countOrders();
  const solo = await order([line('Kebab', 'Solo', 1100), line('Régina', 'Solo', 1100, { half: { flavor1: 'Régina', flavor2: 'Kebab' } })]);
  expectError(solo, 422, 'validation');
  assert.deepEqual(Object.keys(solo.json.fields), ['items[1].half']);
  const calzone = await order([line('Calzone (soufflée) — Thon', 'Duo', 1600, { half: { flavor1: 'Calzone (soufflée)', flavor2: 'Régina' } })]);
  expectError(calzone, 422, 'validation');
  assert.ok(calzone.json.fields['items[0].half']);
  // La calzone n'est jamais proposée en deuxième moitié non plus.
  expectError(await order([line('Régina', 'Duo', 1600, { half: { flavor1: 'Régina', flavor2: 'Calzone (soufflée)' } })]), 422, 'unknown_item');
  assert.equal(countOrders(), before);
  // Duo, Quatro, XXL : prix de la taille.
  for (const [v, c] of [['Duo', 1600], ['Quatro', 2300], ['XXL', 3300]]) {
    assert.equal((await order([line('Régina', v, c, { half: { flavor1: 'Régina', flavor2: 'Kebab' } })])).status, 201);
  }
});

test('prix de catégorie : pâtes 8,50 €, subitowichs 6,00 €, salades 7,50 €, Tex-Mex 5,00 €', () => {
  // Lecture indépendante de chaque section de menu.html : note de prix, sinon titre (comme cart.js).
  const menu = read('menu.html');
  const section = (id) => menu.match(new RegExp(`<section class="menu-category" id="${id}">([\\s\\S]*?)</section>`))[1];
  const euros = (t) => { const m = t.match(/(\d+)(?:,(\d{2}))?\s*€/); return m ? Number(m[1]) * 100 + Number(m[2] || 0) : null; };
  const expected = { pates: 850, subitowichs: 600, salades: 750, 'tex-mex': 500 };
  for (const [id, cents] of Object.entries(expected)) {
    const s = section(id);
    const note = (s.match(/menu-category__price-note">([^<]*)</) || [])[1] || '';
    const title = s.match(/menu-category__title">([\s\S]*?)<\/h2>/)[1].replace(/<[^>]+>/g, '');
    assert.equal(euros(note) ?? euros(title), cents, id);
    const items = catalogue.products.filter((p) => p.category === id);
    assert.ok(items.length > 0, id);
    for (const p of items) assert.deepEqual([p.line_name, p.price_cents, p.orderable], [p.line_name, cents, true]);
  }
  // Aucun billet (choix de monnaie) dans le catalogue.
  assert.equal(JSON.stringify(catalogue).includes('cash'), false);
});

test('livraison : frais sans pizza, offerte avec pizza, minimum sur les produits, promo −50 %', async () => {
  // Client à Hénin-Beaumont : minimum 10,00 €, frais 5,50 € (DELIVERY_ZONES).
  const delivery = { mode: 'delivery', payment_methods: ['card'] };
  // Sans pizza : 8,50 + 1,50 = 10,00 € (minimum atteint, frais exclus) + 5,50 € de frais.
  const noPizza = [line('Pâtes Bolognaise', '', 850), line('Canette Oasis pomme poire', '', 150)];
  const r1 = await order(noPizza, { ...delivery, delivery_fee_cents: 550, total_cents: 1550 });
  assert.equal(r1.status, 201, r1.text);
  assert.deepEqual([r1.json.order.products_cents, r1.json.order.delivery_fee_cents, r1.json.order.total_cents], [1000, 550, 1550]);
  // 8,50 € seuls : minimum non atteint (les frais ne comptent pas).
  const r2 = await order([line('Pâtes Bolognaise', '', 850)], { ...delivery, delivery_fee_cents: 550, total_cents: 1400 });
  expectError(r2, 422, 'minimum_not_reached');
  assert.equal(r2.json.products_after_promo_cents, 850);
  // Avec pizzas : livraison offerte ; paires du plus cher au moins cher, la moins chère à −50 %.
  // Régina Duo 16,00 + Kebab Solo 11,00 → promo 5,50 → 21,50 €.
  const r3 = await order([line('Régina', 'Duo', 1600), line('Kebab', 'Solo', 1100)], { ...delivery, delivery_fee_cents: 0, total_cents: 2150 });
  assert.equal(r3.status, 201, r3.text);
  assert.deepEqual([r3.json.order.promo_cents, r3.json.order.delivery_fee_cents, r3.json.order.total_cents], [550, 0, 2150]);
  // Même panier à emporter : la moins chère offerte → 16,00 €.
  const r4 = await order([line('Régina', 'Duo', 1600), line('Kebab', 'Solo', 1100)]);
  assert.equal(r4.status, 201, r4.text);
  assert.deepEqual([r4.json.order.promo_cents, r4.json.order.total_cents], [1100, 1600]);
});

test('pizza avec un ingrédient fixe en rupture : 422 unavailable_items', async () => {
  await setAvailability('ingredient', 'Champignons', 'out_today');
  const before = countOrders();
  const r = await order([line('Régina', 'Solo', 1100)]);
  expectError(r, 422, 'unavailable_items');
  assert.deepEqual(r.json.unavailable, ['Régina']);
  // Même retiré, l'ingrédient fixe bloque la pizza (même règle que la carte, disponibilite.js).
  expectError(await order([line('Régina', 'Solo', 1100, { removed: ['champignons'] })]), 422, 'unavailable_items');
  // Deuxième moitié concernée.
  const half = await order([line('Kebab', 'Duo', 1600, { half: { flavor1: 'Kebab', flavor2: 'Campione' } })]);
  expectError(half, 422, 'unavailable_items');
  assert.deepEqual(half.json.unavailable, ['Campione']);
  // Supplément en rupture.
  const ex = await order([line('Kebab', 'Solo', 1200, { extras: [{ name: 'Champignons', price_cents: 100, qty: 1 }] })]);
  expectError(ex, 422, 'unavailable_items');
  assert.deepEqual(ex.json.unavailable, ['Champignons']);
  assert.equal(countOrders(), before);
  // Une pizza sans champignons passe.
  assert.equal((await order([line('Kebab', 'Solo', 1100)])).status, 201);
  await setAvailability('ingredient', 'Champignons', 'available');
  assert.equal((await order([line('Régina', 'Solo', 1100)])).status, 201);
});

test('ingrédient en rupture : unavailable_ingredients nomme l\'ingrédient, unavailable la pizza', async () => {
  await setAvailability('ingredient', 'jambon', 'out_today');
  const before = countOrders();
  const r = await order([line('3 Jambons', 'Duo', 1600), line('Canette Oasis pomme poire', '', 150)]);
  expectError(r, 422, 'unavailable_items');
  assert.deepEqual(r.json.unavailable, ['3 Jambons']);
  assert.deepEqual(r.json.unavailable_ingredients, ['jambon']);
  assert.equal(countOrders(), before);
  // Pizza en rupture sans ingrédient en cause : liste d'ingrédients vide.
  await setAvailability('ingredient', 'jambon', 'available');
  await setAvailability('pizza', 'Neptune', 'out_today');
  const p = await order([line('Neptune', 'Solo', 1100)]);
  expectError(p, 422, 'unavailable_items');
  assert.deepEqual([p.json.unavailable, p.json.unavailable_ingredients], [['Neptune'], []]);
  await setAvailability('pizza', 'Neptune', 'available');
});

test('le ticket reçoit les noms du catalogue (ligne, garniture, moitiés)', async () => {
  const r = await order([
    line('calzone (SOUFFLÉE) — thon', 'Duo', 1600),
    line('régina', 'Duo', 1600, { half: { flavor1: 'REGINA', flavor2: '4 fromages' } }),
    line('CANETTE oasis POMME poire', '', 150),
  ]);
  assert.equal(r.status, 201, r.text);
  const items = r.json.order.items;
  assert.deepEqual(items.map((x) => x.name), ['Calzone (soufflée) — Thon', 'Régina', 'Canette Oasis pomme poire']);
  assert.deepEqual(items[1].half, { flavor1: 'Régina', flavor2: '4 Fromages' });
  const stored = db.prepare('SELECT name, half_json FROM order_items WHERE order_id = ? ORDER BY position').all(r.json.order.id);
  assert.deepEqual(stored.map((x) => x.name), ['Calzone (soufflée) — Thon', 'Régina', 'Canette Oasis pomme poire']);
  assert.deepEqual(JSON.parse(stored[1].half_json), { flavor1: 'Régina', flavor2: '4 Fromages' });
  // Un nom inconnu reste refusé.
  expectError(await order([line('Calzone (soufflée) — Chorizo', 'Duo', 1600)]), 422, 'unknown_item');
});

test('suppléments : quantité 1 uniquement, pas de doublon (422 validation)', async () => {
  const before = countOrders();
  const q = await order([line('Régina', 'Duo', 1900, { extras: [{ name: 'olives', price_cents: 150, qty: 2 }] })]);
  expectError(q, 422, 'validation');
  assert.ok(q.json.fields['items[0].extras[0].qty'], q.text);
  // Une seule substitution ne peut donc plus couvrir plusieurs portions.
  const swapQty = await order([line('Régina', 'Duo', 1600, { removed: ['champignons'], extras: [{ name: 'olives', price_cents: 0, qty: 10 }] })]);
  expectError(swapQty, 422, 'validation');
  const dup = await order([line('Régina', 'Duo', 1900, { extras: [{ name: 'olives', price_cents: 150, qty: 1 }, { name: 'Olives', price_cents: 150, qty: 1 }] })]);
  expectError(dup, 422, 'validation');
  assert.ok(dup.json.fields['items[0].extras[1].name'], dup.text);
  assert.equal(countOrders(), before);
});

test('retraits : ingrédient fixe de la fiche (ou garniture) uniquement, sinon 422 validation', async () => {
  const before = countOrders();
  const r = await order([line('Canette Oasis pomme poire', '', 150), line('Régina', 'Solo', 1100, { removed: ['anchois'] })]);
  expectError(r, 422, 'validation');
  assert.ok(r.json.fields['items[1].removed']);
  expectError(await order([line('Pâtes Carbonara', '', 850, { removed: ['saumon'] })]), 422, 'validation');
  assert.equal(countOrders(), before);
  // Retraits valides : ingrédient fixe, garniture de la calzone, ingrédient de la deuxième moitié.
  assert.equal((await order([line('Pâtes Carbonara', '', 850, { removed: ['lardons'] })])).status, 201);
  assert.equal((await order([line('Calzone (soufflée) — Thon', 'Duo', 1600, { removed: ['thon', 'jaune d’œuf'] })])).status, 201);
  assert.equal((await order([line('Régina', 'Duo', 1600, { half: { flavor1: 'Régina', flavor2: 'Kebab' }, removed: ['kebab'] })])).status, 201);
});

test('ingrédients de disponibilité : liste de l\'espace commerçant (Tex-Mex : poulet, oignons)', async () => {
  await setAvailability('ingredient', 'poulet', 'out_today');
  const w = await order([line('Tex-Mex Wings (5 pièces)', '', 500)]);
  expectError(w, 422, 'unavailable_items');
  assert.deepEqual([w.json.unavailable, w.json.unavailable_ingredients], [['Tex-Mex Wings (5 pièces)'], ['poulet']]);
  await setAvailability('ingredient', 'poulet', 'available');
  await setAvailability('ingredient', 'oignons', 'out_today');
  const o = await order([line('Tex-Mex Oignon ring (8 pièces)', '', 500)]);
  expectError(o, 422, 'unavailable_items');
  assert.deepEqual(o.json.unavailable_ingredients, ['oignons']);
  assert.equal((await order([line('Tex-Mex Nuggets (4 pièces)', '', 500)])).status, 201);
  await setAvailability('ingredient', 'oignons', 'available');
});

test('alias de suppléments : « chèvre » couvre « fromage de chèvre », « reblochon » couvre « reblochons »', async () => {
  await setAvailability('ingredient', 'fromage de chèvre', 'out_today');
  const c = await order([line('Régina', 'Duo', 1800, { extras: [{ name: 'chèvre', price_cents: 200, qty: 1 }] })]);
  expectError(c, 422, 'unavailable_items');
  assert.deepEqual([c.json.unavailable, c.json.unavailable_ingredients], [['chèvre'], ['fromage de chèvre']]);
  await setAvailability('ingredient', 'fromage de chèvre', 'available');
  await setAvailability('ingredient', 'reblochons', 'out_today');
  const r = await order([line('Régina', 'Duo', 1800, { extras: [{ name: 'reblochon', price_cents: 200, qty: 1 }] })]);
  expectError(r, 422, 'unavailable_items');
  assert.deepEqual(r.json.unavailable_ingredients, ['reblochons']);
  // Les autres suppléments ne couvrent que leur propre nom.
  assert.equal((await order([line('Régina', 'Duo', 1800, { extras: [{ name: 'brie', price_cents: 200, qty: 1 }] })])).status, 201);
  await setAvailability('ingredient', 'reblochons', 'available');
});

test('pizza à composer : fromage fixe, base sauce tomate ou crème fraîche (au moins une disponible)', async () => {
  const base = catalogue.products.find((p) => p.category === 'composer');
  assert.deepEqual([base.availability.fixed, base.availability.choice], [['fromage'], ['sauce tomate', 'crème fraîche']]);
  await setAvailability('ingredient', 'sauce tomate', 'out_today');
  assert.equal((await order([line('Marguerita (base)', 'Solo', 900)])).status, 201);
  const chosen = await order([line('Marguerita (base) — Sauce tomate', 'Solo', 900)]);
  expectError(chosen, 422, 'unavailable_items');
  assert.deepEqual(chosen.json.unavailable_ingredients, ['sauce tomate']);
  const ok = await order([line('Marguerita (base) — crème fraîche', 'Solo', 900)]);
  assert.equal(ok.status, 201, ok.text);
  assert.equal(ok.json.order.items[0].name, 'Marguerita (base) — Crème fraîche');
  await setAvailability('ingredient', 'crème fraîche', 'out_today');
  const none = await order([line('Marguerita (base)', 'Duo', 1300)]);
  expectError(none, 422, 'unavailable_items');
  assert.deepEqual([none.json.unavailable, none.json.unavailable_ingredients.sort()], [['Marguerita (base)'], ['crème fraîche', 'sauce tomate']]);
  await setAvailability('ingredient', 'sauce tomate', 'available');
  await setAvailability('ingredient', 'crème fraîche', 'available');
  await setAvailability('ingredient', 'fromage', 'out_today');
  expectError(await order([line('Marguerita (base)', 'Solo', 900)]), 422, 'unavailable_items');
  await setAvailability('ingredient', 'fromage', 'available');
  expectError(await order([line('Marguerita (base) — Pesto', 'Solo', 900)]), 422, 'unknown_item');
});

test('garniture de calzone en rupture : 422 unavailable_items', async () => {
  await setAvailability('ingredient', 'thon', 'out_manual');
  const before = countOrders();
  const r = await order([line('Calzone (soufflée) — Thon', 'Duo', 1600)]);
  expectError(r, 422, 'unavailable_items');
  assert.deepEqual(r.json.unavailable, ['Calzone (soufflée) — Thon']);
  assert.equal(countOrders(), before);
  // Une autre garniture reste commandable.
  assert.equal((await order([line('Calzone (soufflée) — Jambon', 'Duo', 1600)])).status, 201);
  await setAvailability('ingredient', 'thon', 'available');
});

test('produit en rupture (kind = product) : 422 unavailable_items', async () => {
  await setAvailability('product', 'Tiramisubito Oreo', 'out_today');
  const r = await order([line('Dessert Tiramisubito Oreo', '', 350)]);
  expectError(r, 422, 'unavailable_items');
  assert.deepEqual(r.json.unavailable, ['Dessert Tiramisubito Oreo']);
  assert.equal((await order([line('Dessert Tiramisubito Spéculoos', '', 350)])).status, 201);
  await setAvailability('product', 'Tiramisubito Oreo', 'available');
});

test('promotion livraison : arrondi d\'un prix impair (computeOrderTotals)', () => {
  // Plus atteignable par HTTP (prix du catalogue multiples de 50 centimes) : appel direct de la fonction du serveur.
  const l = (v, c) => ({ variant: v, qty: 1, unit_price_cents: c });
  const t = computeOrderTotals([l('Quatro', 1201), l('Duo', 1001), l('Duo', 1000), l('Solo', 999)], 'delivery', { minimum_cents: 0, fee_cents: 800 });
  // Paires (1201, 1001) → 501 ; (1000, 999) → 500. Total 4201 − 1001 = 3200.
  assert.deepEqual(t, { products_cents: 4201, promo_cents: 1001, products_after_promo_cents: 3200, delivery_fee_cents: 0, total_cents: 3200 });
});

// ---------------------------------------------------------------- article sans prix (catalogue d'essai)
test('article sans prix : 422 unpriced_item (catalogue d\'essai sans le prix Tex-Mex)', async () => {
  // Le catalogue réel lit 5 € dans le titre « Nos Tex-Mex à 5 € ». On simule ici le cas où la page
  // ne donne aucun prix (« Au choix » seul) : prix retiré, rien d'inventé.
  stopServer(server);
  const fx = makeEnv();
  const fixture = JSON.parse(JSON.stringify(catalogue));
  for (const p of fixture.products) {
    if (p.category === 'tex-mex') Object.assign(p, { price_cents: null, orderable: false, price_source: null });
  }
  const fixturePath = path.join(fx.dir, 'catalogue.fixture.json');
  writeFileSync(fixturePath, JSON.stringify(fixture));
  // Équivalent de la clé « catalogue_path » de la configuration PHP : variable lue par serveur/catalogue.js en mode test seulement.
  fx.env.SUBITO_CATALOGUE_PATH = fixturePath;
  server = await prepare(fx);
  // Les tests suivants (échange par pizza) tournent sur ce serveur et cette base : le module les suit
  // (la base précédente est fermée avec son serveur ; le PHP gardait un fichier SQLite lisible).
  ctx = fx;
  db = openTestDb(fx);
  const n0 = countOrders();
  const r = await cust.post('order_create.php', body([line('Tex-Mex Wings (5 pièces)', '', 500)]));
  expectError(r, 422, 'unpriced_item');
  assert.equal(r.json.name, 'Tex-Mex Wings (5 pièces)');
  assert.equal(countOrders(), n0);
  // Le reste du catalogue d'essai reste commandable.
  assert.equal((await cust.post('order_create.php', body([line('Canette Oasis pomme poire', '', 150)]))).status, 201);
});

// ---------------------------------------------------------------- échange par pizza (décision du 19/11/2026)
// Décision de l'utilisateur : « une par pizza ». Chaque pizza d'une ligne qui n'a plus l'ingrédient retiré
// a son supplément offert : une ligne de 3 pizzas identiques avec un retrait et une olive offre 3 olives.
// Les fonctions de prix sont extraites telles quelles de cart.js (jamais recopiées).
// cart.js peut avoir des fins de ligne CRLF sur le poste de travail : elles sont normalisées avant extraction.
const CART_SRC = read('assets/js/cart.js').replace(/\r\n/g, '\n');
function cartFn(name) {
  const debut = CART_SRC.indexOf(`\n  function ${name}(`);
  assert.ok(debut >= 0, `fonction ${name} introuvable dans cart.js`);
  const fin = CART_SRC.indexOf('\n  }\n', debut);
  assert.ok(fin >= 0, `fin de la fonction ${name} introuvable`);
  return CART_SRC.slice(debut + 1, fin + 4);
}
const PRICE_FUNCTIONS = ['normalizeIngredientName', 'applySwapDiscount', 'extrasTotal', 'lineUnitPrice', 'toCents', 'orderTotalsCents'];
const cartBrowser = (mode = 'pickup') => new Function('orderMode', `
  const deliveryCity = null;
  function findDeliveryZone() { return null; }
  function hasPizza(cart) { return cart.some(function (l) { return !!l.variant; }); }
  ${PRICE_FUNCTIONS.map(cartFn).join('\n')}
  return { applySwapDiscount, lineUnitPrice, orderTotalsCents, toCents };
`)(mode);
const sizeCents = (variant) => catalogue.sizes.find((s) => s.name === variant).price_cents;
const extraCents = (name, variant) => {
  const key = (s) => s.toLowerCase().replace(/\*$/, '').trim();
  const g = catalogue.supplement_groups.find((x) => x.names.some((n) => key(n) === key(name)));
  assert.ok(g, `supplément ${name} absent du catalogue`);
  return g.prices_by_size[variant];
};
// Même forme que loadSupplementGroups() (cart.js) : pricesBySize en EUROS (camelCase), pas les centimes du serveur.
const browserGroups = () => catalogue.supplement_groups.map((g) => ({
  title: g.title, names: g.names,
  pricesBySize: Object.fromEntries(Object.entries(g.prices_by_size).map(([k, v]) => [k, v / 100])),
}));
// Panier tel que cart.js le construit : prix en euros, remise d'échange par pizza (applySwapDiscount).
function browserCart(specs, b) {
  return specs.map((s) => ({
    name: s.name, variant: s.variant, qty: s.qty ?? 1, removed: s.removed ?? [], half: null, note: '',
    basePrice: sizeCents(s.variant) / 100,
    extras: b.applySwapDiscount(s.removed ?? [], (s.extras ?? []).map((n) => ({ name: n, price: extraCents(n, s.variant) / 100, qty: 1 })), browserGroups(), s.variant),
  }));
}
// Corps envoyé au serveur par cart.js : prix unitaire de liste en centimes, suppléments à leur prix (0 s'il est offert).
function payloadOf(cart, b) {
  return cart.map((l) => ({
    name: l.name, variant: l.variant, qty: l.qty, unit_price_cents: b.toCents(b.lineUnitPrice(l)),
    removed: l.removed, extras: l.extras.map((ex) => ({ name: ex.name, price_cents: b.toCents(ex.price), qty: ex.qty })),
    half: null, note: '',
  }));
}

test('échange par pizza : 3 pizzas avec un retrait et une olive → 3 olives offertes (navigateur = serveur)', async () => {
  const b = cartBrowser();
  const cart = browserCart([{ name: 'Régina', variant: 'Duo', qty: 3, removed: ['champignons'], extras: ['olives'] }], b);
  const items = payloadOf(cart, b);
  assert.equal(items[0].unit_price_cents, 1600, 'prix unitaire de liste, olive offerte');
  assert.equal(items[0].extras[0].price_cents, 0, 'olive offerte');
  const total = b.orderTotalsCents(cart).total_cents;
  assert.equal(total, 3 * 1600 - 1600, 'à emporter : trois pizzas à 16,00 €, une pizza sur deux de la paire offerte, aucune olive facturée');
  const r = await order(items, { total_cents: total });
  assert.equal(r.status, 201, r.text);
  // Total de ligne enregistré par le serveur : 3 × le prix unitaire taille seule (l'olive est offerte sur chaque pizza).
  const stocke = r.json.order.items[0];
  assert.equal(stocke.qty, 3);
  assert.equal(stocke.unit_price_cents, 1600, 'prix unitaire taille seule');
  assert.equal(stocke.line_total_cents, 3 * 1600, 'total de ligne = 3 × prix unitaire');
});

test('échange par pizza : une olive facturée sur une ligne de 3 pizzas est refusée (422 price_mismatch_line)', async () => {
  const items = [line('Régina', 'Duo', 1600, { qty: 3, removed: ['champignons'], extras: [{ name: 'olives', price_cents: 150, qty: 1 }] })];
  const r = await order(items, { total_cents: 3 * 1600 + 3 * 150 });
  expectError(r, 422, 'price_mismatch_line');
  assert.equal(r.json.expected_unit_cents, 1600);
});

test('échange par pizza : une ligne normale (une pizza, un retrait, un supplément) garde son prix', async () => {
  const b = cartBrowser();
  const offert = browserCart([{ name: 'Régina', variant: 'Duo', removed: ['champignons'], extras: ['olives'] }], b);
  assert.equal(b.orderTotalsCents(offert).total_cents, 1600, 'olive du même groupe offerte');
  const paye = browserCart([{ name: 'Régina', variant: 'Duo', removed: ['champignons'], extras: ['brie'] }], b);
  assert.equal(b.orderTotalsCents(paye).total_cents, 1600 + 200, 'brie d\'un autre groupe : payé');
  const rOffert = await order(payloadOf(offert, b), { total_cents: 1600 });
  assert.equal(rOffert.status, 201, rOffert.text);
  assert.equal(rOffert.json.order.items[0].line_total_cents, 1600, 'ligne normale, olive offerte : même prix');
  const rPaye = await order(payloadOf(paye, b), { total_cents: 1800 });
  assert.equal(rPaye.status, 201, rPaye.text);
  assert.equal(rPaye.json.order.items[0].line_total_cents, 1800, 'ligne normale, brie payé : même prix');
});

test('échange par pizza : parité navigateur et serveur, quantités 1 et 3', async () => {
  const b = cartBrowser();
  const cas = [
    [[{ name: 'Régina', variant: 'Duo', qty: 1, removed: ['champignons', 'jambon'], extras: ['olives', 'poulet', 'brie'] }], 1800],
    [[{ name: 'Régina', variant: 'Duo', qty: 3, removed: ['champignons', 'jambon'], extras: ['olives', 'poulet', 'brie'] }], 3 * 1800 - 1800],
    [[{ name: 'Régina', variant: 'Duo', qty: 1, removed: ['champignons', 'sauce tomate'], extras: ['olives', 'poivrons', 'oignons'] }], 1750],
  ];
  for (const [specs, attendu] of cas) {
    const cart = browserCart(specs, b);
    const total = b.orderTotalsCents(cart).total_cents;
    assert.equal(total, attendu, JSON.stringify(specs));
    const r = await order(payloadOf(cart, b), { total_cents: total });
    assert.equal(r.status, 201, `${JSON.stringify(specs)} : ${r.text}`);
  }
});

// ------------------------------------------------- règle de gratuité par PRIX (décision du 21/11/2026)
// Retirer un ingrédient donne un crédit égal à SON PRIX (à la taille choisie) ; un supplément ajouté est
// gratuit si son prix est <= un crédit encore disponible (le plus petit crédit suffisant est consommé),
// sinon il reste payant. Remplace la règle « même groupe » : plus de notion de catégorie, seulement le
// prix. Couvre aussi l'œuf (nouveau 3e groupe, seul membre « Œuf ») des deux côtés (retrait ET ajout).
test('règle de gratuité par prix : viande/légume/œuf, cas de base à toutes les tailles', async () => {
  const b = cartBrowser();
  for (const variant of ['Solo', 'Duo', 'Quatro', 'XXL']) {
    const legume = extraCents('champignons', variant);
    const viande = extraCents('jambon', variant);
    const oeuf = extraCents('Œuf', variant);
    assert.ok(oeuf <= legume && legume < viande, `œuf <= légume < viande attendu à ${variant}`);

    // Légume retiré + œuf ajouté : toujours gratuit (œuf toujours au plus cher aussi cher que le légume).
    const c1 = browserCart([{ name: 'Régina', variant, removed: ['champignons'], extras: ['Œuf'] }], b);
    assert.equal(b.orderTotalsCents(c1).total_cents, sizeCents(variant), `légume→œuf gratuit à ${variant}`);
    // Viande retirée + œuf ajouté : toujours gratuit (œuf toujours aussi cher ou moins cher que la viande).
    const c2 = browserCart([{ name: 'Régina', variant, removed: ['jambon'], extras: ['Œuf'] }], b);
    assert.equal(b.orderTotalsCents(c2).total_cents, sizeCents(variant), `viande→œuf gratuit à ${variant}`);
    // Légume retiré + viande ajoutée : jamais gratuit (la viande coûte toujours plus que le légume retiré).
    const c3 = browserCart([{ name: 'Régina', variant, removed: ['champignons'], extras: ['poulet'] }], b);
    assert.equal(b.orderTotalsCents(c3).total_cents, sizeCents(variant) + viande, `légume→viande payant à ${variant}`);
    for (const c of [c1, c2, c3]) {
      const r = await order(payloadOf(c, b), { total_cents: b.orderTotalsCents(c).total_cents });
      assert.equal(r.status, 201, `${variant} : ${r.text}`);
    }
  }
});

test('règle de gratuité par prix : 2 viandes retirées + 3 viandes ajoutées → 2 gratuites, la 3ᵉ payante', async () => {
  const b = cartBrowser();
  const cart = browserCart([{ name: '3 Jambons', variant: 'Quatro', removed: ['jambon', 'mortadelle'], extras: ['poulet', 'kebab', 'merguez'] }], b);
  const total = b.orderTotalsCents(cart).total_cents;
  assert.equal(total, sizeCents('Quatro') + extraCents('poulet', 'Quatro'), 'seule la 3e viande ajoutée est facturée');
  const r = await order(payloadOf(cart, b), { total_cents: total });
  assert.equal(r.status, 201, r.text);
});

test('règle de gratuité par prix : retirer l\'œuf fixe d\'une pizza (Kefta) donne désormais un crédit (trou corrigé)', async () => {
  const b = cartBrowser();
  // Avant l'ajout du groupe Œuf, retirer "oeuf" (orthographe de la fiche) ne correspondait à aucun
  // groupe de supplément : aucun crédit. À Solo, légume et œuf ont le même prix (1,00 €) : le crédit
  // du retrait de l'œuf doit donc couvrir une olive gratuite.
  const offert = browserCart([{ name: 'Kefta', variant: 'Solo', removed: ['oeuf'], extras: ['olives'] }], b);
  assert.equal(b.orderTotalsCents(offert).total_cents, sizeCents('Solo'), 'olive gratuite : le crédit œuf (1,00 €) couvre le légume (1,00 €)');
  const r1 = await order(payloadOf(offert, b), { total_cents: sizeCents('Solo') });
  assert.equal(r1.status, 201, r1.text);

  // Contrôle : le même retrait ne couvre pas un supplément plus cher (poulet, viande à 1,50 €).
  const paye = browserCart([{ name: 'Kefta', variant: 'Solo', removed: ['oeuf'], extras: ['poulet'] }], b);
  assert.equal(b.orderTotalsCents(paye).total_cents, sizeCents('Solo') + extraCents('poulet', 'Solo'), 'poulet payant : le crédit œuf (1,00 €) ne couvre pas la viande (1,50 €)');
  const r2 = await order(payloadOf(paye, b), { total_cents: sizeCents('Solo') + extraCents('poulet', 'Solo') });
  assert.equal(r2.status, 201, r2.text);
});

test('règle de gratuité par prix : best-fit — le crédit le plus petit SUFFISANT est consommé, jamais le premier venu', async () => {
  // Régina Quatro : retire jambon (viande, 3,00 €) et champignons (légume, 2,50 €) → crédits [2,50 ; 3,00].
  // Ajoute dans cet ordre : Œuf (2,00 €) puis poulet (viande, 3,00 €). Un appariement « premier trouvé »
  // sur la liste non triée dans l'ordre des retraits (viande d'abord = 3,00 €) consommerait le crédit de
  // 3,00 € sur l'œuf (qui n'avait besoin que de 2,00 €), ne laissant que 2,50 € pour le poulet à 3,00 € →
  // poulet facturé à tort. Le best-fit (crédit le plus PETIT qui suffit) doit donner l'œuf le crédit de
  // 2,50 € et garder le crédit de 3,00 € pour le poulet : les deux doivent être gratuits.
  const b = cartBrowser();
  const cart = browserCart([{ name: 'Régina', variant: 'Quatro', removed: ['jambon', 'champignons'], extras: ['Œuf', 'poulet'] }], b);
  const total = b.orderTotalsCents(cart).total_cents;
  assert.equal(total, sizeCents('Quatro'), 'œuf et poulet tous deux gratuits grâce au best-fit');
  const r = await order(payloadOf(cart, b), { total_cents: total });
  assert.equal(r.status, 201, r.text);
  assert.equal(r.json.order.items[0].line_total_cents, sizeCents('Quatro'));
});

// Générateur pseudo-aléatoire reproductible (mulberry32) : mêmes scénarios à chaque exécution, jamais de test
// qui échoue de façon aléatoire/non reproductible. Remplace fast-check (absent des dépendances du projet).
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
test('règle de gratuité par prix : balayage combinatoire reproductible (navigateur = oracle indépendant = serveur)', async () => {
  const rnd = mulberry32(20261121);
  const pick = (arr, n) => {
    const pool = arr.slice();
    const out = [];
    while (out.length < n && pool.length) out.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0]);
    return out;
  };
  // (pizza, taille déjà couverte par ailleurs ici, ingrédients fixes classés retirables).
  const PIZZAS = [
    { name: 'Régina', removable: ['jambon', 'champignons'] },
    { name: '3 Jambons', removable: ['jambon', 'mortadelle', 'chorizo'] },
    { name: 'Kefta', removable: ['viande hachée', 'oeuf'] },
    { name: "L'Extravagante", removable: ['jambon', 'chorizo', 'merguez', 'champignons', 'oeuf'] },
  ];
  const EXTRAS_POOL = ['olives', 'poivrons', 'poulet', 'kebab', 'brie', 'Œuf'];
  // Oracle indépendant : même règle énoncée en français, réécrite sans partager de code avec cart.js/catalogue.js
  // (seule la normalisation de nom normName() est réutilisée : un ingrédient fixe de fiche s'écrit parfois
  // différemment du supplément correspondant, ex. « oeuf » sur la fiche vs « Œuf » dans supplements.html).
  function oracleTotal(pizzaName, variant, removedNames, extraNames) {
    const priceOfName = (name) => {
      const g = catalogue.supplement_groups.find((x) => x.names.some((n) => normName(n) === normName(name)));
      return g ? g.prices_by_size[variant] : undefined;
    };
    const credits = removedNames.map(priceOfName).filter((p) => p !== undefined).sort((a, b) => a - b);
    let unit = sizeCents(variant);
    for (const name of extraNames) {
      const price = priceOfName(name);
      const ci = credits.findIndex((c) => c >= price);
      if (ci !== -1) credits.splice(ci, 1);
      else unit += price;
    }
    return unit;
  }
  const b = cartBrowser();
  let n = 0;
  for (let i = 0; i < 40; i++) {
    const pizza = PIZZAS[Math.floor(rnd() * PIZZAS.length)];
    const variant = ['Solo', 'Duo', 'Quatro', 'XXL'][Math.floor(rnd() * 4)];
    const removed = pick(pizza.removable, Math.floor(rnd() * Math.min(3, pizza.removable.length + 1)));
    const extras = pick(EXTRAS_POOL, Math.floor(rnd() * 4));
    const attendu = oracleTotal(pizza.name, variant, removed, extras);
    const cart = browserCart([{ name: pizza.name, variant, removed, extras }], b);
    const totalNavigateur = b.orderTotalsCents(cart).total_cents;
    assert.equal(totalNavigateur, attendu, `oracle≠navigateur : ${pizza.name} ${variant} retiré=${removed} ajouté=${extras}`);
    const r = await order(payloadOf(cart, b), { total_cents: totalNavigateur });
    assert.equal(r.status, 201, `oracle≠serveur : ${pizza.name} ${variant} retiré=${removed} ajouté=${extras} : ${r.text}`);
    assert.equal(r.json.order.items[0].line_total_cents, attendu, `serveur a enregistré un total différent de l'oracle (${pizza.name} ${variant})`);
    n++;
  }
  assert.equal(n, 40, 'les 40 scénarios combinatoires ont bien tous été exécutés');
});
