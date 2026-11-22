// Campagne combinatoire EXHAUSTIVE (sections 5-7 du brief du 22/11/2026) : contrairement à
// catalogue.test.mjs (qui vérifie la mécanique de prix sur quelques pizzas représentatives), ce fichier
// boucle sur TOUT le catalogue — chaque pizza réelle du menu, à chaque taille, avec chaque base reconnue,
// chaque groupe de supplément, et chaque pizza en moitié-moitié — pour attraper un décalage de prix ou de
// données propre à UNE pizza précise que des tests ciblés manqueraient. Lancer depuis la racine :
//   SUBITO_TEST_PORT=18430 node --test tests/api-vercel/combinatoire-exhaustif.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

process.env.SUBITO_TEST_PORT = String(Number(process.env.SUBITO_TEST_PORT || 8091) + 10);
const { ROOT, Client, makeEnv, openTestDb, runTool, startServer, stopServer } = await import('./lib/harness.mjs');

const CATALOGUE_FILE = path.join(ROOT, 'api', 'data', 'catalogue.json');
const catalogue = JSON.parse(readFileSync(CATALOGUE_FILE, 'utf8'));
const SIZES = ['Solo', 'Duo', 'Quatro', 'XXL'];
const normName = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/œ/g, 'oe').trim();
// Forme EXACTE du catalogue (accents compris) à envoyer comme extra : le serveur ne compare les ajouts
// que par catalogueSwapKey() (minuscule, sans dépliage d'accent) — jamais par la forme repliée ci-dessus,
// qui ne sert qu'à nos propres comparaisons (quelle est la base actuelle de CETTE pizza).
const BASE_SAUCES = ['sauce tomate', 'crème fraîche', 'sauce barbecue', 'sauce curry'];
const BASE_SAUCES_NORM = BASE_SAUCES.map(normName);

const realPizzas = catalogue.products.filter((p) => p.kind === 'pizza' && p.name !== 'Marguerita (base)');
// La calzone a une garniture au choix OBLIGATOIRE dans son nom (ex. "Calzone (soufflée) — Jambon") : sans
// ça, le serveur répond unknown_item, pas une erreur de calzone — un nom de ligne complet est requis.
const lineNameOf = (p) => (p.choice && p.choice.required ? `${p.name} — ${p.choice.options[0]}` : p.name);
const groups = catalogue.supplement_groups;
const groupByIngredient = (name) => groups.find((g) => g.names.some((n) => normName(n) === normName(name)));

let ctx;
let server;
let db;
const cust = new Client('combi-cust');
let keySeq = 0;
const newKey = () => `combi-key-${Date.now()}-${++keySeq}`;
// Cette campagne envoie volontairement bien plus que 20 commandes (limite normale, 10 min/client) :
// le débit, pas l'anti-abus, est l'objet de ces tests (déjà couvert ailleurs, ex. 08-force-brute-limites).
const resetThrottle = () => db.exec('DELETE FROM throttle');

before(async () => {
  ctx = makeEnv();
  const inst = await runTool(ctx, 'install.php');
  assert.equal(inst.code, 0, inst.stderr + inst.stdout);
  db = openTestDb(ctx);
  server = await startServer(ctx);
  const signup = await cust.post('customer_signup.php', {
    first_name: 'Combi', last_name: 'Test', email: 'combi-exhaustif@example.test', phone: '0612345678',
    password: 'Aa1!combiexhaustif', street: '1 rue des Tests', city: 'Hénin-Beaumont', housing_type: 'maison'
  });
  assert.equal(signup.status, 201, signup.text);
});

after(() => {
  stopServer(server);
  try { db?.close(); } catch { /* déjà fermée */ }
});

function expectError(r, status, code) {
  assert.equal(r.status, status, `${r.method} ${r.route} : ${r.text}`);
  assert.equal(r.json?.ok, false);
  assert.equal(r.json?.error, code, r.text);
}

async function order(items, total) {
  resetThrottle();
  return cust.post('order_create.php', {
    idempotency_key: newKey(), mode: 'pickup', payment_methods: ['cash'], cash_change_for: null, hot_sauce: null,
    items, delivery_fee_cents: 0, total_cents: total
  });
}

test(`chaque pizza réelle du menu (${realPizzas.length}), à chaque taille (${SIZES.length}) : commandée telle quelle au prix catalogue`, async () => {
  for (const p of realPizzas) {
    for (const size of SIZES) {
      const price = p.prices_by_size[size];
      const r = await order([{ name: lineNameOf(p), variant: size, qty: 1, unit_price_cents: price, removed: [], extras: [], half: null, note: '' }], price);
      assert.equal(r.status, 201, `${p.name} (${size}) : ${r.text}`);
      assert.equal(r.json.order.items[0].unit_price_cents, price);
    }
  }
});

