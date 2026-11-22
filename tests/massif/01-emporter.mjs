// Batterie 01 — COMMANDES À EMPORTER DE TOUS TYPES (API, rafale).
//   node tests/massif/lancer.mjs tests/massif/01-emporter.mjs --timeout=480
//
// 100 clients, une rafale de 50 requêtes simultanées (plus de 300 commandes à emporter : 31 pizzas x 4 tailles, 26 produits hors pizza,
// suppléments, retraits, moitié-moitié, garnitures, remarques, quantités 1 à 20, 40 lignes, 60 articles, promotion avec 2 à 6 pizzas…).
// Pour CHAQUE commande acceptée, 4 vues sont comparées entre elles ET au calcul indépendant de lib/01-modele.mjs (qui n'importe rien du
// serveur) : réponse de order_create, order_status (client), customer_orders (client), owner_orders (patron). Puis la base est relue
// (site.db) quand plus aucune requête n'est en cours. Suivent : doublons envoyés en rafale, envois simultanés d'un même client,
// refus attendus aux limites, cloisonnement des vues.
import { performance } from 'node:perf_hooks';
import { isDeepStrictEqual } from 'node:util';
import { demarrerSite, viderReponses } from './lib/env.mjs';
import { creerClients, patronConnecte, enParallele, ClientIP, ipFictive } from './lib/clients.mjs';
import {
  TAILLES, PIZZAS, PRODUITS, pizza, produit, ligne, commande, rng, jourParis, remiseAEmporter, remiseDirecte, prixLigne,
  ecart, stats, points, exactement
} from './lib/01-modele.mjs';
import { construireScenarios } from './lib/01-scenarios.mjs';

const DEBUT = Date.now();
const controles = [];
const metriques = [];

