#!/usr/bin/env node
// Génère api/data/catalogue.json à partir des pages du site (lecture seule) :
//   menu.html (tailles, produits, prix), supplements.html (groupes de suppléments),
//   composer.html (base composée), et assets/js/cart.js (zones, libellés de catégorie,
//   nom de la base composée : ce que le navigateur utilise réellement).
// Aucun prix n'est deviné : un article sans prix lisible est « non commandable ».
// Le script échoue (code 1) si une valeur attendue manque.
//
// Usage : node tools/build-catalogue.mjs            → écrit api/data/catalogue.json
//         node tools/build-catalogue.mjs --out F    → écrit dans F
//         node tools/build-catalogue.mjs --check    → compare au fichier existant (code 1 si différent)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const OUTPUT = path.join(ROOT, 'api', 'data', 'catalogue.json');
export const SIZE_ORDER = ['Solo', 'Duo', 'Quatro', 'XXL'];

// Ingrédients de disponibilité : ceux que l'espace commerçant affiche (constante MENU de
// assets/js/commercant.js, lue ici en lecture seule) ; « a|b » = choix (garniture).
// Billets proposés en espèces (10, 20, 50, 100 €) : choix de monnaie, jamais dans le catalogue.

// Alias de disponibilité des suppléments : un supplément couvre aussi l'ingrédient de même
// nature écrit autrement sur les fiches. Les autres suppléments ne couvrent que leur propre nom.
const SUPPLEMENT_ALIASES = {
  'chèvre': ['fromage de chèvre'],
  reblochon: ['reblochons'],
};

class BuildError extends Error {}
function need(cond, msg) {
  if (!cond) throw new BuildError(msg);
}

// ---------------------------------------------------------------- mini-analyseur HTML
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const RAW = new Set(['script', 'style']);
const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘',
  rdquo: '”', ldquo: '“', laquo: '«', raquo: '»', mdash: '—', ndash: '–', hellip: '…',
  eacute: 'é', egrave: 'è', ecirc: 'ê', agrave: 'à', acirc: 'â', ccedil: 'ç', ocirc: 'ô',
  icirc: 'î', iuml: 'ï', ucirc: 'û', ugrave: 'ù', oelig: 'œ', euro: '€', middot: '·', times: '×',
  copy: '©', reg: '®', deg: '°',
};

function decode(text, file) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    const v = ENTITIES[e.toLowerCase()];
    need(v !== undefined, `${file} : entité HTML inconnue ${m}`);
    return v;
  });
}

export function parseHtml(html, file = 'html') {
  const root = { tag: '#root', attrs: {}, children: [], parent: null };
  let cur = root;
  let i = 0;
  const n = html.length;
  while (i < n) {
    if (html.startsWith('<!--', i)) {
      const e = html.indexOf('-->', i + 4);
      i = e < 0 ? n : e + 3;
      continue;
    }
    if (html.startsWith('<!', i) || html.startsWith('<?', i)) {
      const e = html.indexOf('>', i);
      i = e < 0 ? n : e + 1;
      continue;
    }
    if (html[i] === '<' && html[i + 1] === '/') {
      const e = html.indexOf('>', i);
      need(e > 0, `${file} : balise fermante non terminée`);
      const tag = html.slice(i + 2, e).trim().toLowerCase();
      let k = cur;
      while (k && k.tag !== tag) k = k.parent;
      if (k && k.parent) cur = k.parent; // fermante orpheline : ignorée
      i = e + 1;
      continue;
    }
    const open = html[i] === '<' ? /^<([a-zA-Z][a-zA-Z0-9-]*)/.exec(html.slice(i, i + 80)) : null;
    if (open) {
      const tag = open[1].toLowerCase();
      let j = i + open[0].length;
      const attrs = {};
      let selfClose = false;
      const attrRe = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/y;
      for (;;) {
        while (j < n && /\s/.test(html[j])) j++;
        need(j < n, `${file} : balise <${tag}> non terminée`);
        if (html[j] === '>') { j++; break; }
        if (html[j] === '/' && html[j + 1] === '>') { j += 2; selfClose = true; break; }
        if (html[j] === '/') { j++; continue; }
        attrRe.lastIndex = j;
        const a = attrRe.exec(html);
        need(a, `${file} : attribut illisible dans <${tag}>`);
        attrs[a[1].toLowerCase()] = decode(a[2] ?? a[3] ?? a[4] ?? '', file);
        j = attrRe.lastIndex;
      }
      const node = { tag, attrs, children: [], parent: cur };
      cur.children.push(node);
      if (RAW.has(tag) && !selfClose) {
        const e = html.toLowerCase().indexOf(`</${tag}`, j);
        const end = e < 0 ? n : e;
        node.children.push({ tag: '#text', text: html.slice(j, end), parent: node });
        const close = html.indexOf('>', end);
        i = close < 0 ? n : close + 1;
        continue;
      }
      if (!selfClose && !VOID.has(tag)) cur = node;
      i = j;
      continue;
    }
    let e = html.indexOf('<', i + 1);
    if (e < 0) e = n;
    cur.children.push({ tag: '#text', text: decode(html.slice(i, e), file), parent: cur });
    i = e;
  }
  return root;
}

