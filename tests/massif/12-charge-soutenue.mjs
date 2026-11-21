// Batterie 12 — CHARGE SOUTENUE ET MESURES (API).
// Un « service du soir » complet : 200 clients passent 3 commandes chacun, étalées sur 60 à 90 s avec des temps de réflexion
// aléatoires ; 200 pages de suivi sondent order_status (4 s en attente, 5 s une fois acceptée, arrêt à prête / refusée) ; le patron
// sonde owner_orders toutes les 4 s et décide chaque commande 5 à 25 s après l'avoir vue (accepte avec un délai varié, refuse 10 %,
// puis marque prête). Ensuite une rafale de 1000 requêtes simultanées (lectures + écritures). Mesures par route (nombre, erreurs,
// p50 / p95 / p99 / max), mémoire du processus, retard de la boucle d'événements ; contrôles d'intégrité sur la base à la fin.
//
//   node tests/massif/lancer.mjs tests/massif/12-charge-soutenue.mjs --timeout=480
//
// Le serveur et le test partagent UN SEUL processus (et le Postgres de test tourne dans un thread de ce même processus) :
// les latences mesurées sont donc pessimistes. Tout est fabriqué par le script (comptes, mots de passe, code patron), tout reste local.
// Options de mise au point (jamais pour le résultat officiel) : --clients=N --commandes=K --fenetre=SECONDES --rafale=N --graine=N
import { performance } from 'node:perf_hooks';
import { demarrerSite } from './lib/env.mjs';
import { ClientIP, creerClients, patronConnecte, enParallele, corpsInscription, ipFictive, VILLES } from './lib/clients.mjs';
import { rng, construireCommande } from './lib/commandes.mjs';
import { Collecteur, Sonde, instrumenter, prolongerKeepAliveServeur, limiterConnexions, percentile, arrondi, mo } from './lib/12-mesures.mjs';
import { utcAt, utcToEpoch, DELAY_CHOICES } from '../../serveur/util.js';

// ---------------------------------------------------------------------------------------------------------------------
// Paramètres (graine fixe : mêmes clients, mêmes commandes, mêmes décisions du patron, même rafale à chaque exécution)
// ---------------------------------------------------------------------------------------------------------------------
const ARGS = Object.fromEntries(process.argv.slice(2).map((a) => { const m = /^--([\w-]+)(?:=(.*))?$/.exec(a); return m ? [m[1], m[2] ?? true] : [a, true]; }));
const NB_CLIENTS = Number(ARGS.clients ?? 200);
const NB_PAR_CLIENT = Number(ARGS.commandes ?? 3);
const SEED = Number(ARGS.graine ?? 20261119);
const FENETRE_MS = ARGS.fenetre !== undefined ? Number(ARGS.fenetre) * 1000 : 60000 + Math.floor(rng(SEED)() * 30001); // 60 à 90 s
const TAILLE_RAFALE = Number(ARGS.rafale ?? 1000);
const CONNEXIONS_MAX = Number(ARGS.connexions ?? 128); // connexions TCP simultanées au plus (voir lib/12-mesures.mjs)
const COMPLET = ['clients', 'commandes', 'fenetre', 'rafale', 'graine', 'connexions'].every((k) => ARGS[k] === undefined);
const PART_REFUS = 0.1;
const POLL_PATRON_MS = 4000;
const POLL_ATTENTE_MS = 4000;
const POLL_ACCEPTEE_MS = 5000;
const DELAI_GLOBAL_MS = 440000; // le lanceur coupe à 480 s : on s'arrête avant, avec un rapport partiel

// Seuils de réussite. Les mesures sont pessimistes (serveur + test + base dans un seul processus, machine partagée avec
// d'autres batteries) : marges larges, mais qui détectent encore une vraie dérive.
const SEUILS = {
  soiree: {
    order_create: { p95: 2000, p99: 4000 },
    order_status: { p95: 1500, p99: 3000 },
    owner_orders: { p95: 3000, p99: 5000 },
    owner_order_decide: { p95: 2000, p99: 4000 }
  },
  boucleSoiree: { p99: 1000, max: 5000 },
  apparitionPatronMs: { p95: 7000, max: 15000 },
  propagationClientMs: { p95: 8000, max: 15000 },
  rafale: { dureeMs: 60000, p99Ms: 45000 },
  rssMaxMo: 1200,
  rssCroissanceFinMo: 800,
  tasApresNettoyageMo: 200,
  chargeUtileOwnerOrdersOctets: 4.5 * 1024 * 1024, // limite de charge utile d'une fonction Vercel (réponse)
  dureeTotaleS: 420
};

// ---------------------------------------------------------------------------------------------------------------------
// Outils
// ---------------------------------------------------------------------------------------------------------------------
const dormir = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));
const attendreJusqua = (tAbsolu) => dormir(tAbsolu - performance.now());
const sec = (ms) => arrondi(ms / 1000, 1);
const RANG = { new: 0, accepted: 1, ready: 2, refused: 2 };
const FINAL = new Set(['ready', 'refused']);
const FORMAT_JOUR = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' });
const jourParis = (utc) => FORMAT_JOUR.format(new Date(utcToEpoch(utc) * 1000));
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

async function attendre(condition, delaiMax, pas = 100) {
  const fin = performance.now() + delaiMax;
  for (;;) {
    if (condition()) return true;
    if (performance.now() > fin) return false;
    await dormir(pas);
  }
}

let nbPass = 0;
let nbFail = 0;
const echecs = [];
function controle(ok, nom, observe = '') {
  const ligne = `${ok ? 'PASS' : 'FAIL'}  ${nom}${observe !== '' ? ' — ' + observe : ''}`;
  console.log(ligne);
  if (ok) nbPass++; else { nbFail++; echecs.push(ligne); }
  return ok;
}

/** Anomalies observées par les scénarios (comptées toutes, 25 premières gardées pour l'affichage). */
class Anomalies {
  constructor() { this.n = new Map(); this.exemples = []; }
  ajouter(famille, detail) {
    this.n.set(famille, (this.n.get(famille) || 0) + 1);
    if (this.exemples.length < 25) this.exemples.push(`${famille} : ${detail}`);
  }
  compte(famille) { return this.n.get(famille) || 0; }
  total() { let t = 0; for (const v of this.n.values()) t += v; return t; }
}
const anomalies = new Anomalies();

process.on('unhandledRejection', (e) => {
  anomalies.ajouter('exception non rattrapée', String(e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e));
});

// ---------------------------------------------------------------------------------------------------------------------
// Démarrage
// ---------------------------------------------------------------------------------------------------------------------
const T_SCRIPT = performance.now();
const col = new Collecteur();
const reseau = instrumenter(ClientIP, col);
prolongerKeepAliveServeur(65000);
const sonde = new Sonde();
const site = await demarrerSite();
const pool = limiterConnexions(CONNEXIONS_MAX);
sonde.demarrer();
let sortieEnCours = false;
async function terminer(code) {
  if (sortieEnCours) return;
  sortieEnCours = true;
  try { sonde.arreter(); } catch { /* ignoré */ }
  try { site.arreter(); } catch { /* ignoré */ }
  process.exit(code);
}
const chien = setTimeout(() => {
  controle(false, 'délai global du script', `plus de ${DELAI_GLOBAL_MS / 1000} s : arrêt du script (rapport partiel)`);
  console.log(col.tableau('Mesures partielles (toutes phases)'));
  console.log(`\nRésumé : ${nbPass} PASS, ${nbFail} FAIL (arrêt par délai global)`);
  terminer(1);
}, DELAI_GLOBAL_MS);

console.log(`Batterie 12 — charge soutenue${COMPLET ? '' : '  [MODE RÉDUIT : résultat non officiel]'}`);
console.log(`Paramètres : ${NB_CLIENTS} clients x ${NB_PAR_CLIENT} commandes, fenêtre d'arrivée ${sec(FENETRE_MS)} s, rafale ${TAILLE_RAFALE}, graine ${SEED}, port ${site.port}, au plus ${pool.connexions} connexions TCP simultanées`);

await dormir(500);
const repos = sonde.bouclePhase();
const m0 = sonde.marque('début (site démarré)');
console.log(`Mémoire au début : rss ${mo(m0.rss)} Mo, tas ${mo(m0.tas)} Mo ; boucle au repos : p50 ${arrondi(repos.p50)} ms, max ${arrondi(repos.max)} ms`);

// ---------------------------------------------------------------------------------------------------------------------
// PHASE 1 — 200 comptes clients
// ---------------------------------------------------------------------------------------------------------------------
col.phase = 'inscriptions';
const tInsc = performance.now();
const clients = await creerClients(NB_CLIENTS, { concurrence: 20, prefixe: 'charge' });
const dureeInsc = performance.now() - tInsc;
const boucleInsc = sonde.bouclePhase();
const m1 = sonde.marque('après inscriptions');
console.log(`${clients.length} comptes créés en ${sec(dureeInsc)} s (bcrypt coût 10 dans le processus) ; boucle : p99 ${arrondi(boucleInsc.p99)} ms, max ${arrondi(boucleInsc.max)} ms`);
{
  const s = col.stat({ phase: 'inscriptions', route: 'customer_signup' });
  controle(clients.length === NB_CLIENTS && s.ok2xx === NB_CLIENTS, `${NB_CLIENTS} comptes clients créés (201)`, `${s.ok2xx}/${NB_CLIENTS} en 201, p95 ${arrondi(s.p95)} ms`);
  controle(s.c5xx === 0 && s.reseau === 0 && s.c4xx === 0, 'inscriptions : aucune erreur (5xx, 4xx, réseau)', `5xx ${s.c5xx}, 4xx ${s.c4xx}, réseau ${s.reseau}`);
}

// ---------------------------------------------------------------------------------------------------------------------
// Registre : tout ce que le test sait de chaque commande (vérité terrain pour les contrôles finaux)
// ---------------------------------------------------------------------------------------------------------------------
const registre = new Map(); // id -> entrée
const cles = new Set();      // clés d'idempotence des commandes créées
let nb201 = 0;               // réponses 201 reçues pour order_create (toutes phases)
let nbRejeuxApresErreur = 0; // commandes confirmées seulement par un rejeu 200 après une erreur réseau du premier envoi
const erreursCreation = [];

function enregistrerCommande(e) {
  if (registre.has(e.id)) anomalies.ajouter('commande en double', `id ${e.id} renvoyé deux fois par order_create`);
  registre.set(e.id, e);
  cles.add(e.cle);
}

/** Corps de réponse d'une création : renvoie la liste des écarts avec la commande envoyée. */
function ecartsCreation(rep, body, totals, attendu) {
  const ecarts = [];
  const o = rep.json && rep.json.order;
  if (!rep.json || rep.json.ok !== true || !o) return ['réponse sans commande'];
  if (rep.json.replayed !== attendu.rejeu) ecarts.push(`replayed=${rep.json.replayed}`);
  if (o.status !== 'new') ecarts.push(`statut ${o.status}`);
  if (o.mode !== body.mode) ecarts.push(`mode ${o.mode}`);
  if (o.total_cents !== totals.total_cents) ecarts.push(`total ${o.total_cents} au lieu de ${totals.total_cents}`);
  if (o.delivery_fee_cents !== totals.delivery_fee_cents) ecarts.push(`frais ${o.delivery_fee_cents} au lieu de ${totals.delivery_fee_cents}`);
  if (o.promo_cents !== totals.promo_cents) ecarts.push(`promo ${o.promo_cents} au lieu de ${totals.promo_cents}`);
  if (!Array.isArray(o.items) || o.items.length !== body.items.length) ecarts.push(`lignes ${o.items && o.items.length} au lieu de ${body.items.length}`);
  if (typeof o.created_at !== 'string' || !ISO_UTC.test(o.created_at)) ecarts.push('created_at illisible');
  return ecarts;
}

