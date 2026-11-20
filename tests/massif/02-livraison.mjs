// Batterie 02 — COMMANDES EN LIVRAISON DE TOUS TYPES (API, rafale).
//   node tests/massif/lancer.mjs tests/massif/02-livraison.mjs --timeout=480
// Option de mise au point : --phases=0,1,2 (toutes les parties si absente).
//
// Tout est local : serveur + base Postgres en mémoire (PGlite) dans ce processus, horloge du serveur figée (reproductible).
// Calcul INDÉPENDANT : zones, carte, promotion livraison, frais et minimum sont recalculés ici (lib/02-carte.mjs), jamais avec
// le code du serveur ; les vues client, patron et la base sont comparées à ce calcul.
//
// Parties : 0 barème et comptes · 1 les 8 zones · 2 frais et promotion · 3 moyens de paiement · 4 adresse, téléphone, profil ·
// 5 changement d'adresse entre deux commandes · 6 rafale de 100 clients · 9 limites et concurrence · 7 vues (client, patron, base) ·
// 8 décisions du patron · 10 prix impairs (catalogue d'essai, deuxième serveur) · 11 contrôles transverses.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { demarrerSite, reponses } from './lib/env.mjs';
import { ClientIP, enParallele, ipFictive, corpsInscription } from './lib/clients.mjs';
import { rng } from './lib/commandes.mjs';
import { DELIVERY_ZONES } from '../../serveur/util.js';
import { controle, egal, lot, section, resume, bilan, court } from './lib/02-controle.mjs';
import * as K from './lib/02-carte.mjs';

// ---------------------------------------------------------------------------------------------------------------------
// Réglages et état
const PHASES = (process.argv.slice(2).find((a) => a.startsWith('--phases=')) || '').slice(9).split(',').filter(Boolean);
const actif = (p) => PHASES.length === 0 || PHASES.includes(String(p));
const DELAI_REQUETE = 40000;
const LIMITE_GLOBALE_MS = 450000;

const jourReel = new Date();
// Horloge du serveur figée à 11 h UTC du jour courant (midi à Paris) : ni minuit, ni changement d'heure pendant le script.
const EPOCH0 = Math.floor(Date.UTC(jourReel.getUTCFullYear(), jourReel.getUTCMonth(), jourReel.getUTCDate(), 11, 0, 0) / 1000);
let epochActuel = EPOCH0;

let site = null;
let patron = null;
let carte = null;
let registre = [];
const sites = [];
const ignorees = new Set();
const statuts = new Map();
const latencesCreation = [];
const metriques = {};
const defauts = [];

const garde = setTimeout(() => {
  controle(`délai global de ${LIMITE_GLOBALE_MS / 1000} s`, false, 'le script est arrêté (attentes bornées)');
  resume();
  process.exit(1);
}, LIMITE_GLOBALE_MS);
garde.unref();

// ---------------------------------------------------------------------------------------------------------------------
// Appels
// Erreurs de connexion du CLIENT (jamais du serveur) : sur ce poste Windows, plusieurs batteries tournent en même temps et
// peuvent épuiser les ports éphémères (EADDRINUSE à l'ouverture de la connexion : la requête n'est alors jamais partie).
// Elles sont réessayées (même clé d'envoi : sans risque) et comptées dans les métriques.
const CODES_CONNEXION = new Set(['EADDRINUSE', 'EADDRNOTAVAIL', 'ENOBUFS']);
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

async function appel(client, methode, route, corps) {
  const t0 = performance.now();
  let rep = null;
  for (let essai = 0; rep === null; essai++) {
    let minuteur;
    try {
      const p = methode === 'GET' ? client.get(route) : client.post(route, corps);
      p.catch(() => {});
      const limite = new Promise((_, rej) => { minuteur = setTimeout(() => rej(new Error(`délai de ${DELAI_REQUETE} ms dépassé`)), DELAI_REQUETE); });
      rep = await Promise.race([p, limite]);
    } catch (e) {
      const code = e && e.cause ? e.cause.code : undefined;
      const idempotent = methode === 'GET' || route.startsWith('order_create');
      const reessayer = (CODES_CONNEXION.has(code) && essai < 40) || (idempotent && essai < 3 && (code === 'UND_ERR_SOCKET' || code === 'ECONNRESET'));
      if (reessayer) {
        metriques.reessaisConnexion = (metriques.reessaisConnexion || 0) + 1;
        await pause(Math.min(2000, 100 + essai * 100));
      } else {
        const cause = e && e.cause ? ` [${code ?? ''} ${e.cause.message ?? ''}]` : '';
        rep = { status: 0, json: null, text: String(e && e.message) + cause, headers: new Headers(), setCookies: [], route, method: methode };
      }
    } finally {
      clearTimeout(minuteur);
    }
  }
  rep.ms = performance.now() - t0;
  const cle = `${route.split('?')[0]} ${rep.status}`;
  statuts.set(cle, (statuts.get(cle) || 0) + 1);
  if (route.startsWith('order_create') && rep.status !== 0) latencesCreation.push(rep.ms);
  return rep;
}

/** Inscrit n clients (n° debut… debut+n-1), chacun depuis son adresse fictive ; mêmes comptes que creerClients(), avec réessais. */
async function inscrireClients(n, debut, prefixe, villes) {
  const numeros = Array.from({ length: n }, (_, k) => debut + k);
  return enParallele(numeros, 20, async (num) => {
    const client = new ClientIP('client-' + num, ipFictive(num));
    const ville = villes ? K.VILLES[num % K.VILLES.length] : null;
    const corps = corpsInscription(num, { ville, prefixe });
    const r = await appel(client, 'POST', 'customer_signup.php', corps);
    if (r.status !== 201) throw new Error(`Inscription du client ${num} refusée : ${r.status} ${r.text}`);
    Object.assign(client, { num, email: corps.email, password: corps.password, customer: r.json.customer, ville });
    return client;
  });
}

async function connecterPatron() {
  const p = new ClientIP('patron', '10.250.250.250');
  const r = await appel(p, 'POST', 'owner_login.php', { code: site.codePatron, remember: false });
  if (r.status !== 200) throw new Error('Connexion du patron refusée : ' + r.status + ' ' + r.text);
  return p;
}

const percentile = (tab, p) => {
  if (!tab.length) return 0;
  const t = [...tab].sort((a, b) => a - b);
  return t[Math.min(t.length - 1, Math.floor((p / 100) * t.length))];
};