function section(titre) { console.log(`\n=== ${titre} ===`); }
function info(texte) { console.log(`INFO  ${texte}`); }
function ctl(nom, ok, observe = '') {
  controles.push({ nom, ok: Boolean(ok), observe });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${String(controles.length).padStart(3, '0')}  ${nom}${observe === '' ? '' : ' — ' + observe}`);
  return Boolean(ok);
}
const exemples = (liste, n = 4) => liste.slice(0, n).join(' | ') + (liste.length > n ? ` | … (+${liste.length - n})` : '');
const mesure = (texte) => { metriques.push(texte); info('mesure : ' + texte); };
const ms = (x) => Math.round(x);

// Délai global : si quelque chose se bloque, le script échoue au lieu de pendre jusqu'à l'arrêt du lanceur.
setTimeout(() => { console.log('FAIL  délai global de 450 s dépassé'); process.exit(1); }, 450_000).unref();

// hot_sauce (SBT-009) : toujours présente (null hors livraison), même à l'emporter.
const CLES_VUE = ['id', 'status', 'mode', 'customer_name', 'delivery_address', 'payment_methods', 'cash_change_for', 'hot_sauce', 'items', 'products_cents',
  'promo_cents', 'delivery_fee_cents', 'total_cents', 'created_at', 'accepted_at', 'refused_at', 'prepared_at', 'delay_minutes', 'ready_at', 'service_day', 'scheduled_for'];
const CLES_PATRON = ['customer_id', 'customer_phone', 'customer_email'];
// category (SBT-006) : catégorie du catalogue au moment de la commande, ajoutée pour organiser le ticket.
const CLES_LIGNE = ['name', 'variant', 'qty', 'unit_price_cents', 'line_total_cents', 'removed', 'extras', 'half', 'note', 'category'];
const triees = (t) => [...t].sort();

// ------------------------------------------------------------------------------------------------------------------ 0. modèle
function autoControleModele() {
  section('0. Auto-contrôle du modèle indépendant (aucune requête)');
  const dores = [
    [[1100, 1600], 1100], [[1100, 1600, 3300], 1600], [[3300, 2300, 1600, 1100], 3400],
    [[3300, 2300, 2300, 1600, 1100], 3900], [[3300, 3300, 2300, 1600, 1100, 1100], 6000], [[900], 0], [[], 0]
  ];
  const faux = dores.filter(([p, v]) => remiseAEmporter(p) !== v || remiseDirecte(p) !== v);
  ctl('modèle : promotion à emporter = valeurs calculées à la main (0 à 6 pizzas)', faux.length === 0, `${dores.length - faux.length}/${dores.length} cas`);
  const r = rng(7);
  let diff = 0;
  for (let i = 0; i < 5000; i++) {
    const prix = Array.from({ length: r.entier(0, 60) }, () => r.choix([900, 1100, 1250, 1300, 1550, 1600, 1750, 2300, 3300]));
    if (remiseAEmporter(prix) !== remiseDirecte(prix)) diff++;
  }
  ctl('modèle : les deux formulations de la promotion concordent (5000 paniers de 0 à 60 pizzas)', diff === 0, `écarts : ${diff}`);
  const regina = pizza('Régina');
  const cas = [
    // exemples faits à la main : 11,00 + 0 + 0 + 1,50 + 1,00 ; groupe différent = payant ; moitié-moitié ; 3 suppléments XXL
    [prixLigne(regina, 'Solo', { retraits: ['jambon', 'champignons'], supplements: ['poulet', 'oignons', 'thon', 'olives'] }).unit, 1350],
    [prixLigne(regina, 'Solo', { retraits: ['champignons'], supplements: ['jambon*'] }).unit, 1250],
    [prixLigne(regina, 'Duo', { retraits: ['brie'], supplements: ['bleu'], autre: pizza('4 Fromages') }).unit, 1600],
    [prixLigne(pizza('Végétarienne'), 'XXL', { supplements: ['olives', 'jambon', 'miel'] }).unit, 3300 + 350 + 400 + 350],
    [prixLigne(pizza('Marguerita (base)'), 'Duo').unit, 1300]
  ];
  const mauvais = cas.filter(([a, b]) => a !== b);
  ctl('modèle : prix d\'une ligne (retraits, groupes, moitié-moitié) = valeurs calculées à la main', mauvais.length === 0, `${cas.length - mauvais.length}/${cas.length} cas`);
}

// ------------------------------------------------------------------------------------------------------------------ vues
function nomClient(c) { return `Client${c.num} Massif`; }

/** Compare UNE vue d'une commande au résultat attendu. Renvoie les écarts par catégorie. */
function analyserVue(vue, o, { proprietaire, jours }) {
  const a = o.sc.attendu;
  const pb = { lignes: [], totaux: [], statut: [], adressePaiement: [], horodatage: [], identite: [] };
  if (vue === null || typeof vue !== 'object') { for (const k of Object.keys(pb)) pb[k].push('vue absente'); return pb; }
  // category (SBT-006) : catégorie du catalogue au moment de la commande, hors du périmètre de cette comparaison
  // (jamais fournie par le calcul indépendant de cette batterie) -> retirée avant de chercher un écart.
  const itemsSansCategorie = Array.isArray(vue.items) ? vue.items.map(({ category, ...reste }) => reste) : vue.items;
  const e = ecart(a.items, itemsSansCategorie, 'items');
  if (e) pb.lignes.push(e);
  if (Array.isArray(vue.items)) {
    vue.items.forEach((it, i) => { if (!isDeepStrictEqual(triees(Object.keys(it)), triees(CLES_LIGNE))) pb.lignes.push(`items[${i}] clés ${Object.keys(it)}`); });
  }
  for (const k of ['products_cents', 'promo_cents', 'delivery_fee_cents', 'total_cents']) {
    if (vue[k] !== a[k]) pb.totaux.push(`${k} attendu ${a[k]} ≠ observé ${vue[k]}`);
  }
  if (vue.status !== 'new') pb.statut.push(`status ${vue.status}`);
  for (const k of ['accepted_at', 'refused_at', 'prepared_at', 'delay_minutes', 'ready_at']) if (vue[k] !== null) pb.statut.push(`${k} ${JSON.stringify(vue[k])}`);
  if (vue.mode !== 'pickup') pb.adressePaiement.push(`mode ${vue.mode}`);
  if (vue.delivery_address !== null) pb.adressePaiement.push(`delivery_address ${JSON.stringify(vue.delivery_address)}`);
  if (!isDeepStrictEqual(vue.payment_methods, [])) pb.adressePaiement.push(`payment_methods ${JSON.stringify(vue.payment_methods)}`);
  if (vue.cash_change_for !== null) pb.adressePaiement.push(`cash_change_for ${JSON.stringify(vue.cash_change_for)}`);
  if (!jours.includes(vue.service_day)) pb.horodatage.push(`service_day ${vue.service_day} (attendu ${jours.join(' ou ')})`);
  const t = typeof vue.created_at === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(vue.created_at) ? Date.parse(vue.created_at) : NaN;
  if (!(t >= DEBUT - 3000 && t <= Date.now() + 3000)) pb.horodatage.push(`created_at ${vue.created_at}`);
  if (vue.id !== o.id) pb.identite.push(`id ${vue.id} ≠ ${o.id}`);
  if (vue.customer_name !== nomClient(o.client)) pb.identite.push(`customer_name ${vue.customer_name}`);
  const attenduCles = proprietaire ? [...CLES_VUE, ...CLES_PATRON] : CLES_VUE;
  if (!isDeepStrictEqual(triees(Object.keys(vue)), triees(attenduCles))) pb.identite.push(`clés ${triees(Object.keys(vue)).join(',')}`);
  if (proprietaire) {
    if (vue.customer_id !== o.client.customer.id) pb.identite.push(`customer_id ${vue.customer_id}`);
    if (vue.customer_email !== o.client.email) pb.identite.push(`customer_email ${vue.customer_email}`);
    if (vue.customer_phone !== o.client.customer.phone) pb.identite.push(`customer_phone ${vue.customer_phone}`);
  }
  return pb;
}

const LIBELLES = {
  lignes: 'lignes identiques au calcul indépendant (noms canoniques, quantités, prix, suppléments, retraits, moitiés, remarque)',
  totaux: 'totaux et promotion = calcul indépendant',
  statut: 'statut « new », aucune date de décision, ni délai, ni heure prévue',
  adressePaiement: 'à emporter : adresse null, paiement vide, billet null',
  horodatage: 'service_day = jour parisien, created_at valide',
  identite: 'identité du client, jeu de clés (rien de sensible côté client)'
};

function bilanVue(nomVue, liste, pbs) {
  for (const cat of Object.keys(LIBELLES)) {
    const mauvais = pbs.map((pb, i) => ({ pb, i })).filter((x) => x.pb[cat].length);
    ctl(`[${nomVue}] ${LIBELLES[cat]}`, mauvais.length === 0,
      mauvais.length === 0 ? `${liste.length}/${liste.length} commandes` : `${mauvais.length}/${liste.length} écarts : ${exemples(mauvais.map((m) => `#${liste[m.i].id} ${liste[m.i].sc.id} → ${m.pb[cat][0]}`))}`);
  }
}

/** Les 4 vues d'une liste de commandes acceptées, comparées entre elles et au calcul indépendant. */
async function verifierQuatreVues(liste, patron, etiquette, toutes = liste) {
  const jours = [...new Set([jourParis(new Date(DEBUT)), jourParis()])];
  const t0 = performance.now();
  const reponsesStatut = await enParallele(liste, 40, async (o) => {
    const t = performance.now();
    const rep = await o.client.get('order_status.php?id=' + o.id).catch((e) => ({ status: 0, json: null, text: String(e) }));
    return { rep, ms: performance.now() - t };
  });
  const msStatut = performance.now() - t0;
  const clientsDistincts = [...new Set(liste.map((o) => o.client))];
  const t1 = performance.now();
  const reponsesListe = await enParallele(clientsDistincts, 25, async (c) => ({ c, rep: await c.get('customer_orders.php').catch((e) => ({ status: 0, json: null, text: String(e) })) }));
  const msListe = performance.now() - t1;
  const t2 = performance.now();
  const repPatron = await patron.get('owner_orders.php').catch((e) => ({ status: 0, json: null, text: String(e) }));
  const msPatron = performance.now() - t2;
  mesure(`${etiquette} : order_status ${liste.length} requêtes en ${ms(msStatut)} ms (moyenne ${ms(msStatut / liste.length)} ms/requête, 40 en parallèle) ; customer_orders ${clientsDistincts.length} clients en ${ms(msListe)} ms ; owner_orders 1 requête en ${ms(msPatron)} ms (${(repPatron.text.length / 1024).toFixed(0)} Ko)`);

  const parClient = new Map(reponsesListe.map((x) => [x.c, x.rep]));
  const dansPatron = new Map(((repPatron.json && repPatron.json.orders) || []).map((v) => [v.id, v]));
  const vues = { creation: [], statut: [], liste: [], patron: [] };
  const horsService = [];
  liste.forEach((o, i) => {
    const rs = reponsesStatut[i].rep;
    if (rs.status !== 200) horsService.push(`#${o.id} order_status ${rs.status}`);
    vues.creation.push(o.creation);
    vues.statut.push(rs.json ? rs.json.order : null);
    const rl = parClient.get(o.client);
    vues.liste.push(rl && rl.json && Array.isArray(rl.json.orders) ? rl.json.orders.find((v) => v.id === o.id) ?? null : null);
    vues.patron.push(dansPatron.get(o.id) ?? null);
  });
  ctl(`[${etiquette}] order_status répond 200 pour chaque commande de son client, customer_orders et owner_orders répondent 200`,
    horsService.length === 0 && reponsesListe.every((x) => x.rep.status === 200) && repPatron.status === 200,
    `statuts ${horsService.length} anomalies, listes ${reponsesListe.filter((x) => x.rep.status !== 200).length} anomalies, patron ${repPatron.status} ; ${exemples(horsService)}`);

  bilanVue(`${etiquette} · création`, liste, liste.map((o, i) => analyserVue(vues.creation[i], o, { proprietaire: false, jours })));
  bilanVue(`${etiquette} · order_status`, liste, liste.map((o, i) => analyserVue(vues.statut[i], o, { proprietaire: false, jours })));
  bilanVue(`${etiquette} · customer_orders`, liste, liste.map((o, i) => analyserVue(vues.liste[i], o, { proprietaire: false, jours })));
  bilanVue(`${etiquette} · owner_orders (patron)`, liste, liste.map((o, i) => analyserVue(vues.patron[i], o, { proprietaire: true, jours })));

  // Les 4 vues sont identiques entre elles (le patron voit en plus les coordonnées du client).
  const sansPatron = (v) => (v ? Object.fromEntries(Object.entries(v).filter(([k]) => !CLES_PATRON.includes(k))) : v);
  const croises = [];
  liste.forEach((o, i) => {
    for (const [nom, v] of [['order_status', vues.statut[i]], ['customer_orders', vues.liste[i]], ['owner_orders', sansPatron(vues.patron[i])]]) {
      const e = ecart(vues.creation[i], v);
      if (e) croises.push(`#${o.id} création ≠ ${nom} : ${e}`);
    }
  });
  ctl(`[${etiquette}] les 4 vues concordent entre elles, champ par champ`, croises.length === 0, croises.length === 0 ? `${liste.length}/${liste.length} commandes x 3 comparaisons` : `${croises.length} écarts : ${exemples(croises)}`);

  // Contenu des listes : exactement les commandes de chaque client (toutes phases confondues), bon ordre, rien d'autre.
  const pbListes = [];
  for (const c of clientsDistincts) {
    const rep = parClient.get(c);
    const recu = rep && rep.json && Array.isArray(rep.json.orders) ? rep.json.orders : [];
    const idsRecus = recu.map((v) => v.id);
    const attendu = toutes.filter((o) => o.client === c)
      .sort((x, y) => (x.creation.created_at < y.creation.created_at ? 1 : x.creation.created_at > y.creation.created_at ? -1 : y.id - x.id)).map((o) => o.id);
    if (!isDeepStrictEqual(idsRecus, attendu)) pbListes.push(`client ${c.num} : reçu ${idsRecus.join(',')} ≠ attendu ${attendu.join(',')}`);
  }
  ctl(`[${etiquette}] customer_orders : exactement les commandes du client (aucune d'un autre), de la plus récente à la plus ancienne`, pbListes.length === 0,
    pbListes.length === 0 ? `${clientsDistincts.length} clients, ${clientsDistincts.reduce((s, c) => s + toutes.filter((o) => o.client === c).length, 0)} commandes` : exemples(pbListes));

  const lesPatron = (repPatron.json && repPatron.json.orders) || [];
  const idsPatron = lesPatron.map((v) => v.id);
  const attendusIds = new Set(toutes.map((o) => o.id));
  const manquants = [...attendusIds].filter((id) => !dansPatron.has(id));
  const enTrop = idsPatron.filter((id) => !attendusIds.has(id));
  const tri = lesPatron.every((v, i, t) => i === 0 || t[i - 1].created_at < v.created_at || (t[i - 1].created_at === v.created_at && t[i - 1].id < v.id));
  ctl(`[${etiquette}] owner_orders : toutes les commandes (aucune en trop ni en double), de la plus ancienne à la plus récente`,
    manquants.length === 0 && enTrop.length === 0 && tri && new Set(idsPatron).size === idsPatron.length && typeof repPatron.json.server_now === 'string',
    `${idsPatron.length} reçues pour ${attendusIds.size} attendues, ${manquants.length} manquantes, ${enTrop.length} en trop, tri ${tri ? 'correct' : 'FAUX'}, doublons ${idsPatron.length - new Set(idsPatron).size}`);
  return { idsPatron, vues };
}