/**
 * Envoi d'une commande comme le fait le site : en cas d'erreur réseau, nouvel envoi avec la MÊME clé d'idempotence
 * (un rejeu ne doit jamais créer de doublon). Renvoie { rep, estCreation, apresErreurReseau }.
 */
async function envoyerCommande(client, body, totals) {
  let apresErreur = false;
  for (let essai = 1; essai <= 3; essai++) {
    const rep = await client.post('order_create.php', body);
    if (rep.status === 0) { apresErreur = true; await dormir(300 * essai); continue; }
    return { rep, apresErreur };
  }
  return { rep: { status: 0, json: null, text: '' }, apresErreur };
}

// ---------------------------------------------------------------------------------------------------------------------
// Plan de la soirée (tout est tiré à l'avance avec la graine : horaires, contenus, décisions du patron)
// ---------------------------------------------------------------------------------------------------------------------
function planifierSoiree() {
  const total = clients.length * NB_PAR_CLIENT;
  const rg = rng(SEED);
  const nbRefus = Math.round(total * PART_REFUS);
  const refus = new Set(rg.melanger(Array.from({ length: total }, (_, i) => i)).slice(0, nbRefus));
  const plans = [];
  clients.forEach((c, ci) => {
    const rc = rng(SEED + 1000 + c.num);
    const commandes = [];
    for (let k = 0; k < NB_PAR_CLIENT; k++) {
      // k-ième tiers de la fenêtre : instants répartis, au moins ~3 % de la fenêtre entre deux commandes du même client
      const instant = Math.floor((FENETRE_MS * (k + 0.05 + 0.9 * rc())) / NB_PAR_CLIENT);
      const mode = rc.vrai(0.5) ? 'delivery' : 'pickup';
      const cle = `ch12-c${c.num}-o${k}-s${SEED}`;
      const { body, totals } = construireCommande(rc, { mode, ville: c.ville, cle });
      commandes.push({
        k, instant, body, totals,
        refus: refus.has(ci * NB_PAR_CLIENT + k),
        delaiDecision: 5000 + Math.floor(rc() * 20001),          // 5 à 25 s après que le patron l'a vue
        delayMinutes: rc.choix(DELAY_CHOICES),                   // 20, 30, 40, 50 ou 60 minutes annoncées
        delaiPrep: 6000 + Math.floor(rc() * 14001)               // préparation « accélérée » : prête 6 à 20 s après l'acceptation
      });
    }
    plans.push({ client: c, commandes });
  });
  return { plans, nbRefus, total };
}

// ---------------------------------------------------------------------------------------------------------------------
// Pages de suivi simulées (une par client ; comme commande.js : séquentiel, 4 s en attente, 5 s acceptée, arrêt à prête / refusée,
// délai doublé après un échec, 30 s au plus)
// ---------------------------------------------------------------------------------------------------------------------
function analyserSondage(e, rep, tEnvoi, tRecu) {
  const ecart = (detail) => anomalies.ajouter('page de suivi', `commande ${e.id} : ${detail}`);
  const j = rep.json;
  const o = j && j.order;
  if (!j || j.ok !== true || !o) return ecart('réponse sans commande');
  if (o.id !== e.id) ecart(`id ${o.id} reçu au lieu de ${e.id}`);
  if (!Object.prototype.hasOwnProperty.call(RANG, o.status)) return ecart(`statut inconnu « ${o.status} »`);
  if (typeof j.server_now !== 'string' || !ISO_UTC.test(j.server_now)) ecart('server_now illisible');
  else {
    if (e.derniereHorloge !== null && j.server_now < e.derniereHorloge) ecart(`server_now recule (${e.derniereHorloge} -> ${j.server_now})`);
    e.derniereHorloge = j.server_now;
    if (j.server_now < o.created_at) ecart('server_now antérieur à created_at');
  }
  const prec = e.dernierVu;
  if (prec !== null) {
    if (FINAL.has(prec) && o.status !== prec) ecart(`changement après l'état final ${prec} -> ${o.status}`);
    else if (RANG[o.status] < RANG[prec]) ecart(`retour en arrière ${prec} -> ${o.status}`);
  }
  // cohérence des champs selon le statut
  if (o.total_cents !== e.totals.total_cents) ecart(`total ${o.total_cents} au lieu de ${e.totals.total_cents}`);
  if (o.status === 'new') {
    if (o.accepted_at !== null || o.refused_at !== null || o.prepared_at !== null || o.delay_minutes !== null || o.ready_at !== null) ecart('commande « new » avec des dates ou un délai');
  } else if (o.status === 'accepted' || o.status === 'ready') {
    if (o.delay_minutes !== e.plan.delayMinutes) ecart(`délai ${o.delay_minutes} au lieu de ${e.plan.delayMinutes}`);
    if (typeof o.accepted_at !== 'string' || !ISO_UTC.test(o.accepted_at)) ecart('accepted_at absent');
    else if (o.ready_at !== utcAt(utcToEpoch(o.accepted_at) + o.delay_minutes * 60)) ecart(`ready_at ${o.ready_at} incohérent avec accepted_at + délai`);
    if (o.status === 'accepted' && o.prepared_at !== null) ecart('prepared_at renseigné avant « prête »');
    if (o.status === 'ready' && (typeof o.prepared_at !== 'string' || !(o.prepared_at >= o.accepted_at))) ecart(`prepared_at ${o.prepared_at} < accepted_at ${o.accepted_at}`);
    if (o.refused_at !== null) ecart('refused_at sur une commande acceptée');
  } else if (o.status === 'refused') {
    if (typeof o.refused_at !== 'string' || o.accepted_at !== null || o.prepared_at !== null || o.delay_minutes !== null) ecart('commande refusée aux champs incohérents');
  }
  // causalité : un statut ne peut pas être vu avant que le patron ait envoyé sa décision
  if ((o.status === 'accepted' || o.status === 'refused') && !(e.tDecisionEnvoyee !== undefined && e.tDecisionEnvoyee <= tRecu)) ecart(`« ${o.status} » vu avant la décision du patron`);
  if (o.status === 'ready' && !(e.tPreteEnvoyee !== undefined && e.tPreteEnvoyee <= tRecu)) ecart('« ready » vu avant l\'ordre « prête » du patron');
  if (e.vus[o.status] === undefined) e.vus[o.status] = tRecu;
  e.dernierVu = o.status;
}

class PageSuivi {
  constructor(client) {
    this.client = client;
    this.entree = null;
    this.gen = 0;
    this.enVol = false;
    this.timer = null;
    this.arret = false;
    this.echecs = 0;
  }

  cibler(entree) {
    if (this.entree !== null && this.entree.tAbandon === undefined && !FINAL.has(this.entree.dernierVu)) this.entree.tAbandon = performance.now();
    this.entree = entree;
    this.gen++;
    this.echecs = 0;
    clearTimeout(this.timer);
    this.sonder();
  }

  stopper() {
    this.arret = true;
    clearTimeout(this.timer);
  }