async function phase(nom, fn) {
  try {
    await fn();
  } catch (e) {
    const cause = e && e.cause ? ` [cause : ${e.cause.code ?? ''} ${e.cause.message ?? e.cause}]` : '';
    controle(`partie « ${nom} » interrompue par une erreur du script de test`, false, (e && e.stack ? e.stack.split('\n').slice(0, 5).join(' / ') : String(e)) + cause);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Clients et commandes
async function nouveauxClients(n, debut, prefixe, { villes = true } = {}) {
  const cs = await inscrireClients(n, debut, prefixe, villes);
  for (const c of cs) {
    c.tentatives = 0;
    c.nb = 0;
    c.adresse = c.ville ? { street: `${c.num} rue des Tests`, city: c.ville, housing_type: 'maison' } : null;
  }
  return cs;
}

const nettoyerRue = (s) => String(s).replace(/\s+/gu, ' ').trim();

/** customer_update_address ; met à jour l'adresse attendue du client si le serveur répond 200. */
async function changerAdresse(client, street, city, housingType = (city === '' || city === null ? null : 'maison')) {
  const rep = await appel(client, 'POST', 'customer_update_address.php', { street, city, housing_type: housingType });
  const rue = typeof street === 'string' ? nettoyerRue(street) : '';
  const att = city === '' || city === null ? null : { street: rue === '' ? null : rue, city: String(city).trim(), housing_type: housingType };
  if (rep.status === 200 && rep.json?.customer) {
    client.customer = rep.json.customer;
    client.adresse = att;
  }
  return { rep, att };
}

/** Le client du lot qui a le moins de tentatives (au plus 19 : la limite serveur est de 20 envois en 10 minutes). */
function choisirClient(pool) {
  const c = [...pool].sort((a, b) => a.tentatives - b.tentatives)[0];
  if (!c || c.tentatives >= 19) throw new Error('Plus de client disponible dans le lot (erreur du test)');
  return c;
}

/**
 * Envoie une commande. Options : specs | lignes, mode, moyens, billet, cle, frais, total (nombres ou fonctions du calcul),
 * modifier(corps), enregistrer (défaut : oui si 201), rejeu (ne compte pas dans le budget de tentatives).
 */
async function commander(client, o = {}) {
  const mode = o.mode ?? 'delivery';
  const ls = o.lignes ?? K.lignes(carte, o.specs);
  const zone = mode === 'delivery' && client.adresse && K.ZONES[client.adresse.city] ? K.ZONES[client.adresse.city] : null;
  const calc = K.calculerLignes(ls, mode, zone);
  const moyens = o.moyens ?? (mode === 'delivery' ? ['card'] : []);
  const billet = o.billet ?? (moyens.includes('cash') ? 20 : null);
  const cle = o.cle ?? K.cleSuivante(o.prefixe ?? 'l02');
  const f = typeof o.frais === 'function' ? o.frais(calc) : o.frais;
  const t = typeof o.total === 'function' ? o.total(calc) : o.total;
  const corps = K.corpsCommande({ cle, mode, moyens, billet, lignes: ls, calc, frais: f, total: t });
  if (o.modifier) o.modifier(corps);
  if (!o.rejeu) client.tentatives = (client.tentatives || 0) + 1;
  if (client.tentatives > 20) throw new Error(`Plus de 20 tentatives pour ${client.name} (erreur du test)`);
  const rep = await appel(client, 'POST', 'order_create.php', corps);
  const att = K.attendu({ client, mode, moyens, billet, lignes: ls, calc, adresse: client.adresse, epoch: epochActuel });
  const res = { client, corps, calc, att, rep, ls, cle, zone, mode, moyens, billet };
  if (rep.status === 201 && rep.json?.order) {
    att.id = rep.json.order.id;
    client.nb = (client.nb || 0) + 1;
    if (o.enregistrer !== false) registre.push(res);
  }
  return res;
}

const resumeCommande = (res) => {
  const o = res.rep.json?.order;
  if (!o) return `${res.rep.status} ${res.rep.json?.error ?? res.rep.text?.slice(0, 80)}`;
  return `#${o.id} ${o.mode === 'delivery' ? o.delivery_address.city : 'emporter'} · ${o.items.length} ligne(s) · produits ${o.products_cents} − promo ${o.promo_cents} + frais ${o.delivery_fee_cents} = ${o.total_cents}`
    + ` · paiement ${o.payment_methods.join('+') || '-'}${o.cash_change_for !== null ? ' billet ' + o.cash_change_for : ''}`;
};

/** Contrôle d'une création réussie : statut, puis toute la vue comparée au calcul indépendant. */
function verifierCreation(nom, res, { statut = 201 } = {}) {
  const { rep, att } = res;
  const ecarts = [];
  if (rep.status !== statut) {
    ecarts.push(`statut ${rep.status} ${rep.json?.error ?? String(rep.text).slice(0, 80)} / attendu ${statut}`);
    if (rep.json?.error === 'price_mismatch') {
      ecarts.push(`serveur : produits ${rep.json.server_products_cents} promo ${rep.json.server_promo_cents} frais ${rep.json.server_delivery_fee_cents} total ${rep.json.server_total_cents}`
        + ` / calcul indépendant : ${res.calc.brut} ${res.calc.remise} ${res.calc.frais} ${res.calc.total}`);
    }
  } else {
    if (rep.json?.replayed !== (statut === 200)) ecarts.push(`replayed=${rep.json?.replayed}`);
    ecarts.push(...K.comparerVue(rep.json?.order, att));
  }
  return controle(nom, ecarts.length === 0, ecarts.length ? ecarts.join(' ; ') : resumeCommande(res));
}

/** Contrôle d'un refus : statut, code et champs complémentaires. */
function verifierRefus(nom, res, { statut, code, champs = {} }) {
  const { rep } = res;
  const obtenu = { statut: rep.status, code: rep.json?.error ?? null };
  const attendu = { statut, code };
  for (const [k, v] of Object.entries(champs)) { obtenu[k] = rep.json?.[k]; attendu[k] = v; }
  return egal(nom, obtenu, attendu);
}

async function nbCommandesServeur(client) {
  const r = await appel(client, 'GET', 'customer_orders.php');
  return r.status === 200 ? r.json.orders.length : -1;
}

/** Cibles de montant : de debut à fin (inclus) par pas de 50 (négatif pour descendre). */
function plage(debut, fin, pas = 50) {
  const t = [];
  if (pas > 0) for (let v = debut; v <= fin; v += pas) t.push(v);
  else for (let v = debut; v >= fin; v += pas) t.push(v);
  return t;
}

/** Cherche un panier de montant exact (après promotion), en essayant les cibles dans l'ordre. */
function chercher(opts, cibles) {
  for (const cible of cibles) {
    const p = K.panierExact(carte, { ...opts, cible });
    if (p) return { ...p, cible };
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------------------
// 0. Barème en dur, carte, comptes
let clientsRafale = [];

async function partie0() {
  section('0. Barème en dur, carte et comptes');
  const catalogueReel = K.lireCatalogueFichier();
  carte = K.carteEnDur(catalogueReel);

  // Zones : trois sources du site comparées à la table en dur.
  const serveurZones = Object.fromEntries(Object.entries(DELIVERY_ZONES).map(([v, z]) => [v, { min: z.minimum_cents, frais: z.fee_cents }]));
  egal('zones : table en dur = DELIVERY_ZONES du serveur (8 villes, minimum et frais)', serveurZones, K.ZONES);
  const cartSrc = fs.readFileSync(path.join(K.RACINE, 'assets', 'js', 'cart.js'), 'utf8');
  const zonesCart = {};
  for (const m of cartSrc.matchAll(/\{\s*city:\s*"([^"]+)",\s*minimum:\s*([\d.]+),\s*fee:\s*([\d.]+)\s*\}/g)) {
    zonesCart[m[1]] = { min: Math.round(Number(m[2]) * 100), frais: Math.round(Number(m[3]) * 100) };
  }
  egal('zones : panier du site (assets/js/cart.js) = table en dur', zonesCart, K.ZONES);
  const accueil = fs.readFileSync(path.join(K.RACINE, 'index.html'), 'utf8');
  const zonesAccueil = {};
  for (const m of accueil.matchAll(/delivery-tier__price">(\d+)\s*€<span>minimum<\/span><\/p>\s*<p class="delivery-tier__cities">([^<]+)<\/p>\s*<p class="delivery-tier__fee">Frais\s*:\s*([\d,]+)\s*€/g)) {
    for (const ville of m[2].split(',').map((s) => s.trim())) zonesAccueil[ville] = { min: Number(m[1]) * 100, frais: Math.round(Number(m[3].replace(',', '.')) * 100) };
  }
  egal('zones : page d\'accueil (index.html, zone de livraison) = table en dur', zonesAccueil, K.ZONES);
  egal('zones : catalogue du serveur (api/data/catalogue.json) = table en dur',
    Object.fromEntries(catalogueReel.zones.map((z) => [z.city, { min: z.minimum_cents, frais: z.fee_cents }])), K.ZONES);

  // Carte : prix du catalogue = prix en dur.
  const ecartsCarte = [];
  let nbArticles = 0;
  for (const p of catalogueReel.products) {
    nbArticles++;
    if (p.kind === 'pizza') {
      const prix = carte.pizzas[p.name]?.prix ?? (p.name === carte.calzone.nom ? carte.calzone.prix : (p.name === carte.composer.nom ? carte.composer.prix : null));
      if (prix === null) ecartsCarte.push(`pizza absente de la carte en dur : ${p.name}`);
      else if (JSON.stringify(prix) !== JSON.stringify(p.prices_by_size)) ecartsCarte.push(`${p.name} : ${JSON.stringify(p.prices_by_size)} / en dur ${JSON.stringify(prix)}`);
    } else if (carte.produits[p.line_name] !== p.price_cents) {
      ecartsCarte.push(`${p.line_name} : ${p.price_cents} / en dur ${carte.produits[p.line_name]}`);
    }
    if (p.orderable !== true) ecartsCarte.push(`${p.line_name ?? p.name} non commandable`);
  }
  catalogueReel.supplement_groups.forEach((g, i) => {
    if (JSON.stringify(g.prices_by_size) !== JSON.stringify(carte.supplements[i].prix)) ecartsCarte.push(`suppléments ${g.title} : prix différents`);
    if (JSON.stringify(g.names) !== JSON.stringify(carte.supplements[i].noms)) ecartsCarte.push(`suppléments ${g.title} : noms différents`);
  });
  lot('carte : prix et suppléments du catalogue = prix en dur (pizzas, produits, 2 groupes de suppléments)', nbArticles + 2, ecartsCarte);
  metriques.articlesCatalogue = nbArticles;

  // Calculateur indépendant : valeurs calculées à la main.
  const lignesTest = (tailles) => tailles.map(([variant, qty]) => ({ variant, qty, unit: { Solo: 1100, Duo: 1600, Quatro: 2300, XXL: 3300 }[variant] }));
  const cas = [
    ['2 Solo', [['Solo', 1], ['Solo', 1]], 2200, 550, 1100],
    ['Duo + Solo', [['Duo', 1], ['Solo', 1]], 2700, 550, 1100],
    ['3 Duo', [['Duo', 3]], 4800, 800, 1600],
    ['XXL Quatro Duo Solo', [['XXL', 1], ['Quatro', 1], ['Duo', 1], ['Solo', 1]], 8300, 1700, 3400],
    ['5 Solo', [['Solo', 5]], 5500, 1100, 2200],
    ['XXL XXL Quatro Quatro Duo', [['XXL', 2], ['Quatro', 2], ['Duo', 1]], 12800, 2800, 5600],
    ['4 Quatro', [['Quatro', 4]], 9200, 2300, 4600],
    ['XXL Duo Solo', [['XXL', 1], ['Duo', 1], ['Solo', 1]], 6000, 800, 1600]
  ];
  const obtenu = cas.map(([nom, t]) => [K.calculer(lignesTest(t), 'delivery', K.ZONES['Rouvroy']).remise, K.calculer(lignesTest(t), 'pickup', null).remise]);
  egal('calculateur du test = promotions calculées à la main (8 paniers de 2 à 5 pizzas : livraison, emporter)', obtenu, cas.map((c) => [c[3], c[4]]));
  egal('calculateur du test : arrondi par paire (prix impairs 1001 + 999 ; 1999, 1999, 1001, 1001)',
    [K.calculer([{ variant: 'Duo', qty: 1, unit: 1001 }, { variant: 'Solo', qty: 1, unit: 999 }], 'delivery', null).remise,
      K.calculer([{ variant: 'Duo', qty: 1, unit: 1999 }, { variant: 'Solo', qty: 1, unit: 1001 }, { variant: 'Duo', qty: 1, unit: 1999 }, { variant: 'Solo', qty: 1, unit: 1001 }], 'delivery', null).remise],
    [500, 1501]);

  const t0 = Date.now();
  clientsRafale = await nouveauxClients(100, 1, 'massif');
  metriques.msCreation100Comptes = Date.now() - t0;
  const ecartsAdr = [];
  for (const c of clientsRafale) {
    if (c.customer.street !== `${c.num} rue des Tests` || c.customer.city !== c.ville || !c.customer.phone) {
      ecartsAdr.push(`client ${c.num} : ${JSON.stringify(c.customer)}`);
    }
  }
  lot('100 comptes créés (201) : adresse et téléphone enregistrés tels qu\'envoyés', 100, ecartsAdr);
  const parVille = {};
  for (const c of clientsRafale) parVille[c.ville] = (parVille[c.ville] || 0) + 1;
  egal('les 100 clients sont répartis sur les 8 zones (12 ou 13 par ville)', Object.values(parVille).every((n) => n === 12 || n === 13) && Object.keys(parVille).length === 8, true);

  patron = await connecterPatron();
  const l0 = await appel(patron, 'GET', 'owner_orders.php');
  egal('patron connecté : aucune commande au départ', [l0.status, l0.json?.orders?.length], [200, 0]);
}

// ---------------------------------------------------------------------------------------------------------------------
// 1. Les 8 zones
async function partie1() {
  section('1. Les 8 zones : sous le minimum, au minimum, au-dessus ; frais ; écarts de prix');
  const pool = await nouveauxClients(16, 201, 'zone');
  const rZ = rng(1001);
  for (const ville of K.VILLES) {
    const Z = K.ZONES[ville];
    const [a, b] = pool.filter((c) => c.ville === ville);
    const sansPizza = { mode: 'delivery', zone: Z, rng: rZ, maxPizzas: 0, maxProduits: 6 };
    const avecPizza = { mode: 'delivery', zone: Z, rng: rZ, minPizzas: 1, maxPizzas: 4, maxProduits: 3 };
    const etiq = `${ville} (minimum ${Z.min}, frais ${Z.frais})`;

    // A. Commandes sans pizza : frais de livraison dus.
    const sous = chercher(sansPizza, [Z.min - 50]);
    const a1 = await commander(a, { specs: sous.specs, enregistrer: false });
    egal(`${etiq} · sans pizza à ${sous.cible} (sous le minimum) : 422 minimum_not_reached avec les montants du serveur`,
      { statut: a1.rep.status, code: a1.rep.json?.error, minimum_cents: a1.rep.json?.minimum_cents, apres_promo: a1.rep.json?.products_after_promo_cents },
      { statut: 422, code: 'minimum_not_reached', minimum_cents: Z.min, apres_promo: sous.cible });
    const exact = chercher(sansPizza, [Z.min]);
    const a2 = await commander(a, { specs: exact.specs, moyens: ['card'] });
    verifierCreation(`${etiq} · sans pizza, exactement au minimum (${Z.min}) : acceptée, frais ${Z.frais}`, a2);
    const dessus = chercher(sansPizza, [Z.min + 350, Z.min + 150]);
    const a3 = await commander(a, { specs: dessus.specs, moyens: ['cash', 'ticket'], billet: 50 });
    verifierCreation(`${etiq} · sans pizza, au-dessus du minimum (${dessus.cible}) : acceptée, frais ${Z.frais}`, a3);
    const ex2 = chercher(sansPizza, [Z.min + 100]);
    const a4 = await commander(a, { specs: ex2.specs, frais: 0, total: (c) => c.apres, enregistrer: false });
    egal(`${etiq} · frais oubliés par le client : 409 price_mismatch, montants du serveur = calcul indépendant`,
      { statut: a4.rep.status, code: a4.rep.json?.error, produits: a4.rep.json?.server_products_cents, promo: a4.rep.json?.server_promo_cents, frais: a4.rep.json?.server_delivery_fee_cents, total: a4.rep.json?.server_total_cents },
      { statut: 409, code: 'price_mismatch', produits: a4.calc.brut, promo: 0, frais: Z.frais, total: a4.calc.apres + Z.frais });
    const a5 = await commander(a, { specs: ex2.specs, total: (c) => c.total + 1, enregistrer: false });
    egal(`${etiq} · frais justes mais total faux d'un centime : 409 price_mismatch`,
      { statut: a5.rep.status, code: a5.rep.json?.error, total: a5.rep.json?.server_total_cents }, { statut: 409, code: 'price_mismatch', total: a5.calc.total });
    egal(`${etiq} · aucun refus n'a créé de commande (2 commandes chez le serveur)`, await nbCommandesServeur(a), 2);

    // B. Commandes avec pizza : pas de frais, promotion livraison, minimum après promotion.
    const sousP = chercher(avecPizza, [Z.min - 50, Z.min - 100, Z.min - 150, Z.min - 200, Z.min - 250]);
    const b1 = await commander(b, { specs: sousP.specs, enregistrer: false });
    egal(`${etiq} · avec pizza, ${sousP.cible} après promotion (sous le minimum) : 422 minimum_not_reached, montant du serveur`,
      { statut: b1.rep.status, code: b1.rep.json?.error, minimum_cents: b1.rep.json?.minimum_cents, apres_promo: b1.rep.json?.products_after_promo_cents },
      { statut: 422, code: 'minimum_not_reached', minimum_cents: Z.min, apres_promo: b1.calc.apres });
    const promoMin = chercher({ ...avecPizza, minPizzas: 2 }, plage(Z.min + 50, Z.min + 1500));
    const b2 = await commander(b, { specs: chercher(avecPizza, plage(Z.min, Z.min + 300)).specs, moyens: ['ticket_card'] });
    verifierCreation(`${etiq} · avec pizza, au minimum (ou juste au-dessus, ${b2.calc.apres}) : acceptée, aucun frais`, b2);
    const b3 = await commander(b, { specs: promoMin.specs, moyens: ['card', 'cash'], billet: 0 });
    verifierCreation(`${etiq} · 2 pizzas ou plus (${promoMin.cible} après promotion ${b3.calc.remise}) : acceptée, promotion livraison, aucun frais`, b3);
    const b4 = await commander(b, { specs: promoMin.specs, frais: Z.frais, total: (c) => c.apres + Z.frais, enregistrer: false });
    egal(`${etiq} · frais ajoutés par le client malgré la pizza : 409 price_mismatch, frais du serveur 0`,
      { statut: b4.rep.status, code: b4.rep.json?.error, frais: b4.rep.json?.server_delivery_fee_cents, promo: b4.rep.json?.server_promo_cents, total: b4.rep.json?.server_total_cents },
      { statut: 409, code: 'price_mismatch', frais: 0, promo: b4.calc.remise, total: b4.calc.apres });
    const brutPlusGrand = (() => {
      for (const cible of plage(Z.min - 50, 600, -50)) {
        for (let k = 0; k < 6; k++) {
          const p = K.panierExact(carte, { ...avecPizza, minPizzas: 2, cible, rng: rZ });
          if (!p) break;
          const c = K.calculerLignes(K.lignes(carte, p.specs), 'delivery', Z);
          if (c.brut >= Z.min && c.apres < Z.min) return p;
        }
      }
      return null;
    })();
    if (brutPlusGrand) {
      const b5 = await commander(b, { specs: brutPlusGrand.specs, enregistrer: false });
      egal(`${etiq} · total brut ${b5.calc.brut} ≥ minimum mais ${b5.calc.apres} après promotion : 422 (le minimum se calcule après promotion)`,
        { statut: b5.rep.status, code: b5.rep.json?.error, apres_promo: b5.rep.json?.products_after_promo_cents }, { statut: 422, code: 'minimum_not_reached', apres_promo: b5.calc.apres });
    } else {
      console.log(`  >> ${ville} : aucun panier de la carte n'a un total brut au-dessus du minimum et un total après promotion en dessous (cas sans objet)`);
    }
    // C. À emporter : ni minimum ni frais dans la même zone.
    const e1 = await commander(b, { mode: 'pickup', specs: [{ type: 'produit', nom: 'Boisson Oasis Pomme Poire canette' }] });
    verifierCreation(`${etiq} · à emporter, 1 boisson (150) : acceptée sans minimum ni frais`, e1);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// 2. Frais et promotion : 2, 3, 4, 5 pizzas ; types de lignes
async function partie2() {
  section('2. Frais seulement sans pizza ; promotion livraison avec 2, 3, 4, 5 pizzas ; types de lignes');
  const [h1] = await nouveauxClients(1, 400, 'henin');
  const [h2] = await nouveauxClients(1, 408, 'henin');
  const p2 = await nouveauxClients(8, 301, 'promo');
  const rP = rng(2002);
  const noms = Object.keys(carte.pizzas);
  const nomUnique = (() => { let i = 0; return () => noms[(i++ * 7 + 3) % noms.length]; })();

  const CAS = [
    ['2 Solo', [['Solo', 1], ['Solo', 1]], 2200, 550, 1100],
    ['Duo + Solo', [['Duo', 1], ['Solo', 1]], 2700, 550, 1100],
    ['3 Duo (une ligne)', [['Duo', 3]], 4800, 800, 1600],
    ['XXL + Quatro + Duo + Solo', [['XXL', 1], ['Quatro', 1], ['Duo', 1], ['Solo', 1]], 8300, 1700, 3400],
    ['5 Solo (une ligne)', [['Solo', 5]], 5500, 1100, 2200],
    ['2 XXL + 2 Quatro + Duo', [['XXL', 2], ['Quatro', 2], ['Duo', 1]], 12800, 2800, 5600],
    ['4 Quatro (une ligne)', [['Quatro', 4]], 9200, 2300, 4600],
    ['XXL + Duo + Solo', [['XXL', 1], ['Duo', 1], ['Solo', 1]], 6000, 800, 1600]
  ];
  for (const [nom, tailles, brut, remLiv, remEmp] of CAS) {
    const specs = tailles.map(([taille, qty]) => ({ type: 'pizza', nom: nomUnique(), taille, qty }));
    const liv = await commander(h1, { specs, moyens: ['card'] });
    verifierCreation(`livraison, ${nom} : brut ${brut}, promotion ${remLiv}, aucun frais, total ${brut - remLiv}`, liv);
    egal(`livraison, ${nom} : promotion et total du serveur = valeurs calculées à la main`,
      [liv.rep.json?.order?.products_cents, liv.rep.json?.order?.promo_cents, liv.rep.json?.order?.delivery_fee_cents, liv.rep.json?.order?.total_cents], [brut, remLiv, 0, brut - remLiv]);
    const emp = await commander(h1, { mode: 'pickup', specs });
    egal(`à emporter, ${nom} : la moins chère de chaque paire offerte (promotion ${remEmp})`,
      [emp.rep.status, emp.rep.json?.order?.promo_cents, emp.rep.json?.order?.total_cents, emp.rep.json?.order?.delivery_fee_cents], [201, remEmp, brut - remEmp, 0]);
  }

  // Les frais ne dépendent que de la présence d'une pizza : même panier avec et sans pizza, dans chacune des 8 zones.
  for (const ville of K.VILLES) {
    const Z = K.ZONES[ville];
    const c = p2.find((x) => x.ville === ville);
    const base = chercher({ mode: 'delivery', zone: Z, rng: rP, maxPizzas: 0, maxProduits: 6 }, [Z.min + 50]);
    const s1 = await commander(c, { specs: base.specs });
    verifierCreation(`${ville} · panier sans pizza de ${base.cible} : frais ${Z.frais}`, s1);
    const s2 = await commander(c, { specs: [...base.specs, { type: 'pizza', nom: nomUnique(), taille: 'Solo' }] });
    verifierCreation(`${ville} · le même panier + 1 pizza Solo : frais 0 (total ${s2.calc.total})`, s2);
  }

  // Types de lignes en livraison (zone Hénin-Beaumont, minimum 1000).
  const types = [
    ['pizza à composer (base au choix) Duo', [{ type: 'composer', taille: 'Duo', base: 'crème fraîche' }]],
    ['pizza à composer sans base, Solo + boisson', [{ type: 'composer', taille: 'Solo' }, { type: 'produit', nom: 'Boisson Coca-Cola Original Taste grande bouteille' }]],
    ['calzone avec garniture (kebab) Solo', [{ type: 'calzone', taille: 'Solo', garniture: 'kebab' }]],
    ['moitié-moitié Duo (Régina / Kebab)', [{ type: 'pizza', nom: 'Régina', taille: 'Duo', moitie: 'Kebab' }]],
    ['moitié-moitié XXL (Subito / Campione) et Solo', [{ type: 'pizza', nom: 'Subito', taille: 'XXL', moitie: 'Campione' }, { type: 'pizza', nom: 'Neptune', taille: 'Solo' }]],
    ['3 suppléments sur une Quatro', [{ type: 'pizza', nom: 'Kebab', taille: 'Quatro', extras: ['jambon', 'Champignons', 'olives'] }]],
    ['retrait + supplément gratuit du même groupe (Duo)', [{ type: 'pizza', nom: 'Végétarienne', taille: 'Duo', retraits: ['oignons'], extras: ['olives', 'thon'] }]],
    ['3 XXL (une ligne) avec remarque', [{ type: 'pizza', nom: 'Subito', taille: 'XXL', qty: 3, note: "Merci ! L'étage 3 😀\nSonner 2 fois" }]],
    ['pâtes, salades, desserts, boissons (sans pizza) en quantités', [{ type: 'produit', nom: 'Pâtes Saumon', qty: 2 }, { type: 'produit', nom: 'Salade Niçoise', qty: 3 }, { type: 'produit', nom: 'Dessert Calzone Nutella', qty: 2 }, { type: 'produit', nom: 'Boisson Oasis Pomme Poire canette', qty: 5 }]]
  ];
  for (const [nom, specs] of types) {
    const r = await commander(choisirClient([h2]), { specs, moyens: ['cash', 'card'], billet: 100 });
    verifierCreation(`type de ligne : ${nom}`, r);
  }
  // 40 lignes (maximum) et 60 unités (maximum).
  const specs40 = [];
  for (let i = 0; i < 20; i++) specs40.push({ type: 'pizza', nom: nomUnique(), taille: K.TAILLES[i % 4] });
  for (let i = 0; i < 20; i++) specs40.push({ type: 'produit', nom: Object.keys(carte.produits)[i % 26] });
  const r40 = await commander(choisirClient([h2]), { specs: specs40, moyens: ['ticket'] });
  verifierCreation('panier de 40 lignes (maximum) : 20 pizzas (10 paires) + 20 produits', r40);
  const specs60 = [{ type: 'pizza', nom: nomUnique(), taille: 'Solo', qty: 20 }, { type: 'pizza', nom: nomUnique(), taille: 'Duo', qty: 20 }, { type: 'pizza', nom: nomUnique(), taille: 'Quatro', qty: 20 }];
  const r60 = await commander(choisirClient([h2]), { specs: specs60, moyens: ['ticket_card'] });
  verifierCreation('panier de 60 unités (maximum) : 60 pizzas, 30 paires', r60);
  egal('panier de 60 pizzas : promotion livraison = 30 paires (calcul à la main : 10×550 + 10×800 + 10×1150 = 25 000)',
    [r60.rep.json?.order?.promo_cents, r60.rep.json?.order?.total_cents], [25000, 20 * 1100 + 20 * 1600 + 20 * 2300 - 25000]);
}

// ---------------------------------------------------------------------------------------------------------------------
// 3. Moyens de paiement
async function partie3() {
  section('3. Moyens de paiement en livraison');
  const pay = await nouveauxClients(4, 321, 'pay');
  const rP = rng(3003);
  const panier = (c) => K.specsAleatoires(carte, rP, rP.choix(['produits', 'pizzas', 'mixte']), K.ZONES[c.adresse.city]);

  // Chaque moyen seul, puis toutes les combinaisons de 2, 3 et 4 moyens ; espèces avec chaque billet.
  const cas = [];
  for (const k of [1, 2, 3, 4]) for (const comb of K.combinaisons(K.MOYENS, k)) cas.push(comb);
  let nb = 0;
  for (const moyens of cas) {
    for (const billet of moyens.includes('cash') ? K.BILLETS : [null]) {
      const c = choisirClient(pay);
      const r = await commander(c, { specs: panier(c), moyens, billet });
      verifierCreation(`paiement ${moyens.join(' + ')}${billet !== null ? ' · billet ' + billet : ''}`, r);
      nb++;
    }
  }
  egal('toutes les combinaisons de moyens et de billets ont été essayées (47 commandes)', nb, 47);
  const ordre = [
    [['ticket_card', 'cash', 'card'], 50, 'ordre quelconque ticket_card + cash + card'],
    [['ticket', 'card'], null, 'ordre inversé ticket + card'],
    [['card', 'card', 'cash'], 10, 'doublon card + card + cash : dédoublonné'],
    [['ticket_card', 'ticket', 'cash', 'card'], 100, 'les 4 moyens dans l\'ordre inverse']
  ];
  for (const [moyens, billet, nom] of ordre) {
    const c = choisirClient(pay);
    const r = await commander(c, { specs: panier(c), moyens, billet });
    verifierCreation(`paiement ${nom} : moyens conservés dans l'ordre envoyé`, r);
  }

  // Billet sans espèces : refusé en 422 ou ignoré (null), jamais enregistré.
  for (const moyens of [['card'], ['ticket'], ['ticket_card'], ['card', 'ticket']]) {
    const c = choisirClient(pay);
    const r = await commander(c, { specs: panier(c), moyens, modifier: (b) => { b.cash_change_for = 20; }, enregistrer: true });
    const ok = r.rep.status === 422 || (r.rep.status === 201 && r.rep.json.order.cash_change_for === null && K.comparerVue(r.rep.json.order, r.att).length === 0);
    controle(`billet 20 sans espèces (${moyens.join(' + ')}) : refusé en 422 ou ignoré, jamais enregistré`, ok, `${r.rep.status} ${r.rep.json?.error ?? ''} cash_change_for=${r.rep.json?.order?.cash_change_for}`);
    if (r.rep.status === 422) { c.tentatives--; registre = registre.filter((x) => x !== r); }
  }

  // À emporter : moyens de paiement et billet ignorés.
  {
    const c = choisirClient(pay);
    const r = await commander(c, { mode: 'pickup', specs: [{ type: 'produit', nom: 'Pâtes Carbonara' }], modifier: (b) => { b.payment_methods = ['cash', 'card']; b.cash_change_for = 20; } });
    verifierCreation('à emporter avec moyens de paiement et billet envoyés : stockés vides (payment_methods [], billet null)', r);
  }

  // Refus de validation (aucune commande créée).
  const c = pay[0];
  const avant = await nbCommandesServeur(c);
  const specsRef = panier(c);
  const essayer = async (modif) => {
    const res = await commander(c, { specs: specsRef, moyens: ['card'], modifier: modif, enregistrer: false, rejeu: true, cle: K.cleSuivante('refus') });
    return res.rep;
  };
  const billets = [5, 15, 25, 30, 40, 60, 75, 101, 150, 200, 500, 1000, -10, -1, 1, 9, 11, 19, 21, 49, 51, 99, 0.5, 10.5, 20.01, '20', '0', '', 'cash', true, false, [], {}, [20], null, undefined];
  const ecB = [];
  for (const v of billets) {
    const r = await essayer((b) => { b.payment_methods = ['cash']; if (v === undefined) delete b.cash_change_for; else b.cash_change_for = v; });
    if (!(r.status === 422 && r.json?.error === 'validation' && r.json?.fields && 'cash_change_for' in r.json.fields)) ecB.push(`billet ${court(v)} : ${r.status} ${r.json?.error}`);
  }
  lot('espèces avec une valeur de billet hors 0/10/20/50/100 (36 valeurs, types faux compris) : 422 validation sur cash_change_for', billets.length, ecB);
  const aucun = [[], undefined, null, 'card', {}, [''], [null], [[]], [1], { card: true }, 'cash', ['card'].toString()];
  const ecA = [];
  for (const v of aucun) {
    const r = await essayer((b) => { if (v === undefined) delete b.payment_methods; else b.payment_methods = v; });
    if (!(r.status === 422 && r.json?.error === 'validation' && r.json?.fields && 'payment_methods' in r.json.fields)) ecA.push(`payment_methods ${court(v)} : ${r.status} ${r.json?.error}`);
  }
  lot('aucun moyen de paiement valide ([], absent, null, texte, objet…) : 422 validation sur payment_methods', aucun.length, ecA);
  const inconnus = [['bitcoin'], ['card', 'bitcoin'], ['CARD'], [' card'], ['card '], ['cash', 'paypal'], ['ticket restaurant'], ['ticket-card'], [true], [{}], ['__proto__'], ['constructor'], ['toString'], ['card', 1], ['Cash']];
  const ecI = [];
  for (const v of inconnus) {
    const r = await essayer((b) => { b.payment_methods = v; b.cash_change_for = v.includes('cash') ? 20 : null; });
    if (!(r.status === 422 && r.json?.error === 'validation' && r.json?.fields && 'payment_methods' in r.json.fields)) ecI.push(`payment_methods ${court(v)} : ${r.status} ${r.json?.error}`);
  }
  lot('moyen de paiement inconnu : 422 validation sur payment_methods', inconnus.length, ecI);
  egal('aucun de ces refus n\'a créé de commande', await nbCommandesServeur(c), avant);
}

// ---------------------------------------------------------------------------------------------------------------------
// 4. Adresse, téléphone, profil
async function partie4() {
  section('4. Adresse obligatoire, ville hors zone, téléphone obligatoire, profil incomplet');
  const adr = await nouveauxClients(8, 401, 'adr', { villes: false });
  const rA = rng(4004);
  const specsPizza = [{ type: 'pizza', nom: 'Régina', taille: 'Duo' }, { type: 'pizza', nom: 'Kebab', taille: 'Duo' }];

  // Client sans adresse.
  const c1 = adr[0];
  const t1 = await commander(c1, { specs: specsPizza, enregistrer: false });
  verifierRefus('client sans adresse, commande en livraison : 422 address_required', t1, { statut: 422, code: 'address_required' });
  const t2 = await commander(c1, { mode: 'pickup', specs: specsPizza });
  verifierCreation('le même client sans adresse, à emporter : acceptée (delivery_address null, paiement [])', t2);
  const t3 = await changerAdresse(c1, '', 'Rouvroy');
  egal('adresse avec ville mais sans rue : enregistrée (rue null)', [t3.rep.status, t3.rep.json?.customer?.street, t3.rep.json?.customer?.city], [200, null, 'Rouvroy']);
  const t4 = await commander(c1, { specs: specsPizza, enregistrer: false });
  verifierRefus('ville mais pas de rue, livraison : 422 address_required', t4, { statut: 422, code: 'address_required' });
  const t5 = await changerAdresse(c1, '  12   rue   des   Écoles  ', 'Rouvroy');
  egal('rue avec espaces multiples : enregistrée nettoyée', [t5.rep.status, t5.rep.json?.customer?.street], [200, '12 rue des Écoles']);
  const t6 = await commander(c1, { specs: [...specsPizza, { type: 'produit', nom: 'Boisson Oasis Pomme Poire canette' }], moyens: ['ticket'] });
  verifierCreation('rue normalisée + ville Rouvroy : livraison acceptée, adresse de la commande = rue nettoyée', t6);
  const t7 = await changerAdresse(c1, '', '');
  egal('adresse effacée (ville vide) : rue et ville null', [t7.rep.status, t7.rep.json?.customer?.street, t7.rep.json?.customer?.city], [200, null, null]);
  const t8 = await commander(c1, { specs: specsPizza, enregistrer: false });
  verifierRefus('adresse effacée, livraison : 422 address_required', t8, { statut: 422, code: 'address_required' });
  const t9 = await appel(c1, 'GET', `order_status.php?id=${t6.rep.json.order.id}`);
  egal('la commande déjà passée garde son adresse après effacement du compte (order_status)',
    [t9.status, t9.json?.order?.delivery_address], [200, { street: '12 rue des Écoles', city: 'Rouvroy' }]);
  const t10 = await commander(c1, { mode: 'pickup', specs: [{ type: 'produit', nom: 'Salade Niçoise' }] });
  verifierCreation('adresse effacée, à emporter : acceptée', t10);

  // Ville hors zone refusée à la modification d'adresse (l'adresse ne change pas).
  const c2 = adr[1];
  await changerAdresse(c2, '5 rue de la Paix', 'Dourges');
  const horsZone = ['Lens', 'Liévin', 'Paris', 'Hénin Beaumont', 'henin-beaumont', 'HÉNIN-BEAUMONT', 'Courrieres', 'Fouquieres-les-Lens', 'Rouvroy2', 'Rouvroy, France',
    'Montigny', 'Billy Montigny', '__proto__', 'constructor', 'toString', 'hasOwnProperty', 'He\u0301nin-Beaumont', 'Billy\u2011Montigny', 'Noyelles-Godault\u200b', '0', 'null', 'undefined'];
  const ecH = [];
  for (const v of horsZone) {
    const r = await appel(c2, 'POST', 'customer_update_address.php', { street: '1 rue du Test', city: v });
    if (!(r.status === 422 && r.json?.error === 'validation' && r.json?.fields && 'city' in r.json.fields)) ecH.push(`ville ${court(v)} : ${r.status} ${r.json?.error}`);
  }
  lot(`ville hors zone refusée à la modification d'adresse (${horsZone.length} noms voisins : accents, casse, tiret, prototype…) : 422 validation sur city`, horsZone.length, ecH);
  const typesFaux = [123, true, ['Rouvroy'], { a: 1 }];
  const ecT = [];
  for (const v of typesFaux) {
    const r = await appel(c2, 'POST', 'customer_update_address.php', { street: '1 rue du Test', city: v });
    if (!(r.status === 422 && r.json?.fields && 'city' in r.json.fields)) ecT.push(`ville ${court(v)} : ${r.status} ${r.json?.error}`);
  }
  for (const v of [123, ['rue'], { a: 1 }, true]) {
    const r = await appel(c2, 'POST', 'customer_update_address.php', { street: v, city: 'Rouvroy' });
    if (!(r.status === 422 && r.json?.fields && 'street' in r.json.fields)) ecT.push(`rue ${court(v)} : ${r.status} ${r.json?.error}`);
  }
  lot('ville ou rue de mauvais type (nombre, booléen, tableau, objet) : 422 validation', typesFaux.length + 4, ecT);
  const me = await appel(c2, 'GET', 'customer_me.php');
  egal('après tous ces refus, l\'adresse du compte est inchangée', [me.json?.customer?.street, me.json?.customer?.city], ['5 rue de la Paix', 'Dourges']);

  // Les 8 villes de la zone sont acceptées ; une ville entourée d'espaces est normalisée ou refusée, jamais enregistrée telle quelle.
  const c3 = adr[2];
  const ecV = [];
  for (const v of K.VILLES) {
    const r = await changerAdresse(c3, `${v.length} place du Marché`, v);
    if (!(r.rep.status === 200 && r.rep.json?.customer?.city === v)) ecV.push(`${v} : ${r.rep.status} ${court(r.rep.json?.customer)}`);
  }
  lot('les 8 villes de la zone sont acceptées à la modification d\'adresse', 8, ecV);
  const esp = await appel(c3, 'POST', 'customer_update_address.php', { street: '1 rue du Test', city: '  Rouvroy  ', housing_type: 'maison' });
  controle('ville entourée d\'espaces : normalisée (Rouvroy) ou refusée en 422, jamais enregistrée avec les espaces',
    (esp.status === 200 && esp.json?.customer?.city === 'Rouvroy') || esp.status === 422, `${esp.status} ${esp.json?.customer?.city}`);
  const c3b = await appel(c3, 'GET', 'customer_me.php');
  c3.adresse = c3b.json?.customer?.city ? { street: c3b.json.customer.street, city: c3b.json.customer.city } : null;

  // Longueurs et caractères de la rue.
  const longue = 'é'.repeat(150);
  const l1 = await changerAdresse(c3, longue, 'Hénin-Beaumont');
  egal('rue de 150 caractères : acceptée', [l1.rep.status, l1.rep.json?.customer?.street?.length], [200, 150]);
  const l1c = await commander(c3, { specs: [{ type: 'pizza', nom: 'Régina', taille: 'Solo' }] });
  verifierCreation('commande en livraison avec une rue de 150 caractères : adresse conservée en entier', l1c);
  const l2 = await appel(c3, 'POST', 'customer_update_address.php', { street: 'é'.repeat(151), city: 'Hénin-Beaumont' });
  egal('rue de 151 caractères : 422 validation sur street', [l2.status, l2.json?.error, l2.json?.fields && 'street' in l2.json.fields], [422, 'validation', true]);
  const emojis = '🍕'.repeat(150);
  const l3 = await changerAdresse(c3, emojis, 'Hénin-Beaumont');
  egal('rue de 150 emojis (caractères hors plan de base) : acceptée', [l3.rep.status, Array.from(l3.rep.json?.customer?.street ?? '').length], [200, 150]);
  const l3c = await commander(c3, { specs: [{ type: 'pizza', nom: 'Régina', taille: 'Solo' }] });
  verifierCreation('commande en livraison avec une rue de 150 emojis : adresse conservée en entier', l3c);
  const speciale = `L'Église, n°5 "bis" <b>x</b> & co — {braces} [crochets] 100% \\ / ; 'DROP TABLE orders;--`;
  const l4 = await changerAdresse(c3, speciale, 'Courrières');
  egal('rue avec apostrophes, guillemets, balises, signes SQL : acceptée telle quelle', [l4.rep.status, l4.rep.json?.customer?.street], [200, speciale]);
  const l4c = await commander(c3, { specs: [{ type: 'pizza', nom: 'Régina', taille: 'Duo' }, { type: 'pizza', nom: 'Kebab', taille: 'Duo' }] });
  verifierCreation('commande en livraison avec rue à caractères spéciaux : adresse du patron identique (sans altération)', l4c);

  // Le caractère NUL dans la rue : doit être refusé proprement (422), pas une erreur 500.
  const nul = [];
  for (let i = 0; i < 2; i++) {
    const c = adr[3 + i];
    const r = await appel(c, 'POST', 'customer_update_address.php', { street: '12 rue\u0000des Tests', city: 'Rouvroy' });
    ignorees.add(r);
    nul.push(r);
  }
  const nulInsc = [];
  for (let i = 0; i < 2; i++) {
    const c = new ClientIP('nul-' + i, ipFictive(7000 + i));
    const corps = { ...corpsInscription(7000 + i, { ville: 'Rouvroy', prefixe: 'nul' }), street: '3 rue\u0000des Tests' };
    const r = await appel(c, 'POST', 'customer_signup.php', corps);
    ignorees.add(r);
    nulInsc.push(r);
  }
  const statutsNul = [...nul, ...nulInsc].map((r) => r.status);
  controle('caractère NUL dans la rue (modification d\'adresse et inscription, 2 essais chacun) : refusé en 4xx, jamais une erreur 500',
    statutsNul.every((s) => s >= 400 && s < 500), `statuts ${statutsNul.join(',')}`);
  if (statutsNul.some((s) => s >= 500)) {
    defauts.push({
      titre: 'Le caractère NUL dans la rue de livraison provoque une erreur 500 (modification d\'adresse et inscription)',
      gravite: 'faible',
      scenario: 'POST customer_update_address.php {"street":"12 rue\\u0000des Tests","city":"Rouvroy"} avec un compte connecté ; idem POST customer_signup.php avec la même rue',
      observe: `statuts ${statutsNul.join(',')} (500 server_error)`,
      attendu: '422 validation sur street, comme pour la remarque de commande (« Remarque invalide »)',
      cause_probable: 'serveur/customers.js validateAddress() : cleanSpaces() ne retire pas le caractère NUL, Postgres refuse le NUL dans un texte',
      correctif_propose: "if (street.includes('\\0')) errors.street = 'Adresse invalide.';",
      reproduit_fois: statutsNul.filter((s) => s >= 500).length
    });
  }
  const pas = await appel(adr[3], 'GET', 'customer_me.php');
  controle('après ces essais NUL, le compte reste lisible et son adresse inchangée', pas.status === 200 && pas.json?.customer?.street === null, `${pas.status} rue=${court(pas.json?.customer?.street)}`);

  // Modification d'adresse sans connexion.
  const anonyme = new ClientIP('anonyme', ipFictive(7100));
  const an = await appel(anonyme, 'POST', 'customer_update_address.php', { street: '1 rue X', city: 'Rouvroy' });
  egal('modification d\'adresse sans être connecté : 401 unauthorized', [an.status, an.json?.error], [401, 'unauthorized']);

  // Téléphone obligatoire.
  const invalides = [undefined, '', '   ', 'abc', '1234567', '+++++++', 'x'.repeat(30), '06 12 34 56 78 90 12 34 56 78', '0612-34-5', '06 12 34 56 7a', null, 612345678, ['0612345678']];
  const ecP = [];
  let k = 0;
  for (const tel of invalides) {
    const c = new ClientIP('tel-' + k, ipFictive(7200 + k));
    const corps = corpsInscription(7200 + k, { ville: null, prefixe: 'tel' });
    if (tel === undefined) delete corps.phone; else corps.phone = tel;
    const r = await appel(c, 'POST', 'customer_signup.php', corps);
    if (!(r.status === 422 && r.json?.fields && 'phone' in r.json.fields)) ecP.push(`téléphone ${court(tel)} : ${r.status} ${r.json?.error}`);
    k++;
  }
  lot('inscription sans téléphone valide (absent, vide, trop court, lettres, trop long, mauvais type) : 422 validation sur phone', invalides.length, ecP);
  const valides = ['0612345678', '06 12 34 56 78', '+33 6 12 34 56 78', '06.12.34.56.78', '(0)6-12-34-56-78', '03 21 20 00 33'];
  const ecPV = [];
  for (const tel of valides) {
    const c = new ClientIP('telv-' + k, ipFictive(7300 + k));
    const corps = corpsInscription(7300 + k, { ville: null, prefixe: 'telv' });
    corps.phone = tel;
    const r = await appel(c, 'POST', 'customer_signup.php', corps);
    if (!(r.status === 201 && r.json?.customer?.phone === tel)) ecPV.push(`téléphone ${tel} : ${r.status} ${r.json?.error}`);
    k++;
  }
  lot('inscription avec 6 formats de téléphone valides : acceptée, numéro conservé tel quel', valides.length, ecPV);

  // Profil : téléphone vide refusé, puis compte « ancien » sans téléphone (profile_incomplete).
  const c5 = adr[5];
  await changerAdresse(c5, '8 rue du Four', 'Billy-Montigny');
  const pv = await appel(c5, 'POST', 'customer_update_profile.php', { first_name: c5.customer.first_name, last_name: c5.customer.last_name, phone: '' });
  egal('mise à jour du profil avec un téléphone vide : 422 validation sur phone', [pv.status, pv.json?.error, pv.json?.fields && 'phone' in pv.json.fields], [422, 'validation', true]);
  const premiere = await commander(c5, { specs: specsPizza, moyens: ['card'] });
  verifierCreation('avant le changement de téléphone : commande en livraison acceptée (téléphone d\'origine dans la commande)', premiere);
  const ancienTel = c5.customer.phone;
  site.db.prepare('UPDATE customers SET phone = ? WHERE id = ?').run('', c5.customer.id);
  const ip1 = await commander(c5, { specs: specsPizza, enregistrer: false });
  verifierRefus('compte sans téléphone (ancien compte), livraison : 422 profile_incomplete', ip1, { statut: 422, code: 'profile_incomplete' });
  const ip2 = await commander(c5, { mode: 'pickup', specs: specsPizza, enregistrer: false });
  verifierRefus('compte sans téléphone, à emporter : 422 profile_incomplete', ip2, { statut: 422, code: 'profile_incomplete' });
  egal('refus profile_incomplete : aucune commande enregistrée (1 commande chez le serveur)', await nbCommandesServeur(c5), 1);
  const nouveauTel = '07 98 76 54 32';
  const pu = await appel(c5, 'POST', 'customer_update_profile.php', { first_name: 'Prénom Changé', last_name: 'Nom  Changé', phone: nouveauTel });
  egal('mise à jour du profil avec téléphone valide : 200, noms nettoyés', [pu.status, pu.json?.customer?.phone, pu.json?.customer?.first_name, pu.json?.customer?.last_name], [200, nouveauTel, 'Prénom Changé', 'Nom Changé']);
  c5.customer = pu.json.customer;
  const deuxieme = await commander(c5, { specs: specsPizza, moyens: ['cash'], billet: 20 });
  verifierCreation('après la mise à jour du profil : livraison acceptée avec le nouveau téléphone et le nouveau nom', deuxieme);
  const lv = await appel(patron, 'GET', 'owner_orders.php');
  const o1 = lv.json?.orders?.find((o) => o.id === premiere.rep.json.order.id);
  const o2 = lv.json?.orders?.find((o) => o.id === deuxieme.rep.json.order.id);
  egal('vue du patron : chaque commande garde le téléphone et le nom du moment de la commande',
    [o1?.customer_phone, o1?.customer_name, o2?.customer_phone, o2?.customer_name],
    [ancienTel, `${premiere.att.customer_name}`, nouveauTel, 'Prénom Changé Nom Changé']);
  const detail = await appel(c5, 'GET', `order_status.php?id=${premiere.rep.json.order.id}`);
  egal('vue du client : la première commande garde son nom d\'origine', detail.json?.order?.customer_name, premiere.att.customer_name);
  const intrus = await appel(c5, 'GET', 'owner_orders.php');
  egal('un client connecté n\'a pas accès à la liste du patron (adresses de livraison de tous les clients) : 403 forbidden', [intrus.status, intrus.json?.error], [403, 'forbidden']);
  const sansSession = await appel(new ClientIP('inconnu', ipFictive(7400)), 'GET', 'owner_orders.php');
  egal('sans connexion : la liste du patron répond 401 unauthorized', [sansSession.status, sansSession.json?.error], [401, 'unauthorized']);
  void rA;
}

// ---------------------------------------------------------------------------------------------------------------------
// 5. Changement d'adresse entre deux commandes
async function partie5() {
  section('5. Changement d\'adresse entre deux commandes : chaque commande garde SON adresse');
  const cl = await nouveauxClients(6, 501, 'chg', { villes: false });
  const sansPizza = (zone, rngx, cible) => chercher({ mode: 'delivery', zone, rng: rngx, maxPizzas: 0, maxProduits: 6 }, [cible]);
  const r5 = rng(5005);
  const Hen = K.ZONES['Hénin-Beaumont'];
  const Rou = K.ZONES['Rouvroy'];

  // S1 : Hénin-Beaumont -> Rouvroy -> Hénin-Beaumont, même panier de 1000 (sans pizza) puis de 2500.
  const c = cl[0];
  await changerAdresse(c, '1 rue Jean Jaurès', 'Hénin-Beaumont');
  const p1000 = sansPizza(Hen, r5, 1000);
  const o1 = await commander(c, { specs: p1000.specs, moyens: ['card'] });
  verifierCreation('S1 · commande n°1 à Hénin-Beaumont (1000 + frais 550)', o1);
  await changerAdresse(c, '9 avenue de la Gare', 'Rouvroy');
  const o2 = await commander(c, { specs: p1000.specs, moyens: ['card'], enregistrer: false });
  egal('S1 · même panier (1000) après passage à Rouvroy : 422 minimum_not_reached (minimum de la NOUVELLE ville : 2500)',
    [o2.rep.status, o2.rep.json?.error, o2.rep.json?.minimum_cents, o2.rep.json?.products_after_promo_cents], [422, 'minimum_not_reached', 2500, 1000]);
  const p2500 = sansPizza(Rou, r5, 2500);
  const o3 = await commander(c, { specs: p2500.specs, moyens: ['cash'], billet: 50 });
  verifierCreation('S1 · commande n°2 à Rouvroy (2500 + frais 800)', o3);
  const rejeu = await appel(c, 'POST', 'order_create.php', o1.corps);
  egal('S1 · rejeu de la commande n°1 (même clé, même corps) après le changement d\'adresse : 200 replayed, ANCIENNE adresse',
    [rejeu.status, rejeu.json?.replayed, rejeu.json?.order?.id, rejeu.json?.order?.delivery_address, rejeu.json?.order?.delivery_fee_cents],
    [200, true, o1.rep.json.order.id, { street: '1 rue Jean Jaurès', city: 'Hénin-Beaumont' }, 550]);
  await changerAdresse(c, '1 rue Jean Jaurès', 'Hénin-Beaumont');
  const o4 = await commander(c, { specs: p1000.specs, moyens: ['ticket'] });
  verifierCreation('S1 · retour à Hénin-Beaumont : le panier de 1000 est de nouveau accepté (commande n°3)', o4);
  for (const [nom, o] of [['n°1', o1], ['n°2', o3], ['n°3', o4]]) {
    const st = await appel(c, 'GET', `order_status.php?id=${o.rep.json.order.id}`);
    egal(`S1 · order_status de la commande ${nom} : adresse, frais et total d'origine`,
      [st.json?.order?.delivery_address, st.json?.order?.delivery_fee_cents, st.json?.order?.total_cents], [o.att.delivery_address, o.att.delivery_fee_cents, o.att.total_cents]);
  }
  const lc = await appel(c, 'GET', 'customer_orders.php');
  egal('S1 · customer_orders : 3 commandes, de la plus récente à la plus ancienne, chacune avec sa ville',
    lc.json?.orders?.map((o) => [o.id, o.delivery_address.city]), [[o4, 'Hénin-Beaumont'], [o3, 'Rouvroy'], [o1, 'Hénin-Beaumont']].map(([o, v]) => [o.rep.json.order.id, v]));

  // S2 : une commande acceptée par le patron garde son adresse quand le client déménage.
  const d = cl[1];
  await changerAdresse(d, '4 rue Victor Hugo', 'Dourges');
  const d1 = await commander(d, { specs: sansPizza(K.ZONES['Dourges'], r5, 1500).specs, moyens: ['ticket_card'] });
  verifierCreation('S2 · commande à Dourges', d1);
  const ac = await appel(patron, 'POST', 'owner_order_decide.php', { id: d1.rep.json.order.id, action: 'accept', delay_minutes: 40 });
  egal('S2 · le patron accepte (40 min)', [ac.status, ac.json?.order?.status, ac.json?.order?.delay_minutes], [200, 'accepted', 40]);
  d1.att.status = 'accepted';
  d1.att.delay_minutes = 40;
  d1.att.accepted_at = K.utcAt(epochActuel);
  d1.att.ready_at = K.utcAt(epochActuel + 40 * 60);
  await changerAdresse(d, '77 chemin des Prés', 'Courrières');
  const st = await appel(d, 'GET', `order_status.php?id=${d1.rep.json.order.id}`);
  egal('S2 · après le déménagement, la commande acceptée garde l\'adresse de Dourges (vue client)', [K.comparerVue(st.json?.order, d1.att).length, st.json?.order?.delivery_address], [0, { street: '4 rue Victor Hugo', city: 'Dourges' }]);
  const lp = await appel(patron, 'GET', 'owner_orders.php');
  const vp = lp.json?.orders?.find((o) => o.id === d1.rep.json.order.id);
  egal('S2 · même chose dans la vue du patron', [K.comparerVue(vp, d1.att, { proprietaire: true }).length, vp?.delivery_address], [0, { street: '4 rue Victor Hugo', city: 'Dourges' }]);

  // S3 : adresse effacée entre deux commandes.
  const e = cl[2];
  await changerAdresse(e, '3 impasse du Moulin', 'Billy-Montigny');
  const e1 = await commander(e, { specs: sansPizza(K.ZONES['Billy-Montigny'], r5, 2000).specs });
  verifierCreation('S3 · commande à Billy-Montigny', e1);
  await changerAdresse(e, '', '');
  const e2 = await commander(e, { specs: [{ type: 'pizza', nom: 'Régina', taille: 'Duo' }], enregistrer: false });
  verifierRefus('S3 · adresse effacée : la livraison suivante est refusée (address_required)', e2, { statut: 422, code: 'address_required' });
  const es = await appel(e, 'GET', `order_status.php?id=${e1.rep.json.order.id}`);
  egal('S3 · la première commande garde son adresse', es.json?.order?.delivery_address, { street: '3 impasse du Moulin', city: 'Billy-Montigny' });

  // S4 : un client, 8 villes, 8 commandes identiques (2500 sans pizza) : frais et adresses propres à chacune.
  const g = cl[3];
  const panier2500 = chercher({ mode: 'delivery', zone: Rou, rng: r5, maxPizzas: 0, maxProduits: 6 }, [2500]);
  const resG = [];
  for (const ville of K.VILLES) {
    await changerAdresse(g, `${ville.length * 7} rue de la ${ville.split('-')[0]}`, ville);
    const r = await commander(g, { specs: panier2500.specs, moyens: ['card'] });
    verifierCreation(`S4 · panier identique de 2500 en livraison à ${ville} : frais ${K.ZONES[ville].frais}, total ${2500 + K.ZONES[ville].frais}`, r);
    resG.push(r);
  }
  const lg = await appel(g, 'GET', 'customer_orders.php');
  const villesVues = (lg.json?.orders ?? []).map((o) => o.delivery_address.city).reverse();
  egal('S4 · customer_orders : les 8 commandes portent chacune la ville de son envoi, dans l\'ordre', villesVues, K.VILLES);
  const fraisVus = (lg.json?.orders ?? []).map((o) => o.delivery_fee_cents).reverse();
  egal('S4 · frais de livraison de chaque commande = frais de sa ville (550, 550, 550, 550, 800, 800, 800, 800)', fraisVus, K.VILLES.map((v) => K.ZONES[v].frais));

  // S5 : changement d'adresse pendant l'envoi de la commande (course) : chaque commande reste cohérente.
  const course = await nouveauxClients(20, 601, 'course', { villes: false });
  const resCourse = await enParallele(course, 20, async (cc) => {
    await changerAdresse(cc, `${cc.num} rue Ancienne`, 'Hénin-Beaumont');
    const specs = sansPizza(Hen, r5, 1000).specs;
    const [o, ch] = await Promise.all([
      commander(cc, { specs, moyens: ['card'], enregistrer: false }),
      appel(cc, 'POST', 'customer_update_address.php', { street: `${cc.num} rue Nouvelle`, city: 'Rouvroy', housing_type: 'maison' })
    ]);
    return { cc, o, ch };
  });
  const ecCourse = [];
  let nbAncienne = 0;
  let nbRefusee = 0;
  for (const { cc, o, ch } of resCourse) {
    if (ch.status !== 200) ecCourse.push(`client ${cc.num} : changement d'adresse ${ch.status}`);
    if (o.rep.status === 201) {
      const v = o.rep.json.order;
      const cite = v.delivery_address;
      const coherent = (cite.city === 'Hénin-Beaumont' && cite.street === `${cc.num} rue Ancienne` && v.delivery_fee_cents === 550 && v.total_cents === 1550)
        || (cite.city === 'Rouvroy' && cite.street === `${cc.num} rue Nouvelle`);
      if (!coherent) ecCourse.push(`client ${cc.num} : commande incohérente ${JSON.stringify([cite, v.delivery_fee_cents, v.total_cents])}`);
      if (cite.city === 'Hénin-Beaumont') nbAncienne++;
      o.att.id = v.id;
      o.att.delivery_address = cite;
      cc.nb++;
      const zoneVue = K.ZONES[cite.city];
      const c2 = K.calculerLignes(o.ls, 'delivery', zoneVue);
      o.att.delivery_fee_cents = c2.frais;
      o.att.total_cents = c2.total;
      registre.push(o);
    } else if (o.rep.status === 422 && o.rep.json?.error === 'minimum_not_reached' && o.rep.json?.minimum_cents === 2500) {
      nbRefusee++;
    } else {
      ecCourse.push(`client ${cc.num} : réponse ${o.rep.status} ${o.rep.json?.error}`);
    }
  }
  lot('S5 · 20 clients envoient une commande et changent d\'adresse en même temps : chaque commande suit UNE adresse (rue, ville, frais, minimum cohérents)', 20, ecCourse);
  metriques.courseAdresseAncienne = nbAncienne;
  metriques.courseAdresseNouvelleRefus = nbRefusee;
  console.log(`  >> course adresse : ${nbAncienne} commandes à l'ancienne adresse, ${nbRefusee} refusées (minimum de la nouvelle ville)`);
}

// ---------------------------------------------------------------------------------------------------------------------
// 6. Rafale de 100 clients
async function scenarioRafale(c) {
  const r = rng(9000 + c.num);
  c.ev = [];
  const ev = (type, res, extra = {}) => c.ev.push({ type, res, ...extra });
  const moyens = () => r.melanger(K.MOYENS).slice(0, r.entier(1, 4));
  const valide = async (nom, opts = {}) => {
    const zone = K.ZONES[c.adresse.city];
    const specs = K.specsAleatoires(carte, r, r.choix(['produits', 'pizzas', 'mixte']), zone);
    const res = await commander(c, { specs, moyens: moyens(), billet: r.choix(K.BILLETS), ...opts });
    ev(nom, res);
    return res;
  };

  // 1. sous le minimum
  ev('sous-minimum', await commander(c, {
    specs: [{ type: 'produit', nom: r.choix(['Boisson Oasis Pomme Poire canette', 'Tex-Mex Wings (5 pièces)', 'Subitowich Rome', 'Pâtes Saumon', 'Salade Niçoise']) }],
    moyens: moyens(), billet: r.choix(K.BILLETS), enregistrer: false
  }));
  // 2. première commande valide, puis rejeu et conflit
  const v1 = await valide('valide');
  if (v1.rep.status === 201 && c.num % 2 === 0) {
    const rejeu = await appel(c, 'POST', 'order_create.php', v1.corps);
    ev('rejeu', { ...v1, rep: rejeu });
    const conflit = await appel(c, 'POST', 'order_create.php', { ...v1.corps, total_cents: v1.corps.total_cents + 100 });
    ev('conflit', { ...v1, rep: conflit });
  }
  // 3. changement d'adresse puis deuxième commande
  const villeB = r.choix(K.VILLES.filter((v) => v !== c.adresse.city));
  const rueB = r.choix([`${c.num} avenue des Tests`, `Résidence « Les Tilleuls », bât. ${c.num}`, `${c.num}   rue   de   l'Église`, `${c.num} impasse O'Neil & fils <test>`]);
  const ch1 = await changerAdresse(c, rueB, villeB);
  ev('adresse', { rep: ch1.rep, att: ch1.att });
  await valide('valide');
  // 4. écart de prix (409)
  {
    const zone = K.ZONES[c.adresse.city];
    const specs = K.specsAleatoires(carte, r, r.choix(['produits', 'pizzas', 'mixte']), zone);
    const variante = r.entier(0, 2);
    const res = await commander(c, {
      specs, moyens: moyens(), billet: r.choix(K.BILLETS), enregistrer: false,
      ...(variante === 0 ? { total: (k) => k.total + r.entier(1, 500) }
        : variante === 1 ? { frais: (k) => (k.frais > 0 ? 0 : zone.frais), total: (k) => k.apres + (k.frais > 0 ? 0 : zone.frais) }
          : { total: (k) => k.total - 1 })
    });
    ev('ecart', res);
  }
  // 5. nouvelle adresse puis troisième commande
  const villeC = r.choix(K.VILLES.filter((v) => v !== c.adresse.city));
  const ch2 = await changerAdresse(c, `${c.num} boulevard de la République`, villeC);
  ev('adresse', { rep: ch2.rep, att: ch2.att });
  await valide('valide');
  // 6. à emporter
  {
    const specs = K.specsAleatoires(carte, r, r.choix(['pizzas', 'mixte']), null);
    ev('emporter', await commander(c, { mode: 'pickup', specs }));
  }
  // 7. clé d'envoi commune à tous les clients : chaque client obtient SA commande
  await valide('cle-commune', { cle: 'cle-commune-livraison-02' });
}

async function partie6() {
  section('6. Rafale : 100 clients en même temps (livraison de tous types, changements d\'adresse, rejeux, écarts de prix)');
  const avant = registre.length;
  const reqAvant = reponses.length;
  const t0 = performance.now();
  await enParallele(clientsRafale, 100, scenarioRafale);
  const duree = performance.now() - t0;
  const nbReq = reponses.length - reqAvant;
  metriques.rafaleMs = Math.round(duree);
  metriques.rafaleRequetes = nbReq;
  console.log(`  >> rafale : ${nbReq} requêtes en ${Math.round(duree)} ms (${Math.round(nbReq / (duree / 1000))} requêtes/s), ${registre.length - avant} commandes créées`);

  const evts = (type) => clientsRafale.flatMap((c) => c.ev.filter((e) => e.type === type).map((e) => ({ ...e, c })));
  // sous le minimum
  const ec1 = [];
  for (const { res, c } of evts('sous-minimum')) {
    const j = res.rep.json;
    const ok = res.rep.status === 422 && j?.error === 'minimum_not_reached' && j.minimum_cents === res.zone.min && j.products_after_promo_cents === res.calc.apres;
    if (!ok) ec1.push(`client ${c.num} : ${res.rep.status} ${j?.error} ${j?.minimum_cents}/${j?.products_after_promo_cents} / attendu ${res.zone.min}/${res.calc.apres}`);
  }
  lot('rafale · 100 commandes sous le minimum : 422 minimum_not_reached avec minimum et montant du serveur = calcul indépendant', 100, ec1);
  // valides
  const valides = evts('valide');
  const ec2 = [];
  for (const { res, c } of valides) {
    const ecarts = res.rep.status === 201 && res.rep.json?.replayed === false ? K.comparerVue(res.rep.json.order, res.att) : [`statut ${res.rep.status} ${res.rep.json?.error}`];
    if (ecarts.length) ec2.push(`client ${c.num} : ${ecarts.join(' ; ')}`);
  }
  lot(`rafale · ${valides.length} commandes en livraison valides (3 par client, 3 villes différentes) : 201, vue complète = calcul indépendant`, valides.length, ec2);
  const parType = { sansPizza: 0, avecPizza: 0, avecPromo: 0, moitie: 0, supplements: 0, retraits: 0, calzone: 0, composer: 0, notes: 0 };
  for (const { res } of valides) {
    if (res.calc.pizza) parType.avecPizza++; else parType.sansPizza++;
    if (res.calc.remise > 0) parType.avecPromo++;
    for (const l of res.ls) {
      if (l.envoi.half) parType.moitie++;
      if (l.envoi.extras.length) parType.supplements++;
      if (l.envoi.removed.length) parType.retraits++;
      if (l.envoi.name.startsWith('Calzone')) parType.calzone++;
      if (l.envoi.name.startsWith('Marguerita')) parType.composer++;
      if (l.envoi.note) parType.notes++;
    }
  }
  metriques.rafaleTypes = parType;
  controle('rafale · les commandes couvrent tous les types (avec et sans pizza, promotion, moitié-moitié, suppléments, retraits, calzone, pizza à composer, remarques)',
    parType.sansPizza > 20 && parType.avecPizza > 20 && parType.avecPromo > 10 && parType.moitie > 0 && parType.supplements > 0 && parType.retraits > 0 && parType.calzone > 0 && parType.composer > 0 && parType.notes > 0,
    parType);
  const combos = new Set(valides.map(({ res }) => res.moyens.join('+')));
  controle('rafale · au moins 12 combinaisons de moyens de paiement différentes dans la rafale', combos.size >= 12, `${combos.size} combinaisons`);
  // rejeux et conflits
  const ec3 = [];
  for (const { res, c } of evts('rejeu')) {
    const j = res.rep.json;
    if (!(res.rep.status === 200 && j?.replayed === true && j.order?.id === res.att.id && K.comparerVue(j.order, res.att).length === 0)) ec3.push(`client ${c.num} : ${res.rep.status} ${j?.error} replayed=${j?.replayed}`);
  }
  lot('rafale · rejeux de la première commande (50 clients) : 200 replayed, même commande, même adresse', evts('rejeu').length, ec3);
  const ec4 = [];
  for (const { res, c } of evts('conflit')) if (!(res.rep.status === 409 && res.rep.json?.error === 'idempotency_conflict')) ec4.push(`client ${c.num} : ${res.rep.status} ${res.rep.json?.error}`);
  lot('rafale · même clé avec un contenu différent (50 clients) : 409 idempotency_conflict', evts('conflit').length, ec4);
  // écarts de prix
  const ec5 = [];
  for (const { res, c } of evts('ecart')) {
    const j = res.rep.json;
    const ok = res.rep.status === 409 && j?.error === 'price_mismatch' && j.server_products_cents === res.calc.brut && j.server_promo_cents === res.calc.remise
      && j.server_delivery_fee_cents === res.calc.frais && j.server_total_cents === res.calc.total;
    if (!ok) ec5.push(`client ${c.num} : ${res.rep.status} ${j?.error} ${[j?.server_products_cents, j?.server_promo_cents, j?.server_delivery_fee_cents, j?.server_total_cents]} / calcul ${[res.calc.brut, res.calc.remise, res.calc.frais, res.calc.total]}`);
  }
  lot('rafale · 100 totaux faux (total décalé, frais inversés, total − 1) : 409 price_mismatch avec produits, promotion, frais, total du serveur = calcul indépendant', evts('ecart').length, ec5);
  // à emporter
  const ec6 = [];
  for (const { res, c } of evts('emporter')) {
    const ecarts = res.rep.status === 201 ? K.comparerVue(res.rep.json.order, res.att) : [`statut ${res.rep.status} ${res.rep.json?.error}`];
    if (ecarts.length) ec6.push(`client ${c.num} : ${ecarts.join(' ; ')}`);
  }
  lot('rafale · 100 commandes à emporter (même compte, adresse enregistrée) : 201, adresse null, paiement [], promotion à emporter', evts('emporter').length, ec6);
  // changements d'adresse
  const ec7 = [];
  for (const { res, c } of evts('adresse')) {
    const j = res.rep.json;
    if (!(res.rep.status === 200 && j?.customer?.city === res.att.city && j.customer.street === res.att.street)) ec7.push(`client ${c.num} : ${res.rep.status} ${court(j?.customer)} / attendu ${court(res.att)}`);
  }
  lot('rafale · 200 changements d\'adresse (rues avec espaces multiples, apostrophes, guillemets, balises) : 200, adresse enregistrée = adresse envoyée nettoyée', evts('adresse').length, ec7);
  // clé commune
  const communes = evts('cle-commune');
  const ids = new Set(communes.map(({ res }) => res.rep.json?.order?.id));
  const ec8 = [];
  for (const { res, c } of communes) {
    const ecarts = res.rep.status === 201 && res.rep.json?.replayed === false ? K.comparerVue(res.rep.json.order, res.att) : [`statut ${res.rep.status} ${res.rep.json?.error} replayed=${res.rep.json?.replayed}`];
    if (ecarts.length) ec8.push(`client ${c.num} : ${ecarts.join(' ; ')}`);
  }
  lot('rafale · la même clé d\'envoi utilisée par les 100 clients : 100 commandes distinctes, aucune confondue avec celle d\'un autre', 100, ec8);
  egal('rafale · 100 numéros de commande distincts pour la clé commune', ids.size, 100);
  // ensemble
  const tous = registre.slice(avant);
  const idsTous = new Set(tous.map((x) => x.rep.json.order.id));
  egal('rafale · aucun numéro de commande en double sur l\'ensemble de la rafale', idsTous.size, tous.length);
  const lat = clientsRafale.flatMap((c) => c.ev.map((e) => e.res?.rep?.ms)).filter((x) => typeof x === 'number');
  metriques.latenceMs = { p50: Math.round(percentile(lat, 50)), p95: Math.round(percentile(lat, 95)), max: Math.round(Math.max(...lat)) };
  console.log(`  >> latence des requêtes de la rafale : p50 ${metriques.latenceMs.p50} ms, p95 ${metriques.latenceMs.p95} ms, max ${metriques.latenceMs.max} ms`);
}

// ---------------------------------------------------------------------------------------------------------------------
// 9. Limites et concurrence (même client)
let clientLimite = null;
async function partie9() {
  section('9. Limite de 20 commandes par client, requêtes parallèles, même clé en parallèle');
  const rL = rng(9009);
  const Z = K.ZONES['Hénin-Beaumont'];
  // Numéros multiples de 8 : clients à Hénin-Beaumont (minimum 1000), comme le panier de test.
  const [x] = await nouveauxClients(1, 800, 'lim');
  const [y] = await nouveauxClients(1, 808, 'lim');
  const premiere = chercher({ mode: 'delivery', zone: Z, rng: rL, maxPizzas: 0, maxProduits: 6 }, [Z.min]);
  // 20 commandes valides, puis la 21e est refusée.
  const crees = [];
  for (let i = 0; i < 20; i++) {
    const r = await commander(x, { specs: premiere.specs, moyens: ['card'] });
    crees.push(r);
  }
  egal('limite · 20 commandes de suite d\'un même client : 20 créées (201)', crees.map((r) => r.rep.status), Array(20).fill(201));
  const r21 = await commander(x, { specs: premiere.specs, moyens: ['card'], enregistrer: false, rejeu: true });
  x.tentatives = 20;
  egal('limite · la 21e commande dans les 10 minutes : 429 too_many_attempts, attente de 600 s (horloge figée)',
    [r21.rep.status, r21.rep.json?.error, r21.rep.json?.retry_after_seconds, r21.rep.headers.get('retry-after')], [429, 'too_many_attempts', 600, '600']);
  const e21 = await commander(x, { mode: 'pickup', specs: [{ type: 'produit', nom: 'Boisson Oasis Pomme Poire canette' }], enregistrer: false, rejeu: true });
  egal('limite · même limite pour une commande à emporter (même client)', [e21.rep.status, e21.rep.json?.error], [429, 'too_many_attempts']);
  const rj = await commander(x, { specs: premiere.specs, moyens: ['card'], cle: crees[0].cle, rejeu: true, enregistrer: false });
  egal('limite · rejeu d\'une commande existante pendant le verrou : 200 replayed (jamais refusé)',
    [rj.rep.status, rj.rep.json?.replayed, rj.rep.json?.order?.id], [200, true, crees[0].rep.json.order.id]);
  const autre = await commander(y, { specs: premiere.specs, moyens: ['card'] });
  verifierCreation('limite · un autre client n\'est pas touché par le verrou du premier', autre);
  egal('limite · aucune commande créée par les refus (20 commandes chez le serveur)', await nbCommandesServeur(x), 20);
  clientLimite = x;

  // Requêtes parallèles d'un même client : la limite de 20 doit tenir aussi en parallèle.
  const resultats = [];
  const rPar = rng(9010);
  for (let essai = 0; essai < 2; essai++) {
    const [p] = await nouveauxClients(1, 816 + 8 * essai, 'par');
    const reqs = Array.from({ length: 40 }, () => commander(p, { specs: premiere.specs, moyens: ['card'], rejeu: true, enregistrer: false, cle: K.cleSuivante('par') }));
    const reps = await Promise.all(reqs);
    p.tentatives = 20;
    const nb201 = reps.filter((r) => r.rep.status === 201).length;
    const nb429 = reps.filter((r) => r.rep.status === 429).length;
    const autres = reps.filter((r) => r.rep.status !== 201 && r.rep.status !== 429).map((r) => `${r.rep.status} ${r.rep.json?.error ?? String(r.rep.text).slice(0, 100)}`);
    // Les commandes créées sont enregistrées pour la comparaison des vues.
    for (const r of reps) {
      if (r.rep.status === 201) {
        r.att.id = r.rep.json.order.id;
        r.client.nb++;
        registre.push(r);
      }
    }
    const base = await nbCommandesServeur(p);
    resultats.push({ nb201, nb429, base, autres });
    void rPar;
  }
  for (let i = 0; i < resultats.length; i++) {
    const { nb201, nb429, base, autres } = resultats[i];
    controle(`limite · 40 commandes envoyées EN PARALLÈLE par un même client (essai ${i + 1}) : au plus 20 créées`, nb201 <= 20 && autres.length === 0 && base === nb201,
      `${nb201} créées (201), ${nb429} refusées (429), ${base} enregistrées chez le serveur${autres.length ? ', autres : ' + autres.join(',') : ''}`);
  }
  if (resultats.some((r) => r.nb201 > 20)) {
    defauts.push({
      titre: 'La limite de 20 commandes par 10 minutes et par client est contournée par des requêtes parallèles',
      gravite: 'moyen',
      scenario: 'Un client connecté envoie 40 POST order_create.php simultanés (clés d\'envoi différentes, paniers valides, livraison à Hénin-Beaumont)',
      observe: resultats.map((r) => `${r.nb201} commandes créées, ${r.nb429} refus 429`).join(' ; '),
      attendu: 'au plus 20 commandes créées dans la fenêtre de 10 minutes, les suivantes refusées en 429 too_many_attempts',
      cause_probable: 'serveur/routes/order_create.js : throttleGuard() lit le verrou AVANT throttleHit() qui compte ; les 40 requêtes passent toutes le contrôle avant que le premier compteur ne soit incrémenté (contrôle puis action non atomique)',
      correctif_propose: "// serveur/throttle.js : throttleHit() renvoie le compteur après incrément atomique (UPDATE … SET attempts = attempts + 1 RETURNING attempts)\n// serveur/routes/order_create.js\nconst n = await throttleHit(bucket, 20, 600);\nif (n > 20) fail(429, 'too_many_attempts', 'Trop de tentatives. Réessayez plus tard.', { retry_after_seconds: 600 }, { 'Retry-After': '600' });",
      reproduit_fois: resultats.filter((r) => r.nb201 > 20).length
    });
  }
  metriques.parallele40 = resultats.map((r) => r.nb201);

  // Même clé d'envoi en parallèle : une seule commande.
  const [w] = await nouveauxClients(1, 832, 'cle');
  const specsW = premiere.specs;
  const cleW = K.cleSuivante('double');
  const lotW = await Promise.all(Array.from({ length: 8 }, () => commander(w, { specs: specsW, moyens: ['card'], cle: cleW, rejeu: true, enregistrer: false })));
  w.tentatives = 8;
  const nbCreees = lotW.filter((r) => r.rep.status === 201).length;
  const ids = new Set(lotW.map((r) => r.rep.json?.order?.id));
  const bW = await nbCommandesServeur(w);
  egal('même clé d\'envoi envoyée 8 fois en parallèle (double-clic) : une seule commande créée, les autres sont des rejeux',
    [nbCreees, lotW.filter((r) => r.rep.status === 200 && r.rep.json?.replayed === true).length, ids.size, bW], [1, 7, 1, 1]);
  const prem = lotW.find((r) => r.rep.status === 201);
  if (prem) { prem.att.id = prem.rep.json.order.id; w.nb++; registre.push(prem); }
}

// ---------------------------------------------------------------------------------------------------------------------
// 7. Vues : client, patron, base de données
function lignesBase(rows, items) {
  const parCommande = new Map();
  for (const it of items) {
    if (!parCommande.has(Number(it.order_id))) parCommande.set(Number(it.order_id), []);
    parCommande.get(Number(it.order_id)).push(it);
  }
  return { rows, parCommande };
}

async function partie7(etiquette = '') {
  section(`7. Vues du client, du patron et de la base comparées au calcul indépendant${etiquette}`);
  const reg = registre;
  const attendus = new Map(reg.map((x) => [x.att.id, x]));
  const clients = [...new Set(reg.map((x) => x.client))];
  egal(`${reg.length} commandes créées pendant la batterie : identifiants tous distincts`, new Set(reg.map((x) => x.att.id)).size, reg.length);

  // Liste du patron.
  const lp = await appel(patron, 'GET', 'owner_orders.php');
  const vues = lp.json?.orders ?? [];
  egal('patron · owner_orders : 200 avec l\'heure du serveur', [lp.status, typeof lp.json?.server_now === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(lp.json.server_now)], [200, true]);
  const idsVus = vues.map((o) => o.id);
  const attendusIds = [...attendus.keys()].sort((a, b) => a - b);
  const manquantes = attendusIds.filter((i) => !idsVus.includes(i));
  const inattendues = idsVus.filter((i) => !attendus.has(i));
  controle(`patron · les ${reg.length} commandes sont toutes dans la liste, aucune en trop ni en double`,
    manquantes.length === 0 && inattendues.length === 0 && new Set(idsVus).size === idsVus.length, `${idsVus.length} listées, ${manquantes.length} manquantes, ${inattendues.length} inattendues`);
  controle('patron · liste triée par heure de création puis numéro', vues.every((o, i) => i === 0 || vues[i - 1].created_at < o.created_at || (vues[i - 1].created_at === o.created_at && vues[i - 1].id < o.id)), `${vues.length} commandes`);
  const ec1 = [];
  for (const o of vues) {
    const x = attendus.get(o.id);
    if (!x) continue;
    const e = K.comparerVue(o, x.att, { proprietaire: true });
    if (e.length) ec1.push(`#${o.id} : ${e.join(' ; ')}`);
  }
  lot('patron · chaque commande (paiement, billet, adresse, frais, promotion, total, lignes, client) = calcul indépendant', vues.length, ec1);
  const livraisons = vues.filter((o) => o.mode === 'delivery');
  const ec1b = livraisons.filter((o) => !o.delivery_address || !o.delivery_address.street || !K.ZONES[o.delivery_address.city] || o.payment_methods.length === 0
    || (o.payment_methods.includes('cash') !== (o.cash_change_for !== null)) || (o.items.some((i) => i.variant !== '') ? o.delivery_fee_cents !== 0 : o.delivery_fee_cents !== K.ZONES[o.delivery_address.city].frais));
  lot('patron · règles de lecture : toute livraison a rue + ville de la zone, au moins un moyen, un billet si et seulement si espèces, frais seulement sans pizza', livraisons.length, ec1b.map((o) => `#${o.id}`));
  const emporter = vues.filter((o) => o.mode === 'pickup');
  lot('patron · toute commande à emporter : adresse null, paiement [], billet null, frais 0', emporter.length,
    emporter.filter((o) => o.delivery_address !== null || o.payment_methods.length !== 0 || o.cash_change_for !== null || o.delivery_fee_cents !== 0).map((o) => `#${o.id}`));

  // Vues du client : liste puis détail ; comparaison croisée client / patron.
  const ec2 = [];
  const ec3 = [];
  const ec4 = [];
  await enParallele(clients, 20, async (c) => {
    const mes = reg.filter((x) => x.client === c);
    const lc = await appel(c, 'GET', 'customer_orders.php');
    const liste = lc.json?.orders ?? [];
    const idsAttendus = mes.map((x) => x.att.id).sort((a, b) => b - a);
    if (lc.status !== 200 || JSON.stringify(liste.map((o) => o.id)) !== JSON.stringify(idsAttendus.slice(0, 50))) {
      ec2.push(`client ${c.num} : ${lc.status} liste ${liste.length} / attendu ${Math.min(50, idsAttendus.length)}`);
    }
    for (const o of liste) {
      const x = attendus.get(o.id);
      if (!x) { ec2.push(`client ${c.num} : commande ${o.id} inattendue`); continue; }
      const e = K.comparerVue(o, x.att);
      if (e.length) ec2.push(`client ${c.num} #${o.id} : ${e.join(' ; ')}`);
    }
    for (const x of mes) {
      const st = await appel(c, 'GET', `order_status.php?id=${x.att.id}`);
      const e = st.status === 200 ? K.comparerVue(st.json?.order, x.att) : [`statut ${st.status}`];
      if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(String(st.json?.server_now))) e.push('server_now absent');
      if (e.length) ec3.push(`client ${c.num} #${x.att.id} : ${e.join(' ; ')}`);
      const vp = vues.find((o) => o.id === x.att.id);
      if (vp && st.status === 200) {
        const { customer_id, customer_phone, customer_email, ...commun } = vp;
        void customer_id; void customer_phone; void customer_email;
        if (JSON.stringify(Object.keys(commun).sort()) !== JSON.stringify(Object.keys(st.json.order).sort()) || K.comparerVue(commun, { ...x.att, customer_id: undefined }).length) {
          ec4.push(`#${x.att.id} : champs ou valeurs différents entre la vue du patron et celle du client`);
        }
      }
    }
  });
  lot(`client · customer_orders : chaque client voit exactement ses commandes (${clients.length} clients), triées, avec toutes les valeurs attendues`, clients.length, ec2);
  lot(`client · order_status de chaque commande (${reg.length}) = calcul indépendant`, reg.length, ec3);
  lot('client / patron · mêmes champs et mêmes valeurs dans les deux vues (le patron en plus : client, téléphone, e-mail)', reg.length, ec4);

  // Base de données.
  const rows = site.db.prepare('SELECT * FROM orders ORDER BY id').all();
  const items = site.db.prepare('SELECT * FROM order_items ORDER BY order_id, position').all();
  const { parCommande } = lignesBase(rows, items);
  const ec5 = [];
  for (const row of rows) {
    const x = attendus.get(Number(row.id));
    if (!x) { ec5.push(`ligne orders ${row.id} inattendue`); continue; }
    const a = x.att;
    const e = [];
    const cmp = (n, o, v) => { if (JSON.stringify(o) !== JSON.stringify(v)) e.push(`${n} ${JSON.stringify(o)} / attendu ${JSON.stringify(v)}`); };
    cmp('mode', row.mode, a.mode);
    cmp('status', row.status, a.status);
    cmp('delivery_street', row.delivery_street, a.delivery_address ? a.delivery_address.street : null);
    cmp('delivery_city', row.delivery_city, a.delivery_address ? a.delivery_address.city : null);
    cmp('payment_methods', JSON.parse(row.payment_methods), a.payment_methods);
    cmp('cash_change_for', row.cash_change_for, a.cash_change_for);
    cmp('products_cents', row.products_cents, a.products_cents);
    cmp('promo_cents', row.promo_cents, a.promo_cents);
    cmp('delivery_fee_cents', row.delivery_fee_cents, a.delivery_fee_cents);
    cmp('total_cents', row.total_cents, a.total_cents);
    cmp('customer_id', row.customer_id, a.customer_id);
    cmp('customer_phone', row.customer_phone, a.customer_phone);
    cmp('customer_email', row.customer_email, a.customer_email);
    cmp('customer_name', `${row.customer_first_name} ${row.customer_last_name}`, a.customer_name);
    cmp('idempotency_key', row.idempotency_key, x.cle);
    const lb = parCommande.get(Number(row.id)) ?? [];
    if (lb.length !== a.items.length) e.push(`${lb.length} lignes en base / attendu ${a.items.length}`);
    else {
      a.items.forEach((it, i) => {
        const b = lb[i];
        cmp(`ligne ${i} name`, b.name, it.name);
        cmp(`ligne ${i} variant`, b.variant, it.variant);
        cmp(`ligne ${i} qty`, Number(b.qty), it.qty);
        cmp(`ligne ${i} unit`, Number(b.unit_price_cents), it.unit_price_cents);
        cmp(`ligne ${i} total`, Number(b.line_total_cents), it.line_total_cents);
        cmp(`ligne ${i} removed`, JSON.parse(b.removed_json), it.removed);
        cmp(`ligne ${i} extras`, JSON.parse(b.extras_json), it.extras);
        cmp(`ligne ${i} half`, b.half_json === null ? null : JSON.parse(b.half_json), it.half);
        cmp(`ligne ${i} note`, b.note, it.note);
      });
    }
    if (e.length) ec5.push(`#${row.id} : ${e.join(' ; ')}`);
  }
  controle('base · autant de commandes en base que de créations acceptées, aucune commande issue d\'un refus', rows.length === reg.length, `${rows.length} lignes orders / ${reg.length} attendues`);
  lot('base · chaque ligne orders et order_items (adresse, paiement, billet, montants, lignes) = calcul indépendant', rows.length, ec5);

  // Isolation : un client ne voit pas la commande (donc l'adresse) d'un autre.
  const ec6 = [];
  const avecCommande = clients.filter((c) => reg.some((x) => x.client === c));
  await enParallele(avecCommande, 25, async (c, i) => {
    const autre = avecCommande[(i + 1) % avecCommande.length];
    const x = reg.find((r) => r.client === autre);
    const st = await appel(c, 'GET', `order_status.php?id=${x.att.id}`);
    const fuite = st.text.includes('"street"') || st.text.includes(String(x.att.delivery_address?.street ?? '§'));
    if (!(st.status === 404 && st.json?.error === 'not_found') || fuite) ec6.push(`client ${c.num} lit la commande ${x.att.id} de ${autre.num} : ${st.status}`);
  });
  lot('isolation · la commande d\'un autre client (adresse de livraison) répond 404 sans aucune donnée', avecCommande.length, ec6);
  metriques.commandesCreees = reg.length;
  metriques.clientsAvecCommandes = clients.length;
}

// ---------------------------------------------------------------------------------------------------------------------
// 8. Décisions du patron : les champs de livraison ne changent pas
async function partie8() {
  section('8. Décisions du patron sur des commandes en livraison : adresse, paiement et montants restent identiques');
  const rD = rng(8008);
  const livr = registre.filter((x) => x.mode === 'delivery' && x.att.status === 'new');
  const choisies = rD.melanger(livr).slice(0, 60);
  const lots = { accepter: choisies.slice(0, 25), refuser: choisies.slice(25, 40), prete: choisies.slice(40, 60) };
  const ec = [];
  await enParallele(lots.accepter, 10, async (x) => {
    const d = rD.choix([20, 30, 40, 50, 60]);
    const r = await appel(patron, 'POST', 'owner_order_decide.php', { id: x.att.id, action: 'accept', delay_minutes: d });
    Object.assign(x.att, { status: 'accepted', delay_minutes: d, accepted_at: K.utcAt(epochActuel), ready_at: K.utcAt(epochActuel + d * 60) });
    const e = r.status === 200 && r.json?.replayed === false ? K.comparerVue(r.json.order, x.att, { proprietaire: true }) : [`statut ${r.status} ${r.json?.error}`];
    if (e.length) ec.push(`accepter #${x.att.id} : ${e.join(' ; ')}`);
  });
  await enParallele(lots.refuser, 10, async (x) => {
    const r = await appel(patron, 'POST', 'owner_order_decide.php', { id: x.att.id, action: 'refuse' });
    Object.assign(x.att, { status: 'refused', refused_at: K.utcAt(epochActuel) });
    const e = r.status === 200 && r.json?.replayed === false ? K.comparerVue(r.json.order, x.att, { proprietaire: true }) : [`statut ${r.status} ${r.json?.error}`];
    if (e.length) ec.push(`refuser #${x.att.id} : ${e.join(' ; ')}`);
  });
  await enParallele(lots.prete, 10, async (x) => {
    const d = rD.choix([20, 30, 40, 50, 60]);
    const r1 = await appel(patron, 'POST', 'owner_order_decide.php', { id: x.att.id, action: 'accept', delay_minutes: d });
    Object.assign(x.att, { status: 'accepted', delay_minutes: d, accepted_at: K.utcAt(epochActuel), ready_at: K.utcAt(epochActuel + d * 60) });
    const r2 = await appel(patron, 'POST', 'owner_order_decide.php', { id: x.att.id, action: 'ready' });
    Object.assign(x.att, { status: 'ready', prepared_at: K.utcAt(epochActuel) });
    const e = r1.status === 200 && r2.status === 200 ? K.comparerVue(r2.json.order, x.att, { proprietaire: true }) : [`statuts ${r1.status} ${r2.status}`];
    if (e.length) ec.push(`prête #${x.att.id} : ${e.join(' ; ')}`);
  });
  lot('décisions · 25 acceptations (délais 20 à 60), 15 refus, 20 « prête » : réponse du patron = valeurs attendues (statut, heures, adresse, paiement, montants)', choisies.length, ec);

  // Relecture complète après décisions.
  const lp = await appel(patron, 'GET', 'owner_orders.php');
  const ec2 = [];
  for (const x of registre) {
    const o = lp.json?.orders?.find((v) => v.id === x.att.id);
    const e = o ? K.comparerVue(o, x.att, { proprietaire: true }) : ['absente de la liste du patron'];
    if (e.length) ec2.push(`#${x.att.id} : ${e.join(' ; ')}`);
  }
  lot('décisions · relecture de la liste du patron : toutes les commandes (décidées ou non) = valeurs attendues', registre.length, ec2);
  const ec3 = [];
  await enParallele(choisies, 20, async (x) => {
    const st = await appel(x.client, 'GET', `order_status.php?id=${x.att.id}`);
    const e = st.status === 200 ? K.comparerVue(st.json?.order, x.att) : [`statut ${st.status}`];
    if (e.length) ec3.push(`#${x.att.id} : ${e.join(' ; ')}`);
  });
  lot('décisions · vue du client après décision (statut, heure prévue, adresse, montants) = valeurs attendues', choisies.length, ec3);

  // Quelques cas de décision.
  const nouvelle = registre.find((x) => x.att.status === 'new' && x.mode === 'delivery');
  if (nouvelle) {
    const pr = await appel(patron, 'POST', 'owner_order_decide.php', { id: nouvelle.att.id, action: 'ready' });
    egal('décisions · « prête » avant l\'acceptation : 409 already_decided', [pr.status, pr.json?.error], [409, 'already_decided']);
    const a1 = await appel(patron, 'POST', 'owner_order_decide.php', { id: nouvelle.att.id, action: 'accept', delay_minutes: 30 });
    const a2 = await appel(patron, 'POST', 'owner_order_decide.php', { id: nouvelle.att.id, action: 'accept', delay_minutes: 30 });
    const a3 = await appel(patron, 'POST', 'owner_order_decide.php', { id: nouvelle.att.id, action: 'accept', delay_minutes: 60 });
    const a4 = await appel(patron, 'POST', 'owner_order_decide.php', { id: nouvelle.att.id, action: 'refuse' });
    egal('décisions · accepter deux fois pareil : replayed ; autre délai ou refus après acceptation : 409', [a1.status, a2.json?.replayed, a3.status, a4.status], [200, true, 409, 409]);
    Object.assign(nouvelle.att, { status: 'accepted', delay_minutes: 30, accepted_at: K.utcAt(epochActuel), ready_at: K.utcAt(epochActuel + 1800) });
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// 9 bis. Fin du verrou après 10 minutes (voyage dans le temps du serveur)
async function partie9bis() {
  section('9 bis. Après 10 minutes, le client verrouillé peut de nouveau commander');
  if (!clientLimite) return;
  const rL = rng(9011);
  const Z = K.ZONES[clientLimite.adresse.city];
  const specs = chercher({ mode: 'delivery', zone: Z, rng: rL, maxPizzas: 0, maxProduits: 6 }, [Z.min]).specs;
  const avant = await commander(clientLimite, { specs, enregistrer: false, rejeu: true });
  egal('verrou · à l\'instant de la fenêtre : encore 429', [avant.rep.status, avant.rep.json?.retry_after_seconds], [429, 600]);
  epochActuel += 300;
  site.fixerHeure(epochActuel);
  const mi = await commander(clientLimite, { specs, enregistrer: false, rejeu: true });
  egal('verrou · 5 minutes plus tard : encore 429, attente restante 300 s', [mi.rep.status, mi.rep.json?.retry_after_seconds], [429, 300]);
  epochActuel += 301;
  site.fixerHeure(epochActuel);
  clientLimite.tentatives = 0;
  const apres = await commander(clientLimite, { specs, moyens: ['ticket'] });
  verifierCreation('verrou · 10 minutes et 1 seconde plus tard : la commande est acceptée (nouvelle fenêtre, heure du serveur à jour)', apres);
  const lp = await appel(patron, 'GET', 'owner_orders.php');
  const o = lp.json?.orders?.find((v) => v.id === apres.att.id);
  egal('verrou · la vue du patron donne l\'heure de la nouvelle commande', o?.created_at, K.utcAt(epochActuel));
}

// ---------------------------------------------------------------------------------------------------------------------
// 10. Prix impairs (catalogue d'essai)
async function partie10(catalogueReel) {
  section('10. Prix impairs : arrondi de la promotion livraison par paire, minimum au centime (catalogue d\'essai, deuxième serveur)');
  const rI = rng(1010);
  const carteI = K.carteImpaire(rI, catalogueReel);
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'subito-02-'));
  const fichier = path.join(dossier, 'catalogue-impair.json');
  fs.writeFileSync(fichier, JSON.stringify(K.catalogueServeurDepuis(carteI, catalogueReel)));
  try {
    site.arreter();
    registre = [];
    carte = carteI;
    epochActuel = EPOCH0;
    site = await demarrerSite({ horloge: epochActuel, env: { SUBITO_CATALOGUE_PATH: fichier } });
    sites.push(site);
    patron = await connecterPatron();
    const impairs = Object.values(carteI.pizzas).flatMap((p) => Object.values(p.prix)).filter((v) => v % 2 === 1).length;
    controle('catalogue d\'essai : prix de pizzas impairs en nombre', impairs > 40, `${impairs} prix impairs sur ${29 * 4}`);

    const clients = await nouveauxClients(16, 1001, 'impair');
    const Hen = K.ZONES['Hénin-Beaumont'];
    const hen = clients.filter((c) => c.ville === 'Hénin-Beaumont');
    // Le catalogue d'essai est bien celui que lit le serveur : l'ancien prix est refusé.
    const [h0] = hen;
    const ancien = await commander(h0, { specs: [{ type: 'pizza', nom: 'Régina', taille: 'Solo' }], modifier: (b) => { b.items[0].unit_price_cents = 1100; }, enregistrer: false });
    egal('le serveur lit le catalogue d\'essai : le prix de la carte réelle (1100) est refusé en 422 price_mismatch_line (prix attendu : ' + carteI.pizzas['Régina'].prix.Solo + ')',
      [ancien.rep.status, ancien.rep.json?.error, ancien.rep.json?.expected_unit_cents], [carteI.pizzas['Régina'].prix.Solo === 1100 ? 201 : 422, carteI.pizzas['Régina'].prix.Solo === 1100 ? undefined : 'price_mismatch_line', carteI.pizzas['Régina'].prix.Solo]);

    // A. Promotion livraison : 2 à 6 pizzas de prix impairs, livraison et à emporter.
    const noms = Object.keys(carteI.pizzas);
    let nbPairesImpaires = 0;
    let nbPaniers = 0;
    let nbDifferent = 0;
    const clientsPromo = clients.slice();
    for (const n of [2, 3, 4, 5, 6]) {
      for (let essai = 0; essai < 5; essai++) {
        const specs = Array.from({ length: n }, () => ({ type: 'pizza', nom: rI.choix(noms), taille: rI.choix(K.TAILLES) }));
        const c = choisirClient(clientsPromo.filter((x) => x.ville === 'Hénin-Beaumont' || true).slice(0, 16));
        // Hénin-Beaumont : minimum 1000, toujours atteint avec au moins 2 pizzas.
        if (c.adresse.city !== 'Hénin-Beaumont') await changerAdresse(c, `${c.num} rue du Centre`, 'Hénin-Beaumont');
        const liv = await commander(c, { specs, moyens: ['card'] });
        const calc = liv.calc;
        nbPaniers++;
        const impaire = calc.paires.some(([, moins]) => moins % 2 === 1);
        if (impaire) nbPairesImpaires++;
        // formule fausse « arrondi sur la somme des moins chères » : sert à vérifier que le test discrimine
        const somme = calc.paires.reduce((s, p) => s + p[1], 0);
        if (Math.ceil(somme / 2) !== calc.remise) nbDifferent++;
        verifierCreation(`prix impairs · ${n} pizzas en livraison (${calc.paires.map((p) => p[1]).join('+')} → promotion ${calc.remise}, total ${calc.total})`, liv);
        const emp = await commander(c, { mode: 'pickup', specs });
        egal(`prix impairs · mêmes ${n} pizzas à emporter : la moins chère de chaque paire offerte (promotion ${emp.calc.remise})`,
          [emp.rep.status, emp.rep.json?.order?.promo_cents, emp.rep.json?.order?.total_cents], [201, emp.calc.remise, emp.calc.total]);
      }
    }
    controle('prix impairs · le test exerce l\'arrondi : au moins 15 des 25 paniers ont une pizza « moins chère de la paire » de prix impair', nbPairesImpaires >= 15, `${nbPairesImpaires}/${nbPaniers}`);
    controle('prix impairs · l\'arrondi par paire change le résultat par rapport à un arrondi sur la somme (le test discrimine)', nbDifferent >= 3, `${nbDifferent}/${nbPaniers} paniers`);
    metriques.prixImpairs = { paniers: nbPaniers, avecPaireImpaire: nbPairesImpaires, arrondiSurSommeDifferent: nbDifferent };

    // B. Minimum au centime près, dans les 8 zones.
    for (const ville of K.VILLES) {
      const Z = K.ZONES[ville];
      const c = clients.find((x) => x.ville === ville && x.tentatives < 10) ?? clients.find((x) => x.ville === ville);
      const sans = { mode: 'delivery', zone: Z, rng: rI, maxPizzas: 0, maxProduits: 6 };
      const moins = chercher(sans, [Z.min - 1]);
      const r1 = await commander(c, { specs: moins.specs, enregistrer: false });
      egal(`${ville} · sans pizza à ${Z.min - 1} (1 centime sous le minimum ${Z.min}) : 422, montants du serveur`,
        [r1.rep.status, r1.rep.json?.error, r1.rep.json?.minimum_cents, r1.rep.json?.products_after_promo_cents], [422, 'minimum_not_reached', Z.min, Z.min - 1]);
      const r2 = await commander(c, { specs: chercher(sans, [Z.min]).specs });
      verifierCreation(`${ville} · sans pizza à ${Z.min} (minimum exact) : acceptée, frais ${Z.frais}`, r2);
      const r3 = await commander(c, { specs: chercher(sans, [Z.min + 1]).specs });
      verifierCreation(`${ville} · sans pizza à ${Z.min + 1} (1 centime au-dessus) : acceptée, frais ${Z.frais}`, r3);
      // avec pizzas : promotion arrondie, minimum après promotion, au centime
      const avec = { mode: 'delivery', zone: Z, rng: rI, minPizzas: 1, maxPizzas: 3, maxProduits: 3, maxClasses: 14 };
      for (const cible of [Z.min - 1, Z.min, Z.min + 1]) {
        const p = chercher(avec, [cible]);
        if (!p) { controle(`${ville} · avec pizza à ${cible} après promotion : panier introuvable dans le catalogue d'essai`, false, 'aucun panier'); continue; }
        const r = await commander(c, { specs: p.specs, enregistrer: cible >= Z.min });
        if (cible < Z.min) {
          egal(`${ville} · avec pizza(s) : ${cible} après promotion (1 centime sous le minimum) : 422, montant du serveur`,
            [r.rep.status, r.rep.json?.error, r.rep.json?.minimum_cents, r.rep.json?.products_after_promo_cents], [422, 'minimum_not_reached', Z.min, cible]);
        } else {
          verifierCreation(`${ville} · avec pizza(s) : ${cible} après promotion (${r.calc.paires.length} paire(s), promotion ${r.calc.remise}), aucun frais`, r);
        }
      }
    }

    // C. Panier maximal : 60 pizzas de prix impairs.
    const c60 = choisirClient(clients.filter((x) => x.tentatives < 10));
    if (c60.adresse.city !== 'Hénin-Beaumont') await changerAdresse(c60, `${c60.num} rue du Centre`, 'Hénin-Beaumont');
    const specs60 = [0, 1, 2].map((i) => ({ type: 'pizza', nom: noms[(i * 11 + 5) % noms.length], taille: K.TAILLES[i], qty: 20 }));
    const r60 = await commander(c60, { specs: specs60, moyens: ['ticket_card'] });
    verifierCreation(`prix impairs · panier de 60 pizzas (30 paires, promotion ${r60.calc.remise}) en livraison`, r60);

    await partie7(' (catalogue à prix impairs)');
  } finally {
    try { fs.rmSync(dossier, { recursive: true, force: true }); } catch { /* ignoré */ }
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// 11. Contrôles transverses
function partie11() {
  section('11. Contrôles transverses sur toutes les réponses');
  const toutes = reponses.filter((r) => !ignorees.has(r));
  const n5xx = toutes.filter((r) => r.status >= 500);
  controle(`aucune erreur 500 sur ${toutes.length} réponses du serveur`, n5xx.length === 0, n5xx.slice(0, 3).map((r) => `${r.method} ${r.route} ${r.status}`));
  const hors = toutes.filter((r) => r.json === null);
  controle('toutes les réponses sont du JSON', hors.length === 0, hors.slice(0, 3).map((r) => `${r.method} ${r.route} ${r.status}`));
  const mal = toutes.filter((r) => r.json && (r.status >= 400) && !(r.json.ok === false && typeof r.json.error === 'string' && typeof r.json.message === 'string'));
  controle('toute erreur a la forme { ok:false, error, message }', mal.length === 0, mal.slice(0, 3).map((r) => `${r.route} ${r.status}`));
  const entetes = toutes.filter((r) => r.status > 0 && (r.headers.get('cache-control') !== 'no-store' || r.headers.get('x-content-type-options') !== 'nosniff'));
  controle('toutes les réponses : Cache-Control no-store et X-Content-Type-Options nosniff', entetes.length === 0, entetes.slice(0, 3).map((r) => `${r.route} ${r.status}`));
  const histo = {};
  for (const r of toutes) histo[r.status] = (histo[r.status] || 0) + 1;
  metriques.statuts = histo;
  metriques.requetesTotal = toutes.length;
  console.log('  >> statuts des réponses : ' + JSON.stringify(histo));
  for (const s of sites) {
    const j = s.journal();
    const lignes = j.split('\n').filter(Boolean);
    const inattendues = lignes.filter((l) => !/ (order_create\.php 429 too_many_attempts)$/.test(l.trim()) && !/\b(customer_update_address|customer_signup)\.php 500 server_error\b/.test(l));
    controle('journal du serveur : uniquement les refus 429 attendus (aucune autre erreur)', inattendues.length === 0, inattendues.slice(0, 3));
    const pii = lignes.filter((l) => /@example\.test|rue des Tests|\b0[67][ .]?\d{2}|Client\d+/i.test(l));
    controle('journal du serveur : aucune donnée personnelle (e-mail, téléphone, adresse, nom)', pii.length === 0, pii.slice(0, 2));
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Déroulement
console.log(`Batterie 02 — livraison · horloge du serveur figée à ${K.utcAt(EPOCH0)} · jour de service ${K.jourService(EPOCH0)}`);
const catalogueReel = K.lireCatalogueFichier();
let code = 1;
try {
  site = await demarrerSite({ horloge: epochActuel });
  sites.push(site);
  carte = K.carteEnDur(catalogueReel);
  await phase('0 barème et comptes', partie0);
  if (clientsRafale.length === 100) {
    if (actif(1)) await phase('1 zones', partie1);
    if (actif(2)) await phase('2 frais et promotion', partie2);
    if (actif(3)) await phase('3 paiements', partie3);
    if (actif(4)) await phase('4 adresse, téléphone, profil', partie4);
    if (actif(5)) await phase('5 changement d\'adresse', partie5);
    if (actif(6)) await phase('6 rafale de 100 clients', partie6);
    if (actif(9)) await phase('9 limites et concurrence', partie9);
    if (actif(7)) await phase('7 vues', partie7);
    if (actif(8)) await phase('8 décisions du patron', partie8);
    if (actif(9)) await phase('9 bis fin du verrou', partie9bis);
    if (actif(10)) await phase('10 prix impairs', () => partie10(catalogueReel));
  }
  await phase('11 transverses', partie11);
  metriques.dureeScriptS = Math.round((Date.now() - bilan.debut) / 1000);
  metriques.latenceCreationMs = { p50: Math.round(percentile(latencesCreation, 50)), p95: Math.round(percentile(latencesCreation, 95)), max: Math.round(Math.max(0, ...latencesCreation)), n: latencesCreation.length };
  console.log('\nMETRIQUES ' + JSON.stringify(metriques));
  if (defauts.length) console.log('DEFAUTS ' + JSON.stringify(defauts));
  const r = resume();
  code = r.echoues === 0 ? 0 : 1;
} catch (e) {
  controle('exécution de la batterie', false, e && e.stack ? e.stack.split('\n').slice(0, 6).join(' / ') : String(e));
  resume();
  code = 1;
} finally {
  for (const s of sites) { try { s.arreter(); } catch { /* ignoré */ } }
}
process.exit(code);