const classes = (node) => (node.attrs && node.attrs.class ? node.attrs.class.split(/\s+/).filter(Boolean) : []);
const hasClass = (node, c) => classes(node).includes(c);

function all(node, pred, out = []) {
  for (const c of node.children || []) {
    if (c.tag !== '#text') {
      if (pred(c)) out.push(c);
      all(c, pred, out);
    }
  }
  return out;
}
const byClass = (node, c) => all(node, (x) => hasClass(x, c));
const first = (node, c) => byClass(node, c)[0] || null;
const byId = (node, id) => all(node, (x) => x.attrs.id === id)[0] || null;
function closest(node, pred) {
  for (let k = node; k; k = k.parent) if (k.tag !== '#text' && k.tag !== '#root' && pred(k)) return k;
  return null;
}
function textContent(node, skip = null) {
  if (node.tag === '#text') return node.text;
  if (skip && skip(node)) return '';
  return (node.children || []).map((c) => textContent(c, skip)).join('');
}

// ---------------------------------------------------------------- règles reprises de cart.js
// parsePrice() de cart.js, en centimes entiers (même résultat que Math.round(prix × 100)).
export function parsePriceCents(text) {
  if (!text) return null;
  const m = String(text).match(/(\d+)(?:[.,](\d{1,2}))?\s*€/);
  if (!m) return null;
  const cents = m[2] ? m[2].padEnd(2, '0') : '00';
  return parseInt(m[1], 10) * 100 + parseInt(cents, 10);
}

// parseIngredients() de cart.js.
export function parseIngredients(text) {
  if (!text) return [];
  const out = [];
  text.split(',').forEach((part) => {
    part.split(/\s+ou\s+/i).forEach((tok) => {
      const t = tok.trim();
      if (t && out.indexOf(t) === -1) out.push(t);
    });
  });
  return out;
}

// readMenuItemIngredients() de cart.js.
function readMenuItemIngredients(item) {
  const el = first(item, 'menu-item__ingredients');
  if (!el) return { ingredients: [], choice: null };
  const choiceEl = first(el, 'menu-item__choice');
  let choice = null;
  if (choiceEl) {
    const raw = textContent(choiceEl);
    const colon = raw.indexOf(':');
    choice = {
      label: (colon === -1 ? raw : raw.slice(0, colon)).trim(),
      options: parseIngredients(colon === -1 ? '' : raw.slice(colon + 1)),
    };
  }
  return { ingredients: parseIngredients(textContent(el, (x) => x === choiceEl)), choice };
}

// readSizeChart() de cart.js (toute la page).
function readSizeChart(doc) {
  const sizes = [];
  for (const item of byClass(doc, 'size-chart__item')) {
    const name = first(item, 'size-chart__name');
    const price = first(item, 'size-chart__price');
    if (!name || !price) continue;
    const p = parsePriceCents(textContent(price));
    if (p !== null) sizes.push({ name: textContent(name).trim(), price_cents: p });
  }
  return sizes;
}