// ------------------------------------------------------------------------------------------------------------------ base
function verifierBase(db, liste, etiquette) {
  const lignesOrders = db.prepare('SELECT * FROM orders ORDER BY id').all();
  const lignesItems = db.prepare('SELECT * FROM order_items ORDER BY order_id, position').all();
  const jours = [...new Set([jourParis(new Date(DEBUT)), jourParis()])];
  const parId = new Map(lignesOrders.map((l) => [Number(l.id), l]));
  const attendus = new Map(liste.map((o) => [o.id, o]));

  ctl(`[${etiquette}] base : une ligne orders par commande acceptée (ni plus, ni moins)`, lignesOrders.length === liste.length && parId.size === lignesOrders.length,
    `${lignesOrders.length} lignes orders pour ${liste.length} commandes acceptées`);
  const inconnues = lignesOrders.filter((l) => !attendus.has(Number(l.id))).map((l) => `#${l.id}`);
  const absentes = liste.filter((o) => !parId.has(o.id)).map((o) => `#${o.id}`);
  ctl(`[${etiquette}] base : aucune commande en trop, aucune absente`, inconnues.length === 0 && absentes.length === 0, `en trop ${inconnues.length}, absentes ${absentes.length} ${exemples([...inconnues, ...absentes])}`);

  const nbLignesEnvoyees = liste.reduce((s, o) => s + o.sc.corps.items.length, 0);
  ctl(`[${etiquette}] base : autant de lignes order_items que de lignes envoyées`, lignesItems.length === nbLignesEnvoyees, `${lignesItems.length} lignes pour ${nbLignesEnvoyees} envoyées`);
  const itemsParCommande = new Map();
  for (const it of lignesItems) { const k = Number(it.order_id); if (!itemsParCommande.has(k)) itemsParCommande.set(k, []); itemsParCommande.get(k).push(it); }
  const mauvaisNb = [];
  for (const o of liste) {
    const its = itemsParCommande.get(o.id) || [];
    const positions = its.map((x) => Number(x.position));
    if (its.length !== o.sc.corps.items.length || !isDeepStrictEqual(positions, positions.map((_, i) => i))) mauvaisNb.push(`#${o.id} ${o.sc.id} : ${its.length} lignes (positions ${positions.slice(0, 5)}…) pour ${o.sc.corps.items.length}`);
  }
  ctl(`[${etiquette}] base : chaque commande a exactement ses lignes, positions 0..n-1 sans trou ni doublon`, mauvaisNb.length === 0, mauvaisNb.length === 0 ? `${liste.length} commandes` : exemples(mauvaisNb));

  const cles = new Map();
  let doublonsCle = 0;
  for (const l of lignesOrders) { const k = `${l.customer_id}/${l.idempotency_key}`; if (cles.has(k)) doublonsCle++; cles.set(k, true); }
  const orphelines = lignesItems.filter((it) => !parId.has(Number(it.order_id))).length;
  ctl(`[${etiquette}] base : aucun doublon (client + clé d'envoi) et aucune ligne orpheline`, doublonsCle === 0 && orphelines === 0, `doublons ${doublonsCle}, orphelines ${orphelines}`);

  const pbOrders = [];
  for (const o of liste) {
    const l = parId.get(o.id);
    if (!l) continue;
    const a = o.sc.attendu;
    const verif = {
      customer_id: o.client.customer.id, idempotency_key: o.sc.corps.idempotency_key, status: 'new', mode: 'pickup', customer_first_name: `Client${o.client.num}`,
      customer_last_name: 'Massif', customer_phone: o.client.customer.phone, customer_email: o.client.email, delivery_street: null, delivery_city: null,
      payment_methods: '[]', cash_change_for: null, products_cents: a.products_cents, promo_cents: a.promo_cents, delivery_fee_cents: 0, total_cents: a.total_cents,
      delay_minutes: null, accepted_at: null, refused_at: null, prepared_at: null, created_at: o.creation.created_at
    };
    for (const [k, v] of Object.entries(verif)) if (l[k] !== v) pbOrders.push(`#${o.id} ${k} : attendu ${JSON.stringify(v)} ≠ base ${JSON.stringify(l[k])}`);
    if (!jours.includes(String(l.service_day))) pbOrders.push(`#${o.id} service_day ${l.service_day}`);
    if (!/^[0-9a-f]{64}$/.test(String(l.payload_hash))) pbOrders.push(`#${o.id} payload_hash ${l.payload_hash}`);
  }
  ctl(`[${etiquette}] base : colonnes de orders = calcul indépendant (client, statut, totaux, promotion, paiement vide, adresse nulle, jour)`, pbOrders.length === 0,
    pbOrders.length === 0 ? `${liste.length} commandes` : `${pbOrders.length} écarts : ${exemples(pbOrders)}`);

  const pbItems = [];
  for (const o of liste) {
    const its = itemsParCommande.get(o.id) || [];
    o.sc.attendu.items.forEach((a, i) => {
      const it = its[i];
      if (!it) return;
      const lu = {
        name: String(it.name), variant: String(it.variant).trimEnd(), qty: Number(it.qty), unit_price_cents: Number(it.unit_price_cents), line_total_cents: Number(it.line_total_cents),
        removed: JSON.parse(it.removed_json), extras: JSON.parse(it.extras_json), half: it.half_json === null ? null : JSON.parse(it.half_json), note: String(it.note)
      };
      const e = ecart(a, lu, `#${o.id}[${i}]`);
      if (e) pbItems.push(e);
    });
  }
  ctl(`[${etiquette}] base : colonnes de order_items = lignes attendues (nom canonique, prix, suppléments, retraits, moitié, remarque)`, pbItems.length === 0,
    pbItems.length === 0 ? `${lignesItems.length} lignes` : `${pbItems.length} écarts : ${exemples(pbItems)}`);
  return { orders: lignesOrders.length, items: lignesItems.length };
}