  async sonder() {
    if (this.arret || this.enVol || this.entree === null) return;
    const e = this.entree;
    const gen = this.gen;
    if (FINAL.has(e.dernierVu)) return;
    this.enVol = true;
    const tEnvoi = performance.now();
    let rep;
    try {
      rep = await this.client.get('order_status.php?id=' + e.id);
    } catch (err) {
      rep = { status: 0, json: null, text: '' };
      anomalies.ajouter('exception page', String(err));
    }
    const tRecu = performance.now();
    this.enVol = false;
    e.sondages++;
    if (rep.status === 200) {
      this.echecs = 0;
      try { analyserSondage(e, rep, tEnvoi, tRecu); } catch (err) { anomalies.ajouter('exception analyse', String(err && err.stack ? err.stack.split('\n').slice(0, 2).join(' | ') : err)); }
    } else if (rep.status === 0 || rep.status >= 500) {
      this.echecs++;
      e.echecsSondage++;
    } else {
      anomalies.ajouter('page de suivi', `commande ${e.id} : HTTP ${rep.status} ${String(rep.text).slice(0, 80)}`);
      e.echecsSondage++;
      this.echecs++;
    }
    if (this.arret) return;
    if (gen !== this.gen) { this.sonder(); return; }   // la page a changé de commande pendant l'appel
    if (FINAL.has(e.dernierVu)) return;                // prête ou refusée : le sondage s'arrête
    const base = e.dernierVu === 'accepted' ? POLL_ACCEPTEE_MS : POLL_ATTENTE_MS;
    this.timer = setTimeout(() => this.sonder(), Math.min(30000, base * 2 ** this.echecs));
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Patron (tablette) : sondage de owner_orders toutes les 4 s, décisions 5 à 25 s après l'arrivée
// ---------------------------------------------------------------------------------------------------------------------
let patron = null;
let patronActif = false;
let decisionsEnCours = 0;
const patronStats = { sondages: 0, echecs: 0, intervallesMs: [], taillesListe: [], dernierSondage: null, vusIds: new Set(), rangVu: new Map() };

function verifierDecision(e, rep, action) {
  const ecart = (detail) => anomalies.ajouter('décision du patron', `commande ${e.id} ${action} : ${detail}`);
  if (rep.status !== 200) return ecart(`HTTP ${rep.status} ${String(rep.text).slice(0, 100)}`);
  const o = rep.json && rep.json.order;
  if (!rep.json || rep.json.ok !== true || !o) return ecart('réponse sans commande');
  if (rep.json.replayed !== false) ecart(`replayed=${rep.json.replayed} sur une première décision`);
  if (o.id !== e.id) ecart(`id ${o.id}`);
  const attendu = action === 'accept' ? 'accepted' : action === 'refuse' ? 'refused' : 'ready';
  if (o.status !== attendu) ecart(`statut ${o.status} au lieu de ${attendu}`);
  if (action === 'accept') {
    if (o.delay_minutes !== e.plan.delayMinutes) ecart(`délai ${o.delay_minutes}`);
    if (typeof o.accepted_at !== 'string' || o.ready_at !== utcAt(utcToEpoch(o.accepted_at) + e.plan.delayMinutes * 60)) ecart(`ready_at ${o.ready_at} / accepted_at ${o.accepted_at}`);
    e.accepteLe = o.accepted_at;
  }
  if (action === 'ready') {
    if (typeof o.prepared_at !== 'string' || !(o.prepared_at >= e.accepteLe)) ecart(`prepared_at ${o.prepared_at} < accepted_at ${e.accepteLe}`);
    if (o.delay_minutes !== e.plan.delayMinutes || o.ready_at === null) ecart('délai ou heure prévue perdus au passage à « prête »');
  }
  if (action === 'refuse' && (typeof o.refused_at !== 'string' || o.accepted_at !== null)) ecart('dates incohérentes après refus');
}

async function deciderSoiree(e) {
  decisionsEnCours++;
  try {
    const p = e.plan;
    await dormir(p.delaiDecision);
    const action = p.refus ? 'refuse' : 'accept';
    e.tDecisionEnvoyee = performance.now();
    const rep = await patron.post('owner_order_decide.php', p.refus ? { id: e.id, action } : { id: e.id, action, delay_minutes: p.delayMinutes });
    e.tDecisionRecue = performance.now();
    verifierDecision(e, rep, action);
    if (rep.status !== 200) return;
    if (p.refus) { e.finalLedger = 'refused'; return; }
    e.accepteLedger = true;
    await dormir(p.delaiPrep);
    e.tPreteEnvoyee = performance.now();
    const rep2 = await patron.post('owner_order_decide.php', { id: e.id, action: 'ready' });
    e.tPreteRecue = performance.now();
    verifierDecision(e, rep2, 'ready');
    if (rep2.status === 200) e.finalLedger = 'ready';
  } catch (err) {
    anomalies.ajouter('exception patron', String(err && err.stack ? err.stack.split('\n').slice(0, 2).join(' | ') : err));
  } finally {
    decisionsEnCours--;
  }
}

function verifierListePatron(rep) {
  const ecart = (detail) => anomalies.ajouter('liste du patron', detail);
  const j = rep.json;
  if (!j || j.ok !== true || !Array.isArray(j.orders) || typeof j.server_now !== 'string') return ecart('forme de la réponse');
  const ids = new Set();
  let prec = null;
  for (const o of j.orders) {
    if (ids.has(o.id)) ecart(`commande ${o.id} listée deux fois`);
    ids.add(o.id);
    if (prec !== null && (o.created_at < prec.created_at || (o.created_at === prec.created_at && o.id < prec.id))) ecart(`ordre rompu entre ${prec.id} et ${o.id}`);
    prec = o;
    const r = RANG[o.status];
    const avant = patronStats.rangVu.get(o.id);
    if (avant !== undefined && (r < avant.rang || (avant.rang === 2 && o.status !== avant.statut))) ecart(`commande ${o.id} : ${avant.statut} -> ${o.status}`);
    patronStats.rangVu.set(o.id, { rang: r, statut: o.status });
    const e = registre.get(o.id);
    if (e && o.customer_id !== e.client.customer.id) ecart(`commande ${o.id} attribuée au client ${o.customer_id} au lieu de ${e.client.customer.id}`);
  }
  for (const id of patronStats.vusIds) if (!ids.has(id)) ecart(`commande ${id} vue puis disparue de la liste`);
  for (const id of ids) patronStats.vusIds.add(id);
  return ids;
}

async function boucleDuPatron() {
  while (patronActif) {
    const t = performance.now();
    if (patronStats.dernierSondage !== null) patronStats.intervallesMs.push(t - patronStats.dernierSondage);
    patronStats.dernierSondage = t;
    let rep;
    try { rep = await patron.get('owner_orders.php'); } catch (err) { rep = { status: 0 }; anomalies.ajouter('exception patron', String(err)); }
    const tRecu = performance.now();
    patronStats.sondages++;
    if (rep.status === 200) {
      try {
        verifierListePatron(rep);
        patronStats.taillesListe.push(rep.json.orders.length);
        for (const o of rep.json.orders) {
          if (o.status !== 'new') continue;
          const e = registre.get(o.id);
          if (!e || e.kind !== 'soiree' || e.tVuPatron !== undefined) continue;   // inconnue du test pour l'instant : au prochain sondage
          e.tVuPatron = tRecu;
          deciderSoiree(e);
        }
      } catch (err) { anomalies.ajouter('exception patron', String(err && err.stack ? err.stack.split('\n').slice(0, 2).join(' | ') : err)); }
    } else {
      patronStats.echecs++;
    }
    await dormir(POLL_PATRON_MS);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// PHASE 2 — la soirée
// ---------------------------------------------------------------------------------------------------------------------
console.log('\n=== PHASE 2 : service du soir ===');
const { plans, nbRefus, total: totalSoiree } = planifierSoiree();
console.log(`Plan : ${totalSoiree} commandes (${plans.reduce((s, p) => s + p.commandes.filter((c) => c.body.mode === 'delivery').length, 0)} en livraison), ${nbRefus} refus prévus (${arrondi((100 * nbRefus) / totalSoiree)} %)`);

col.phase = 'soiree';
sonde.bouclePhase();
const tSoiree0 = performance.now();
patron = await patronConnecte();
patronActif = true;
const promessePatron = boucleDuPatron();
const pages = new Map(clients.map((c) => [c.num, new PageSuivi(c)]));

let nbCrees = 0;
async function scenarioClient(plan) {
  const c = plan.client;
  for (const cmd of plan.commandes) {
    await attendreJusqua(tSoiree0 + cmd.instant);
    const tEnvoi = performance.now();
    const { rep, apresErreur } = await envoyerCommande(c, cmd.body, cmd.totals);
    const tCree = performance.now();
    if (rep.status === 201 || (apresErreur && rep.status === 200)) {
      if (rep.status === 201) nb201++; else nbRejeuxApresErreur++;
      const ecarts = ecartsCreation(rep, cmd.body, cmd.totals, { rejeu: rep.status === 200 });
      if (ecarts.length) anomalies.ajouter('création de commande', `client ${c.num} #${cmd.k} : ${ecarts.join(', ')}`);
      const e = {
        id: rep.json.order.id, client: c, clientNum: c.num, k: cmd.k, kind: 'soiree', cle: cmd.body.idempotency_key,
        body: cmd.body, totals: cmd.totals, plan: cmd, tEnvoi, tCree, vus: {}, dernierVu: null, derniereHorloge: null, sondages: 0, echecsSondage: 0
      };
      enregistrerCommande(e);
      nbCrees++;
      pages.get(c.num).cibler(e);
    } else {
      erreursCreation.push(`client ${c.num} #${cmd.k} : HTTP ${rep.status} ${String(rep.text).slice(0, 160)}`);
      anomalies.ajouter('création de commande', `client ${c.num} #${cmd.k} : HTTP ${rep.status} ${String(rep.text).slice(0, 120)}`);
    }
  }
}

let marqueMilieu = false;
const progression = setInterval(() => {
  const t = (performance.now() - tSoiree0) / 1000;
  const m = process.memoryUsage();
  const finals = [...registre.values()].filter((e) => e.finalLedger !== undefined).length;
  if (!marqueMilieu && nbCrees >= totalSoiree / 2) { marqueMilieu = true; sonde.marque('milieu de soirée'); }
  console.log(`  [t+${String(Math.round(t)).padStart(3)} s] créées ${nbCrees}/${totalSoiree} · patron : ${finals} finales, ${decisionsEnCours} décisions en cours · sondages client ${col.stat({ phase: 'soiree', route: 'order_status' }).n} · rss ${mo(m.rss)} Mo`);
}, 10000);
progression.unref();

await Promise.all(plans.map(scenarioClient));
const tDernierEnvoi = performance.now();
console.log(`  toutes les commandes envoyées après ${sec(tDernierEnvoi - tSoiree0)} s (${nbCrees} créées, ${erreursCreation.length} refusées)`);

// attendre que le patron ait traité toutes les commandes, puis que chaque page ait vu l'état final
const toutesFinales = () => [...registre.values()].filter((e) => e.kind === 'soiree').every((e) => e.finalLedger !== undefined);
const patronFini = await attendre(() => toutesFinales() && decisionsEnCours === 0, 120000);
const tFinPatron = performance.now();
const pagesAJour = await attendre(() => [...registre.values()].filter((e) => e.kind === 'soiree').every((e) => FINAL.has(e.dernierVu) || e.tAbandon !== undefined || e.finalLedger === undefined), 30000);
// le dernier ordre de chaque client doit avoir été suivi jusqu'au bout : on attend les pages encore en vol
await attendre(() => [...pages.values()].every((p) => p.entree === null || FINAL.has(p.entree.dernierVu) || p.entree.finalLedger === undefined), 20000);
const tFinPages = performance.now();
for (const p of pages.values()) p.stopper();
patronActif = false;
await Promise.race([promessePatron, dormir(POLL_PATRON_MS + 3000)]);
clearInterval(progression);
await dormir(300);
const dureeSoiree = performance.now() - tSoiree0;
const boucleSoiree = sonde.bouclePhase();
const mSoiree = sonde.marque('fin de soirée');
console.log(`  soirée terminée après ${sec(dureeSoiree)} s (patron fini à t+${sec(tFinPatron - tSoiree0)} s, pages à t+${sec(tFinPages - tSoiree0)} s)`);

// ----- contrôles de la soirée
{
  const soiree = [...registre.values()].filter((e) => e.kind === 'soiree');
  const crees = col.stat({ phase: 'soiree', route: 'order_create' });
  controle(crees.n >= totalSoiree && nb201 === totalSoiree && erreursCreation.length === 0, `soirée : ${totalSoiree} commandes créées en 201`, `${nb201} en 201 sur ${crees.n} envois, ${erreursCreation.length} refus${erreursCreation[0] ? ' (ex. ' + erreursCreation[0] + ')' : ''}`);
  controle(anomalies.compte('création de commande') === 0 && anomalies.compte('commande en double') === 0, 'soirée : réponses de création conformes (statut new, total, promo, frais, lignes, pas de doublon d\'identifiant)', `${anomalies.compte('création de commande') + anomalies.compte('commande en double')} écart(s)`);
  controle(new Set(soiree.map((e) => e.id)).size === soiree.length, 'soirée : identifiants de commande tous distincts', `${new Set(soiree.map((e) => e.id)).size}/${soiree.length}`);
  const refusees = soiree.filter((e) => e.finalLedger === 'refused').length;
  const pretes = soiree.filter((e) => e.finalLedger === 'ready').length;
  controle(patronFini && refusees + pretes === totalSoiree, 'soirée : le patron a décidé toutes les commandes jusqu\'à « prête » ou « refusée »', `${pretes} prêtes + ${refusees} refusées sur ${totalSoiree}${patronFini ? '' : ' (délai dépassé)'}`);
  controle(refusees === nbRefus, `soirée : exactement ${PART_REFUS * 100} % de refus (${nbRefus})`, `${refusees} refusées`);
  controle(anomalies.compte('décision du patron') === 0, 'soirée : toutes les décisions du patron en 200, replayed=false, statuts et dates cohérents', `${anomalies.compte('décision du patron')} écart(s)`);
  const dec = col.stat({ phase: 'soiree', route: 'owner_order_decide' });
  controle(dec.n === pretes * 2 + refusees && dec.ok2xx === dec.n, 'soirée : nombre d\'appels owner_order_decide = 2 par commande acceptée + 1 par refus, tous en 2xx', `${dec.n} appels (attendu ${pretes * 2 + refusees}), ${dec.ok2xx} en 2xx`);

  const dernieres = [...pages.values()].map((p) => p.entree).filter(Boolean);
  const bouclees = dernieres.filter((e) => FINAL.has(e.dernierVu) && e.dernierVu === e.finalLedger);
  controle(pagesAJour && dernieres.length === clients.length && bouclees.length === dernieres.length, 'soirée : chaque page de suivi a vu l\'état final de la dernière commande de son client, sans recharger', `${bouclees.length}/${clients.length} pages à jour`);
  controle(anomalies.compte('page de suivi') === 0 && anomalies.compte('exception analyse') === 0, 'soirée : sondages client cohérents (pas de retour en arrière, pas de statut vu avant la décision, champs et dates cohérents, horloge serveur croissante)', `${anomalies.compte('page de suivi')} écart(s)`);
  const sansEchec = soiree.filter((e) => e.echecsSondage > 0).length;
  controle(sansEchec === 0, 'soirée : aucun sondage client en échec (5xx, réseau, 4xx)', `${sansEchec} commande(s) avec au moins un échec`);
  const lagsAcc = soiree.filter((e) => e.vus.accepted !== undefined && e.tDecisionEnvoyee !== undefined).map((e) => e.vus.accepted - e.tDecisionEnvoyee).sort((a, b) => a - b);
  const lagsPret = soiree.filter((e) => e.vus.ready !== undefined && e.tPreteEnvoyee !== undefined).map((e) => e.vus.ready - e.tPreteEnvoyee).sort((a, b) => a - b);
  const lagsRef = soiree.filter((e) => e.vus.refused !== undefined && e.tDecisionEnvoyee !== undefined && e.plan.refus).map((e) => e.vus.refused - e.tDecisionEnvoyee).sort((a, b) => a - b);
  const lags = [...lagsAcc, ...lagsPret, ...lagsRef].sort((a, b) => a - b);
  console.log(`  propagation (décision du patron -> page du client) : acceptée n=${lagsAcc.length} p50 ${arrondi(percentile(lagsAcc, 50))} p95 ${arrondi(percentile(lagsAcc, 95))} max ${arrondi(lagsAcc[lagsAcc.length - 1])} ms ; prête n=${lagsPret.length} p50 ${arrondi(percentile(lagsPret, 50))} p95 ${arrondi(percentile(lagsPret, 95))} max ${arrondi(lagsPret[lagsPret.length - 1])} ms ; refusée n=${lagsRef.length} p95 ${arrondi(percentile(lagsRef, 95))} ms`);
  controle(lags.length > 0 && percentile(lags, 95) <= SEUILS.propagationClientMs.p95 && lags[lags.length - 1] <= SEUILS.propagationClientMs.max, `soirée : un changement de statut apparaît sur la page du client en p95 <= ${SEUILS.propagationClientMs.p95 / 1000} s, max <= ${SEUILS.propagationClientMs.max / 1000} s (sondage 4 s / 5 s)`, `n=${lags.length}, p95 ${arrondi(percentile(lags, 95))} ms, max ${arrondi(lags[lags.length - 1])} ms`);
  const apparitions = soiree.filter((e) => e.tVuPatron !== undefined).map((e) => Math.max(0, e.tVuPatron - e.tEnvoi)).sort((a, b) => a - b);
  console.log(`  apparition chez le patron (envoi du client -> liste du patron) : n=${apparitions.length} p50 ${arrondi(percentile(apparitions, 50))} p95 ${arrondi(percentile(apparitions, 95))} max ${arrondi(apparitions[apparitions.length - 1])} ms`);
  controle(apparitions.length === totalSoiree && percentile(apparitions, 95) <= SEUILS.apparitionPatronMs.p95 && apparitions[apparitions.length - 1] <= SEUILS.apparitionPatronMs.max, `soirée : chaque commande apparaît chez le patron (p95 <= ${SEUILS.apparitionPatronMs.p95 / 1000} s, max <= ${SEUILS.apparitionPatronMs.max / 1000} s avec un sondage toutes les 4 s)`, `${apparitions.length}/${totalSoiree} vues, p95 ${arrondi(percentile(apparitions, 95))} ms, max ${arrondi(apparitions[apparitions.length - 1])} ms`);
  controle(anomalies.compte('liste du patron') === 0, 'soirée : listes owner_orders cohérentes (pas de doublon, ordre chronologique, aucune commande perdue d\'un sondage à l\'autre, pas de retour de statut)', `${anomalies.compte('liste du patron')} écart(s)`);
  const ints = [...patronStats.intervallesMs].sort((a, b) => a - b);
  const maxListe = Math.max(0, ...patronStats.taillesListe);
  console.log(`  patron : ${patronStats.sondages} sondages owner_orders (liste jusqu'à ${maxListe} commandes), intervalle p50 ${arrondi(percentile(ints, 50))} ms, max ${arrondi(ints[ints.length - 1])} ms`);
  controle(patronStats.echecs === 0 && ints.length > 0 && ints[ints.length - 1] <= 15000, 'soirée : le patron n\'a manqué aucun sondage (aucun échec, intervalle max <= 15 s)', `${patronStats.echecs} échec(s), intervalle max ${arrondi(ints[ints.length - 1])} ms`);
  controle(anomalies.compte('exception patron') === 0 && anomalies.compte('exception page') === 0 && anomalies.compte('exception non rattrapée') === 0, 'soirée : aucune exception dans les scénarios', `${anomalies.compte('exception patron') + anomalies.compte('exception page') + anomalies.compte('exception non rattrapée')}`);
  console.log(col.tableau(`\nMesures de la soirée (durées client en ms ; ${sec(dureeSoiree)} s)`, { phase: 'soiree' }));
  const sTot = col.stat({ phase: 'soiree' });
  console.log(`  débit moyen de la soirée : ${arrondi(sTot.n / (dureeSoiree / 1000))} requêtes/s (${sTot.n} requêtes)`);
  console.log(`  boucle d'événements pendant la soirée : moy ${arrondi(boucleSoiree.moy)} ms, p50 ${arrondi(boucleSoiree.p50)} ms, p99 ${arrondi(boucleSoiree.p99)} ms, max ${arrondi(boucleSoiree.max)} ms, utilisation ${arrondi(boucleSoiree.utilisation * 100, 0)} %`);
  console.log(`  mémoire : rss ${mo(mSoiree.rss)} Mo à la fin de soirée, pic ${mo(sonde.rssMax(tSoiree0))} Mo pendant la soirée`);

  // seuils par route (soirée)
  controle(sTot.c5xx === 0, 'soirée : aucune erreur 5xx', `${sTot.c5xx} sur ${sTot.n} requêtes`);
  controle(sTot.reseau === 0, 'soirée : aucune erreur réseau (connexion coupée, délai)', `${sTot.reseau} sur ${sTot.n} requêtes`);
  controle(sTot.c4xx === 0, 'soirée : aucune réponse 4xx inattendue', `${sTot.c4xx} sur ${sTot.n} requêtes`);
  for (const [route, s] of Object.entries(SEUILS.soiree)) {
    const st = col.stat({ phase: 'soiree', route });
    controle(st.n > 0 && st.p95 < s.p95, `soirée : ${route} p95 < ${s.p95} ms`, `p95 ${arrondi(st.p95)} ms (n=${st.n}, p50 ${arrondi(st.p50)}, p99 ${arrondi(st.p99)}, max ${arrondi(st.max)})`);
    controle(st.n > 0 && st.p99 < s.p99, `soirée : ${route} p99 < ${s.p99} ms`, `p99 ${arrondi(st.p99)} ms`);
  }
  controle(boucleSoiree.p99 < SEUILS.boucleSoiree.p99 && boucleSoiree.max < SEUILS.boucleSoiree.max, `soirée : retard de la boucle d'événements p99 < ${SEUILS.boucleSoiree.p99} ms et max < ${SEUILS.boucleSoiree.max} ms`, `p99 ${arrondi(boucleSoiree.p99)} ms, max ${arrondi(boucleSoiree.max)} ms (au repos : ${arrondi(repos.p50)} ms)`);
}

// ---------------------------------------------------------------------------------------------------------------------
// PHASE 3 — préparation de la rafale (commandes à décider pendant la rafale) puis rafale de requêtes simultanées
// ---------------------------------------------------------------------------------------------------------------------
console.log('\n=== PHASE 3 : rafale de requêtes simultanées ===');
// 1000 requêtes : 64 % de lectures, 36 % d'écritures. « double » = la même opération envoyée en même temps plusieurs fois ;
// « course » = trois ordres contradictoires du patron sur la même commande en même temps (accepter 30, refuser, accepter 40).
const COMPOSITION = [
  ['order_status', 260], ['customer_orders', 100], ['customer_me', 80], ['availability', 100], ['owner_orders', 30], ['owner_me', 10],
  ['owner_settings', 10], ['owner_availability', 10], ['order_create_nouvelle', 150], ['order_create_rejeu', 20], ['order_create_double', 10],
  ['decide_accept', 30], ['decide_refuse', 30], ['decide_ready', 30], ['decide_rejeu', 10], ['decide_course', 30], ['customer_signup', 30],
  ['signup_double', 10], ['customer_login', 30], ['customer_update_address', 20]
];
const echelle = TAILLE_RAFALE / 1000;
const compo = Object.fromEntries(COMPOSITION.map(([t, n]) => [t, Math.max(t === 'order_create_double' || t === 'signup_double' ? 2 : 1, Math.round(n * echelle))]));
const nbCourse = Math.max(1, Math.round(10 * echelle)); // commandes en course : 3 ordres chacune
compo.decide_course = nbCourse * 3;

// 3a. commandes supplémentaires (hors soirée) que la rafale va accepter / refuser / marquer prêtes
col.phase = 'prep';
const rp = rng(SEED + 555);
const clientsMelanges = rp.melanger(clients);
const nbPrep = compo.decide_accept + compo.decide_refuse + compo.decide_ready + nbCourse;
const prepEntrees = [];
{
  const taches = Array.from({ length: nbPrep }, (_, i) => {
    const c = clientsMelanges[i % clientsMelanges.length];
    const { body, totals } = construireCommande(rp, { mode: rp.vrai(0.5) ? 'delivery' : 'pickup', ville: c.ville, cle: `ch12-prep${i}-c${c.num}-s${SEED}` });
    return { c, body, totals, i };
  });
  await enParallele(taches, 10, async (t) => {
    const { rep, apresErreur } = await envoyerCommande(t.c, t.body, t.totals);
    if (rep.status === 201 || (apresErreur && rep.status === 200)) {
      if (rep.status === 201) nb201++; else nbRejeuxApresErreur++;
      const e = { id: rep.json.order.id, client: t.c, clientNum: t.c.num, k: 10 + t.i, kind: 'prep', cle: t.body.idempotency_key, body: t.body, totals: t.totals, vus: {}, dernierVu: null, derniereHorloge: null, sondages: 0, echecsSondage: 0 };
      enregistrerCommande(e);
      prepEntrees.push(e);
    } else {
      anomalies.ajouter('création de commande', `préparation ${t.i} : HTTP ${rep.status} ${String(rep.text).slice(0, 120)}`);
    }
  });
  // ces commandes sont acceptées tout de suite (elles seront marquées « prête » pendant la rafale)
  prepEntrees.sort((a, b) => a.id - b.id);
  const aAccepter = prepEntrees.slice(compo.decide_accept + compo.decide_refuse, compo.decide_accept + compo.decide_refuse + compo.decide_ready);
  await enParallele(aAccepter, 10, async (e) => {
    const delay = rp.choix(DELAY_CHOICES);
    e.plan = { delayMinutes: delay };
    e.tDecisionEnvoyee = performance.now();
    const rep = await patron.post('owner_order_decide.php', { id: e.id, action: 'accept', delay_minutes: delay });
    verifierDecision(e, rep, 'accept');
    if (rep.status === 200) e.preAcceptee = true;
  });
  controle(prepEntrees.length === nbPrep && anomalies.compte('création de commande') === 0, `préparation : ${nbPrep} commandes supplémentaires créées, ${aAccepter.length} acceptées avant la rafale`, `${prepEntrees.length} créées, ${aAccepter.filter((e) => e.preAcceptee).length} acceptées`);
}
prepEntrees.sort((a, b) => a.id - b.id);
const aAccepterRafale = prepEntrees.slice(0, compo.decide_accept);
const aRefuserRafale = prepEntrees.slice(compo.decide_accept, compo.decide_accept + compo.decide_refuse);
const aPreteRafale = prepEntrees.slice(compo.decide_accept + compo.decide_refuse, compo.decide_accept + compo.decide_refuse + compo.decide_ready);
const enCourse = prepEntrees.slice(compo.decide_accept + compo.decide_refuse + compo.decide_ready);
for (const e of aAccepterRafale) { e.plan = { delayMinutes: rp.choix(DELAY_CHOICES) }; e.attenduFinal = 'accepted'; }
for (const e of aRefuserRafale) e.attenduFinal = 'refused';
for (const e of aPreteRafale) e.attenduFinal = 'ready';

// 3b. tâches de la rafale
const rr = rng(SEED + 777);
const soireeEntrees = [...registre.values()].filter((e) => e.kind === 'soiree');
const idsAvantRafale = new Set(registre.keys());
const nbAvantRafale = idsAvantRafale.size;
const taches = [];
const ajouter = (type, fn, verifier) => taches.push({ type, fn, verifier });
const lireOrderStatus = () => rr.choix(soireeEntrees);

for (let i = 0; i < compo.order_status; i++) {
  const e = lireOrderStatus();
  ajouter('order_status', async () => ({ rep: await e.client.get('order_status.php?id=' + e.id) }), ({ rep }) => {
    const o = rep.json && rep.json.order;
    if (rep.status !== 200 || !o) return `HTTP ${rep.status}`;
    if (o.id !== e.id || o.status !== e.finalLedger) return `commande ${e.id} : statut ${o.status} au lieu de ${e.finalLedger}`;
    if (o.total_cents !== e.totals.total_cents) return `commande ${e.id} : total ${o.total_cents}`;
    return null;
  });
}
for (let i = 0; i < compo.customer_orders; i++) {
  const c = rr.choix(clients);
  ajouter('customer_orders', async () => ({ rep: await c.get('customer_orders.php') }), ({ rep }) => {
    if (rep.status !== 200 || !rep.json || !Array.isArray(rep.json.orders)) return `HTTP ${rep.status}`;
    const connus = [...registre.values()].filter((e) => e.client === c && idsAvantRafale.has(e.id));
    for (const e of connus) {
      const o = rep.json.orders.find((x) => x.id === e.id);
      if (!o) return `commande ${e.id} absente de la liste du client ${c.num}`;
      if (e.kind === 'soiree' && o.status !== e.finalLedger) return `commande ${e.id} : statut ${o.status} au lieu de ${e.finalLedger}`;
    }
    if (rep.json.orders.length > 50) return 'plus de 50 commandes listées';
    return null;
  });
}
for (let i = 0; i < compo.customer_me; i++) {
  const c = rr.choix(clients);
  ajouter('customer_me', async () => ({ rep: await c.get('customer_me.php') }), ({ rep }) => (rep.status === 200 && rep.json && rep.json.customer && rep.json.customer.email === c.email ? null : `HTTP ${rep.status} ou client inattendu`));
}
for (let i = 0; i < compo.availability; i++) {
  const c = rr.choix(clients);
  ajouter('availability', async () => ({ rep: await c.get('availability.php') }), ({ rep }) => (rep.status === 200 && rep.json && Array.isArray(rep.json.pizzasIndisponibles) && Array.isArray(rep.json.ingredientsIndisponibles) ? null : `HTTP ${rep.status}`));
}
for (let i = 0; i < compo.owner_orders; i++) {
  ajouter('owner_orders', async () => ({ rep: await patron.get('owner_orders.php') }), ({ rep }) => {
    if (rep.status !== 200 || !rep.json || !Array.isArray(rep.json.orders)) return `HTTP ${rep.status}`;
    const ids = new Set(rep.json.orders.map((o) => o.id));
    if (ids.size !== rep.json.orders.length) return 'identifiants en double dans la liste';
    for (const id of idsAvantRafale) if (!ids.has(id)) return `commande ${id} créée avant la rafale absente de la liste du patron`;
    return null;
  });
}
for (let i = 0; i < compo.owner_me; i++) ajouter('owner_me', async () => ({ rep: await patron.get('owner_me.php') }), ({ rep }) => (rep.status === 200 && rep.json && rep.json.owner ? null : `HTTP ${rep.status}`));
for (let i = 0; i < compo.owner_settings; i++) ajouter('owner_settings', async () => ({ rep: await patron.get('owner_settings.php') }), ({ rep }) => (rep.status === 200 && DELAY_CHOICES.includes(rep.json && rep.json.default_delay_minutes) ? null : `HTTP ${rep.status}`));
for (let i = 0; i < compo.owner_availability; i++) ajouter('owner_availability', async () => ({ rep: await patron.get('owner_availability.php') }), ({ rep }) => (rep.status === 200 && rep.json && Array.isArray(rep.json.out) ? null : `HTTP ${rep.status}`));

// créations : nouvelles commandes (clients distincts), rejeux de commandes de la soirée, même clé envoyée plusieurs fois en même temps
const clientsCreation = rr.melanger(clients);
const nouvelles = [];
for (let i = 0; i < compo.order_create_nouvelle; i++) {
  const c = clientsCreation[i % clientsCreation.length];
  const { body, totals } = construireCommande(rr, { mode: rr.vrai(0.5) ? 'delivery' : 'pickup', ville: c.ville, cle: `ch12-raf${i}-c${c.num}-s${SEED}` });
  ajouter('order_create_nouvelle', async () => ({ rep: await c.post('order_create.php', body), c, body, totals }), ({ rep }) => {
    if (rep.status !== 201) return `HTTP ${rep.status} ${String(rep.text).slice(0, 100)}`;
    const ecarts = ecartsCreation(rep, body, totals, { rejeu: false });
    return ecarts.length ? ecarts.join(', ') : null;
  });
  nouvelles.push({ c, body, totals });
}
for (let i = 0; i < compo.order_create_rejeu; i++) {
  const e = rr.choix(soireeEntrees);
  ajouter('order_create_rejeu', async () => ({ rep: await e.client.post('order_create.php', e.body) }), ({ rep }) => {
    if (rep.status !== 200) return `HTTP ${rep.status} ${String(rep.text).slice(0, 100)}`;
    if (!rep.json || rep.json.replayed !== true || !rep.json.order || rep.json.order.id !== e.id) return `rejeu sans replayed=true ou autre identifiant (${rep.json && rep.json.order && rep.json.order.id} au lieu de ${e.id})`;
    return null;
  });
}
const clientDouble = rr.choix(clients);
const doubleCmd = construireCommande(rr, { mode: 'pickup', ville: clientDouble.ville, cle: `ch12-double-c${clientDouble.num}-s${SEED}` });
const sortiesDouble = [];
for (let i = 0; i < compo.order_create_double; i++) {
  ajouter('order_create_double', async () => { const rep = await clientDouble.post('order_create.php', doubleCmd.body); return { rep }; }, (s) => { sortiesDouble.push(s); return null; });
}

// décisions
for (const e of aAccepterRafale) {
  ajouter('decide_accept', async () => ({ rep: await patron.post('owner_order_decide.php', { id: e.id, action: 'accept', delay_minutes: e.plan.delayMinutes }) }), ({ rep }) => {
    if (rep.status !== 200 || !rep.json || rep.json.replayed !== false || rep.json.order.status !== 'accepted' || rep.json.order.delay_minutes !== e.plan.delayMinutes) return `HTTP ${rep.status} ${String(rep.text).slice(0, 120)}`;
    return null;
  });
}
for (const e of aRefuserRafale) {
  ajouter('decide_refuse', async () => ({ rep: await patron.post('owner_order_decide.php', { id: e.id, action: 'refuse' }) }), ({ rep }) => {
    if (rep.status !== 200 || !rep.json || rep.json.replayed !== false || rep.json.order.status !== 'refused') return `HTTP ${rep.status} ${String(rep.text).slice(0, 120)}`;
    return null;
  });
}
for (const e of aPreteRafale) {
  ajouter('decide_ready', async () => ({ rep: await patron.post('owner_order_decide.php', { id: e.id, action: 'ready' }) }), ({ rep }) => {
    if (rep.status !== 200 || !rep.json || rep.json.replayed !== false || rep.json.order.status !== 'ready' || !(rep.json.order.prepared_at >= rep.json.order.accepted_at)) return `HTTP ${rep.status} ${String(rep.text).slice(0, 120)}`;
    return null;
  });
}
const pretesSoiree = soireeEntrees.filter((e) => e.finalLedger === 'ready');
for (let i = 0; i < compo.decide_rejeu; i++) {
  const e = rr.choix(pretesSoiree);
  ajouter('decide_rejeu', async () => ({ rep: await patron.post('owner_order_decide.php', { id: e.id, action: 'ready' }) }), ({ rep }) => {
    if (rep.status !== 200 || !rep.json || rep.json.replayed !== true || rep.json.order.status !== 'ready') return `HTTP ${rep.status} ${String(rep.text).slice(0, 120)}`;
    return null;
  });
}
// course : trois ordres contradictoires en même temps sur la même commande « new » -> une seule transition, les autres en 409
const sortiesCourse = [];
for (const e of enCourse) {
  for (const corps of [{ id: e.id, action: 'accept', delay_minutes: 30 }, { id: e.id, action: 'refuse' }, { id: e.id, action: 'accept', delay_minutes: 40 }]) {
    ajouter('decide_course', async () => ({ rep: await patron.post('owner_order_decide.php', corps), e, corps }), (s) => { sortiesCourse.push(s); return null; });
  }
}

// comptes : inscriptions (bcrypt), connexions (bcrypt, nouveau navigateur = nouvelle boîte à cookies), changements d'adresse
const numerosRafale = Array.from({ length: compo.customer_signup }, (_, i) => 50000 + i);
for (const num of numerosRafale) {
  const ville = VILLES[num % VILLES.length];
  const corps = corpsInscription(num, { ville, prefixe: 'charge-rafale' });
  const nouveau = new ClientIP('inscrit-' + num, ipFictive(num));
  ajouter('customer_signup', async () => ({ rep: await nouveau.post('customer_signup.php', corps) }), ({ rep }) => (rep.status === 201 && rep.json && rep.json.customer && rep.json.customer.email === corps.email ? null : `HTTP ${rep.status} ${String(rep.text).slice(0, 100)}`));
}
// même e-mail inscrit en même temps depuis des adresses différentes : un seul compte, les autres en 409
const NUM_DOUBLE = 60000;
const corpsDouble = corpsInscription(NUM_DOUBLE, { ville: VILLES[0], prefixe: 'charge-double' });
const sortiesSignupDouble = [];
for (let i = 0; i < compo.signup_double; i++) {
  const nav = new ClientIP('inscrit-double-' + i, ipFictive(NUM_DOUBLE + 1 + i));
  ajouter('signup_double', async () => ({ rep: await nav.post('customer_signup.php', corpsDouble) }), (s) => { sortiesSignupDouble.push(s); return null; });
}
for (let i = 0; i < compo.customer_login; i++) {
  const c = clients[(i * 7) % clients.length];
  const navigateur = new ClientIP('connexion-' + c.num, ipFictive(c.num));
  ajouter('customer_login', async () => ({ rep: await navigateur.post('customer_login.php', { email: c.email, password: c.password }) }), ({ rep }) => (rep.status === 200 && rep.json && rep.json.customer && rep.json.customer.email === c.email ? null : `HTTP ${rep.status} ${String(rep.text).slice(0, 100)}`));
}
for (let i = 0; i < compo.customer_update_address; i++) {
  const c = clients[(i * 11 + 3) % clients.length];
  const rue = `${100 + i} avenue du Test`;
  ajouter('customer_update_address', async () => ({ rep: await c.post('customer_update_address.php', { street: rue, city: c.ville, housing_type: 'maison' }) }), ({ rep }) => (rep.status === 200 && rep.json && rep.json.customer && rep.json.customer.street === rue ? null : `HTTP ${rep.status} ${String(rep.text).slice(0, 100)}`));
}

const melanges = rr.melanger(taches);
console.log(`Rafale : ${melanges.length} requêtes (${[...new Set(melanges.map((t) => t.type))].length} types) lancées en même temps. Composition : ${COMPOSITION.map(([t]) => `${t} ${compo[t]}`).join(', ')}`);
await dormir(1500); // le calme avant la rafale
col.phase = 'rafale';
sonde.bouclePhase();
const mAvant = sonde.marque('avant la rafale');
const refusAvant = reseau.refus;
const tRafale0 = performance.now();
let terminees = 0;
let enVolMax = 0;
const jalons = [];
const lancerTache = async (t) => {
  let s;
  try { s = await t.fn(); } catch (err) { s = { rep: { status: 0, json: null, text: '' }, exception: String(err) }; }
  terminees++;
  if (terminees === Math.ceil(melanges.length / 2) || terminees === melanges.length) jalons.push([terminees, performance.now() - tRafale0]);
  return { t, s };
};
// Les 1000 requêtes partent par vagues de 100 dans la même boucle d'événements (un seul tour de boucle entre deux vagues) : le
// serveur peut accepter les connexions au fil de l'eau ; toutes restent en vol en même temps (aucune n'attend la fin d'une autre).
const promessesRafale = [];
for (let i = 0; i < melanges.length; i += 100) {
  for (const t of melanges.slice(i, i + 100)) promessesRafale.push(lancerTache(t));
  enVolMax = Math.max(enVolMax, promessesRafale.length - terminees);
  await new Promise((r) => setImmediate(r));
}
const tDerniereVague = performance.now() - tRafale0;
const sorties = await Promise.all(promessesRafale);
const dureeRafale = performance.now() - tRafale0;
const boucleRafale = sonde.bouclePhase();
const mRafale = sonde.marque('après la rafale');
const refusRafale = reseau.refus - refusAvant;
console.log(`  ${terminees}/${melanges.length} réponses reçues en ${arrondi(dureeRafale / 1000, 2)} s (dernière vague partie à ${arrondi(tDerniereVague)} ms, jusqu'à ${enVolMax} requêtes émises et pas encore terminées sur au plus ${pool.connexions} connexions TCP ; moitié des réponses à ${arrondi((jalons[0] || [0, 0])[1])} ms), ${arrondi(melanges.length / (dureeRafale / 1000))} requêtes/s`);
console.log(`  erreurs de connexion locales reprises pendant la rafale : ${refusRafale} (${Object.entries(reseau.parCode).map(([k, v]) => `${k} ${v}`).join(', ') || 'aucune'} sur toute l'exécution ; requêtes jamais arrivées au serveur, donc sans risque de doublon) ; abandons : ${reseau.abandons}`);

// ----- contrôles de la rafale
{
  const bilan = new Map();
  for (const { t, s } of sorties) {
    const b = bilan.get(t.type) || { n: 0, ecarts: [] };
    b.n++;
    let ecart = s.exception ? 'exception ' + s.exception : (s.rep.status === 0 ? 'erreur réseau ' + (s.rep.erreurReseau || '') : t.verifier(s));
    if (ecart) b.ecarts.push(ecart);
    bilan.set(t.type, b);
  }
  // enregistrement des nouvelles commandes créées pendant la rafale
  let nbNouvellesCreees = 0;
  for (const { t, s } of sorties) {
    if (t.type === 'order_create_nouvelle' && s.rep.status === 201 && s.rep.json && s.rep.json.order) {
      nb201++;
      nbNouvellesCreees++;
      enregistrerCommande({ id: s.rep.json.order.id, client: s.c, clientNum: s.c.num, k: 100, kind: 'rafale', cle: s.body.idempotency_key, body: s.body, totals: s.totals, attenduFinal: 'new' });
    }
  }
  // même clé envoyée en même temps : une seule création, tous les autres renvois sont des rejeux de la même commande
  const crees = sortiesDouble.filter((s) => s.rep.status === 201);
  const rejeux = sortiesDouble.filter((s) => s.rep.status === 200 && s.rep.json && s.rep.json.replayed === true);
  const idsDouble = new Set(sortiesDouble.map((s) => s.rep.json && s.rep.json.order && s.rep.json.order.id));
  controle(crees.length === 1 && rejeux.length === sortiesDouble.length - 1 && idsDouble.size === 1, `rafale : ${sortiesDouble.length} envois simultanés de la même clé d'idempotence = 1 seule commande (1 en 201, ${sortiesDouble.length - 1} rejeux en 200)`, `${crees.length} en 201, ${rejeux.length} rejeux, ${idsDouble.size} identifiant(s) distinct(s), statuts ${sortiesDouble.map((s) => s.rep.status).join(',')}`);
  if (crees.length === 1) {
    nb201++;
    enregistrerCommande({ id: crees[0].rep.json.order.id, client: clientDouble, clientNum: clientDouble.num, k: 200, kind: 'rafale', cle: doubleCmd.body.idempotency_key, body: doubleCmd.body, totals: doubleCmd.totals, attenduFinal: 'new' });
  } else if (idsDouble.size === 1 && [...idsDouble][0]) {
    // aucun 201 mais une commande existe : on la suit quand même pour les contrôles finaux
    anomalies.ajouter('rafale', 'envois simultanés : aucun 201 reçu');
  }
  // course : trois ordres contradictoires du patron en même temps sur la même commande -> une seule transition, les autres refusés en 409
  let conflitsAttendus = 0;
  {
    const ecarts = [];
    for (const e of enCourse) {
      const rs = sortiesCourse.filter((s) => s.e === e);
      const gagnants = rs.filter((s) => s.rep.status === 200 && s.rep.json && s.rep.json.replayed === false);
      const conflits = rs.filter((s) => s.rep.status === 409 && s.rep.json && s.rep.json.error === 'already_decided');
      conflitsAttendus += conflits.length;
      if (rs.length !== 3 || gagnants.length !== 1 || conflits.length !== 2) {
        ecarts.push(`commande ${e.id} : ${rs.map((s) => s.corps.action + ':' + s.rep.status + (s.rep.json && s.rep.json.replayed !== undefined ? (s.rep.json.replayed ? 'R' : '') : '')).join(' ')}`);
        continue;
      }
      const g = gagnants[0];
      const final = g.corps.action === 'accept' ? 'accepted' : 'refused';
      if (g.rep.json.order.status !== final || (final === 'accepted' && g.rep.json.order.delay_minutes !== g.corps.delay_minutes)) ecarts.push(`commande ${e.id} : réponse gagnante incohérente`);
      for (const c of conflits) if (c.rep.json.status !== final || c.rep.json.delay_minutes !== (final === 'accepted' ? g.corps.delay_minutes : null)) ecarts.push(`commande ${e.id} : le 409 annonce ${c.rep.json.status}/${c.rep.json.delay_minutes} au lieu de ${final}/${g.corps.delay_minutes}`);
      e.attenduFinal = final;
      if (final === 'accepted') e.plan = { delayMinutes: g.corps.delay_minutes };
    }
    controle(ecarts.length === 0 && enCourse.length === nbCourse, `rafale : ${enCourse.length} commandes recevant en même temps « accepter 30 », « refuser » et « accepter 40 » : une seule décision retenue, les 2 autres en 409 already_decided`, ecarts.length ? `${ecarts.length} écart(s), ex. ${ecarts[0]}` : `${sortiesCourse.length} ordres, ${enCourse.filter((e) => e.attenduFinal === 'accepted').length} commandes acceptées / ${enCourse.filter((e) => e.attenduFinal === 'refused').length} refusées`);
  }
  // même e-mail inscrit en même temps : un seul compte
  {
    const cree = sortiesSignupDouble.filter((s) => s.rep.status === 201);
    const pris = sortiesSignupDouble.filter((s) => s.rep.status === 409 && s.rep.json && s.rep.json.error === 'email_taken');
    conflitsAttendus += pris.length;
    controle(cree.length === 1 && pris.length === sortiesSignupDouble.length - 1, `rafale : ${sortiesSignupDouble.length} inscriptions simultanées avec le même e-mail = 1 seul compte (1 en 201, ${sortiesSignupDouble.length - 1} en 409 email_taken)`, `${cree.length} en 201, ${pris.length} en 409, statuts ${sortiesSignupDouble.map((s) => s.rep.status).join(',')}`);
  }
  for (const [type, b] of [...bilan.entries()].sort()) {
    if (['order_create_double', 'decide_course', 'signup_double'].includes(type)) continue; // contrôlés ci-dessus
    controle(b.ecarts.length === 0, `rafale : ${type} (${b.n} requêtes) toutes conformes`, b.ecarts.length ? `${b.ecarts.length} écart(s), ex. ${b.ecarts[0]}` : 'ok');
  }
  controle(terminees === melanges.length, `rafale : ${melanges.length} requêtes simultanées toutes terminées`, `${terminees}/${melanges.length}`);
  const sR = col.stat({ phase: 'rafale' });
  controle(sR.c5xx === 0, 'rafale : aucune erreur 5xx', `${sR.c5xx} sur ${sR.n}`);
  controle(sR.reseau === 0, 'rafale : aucune erreur réseau (les erreurs de connexion locales du poste sont reprises, voir plus haut)', `${sR.reseau} sur ${sR.n}`);
  controle(sR.c4xx === conflitsAttendus, 'rafale : aucune réponse 4xx inattendue (seuls les 409 des courses voulues)', `${sR.c4xx} en 4xx pour ${conflitsAttendus} conflit(s) voulu(s)`);
  controle(dureeRafale < SEUILS.rafale.dureeMs, `rafale : les ${melanges.length} requêtes sont servies en moins de ${SEUILS.rafale.dureeMs / 1000} s`, `${arrondi(dureeRafale / 1000, 2)} s`);
  controle(sR.p99 < SEUILS.rafale.p99Ms, `rafale : latence p99 < ${SEUILS.rafale.p99Ms / 1000} s (toutes routes, 1000 requêtes en même temps)`, `p50 ${arrondi(sR.p50)} ms, p95 ${arrondi(sR.p95)} ms, p99 ${arrondi(sR.p99)} ms, max ${arrondi(sR.max)} ms`);
  console.log(col.tableau(`\nMesures de la rafale (durées client en ms ; ${arrondi(dureeRafale / 1000, 2)} s)`, { phase: 'rafale' }));
  console.log(`  boucle d'événements pendant la rafale : moy ${arrondi(boucleRafale.moy)} ms, p50 ${arrondi(boucleRafale.p50)} ms, p99 ${arrondi(boucleRafale.p99)} ms, max ${arrondi(boucleRafale.max)} ms, utilisation ${arrondi(boucleRafale.utilisation * 100, 0)} %`);
  console.log(`  mémoire : rss ${mo(mAvant.rss)} Mo avant, ${mo(mRafale.rss)} Mo après, pic ${mo(sonde.rssMax(tRafale0))} Mo pendant la rafale`);
}

// ---------------------------------------------------------------------------------------------------------------------
// PHASE 4 — contrôles d'intégrité finaux (la base est lue pendant le calme : plus aucune requête en cours)
// ---------------------------------------------------------------------------------------------------------------------
console.log('\n=== PHASE 4 : intégrité finale ===');
col.phase = 'verif';
await dormir(1000);
const db = site.db;
const lignes = db.prepare('SELECT * FROM orders ORDER BY id').all();
const lignesArticles = db.prepare('SELECT order_id, position, name, variant, qty, unit_price_cents, line_total_cents FROM order_items ORDER BY order_id, position').all();
const nbEnBase = db.prepare('SELECT COUNT(*) AS n FROM orders').get().n;
const nbClientsBase = db.prepare('SELECT COUNT(*) AS n FROM customers').get().n;
const articlesParCommande = new Map();
for (const a of lignesArticles) { if (!articlesParCommande.has(a.order_id)) articlesParCommande.set(a.order_id, []); articlesParCommande.get(a.order_id).push(a); }

{
  const confirmees = nb201 + nbRejeuxApresErreur;
  controle(nbEnBase === nb201 && nbRejeuxApresErreur === 0, 'intégrité : nombre de commandes en base = nombre de réponses 201', `${nbEnBase} en base, ${nb201} réponses 201${nbRejeuxApresErreur ? `, +${nbRejeuxApresErreur} confirmée(s) par rejeu après erreur réseau` : ''}, ${registre.size} suivies par le test`);
  controle(nbEnBase === registre.size && confirmees === registre.size, 'intégrité : toutes les commandes de la base sont connues du test (ni commande fantôme, ni commande perdue)', `${nbEnBase} en base, ${registre.size} dans le registre du test`);
  const inconnues = lignes.filter((o) => !registre.has(o.id)).length;
  const absentes = [...registre.keys()].filter((id) => !lignes.some((o) => o.id === id)).length;
  controle(inconnues === 0 && absentes === 0, 'intégrité : identifiants de la base = identifiants reçus du serveur', `${inconnues} en base non reçue(s), ${absentes} reçue(s) absente(s) de la base`);
  const parStatut = {};
  for (const o of lignes) parStatut[o.status] = (parStatut[o.status] || 0) + 1;
  console.log(`  base : ${nbEnBase} commandes (${Object.entries(parStatut).map(([k, v]) => `${k} ${v}`).join(', ')}), ${lignesArticles.length} lignes d'articles, ${nbClientsBase} clients`);
  const nbClientsAttendus = NB_CLIENTS + compo.customer_signup + 1;
  const nbDoubleBase = db.prepare('SELECT COUNT(*) AS n FROM customers WHERE email = ?').get(corpsDouble.email.toLowerCase()).n;
  const doublonsEmail = db.prepare('SELECT email, COUNT(*) AS n FROM customers GROUP BY email HAVING COUNT(*) > 1').all();
  controle(nbClientsBase === nbClientsAttendus && nbDoubleBase === 1 && doublonsEmail.length === 0, "intégrité : comptes clients en base = comptes créés (ceux de la soirée + inscriptions de la rafale + 1 pour l'e-mail inscrit en double), aucun e-mail en double", `${nbClientsBase} comptes (attendu ${nbClientsAttendus}), ${nbDoubleBase} pour l'e-mail inscrit ${compo.signup_double} fois en même temps, ${doublonsEmail.length} e-mail(s) en double`);

  // doublons
  const doublonsCle = db.prepare('SELECT customer_id, idempotency_key, COUNT(*) AS n FROM orders GROUP BY customer_id, idempotency_key HAVING COUNT(*) > 1').all();
  const doublonsLigne = db.prepare('SELECT order_id, position, COUNT(*) AS n FROM order_items GROUP BY order_id, position HAVING COUNT(*) > 1').all();
  const orphelines = db.prepare('SELECT COUNT(*) AS n FROM order_items WHERE order_id NOT IN (SELECT id FROM orders)').get().n;
  const sansLigne = lignes.filter((o) => !articlesParCommande.has(o.id)).length;
  controle(doublonsCle.length === 0 && new Set(lignes.map((o) => o.customer_id + '|' + o.idempotency_key)).size === lignes.length, 'intégrité : aucun doublon (client, clé d\'idempotence)', `${doublonsCle.length} doublon(s)`);
  controle(doublonsLigne.length === 0 && orphelines === 0 && sansLigne === 0, 'intégrité : lignes d\'articles sans doublon, sans orpheline, présentes pour chaque commande', `${doublonsLigne.length} doublon(s), ${orphelines} orpheline(s), ${sansLigne} commande(s) sans ligne`);
  // même contenu envoyé deux fois sous deux clés différentes : n'existe pas ici (les clés sont uniques par commande) ; on vérifie le nombre par client
  const parClientBase = new Map();
  for (const o of lignes) parClientBase.set(o.customer_id, (parClientBase.get(o.customer_id) || 0) + 1);
  const parClientTest = new Map();
  for (const e of registre.values()) parClientTest.set(e.client.customer.id, (parClientTest.get(e.client.customer.id) || 0) + 1);
  const ecartsParClient = [...parClientTest.entries()].filter(([id, n]) => parClientBase.get(id) !== n).length;
  controle(ecartsParClient === 0 && parClientBase.size === parClientTest.size, 'intégrité : nombre de commandes par client identique en base et chez le test', `${ecartsParClient} client(s) en écart sur ${parClientTest.size}`);

  // statuts et dates
  const probleme = new Map();
  const noter = (famille, o, detail) => { if (!probleme.has(famille)) probleme.set(famille, []); probleme.get(famille).push(`commande ${o.id}: ${detail}`); };
  for (const o of lignes) {
    const e = registre.get(o.id);
    if (!['new', 'accepted', 'ready', 'refused'].includes(o.status)) noter('statut inconnu', o, o.status);
    for (const champ of ['created_at', 'accepted_at', 'refused_at', 'prepared_at']) if (o[champ] !== null && !ISO_UTC.test(o[champ])) noter('date illisible', o, `${champ}=${o[champ]}`);
    if (o.status === 'new' && (o.accepted_at !== null || o.refused_at !== null || o.prepared_at !== null || o.delay_minutes !== null)) noter('« new » avec dates ou délai', o, 'champs de décision renseignés');
    if (o.status === 'accepted' && (o.accepted_at === null || o.delay_minutes === null || o.prepared_at !== null || o.refused_at !== null)) noter('« accepted » incohérente', o, `accepted_at=${o.accepted_at} delay=${o.delay_minutes} prepared_at=${o.prepared_at}`);
    if (o.status === 'ready' && (o.accepted_at === null || o.prepared_at === null || o.delay_minutes === null || o.refused_at !== null)) noter('« ready » incohérente', o, `accepted_at=${o.accepted_at} prepared_at=${o.prepared_at}`);
    if (o.status === 'refused' && (o.refused_at === null || o.accepted_at !== null || o.prepared_at !== null || o.delay_minutes !== null)) noter('« refused » incohérente', o, `refused_at=${o.refused_at} accepted_at=${o.accepted_at}`);
    if (o.accepted_at !== null && !(o.created_at <= o.accepted_at)) noter('accepted_at < created_at', o, `${o.created_at} > ${o.accepted_at}`);
    if (o.refused_at !== null && !(o.created_at <= o.refused_at)) noter('refused_at < created_at', o, `${o.created_at} > ${o.refused_at}`);
    if (o.accepted_at !== null && o.prepared_at !== null && !(o.accepted_at <= o.prepared_at)) noter('accepted_at > prepared_at', o, `${o.accepted_at} > ${o.prepared_at}`);
    if (o.delay_minutes !== null && !DELAY_CHOICES.includes(o.delay_minutes)) noter('délai hors liste', o, `${o.delay_minutes}`);
    if (o.total_cents !== o.products_cents - o.promo_cents + o.delivery_fee_cents) noter('total ≠ produits - promo + frais', o, `${o.total_cents} vs ${o.products_cents}-${o.promo_cents}+${o.delivery_fee_cents}`);
    if (jourParis(o.created_at) !== o.service_day) noter('service_day ≠ jour (Paris) de created_at', o, `${o.service_day} vs ${jourParis(o.created_at)}`);
    if (o.mode === 'pickup' && (o.delivery_fee_cents !== 0 || o.delivery_street !== null)) noter('commande à emporter avec frais ou adresse', o, `frais ${o.delivery_fee_cents}`);
    if (o.mode === 'delivery' && (o.delivery_city === null || o.delivery_street === null)) noter('livraison sans adresse', o, 'adresse vide');
    if (e) {
      const attendu = e.kind === 'soiree' ? e.finalLedger : e.attenduFinal;
      if (attendu !== undefined && o.status !== attendu) noter('statut final ≠ celui attendu', o, `${o.status} au lieu de ${attendu}`);
      if ((e.kind === 'soiree' || e.attenduFinal === 'accepted' || e.attenduFinal === 'ready') && e.plan && o.status !== 'new' && o.status !== 'refused' && o.delay_minutes !== e.plan.delayMinutes) noter('délai ≠ celui décidé', o, `${o.delay_minutes} au lieu de ${e.plan.delayMinutes}`);
      if (o.customer_id !== e.client.customer.id) noter('client ≠ celui qui a commandé', o, `${o.customer_id}`);
      if (o.mode !== e.body.mode || o.total_cents !== e.totals.total_cents || o.promo_cents !== e.totals.promo_cents || o.delivery_fee_cents !== e.totals.delivery_fee_cents || o.products_cents !== e.totals.products_cents) noter('montants ≠ ceux envoyés', o, `total ${o.total_cents}/${e.totals.total_cents}`);
      if (o.idempotency_key !== e.cle) noter('clé ≠ celle envoyée', o, o.idempotency_key);
      let methodes = null;
      try { methodes = JSON.parse(o.payment_methods); } catch { /* signalé */ }
      if (!Array.isArray(methodes) || JSON.stringify(methodes) !== JSON.stringify(e.body.payment_methods)) noter('moyens de paiement ≠ ceux envoyés', o, String(o.payment_methods));
      const lignesBase = articlesParCommande.get(o.id) || [];
      if (lignesBase.length !== e.body.items.length) noter('nombre de lignes ≠ celui envoyé', o, `${lignesBase.length} au lieu de ${e.body.items.length}`);
      lignesBase.forEach((a, i) => {
        const s = e.body.items[i];
        if (!s || a.position !== i || a.qty !== s.qty || a.unit_price_cents !== s.unit_price_cents || a.variant !== s.variant || a.line_total_cents !== s.qty * s.unit_price_cents) noter('ligne ≠ celle envoyée', o, `position ${a.position}`);
      });
      const somme = lignesBase.reduce((t, a) => t + a.line_total_cents, 0);
      if (somme !== o.products_cents) noter('somme des lignes ≠ products_cents', o, `${somme} vs ${o.products_cents}`);
    }
  }
  const familles = [...probleme.entries()];
  const familleTexte = (noms) => noms.map((n) => `${n}: ${(probleme.get(n) || []).length}`).join(' ; ');
  const nbProblemes = familles.reduce((s, [, l]) => s + l.length, 0);
  controle(nbProblemes === 0, `intégrité : ${nbEnBase} commandes en base, statut final et dates cohérents (new / accepted / ready / refused, created_at <= accepted_at <= prepared_at, délai, total, service_day, montants et lignes identiques à l'envoi)`, nbProblemes === 0 ? 'aucun écart' : `${nbProblemes} écart(s) : ${familles.map(([k, l]) => `${k} (${l.length}, ex. ${l[0]})`).slice(0, 4).join(' | ')}`);
  const accepteesPrepa = lignes.filter((o) => o.accepted_at !== null && o.prepared_at !== null);
  const ecartsAP = accepteesPrepa.filter((o) => !(o.accepted_at <= o.prepared_at)).length;
  controle(accepteesPrepa.length > 0 && ecartsAP === 0, 'intégrité : accepted_at <= prepared_at sur toutes les commandes prêtes', `${accepteesPrepa.length} commandes prêtes, ${ecartsAP} en écart`);
  const prepaMinMs = accepteesPrepa.map((o) => (utcToEpoch(o.prepared_at) - utcToEpoch(o.accepted_at)) * 1000);
  console.log(`  « prête » en base : ${accepteesPrepa.length} commandes ; durée acceptée -> prête (secondes) : min ${Math.min(...prepaMinMs) / 1000}, max ${Math.max(...prepaMinMs) / 1000}`);
  // une même commande (clé) n'existe qu'une fois, et le total des 201 = total en base ; répartition par client
  controle(cles.size === registre.size, 'intégrité : une clé d\'idempotence = une commande', `${cles.size} clés, ${registre.size} commandes`);
}

// owner_orders : toutes les commandes du jour (et les nouvelles de tous les jours)
{
  const rep = await patron.get('owner_orders.php');
  const attendues = lignes.filter((o) => o.status === 'new' || o.service_day === jourParis(utcAt(Math.floor(Date.now() / 1000))));
  const liste = rep.status === 200 && rep.json && Array.isArray(rep.json.orders) ? rep.json.orders : [];
  const idsListe = new Set(liste.map((o) => o.id));
  const manquantes = attendues.filter((o) => !idsListe.has(o.id));
  const enTrop = liste.filter((o) => !lignes.some((b) => b.id === o.id));
  const memeJour = new Set(lignes.map((o) => o.service_day)).size === 1;
  controle(rep.status === 200 && manquantes.length === 0 && enTrop.length === 0 && liste.length === attendues.length, `intégrité : owner_orders renvoie toutes les commandes du jour (${memeJour ? 'un seul jour de service' : 'plusieurs jours de service : nouvelles + jour courant'})`, `${liste.length} renvoyées, ${attendues.length} attendues, ${manquantes.length} manquante(s), ${enTrop.length} en trop, ${Math.round(rep.text.length / 1024)} Ko`);
  const octetsParCommande = rep.text.length / Math.max(1, liste.length);
  controle(rep.text.length < SEUILS.chargeUtileOwnerOrdersOctets, 'charge : la réponse de owner_orders (toute la journée, lignes comprises) reste sous 4,5 Mo (limite de charge utile d\'une fonction Vercel)', `${arrondi(rep.text.length / 1048576, 2)} Mo pour ${liste.length} commandes, soit ${Math.round(octetsParCommande)} octets par commande : la limite serait atteinte vers ${Math.floor(SEUILS.chargeUtileOwnerOrdersOctets / octetsParCommande)} commandes dans la journée`);
  const ecartsListe = liste.filter((o) => { const b = lignes.find((x) => x.id === o.id); return !b || o.status !== b.status || o.total_cents !== b.total_cents || o.accepted_at !== b.accepted_at || o.prepared_at !== b.prepared_at || o.refused_at !== b.refused_at; }).length;
  controle(ecartsListe === 0, 'intégrité : chaque commande de owner_orders reprend exactement statut, total et dates de la base', `${ecartsListe} écart(s) sur ${liste.length}`);
  const tri = liste.every((o, i) => i === 0 || liste[i - 1].created_at < o.created_at || (liste[i - 1].created_at === o.created_at && liste[i - 1].id < o.id));
  controle(tri, 'intégrité : owner_orders trié par date puis identifiant', tri ? 'ordre respecté' : 'ordre rompu');
}

// côté client : chaque client relit ses commandes (order_status et customer_orders) et retrouve exactement la base
{
  const parId = new Map(lignes.map((o) => [o.id, o]));
  const tousLesClients = [...new Set([...registre.values()].map((e) => e.client))];
  const ecartsStatut = [];
  await enParallele([...registre.values()], 20, async (e) => {
    const rep = await e.client.get('order_status.php?id=' + e.id);
    const b = parId.get(e.id);
    const o = rep.json && rep.json.order;
    if (rep.status !== 200 || !o || !b) { ecartsStatut.push(`commande ${e.id} : HTTP ${rep.status}`); return; }
    if (o.status !== b.status || o.total_cents !== b.total_cents || o.delay_minutes !== b.delay_minutes || o.accepted_at !== b.accepted_at || o.prepared_at !== b.prepared_at || o.refused_at !== b.refused_at) ecartsStatut.push(`commande ${e.id} : ${o.status} (base ${b.status})`);
  });
  controle(ecartsStatut.length === 0, `intégrité : order_status de chacune des ${registre.size} commandes = base (statut, délai, dates, total), lu par son client`, ecartsStatut.length ? `${ecartsStatut.length} écart(s), ex. ${ecartsStatut[0]}` : 'aucun écart');
  const ecartsListes = [];
  await enParallele(tousLesClients, 20, async (c) => {
    const rep = await c.get('customer_orders.php');
    const mesCommandes = lignes.filter((o) => o.customer_id === c.customer.id).sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : b.id - a.id));
    const liste = rep.json && rep.json.orders;
    if (rep.status !== 200 || !Array.isArray(liste)) { ecartsListes.push(`client ${c.num} : HTTP ${rep.status}`); return; }
    const attendu = mesCommandes.slice(0, 50).map((o) => `${o.id}:${o.status}`).join(',');
    const recu = liste.map((o) => `${o.id}:${o.status}`).join(',');
    if (attendu !== recu) ecartsListes.push(`client ${c.num} : ${recu} au lieu de ${attendu}`);
  });
  controle(ecartsListes.length === 0, `intégrité : customer_orders de chacun des ${tousLesClients.length} clients = ses commandes en base (ordre, statuts)`, ecartsListes.length ? `${ecartsListes.length} écart(s), ex. ${ecartsListes[0]}` : 'aucun écart');
  // un client ne voit jamais la commande d'un autre (échantillon de 40 lectures croisées)
  const rx = rng(SEED + 999);
  let fuites = 0;
  let essais = 0;
  for (let i = 0; i < 40; i++) {
    const e = rx.choix([...registre.values()]);
    const autre = rx.choix(clients.filter((c) => c !== e.client));
    const rep = await autre.get('order_status.php?id=' + e.id);
    essais++;
    if (rep.status !== 404) fuites++;
  }
  controle(fuites === 0, 'intégrité : un client ne peut pas lire la commande d\'un autre (404)', `${essais} lectures croisées, ${fuites} fuite(s)`);
}

// journal du serveur : aucune erreur 5xx, aucune donnée de commande
{
  const journal = site.journal();
  const lignesJournal = journal.split('\n').filter(Boolean);
  const erreurs500 = lignesJournal.filter((l) => /\b5\d\d\b|server_error/.test(l));
  controle(erreurs500.length === 0, 'journal du serveur : aucune erreur 5xx / server_error', `${lignesJournal.length} ligne(s)${erreurs500[0] ? ', ex. ' + erreurs500[0].slice(0, 160) : ''}`);
  const donneesPerso = lignesJournal.filter((l) => /@example\.test|Client\d|rue des Tests|Essai-/.test(l));
  controle(donneesPerso.length === 0, 'journal du serveur : aucune donnée personnelle (e-mail, nom, adresse, mot de passe)', `${donneesPerso.length} ligne(s)`);
}

// ---------------------------------------------------------------------------------------------------------------------
// Mémoire, durée, résumé
// ---------------------------------------------------------------------------------------------------------------------
await dormir(2000);
const mFin = sonde.marque('fin (après nettoyage)', { nettoyer: true });
const rssPic = sonde.rssMax();
const tasPic = sonde.tasMax();
console.log('\nMémoire du processus (serveur + test + base dans un seul processus) :');
for (const m of sonde.marques) console.log(`  ${m.nom.padEnd(26)} rss ${String(mo(m.rss)).padStart(7)} Mo   tas JS ${String(mo(m.tas)).padStart(7)} Mo   externe ${String(mo(m.externe)).padStart(6)} Mo`);
console.log(`  pic de rss sur toute l'exécution : ${mo(rssPic)} Mo ; pic du tas JS : ${mo(tasPic)} Mo`);
controle(mo(rssPic) < SEUILS.rssMaxMo, `mémoire : pic de rss < ${SEUILS.rssMaxMo} Mo`, `${mo(rssPic)} Mo (début ${mo(m0.rss)} Mo, fin ${mo(mFin.rss)} Mo)`);
controle(mo(mFin.rss - m0.rss) < SEUILS.rssCroissanceFinMo, `mémoire : croissance du rss entre le début et la fin < ${SEUILS.rssCroissanceFinMo} Mo`, `+${mo(mFin.rss - m0.rss)} Mo`);
if (sonde.gc) controle(mo(mFin.tas) < SEUILS.tasApresNettoyageMo, `mémoire : tas JS après nettoyage < ${SEUILS.tasApresNettoyageMo} Mo (pas de fuite côté JavaScript)`, `${mo(mFin.tas)} Mo après nettoyage (début ${mo(m0.tas)} Mo)`);
const dureeTotale = (performance.now() - T_SCRIPT) / 1000;
controle(dureeTotale < SEUILS.dureeTotaleS, `durée totale du script < ${SEUILS.dureeTotaleS} s`, `${arrondi(dureeTotale, 1)} s`);

console.log(col.tableau('\nBilan par route, toutes phases (inscriptions, soirée, préparation, rafale, vérifications ; durées client en ms)'));
const sGlobal = col.stat();
console.log(`\nTotal : ${sGlobal.n} requêtes HTTP, ${sGlobal.c5xx} en 5xx, ${sGlobal.reseau} erreurs réseau, ${sGlobal.c4xx} en 4xx.`);
if (anomalies.exemples.length) { console.log('\nAnomalies relevées par les scénarios (25 premières) :'); for (const x of anomalies.exemples) console.log('  - ' + x); }

clearTimeout(chien);
console.log(`\nRésumé : ${nbPass + nbFail} contrôles, ${nbPass} PASS, ${nbFail} FAIL, durée ${arrondi(dureeTotale, 1)} s${COMPLET ? '' : ' [MODE RÉDUIT : non officiel]'}`);
if (nbFail) { console.log('Contrôles en échec :'); for (const l of echecs) console.log('  ' + l); }
await terminer(nbFail === 0 ? 0 : 1);