test('chaque pizza ayant une base reconnue (tomate/crème fraîche/barbecue/curry) : changement vers les 3 autres bases, toujours gratuit (Duo)', async () => {
  const withBase = realPizzas.filter((p) => BASE_SAUCES_NORM.includes(normName(p.ingredients[0])));
  assert.ok(withBase.length >= 25, `au moins 25 pizzas attendues avec une base reconnue, trouvé ${withBase.length}`);
  for (const p of withBase) {
    const baseIngredient = p.ingredients[0];
    const price = p.prices_by_size.Duo;
    for (const newBase of BASE_SAUCES) {
      if (normName(newBase) === normName(baseIngredient)) continue;
      const r = await order([{
        name: lineNameOf(p), variant: 'Duo', qty: 1, unit_price_cents: price,
        removed: [baseIngredient], extras: [{ name: newBase, price_cents: 0, qty: 1 }], half: null, note: ''
      }], price);
      assert.equal(r.status, 201, `${p.name} -> ${newBase} : ${r.text}`);
    }
  }
});

test('chaque pizza réelle : retirer un ingrédient sans rien ajouter ne change jamais le prix (Duo)', async () => {
  for (const p of realPizzas) {
    const price = p.prices_by_size.Duo;
    for (const ingredient of p.ingredients) {
      const r = await order([{ name: lineNameOf(p), variant: 'Duo', qty: 1, unit_price_cents: price, removed: [ingredient], extras: [], half: null, note: '' }], price);
      assert.equal(r.status, 201, `${p.name} sans ${ingredient} : ${r.text}`);
      assert.equal(r.json.order.items[0].unit_price_cents, price, `${p.name} sans ${ingredient} : un retrait seul ne doit jamais coûter ni rapporter`);
    }
  }
});

test('chaque pizza réelle : ajouter un supplément de chaque groupe sans rien retirer coûte toujours plein tarif (Duo)', async () => {
  for (const p of realPizzas) {
    const base = p.prices_by_size.Duo;
    for (const g of groups) {
      const supplement = g.names[0];
      const supplementPrice = g.prices_by_size.Duo;
      const total = base + supplementPrice;
      const r = await order([{
        name: lineNameOf(p), variant: 'Duo', qty: 1, unit_price_cents: total,
        removed: [], extras: [{ name: supplement, price_cents: supplementPrice, qty: 1 }], half: null, note: ''
      }], total);
      assert.equal(r.status, 201, `${p.name} + ${supplement} : ${r.text}`);
      assert.equal(r.json.order.items[0].unit_price_cents, total, `${p.name} + ${supplement} sans retrait : plein tarif attendu`);
    }
  }
});

test('moitié-moitié : chaque pizza éligible participe (comme 1ère ou 2ème moitié), à chaque taille autorisée (Duo/Quatro/XXL)', async () => {
  const eligible = realPizzas.filter((p) => p.half_allowed && p.half_flavor);
  assert.ok(eligible.length >= 25, `au moins 25 pizzas éligibles attendues, trouvé ${eligible.length}`);
  for (const size of ['Duo', 'Quatro', 'XXL']) {
    for (let i = 0; i < eligible.length; i++) {
      const flavor1 = eligible[i];
      const flavor2 = eligible[(i + 1) % eligible.length];
      const price = flavor1.prices_by_size[size]; // règle du serveur : le prix de la 1ère moitié fait foi (catalogue.js)
      const r = await order([{
        name: flavor1.name, variant: size, qty: 1, unit_price_cents: price,
        removed: [], extras: [], half: { flavor1: flavor1.name, flavor2: flavor2.name }, note: ''
      }], price);
      assert.equal(r.status, 201, `${flavor1.name} / ${flavor2.name} (${size}) : ${r.text}`);
    }
  }
});

test('moitié-moitié : jamais en taille Solo, jamais avec la calzone (ni comme 1ère ni comme 2ème moitié)', async () => {
  const regina = realPizzas.find((p) => p.name === 'Régina');
  const calzone = realPizzas.find((p) => p.name === 'Calzone (soufflée)');
  assert.ok(regina && calzone);

  const solo = await order([{
    name: 'Régina', variant: 'Solo', qty: 1, unit_price_cents: regina.prices_by_size.Solo,
    removed: [], extras: [], half: { flavor1: 'Régina', flavor2: '4 Fromages' }, note: ''
  }], regina.prices_by_size.Solo);
  expectError(solo, 422, 'validation');

  const calzoneAsMain = await order([{
    name: lineNameOf(calzone), variant: 'Duo', qty: 1, unit_price_cents: calzone.prices_by_size.Duo,
    removed: [], extras: [], half: { flavor1: 'Calzone (soufflée)', flavor2: 'Régina' }, note: ''
  }], calzone.prices_by_size.Duo);
  expectError(calzoneAsMain, 422, 'validation');

  const calzoneAsSecond = await order([{
    name: 'Régina', variant: 'Duo', qty: 1, unit_price_cents: regina.prices_by_size.Duo,
    removed: [], extras: [], half: { flavor1: 'Régina', flavor2: 'Calzone (soufflée)' }, note: ''
  }], regina.prices_by_size.Duo);
  expectError(calzoneAsSecond, 422, 'unknown_item');
});
