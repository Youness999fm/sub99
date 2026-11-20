// Batterie 10 — FALSIFICATION DES PRIX ET DES TOTAUX (API, abusif).
// Le client ne doit JAMAIS pouvoir payer moins ni obtenir plus : prix unitaires, suppléments, crédits d'échange, moitié-moitié,
// retraits, promotions, frais, minimum par zone, quantités, clé d'envoi, modes et moyens de paiement sont falsifiés de toutes
// les façons ; chaque refus est vérifié (statut et code précis) et RIEN ne doit être enregistré.
// Les totaux attendus viennent d'un oracle indépendant (tests/massif/lib/10-oracle.mjs), jamais du serveur.
//
//   node tests/massif/lancer.mjs tests/massif/10-falsification-prix.mjs --timeout=480
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { demarrerSite } from './lib/env.mjs';
import { creerClients, enParallele, patronConnecte, ClientIP, ipFictive, VILLES as VILLES_SERVEUR } from './lib/clients.mjs';
import * as O from './lib/10-oracle.mjs';
import { ALTERATIONS } from './lib/10-alterations.mjs';
import { creerRapport, creerBanc, evaluer, observe, comparerCommande, auditerBase, percentile } from './lib/10-outils.mjs';

const rapport = creerRapport();
const { controle, detail, info, titre } = rapport;
const t0Global = Date.now();
const phases = [];
const finPhase = (nom, debut) => { phases.push([nom, Math.round((performance.now() - debut) / 100) / 10]); };

// Garde-fou : le script ne doit jamais dépasser 7 minutes (le lanceur coupe à 8).
const garde = setTimeout(() => { console.log('FAIL garde-fou : durée maximale de 420 s dépassée'); process.exit(1); }, 420000);
garde.unref();
process.on('unhandledRejection', (e) => { console.log('FAIL erreur non rattrapée : ' + ((e && e.stack) || e)); process.exit(1); });

const VH = 'Hénin-Beaumont';
const NB_CLIENTS = 48;

// ============================================================================================ outils de scénario
const L = (name, variant, unit, o = {}) => ({ name, variant, qty: 1, unit_price_cents: unit, removed: [], extras: [], half: null, note: '', ...o });
const X = (name, prix, qty = 1) => ({ name, price_cents: prix, qty });
const REG = (o) => L('Régina', 'Solo', 1100, o);
const REG2 = (o) => L('Régina', 'Duo', 1600, o);
const BOI = (o) => L('Boisson Oasis Pomme Poire canette', '', 150, o);
const PAT = (o) => L('Pâtes Bolognaise', '', 850, o);
const V = (...champs) => ({ statut: 422, code: 'validation', champs });
const M = (index, exp, sent) => ({ statut: 422, code: 'price_mismatch_line', extra: { index, expected_unit_cents: exp, sent_unit_cents: sent } });
const INC = (name) => ({ statut: 422, code: 'unknown_item', extra: name === undefined ? {} : { name } });
const T409 = (srvTotal, extra = {}) => ({ statut: 409, code: 'price_mismatch', extra: { server_total_cents: srvTotal, ...extra } });

const rEssais = O.rng(5050);
/** Corps de commande ; les montants sont calculés avec les prix DÉCLARÉS (un client falsificateur mais soigneux), sauf surcharge. */
function cmd(items, o = {}) {
  const mode = o.mode ?? 'pickup';
  const ville = o.ville ?? VH;
  let decl = null;
  try { decl = O.totauxDeclares({ mode, items }, ville); } catch { decl = null; }
  const entier = (x, defaut) => (Number.isInteger(x) && x >= 0 ? x : defaut);
  // Une surcharge présente (même null ou undefined) est respectée telle quelle.
  const a = (cle, defaut) => (Object.prototype.hasOwnProperty.call(o, cle) ? o[cle] : defaut);
  return {
    idempotency_key: a('cle', O.cleEnvoi(rEssais, 'essai')),
    mode,
    payment_methods: a('paiements', mode === 'delivery' ? ['card'] : []),
    cash_change_for: a('billet', null),
    items,
    delivery_fee_cents: a('frais', entier(decl && decl.frais, 0)),
    total_cents: a('total', entier(decl && decl.total, 0))
  };
}
const brutAvec = (corps, avant, apres) => JSON.stringify(corps).replace(avant, apres);