function priceFromCategoryNote(category) {
  const note = first(category, 'menu-category__price-note');
  if (note) {
    const p = parsePriceCents(textContent(note));
    if (p !== null) return { cents: p, source: 'category_note', text: textContent(note).trim() };
  }
  const title = first(category, 'menu-category__title');
  if (title) {
    const p = parsePriceCents(textContent(title));
    if (p !== null) return { cents: p, source: 'category_title', text: textContent(title).trim() };
  }
  return null;
}

function readCartJs(js) {
  const labelsBlock = js.match(/const CATEGORY_LABELS = \{([\s\S]*?)\};/);
  need(labelsBlock, 'cart.js : CATEGORY_LABELS introuvable');
  const labels = {};
  for (const m of labelsBlock[1].matchAll(/(?:"([^"]+)"|([A-Za-z_][\w-]*))\s*:\s*"([^"]+)"/g)) labels[m[1] || m[2]] = m[3];
  need(Object.keys(labels).length > 0, 'cart.js : CATEGORY_LABELS vide');

  const zonesBlock = js.match(/const DELIVERY_ZONES = \[([\s\S]*?)\];/);
  need(zonesBlock, 'cart.js : DELIVERY_ZONES introuvable');
  const zones = [...zonesBlock[1].matchAll(/city:\s*"([^"]+)",\s*minimum:\s*([\d.]+),\s*fee:\s*([\d.]+)/g)]
    .map((m) => ({ city: m[1], minimum_cents: Math.round(Number(m[2]) * 100), fee_cents: Math.round(Number(m[3]) * 100) }));
  need(zones.length > 0, 'cart.js : aucune zone de livraison lue');

  const base = js.match(/buildPizzaWidget\("([^"]+)",\s*\[\],\s*sizeChart,\s*\[\]\)/);
  need(base, 'cart.js : nom de la base composée (scanComposerBase) introuvable');
  return { labels, zones, composerName: base[1] };
}

// Constante MENU de commercant.js : { catégorie: { nom: [ingrédients, « a|b » pour un choix] } }.
function readCommercantMenu(js) {
  const block = js.match(/const MENU = \[([\s\S]*?)\n {2}\];/);
  need(block, 'commercant.js : constante MENU introuvable');
  const menu = {};
  const str = (s) => JSON.parse(`"${s}"`);
  const heads = [...block[1].matchAll(/\{ key: '([^']+)', label: '[^']*', items: \[/g)];
  for (let h = 0; h < heads.length; h++) {
    const c = [null, heads[h][1], block[1].slice(heads[h].index, h + 1 < heads.length ? heads[h + 1].index : undefined)];
    menu[c[1]] = {};
    for (const it of c[2].matchAll(/\{ name: "((?:[^"\\]|\\.)*)", ing: \[([^\]]*)\] \}/g)) {
      menu[c[1]][str(it[1])] = [...it[2].matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => str(m[1]));
    }
  }
  need(Object.keys(menu).length > 0, 'commercant.js : MENU vide');
  return menu;
}

function availabilityFrom(ing, where) {
  const fixed = ing.filter((g) => !g.includes('|'));
  const choices = ing.filter((g) => g.includes('|'));
  need(choices.length <= 1, `${where} : plusieurs groupes au choix`);
  return { fixed, choice: choices.length ? choices[0].split('|') : null };
}

function qualifiedName(name, categoryId, labels) {
  if (!categoryId) return name;
  const label = labels[categoryId];
  if (!label) return name;
  if (name.toLowerCase().indexOf(label.toLowerCase()) === 0) return name;
  return label + ' ' + name;
}

// Groupes de suppléments (loadSupplementGroups() de cart.js).
function readSupplementGroups(doc, file) {
  const groups = [];
  for (const g of byClass(doc, 'compose-group')) {
    const titleEl = first(g, 'compose-group__title');
    const listEl = first(g, 'compose-group__list');
    if (!titleEl || !listEl) continue;
    const title = textContent(titleEl).replace(/^Prix par ingrédient supplémentaire\s*—\s*/i, '').trim();
    // Astérisques : retirées des pages par le propriétaire (19/11/2026) ; une astérisque
    // résiduelle est encore tolérée et retirée ici (le serveur l'ignore aussi à la comparaison).
    const names = textContent(listEl).split(',').map((s) => s.trim().replace(/\*+$/, '').trim()).filter(Boolean);
    const prices = {};
    for (const row of byClass(g, 'compose-price-row__item')) {
      const sizeEl = first(row, 'compose-price-row__name');
      const priceEl = first(row, 'compose-price-row__price');
      if (!sizeEl || !priceEl) continue;
      const p = parsePriceCents(textContent(priceEl));
      if (p !== null) prices[textContent(sizeEl).trim()] = p;
    }
    need(names.length > 0, `${file} : groupe « ${title} » sans ingrédient`);
    for (const s of SIZE_ORDER) need(Number.isInteger(prices[s]), `${file} : groupe « ${title} » sans prix pour la taille ${s}`);
    groups.push({ title, names, prices_by_size: Object.fromEntries(SIZE_ORDER.map((s) => [s, prices[s]])) });
  }
  need(groups.length > 0, `${file} : aucun groupe de suppléments`);
  return groups;
}

function checkSizes(sizes, file) {
  need(sizes.length === SIZE_ORDER.length, `${file} : ${sizes.length} taille(s) lue(s), ${SIZE_ORDER.length} attendues`);
  sizes.forEach((s, k) => need(s.name === SIZE_ORDER[k], `${file} : taille « ${s.name} » inattendue (attendu ${SIZE_ORDER[k]})`));
  return Object.fromEntries(sizes.map((s) => [s.name, s.price_cents]));
}

// Clés de nom comme name_keys() côté serveur (util.php) : sert à détecter deux articles confondus.
function normName(s) {
  return String(s).normalize('NFD').replace(/\p{Mn}+/gu, '').toLowerCase()
    .replace(/œ/g, 'oe').replace(/æ/g, 'ae').replace(/[’‘`´]/g, "'").replace(/\s+/g, ' ').trim();
}
function nameKeys(name) {
  const clean = String(name).replace(/\p{Cf}+/gu, '').replace(/\s+/g, ' ').trim().replace(/[\s.,;:!?]+$/u, '');
  const full = normName(clean);
  const core = normName(clean.replace(/\s*\([^()]*\)\s*$/u, ''));
  return core && core !== full ? [full, core] : [full];
}

// ---------------------------------------------------------------- construction
export function buildCatalogue(root = ROOT) {
  const read = (rel) => readFileSync(path.join(root, rel), 'utf8');
  const menu = parseHtml(read('menu.html'), 'menu.html');
  const supp = parseHtml(read('supplements.html'), 'supplements.html');
  const comp = parseHtml(read('composer.html'), 'composer.html');
  const cart = readCartJs(read('assets/js/cart.js'));
  const notes = [];

  // Tailles (menu.html) et base composée (composer.html).
  const sizes = checkSizes(readSizeChart(menu), 'menu.html');
  const composerSizes = checkSizes(readSizeChart(comp), 'composer.html');

  // Suppléments : supplements.html est la source du navigateur ; composer.html doit afficher les mêmes.
  const groups = readSupplementGroups(supp, 'supplements.html');
  const groupsComposer = readSupplementGroups(comp, 'composer.html');
  need(JSON.stringify(groups) === JSON.stringify(groupsComposer),
    'Les suppléments de composer.html diffèrent de ceux de supplements.html : à corriger dans les pages avant de générer.');
  const seenExtra = new Map();
  for (const g of groups) {
    for (const nm of g.names) {
      const k = nm.toLowerCase().replace(/\*$/, '').trim();
      need(!seenExtra.has(k), `supplements.html : « ${nm} » figure dans deux groupes`);
      seenExtra.set(k, g.title);
    }
  }
  for (const alias of Object.keys(SUPPLEMENT_ALIASES)) need(seenExtra.has(alias), `Alias de supplément « ${alias} » absent de supplements.html`);
  for (const g of groups) {
    g.availability_keys = Object.fromEntries(g.names.map((n) => [n, [n, ...(SUPPLEMENT_ALIASES[n.toLowerCase()] || [])]]));
  }

  // Produits de menu.html (scanMenuItems() de cart.js).
  const pizzasSection = byId(menu, 'pizzas');
  const products = [];
  for (const item of byClass(menu, 'menu-item')) {
    const nameEl = first(item, 'menu-item__name');
    if (!nameEl) continue;
    const name = textContent(nameEl).trim();
    need(name !== '', 'menu.html : fiche sans nom');
    const parsed = readMenuItemIngredients(item);
    const ownPriceEl = first(item, 'menu-item__price');
    const category = closest(item, (x) => hasClass(x, 'menu-category'));
    const categoryId = category ? (category.attrs.id || null) : null;
    // Libellé de ticket différent du nom client (SBT-010, ex. boissons « Canette Coca-Cola » -> ticket « Canette Coca ») :
    // attribut data-ticket-name sur le <h3>, prioritaire sur la règle générique (préfixe de catégorie).
    const ticketOverride = nameEl.attrs && typeof nameEl.attrs['data-ticket-name'] === 'string' ? nameEl.attrs['data-ticket-name'].trim() : '';
    const base = {
      name,
      line_name: ticketOverride !== '' ? ticketOverride : qualifiedName(name, categoryId, cart.labels),
      category: categoryId,
      kind: 'product',
      ingredients: parsed.ingredients,
      availability: null,
      choice: null,
      half_allowed: false,
      half_flavor: false,
      prices_by_size: null,
      price_cents: null,
      orderable: false,
      price_source: null,
      source: 'menu.html',
    };
    if (ownPriceEl) {
      const p = parsePriceCents(textContent(ownPriceEl));
      if (p !== null) Object.assign(base, { price_cents: p, orderable: true, price_source: 'item_price' });
      else notes.push(`« ${base.line_name} » : prix de fiche illisible, article non commandable.`);
      products.push(base);
      continue;
    }
    if (category) {
      const p = priceFromCategoryNote(category);
      if (p !== null) {
        Object.assign(base, { price_cents: p.cents, orderable: true, price_source: p.source });
        if (p.source === 'category_title') {
          notes.push(`« ${base.line_name} » : prix lu dans le titre de catégorie « ${p.text} » (la note de prix ne contient pas de prix), comme le fait cart.js ; ${categoryId === 'tex-mex' ? '5,00 € par article au choix du client, validé par le propriétaire le 19/11/2026 (« Au choix » se lit avec le titre)' : 'à confirmer'}.`);
        }
        products.push(base);
        continue;
      }
    }
    const choice = parsed.choice && parsed.choice.options.length ? { ...parsed.choice, required: true } : null;
    const noHalf = Object.prototype.hasOwnProperty.call(item.attrs, 'data-no-half');
    Object.assign(base, {
      line_name: name, // les pizzas ne sont pas préfixées (pas de libellé de catégorie)
      kind: 'pizza',
      choice,
      half_allowed: !noHalf,
      half_flavor: !!pizzasSection && closest(item, (x) => x === pizzasSection) !== null && !noHalf,
      prices_by_size: sizes,
      orderable: true,
      price_source: 'size_chart',
    });
    products.push(base);
  }

  // Disponibilité : ingrédients de l'espace commerçant (MENU), pour chaque produit de la carte.
  const cmenu = readCommercantMenu(read('assets/js/commercant.js'));
  for (const p of products) {
    const ing = cmenu[p.category] && cmenu[p.category][p.name];
    need(Array.isArray(ing), `commercant.js : « ${p.name} » (${p.category}) absent de MENU`);
    p.availability = availabilityFrom(ing, `commercant.js : « ${p.name} »`);
    const pageChoice = p.choice ? p.choice.options.map(normName).sort().join('|') : '';
    const menuChoice = p.availability.choice ? p.availability.choice.map(normName).sort().join('|') : '';
    need(pageChoice === menuChoice, `« ${p.name} » : choix de menu.html et de commercant.js différents`);
  }

  // Base composée (scanComposerBase() de cart.js) : nom fixe, sans moitié-moitié.
  // Ingrédients lus dans composer.html (« Marguerita : sauce tomate ou crème fraîche (au choix), fromage. ») :
  // fixes = parties sans « ou », choix (facultatif dans le nom de ligne) = parties avec « ou ».
  const baseEl = first(comp, 'compose-pizza__base');
  need(baseEl, 'composer.html : description de la base (.compose-pizza__base) introuvable');
  const baseText = textContent(baseEl);
  need(baseText.indexOf(':') > 0, 'composer.html : description de la base sans « : »');
  const composerFixed = [];
  let composerChoice = null;
  for (const part of baseText.slice(baseText.indexOf(':') + 1).split(',')) {
    const clean = part.replace(/\(au choix\)/i, '').replace(/[.\s]+$/, '').trim().toLowerCase();
    if (!clean) continue;
    if (/\s+ou\s+/i.test(clean)) {
      need(composerChoice === null, 'composer.html : deux choix dans la description de la base');
      composerChoice = clean.split(/\s+ou\s+/i).map((s) => s.trim()).filter(Boolean);
    } else {
      composerFixed.push(clean);
    }
  }
  need(composerFixed.length > 0 && composerChoice && composerChoice.length > 1, 'composer.html : base illisible (ingrédients fixes et choix attendus)');
  products.push({
    name: cart.composerName,
    line_name: cart.composerName,
    category: 'composer',
    kind: 'pizza',
    ingredients: composerFixed,
    availability: { fixed: composerFixed, choice: composerChoice },
    choice: { label: 'Base au choix', options: composerChoice, required: false },
    half_allowed: false,
    half_flavor: false,
    prices_by_size: composerSizes,
    price_cents: null,
    orderable: true,
    price_source: 'size_chart',
    source: 'composer.html',
  });

  need(products.filter((p) => p.kind === 'pizza').length > 1, 'menu.html : aucune pizza lue');
  need(products.filter((p) => p.kind === 'product').length > 0, 'menu.html : aucun produit à prix fixe lu');
  const keys = new Map();
  for (const p of products) {
    need(!/\s*[—–]\s*|\s+-\s+/u.test(p.line_name), `« ${p.line_name} » contient un séparateur de garniture`);
    for (const k of nameKeys(p.line_name)) {
      const id = p.kind + ':' + k;
      need(!keys.has(id), `Deux articles se confondent : « ${keys.get(id)} » et « ${p.line_name} »`);
      keys.set(id, p.line_name);
    }
  }
  for (const p of products.filter((x) => !x.orderable)) notes.push(`« ${p.line_name} » : aucun prix lisible, non commandable.`);

  return {
    schema: 1,
    sources: ['menu.html', 'supplements.html', 'composer.html', 'assets/js/cart.js', 'assets/js/commercant.js'],
    sizes: SIZE_ORDER.map((s) => ({ name: s, price_cents: sizes[s] })),
    products,
    supplement_groups: groups,
    zones: cart.zones,
    notes,
  };
}

export function serialize(cat) {
  return JSON.stringify(cat, null, 2) + '\n';
}

function main(argv) {
  const outIdx = argv.indexOf('--out');
  const out = outIdx >= 0 ? path.resolve(argv[outIdx + 1] || '') : OUTPUT;
  const text = serialize(buildCatalogue());
  if (argv.includes('--check')) {
    let current = '';
    try { current = readFileSync(OUTPUT, 'utf8'); } catch { /* absent */ }
    if (current !== text) {
      process.stderr.write('api/data/catalogue.json ne correspond plus aux pages : relancez node tools/build-catalogue.mjs\n');
      return 1;
    }
    process.stdout.write('Catalogue à jour.\n');
    return 0;
  }
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, text);
  const cat = JSON.parse(text);
  process.stdout.write(`Catalogue écrit : ${path.relative(ROOT, out) || out} — ${cat.products.length} articles, ${cat.supplement_groups.length} groupes de suppléments, ${cat.zones.length} zones.\n`);
  for (const n of cat.notes) process.stdout.write(`  note : ${n}\n`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (e) {
    if (e instanceof BuildError) {
      process.stderr.write(`Échec : ${e.message}\n`);
      process.exitCode = 1;
    } else {
      throw e;
    }
  }
}