// ------------------------------------------------------------------------------------------------------------------ couverture
function verifierCouverture(liste) {
  const lignes = liste.flatMap((o) => o.sc.attendu.items.map((it) => ({ it, o })));
  const baseNom = (n) => n.split(' — ')[0];
  const combos = new Set(lignes.filter((x) => x.it.variant !== '').map((x) => `${baseNom(x.it.name)}|${x.it.variant}`));
  const manquantsCombos = PIZZAS.flatMap((p) => TAILLES.map((t) => `${p.line_name}|${t}`)).filter((c) => !combos.has(c));
  ctl('couverture : chacune des 31 pizzas dans chacune des 4 tailles (124 combinaisons) au moins une fois, acceptée et vérifiée',
    manquantsCombos.length === 0, `${combos.size} combinaisons vues, manquantes : ${exemples(manquantsCombos)}`);
  const vus = new Set(lignes.filter((x) => x.it.variant === '').map((x) => x.it.name));
  const manquantsProduits = PRODUITS.map((p) => p.line_name).filter((n) => !vus.has(n));
  ctl('couverture : chacun des 26 produits hors pizza au moins une fois', manquantsProduits.length === 0, `${vus.size}/26 vus, manquants : ${exemples(manquantsProduits)}`);
  const qtes = new Set(lignes.map((x) => x.it.qty));
  const qManquantes = Array.from({ length: 20 }, (_, i) => i + 1).filter((q) => !qtes.has(q));
  ctl('couverture : toutes les quantités de 1 à 20', qManquantes.length === 0, `manquantes : ${qManquantes.join(',') || 'aucune'}`);
  const nbSupp = [1, 2, 3].map((n) => lignes.filter((x) => x.it.extras.length === n).length);
  const gratuits = lignes.filter((x) => x.it.extras.some((e) => e.price_cents === 0)).length;
  const gratuitsEtPayants = lignes.filter((x) => x.it.extras.some((e) => e.price_cents === 0) && x.it.extras.some((e) => e.price_cents > 0)).length;
  ctl('couverture : suppléments (1, 2 et 3 par ligne), dont rendus gratuits par un retrait du même groupe, seuls ou avec des payants', nbSupp.every((n) => n > 0) && gratuits > 0 && gratuitsEtPayants > 0,
    `lignes à 1/2/3 suppléments : ${nbSupp.join('/')} ; avec supplément gratuit : ${gratuits} ; gratuit + payant : ${gratuitsEtPayants}`);
  const retraits = lignes.filter((x) => x.it.removed.length > 0).length;
  const retraitsPizza = lignes.filter((x) => x.it.removed.length > 0 && x.it.variant !== '').length;
  ctl('couverture : retraits d\'ingrédients (pizzas et produits)', retraits > 0 && retraitsPizza > 0 && retraits > retraitsPizza, `${retraits} lignes avec retraits dont ${retraitsPizza} pizzas`);
  const moities = lignes.filter((x) => x.it.half !== null);
  const taillesMoitie = new Set(moities.map((x) => x.it.variant));
  ctl('couverture : moitié-moitié en Duo, Quatro et XXL', ['Duo', 'Quatro', 'XXL'].every((t) => taillesMoitie.has(t)), `${moities.length} lignes en moitié-moitié, tailles ${[...taillesMoitie].join('/')}`);
  const calz = new Set(lignes.filter((x) => x.it.name.startsWith('Calzone (soufflée) — ')).map((x) => x.it.name));
  const marg = new Set(lignes.filter((x) => x.it.name.startsWith('Marguerita (base)')).map((x) => x.it.name));
  ctl('couverture : garnitures à choix (5 garnitures de calzone, base Marguerita sans choix / sauce tomate / crème fraîche)', calz.size === 5 && marg.size === 3, `calzone ${calz.size}/5, marguerita ${marg.size}/3`);
  const notes = lignes.map((x) => x.it.note).filter((n) => n !== '');
  const typesNotes = {
    accents: notes.some((n) => /[éèàçôêîûœ]/.test(n)), apostrophes: notes.some((n) => /['’]/.test(n)), emoji: notes.some((n) => /\p{Extended_Pictographic}/u.test(n)),
    '300 caractères (ASCII)': notes.some((n) => points(n) === 300 && /^[\x20-\x7e]+$/.test(n)), '300 caractères (accents)': notes.some((n) => points(n) === 300 && /[éèàç]/.test(n) && !/\p{Extended_Pictographic}/u.test(n)),
    '300 caractères (emoji)': notes.some((n) => points(n) === 300 && /^\p{Extended_Pictographic}+$/u.test(n))
  };
  ctl('couverture : remarques avec accents, apostrophes, emoji et de exactement 300 caractères (ASCII, accents, emoji)', Object.values(typesNotes).every(Boolean), Object.entries(typesNotes).map(([k, v]) => `${k} ${v ? 'oui' : 'NON'}`).join(', '));
  const c40 = liste.filter((o) => o.sc.attendu.nbLignes === 40).length;
  const c60 = liste.filter((o) => o.sc.attendu.nbArticles === 60).length;
  const c4060 = liste.filter((o) => o.sc.attendu.nbLignes === 40 && o.sc.attendu.nbArticles === 60).length;
  ctl('couverture : limites hautes acceptées (40 lignes, 60 articles, les deux ensemble, ligne de 20)', c40 > 0 && c60 > 0 && c4060 > 0 && qtes.has(20), `commandes à 40 lignes : ${c40}, à 60 articles : ${c60}, les deux : ${c4060}`);
  const promoParN = {};
  for (const o of liste) {
    const n = o.sc.attendu.nbPizzas;
    if (n >= 2 && n <= 6 && o.sc.attendu.promo_cents > 0) {
      const prix = new Set(o.sc.attendu.items.filter((i) => i.variant !== '').map((i) => i.unit_price_cents));
      const tailles = new Set(o.sc.attendu.items.filter((i) => i.variant !== '').map((i) => i.variant));
      if (prix.size >= 2 && tailles.size >= 2) promoParN[n] = (promoParN[n] || 0) + 1;
    }
  }
  ctl('couverture : promotion « 1 pizza achetée = 1 offerte » avec 2, 3, 4, 5 et 6 pizzas de prix différents', [2, 3, 4, 5, 6].every((n) => promoParN[n] >= 5),
    `commandes par nombre de pizzas : ${[2, 3, 4, 5, 6].map((n) => `${n} → ${promoParN[n] || 0}`).join(', ')}`);
  return { combos: combos.size, produits: vus.size, lignes: lignes.length };
}

// ------------------------------------------------------------------------------------------------------------------ programme
async function principal() {
  autoControleModele();

  section('1. Scénarios, site, 100 clients');
  const scenarios = construireScenarios();
  const parFamille = {};
  for (const s of scenarios) parFamille[s.famille] = (parFamille[s.famille] || 0) + 1;
  info(`${scenarios.length} commandes préparées : ${Object.entries(parFamille).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  const tailleMax = Math.max(...scenarios.map((s) => Buffer.byteLength(JSON.stringify(s.corps))));
  ctl('plan : au moins 150 commandes à emporter préparées, corps tous sous la limite de 64 Ko', scenarios.length >= 150 && tailleMax <= 65536, `${scenarios.length} commandes, corps le plus gros ${tailleMax} octets (limite 65536)`);

  const site = await demarrerSite();
  try {
    const tClients = performance.now();
    const clients = await creerClients(100, { concurrence: 25 });
    mesure(`création de 100 comptes clients : ${ms(performance.now() - tClients)} ms`);
    ctl('100 clients créés (inscription 201, session ouverte)', clients.length === 100 && clients.every((c) => c.customer && c.customer.id > 0), `${clients.length} comptes, identifiants ${clients[0].customer.id}…${clients[99].customer.id}`);
    const patron = await patronConnecte();
    const hits = new Map();
    const compter = (c, n = 1) => { if (c.num !== undefined) hits.set(c.num, (hits.get(c.num) || 0) + n); };
    const horsBase = [];

    // Attribution des clients (mélangée, graine fixe) et clés d'envoi.
    const ordreClients = rng(424242).melanger(Array.from({ length: 100 }, (_, i) => i));
    scenarios.forEach((s, i) => {
      s.client = clients[ordreClients[i % 100]];
      s.corps.idempotency_key = s.cleImposee || `emp-${String(i).padStart(4, '0')}-${s.famille.slice(0, 4)}`;
    });

    // ---------------------------------------------------------------------------------------------------------------- 2. rafale
    section('2. Rafale : 50 requêtes simultanées');
    let enVol = 0;
    let pic = 0;
    const latences = [];
    const tRafale = performance.now();
    const resultats = await enParallele(scenarios, 50, async (sc) => {
      enVol++; pic = Math.max(pic, enVol);
      const t = performance.now();
      let rep;
      try { rep = await sc.client.post('order_create.php', sc.corps); } catch (e) { rep = { status: 0, json: null, text: String(e) }; }
      const d = performance.now() - t;
      latences.push(d); enVol--; compter(sc.client);
      return { sc, rep, ms: d };
    });
    const dureeRafale = performance.now() - tRafale;
    viderReponses();
    const st = stats(latences);
    mesure(`rafale : ${scenarios.length} envois en ${ms(dureeRafale)} ms (${(scenarios.length / (dureeRafale / 1000)).toFixed(1)} commandes/s), ${pic} requêtes simultanées au plus ; latence d'un envoi p50 ${ms(st.p50)} ms, p95 ${ms(st.p95)} ms, p99 ${ms(st.p99)} ms, max ${ms(st.max)} ms`);
    ctl('rafale : 50 requêtes simultanées atteintes', pic === 50, `pic observé ${pic}`);

    const refus = resultats.filter((x) => x.rep.status !== 201);
    const descRefus = (x) => `${x.sc.id} → ${x.rep.status} ${x.rep.json ? x.rep.json.error + ' ' + JSON.stringify(x.rep.json.fields || x.rep.json.name || x.rep.json.expected_unit_cents || '') : x.rep.text.slice(0, 80)}`;
    ctl('rafale : toutes les commandes valides sont acceptées (201)', refus.length === 0,
      refus.length === 0 ? `${resultats.length}/${resultats.length} acceptées` : `${refus.length} refus : ${exemples(refus.map(descRefus), 6)}`);
    const acceptees = resultats.filter((x) => x.rep.status === 201 && x.rep.json && x.rep.json.order)
      .map((x) => ({ sc: x.sc, id: x.rep.json.order.id, creation: x.rep.json.order, client: x.sc.client, replayed: x.rep.json.replayed }));
    ctl('rafale : aucune réponse « rejeu » (replayed:false) et des numéros de commande tous différents', acceptees.every((o) => o.replayed === false) && new Set(acceptees.map((o) => o.id)).size === acceptees.length,
      `${acceptees.length} commandes, ${new Set(acceptees.map((o) => o.id)).size} numéros distincts`);
    ctl('rafale : ni 429 (limite de débit) ni 5xx ni erreur de transport', resultats.every((x) => x.rep.status !== 429 && x.rep.status < 500 && x.rep.status !== 0),
      `statuts : ${JSON.stringify(Object.entries(resultats.reduce((m, x) => ({ ...m, [x.rep.status]: (m[x.rep.status] || 0) + 1 }), {})))}`);
    ctl('rafale : aucun envoi n\'a duré plus de 30 s', st.max < 30000, `max ${ms(st.max)} ms`);

    section('3. Couverture de ce qui a réellement été accepté');
    verifierCouverture(acceptees);

    // ---------------------------------------------------------------------------------------------------------------- 4. quatre vues
    section('4. Quatre vues pour chaque commande acceptée');
    await verifierQuatreVues(acceptees, patron, 'rafale');
    viderReponses();

    // ---------------------------------------------------------------------------------------------------------------- 5. base
    section('5. Base de données (aucune requête en cours)');
    const base1 = verifierBase(site.db, acceptees, 'rafale');
    mesure(`base après la rafale : ${base1.orders} lignes orders, ${base1.items} lignes order_items`);

    // ---------------------------------------------------------------------------------------------------------------- 6. doublons et simultanéité
    section('6. Doublons en rafale et envois simultanés d\'un même client');
    const nouvelles = [];
    const extra = construireScenarios(777);
    const prendre = (fam, n, depart = 0) => extra.filter((s) => s.famille === fam).slice(depart, depart + n);
    const ajouterCommande = (rep, sc, c) => { if (rep.status === 201 || rep.status === 200) nouvelles.push({ sc, id: rep.json.order.id, creation: rep.json.order, client: c, replayed: rep.json.replayed }); };

    // 6a. même clé, même corps, 4 envois à la fois (12 clients)
    const d1 = prendre('promo', 12).map((s, i) => { s.client = clients[i]; s.corps.idempotency_key = `dup-a-${String(i).padStart(3, '0')}`; return s; });
    const rep1 = await Promise.all(d1.map(async (s) => {
      const lot = await Promise.all([0, 1, 2, 3].map(() => s.client.post('order_create.php', s.corps).catch((e) => ({ status: 0, json: null, text: String(e) }))));
      compter(s.client, 4);
      return { s, lot };
    }));
    const bons1 = rep1.filter(({ lot }) => lot.filter((r) => r.status === 201).length === 1 && lot.filter((r) => r.status === 200 && r.json.replayed === true).length === 3 && new Set(lot.map((r) => r.json && r.json.order && r.json.order.id)).size === 1);
    ctl('doublons : même clé et même corps envoyés 4 fois à la fois (12 clients) → un seul 201, trois rejeux 200, un seul numéro', bons1.length === d1.length,
      `${bons1.length}/${d1.length} ; statuts ${exemples(rep1.filter((x) => !bons1.includes(x)).map(({ s, lot }) => `${s.id}: ${lot.map((r) => r.status).join(',')}`))}`);
    for (const { s, lot } of rep1) { const r201 = lot.find((r) => r.status === 201); if (r201) ajouterCommande(r201, s, s.client); }

    // 6b. même clé, deux corps différents, envoyés à la fois (6 clients)
    const A = prendre('quantites', 6, 0);
    const B = prendre('quantites', 6, 6);
    const rep2 = await Promise.all(A.map(async (sa, i) => {
      const c = clients[20 + i];
      const cle = `dup-b-${String(i).padStart(3, '0')}`;
      const sb = B[i];
      sa.client = c; sb.client = c; sa.corps.idempotency_key = cle; sb.corps.idempotency_key = cle;
      const lot = await Promise.all([sa, sa, sb, sb].map((s) => c.post('order_create.php', s.corps).catch((e) => ({ status: 0, json: null, text: String(e) }))));
      compter(c, 4);
      return { sa, sb, c, lot };
    }));
    const bons2 = [];
    for (const { sa, sb, c, lot } of rep2) {
      const gagnants = lot.map((r, k) => ({ r, s: k < 2 ? sa : sb })).filter((x) => x.r.status === 201);
      if (gagnants.length !== 1) continue;
      const g = gagnants[0];
      const cles = lot.map((r, k) => ({ r, s: k < 2 ? sa : sb }));
      const coherent = cles.every(({ r, s }) => (s === g.s ? (r.status === 201 || (r.status === 200 && r.json.replayed === true && r.json.order.id === g.r.json.order.id)) : (r.status === 409 && r.json.error === 'idempotency_conflict')));
      if (coherent) bons2.push({ sa, sb, c, g });
    }
    ctl('doublons : même clé, deux contenus différents envoyés à la fois (6 clients) → une seule commande créée, rejeux 200, contenu différent 409', bons2.length === rep2.length,
      `${bons2.length}/${rep2.length} ; ${exemples(rep2.filter(({ sa }) => !bons2.some((b) => b.sa === sa)).map(({ sa, lot }) => `${sa.id}: ${lot.map((r) => r.status + (r.json && r.json.error ? '/' + r.json.error : '')).join(',')}`))}`);
    for (const { g, c } of bons2) ajouterCommande(g.r, g.s, c);

    // 6c. un même client envoie 6 commandes différentes en même temps (6 clients, donc 36 requêtes)
    const d3 = prendre('matrice', 36, 50);
    d3.forEach((s, i) => { s.client = clients[30 + Math.floor(i / 6)]; s.corps.idempotency_key = `sim-${String(i).padStart(4, '0')}`; });
    const rep3 = await Promise.all(d3.map(async (s) => { const rep = await s.client.post('order_create.php', s.corps).catch((e) => ({ status: 0, json: null, text: String(e) })); compter(s.client); return { s, rep }; }));
    const ok3 = rep3.filter((x) => x.rep.status === 201);
    ctl('simultanéité : 6 clients envoient chacun 6 commandes différentes à la fois (36 requêtes) → 36 acceptées', ok3.length === d3.length, `${ok3.length}/${d3.length} ; ${exemples(rep3.filter((x) => x.rep.status !== 201).map((x) => `${x.s.id} → ${x.rep.status} ${x.rep.json && x.rep.json.error}`))}`);
    for (const { s, rep } of ok3) ajouterCommande(rep, s, s.client);
    viderReponses();

    // Les commandes de cette phase passent par les mêmes 4 vues, puis la base est relue en entier.
    const toutes = [...acceptees, ...nouvelles];
    await verifierQuatreVues(nouvelles, patron, 'doublons et simultanéité', toutes);
    viderReponses();
    const base2 = verifierBase(site.db, toutes, 'rafale + doublons');

    // ---------------------------------------------------------------------------------------------------------------- 7. refus attendus
    section('7. Refus attendus (aux limites), rien d\'enregistré');
    await refusAttendus(site, clients, compter, horsBase);

    // ---------------------------------------------------------------------------------------------------------------- 8. cloisonnement
    section('8. Cloisonnement des vues');
    await cloisonnement(clients, patron, toutes);

    section('9. Base finale et journal du serveur');
    const base3 = verifierBase(site.db, toutes.concat(horsBase), 'final');
    mesure(`base finale : ${base3.orders} lignes orders, ${base3.items} lignes order_items`);
    const maxHits = Math.max(...hits.values());
    ctl('hygiène du test : aucun client n\'a dépassé 19 envois comptés (limite de débit 20 / 10 min non déclenchée)', maxHits <= 19, `maximum ${maxHits} envois pour un client`);
    const journal = site.journal().trim();
    ctl('journal du serveur : aucune erreur 500 (« server_error »)', !/server_error/.test(journal), journal === '' ? '(journal vide)' : journal.split('\n').slice(0, 4).join(' | '));
    ctl('journal du serveur : aucune donnée de commande (remarques, noms d\'articles, e-mails)', !/Client\d+|massif-\d+|Régina|Merci|DROP TABLE/.test(journal), journal === '' ? '(journal vide)' : `${journal.length} caractères`);
    mesure(`base : ${base2.orders} commandes avant les refus, ${base3.orders} à la fin`);
  } finally {
    site.arreter();
  }
}

// ------------------------------------------------------------------------------------------------------------------ 7. refus
/** `creees` reçoit les (rares) commandes que ces cas créent malgré tout : elles sont attendues dans la base finale. */
async function refusAttendus(site, clients, compter, creees) {
  const db = site.db;
  const nbOrders = () => Number(db.prepare('SELECT COUNT(*) AS n FROM orders').get().n);
  const nbItems = () => Number(db.prepare('SELECT COUNT(*) AS n FROM order_items').get().n);
  let cle = 0;
  let cl = 40;
  const prochainClient = () => { const c = clients[cl]; cl = cl + 1 >= 100 ? 40 : cl + 1; return c; };
  const mk = (p, t, o = {}) => ligne({ p, taille: t, ...o });
  const corpsDe = (lignes, over = {}) => ({ ...commande('refus', 'refus', lignes).corps, idempotency_key: `ref-${String(++cle).padStart(4, '0')}`, ...over });
  const regina = pizza('Régina');
  const kebab = pizza('Kebab');
  const calzone = pizza('Calzone (soufflée)');

  /** Un cas : envoie, vérifie le statut HTTP, le code d'erreur, (option) des champs, et que la base n'a rien reçu. */
  async function refus(nom, corps, statut, code, { champs = [], verifier = null, client = prochainClient(), requete = null } = {}) {
    const avant = [nbOrders(), nbItems()];
    const rep = requete ? await requete(client) : await client.post('order_create.php', corps);
    compter(client);
    const apres = [nbOrders(), nbItems()];
    const manquants = champs.filter((k) => !(rep.json && rep.json.fields && k in rep.json.fields));
    let extraOk = true;
    try { extraOk = verifier ? verifier(rep) : true; } catch (e) { extraOk = 'exception ' + e.message; }
    ctl(`refus : ${nom}`, rep.status === statut && (code === null || (rep.json && rep.json.error === code)) && manquants.length === 0 && extraOk === true && isDeepStrictEqual(avant, apres),
      `HTTP ${rep.status} ${rep.json && rep.json.error ? rep.json.error : ''}${rep.json && rep.json.fields ? ' champs ' + Object.keys(rep.json.fields).join(',') : ''} ; base ${avant[0]}→${apres[0]} commandes, ${avant[1]}→${apres[1]} lignes${extraOk === true ? '' : ' ; ' + extraOk}`);
    return rep;
  }

  const produitsA = PRODUITS.map((p) => mk(p, ''));
  await refus('41 lignes (limite 40) → 422 validation, champ items', corpsDe([...produitsA, ...PIZZAS.slice(0, 15).map((p) => mk(p, 'Solo', { garniture: p.choice && p.choice.required ? 'thon' : null }))]), 422, 'validation', { champs: ['items'] });
  const l20 = (p, t) => mk(p, t, { qty: 20 });
  await refus('61 articles (limite 60) → 422 validation, champ items', corpsDe([l20(regina, 'Duo'), l20(kebab, 'Duo'), l20(pizza('Napolitaine'), 'Duo'), mk(produit('Canette Oasis pomme poire'), '')]), 422, 'validation', { champs: ['items'] });
  const ligneBrute = (over) => ({ ...mk(regina, 'Duo').envoye, ...over });
  const corpsBrut = (itemsBruts, over = {}) => ({ ...corpsDe([mk(regina, 'Duo')]), items: itemsBruts, ...over });
  await refus('quantité 21 → 422 validation, champ items[0].qty', corpsBrut([ligneBrute({ qty: 21 })]), 422, 'validation', { champs: ['items[0].qty'] });
  for (const [nomQ, q] of [['0', 0], ['−3', -3], ['1,5', 1.5], ['« 2 » (texte)', '2'], ['null', null]]) {
    await refus(`quantité ${nomQ} → 422 validation, champ items[0].qty`, corpsBrut([ligneBrute({ qty: q })]), 422, 'validation', { champs: ['items[0].qty'] });
  }
  await refus('remarque de 301 caractères → 422 validation, champ items[0].note', corpsBrut([ligneBrute({ note: exactement(301, 'é') })]), 422, 'validation', { champs: ['items[0].note'] });
  await refus('remarque contenant le caractère NUL → 422 validation (pas de 500)', corpsBrut([ligneBrute({ note: 'a\u0000b' })]), 422, 'validation', { champs: ['items[0].note'] });
  await refus('remarque qui n\'est pas du texte → 422 validation', corpsBrut([ligneBrute({ note: 123 })]), 422, 'validation', { champs: ['items[0].note'] });
  await refus('supplément en quantité 2 → 422 validation, champ items[0].extras[0].qty', corpsBrut([ligneBrute({ extras: [{ name: 'olives', price_cents: 150, qty: 2 }], unit_price_cents: 1750 })]), 422, 'validation', { champs: ['items[0].extras[0].qty'] });
  await refus('même supplément deux fois → 422 validation', corpsBrut([ligneBrute({ extras: [{ name: 'olives', price_cents: 150, qty: 1 }, { name: 'Olives', price_cents: 0, qty: 1 }], unit_price_cents: 1750 })]), 422, 'validation', { champs: ['items[0].extras[1].name'] });
  await refus('prix unitaire 0 → 422 validation, champ items[0].unit_price_cents', corpsBrut([ligneBrute({ unit_price_cents: 0 })]), 422, 'validation', { champs: ['items[0].unit_price_cents'] });
  await refus('taille inconnue (« Mega ») → 422 validation, champ items[0].variant', corpsBrut([ligneBrute({ variant: 'Mega' })]), 422, 'validation', { champs: ['items[0].variant'] });
  await refus('panier vide → 422 empty_cart', corpsDe([mk(regina, 'Duo')], { items: [], total_cents: 0 }), 422, 'empty_cart');
  await refus('mode inconnu (« drive ») → 422 validation, champ mode', corpsDe([mk(regina, 'Duo')], { mode: 'drive' }), 422, 'validation', { champs: ['mode'] });
  await refus('total négatif → 422 validation, champ total_cents', corpsDe([mk(regina, 'Duo')], { total_cents: -1 }), 422, 'validation', { champs: ['total_cents'] });
  await refus('moyens de paiement absents → 422 validation, champ payment_methods', (() => { const c = corpsDe([mk(regina, 'Duo')]); delete c.payment_methods; return c; })(), 422, 'validation', { champs: ['payment_methods'] });
  for (const [nomC, valeur] of [['trop courte (« court »)', 'court'], ['de 65 caractères', exactement(65, 'a')], ['avec un tiret bas', 'abcd_efgh-1234'], ['absente', undefined]]) {
    await refus(`clé d'envoi ${nomC} → 422 validation, champ idempotency_key`, corpsDe([mk(regina, 'Duo')], { idempotency_key: valeur }), 422, 'validation', { champs: ['idempotency_key'] });
  }
  // formes de corps
  const brut = (texte, entetes = { 'Content-Type': 'application/json' }) => ({ requete: (c) => c.request('POST', 'order_create.php', { raw: texte, headers: entetes }) });
  await refus('corps JSON qui est un tableau → 400', null, 400, 'bad_request', brut('[1,2,3]'));
  await refus('corps JSON invalide → 400', null, 400, 'bad_request', brut('{"mode":'));
  await refus('Content-Type text/plain → 415', null, 415, 'unsupported_media_type', brut(JSON.stringify(corpsDe([mk(regina, 'Duo')])), { 'Content-Type': 'text/plain' }));
  const gros = corpsDe(Array.from({ length: 40 }, (_, i) => mk(PIZZAS[i % 31], 'Duo', { garniture: PIZZAS[i % 31].choice && PIZZAS[i % 31].choice.required ? 'thon' : null })));
  gros.items.forEach((it) => { it.note = exactement(300, '🍕'); it.removed = Array.from({ length: 20 }, () => exactement(60, 'abc')); });
  const octets = Buffer.byteLength(JSON.stringify(gros));
  await refus(`corps de ${octets} octets (limite 65536) → 413`, null, 413, 'payload_too_large', brut(JSON.stringify(gros)));

  // refus venant du catalogue et des totaux (comptent pour la limite de débit, d'où l'attention portée aux clients utilisés)
  await refus('article hors carte → 422 unknown_item', corpsDe([mk(regina, 'Duo')], { items: [{ ...mk(regina, 'Duo').envoye, name: 'Pizza Licorne' }] }), 422, 'unknown_item');
  const decale = mk(regina, 'Duo');
  decale.envoye.unit_price_cents += 1;
  await refus('prix unitaire faux d\'un centime → 422 price_mismatch_line avec le prix attendu', corpsDe([mk(kebab, 'Solo'), decale]), 422, 'price_mismatch_line', { verifier: (rep) => (rep.json.index === 1 && rep.json.expected_unit_cents === 1600 && rep.json.sent_unit_cents === 1601) || `index ${rep.json.index}, attendu ${rep.json.expected_unit_cents}, envoyé ${rep.json.sent_unit_cents}` });
  const deux = [mk(regina, 'Duo'), mk(kebab, 'Solo')];
  const sain = commande('x', 'x', deux).attendu;
  for (const [nomT, total] of [['+1 centime', sain.total_cents + 1], ['−1 centime', sain.total_cents - 1], ['sans la promotion', sain.products_cents], ['tout offert (0)', 0]]) {
    await refus(`total faux (${nomT}) → 409 price_mismatch avec le total du serveur`, corpsDe(deux, { total_cents: total }), 409, 'price_mismatch', {
      verifier: (rep) => (rep.json.server_total_cents === sain.total_cents && rep.json.server_promo_cents === sain.promo_cents && rep.json.server_products_cents === sain.products_cents && rep.json.server_delivery_fee_cents === 0)
        || `serveur : produits ${rep.json.server_products_cents} promo ${rep.json.server_promo_cents} frais ${rep.json.server_delivery_fee_cents} total ${rep.json.server_total_cents} (attendu ${sain.products_cents}/${sain.promo_cents}/0/${sain.total_cents})`
    });
  }
  await refus('frais de livraison de 5,50 € sur une commande à emporter → 409 price_mismatch', corpsDe(deux, { delivery_fee_cents: 550, total_cents: sain.total_cents + 550 }), 409, 'price_mismatch', { verifier: (rep) => rep.json.server_delivery_fee_cents === 0 || `frais serveur ${rep.json.server_delivery_fee_cents}` });
  // moitié-moitié et choix
  await refus('moitié-moitié en Solo → 422 validation, champ items[0].half', corpsBrut([ligneBrute({ variant: 'Solo', unit_price_cents: 1100, half: { flavor1: 'Régina', flavor2: 'Kebab' } })]), 422, 'validation', { champs: ['items[0].half'] });
  await refus('moitié-moitié sur la calzone → 422 validation, champ items[0].half', corpsBrut([{ ...mk(calzone, 'Duo', { garniture: 'thon' }).envoye, half: { flavor1: 'Calzone (soufflée)', flavor2: 'Régina' } }]), 422, 'validation', { champs: ['items[0].half'] });
  await refus('la calzone en 2e moitié → 422 unknown_item', corpsBrut([ligneBrute({ half: { flavor1: 'Régina', flavor2: 'Calzone (soufflée)' } })]), 422, 'unknown_item');
  await refus('1re moitié différente de la pizza de la ligne → 422 unknown_item', corpsBrut([ligneBrute({ half: { flavor1: 'Kebab', flavor2: 'Régina' } })]), 422, 'unknown_item');
  await refus('moitié-moitié qui n\'est pas un objet → 422 validation', corpsBrut([ligneBrute({ half: 'Kebab' })]), 422, 'validation', { champs: ['items[0].half'] });
  await refus('calzone sans garniture → 422 unknown_item', corpsBrut([{ ...mk(calzone, 'Duo', { garniture: 'thon' }).envoye, name: 'Calzone (soufflée)' }]), 422, 'unknown_item');
  await refus('calzone avec une garniture absente de la fiche → 422 unknown_item', corpsBrut([{ ...mk(calzone, 'Duo', { garniture: 'thon' }).envoye, name: 'Calzone (soufflée) — Saumon' }]), 422, 'unknown_item');
  await refus('ingrédient retiré absent de la pizza → 422 validation, champ items[0].removed', corpsBrut([ligneBrute({ removed: ['thon'] })]), 422, 'validation', { champs: ['items[0].removed'] });
  await refus('supplément hors carte (« caviar ») → 422 unknown_item', corpsBrut([ligneBrute({ extras: [{ name: 'caviar', price_cents: 200, qty: 1 }], unit_price_cents: 1800 })]), 422, 'unknown_item');
  await refus('supplément sur un produit sans taille → 422 unknown_item', corpsBrut([{ ...mk(produit('Pâtes Bolognaise'), '').envoye, extras: [{ name: 'olives', price_cents: 150, qty: 1 }], unit_price_cents: 1000 }]), 422, 'unknown_item');
  await refus('pizza sans taille → 422 unknown_item', corpsBrut([ligneBrute({ variant: '' })]), 422, 'unknown_item');
  await refus('produit avec une taille → 422 unknown_item', corpsBrut([{ ...mk(produit('Canette Oasis pomme poire'), '').envoye, variant: 'Solo' }]), 422, 'unknown_item');
  await refus('supplément annoncé gratuit sans retrait → 422 price_mismatch_line', corpsBrut([ligneBrute({ extras: [{ name: 'olives', price_cents: 0, qty: 1 }], unit_price_cents: 1600 })]), 422, 'price_mismatch_line', { verifier: (rep) => rep.json.expected_unit_cents === 1750 || `attendu ${rep.json.expected_unit_cents}` });
  await refus('retrait d\'un autre groupe annoncé comme crédit (champignons → jambon gratuit) → 422 price_mismatch_line', corpsBrut([{ ...mk(regina, 'Solo', { retraits: ['champignons'], supplements: ['jambon'] }).envoye, unit_price_cents: 1100, extras: [{ name: 'jambon', price_cents: 0, qty: 1 }] }]), 422, 'price_mismatch_line', { verifier: (rep) => rep.json.expected_unit_cents === 1250 || `attendu ${rep.json.expected_unit_cents}` });
  await refus('même crédit réclamé deux fois avec un retrait écrit deux fois → 422 price_mismatch_line', corpsBrut([{ ...mk(pizza('Végétarienne'), 'Duo', { retraits: ['oignons'], supplements: ['olives', 'poivrons'] }).envoye, removed: ['oignons', 'oignons'], unit_price_cents: 1600, extras: [{ name: 'olives', price_cents: 0, qty: 1 }, { name: 'poivrons', price_cents: 0, qty: 1 }] }]), 422, 'price_mismatch_line', { verifier: (rep) => rep.json.expected_unit_cents === 1750 || `attendu ${rep.json.expected_unit_cents}` });
  // accès
  const anonyme = new ClientIP('anonyme', ipFictive(60001));
  await refus('sans connexion → 401', corpsDe([mk(regina, 'Duo')]), 401, 'unauthorized', { client: anonyme });
  const proprietaire = await patronConnecte('10.250.250.249');
  await refus('connecté en patron (pas en client) → 403', corpsDe([mk(regina, 'Duo')]), 403, 'forbidden', { client: proprietaire });

  // pollution de prototype : accepté comme une commande ordinaire, sans effet sur le processus du serveur
  const c = prochainClient();
  const lignePolluee = mk(kebab, 'Duo');
  const corpsPollue = `{"__proto__":{"admin":true,"polluee":1},"constructor":{"prototype":{"polluee":2}},"idempotency_key":"ref-proto-0001","mode":"pickup","payment_methods":[],"cash_change_for":null,"delivery_fee_cents":0,"total_cents":${lignePolluee.attendu.unit_price_cents},"items":[${JSON.stringify({ ...lignePolluee.envoye, __proto__x: 1 }).slice(0, -1)},"__proto__":{"polluee":3}}]}`;
  const avant = nbOrders();
  const repP = await c.request('POST', 'order_create.php', { raw: corpsPollue, headers: { 'Content-Type': 'application/json' } });
  compter(c);
  ctl('refus : clés « __proto__ » / « constructor » dans le corps : traité comme une commande ordinaire, aucune pollution du processus',
    repP.status === 201 && nbOrders() === avant + 1 && ({}).admin === undefined && ({}).polluee === undefined && Object.prototype.polluee === undefined,
    `HTTP ${repP.status} ; ({}).admin ${({}).admin} ; ({}).polluee ${({}).polluee}`);
  if (repP.status === 201) {
    const o = { sc: { id: 'refus-proto', corps: { idempotency_key: 'ref-proto-0001', items: [lignePolluee.envoye] }, attendu: commande('p', 'p', [lignePolluee]).attendu }, id: repP.json.order.id, creation: repP.json.order, client: c };
    creees.push(o);
  }
  viderReponses();
}

// ------------------------------------------------------------------------------------------------------------------ 8. cloisonnement
async function cloisonnement(clients, patron, toutes) {
  const echantillon = toutes.filter((_, i) => i % 7 === 0).slice(0, 40);
  const autre = (c) => clients[(clients.indexOf(c) + 1) % clients.length];
  const anonyme = new ClientIP('anonyme', ipFictive(60002));
  const proprietaire = await patronConnecte('10.250.250.248');
  const pb = { inconnu: [], anonyme: [], patron: [] };
  await enParallele(echantillon, 20, async (o) => {
    const r1 = await autre(o.client).get('order_status.php?id=' + o.id);
    if (r1.status !== 404 || !r1.json || r1.json.error !== 'not_found' || r1.text.includes(o.client.email)) pb.inconnu.push(`#${o.id} → ${r1.status}`);
    const r2 = await anonyme.get('order_status.php?id=' + o.id);
    if (r2.status !== 401) pb.anonyme.push(`#${o.id} → ${r2.status}`);
    const r3 = await proprietaire.get('order_status.php?id=' + o.id);
    if (r3.status !== 403) pb.patron.push(`#${o.id} → ${r3.status}`);
  });
  ctl('cloisonnement : le suivi d\'une commande d\'un autre client répond 404 (sans fuite)', pb.inconnu.length === 0, `${echantillon.length} commandes essayées, écarts ${exemples(pb.inconnu)}`);
  ctl('cloisonnement : le suivi sans connexion répond 401, avec la session du patron 403', pb.anonyme.length === 0 && pb.patron.length === 0, `anonyme ${pb.anonyme.length} écarts, patron ${pb.patron.length} écarts`);
  const rC = await clients[3].get('owner_orders.php');
  const rA = await anonyme.get('owner_orders.php');
  ctl('cloisonnement : owner_orders refuse un client (403) et l\'anonyme (401)', rC.status === 403 && rA.status === 401, `client ${rC.status}, anonyme ${rA.status}`);
  const rUn = await clients[3].get('customer_orders.php');
  const miens = toutes.filter((o) => o.client === clients[3]).map((o) => o.id).sort((a, b) => a - b);
  const recus = rUn.json.orders.map((v) => v.id).sort((a, b) => a - b);
  ctl('cloisonnement : customer_orders ne montre que les commandes du client', isDeepStrictEqual(miens, recus), `client ${clients[3].num} : ${recus.length} commandes reçues, ${miens.length} attendues`);
  viderReponses();
}

// ------------------------------------------------------------------------------------------------------------------ lancement
let erreurFatale = null;
try {
  await principal();
} catch (e) {
  erreurFatale = e;
  const cause = e && e.cause ? ` [cause : ${e.cause.code || ''} ${e.cause.message || e.cause}]` : '';
  ctl('exécution complète sans exception', false, String(e && e.stack ? e.stack : e).split('\n').slice(0, 6).join(' | ') + cause);
}
const duree = (Date.now() - DEBUT) / 1000;
const reussis = controles.filter((c) => c.ok).length;
const echoues = controles.length - reussis;
console.log('\n=== Mesures ===');
for (const m of metriques) console.log('  - ' + m);
console.log(`\nRÉSUMÉ : ${controles.length} contrôles, ${reussis} réussis, ${echoues} échoués ; durée ${duree.toFixed(1)} s`);
if (echoues > 0) console.log('ÉCHECS : ' + controles.filter((c) => !c.ok).map((c) => c.nom).join(' ;; '));
process.exit(echoues === 0 && erreurFatale === null ? 0 : 1);