// ============================================================================================ 0. référence (sans serveur)
let phase = performance.now();
titre('0. Référence : barème public, catalogue du serveur, oracle de prix');
const cat = O.chargerCatalogue();
const idx = O.indexer(cat);
const egal = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const euros = (t) => { const m = t.match(/(\d+)(?:,(\d{2}))?\s*€/); return Number(m[1]) * 100 + Number(m[2] || 0); };
const racine = (f) => new URL('../../' + f, import.meta.url);
const tableTailles = (html) => Object.fromEntries([...html.matchAll(/size-chart__name">([^<]+)<[\s\S]*?size-chart__price">([^<]+)</g)].map((m) => [m[1], euros(m[2])]));
const menu = readFileSync(racine('menu.html'), 'utf8');
const compo = readFileSync(racine('composer.html'), 'utf8');
const supp = readFileSync(racine('supplements.html'), 'utf8');
const lignesSupp = [...supp.matchAll(/compose-price-row__name">([^<]+)<\/span><span class="compose-price-row__price">([^<]+)</g)].map((m) => [m[1], euros(m[2])]);
controle('R01 pizzas du menu.html = barème codé en dur (11 / 16 / 23 / 33 €)', egal(tableTailles(menu), O.BAREME.pizza), JSON.stringify(tableTailles(menu)));
controle('R02 pizza à composer (composer.html) = barème codé en dur (9 / 13 / 17,50 / 25,50 €)', egal(tableTailles(compo), O.BAREME.composee), JSON.stringify(tableTailles(compo)));
controle('R03 suppléments (supplements.html) = barème codé en dur (légumes 1 / 1,50 / 2,50 / 3,50 € ; viandes 1,50 / 2 / 3 / 4 €)',
  egal(Object.fromEntries(lignesSupp.slice(0, 4)), O.BAREME.legumes) && egal(Object.fromEntries(lignesSupp.slice(4, 8)), O.BAREME.viandes), JSON.stringify(lignesSupp));
const pizzasStandard = idx.pizzas.filter((p) => p.category !== 'composer');
controle(`R04 les ${pizzasStandard.length} pizzas du catalogue serveur ont le barème public à chaque taille`,
  pizzasStandard.every((p) => egal(p.prices_by_size, O.BAREME.pizza)), 'catalogue.json');
controle('R05 la pizza à composer du catalogue serveur a le barème public de composer.html',
  idx.pizzas.filter((p) => p.category === 'composer').every((p) => egal(p.prices_by_size, O.BAREME.composee)), 'catalogue.json');
controle('R06 les deux groupes de suppléments du catalogue serveur ont le barème public',
  egal(idx.groupes[0].prix, O.BAREME.legumes) && egal(idx.groupes[1].prix, O.BAREME.viandes), JSON.stringify(idx.groupes.map((g) => g.prix)));
const fautes = [];
for (const [cle, cents] of Object.entries(O.BAREME.categories)) {
  for (const p of idx.produits.filter((x) => x.category === cle)) if (p.price_cents !== cents) fautes.push(`${p.line_name} ${p.price_cents}`);
}
for (const [nom, cents] of Object.entries(O.BAREME.fiches)) {
  const p = idx.produits.find((x) => x.name === nom);
  if (!p || p.price_cents !== cents) fautes.push(`${nom} ${p && p.price_cents}`);
}
controle(`R07 les ${idx.produits.length} produits du catalogue serveur ont le prix public (pâtes 8,50 ; subitowichs 6 ; Tex-Mex 5 ; salades 7,50 ; fiches)`, fautes.length === 0, fautes.join(', ') || 'conformes');
controle('R08 les 8 zones du catalogue serveur = minimum et frais publics',
  egal(cat.zones.map((z) => [z.city, z.minimum_cents, z.fee_cents]), O.VILLES.map((v) => [v, O.ZONES[v].min, O.ZONES[v].frais])), JSON.stringify(cat.zones.map((z) => [z.city, z.minimum_cents, z.fee_cents])));
controle('R09 les villes servies par le serveur (serveur/util.js) = les villes de l\'oracle', egal([...VILLES_SERVEUR].sort(), [...O.VILLES].sort()), VILLES_SERVEUR.join(', '));

// Oracle : exemples calculés à la main
const ligneOr = (name, variant, o = {}) => O.prixLigne(idx, { name, variant, qty: 1, removed: [], extras: [], half: null, ...o });
controle('O01 oracle : Régina Solo = 11,00 € ; Duo olives = 17,50 € ; Duo poulet = 18,00 €',
  ligneOr('Régina', 'Solo').unit === 1100 && ligneOr('Régina', 'Duo', { extras: [{ name: 'olives' }] }).unit === 1750 && ligneOr('Régina', 'Duo', { extras: [{ name: 'poulet' }] }).unit === 1800);
const ex1350 = ligneOr('Régina', 'Solo', { removed: ['jambon', 'champignons'], extras: ['poulet', 'oignons', 'thon', 'olives'].map((n) => ({ name: n })) });
controle('O02 oracle : Régina Solo sans jambon ni champignons + poulet, oignons (offerts) + thon, olives = 13,50 €', ex1350.unit === 1350 && egal(ex1350.extras, [0, 0, 150, 100]), JSON.stringify(ex1350.extras));
controle('O03 oracle : 2 pizzas Solo à emporter = 1 payée ; en livraison la 2e à moitié prix',
  O.promoCents([1100, 1100], 'pickup') === 1100 && O.promoCents([1100, 1100], 'delivery') === 550);
controle('O04 oracle : 33 + 23 + 11 € à emporter -> 23 € offerts ; en livraison -> 11,50 € de remise (3 pizzas : une seule paire)',
  O.promoCents([3300, 2300, 1100], 'pickup') === 2300 && O.promoCents([3300, 2300, 1100], 'delivery') === 1150);
controle('O05 oracle : arrondi par paire en livraison (12,01 / 10,01 / 10,00 / 9,99 -> 5,01 + 5,00)', O.promoCents([1201, 1001, 1000, 999], 'delivery') === 1001);
controle('O06 oracle : livraison sans pizza = frais de la zone ; avec une pizza = offerts',
  O.totaux([{ unit: 850, qty: 1, pizza: false }, { unit: 150, qty: 1, pizza: false }], 'delivery', VH).total === 1550 && O.totaux([{ unit: 1100, qty: 1, pizza: true }], 'delivery', 'Rouvroy').total === 1100);
controle('O07 oracle : 60 pizzas Solo à emporter = 30 payées', O.totaux([{ unit: 1100, qty: 60, pizza: true }], 'pickup', null).total === 33000);
{
  const r = O.rng(42);
  let ecarts = 0;
  for (let k = 0; k < 300; k++) {
    const n = r.entier(0, 8);
    const p = Array.from({ length: n }, () => r.choix([900, 1100, 1250, 1300, 1600, 1750, 2300, 3300]));
    for (const m of ['pickup', 'delivery']) if (O.promoCents(p, m) !== O.promoForceBrute(p, m)) ecarts++;
  }
  controle('O08 oracle : l\'appariement du prix le plus haut au plus bas donne la meilleure remise parmi TOUS les appariements (600 paniers)', ecarts === 0, `${ecarts} écart(s)`);
}
{
  const a = O.rng(1010);
  const b = O.rng(1010);
  const sans = (x) => JSON.stringify(x).replace(/"idempotency_key":"[^"]+"/g, '');
  const g1 = Array.from({ length: 30 }, () => O.genererCommande(a, idx).corps);
  const g2 = Array.from({ length: 30 }, () => O.genererCommande(b, idx).corps);
  controle('O09 générateur : même graine = mêmes commandes (reproductible)', sans(g1) === sans(g2), `${sans(g1).length} caractères identiques`);
}
finPhase('0 référence', phase);

// ============================================================================================ 1. serveur et clients
phase = performance.now();
titre('1. Serveur local, horloge du serveur pilotée, clients');
const epoch0 = Math.floor(Date.now() / 1000);
const site = await demarrerSite({ horloge: epoch0 });
let codeSortie = 1;
try {
  const tc = performance.now();
  const clients = await creerClients(NB_CLIENTS, { concurrence: 8, prefixe: 'prix' });
  controle(`S01 ${NB_CLIENTS} comptes clients créés (6 par ville de livraison)`, clients.length === NB_CLIENTS && new Set(clients.map((c) => c.ville)).size === 8, `${Math.round(performance.now() - tc)} ms`);
  const banc = creerBanc({ site, clients, epoch0 });
  finPhase('1 clients', phase);

  // ---------------------------------------------------------------------------------------- aides d'exécution
  async function essayer(client, corps, { brut = null } = {}) {
    const n0 = banc.nbCommandes();
    const rep = await banc.commander(client, corps, { brut });
    return { rep, delta: banc.nbCommandes() - n0 };
  }
  function verdict(nom, ecarts, rep, corps, brut) {
    const ok = controle(nom, ecarts.length === 0, ecarts.length === 0 ? observe(rep) : `${observe(rep)} ✗ ${ecarts.join(' ; ')}`);
    if (!ok) detail(`requête : ${brut ?? JSON.stringify(corps)} ; réponse : ${rep.text}`);
    return ok;
  }
  /** La requête DOIT être refusée avec ce statut et ce code, et rien ne doit être enregistré. */
  async function refus(nom, client, corps, att, { brut = null } = {}) {
    const { rep, delta } = await essayer(client, corps, { brut });
    const e = evaluer(rep, att);
    if (delta !== 0) e.push(`${delta} commande(s) enregistrée(s) alors que la requête devait être refusée`);
    verdict(nom, e, rep, corps, brut);
    return rep;
  }
  /** La requête DOIT être acceptée (201) avec exactement les montants de l'oracle. */
  async function accepte(nom, client, corps, { ville = client.ville, brut = null, verif = null } = {}) {
    const { rep, delta } = await essayer(client, corps, { brut });
    const e = [];
    if (rep.status !== 201) e.push(`statut ${rep.status} au lieu de 201 : ${String(rep.text).slice(0, 220)}`);
    else {
      const calcul = O.calculerCommande(idx, corps, ville);
      if (calcul.t === null) e.push('oracle : ' + calcul.erreurs.join(' ; '));
      else e.push(...comparerCommande(rep.json.order, corps, calcul, ville));
      if (rep.json.replayed !== false) e.push('replayed devrait valoir false');
      if (delta !== 1) e.push(`${delta} commande(s) enregistrée(s) au lieu de 1`);
    }
    if (verif) e.push(...verif(rep));
    verdict(nom, e, rep, corps, brut);
    return rep;
  }
  /** Comportement toléré dans les deux sens (refus propre ou acceptation SÛRE) : jamais de 5xx, jamais de valeur dangereuse. */
  async function sur(nom, client, corps, { brut = null, siAccepte = () => [], siRefuse = () => [] } = {}) {
    const { rep, delta } = await essayer(client, corps, { brut });
    const e = [];
    if (rep.status === 201) {
      if (delta !== 1) e.push(`${delta} commande(s) enregistrée(s) au lieu de 1`);
      e.push(...siAccepte(rep));
    } else if (rep.status >= 400 && rep.status < 500) {
      if (delta !== 0) e.push(`${delta} commande(s) enregistrée(s) malgré le refus`);
      e.push(...siRefuse(rep));
    } else e.push(`statut inattendu ${rep.status}`);
    verdict(nom, e, rep, corps, brut);
    return rep;
  }
  const verifierComptage = (nom) => {
    const n = banc.nbCommandes();
    controle(nom, n === banc.acceptes.size, `${n} commande(s) en base, ${banc.acceptes.size} acceptée(s) par le serveur`);
  };
  const ligneBase = (id) => site.db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  const lp = (nom, variant, qty = 1, o = {}) => O.calerLigne(idx, { name: nom, variant, qty, unit_price_cents: 1, removed: [], extras: [], half: null, note: '', ...o }).ligne;
  const any = () => banc.suivant();
  const henin = () => banc.clientDe(VH);

  // ======================================================================================== 2. témoins positifs
  phase = performance.now();
  titre('2. Témoins : tout le catalogue, aux prix officiels, est accepté (sinon les refus ci-dessous ne prouveraient rien)');
  const toutes = [];
  for (const p of idx.pizzas) {
    const garnitures = p.choice ? (p.choice.required ? p.choice.options : [null, ...p.choice.options]) : [null];
    for (const g of garnitures) for (const t of O.TAILLES) toutes.push(lp(p.line_name + (g ? ' — ' + O.capPremiere(g) : ''), t));
  }
  for (const p of idx.produits) toutes.push(lp(p.line_name, ''));
  for (let k = 0; k * 40 < toutes.length; k++) {
    const morceau = toutes.slice(k * 40, k * 40 + 40);
    await accepte(`T${k + 1} commande de ${morceau.length} lignes du catalogue (n° ${k * 40 + 1} à ${k * 40 + morceau.length}), prix officiels`, any(), cmd(morceau, { ville: VH }));
  }
  controle(`T0 ${toutes.length} lignes (31 pizzas x tailles x garnitures, ${idx.produits.length} produits) toutes acceptées au prix du barème`, banc.acceptes.size === Math.ceil(toutes.length / 40), `${banc.acceptes.size} commandes`);
  finPhase('2 témoins', phase);

  // ======================================================================================== 3. balayage du catalogue
  phase = performance.now();
  titre('3. Balayage exhaustif : chaque article, chaque taille, prix -1 / +1 centime, puis prix d\'une autre taille');
  {
    const n0 = banc.nbCommandes();
    const groupes = new Map();
    const taches = [];
    for (const l of toutes) {
      const base = O.decouper(l.name)[0];
      for (const d of [-1, 1]) {
        const copie = { ...structuredClone(l), unit_price_cents: l.unit_price_cents + d };
        taches.push({ base, d, l, corps: cmd([copie]) });
      }
    }
    const res = await enParallele(taches, 8, async (t) => ({ t, rep: await banc.commander(any(), t.corps) }));
    for (const { t, rep } of res) {
      if (!groupes.has(t.base)) groupes.set(t.base, { n: 0, e: [] });
      const g = groupes.get(t.base);
      g.n++;
      const e = evaluer(rep, M(0, t.l.unit_price_cents, t.l.unit_price_cents + t.d));
      if (e.length) g.e.push(`${t.l.name}/${t.l.variant} ${t.d > 0 ? '+' : ''}${t.d} : ${e.join(', ')}`);
    }
    for (const [base, g] of groupes) controle(`S ±1 centime sur « ${base} » : ${g.n} requêtes refusées 422 price_mismatch_line`, g.e.length === 0, g.e.length ? g.e.slice(0, 3).join(' | ') : `${g.n}/${g.n} refusées avec le prix attendu`);
    controle(`S0 balayage ±1 centime : ${taches.length} requêtes, rien enregistré`, banc.nbCommandes() === n0, `${banc.nbCommandes() - n0} commande(s) créée(s)`);

    // prix de la plus petite taille (ou d'une taille inférieure) déclaré sur les tailles supérieures
    const taches2 = [];
    for (const l of toutes.filter((x) => x.variant === 'Solo' && x.variant !== '')) {
      for (const t of ['Duo', 'Quatro', 'XXL']) taches2.push({ l, t, corps: cmd([{ ...structuredClone(l), variant: t }]) });
    }
    const res2 = await enParallele(taches2, 8, async (x) => ({ x, rep: await banc.commander(any(), x.corps) }));
    const par = new Map();
    for (const { x, rep } of res2) {
      const attendu = O.prixLigne(idx, { ...x.l, variant: x.t }).unit;
      const e = evaluer(rep, M(0, attendu, x.l.unit_price_cents));
      const base = O.decouper(x.l.name)[0];
      if (!par.has(base)) par.set(base, { n: 0, e: [] });
      par.get(base).n++;
      if (e.length) par.get(base).e.push(`${x.t} : ${e.join(', ')}`);
    }
    for (const [base, g] of par) controle(`S prix de la taille Solo déclaré en Duo / Quatro / XXL sur « ${base} » : ${g.n} refusés`, g.e.length === 0, g.e.length ? g.e.join(' | ') : `${g.n}/${g.n} refusées`);
    controle(`S0 balayage des tailles : ${taches2.length} requêtes, rien enregistré`, banc.nbCommandes() === n0, `${banc.nbCommandes() - n0} commande(s) créée(s)`);
  }
  finPhase('3 balayage', phase);

  // ======================================================================================== 4. attaques ciblées
  phase = performance.now();
  titre('A. Prix unitaire falsifié (±1 centime, 0, négatif, flottant, énorme, chaîne, types étranges)');
  {
    const A = (id, titreCas, ligne, att, o = {}) => refus(`A${id} ${titreCas}`, any(), cmd([ligne], o), att);
    await A('01', 'prix -1 centime (10,99 € au lieu de 11,00 €)', REG({ unit_price_cents: 1099 }), M(0, 1100, 1099));
    await A('02', 'prix +1 centime (11,01 €)', REG({ unit_price_cents: 1101 }), M(0, 1100, 1101));
    await A('03', 'prix 0', REG({ unit_price_cents: 0 }), V('items[0].unit_price_cents'));
    await A('04', 'prix -1', REG({ unit_price_cents: -1 }), V('items[0].unit_price_cents'));
    await A('05', 'prix négatif -1100', REG({ unit_price_cents: -1100 }), V('items[0].unit_price_cents'));
    await A('06', 'prix flottant 1100.5', REG({ unit_price_cents: 1100.5 }), V('items[0].unit_price_cents'));
    await A('07', 'prix flottant 1099.99', REG({ unit_price_cents: 1099.99 }), V('items[0].unit_price_cents'));
    await A('08', 'prix énorme 99 999 999', REG({ unit_price_cents: 99999999 }), V('items[0].unit_price_cents'));
    await A('09', 'prix 50001 (juste au-dessus du plafond de 500 €)', REG({ unit_price_cents: 50001 }), V('items[0].unit_price_cents'));
    await A('10', 'prix 50000 (dans la plage mais faux)', REG({ unit_price_cents: 50000 }), M(0, 1100, 50000));
    await A('11', 'prix en chaîne "1100"', REG({ unit_price_cents: '1100' }), V('items[0].unit_price_cents'));
    await A('12', 'prix "abc"', REG({ unit_price_cents: 'abc' }), V('items[0].unit_price_cents'));
    await A('13', 'prix chaîne vide', REG({ unit_price_cents: '' }), V('items[0].unit_price_cents'));
    await A('14', 'prix null', REG({ unit_price_cents: null }), V('items[0].unit_price_cents'));
    await A('15', 'prix true', REG({ unit_price_cents: true }), V('items[0].unit_price_cents'));
    await A('16', 'prix tableau vide', REG({ unit_price_cents: [] }), V('items[0].unit_price_cents'));
    await A('17', 'prix objet vide', REG({ unit_price_cents: {} }), V('items[0].unit_price_cents'));
    await A('18', 'prix [1100]', REG({ unit_price_cents: [1100] }), V('items[0].unit_price_cents'));
    { const l = REG(); delete l.unit_price_cents; await A('19', 'prix absent', l, V('items[0].unit_price_cents')); }
    await A('20', 'prix 1e21', REG({ unit_price_cents: 1e21 }), V('items[0].unit_price_cents'));
    await A('21', 'prix 9007199254740993 (au-delà des entiers sûrs)', REG({ unit_price_cents: 9007199254740993 }), V('items[0].unit_price_cents'));
    await A('22', 'pizza Solo au prix d\'une boisson (1,50 €)', REG({ unit_price_cents: 150 }), M(0, 1100, 150), { total: 150 });
    await A('23', 'pizza Solo à 1 centime', REG({ unit_price_cents: 1 }), M(0, 1100, 1), { total: 1 });
    await A('24', 'Régina XXL au prix Solo (11,00 € au lieu de 33,00 €)', L('Régina', 'XXL', 1100), M(0, 3300, 1100));
    await A('25', 'Régina Solo au prix XXL (33,00 €)', REG({ unit_price_cents: 3300 }), M(0, 1100, 3300));
    await A('26', 'boisson 1,49 €', BOI({ unit_price_cents: 149 }), M(0, 150, 149));
    await A('27', 'boisson 1,51 €', BOI({ unit_price_cents: 151 }), M(0, 150, 151));
    await A('28', 'boisson à 1 centime', BOI({ unit_price_cents: 1 }), M(0, 150, 1));
    await A('29', 'pâtes Bolognaise à 3 €', PAT({ unit_price_cents: 300 }), M(0, 850, 300));
    await A('30', 'pizza à composer au prix d\'une pizza de la carte (11,00 € au lieu de 9,00 €)', L('Marguerita (base)', 'Solo', 1100), M(0, 900, 1100));
    await A('31', 'pizza à composer 8,99 €', L('Marguerita (base)', 'Solo', 899), M(0, 900, 899));
    await A('32', 'calzone garnie à 15,99 € (Duo)', L('Calzone (soufflée) — Thon', 'Duo', 1599), M(0, 1600, 1599));
    await A('33', 'moitié-moitié Duo au prix Solo', L('Régina', 'Duo', 1100, { half: { flavor1: 'Régina', flavor2: 'Kebab' } }), M(0, 1600, 1100));
    // plusieurs lignes : l'index de la ligne fausse est renvoyé
    await refus('A34 trois lignes dont la dernière est fausse : l\'index 2 est désigné', any(), cmd([REG(), BOI(), PAT({ unit_price_cents: 849 })]), M(2, 850, 849));
    await refus('A35 la ligne fausse est la première de deux', any(), cmd([REG({ unit_price_cents: 1 }), BOI()]), M(0, 1100, 1));
    // textes JSON bruts
    const c = cmd([REG()]);
    const refusBrut = (id, titreCas, avant, apres, att) => refus(`A${id} ${titreCas}`, any(), c, att, { brut: brutAvec(c, avant, apres) });
    await refusBrut('36', 'JSON brut : prix NaN (non JSON)', '"unit_price_cents":1100,', '"unit_price_cents":NaN,', { statut: 400, code: 'bad_request' });
    await refusBrut('37', 'JSON brut : prix Infinity', '"unit_price_cents":1100,', '"unit_price_cents":Infinity,', { statut: 400, code: 'bad_request' });
    await refusBrut('38', 'JSON brut : prix -Infinity', '"unit_price_cents":1100,', '"unit_price_cents":-Infinity,', { statut: 400, code: 'bad_request' });
    await refusBrut('39', 'JSON brut : prix hexadécimal 0x44c', '"unit_price_cents":1100,', '"unit_price_cents":0x44c,', { statut: 400, code: 'bad_request' });
    await refusBrut('40', 'JSON brut : prix avec zéro de tête 01100', '"unit_price_cents":1100,', '"unit_price_cents":01100,', { statut: 400, code: 'bad_request' });
    await refusBrut('41', 'JSON brut : prix 1e308', '"unit_price_cents":1100,', '"unit_price_cents":1e308,', V('items[0].unit_price_cents'));
    await refusBrut('42', 'JSON brut : clé en double, la dernière gagne (1100 puis 1)', '"unit_price_cents":1100,', '"unit_price_cents":1100,"unit_price_cents":1,', M(0, 1100, 1));
    for (const [id, ecriture] of [['43', '1100.0'], ['44', '1.1e3'], ['45', '11e2'], ['46', '1100.000'], ['47', '110.0e1']]) {
      await accepte(`A${id} JSON brut : le même prix écrit ${ecriture} = 1100 : accepté, enregistré à 1100`, any(), c, { brut: brutAvec(c, '"unit_price_cents":1100,', `"unit_price_cents":${ecriture},`) });
    }
    await accepte('A48 JSON brut : clé en double, la dernière gagne (1 puis 1100) -> 1100', any(), c, { brut: brutAvec(c, '"unit_price_cents":1100,', '"unit_price_cents":1,"unit_price_cents":1100,') });
  }

  titre('B. Suppléments : prix modifié, inconnu, quantité, doublons');
  {
    const duo = (extras, unit, o = {}) => REG2({ unit_price_cents: unit, extras, ...o });
    const B = (id, titreCas, ligne, att) => refus(`B${id} ${titreCas}`, any(), cmd([ligne]), att);
    await B('01', 'olives (Duo 1,50 €) à 1,49 €, prix de ligne cohérent', duo([X('olives', 149)], 1749), M(0, 1750, 1749));
    await B('02', 'olives à 1,51 €', duo([X('olives', 151)], 1751), M(0, 1750, 1751));
    await B('03', 'olives gratuites sans échange', duo([X('olives', 0)], 1600), M(0, 1750, 1600));
    await B('04', 'olives au prix Solo (1,00 €) sur une Duo', duo([X('olives', 100)], 1700), M(0, 1750, 1700));
    await B('05', 'prix de supplément négatif', duo([X('olives', -1)], 1599), V('items[0].extras'));
    await B('06', 'prix de supplément 10001', duo([X('olives', 10001)], 1750), V('items[0].extras'));
    await B('07', 'prix de supplément en chaîne', duo([X('olives', '150')], 1750), V('items[0].extras'));
    await B('08', 'prix de supplément flottant', duo([X('olives', 150.5)], 1750), V('items[0].extras'));
    await B('09', 'prix de supplément null', duo([X('olives', null)], 1750), V('items[0].extras'));
    await B('10', 'poulet (groupe viandes, 2,00 € en Duo) au prix du groupe légumes (1,50 €)', duo([X('poulet', 150)], 1750), M(0, 1800, 1750));
    await B('11', 'supplément inconnu « caviar »', duo([X('caviar', 200)], 1800), INC('caviar'));
    await B('12', 'supplément inconnu « truffe » gratuit', duo([X('truffe', 0)], 1600), INC('truffe'));
    await B('13', 'supplément au nom vide', duo([X('', 150)], 1750), INC(''));
    await B('14', 'supplément au nom de 61 caractères', duo([X('a'.repeat(61), 150)], 1750), V('items[0].extras'));
    await B('15', 'supplément dont le nom est un nombre', duo([X(5, 150)], 1750), V('items[0].extras'));
    await B('16', 'suppléments : liste de chaînes au lieu d\'objets', duo(['olives'], 1750), V('items[0].extras'));
    for (const [k, q] of [0, 2, 3, 10, -1, 1.5, '1', true, [], {}, 100].entries()) {
      await B(`17.${k + 1}`, `quantité de supplément ${JSON.stringify(q)} (une portion, jamais plus)`, duo([X('olives', 150, q)], 1750), V('items[0].extras[0].qty'));
    }
    await B('18', 'olives ×10 déclarées gratuites par un seul retrait (quantité 10)', REG2({ unit_price_cents: 1600, removed: ['champignons'], extras: [X('olives', 0, 10)] }), V('items[0].extras[0].qty'));
    const doublons = [['même nom', X('olives', 150)], ['casse différente', X('Olives', 150)], ['astérisque finale', X('olives*', 150)], ['espace finale', X('olives ', 150)], ['second gratuit', X('olives', 0)], ['majuscules, gratuit', X('OLIVES', 0)]];
    for (const [k, [titreCas, second]] of doublons.entries()) {
      await B(`19.${k + 1}`, `doublon de supplément (${titreCas})`, duo([X('olives', 150), second], 1900), V('items[0].extras[1].name'));
    }
    await B('20', '21 suppléments distincts (20 au plus)', REG2({ unit_price_cents: 9999, extras: idx.supplements.slice(0, 21).map((s) => X(s.nom, 150)) }), V('items[0].extras'));
    await B('21', 'supplément sur un produit sans taille (boisson)', BOI({ extras: [X('olives', 150)] }), INC('olives'));
    await B('22', 'supplément payé alors qu\'il est offert (1 retrait, olives facturées 1,50 €)', REG2({ unit_price_cents: 1750, removed: ['champignons'], extras: [X('olives', 150)] }), M(0, 1600, 1750));
    // témoins : écritures équivalentes acceptées
    await accepte('B23 « olives* » (astérisque finale) est le même supplément, au même prix', any(), cmd([duo([X('olives*', 150)], 1750)]));
    await accepte('B24 « OLIVES » (majuscules) est le même supplément, au même prix', any(), cmd([duo([X('OLIVES', 150)], 1750)]));
    await accepte('B25 quantité de supplément omise = 1 portion, au prix normal', any(), cmd([duo([{ name: 'olives', price_cents: 150 }], 1750)]));
    await accepte('B26 vingt suppléments distincts en XXL au prix exact de l\'oracle', any(), cmd([lp('Régina', 'XXL', 1, { extras: idx.supplements.slice(0, 20).map((s) => X(s.nom, 0)) })]));
  }

  titre('C. Taille inventée');
  {
    const tailles = ['XL', 'Mega', 'solo', 'SOLO', ' Solo', 'Solo ', 'Solo\n', 'Familiale', 'XXXL', 'Quatro​', 5, true, ['Solo'], {}];
    for (const [k, v] of tailles.entries()) await refus(`C${String(k + 1).padStart(2, '0')} taille ${JSON.stringify(v)}`, any(), cmd([REG({ variant: v })]), V('items[0].variant'));
    await refus('C15 taille null sur une pizza : traitée comme un produit sans taille -> article inconnu', any(), cmd([REG({ variant: null })]), INC('Régina'));
  }

  titre('D. Article inconnu ou non commandable en ligne');
  {
    const D = (id, titreCas, ligne, att) => refus(`D${id} ${titreCas}`, any(), cmd([ligne]), att);
    await D('01', '« Pizza Licorne » en Duo', L('Pizza Licorne', 'Duo', 1600), INC('Pizza Licorne'));
    await D('02', '« Margherita » en Duo (absente de la carte)', L('Margherita', 'Duo', 1600), INC('Margherita'));
    await D('03', 'nom vide', L('', 'Duo', 1600), V('items[0].name'));
    await D('04', 'nom réduit à une espace', L(' ', 'Duo', 1600), V('items[0].name'));
    await D('05', 'nom de 121 caractères', L('x'.repeat(121), 'Duo', 1600), V('items[0].name'));
    await D('06', 'nom inconnu de 120 caractères', L('X'.repeat(120), 'Duo', 1600), INC('X'.repeat(120)));
    await D('07', 'nom contenant du HTML', L('<script>alert(1)</script>', '', 150), INC('<script>alert(1)</script>'));
    await D('08', 'nom contenant du SQL (la base doit rester intacte)', L("Régina'; DROP TABLE orders;--", 'Solo', 1100), INC("Régina'; DROP TABLE orders;--"));
    await D('09', 'pizza sans taille (Régina, taille vide)', L('Régina', '', 1100), INC('Régina'));
    await D('10', 'produit avec une taille (boisson en Solo)', L('Boisson Oasis Pomme Poire canette', 'Solo', 150), INC('Boisson Oasis Pomme Poire canette'));
    await D('11', 'calzone sans garniture', L('Calzone (soufflée)', 'Duo', 1600), INC('Calzone (soufflée)'));
    await D('12', 'calzone avec une garniture absente de la fiche', L('Calzone (soufflée) — Saumon', 'Duo', 1600), INC('Calzone (soufflée) — Saumon'));
    await D('13', 'pizza à composer avec une base inconnue', L('Marguerita (base) — Pesto', 'Solo', 900), INC('Marguerita (base) — Pesto'));
    await D('14', 'boisson avec un choix qui n\'existe pas', L('Boisson Oasis Pomme Poire canette — Coca', '', 150), INC('Boisson Oasis Pomme Poire canette — Coca'));
    await D('15', 'pâtes avec un choix qui n\'existe pas', L('Pâtes Bolognaise — Fromage', '', 850), INC('Pâtes Bolognaise — Fromage'));
    await D('16', 'Tex-Mex avec une taille', L('Tex-Mex Wings (5 pièces)', 'Duo', 500), INC('Tex-Mex Wings (5 pièces)'));
    await D('17', '« Régina Duo » (la taille dans le nom)', L('Régina Duo', 'Duo', 1600), INC('Régina Duo'));
    await D('18', 'nom avec saut de ligne', L('Régina\nTruffe', 'Solo', 1100), INC('Régina\nTruffe'));
    await D('19', 'dessert au nom d\'une pizza (Calzone Nutella en Duo)', L('Calzone Nutella', 'Duo', 650), INC('Calzone Nutella'));
  }

  titre('E. Nom de ligne trafiqué (« Margherita — Truffe »)');
  {
    const E = (id, nom, variant, unit) => refus(`E${id} nom « ${nom} »`, any(), cmd([L(nom, variant, unit)]), INC(nom.trim()));
    await E('01', 'Margherita — Truffe', 'Duo', 1600);
    await E('02', 'Régina — Truffe', 'Solo', 1100);
    await E('03', 'Régina - Truffe', 'Solo', 1100);
    await E('04', 'Régina – Truffe', 'Solo', 1100);
    await E('05', 'Régina-Truffe', 'Solo', 1100);
    await E('06', 'Calzone (soufflée) — Truffe', 'Duo', 1600);
    await E('07', 'Calzone (soufflée) — Thon — Truffe', 'Duo', 1600);
    await E('08', 'Régina — ', 'Solo', 1100);
    await E('09', 'Boisson Oasis Pomme Poire canette — Truffe', '', 150);
    await E('10', 'Pâtes Bolognaise — Truffe', '', 850);
    const canonique = (attendu, unit) => (rep) => {
      const o = rep.json && rep.json.order;
      const e = [];
      if (rep.status === 201 && (o.items[0].name !== attendu || o.items[0].unit_price_cents !== unit || o.total_cents !== unit)) e.push(`enregistré « ${o.items[0].name} » à ${o.items[0].unit_price_cents}, total ${o.total_cents}`);
      return e;
    };
    for (const [id, nom] of [['11', 'Régina (OFFERTE par le patron)'], ['12', 'régina.'], ['13', 'Ré​gina'], ['14', 'RÉGINA'], ['15', 'Régina (promo -100%)']]) {
      await sur(`E${id} nom « ${nom.replace('​', '<ZWSP>')} » : refusé, ou accepté sous le nom du catalogue (« Régina », 11,00 €) sans jamais garder le texte injecté`, any(), cmd([L(nom, 'Solo', 1100)]), { siAccepte: canonique('Régina', 1100) });
    }
  }

  titre('F. Moitié-moitié : Solo, calzone, saveur inconnue, formes invalides');
  {
    const F = (id, titreCas, ligne, att) => refus(`F${id} ${titreCas}`, any(), cmd([ligne]), att);
    const demi = (f1, f2) => ({ flavor1: f1, flavor2: f2 });
    await F('01', 'moitié-moitié en Solo', REG({ half: demi('Régina', 'Kebab') }), V('items[0].half'));
    await F('02', 'moitié-moitié sur la calzone', L('Calzone (soufflée) — Thon', 'Duo', 1600, { half: demi('Calzone (soufflée)', 'Régina') }), V('items[0].half'));
    await F('03', 'moitié-moitié sur la pizza à composer', L('Marguerita (base)', 'Duo', 1300, { half: demi('Marguerita (base)', 'Régina') }), V('items[0].half'));
    await F('04', 'moitié-moitié sur un produit sans taille (pâtes)', PAT({ half: demi('Pâtes Bolognaise', 'Régina') }), V('items[0].half'));
    await F('05', 'saveur inconnue « Hawaïenne »', REG2({ half: demi('Régina', 'Hawaïenne') }), INC('Hawaïenne'));
    await F('06', 'deuxième saveur vide', REG2({ half: demi('Régina', '') }), INC(''));
    await F('07', 'première saveur différente de la pizza de la ligne', REG2({ half: demi('Kebab', 'Campione') }), INC('Régina'));
    await F('08', 'deuxième saveur = la calzone', REG2({ half: demi('Régina', 'Calzone (soufflée)') }), INC('Calzone (soufflée)'));
    await F('09', 'deuxième saveur = la pizza à composer', REG2({ half: demi('Régina', 'Marguerita (base)') }), INC('Marguerita (base)'));
    await F('10', 'deuxième saveur = un produit (pâtes)', REG2({ half: demi('Régina', 'Pâtes Bolognaise') }), INC('Pâtes Bolognaise'));
    for (const [k, h] of [{}, [], 'Kebab', { flavor1: 'Régina' }, { flavor1: 1, flavor2: 2 }, false, 0, ''].entries()) {
      await F(`11.${k + 1}`, `forme invalide ${JSON.stringify(h)}`, REG2({ half: h }), V('items[0].half'));
    }
    for (const [t, c] of [['Duo', 1600], ['Quatro', 2300], ['XXL', 3300]]) {
      await accepte(`F12 moitié-moitié ${t} Régina / Kebab : prix de la taille, ni plus ni moins`, any(), cmd([L('Régina', t, c, { half: demi('Régina', 'Kebab') })]));
    }
    await accepte('F13 moitié-moitié Duo, retrait du kebab (2e moitié) : accepté', any(), cmd([lp('Régina', 'Duo', 1, { half: demi('Régina', 'Kebab'), removed: ['kebab'] })]));
    await refus('F14 le même retrait sans moitié-moitié : ingrédient absent', any(), cmd([REG2({ removed: ['kebab'] })]), V('items[0].removed'));
  }

  titre('G. Retraits : ingrédient absent, listes trop longues, formes invalides');
  {
    const G = (id, titreCas, ligne) => refus(`G${id} ${titreCas}`, any(), cmd([ligne]), V('items[0].removed'));
    await G('01', 'retrait d\'un ingrédient absent (thon sur une Régina)', REG({ removed: ['thon'] }));
    await G('02', 'retrait d\'un ingrédient absent (anchois sur une Régina)', REG({ removed: ['anchois'] }));
    await G('03', 'retrait d\'un ingrédient absent des pâtes (saumon sur des Carbonara)', L('Pâtes Carbonara', '', 850, { removed: ['saumon'] }));
    await G('04', 'retrait de jambon sur une calzone au thon', L('Calzone (soufflée) — Thon', 'Duo', 1600, { removed: ['jambon'] }));
    await G('05', '21 retraits (20 au plus)', REG({ removed: Array(21).fill('jambon') }));
    await G('06', 'retraits en chaîne au lieu de liste', REG({ removed: 'jambon' }));
    await G('07', 'retraits [1]', REG({ removed: [1] }));
    await G('08', 'retraits [null]', REG({ removed: [null] }));
    await G('09', 'retrait de 61 caractères', REG({ removed: ['x'.repeat(61)] }));
    await G('10', 'retraits objet non vide', REG({ removed: { a: 1 } }));
    await accepte('G11 20 retraits (le maximum) du même ingrédient présent : accepté, un seul crédit possible', any(), cmd([REG({ removed: Array(20).fill('jambon') })]));
    await accepte('G12 retraits « JAMBON » et « Champignons » (casse libre) : acceptés', any(), cmd([REG({ removed: ['JAMBON', 'Champignons'] })]));
  }

  titre('H. Faux crédits de supplément gratuit (échange d\'ingrédient)');
  {
    // Régina : Sauce tomate (légumes), fromage (aucun groupe), jambon (viandes), champignons (légumes).
    const H = (id, titreCas, ligne, att) => refus(`H${id} ${titreCas}`, any(), cmd([ligne]), att);
    await accepte('H01 échange honnête : sans jambon, poulet offert (même groupe) -> prix de la pizza seule', any(), cmd([REG({ removed: ['jambon'], extras: [X('poulet', 0)] })]));
    await H('02', '1 retrait mais 2 suppléments gratuits (poulet, thon)', REG({ removed: ['jambon'], extras: [X('poulet', 0), X('thon', 0)] }), M(0, 1250, 1100));
    await H('03', 'même ingrédient retiré 3 fois pour 3 suppléments gratuits', REG({ removed: ['jambon', 'jambon', 'jambon'], extras: [X('poulet', 0), X('thon', 0), X('merguez', 0)] }), M(0, 1400, 1100));
    await H('04', 'même ingrédient retiré sous 3 écritures (jambon, Jambon, JAMBON)', REG({ removed: ['jambon', 'Jambon', 'JAMBON'], extras: [X('poulet', 0), X('thon', 0), X('merguez', 0)] }), M(0, 1400, 1100));
    await H('05', 'crédit d\'un groupe utilisé dans l\'autre (champignons retirés, jambon offert)', REG({ removed: ['champignons'], extras: [X('jambon', 0)] }), M(0, 1250, 1100));
    await H('06', 'retrait d\'un ingrédient sans groupe (fromage) pour obtenir un supplément gratuit', REG({ removed: ['fromage'], extras: [X('poulet', 0)] }), M(0, 1250, 1100));
    await H('07', 'plus de retraits que d\'ingrédients (2 absents de la pizza)', REG({ removed: ['jambon', 'champignons', 'Sauce tomate', 'fromage', 'thon', 'anchois'], extras: [X('poulet', 0)] }), V('items[0].removed'));
    await H('08', '24 retraits répétés (4 ingrédients x 6)', REG({ removed: Array.from({ length: 24 }, (_, i) => ['jambon', 'champignons', 'Sauce tomate', 'fromage'][i % 4]), extras: [X('poulet', 0)] }), V('items[0].removed'));
    await H('09', '20 retraits répétés = 3 crédits seulement (2 légumes, 1 viande) pour 5 suppléments déclarés gratuits',
      REG({ removed: Array.from({ length: 20 }, (_, i) => ['jambon', 'champignons', 'Sauce tomate', 'fromage', 'jambon'][i % 5]), extras: [X('miel', 0), X('olives', 0), X('poivrons', 0), X('poulet', 0), X('thon', 0)] }), M(0, 1350, 1100));
    await accepte('H10 échange maximal honnête : 3 ingrédients retirés (2 légumes + 1 viande), 3 suppléments offerts', any(), cmd([REG({ removed: ['jambon', 'champignons', 'Sauce tomate'], extras: [X('miel', 0), X('olives', 0), X('poulet', 0)] })]));
    await H('11', 'supplément facturé alors qu\'un retrait le rendait gratuit (surfacturation refusée aussi)', REG({ removed: ['jambon'], extras: [X('poulet', 150)], unit_price_cents: 1250 }), M(0, 1100, 1250));
    await accepte('H12 3 pizzas identiques, 1 retrait + 1 supplément : offert sur chaque pizza (règle « une par pizza »)', any(), cmd([REG({ qty: 3, removed: ['jambon'], extras: [X('poulet', 0)] })]));
    await accepte('H13 moitié-moitié Régina / 4 Fromages : retrait du brie (2e moitié), bleu offert', any(), cmd([L('Régina', 'Duo', 1600, { half: { flavor1: 'Régina', flavor2: '4 Fromages' }, removed: ['brie'], extras: [X('bleu', 0)] })]));
    await H('14', 'même moitié-moitié : un seul retrait mais bleu ET parmesan gratuits', L('Régina', 'Duo', 1600, { half: { flavor1: 'Régina', flavor2: '4 Fromages' }, removed: ['brie'], extras: [X('bleu', 0), X('parmesan', 0)] }), M(0, 1800, 1600));
    await H('15', 'retrait du brie (2e moitié) sans déclarer la moitié-moitié : ingrédient absent', L('Régina', 'Duo', 1600, { removed: ['brie'], extras: [X('bleu', 0)] }), V('items[0].removed'));
  }

  titre('I. Total et frais de livraison modifiés');
  {
    const I = (id, titreCas, o, att) => refus(`I${id} ${titreCas}`, any(), cmd([REG()], o), att);
    await I('01', 'total 10,99 € au lieu de 11,00 €', { total: 1099 }, T409(1100, { server_products_cents: 1100, server_promo_cents: 0, server_delivery_fee_cents: 0 }));
    await I('02', 'total 11,01 €', { total: 1101 }, T409(1100));
    await I('03', 'total 0', { total: 0 }, T409(1100));
    await I('04', 'total 1 centime', { total: 1 }, T409(1100));
    await I('05', 'total négatif -1100', { total: -1100 }, V('total_cents'));
    await I('06', 'total -1', { total: -1 }, V('total_cents'));
    await I('07', 'total flottant 1100.5', { total: 1100.5 }, V('total_cents'));
    await I('08', 'total en chaîne "1100"', { total: '1100' }, V('total_cents'));
    await I('09', 'total null', { total: null }, V('total_cents'));
    { const c = cmd([REG()]); delete c.total_cents; await refus('I10 total absent', any(), c, V('total_cents')); }
    await I('11', 'total 10 000 001 (au-delà du plafond)', { total: 10000001 }, V('total_cents'));
    await I('12', 'total 10 000 000 (dans la plage mais faux)', { total: 10000000 }, T409(1100));
    await I('13', 'total true', { total: true }, V('total_cents'));
    await I('14', 'total [1100]', { total: [1100] }, V('total_cents'));
    await I('15', 'à emporter : frais de livraison 1 centime', { frais: 1 }, T409(1100, { server_delivery_fee_cents: 0 }));
    await I('16', 'à emporter : frais de livraison 5,50 € (total cohérent avec ces frais)', { frais: 550, total: 1650 }, T409(1100, { server_delivery_fee_cents: 0 }));
    await I('17', 'frais négatifs -1', { frais: -1 }, V('delivery_fee_cents'));
    await I('18', 'frais flottants 5.5', { frais: 5.5 }, V('delivery_fee_cents'));
    await I('19', 'frais en chaîne "550"', { frais: '550' }, V('delivery_fee_cents'));
    await I('20', 'frais null', { frais: null }, V('delivery_fee_cents'));
    { const c = cmd([REG()]); delete c.delivery_fee_cents; await refus('I21 frais absents', any(), c, V('delivery_fee_cents')); }
    await I('22', 'frais 10 000 001', { frais: 10000001 }, V('delivery_fee_cents'));
    await refus('I23 deux pizzas Solo à emporter, total sans promotion (22,00 €) : refusé, le serveur renvoie 11,00 €', any(), cmd([REG({ qty: 2 })], { total: 2200 }), T409(1100, { server_promo_cents: 1100, server_products_cents: 2200 }));
    await refus('I24 deux pizzas Solo à emporter, total 0 (tout offert)', any(), cmd([REG({ qty: 2 })], { total: 0 }), T409(1100, { server_promo_cents: 1100 }));
    await refus('I25 deux pizzas Solo en livraison avec le total de la promotion à emporter (11,00 € au lieu de 16,50 €)', henin(), cmd([REG({ qty: 2 })], { mode: 'delivery', total: 1100 }), T409(1650, { server_promo_cents: 550, server_delivery_fee_cents: 0 }));
    await refus('I26 deux pizzas Solo à emporter avec le total de la livraison (16,50 € : trop payé) : refusé aussi', any(), cmd([REG({ qty: 2 })], { total: 1650 }), T409(1100));
    const c = cmd([REG()]);
    await refus('I27 JSON brut : total NaN', any(), c, { statut: 400, code: 'bad_request' }, { brut: brutAvec(c, '"total_cents":1100', '"total_cents":NaN') });
    await refus('I28 JSON brut : frais Infinity', any(), c, { statut: 400, code: 'bad_request' }, { brut: brutAvec(c, '"delivery_fee_cents":0', '"delivery_fee_cents":Infinity') });
    await accepte('I29 JSON brut : frais -0 = 0, total 1100.0 = 1100 : mêmes valeurs, acceptés', any(), c, { brut: JSON.stringify(c).replace('"delivery_fee_cents":0', '"delivery_fee_cents":-0').replace('"total_cents":1100', '"total_cents":1100.0') });
  }

  titre('J. Frais de livraison retirés alors qu\'il n\'y a aucune pizza (8 zones)');
  {
    const panier = { 1000: [PAT(), BOI()], 1500: [PAT(), lp('Dessert Calzone Nutella', '')], 2000: [PAT({ qty: 2 }), lp('Dessert Part de Tarte au Daim', '')], 2500: [PAT({ qty: 2 }), lp('Tex-Mex Wings (5 pièces)', ''), lp('Dessert Part de Tarte au Daim', '')] };
    for (const ville of O.VILLES) {
      const z = O.ZONES[ville];
      const lignes = panier[z.min];
      const produits = O.totaux(O.calculerCommande(idx, { mode: 'delivery', items: lignes }, ville).lignes, 'delivery', ville).produits;
      const c = banc.clientDe(ville);
      const base = (o) => cmd(structuredClone(lignes), { mode: 'delivery', ville, ...o });
      await accepte(`J ${ville} : panier sans pizza (${produits / 100} €) + frais ${z.frais / 100} € = ${(produits + z.frais) / 100} € accepté`, c, base({ frais: z.frais, total: produits + z.frais }));
      await refus(`J ${ville} : frais retirés (0 €, total ${produits / 100} €) : refusé, le serveur réclame ${z.frais / 100} €`, c, base({ frais: 0, total: produits }), T409(produits + z.frais, { server_delivery_fee_cents: z.frais, server_products_cents: produits }));
      await refus(`J ${ville} : frais réduits d'un centime`, c, base({ frais: z.frais - 1, total: produits + z.frais - 1 }), T409(produits + z.frais, { server_delivery_fee_cents: z.frais }));
      await refus(`J ${ville} : frais de l'autre tarif (${z.frais === 550 ? 8 : 5.5} €)`, c, base({ frais: z.frais === 550 ? 800 : 550, total: produits + (z.frais === 550 ? 800 : 550) }), T409(produits + z.frais, { server_delivery_fee_cents: z.frais }));
      await refus(`J ${ville} : frais retirés du total mais déclarés à ${z.frais / 100} € (champs contradictoires)`, c, base({ frais: z.frais, total: produits }), T409(produits + z.frais));
    }
    const c = henin();
    await accepte('J+ Hénin-Beaumont : une pizza dans le panier = livraison offerte (frais 0 €)', c, cmd([REG()], { mode: 'delivery' }));
    await refus('J+ Hénin-Beaumont : une pizza dans le panier mais frais de 5,50 € déclarés', c, cmd([REG()], { mode: 'delivery', frais: 550, total: 1650 }), T409(1100, { server_delivery_fee_cents: 0 }));
    await accepte('J+ Hénin-Beaumont : la pizza à composer compte comme une pizza (Duo 13,00 €, frais offerts)', c, cmd([L('Marguerita (base)', 'Duo', 1300)], { mode: 'delivery' }));
    await refus('J+ Hénin-Beaumont : pizza à composer, frais de 8 € déclarés', c, cmd([L('Marguerita (base)', 'Duo', 1300)], { mode: 'delivery', frais: 800, total: 2100 }), T409(1300, { server_delivery_fee_cents: 0 }));
  }

  titre('K. Minimum de commande par zone (calculé après promotion, frais exclus)');
  {
    const PANIERS = [
      ['pâtes', [['Pâtes Bolognaise', '', 1]]],
      ['pâtes + boisson', [['Pâtes Bolognaise', '', 1], ['Boisson Oasis Pomme Poire canette', '', 1]]],
      ['pâtes + calzone Nutella', [['Pâtes Bolognaise', '', 1], ['Dessert Calzone Nutella', '', 1]]],
      ['pâtes + subitowich', [['Pâtes Bolognaise', '', 1], ['Subitowich Milano', '', 1]]],
      ['2 pâtes + tarte', [['Pâtes Bolognaise', '', 2], ['Dessert Part de Tarte au Daim', '', 1]]],
      ['2 pâtes + boisson', [['Pâtes Bolognaise', '', 2], ['Boisson Oasis Pomme Poire canette', '', 1]]],
      ['2 pâtes + Tex-Mex + tarte', [['Pâtes Bolognaise', '', 2], ['Tex-Mex Wings (5 pièces)', '', 1], ['Dessert Part de Tarte au Daim', '', 1]]],
      ['2 pâtes + salade', [['Pâtes Bolognaise', '', 2], ['Salade Niçoise', '', 1]]],
      ['Régina Solo', [['Régina', 'Solo', 1]]],
      ['2 Régina Solo', [['Régina', 'Solo', 2]]],
      ['3 Régina Solo', [['Régina', 'Solo', 3]]],
      ['Régina Quatro', [['Régina', 'Quatro', 1]]],
      ['Régina XXL', [['Régina', 'XXL', 1]]],
      ['2 Régina Quatro', [['Régina', 'Quatro', 2]]],
      ['pizza à composer Solo', [['Marguerita (base)', 'Solo', 1]]],
      ['pâtes + Régina Solo', [['Pâtes Bolognaise', '', 1], ['Régina', 'Solo', 1]]]
    ];
    const exact = { 1000: [['Pâtes Bolognaise', '', 1], ['Boisson Oasis Pomme Poire canette', '', 1]], 1500: [['Pâtes Bolognaise', '', 1], ['Dessert Calzone Nutella', '', 1]], 2000: [['Pâtes Bolognaise', '', 2], ['Dessert Part de Tarte au Daim', '', 1]], 2500: [['Pâtes Bolognaise', '', 2], ['Tex-Mex Wings (5 pièces)', '', 1], ['Dessert Part de Tarte au Daim', '', 1]] };
    const juste_sous = { 1000: [['Subitowich Milano', '', 1], ['Dessert Tiramisubito Oreo', '', 1]], 1500: [['Pâtes Bolognaise', '', 1], ['Subitowich Milano', '', 1]], 2000: [['Pâtes Bolognaise', '', 2], ['Boisson Oasis Pomme Poire canette', '', 1]], 2500: [['Pâtes Bolognaise', '', 2], ['Salade Niçoise', '', 1]] };
    const construire = (defs) => defs.map(([n, v, q]) => lp(n, v, q));
    for (const ville of O.VILLES) {
      const z = O.ZONES[ville];
      const c = () => banc.clientDe(ville);
      const montant = (defs, mode = 'delivery') => O.calculerCommande(idx, { mode, items: construire(defs) }, ville).t;
      const tE = montant(exact[z.min]);
      await accepte(`K ${ville} : exactement le minimum (${tE.apres / 100} € de produits pour ${z.min / 100} €) : accepté`, c(), cmd(construire(exact[z.min]), { mode: 'delivery', ville }), { ville });
      const tS = montant(juste_sous[z.min]);
      await refus(`K ${ville} : ${tS.apres / 100} € de produits (< ${z.min / 100} €) : minimum non atteint, total et frais cohérents`, c(), cmd(construire(juste_sous[z.min]), { mode: 'delivery', ville }),
        { statut: 422, code: 'minimum_not_reached', extra: { minimum_cents: z.min, products_after_promo_cents: tS.apres } });
      // balayage de 16 paniers : le serveur doit suivre l'oracle (accepté ou refusé, avec les bons chiffres)
      const ecarts = [];
      for (const [nom, defs] of PANIERS) {
        const items = construire(defs);
        const t = O.calculerCommande(idx, { mode: 'delivery', items }, ville).t;
        const { rep, delta } = await essayer(c(), cmd(items, { mode: 'delivery', ville }));
        if (t.minimumAtteint) {
          if (rep.status !== 201 || delta !== 1) ecarts.push(`${nom} : attendu accepté (${t.apres} >= ${z.min}), obtenu ${observe(rep)}`);
          else if (rep.json.order.total_cents !== t.total) ecarts.push(`${nom} : total ${rep.json.order.total_cents} au lieu de ${t.total}`);
        } else if (rep.status !== 422 || rep.json.error !== 'minimum_not_reached' || delta !== 0 || rep.json.minimum_cents !== z.min || rep.json.products_after_promo_cents !== t.apres) {
          ecarts.push(`${nom} : attendu minimum_not_reached (${t.apres} < ${z.min}), obtenu ${observe(rep)}`);
        }
      }
      controle(`K ${ville} : 16 paniers (minimum ${z.min / 100} €, après promotion) : le serveur suit le calcul indépendant`, ecarts.length === 0, ecarts.join(' | ') || '16/16 conformes');
    }
    // contournements
    const c = henin();
    await refus('K+ Hénin : 8,50 € de pâtes + 5,50 € de frais = 14,00 € > 10 €, mais les frais ne comptent pas dans le minimum', c, cmd([PAT()], { mode: 'delivery' }), { statut: 422, code: 'minimum_not_reached', extra: { minimum_cents: 1000, products_after_promo_cents: 850 } });
    const rv = banc.clientDe('Rouvroy');
    await refus('K+ Rouvroy : 2 pizzas Solo = 22,00 € bruts (< 25 €) et 16,50 € après promotion', rv, cmd([REG({ qty: 2 })], { mode: 'delivery', ville: 'Rouvroy' }), { statut: 422, code: 'minimum_not_reached', extra: { minimum_cents: 2500, products_after_promo_cents: 1650 } });
    await refus('K+ Rouvroy : minimum non atteint ET total faux : c\'est le minimum qui est refusé en premier (422), pas le total (409)', rv, cmd([REG()], { mode: 'delivery', ville: 'Rouvroy', total: 1 }), { statut: 422, code: 'minimum_not_reached' });
    await refus('K+ Courrières : 2 Solo = 22,00 € bruts (≥ 20 €) mais 16,50 € après promotion : refusé', banc.clientDe('Courrières'), cmd([REG({ qty: 2 })], { mode: 'delivery', ville: 'Courrières' }), { statut: 422, code: 'minimum_not_reached', extra: { minimum_cents: 2000, products_after_promo_cents: 1650 } });
    await accepte('K+ Courrières : 2 Duo en livraison = 32,00 € - 8,00 € = 24,00 € >= 20 € : accepté', banc.clientDe('Courrières'), cmd([L('Régina', 'Duo', 1600, { qty: 2 })], { mode: 'delivery', ville: 'Courrières' }));
    await accepte('K+ à emporter : aucun minimum (une boisson à 1,50 €)', any(), cmd([BOI()]));
  }
  finPhase('4a attaques A-K', phase);

  // -------------------------------------------------------------------------------------- L. promotions
  phase = performance.now();
  titre('L. Promotion empilée : pizzas découpées en lignes, quantités 20, 40 lignes, 60 pizzas (calcul indépendant)');
  {
    const totauxVus = new Map();
    const regs = (n, taille = 'Solo') => {
      const lignes = [];
      for (let reste = n; reste > 0; reste -= 20) lignes.push(lp('Régina', taille, Math.min(20, reste)));
      return lignes;
    };
    for (const n of [1, 2, 3, 4, 5, 6, 7, 10, 20, 21, 39, 40, 59, 60]) {
      for (const mode of ['pickup', 'delivery']) {
        const items = regs(n);
        const rep = await accepte(`L1 ${n} pizzas Solo identiques en ${items.length} ligne(s), ${mode === 'pickup' ? 'à emporter' : 'en livraison'}`, mode === 'pickup' ? any() : henin(), cmd(items, { mode }), { ville: VH });
        if (rep.status === 201) totauxVus.set(`${mode}-${n}`, rep.json.order.total_cents);
      }
    }
    for (const n of [2, 3, 4, 5, 10, 20, 39, 40]) {
      const items = Array.from({ length: n }, () => lp('Régina', 'Solo', 1));
      const rep = await accepte(`L2 ${n} pizzas Solo en ${n} lignes de quantité 1 (à emporter)`, any(), cmd(items, { mode: 'pickup' }));
      controle(`L2 ${n} lignes de 1 = même total que ${n} pizzas en une ligne (aucune promotion de plus à découper)`, rep.status === 201 && rep.json.order.total_cents === totauxVus.get(`pickup-${n}`), `${rep.json && rep.json.order && rep.json.order.total_cents} contre ${totauxVus.get(`pickup-${n}`)}`);
    }
    const paires = [];
    for (let i = 0; i < 4; i++) for (let j = i; j < 4; j++) paires.push([O.TAILLES[i], O.TAILLES[j]]);
    for (const [a, b] of paires) {
      for (const mode of ['pickup', 'delivery']) {
        await accepte(`L3 ${a} + ${b} (Régina / Kebab), ${mode === 'pickup' ? 'à emporter' : 'en livraison'}`, mode === 'pickup' ? any() : henin(), cmd([lp('Régina', a), lp('Kebab', b)], { mode }), { ville: VH });
      }
    }
    await accepte('L4 pizzas + pâtes + boissons : la promotion ne touche que les pizzas', any(), cmd([lp('Régina', 'XXL'), lp('Pâtes Bolognaise', ''), lp('Boisson Oasis Pomme Poire canette', '', 3), lp('Kebab', 'Solo')]));
    await accepte('L4 même panier en livraison (frais offerts, pizzas à -50 %)', henin(), cmd([lp('Régina', 'XXL'), lp('Pâtes Bolognaise', ''), lp('Boisson Oasis Pomme Poire canette', '', 3), lp('Kebab', 'Solo')], { mode: 'delivery' }));
    await accepte('L5 60 pizzas en 3 lignes de 20 (XXL, Quatro, Duo), à emporter', any(), cmd([lp('Régina', 'XXL', 20), lp('Kebab', 'Quatro', 20), lp('Campione', 'Duo', 20)]));
    await accepte('L5 60 pizzas en 3 lignes de 20 (XXL, Quatro, Duo), en livraison', henin(), cmd([lp('Régina', 'XXL', 20), lp('Kebab', 'Quatro', 20), lp('Campione', 'Duo', 20)], { mode: 'delivery' }));
    const quarante = idx.pizzas.filter((p) => !p.choice).slice(0, 29).map((p, i) => lp(p.line_name, O.TAILLES[i % 4]));
    for (const p of idx.pizzas.filter((x) => x.choice).slice(0, 2)) quarante.push(lp(p.line_name + ' — ' + O.capPremiere(p.choice.options[0]), 'Quatro'));
    while (quarante.length < 40) quarante.push(lp('Subito', O.TAILLES[quarante.length % 4], 1, { extras: [{ name: 'miel', price_cents: 0, qty: 1 }] }));
    await accepte('L6 40 lignes de pizzas de tailles et de prix variés, à emporter', any(), cmd(quarante, { mode: 'pickup' }));
    await accepte('L6 mêmes 40 lignes en livraison', henin(), cmd(quarante, { mode: 'delivery' }));
    await accepte('L7 pizza à composer 9,00 € + Régina 11,00 € : la moins chère (9,00 €) est offerte', any(), cmd([lp('Marguerita (base)', 'Solo'), lp('Régina', 'Solo')]));
    await accepte('L8 suppléments qui changent l\'ordre des prix : Régina + 3 suppléments viandes (15,50 €) et Régina (11,00 €)', any(), cmd([lp('Régina', 'Solo', 1, { extras: ['poulet', 'thon', 'merguez'].map((n) => X(n, 0)) }), lp('Régina', 'Solo')]));
    await accepte('L8 mêmes pizzas en livraison', henin(), cmd([lp('Régina', 'Solo', 1, { extras: ['poulet', 'thon', 'merguez'].map((n) => X(n, 0)) }), lp('Régina', 'Solo')], { mode: 'delivery' }));
    // attaques sur la promotion
    const quatre = [lp('Régina', 'Solo', 4)];
    const tq = O.totaux(O.calculerCommande(idx, { mode: 'pickup', items: quatre }, null).lignes, 'pickup', null);
    await refus('L9 4 pizzas Solo à emporter : 3 déclarées offertes (11,00 € au lieu de 22,00 €)', any(), cmd(quatre, { total: 1100 }), T409(tq.total, { server_promo_cents: tq.promo, server_products_cents: tq.produits }));
    await refus('L9 4 pizzas Solo à emporter : promotion déclarée DEUX fois (0 €)', any(), cmd(quatre, { total: 0 }), T409(tq.total));
    await refus('L9 4 pizzas Solo en 4 lignes : chaque ligne « une offerte » -> 0 € ... refusé', any(), cmd(Array.from({ length: 4 }, () => lp('Régina', 'Solo', 1)), { total: 0 }), T409(tq.total));
    await refus('L9 4 pizzas Solo : aucune promotion déclarée (44,00 €, trop payé) : refusé aussi', any(), cmd(quatre, { total: 4400 }), T409(tq.total));
    const tm = O.totaux(O.calculerCommande(idx, { mode: 'pickup', items: [lp('Régina', 'XXL'), lp('Kebab', 'Solo')] }, null).lignes, 'pickup', null);
    await refus('L9 XXL (33 €) + Solo (11 €) : la Solo est offerte (33,00 €) ; total déclaré 11,00 € (l\'XXL offerte) : refusé', any(), cmd([lp('Régina', 'XXL'), lp('Kebab', 'Solo')], { total: 1100 }), T409(tm.total, { server_promo_cents: 1100 }));
    await refus('L9 60 pizzas Solo en 3 lignes : total déclaré = 30 pizzas moins 11,00 € : refusé', any(), cmd(regs(60), { total: 33000 - 1100 }), T409(33000, { server_promo_cents: 33000 }));
    await refus('L9 61 pizzas (3 lignes de 20 + 1) : refusé avant tout calcul (60 articles au plus)', any(), cmd([...regs(60), lp('Régina', 'Solo', 1)], { total: 33000 + 1100 }), V('items'));
    await refus('L9 41 lignes de pizzas : refusé (40 lignes au plus)', any(), cmd(Array.from({ length: 41 }, () => lp('Régina', 'Solo', 1)), { total: 22000 }), V('items'));
  }
  finPhase('4b promotions', phase);

  // -------------------------------------------------------------------------------------- M. quantités
  phase = performance.now();
  titre('M. Quantités limites (0, 21, 60 articles, 61, 40 lignes, 41)');
  {
    for (const [k, q] of [0, 21, -1, 1.5, '2', null, true, 2 ** 31, [], 100].entries()) {
      await refus(`M${String(k + 1).padStart(2, '0')} quantité ${JSON.stringify(q)}`, any(), cmd([REG({ qty: q })]), V('items[0].qty'));
    }
    await accepte('M11 quantité 20 (le maximum par ligne) : 20 boissons', any(), cmd([lp('Boisson Oasis Pomme Poire canette', '', 20)]));
    await accepte('M12 60 articles en 3 lignes de 20 : accepté', any(), cmd([lp('Boisson Oasis Pomme Poire canette', '', 20), lp('Pâtes Bolognaise', '', 20), lp('Salade Niçoise', '', 20)]));
    await refus('M13 61 articles (20 + 20 + 20 + 1)', any(), cmd([BOI({ qty: 20 }), PAT({ qty: 20 }), L('Salade Niçoise', '', 750, { qty: 20 }), BOI()]), V('items'));
    await refus('M14 61 articles en 2 lignes (20 + 20) et 21 : la quantité 21 est refusée', any(), cmd([BOI({ qty: 20 }), PAT({ qty: 20 }), L('Salade Niçoise', '', 750, { qty: 21 })]), V('items[2].qty'));
    await accepte('M15 40 lignes (le maximum), 40 articles', any(), cmd(Array.from({ length: 40 }, (_, i) => lp(idx.produits[i % idx.produits.length].line_name, ''))));
    await refus('M16 41 lignes', any(), cmd(Array.from({ length: 41 }, () => BOI())), V('items'));
    await refus('M17 panier vide', any(), cmd([]), { statut: 422, code: 'empty_cart' });
    await refus('M18 panier absent', any(), (() => { const c = cmd([BOI()]); delete c.items; return c; })(), V('items'));
    await refus('M19 panier null', any(), cmd(null), V('items'));
    await refus('M20 panier en chaîne', any(), cmd('Régina'), V('items'));
    await refus('M21 panier objet non vide', any(), cmd({ 0: BOI() }), V('items'));
    await accepte('M22 quantité écrite 1.0 en JSON (même valeur) : acceptée', any(), cmd([REG()]), { brut: brutAvec(cmd([REG()]), '"qty":1,', '"qty":1.0,') });
    await accepte('M23 60 articles en 40 lignes (20 de quantité 2, 20 de quantité 1)', any(), cmd([...Array.from({ length: 20 }, () => lp('Boisson Oasis Pomme Poire canette', '', 2)), ...Array.from({ length: 20 }, () => lp('Pâtes Bolognaise', '', 1))]));
  }
  finPhase('4c quantités', phase);

  // -------------------------------------------------------------------------------------- N. clé d'envoi
  phase = performance.now();
  titre('N. Clé d\'envoi réutilisée avec des contenus ou des prix différents');
  {
    const c1 = any();
    const base = cmd([REG(), BOI()], { cle: 'cle-n1-' + O.cleEnvoi(rEssais, 'n') });
    const r1 = await accepte('N01 commande valide (Régina Solo + boisson = 12,50 €) : créée', c1, base);
    const id = r1.json.order.id;
    const nBase = banc.nbCommandes();
    const rejeu = await banc.commander(c1, base);
    controle('N02 même clé, même contenu : 200 « rejoué », même commande, rien de plus enregistré', rejeu.status === 200 && rejeu.json.replayed === true && rejeu.json.order.id === id && banc.nbCommandes() === nBase, observe(rejeu));
    const variantes = [
      ['N03 même clé, total 1 centime plus bas', cmd([REG(), BOI()], { cle: base.idempotency_key, total: 1249 })],
      ['N04 même clé, total 0', cmd([REG(), BOI()], { cle: base.idempotency_key, total: 0 })],
      ['N05 même clé, prix d\'une ligne 1 centime plus bas', cmd([REG({ unit_price_cents: 1099 }), BOI()], { cle: base.idempotency_key, total: 1249 })],
      ['N06 même clé, boisson à 1 centime', cmd([REG(), BOI({ unit_price_cents: 1 })], { cle: base.idempotency_key, total: 1101 })],
      ['N07 même clé, une pizza de plus', cmd([REG({ qty: 2 }), BOI()], { cle: base.idempotency_key })],
      ['N08 même clé, un autre contenu valide (une seule boisson)', cmd([BOI()], { cle: base.idempotency_key })],
      ['N09 même clé, remarque différente', cmd([REG({ note: 'autre' }), BOI()], { cle: base.idempotency_key })],
      ['N10 même clé, mode livraison avec moyen de paiement', cmd([REG(), BOI()], { cle: base.idempotency_key, mode: 'delivery' })],
      ['N11 même clé, ordre des lignes inversé', cmd([BOI(), REG()], { cle: base.idempotency_key })]
    ];
    for (const [nom, corps] of variantes) {
      await refus(nom + ' : 409 idempotency_conflict', c1, corps, { statut: 409, code: 'idempotency_conflict' });
    }
    const stocke = ligneBase(id);
    controle('N12 la commande d\'origine est restée intacte (12,50 €, statut new)', Number(stocke.total_cents) === 1250 && stocke.status === 'new' && Number(stocke.products_cents) === 1250, `${stocke.total_cents} ${stocke.status}`);
    // clé non « brûlée » par un refus
    const cleB = 'cle-n13-' + O.cleEnvoi(rEssais, 'n');
    const c2 = any();
    await refus('N13 clé utilisée une première fois avec un prix falsifié : refusé (422)', c2, cmd([REG({ unit_price_cents: 1099 })], { cle: cleB }), M(0, 1100, 1099));
    await accepte('N14 la même clé, avec le bon prix : acceptée (le refus n\'a rien enregistré, la clé n\'est pas brûlée)', c2, cmd([REG()], { cle: cleB }));
    // deux clients, même clé
    const cleC = 'cle-n15-' + O.cleEnvoi(rEssais, 'n');
    const ra = await accepte('N15 client A : clé partagée', any(), cmd([BOI()], { cle: cleC }));
    const rb = await accepte('N15 client B : la même clé chez un autre client est indépendante', any(), cmd([BOI()], { cle: cleC }));
    controle('N15 deux commandes distinctes', ra.json.order.id !== rb.json.order.id, `#${ra.json.order.id} et #${rb.json.order.id}`);

    // concurrence : même clé, contenu identique x8
    banc.renouveler();
    const c3 = any();
    const cleD = 'cle-n16-' + O.cleEnvoi(rEssais, 'n');
    const n0 = banc.nbCommandes();
    const same = cmd([REG(), BOI()], { cle: cleD });
    const rs = await Promise.all(Array.from({ length: 8 }, () => banc.commander(c3, same)));
    const ids = new Set(rs.filter((x) => x.status === 200 || x.status === 201).map((x) => x.json.order.id));
    controle('N16 8 envois simultanés identiques (même clé) : une seule commande créée, tous répondent 200/201 avec le même numéro',
      banc.nbCommandes() === n0 + 1 && ids.size === 1 && rs.every((x) => x.status === 200 || x.status === 201) && rs.filter((x) => x.status === 201).length === 1,
      rs.map((x) => x.status).join(','));
    // concurrence : même clé, 1 envoi correct + 7 envois aux totaux faux
    banc.renouveler();
    const c4 = any();
    const cleE = 'cle-n17-' + O.cleEnvoi(rEssais, 'n');
    const n1 = banc.nbCommandes();
    const faux = [1099, 1101, 0, 1, 2200, 550, 1050].map((t) => cmd([REG()], { cle: cleE, total: t }));
    const rs2 = await Promise.all([cmd([REG()], { cle: cleE }), ...faux].map((b) => banc.commander(c4, b)));
    const bons = rs2.filter((x) => x.status === 201);
    const autres = rs2.filter((x) => x.status !== 201);
    controle('N17 1 envoi correct et 7 aux totaux faux, même clé, simultanés : exactement 1 commande (le bon total), les 7 autres refusés 409',
      banc.nbCommandes() === n1 + 1 && bons.length === 1 && bons[0].json.order.total_cents === 1100 && autres.length === 7 && autres.every((x) => x.status === 409 && ['price_mismatch', 'idempotency_conflict'].includes(x.json.error)),
      rs2.map((x) => `${x.status}${x.json && x.json.error ? ' ' + x.json.error : ''}`).join(', '));
    // concurrence : même clé, deux contenus valides différents
    banc.renouveler();
    const c5 = any();
    const cleF = 'cle-n18-' + O.cleEnvoi(rEssais, 'n');
    const n2 = banc.nbCommandes();
    const rs3 = await Promise.all([cmd([REG()], { cle: cleF }), cmd([REG({ qty: 3 })], { cle: cleF }), cmd([BOI()], { cle: cleF }), cmd([PAT()], { cle: cleF })].map((b) => banc.commander(c5, b)));
    controle('N18 4 contenus valides différents avec la même clé, simultanés : une seule commande, les 3 autres 409 idempotency_conflict',
      banc.nbCommandes() === n2 + 1 && rs3.filter((x) => x.status === 201).length === 1 && rs3.filter((x) => x.status === 409 && x.json.error === 'idempotency_conflict').length === 3,
      rs3.map((x) => `${x.status}${x.json && x.json.error ? ' ' + x.json.error : ''}`).join(', '));
  }
  finPhase('4d clé d\'envoi', phase);

  // -------------------------------------------------------------------------------------- O, P, Q, R
  phase = performance.now();
  titre('O. Modes inconnus ou trafiqués');
  {
    const modes = ['eatin', 'PICKUP', 'Delivery', 'livraison', '', null, 0, true, ['pickup'], {}, 'pickup ', ' pickup', 'pick up', 'à emporter'];
    for (const [k, m] of modes.entries()) await refus(`O${String(k + 1).padStart(2, '0')} mode ${JSON.stringify(m)}`, any(), { ...cmd([REG()]), mode: m }, V('mode'));
    { const c = cmd([REG()]); delete c.mode; await refus('O15 mode absent', any(), c, V('mode')); }
  }

  titre('P. Moyens de paiement en livraison : valides, multiples, invalides, billet');
  {
    const sousEnsembles = [];
    for (let m = 1; m < 16; m++) sousEnsembles.push(O.MOYENS.filter((_, i) => (m >> i) & 1));
    for (const [k, s] of sousEnsembles.entries()) {
      const billet = s.includes('cash') ? O.BILLETS[k % 5] : null;
      await accepte(`P${String(k + 1).padStart(2, '0')} livraison, moyens ${JSON.stringify(s)}${billet !== null ? ' billet ' + billet : ''} : accepté, total inchangé`, henin(), cmd([REG()], { mode: 'delivery', paiements: s, billet }));
    }
    const invalides = [[], ['bitcoin'], ['card', 'paypal'], ['CARD'], 'card', [1], [null], { a: 'card' }, [['card']], ['card '], ['card', 'Cash'], {}, null];
    for (const [k, p] of invalides.entries()) {
      await refus(`P${16 + k} moyens ${JSON.stringify(p)} : refusés`, henin(), cmd([REG()], { mode: 'delivery', paiements: p }), V('payment_methods'));
    }
    { const c = cmd([REG()], { mode: 'delivery' }); delete c.payment_methods; await refus('P29 moyens absents : refusés', henin(), c, V('payment_methods')); }
    for (const [k, b] of [null, 5, 15, 200, -10, 10.5, '20', true, 101, 9, '', [20]].entries()) {
      await refus(`P${30 + k} espèces avec billet ${JSON.stringify(b)} : refusé`, henin(), cmd([REG()], { mode: 'delivery', paiements: ['cash'], billet: b }), V('cash_change_for'));
    }
    { const c = cmd([REG()], { mode: 'delivery', paiements: ['cash', 'card'], billet: 20 }); delete c.cash_change_for; await refus('P42 espèces sans le champ billet : refusé', henin(), c, V('cash_change_for')); }
    const isEgal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const verifMoyens = (attendu, billet) => (rep) => {
      const o = rep.json.order;
      return isEgal(o.payment_methods, attendu) && o.cash_change_for === billet ? [] : [`stocké ${JSON.stringify(o.payment_methods)} billet ${o.cash_change_for}`];
    };
    await accepte('P43 moyens en double ["card","card"] : un seul moyen enregistré', henin(), cmd([REG()], { mode: 'delivery', paiements: ['card', 'card'] }), { verif: verifMoyens(['card'], null) });
    await accepte('P44 billet 50 déclaré sans espèces : ignoré, rien d\'enregistré', henin(), cmd([REG()], { mode: 'delivery', paiements: ['card'], billet: 50 }), { verif: verifMoyens(['card'], null) });
    await sur('P45 à emporter avec des moyens de paiement fantaisistes : refusé, ou accepté sans les enregistrer', any(), cmd([REG()], { paiements: ['bitcoin', 'cash'] }), { siAccepte: (rep) => (isEgal(rep.json.order.payment_methods, []) && rep.json.order.cash_change_for === null ? [] : [`stocké ${JSON.stringify(rep.json.order.payment_methods)}`]) });
    for (const b of [0, 10, 20, 50, 100]) {
      await accepte(`P46 espèces avec billet ${b} : accepté`, henin(), cmd([REG()], { mode: 'delivery', paiements: ['cash'], billet: b }), { verif: verifMoyens(['cash'], b) });
    }
  }

  titre('Q. Champs en trop (affectation de masse) et pollution de prototype : le serveur ne garde que ses propres valeurs');
  {
    const c = any();
    const corpsQ = cmd([REG({ line_total_cents: 1, price: 0, discount_cents: 1000, free: true, unit_price: 1 })], { total: 1100 });
    Object.assign(corpsQ, { promo_cents: 99999, products_cents: 1, status: 'accepted', customer_id: 1, delay_minutes: 20, id: 1, created_at: '2000-01-01T00:00:00Z', accepted_at: '2000-01-01T00:00:00Z', prepared_at: '2000-01-01T00:00:00Z', service_day: '2000-01-01', discount_cents: 1100, coupon: 'GRATUIT' });
    const rep = await accepte('Q01 corps avec champs en trop (status, promo_cents, customer_id, delay_minutes, line_total_cents...) : ignorés', c, corpsQ);
    if (rep.status === 201) {
      const row = ligneBase(rep.json.order.id);
      const li = site.db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(rep.json.order.id)[0];
      controle('Q02 en base : statut new, client de la session, aucun délai, totaux du serveur, total de ligne = prix x quantité',
        row.status === 'new' && Number(row.customer_id) === Number(c.customer.id) && row.delay_minutes === null && row.accepted_at === null && row.prepared_at === null
          && Number(row.promo_cents) === 0 && Number(row.products_cents) === 1100 && Number(row.total_cents) === 1100 && Number(li.line_total_cents) === 1100 && row.created_at !== '2000-01-01T00:00:00Z',
        `${row.status} client ${row.customer_id} promo ${row.promo_cents} produits ${row.products_cents} total ${row.total_cents} ligne ${li.line_total_cents}`);
    }
    const j3 = cmd([REG()]);
    await sur('Q03 clé __proto__ en tête du corps (JSON brut) : ignorée ou refusée', c, j3, { brut: JSON.stringify(j3).replace('{', '{"__proto__":{"unit_price_cents":1,"total_cents":1,"price_cents":0},') });
    const j4 = cmd([REG()]);
    await sur('Q04 clés constructor / prototype dans la ligne (JSON brut)', c, j4, { brut: JSON.stringify(j4).replace('"qty":1', '"qty":1,"constructor":{"prototype":{"price_cents":0}},"__proto__":{"unit_price_cents":1}') });
    await accepte('Q05 après ces tentatives, une commande normale est toujours calculée normalement (aucune pollution)', any(), cmd([REG(), BOI()]));
    const j6 = cmd([REG()]);
    await sur('Q06 remarque avec caractères exotiques (RTL, émoji, zéro-largeur, substitut isolé dans le JSON brut) : jamais de 5xx', c, j6, { brut: JSON.stringify(j6).replace('"note":""', '"note":"\\u202Eabc\\ud800\\u200b🍕"') });
  }

  titre('R. Requêtes hors normes autour du prix (taille, session, méthode, type)');
  {
    const j = cmd([REG()]);
    await refus('R01 corps de plus de 64 Ko (JSON valide)', any(), j, { statut: 413, code: 'payload_too_large' }, { brut: JSON.stringify({ ...j, remplissage: 'x'.repeat(70000) }) });
    await refus('R02 corps JSON tronqué', any(), j, { statut: 400, code: 'bad_request' }, { brut: JSON.stringify(j).slice(0, 80) });
    await refus('R03 corps JSON : tableau au lieu d\'un objet', any(), j, { statut: 400, code: 'bad_request' }, { brut: '[]' });
    await refus('R04 corps vide', any(), j, { statut: 400, code: 'bad_request' }, { brut: '' });
    await refus('R05 imbrication de plus de 32 niveaux', any(), j, { statut: 400, code: 'bad_request' }, { brut: JSON.stringify({ ...j, p: JSON.parse('['.repeat(40) + ']'.repeat(40)) }) });
    const anonyme = new ClientIP('anonyme', ipFictive(9000));
    const n0 = banc.nbCommandes();
    const ra = await banc.commander(anonyme, j);
    controle('R06 sans session client : 401, rien enregistré', ra.status === 401 && ra.json.error === 'unauthorized' && banc.nbCommandes() === n0, observe(ra));
    const rt = await anonyme.request('POST', 'order_create.php', { raw: JSON.stringify(j), headers: { 'Content-Type': 'text/plain' } });
    controle('R07 type de contenu text/plain : 415', rt.status === 415 && banc.nbCommandes() === n0, `${rt.status} ${rt.json && rt.json.error}`);
    const rg = await any().get('order_create.php');
    controle('R08 méthode GET : 405', rg.status === 405 && banc.nbCommandes() === n0, `${rg.status} ${rg.json && rg.json.error}`);
    const patron = await patronConnecte();
    const rp = await patron.post('order_create.php', j);
    controle('R09 une session commerçant ne peut pas passer commande : 403, rien enregistré', rp.status === 403 && rp.json.error === 'forbidden' && banc.nbCommandes() === n0, `${rp.status} ${rp.json && rp.json.error}`);
  }
  finPhase('4e modes, paiements, champs en trop, divers', phase);

  // ======================================================================================== 5. catalogue d'essai : articles sans prix
  phase = performance.now();
  titre('U. Article non commandable en ligne / sans prix (catalogue d\'essai du mode test : unpriced_item)');
  {
    const variante = structuredClone(cat);
    for (const p of variante.products) if (p.category === 'tex-mex') Object.assign(p, { price_cents: null, orderable: false, price_source: null });
    variante.products.find((p) => p.name === 'Régina').prices_by_size.XXL = null;
    variante.products.find((p) => p.name === 'Subito').orderable = false;
    const chemin = path.join(site.ctx.dir, 'catalogue-essai-10.json');
    writeFileSync(chemin, JSON.stringify(variante));
    process.env.SUBITO_CATALOGUE_PATH = chemin;
    try {
      const U = (id, titreCas, ligne, nom) => refus(`U${id} ${titreCas}`, any(), cmd([ligne]), { statut: 422, code: 'unpriced_item', extra: { name: nom ?? ligne.name } });
      for (const [k, n] of ['Tex-Mex Wings (5 pièces)', 'Tex-Mex Tenders (4 pièces)', 'Tex-Mex Nuggets (4 pièces)', 'Tex-Mex Oignon ring (8 pièces)'].entries()) {
        await U(`0${k + 1}`, `« ${n} » sans prix en ligne, déclaré 5,00 €`, L(n, '', 500));
      }
      await U('05', 'Tex-Mex déclaré à 1 centime', L('Tex-Mex Wings (5 pièces)', '', 1));
      await U('06', 'Régina XXL : taille sans prix (33,00 € déclaré)', L('Régina', 'XXL', 3300));
      await U('07', 'Régina XXL à 1 centime', L('Régina', 'XXL', 1));
      await U('08', 'pizza « Subito » non commandable en ligne', L('Subito', 'Solo', 1100));
      await refus('U09 un panier valide avec UN article sans prix : refusé en entier, rien enregistré', any(), cmd([REG(), BOI(), L('Tex-Mex Wings (5 pièces)', '', 500)]), { statut: 422, code: 'unpriced_item', extra: { name: 'Tex-Mex Wings (5 pièces)' } });
      await accepte('U10 le reste du catalogue d\'essai reste commandable (Régina Solo, Duo, boisson)', any(), cmd([REG(), REG2(), BOI()]));
    } finally {
      delete process.env.SUBITO_CATALOGUE_PATH;
    }
    await accepte('U11 catalogue normal rétabli : Tex-Mex et Régina XXL de nouveau acceptés', any(), cmd([L('Tex-Mex Wings (5 pièces)', '', 500), L('Régina', 'XXL', 3300)]));
  }
  finPhase('5 catalogue d\'essai', phase);

  // ======================================================================================== 6. propriété : 300 valides
  phase = performance.now();
  titre('P1. Propriété : 300 commandes aléatoires VALIDES (graine 1010) : toutes acceptées avec le total attendu');
  verifierComptage('P1.0 avant la propriété : tout ce qui est en base a été accepté par le serveur');
  const valides = [];
  {
    const r1 = O.rng(1010);
    const taches = [];
    for (let i = 0; i < 300; i++) {
      const client = banc.suivant();
      const opts = { mode: r1.vrai(0.5) ? 'pickup' : 'delivery', ville: client.ville };
      if (i % 10 === 3) opts.echange = true;
      if (i % 7 === 2) opts.pizzas = r1.entier(4, 9);
      if (i % 40 === 5) opts.nbLignes = r1.entier(25, 36);
      if (i % 9 === 4) opts.supplement = true;
      taches.push({ i, client, g: O.genererCommande(r1, idx, opts) });
    }
    const t1 = performance.now();
    const res = await enParallele(taches, 8, async (t) => ({ t, rep: await banc.commander(t.client, t.g.corps) }));
    info(`300 commandes valides envoyées en ${Math.round(performance.now() - t1)} ms`);
    let ok = 0;
    const couverture = { livraison: 0, aEmporter: 0, moitie: 0, supplements: 0, retraits: 0, echange: 0, calzone: 0, composee: 0, produits: 0, lignes: 0, pizzas: 0 };
    for (const { t, rep } of res) {
      const e = [];
      if (rep.status !== 201) e.push(`statut ${rep.status} au lieu de 201 : ${String(rep.text).slice(0, 200)}`);
      else e.push(...comparerCommande(rep.json.order, t.g.corps, t.g.calcul, t.g.ville));
      const tt = t.g.calcul.t;
      const nom = `V${String(t.i + 1).padStart(3, '0')} ${t.g.mode === 'delivery' ? 'livraison ' + t.g.ville : 'à emporter'}, ${t.g.corps.items.length} ligne(s), ${tt.pizzas} pizza(s)`;
      const bien = controle(nom, e.length === 0, e.length === 0 ? `201 #${rep.json.order.id} total ${rep.json.order.total_cents} = attendu ${tt.total} (promo ${tt.promo}, frais ${tt.frais})` : `${observe(rep)} ✗ ${e.join(' ; ')}`);
      if (!bien) detail(`requête : ${JSON.stringify(t.g.corps)} ; réponse : ${rep.text}`);
      if (bien) ok++;
      valides.push({ ...t, rep });
      couverture[t.g.mode === 'delivery' ? 'livraison' : 'aEmporter']++;
      couverture.lignes += t.g.corps.items.length;
      couverture.pizzas += tt.pizzas;
      for (const l of t.g.corps.items) {
        if (l.half) couverture.moitie++;
        if (l.extras.length) couverture.supplements++;
        if (l.removed.length) couverture.retraits++;
        if (l.name.startsWith('Calzone')) couverture.calzone++;
        if (l.name.startsWith('Marguerita')) couverture.composee++;
        if (l.variant === '') couverture.produits++;
        if (l.removed.length && l.extras.some((x) => x.price_cents === 0)) couverture.echange++;
      }
    }
    controle(`P1 300 commandes valides : ${ok}/300 acceptées avec exactement le total, la promotion, les frais et les lignes de l'oracle`, ok === 300, `${ok}/300`);
    info('couverture des 300 commandes : ' + JSON.stringify(couverture));
    verifierComptage('P1 après les 300 commandes valides : le nombre de commandes en base = le nombre de 201 reçus');
  }
  finPhase('6 propriété valides', phase);

  // ======================================================================================== 7. propriété : 300 altérées
  phase = performance.now();
  titre('P2. Propriété : 300 commandes aléatoires ALTÉRÉES d\'un seul champ (graine 2020) : toutes refusées, avec le bon code');
  {
    const r2 = O.rng(2020);
    const taches = [];
    let replis = 0;
    for (let i = 0; i < 300; i++) {
      let alt = ALTERATIONS[i % ALTERATIONS.length];
      let essai = 0;
      for (;;) {
        const client = banc.suivant();
        const mode = alt.mode ?? (r2.vrai(0.5) ? 'pickup' : 'delivery');
        const base = O.genererCommande(r2, idx, { mode, ville: client.ville, nbLignes: r2.entier(1, 4), qtyMax: 3, cash: alt.cash === true });
        if (alt.preparer) alt.preparer(r2, idx, base);
        const res = alt.appliquer(r2, idx, base);
        if (res === null) { replis++; alt = ALTERATIONS[0]; essai++; if (essai > 3) throw new Error('altération impossible'); continue; }
        taches.push({ i, alt, client, corps: res.corps ?? base.corps, att: res.att, desc: res.desc });
        break;
      }
    }
    if (replis) info(`${replis} altération(s) non applicable(s) remplacée(s) par prix_plus`);
    const t1 = performance.now();
    const res = await enParallele(taches, 8, async (t) => ({ t, rep: await banc.commander(t.client, t.corps) }));
    info(`300 commandes altérées envoyées en ${Math.round(performance.now() - t1)} ms`);
    let ok = 0;
    const parCode = new Map();
    for (const { t, rep } of res) {
      const e = evaluer(rep, t.att);
      const bien = controle(`W${String(t.i + 1).padStart(3, '0')} ${t.alt.id} : ${t.desc}`, e.length === 0, e.length === 0 ? observe(rep) : `${observe(rep)} ✗ ${e.join(' ; ')}`);
      if (!bien) detail(`requête : ${JSON.stringify(t.corps)} ; réponse : ${rep.text}`);
      if (bien) ok++;
      const cle = `${t.att.statut} ${t.att.code}`;
      parCode.set(cle, (parCode.get(cle) ?? 0) + 1);
    }
    controle(`P2 300 commandes altérées : ${ok}/300 refusées avec le statut et le code attendus (${ALTERATIONS.length} types d'altération)`, ok === 300, `${ok}/300`);
    info('codes attendus : ' + [...parCode.entries()].map(([k, n]) => `${n}x ${k}`).join(', '));
    verifierComptage('P2 après les 300 commandes altérées : aucune commande de plus en base');
  }
  finPhase('7 propriété altérées', phase);

  // ======================================================================================== 8. découpage et conflits de clé en masse
  phase = performance.now();
  titre('P3. Découpage et permutation : les mêmes pizzas en lignes différentes donnent le même total (graine 3030)');
  {
    const r3 = O.rng(3030);
    const taches = [];
    for (let i = 0; i < 100; i++) {
      const client = banc.suivant();
      const mode = r3.vrai(0.5) ? 'pickup' : 'delivery';
      const base = O.genererCommande(r3, idx, { mode, ville: client.ville, nbLignes: r3.entier(2, 6), qtyMax: 6, pizzas: 2 });
      const items = [];
      const type = i % 4;
      base.corps.items.forEach((l, li) => {
        const apres = base.corps.items.length - li - 1; // lignes d'origine restant à placer
        let parts = [l.qty];
        if ((type === 1 || type === 3) && l.qty > 1) parts = Array(l.qty).fill(1);
        else if (type === 2 && l.qty > 1) {
          parts = [];
          for (let reste = l.qty; reste > 0;) { const p = r3.entier(1, reste); parts.push(p); reste -= p; }
        }
        if (items.length + parts.length + apres > 40) parts = [l.qty];
        for (const qty of parts) items.push({ ...structuredClone(l), qty });
      });
      const finale = (type === 0 || type === 3) ? r3.melanger(items) : items;
      const corps = { ...structuredClone(base.corps), idempotency_key: O.cleEnvoi(r3, 'dec'), items: finale };
      const calcul = O.calculerCommande(idx, corps, client.ville);
      const attendu = calcul.t.total === base.calcul.t.total && calcul.t.promo === base.calcul.t.promo;
      taches.push({ i, client, base, corps, calcul, type, attendu, mode });
    }
    const res = await enParallele(taches, 8, async (t) => ({ t, rep: await banc.commander(t.client, t.corps) }));
    let ok = 0;
    for (const { t, rep } of res) {
      const e = [];
      if (!t.attendu) e.push('découpage invalide dans le test (total de l\'oracle différent)');
      if (rep.status !== 201) e.push(`statut ${rep.status} : ${String(rep.text).slice(0, 160)}`);
      else e.push(...comparerCommande(rep.json.order, t.corps, t.calcul, t.client.ville));
      const noms = ['lignes mélangées', 'lignes découpées en quantité 1', 'lignes découpées au hasard', 'mélangées et découpées'];
      const bien = controle(`D${String(t.i + 1).padStart(3, '0')} ${noms[t.type]} (${t.corps.items.length} lignes, ${t.base.corps.items.length} d'origine), ${t.mode === 'pickup' ? 'à emporter' : 'livraison'}`, e.length === 0,
        e.length === 0 ? `201 total ${rep.json.order.total_cents} = total de la commande d'origine ${t.base.calcul.t.total}` : `${observe(rep)} ✗ ${e.join(' ; ')}`);
      if (!bien) detail(`requête : ${JSON.stringify(t.corps)}`);
      if (bien) ok++;
    }
    controle(`P3 ${ok}/100 commandes découpées ou mélangées : même total que l'original`, ok === 100, `${ok}/100`);
  }

  titre('P4. Clés d\'envoi des 60 premières commandes valides rejouées : à l\'identique (200) puis avec UN champ modifié (409 idempotency_conflict)');
  {
    const r4 = O.rng(4040);
    const sources = valides.filter((v) => v.rep.status === 201).slice(0, 60);
    const n0 = banc.nbCommandes();
    const taches = [];
    for (const [k, v] of sources.entries()) {
      const copie = structuredClone(v.g.corps);
      let desc;
      if (k % 2 === 0) desc = 'à l\'identique';
      else {
        const kind = r4.entier(0, 5);
        const i = r4.entier(0, copie.items.length - 1);
        const l = copie.items[i];
        const somme = copie.items.reduce((s, x) => s + x.qty, 0);
        const inverse = [...copie.items].reverse();
        if (kind === 1) { l.unit_price_cents += r4.vrai() ? -1 : 1; desc = `prix de la ligne ${i} modifié d'un centime`; }
        else if (kind === 2 && l.qty < 20 && somme < 60) { l.qty += 1; desc = `quantité de la ligne ${i} augmentée de 1`; }
        else if (kind === 2 && l.qty > 1) { l.qty -= 1; desc = `quantité de la ligne ${i} diminuée de 1`; }
        else if (kind === 3) { l.note = l.note.length >= 300 ? 'b' + l.note.slice(1) : l.note + 'x'; desc = `remarque de la ligne ${i} modifiée`; }
        else if (kind === 4) { copie.delivery_fee_cents += 1; desc = 'frais augmentés de 1 centime'; }
        else if (kind === 5 && JSON.stringify(inverse) !== JSON.stringify(copie.items)) { copie.items = inverse; desc = 'ordre des lignes inversé'; }
        else { copie.total_cents = copie.total_cents > 100 ? copie.total_cents - r4.entier(1, 100) : copie.total_cents + 1; desc = 'total modifié'; }
      }
      taches.push({ k, v, corps: copie, desc, identique: k % 2 === 0 });
    }
    const res = await enParallele(taches, 8, async (t) => ({ t, rep: await banc.commander(t.v.client, t.corps) }));
    let ok = 0;
    for (const { t, rep } of res) {
      const e = [];
      if (t.identique) {
        if (rep.status !== 200 || !rep.json || rep.json.replayed !== true || rep.json.order.id !== t.v.rep.json.order.id) e.push(`attendu 200 rejoué #${t.v.rep.json.order.id}`);
      } else if (rep.status !== 409 || rep.json.error !== 'idempotency_conflict') e.push('attendu 409 idempotency_conflict');
      const bien = controle(`I${String(t.k + 1).padStart(2, '0')} commande #${t.v.rep.json.order.id} rejouée ${t.desc}`, e.length === 0, e.length === 0 ? observe(rep) : `${observe(rep)} ✗ ${e.join(' ; ')}`);
      if (!bien) detail(`requête : ${JSON.stringify(t.corps)}`);
      if (bien) ok++;
    }
    controle(`P4 ${ok}/60 rejeux conformes ; aucune commande de plus en base`, ok === 60 && banc.nbCommandes() === n0, `${ok}/60, ${banc.nbCommandes() - n0} commande(s) de plus`);
    verifierComptage('P4 après les rejeux : le nombre de commandes en base = le nombre de 201 reçus');
  }
  finPhase('8 découpage et rejeux', phase);

  // ======================================================================================== 9. audit final
  phase = performance.now();
  titre('Z. Audit final de la base : chaque commande enregistrée est recalculée par l\'oracle');
  {
    const audit = auditerBase(idx, site.db, new Set(banc.acceptes.keys()));
    controle(`Z01 ${audit.commandes} commandes et ${audit.lignes} lignes relues : prix, totaux, promotions, frais, minimum, noms, moyens de paiement conformes à l'oracle`,
      audit.anomalies.length === 0, audit.anomalies.length ? `${audit.anomalies.length} anomalie(s) : ${audit.anomalies.slice(0, 5).join(' | ')}` : 'aucune anomalie');
    if (audit.anomalies.length) for (const a of audit.anomalies.slice(0, 20)) detail('anomalie : ' + a);
    controle('Z02 aucune commande en base qui n\'ait été acceptée par le serveur, aucune acceptée absente de la base', banc.nbCommandes() === banc.acceptes.size, `${banc.nbCommandes()} en base, ${banc.acceptes.size} acceptées`);
    const lignes = banc.nbLignes();
    const attendues = [...banc.acceptes.values()].reduce((s, a) => s + a.corps.items.length, 0);
    controle('Z03 nombre de lignes en base = somme des lignes des commandes acceptées (aucune ligne orpheline ou manquante)', lignes === attendues, `${lignes} en base, ${attendues} attendues`);
    banc.renouveler();
    const patron = await patronConnecte();
    const lp2 = await patron.get('owner_orders.php');
    const vues = lp2.json && lp2.json.orders ? lp2.json.orders : [];
    const sommeBase = Number(site.db.prepare('SELECT COALESCE(SUM(total_cents), 0) AS s FROM orders').get().s);
    controle('Z04 ce que voit le commerçant = ce qui est en base : même nombre de commandes, même somme des totaux, tous les statuts « new »',
      vues.length === banc.acceptes.size && vues.reduce((s, o) => s + o.total_cents, 0) === sommeBase && vues.every((o) => o.status === 'new'), `${vues.length} commandes, somme ${vues.reduce((s, o) => s + o.total_cents, 0)} contre ${sommeBase}`);
    controle('Z05 aucune erreur 5xx : toutes les réponses reçues ont un statut inférieur à 500', ![...banc.stats.parCode.keys()].some((k) => Number(k.split(' ')[0]) >= 500 || k.startsWith('0 ')), [...banc.stats.parCode.entries()].filter(([k]) => Number(k.split(' ')[0]) >= 500 || k.startsWith('0 ')).map(([k, n]) => `${n}x ${k}`).join(', ') || 'aucune');
    controle('Z06 aucune limitation de débit (429) déclenchée par le test lui-même', ![...banc.stats.parCode.keys()].some((k) => k.startsWith('429')), [...banc.stats.parCode.entries()].filter(([k]) => k.startsWith('429')).map(([k, n]) => `${n}x ${k}`).join(', ') || 'aucune');
    const journal = site.journal().trim();
    controle('Z07 journal du serveur vide (aucune erreur interne, aucun refus de débit)', journal === '', journal ? journal.split('\n').slice(0, 3).join(' // ') : '(vide)');
  }
  finPhase('9 audit', phase);

  // ======================================================================================== mesures
  const lat = banc.stats.latences;
  info(`mesures : ${banc.stats.requetes} requêtes HTTP, ${banc.stats.tentatives} envois de commande, ${banc.acceptes.size} commandes enregistrées, ${banc.stats.renouvellements} renouvellements de l'horloge du serveur`);
  info(`latence des requêtes (ms) : p50 ${Math.round(percentile(lat, 50))}, p95 ${Math.round(percentile(lat, 95))}, max ${Math.round(Math.max(...lat))}`);
  info('réponses par code : ' + [...banc.stats.parCode.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n}x ${k}`).join(', '));
  info('durée des phases (s) : ' + phases.map(([n, s]) => `${n} ${s}`).join(' ; '));
  const resume = rapport.resume();
  console.log('RESULTAT ' + JSON.stringify({ ...resume, duree_s: Math.round((Date.now() - t0Global) / 1000), requetes: banc.stats.requetes, commandes: banc.acceptes.size, p50_ms: Math.round(percentile(lat, 50)), p95_ms: Math.round(percentile(lat, 95)) }));
  codeSortie = resume.echoues === 0 ? 0 : 1;
} catch (e) {
  console.log('FAIL erreur du script : ' + ((e && e.stack) || e));
  codeSortie = 1;
} finally {
  site.arreter();
}
process.stdout.write('', () => process.exit(codeSortie));
