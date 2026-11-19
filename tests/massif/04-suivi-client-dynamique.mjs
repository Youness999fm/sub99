// Batterie 04 — suivi client dynamique : le statut d'une commande se met à jour TOUT SEUL sur la page du client (Chrome réel).
//   node tests/massif/lancer.mjs tests/massif/04-suivi-client-dynamique.mjs --timeout=480
//   (option de mise au point : --phases=1,2,3,4 pour n'exécuter que certaines phases)
//
// Phase 1 : 8 pages de suivi ouvertes en même temps (à emporter et livraison, un client par page), JAMAIS rechargées (marqueur dans la
//           page, aucune navigation) ; le patron accepte (délais 20/30/40/50/60), refuse, marque « prête » à des instants décalés ;
//           pour chaque transition : délai action du patron -> changement du DOM, textes, minuteur, signaux (Notification, vibration,
//           titre de l'onglet), cadence et arrêt du sondage (requêtes réseau order_status comptées).
// Phase 2 : page ouverte APRÈS le changement (état direct, aucun signal) ; deux onglets sur la même commande.
// Phase 3 : fin du minuteur (« prête » / « livreur ») et expiration du suivi, par l'horloge du SERVEUR avancée (jamais d'attente > 60 s).
// Phase 4 : 30 min sans changement d'état (horloge de la PAGE avancée de 31 min) : une commande acceptée (délai jusqu'à 60 min) reste
//           suivie jusqu'à « prête » ; une commande restée « en attente » met le suivi en pause, qui reprend au retour au premier plan.
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { demarrerSite } from './lib/env.mjs';
import { creerClients, patronConnecte } from './lib/clients.mjs';
import { rng, construireCommande } from './lib/commandes.mjs';
import { avecNavigateur } from './lib/chrome.mjs';
import { ouvrirSuivi, sleep, stats, sec, texteStats, intervallesSondage, secondesMinuteur } from './lib/04-suivi.mjs';

const DEBUT = Date.now();
const BUDGET_MS = 450000; // le lanceur coupe à 480 s : le script se termine proprement avant
const PHASES = (process.argv.find((a) => a.startsWith('--phases=')) || '--phases=1,2,3,4').slice(9).split(',');
const veut = (n) => PHASES.includes(String(n));

// ---------------------------------------------------------------------------------------------------------------- compte rendu
let nbPass = 0;
let nbFail = 0;
const lignesFail = [];
const mesures = {};
const metriquesTexte = [];
const lag = monitorEventLoopDelay({ resolution: 20 });
lag.enable();

function controle(ok, libelle, observe = '') {
  const bon = Boolean(ok);
  const suite = observe !== '' ? ' — ' + observe : '';
  if (bon) nbPass++; else { nbFail++; lignesFail.push(libelle + suite); }
  console.log(`  ${bon ? 'PASS' : 'FAIL'}  ${libelle}${suite}`);
  return bon;
}
/** Contrôle regroupé : [nom, ok, valeur observée]. PASS = tous vrais ; FAIL = liste des écarts avec leurs valeurs. */
function groupe(libelle, elements) {
  const mauvais = elements.filter((e) => !e[1]);
  const detail = mauvais.length ? 'ÉCARTS ' + mauvais.map((e) => `${e[0]} = ${e[2]}`).join(' ; ') : elements.map((e) => e[0]).join(' · ');
  return controle(mauvais.length === 0, libelle, detail);
}
const section = (t) => console.log(`\n== ${t} == (+${Math.round((Date.now() - DEBUT) / 1000)} s)`);
const info = (t) => console.log('  ·  ' + t);
const mesurer = (nom, ms) => { (mesures[nom] ||= []).push(ms); };
const json = (v) => JSON.stringify(v);

// ---------------------------------------------------------------------------------------------------------------- référence
const TITRE_DE_BASE = 'Suivi de commande — Subito Pizza Hénin-Beaumont';
const SONDAGE_ATTENTE_MS = 4000;
const SONDAGE_ACCEPTEE_MS = 5000;
const MARGE_MS = 2000;
const BORNE_ATTENTE = SONDAGE_ATTENTE_MS + MARGE_MS;
const BORNE_ACCEPTEE = SONDAGE_ACCEPTEE_MS + MARGE_MS;
const SILENCE_MS = 10500; // plus de deux périodes du sondage le plus lent (5 s)

function signalAttendu(ev, mode) {
  if (ev === 'accepted') return { titre: 'Commande acceptée', corps: 'Le restaurant prépare votre commande.', motif: [200] };
  if (ev === 'ready') {
    return { titre: 'Votre commande est prête !', corps: mode === 'delivery' ? 'Votre livreur arrive chez vous.' : 'Vous pouvez venir la récupérer au restaurant.', motif: [300, 150, 300] };
  }
  return { titre: 'Commande refusée', corps: 'Merci d’appeler le restaurant pour plus d’informations.', motif: [200] };
}
const titreCache = (ev, mode) => `● ${signalAttendu(ev, mode).titre} — Subito Pizza`;
const eur = (cents) => (cents / 100).toFixed(2).replace('.', ',') + ' €';
const LIBELLES_PAIEMENT = { card: 'Carte bancaire', cash: 'Espèces', ticket: 'Ticket Restaurant', ticket_card: 'Carte Ticket Restaurant' };
const paiementAttendu = (o) => o.payment_methods
  .map((m) => LIBELLES_PAIEMENT[m] + (m === 'cash' ? (o.cash_change_for ? ` (billet de ${o.cash_change_for} €)` : ' (appoint exact)') : '')).join(' · ');
const etiquette = (c) => `[${c.cle} ${c.mode === 'delivery' ? 'livraison' : 'emporter'}]`;

// Commandes du test : P1..P8 (phase 1), T (phase 2), S1 S2 S3 (phase 4), R1 R2 (phase 3).
const COMMANDES = [
  { cle: 'P1', mode: 'pickup', delai: 20, fin: 'ready' },
  { cle: 'P2', mode: 'delivery', delai: 30, fin: 'ready' },
  { cle: 'P3', mode: 'pickup', delai: 40, fin: 'ready' },
  { cle: 'P4', mode: 'delivery', delai: 50, fin: 'ready' },
  { cle: 'P5', mode: 'pickup', delai: 60, fin: 'ready' },
  { cle: 'P6', mode: 'delivery', fin: 'refused' },
  { cle: 'P7', mode: 'pickup', fin: 'refused', geste: false },
  { cle: 'P8', mode: 'delivery', delai: 30, fin: 'ready', saut: true },
  { cle: 'T', mode: 'pickup', delai: 30 },
  { cle: 'S1', mode: 'pickup', delai: 60 },
  { cle: 'S2', mode: 'delivery', delai: 50 },
  { cle: 'S3', mode: 'delivery', delai: 30 },
  { cle: 'R1', mode: 'pickup', delai: 20 },
  { cle: 'R2', mode: 'delivery', delai: 20 }
];
const C = Object.fromEntries(COMMANDES.map((c) => [c.cle, c]));
const SCEN = COMMANDES.slice(0, 8);
for (const c of COMMANDES) c.geste = c.geste !== false;

// ---------------------------------------------------------------------------------------------------------------- vérifications de DOM
const enteteAttendue = (c) => `Commande de ${c.commande.customer_name} — ${c.mode === 'delivery' ? 'Livraison' : 'À emporter'}`;

function elementsEntete(c, l) {
  return [
    ['en-tête', l.numero === enteteAttendue(c), l.numero],
    ['total', l.total === eur(c.commande.total_cents), l.total],
    ['lignes', l.nbLignes === c.commande.items.length, l.nbLignes],
    ['paiement', c.mode === 'delivery' ? l.paiement === paiementAttendu(c.commande) : l.paiement === null, l.paiement]
  ];
}
function elementsNew(c, l) {
  return [
    ['data-order-status', l.statut === 'new', l.statut],
    ['classe --pending', /order-track-status--pending/.test(l.classe || ''), l.classe],
    ['« En attente de confirmation du restaurant… »', (l.texteStatut || '').includes('En attente de confirmation du restaurant…'), l.texteStatut],
    ['« se met à jour toute seule »', (l.indice || '').includes('Cette page se met à jour toute seule, inutile de recharger.'), l.indice],
    ...elementsEntete(c, l)
  ];
}
function elementsAccepted(c, l, { fin = false } = {}) {
  const v = secondesMinuteur(l.cd);
  return [
    ['data-order-status', l.statut === 'accepted', l.statut],
    ['classe --ok', /order-track-status--ok/.test(l.classe || ''), l.classe],
    ['« Commande acceptée ! »', (l.titreStatut || '').includes('Commande acceptée !'), l.titreStatut],
    ['minuteur ' + (fin ? 'terminé' : 'M:SS'), fin ? v === null && l.cd !== null && l.cd !== '--:--' : v !== null, l.cd],
    ['indice', (l.indice || '').includes(c.mode === 'delivery' ? 'Votre livreur arrive dans ce délai.' : 'Votre commande sera prête dans ce délai.'), l.indice],
    ...elementsEntete(c, l)
  ];
}
function elementsReady(c, l) {
  return [
    ['data-order-status', l.statut === 'ready', l.statut],
    ['classe --ready', /order-track-status--ready/.test(l.classe || ''), l.classe],
    ['« Votre commande est prête ! »', (l.titreStatut || '').includes('Votre commande est prête !'), l.titreStatut],
    ['indice', (l.indice || '').includes(c.mode === 'delivery' ? 'Votre livreur arrive chez vous.' : 'Vous pouvez venir la récupérer au restaurant.'), l.indice],
    ['plus de minuteur', l.cd === null && l.sorry === null, l.cd],
    ...elementsEntete(c, l)
  ];
}
function elementsRefused(c, l) {
  return [
    ['data-order-status', l.statut === 'refused', l.statut],
    ['classe --error', /order-track-status--error/.test(l.classe || ''), l.classe],
    ['« Commande refusée »', (l.titreStatut || '').includes('Commande refusée par le restaurant.'), l.titreStatut],
    ['indice « appeler »', /Merci de nous appeler pour plus d.informations\./.test(l.indice || ''), l.indice],
    ['lien d\'appel', l.tel !== null && l.tel.href === 'tel:0321200033' && (l.tel.texte || '').includes('Appeler le restaurant'), json(l.tel)],
    ['plus de minuteur', l.cd === null, l.cd],
    ...elementsEntete(c, l)
  ];
}
function elementsSignaux(c, j, sequence, geste) {
  const att = sequence.map((ev) => signalAttendu(ev, c.mode));
  const notifOk = j.notif.length === att.length
    && att.every((a, i) => j.notif[i].titre === a.titre && j.notif[i].corps === a.corps && j.notif[i].tag === 'subito-commande-' + c.commandeId);
  const vibAttendu = geste ? att.map((a) => a.motif) : [];
  const vibObserve = j.vib.map((v) => v.motif);
  return [
    [`${att.length} notification(s) ${sequence.join('→') || '(aucune)'}`, notifOk, json(j.notif.map((n) => [n.titre, n.corps, n.tag]))],
    [`vibration(s) ${json(vibAttendu)}`, json(vibObserve) === json(vibAttendu), json(vibObserve)]
  ];
}
const sequenceStatuts = (j) => j.status.map((e) => e.v);
/** Réécritures du contenu de #orderTrackBody depuis le premier affichage (le HTML d'origine « Chargement… » n'en fait pas partie). */
const nbReconstructions = (j) => (j.status.length ? j.rebuilds.filter((r) => r.t >= j.status[0].t).length : 0);
/** Un onglet visible peut réécrire son titre de base (rétablissement) mais jamais le changer. */
const titresInoffensifs = (j) => j.titres.every((x) => x.v === TITRE_DE_BASE);

function controleLatence(libelle, ms, borne) {
  const ok = ms !== null && ms >= -300 && ms <= borne;
  return controle(ok, libelle, ms === null ? 'jamais affiché' : `${sec(Math.max(0, ms))} (borne ${sec(borne)})`);
}

// ---------------------------------------------------------------------------------------------------------------- mise en place
let site = null;
let ticker = null;
let chien = null;
let decalageS = 0; // avance de l'horloge du SERVEUR sur l'heure réelle (secondes), pilotée par la phase 3
let termine = false;

function afficherMesures() {
  section('MESURES — délai entre l\'action du patron et le changement du DOM (data-order-status), sans rechargement');
  const lignes = [
    ['new → accepted', `sondage 4 s, borne ${sec(BORNE_ATTENTE)}`, 'new→accepted'],
    ['new → refused', `sondage 4 s, borne ${sec(BORNE_ATTENTE)}`, 'new→refused'],
    ['new → ready (accepté puis prêt aussitôt)', `sondage 4 s, borne ${sec(BORNE_ATTENTE)}`, 'new→ready'],
    ['accepted → ready', `sondage 5 s, borne ${sec(BORNE_ACCEPTEE)}`, 'accepted→ready'],
    ['deux onglets, new → accepted', `borne ${sec(BORNE_ATTENTE)}`, 'deux onglets new→accepted'],
    ['deux onglets, accepted → ready', `borne ${sec(BORNE_ACCEPTEE)}`, 'deux onglets accepted→ready'],
    ['retour au premier plan → état à jour', 'visibilitychange, borne 2,5 s', 'retour au premier plan'],
    ['pause du suivi après 30 min en attente', `une relève, borne ${sec(BORNE_ATTENTE)}`, 'pause après 30 min'],
    ['intervalle de sondage en attente', 'attendu ≈ 4 s', 'intervalle new'],
    ['intervalle de sondage une fois acceptée', 'attendu ≈ 5 s', 'intervalle accepted'],
    ['fin du minuteur après saut d\'horloge serveur', 'attente ≤ 60 s', 'fin de minuteur'],
    ['expiration à 2 h après saut d\'horloge serveur', 'attente ≤ 60 s', 'expiration']
  ];
  for (const [nom, note, cle] of lignes) {
    const st = stats(mesures[cle] || []);
    const t = `${nom.padEnd(46)} ${texteStats(st)}  (${note})`;
    console.log('  ' + t);
    if (st) metriquesTexte.push(t);
  }
}

async function terminer(interrompu = false) {
  if (termine) return;
  termine = true;
  clearInterval(ticker);
  clearTimeout(chien);
  lag.disable();
  try { if (site) site.arreter(); } catch { /* déjà arrêté */ }
  afficherMesures();
  const duree = Math.round((Date.now() - DEBUT) / 1000);
  console.log(`\nbouclage de la boucle d'événements du script : retard maximal ${(lag.max / 1e6).toFixed(0)} ms, moyen ${(lag.mean / 1e6).toFixed(1)} ms`);
  console.log(`\nRÉSUMÉ : ${nbPass + nbFail} contrôles · ${nbPass} PASS · ${nbFail} FAIL · ${duree} s${interrompu ? ' · INTERROMPU' : ''}`);
  if (nbFail) { console.log('Contrôles en échec :'); for (const l of lignesFail) console.log('   - ' + l); }
  await new Promise((resolve) => process.stdout.write('', resolve));
  process.exit(nbFail === 0 && !interrompu ? 0 : 1);
}

process.on('unhandledRejection', (e) => { controle(false, 'rejet de promesse non géré', e && e.message ? e.message : String(e)); });
chien = setTimeout(() => { controle(false, `budget de temps dépassé (${Math.round(BUDGET_MS / 1000)} s)`, 'arrêt du script'); terminer(true); }, BUDGET_MS);

section('Mise en place : serveur local, comptes, commandes');
site = await demarrerSite({ horloge: Math.floor(Date.now() / 1000) });
let derniereHeure = 0;
// L'horloge du serveur suit l'heure réelle (précision 0,1 s) plus une avance pilotée par la phase 3.
ticker = setInterval(() => {
  try {
    const v = Math.floor(Date.now() / 1000 + decalageS);
    if (v !== derniereHeure) { site.fixerHeure(v); derniereHeure = v; }
  } catch { /* écriture impossible à cet instant : au prochain pas */ }
}, 100);

const patron = await patronConnecte();
const clients = await creerClients(COMMANDES.length, { concurrence: 4, prefixe: 'suivi04' });
controle(clients.length === COMMANDES.length, `${clients.length} comptes clients créés (un par page de suivi)`);
{
  const r = rng(4040);
  let tousCrees = true;
  for (let i = 0; i < COMMANDES.length; i++) {
    const c = COMMANDES[i];
    c.client = clients[i];
    const { body } = construireCommande(r, { mode: c.mode, ville: c.client.ville });
    const rep = await c.client.post('order_create.php', body);
    if (rep.status !== 201 || !rep.json.order || rep.json.order.status !== 'new') { tousCrees = false; info(`commande ${c.cle} refusée : ${rep.status} ${rep.text.slice(0, 160)}`); continue; }
    c.commande = rep.json.order;
    c.commandeId = rep.json.order.id;
  }
  controle(tousCrees, `${COMMANDES.length} commandes créées (statut new) : ${COMMANDES.filter((c) => c.mode === 'pickup').length} à emporter, ${COMMANDES.filter((c) => c.mode === 'delivery').length} en livraison`);
  if (!tousCrees) await terminer(true);
}

/** Décision du patron par l'API ; renvoie la réponse et les instants d'émission / de retour. */
async function decider(c, action) {
  const corps = action === 'accept' ? { id: c.commandeId, action, delay_minutes: c.delai } : { id: c.commandeId, action };
  const tEnvoi = Date.now();
  const rep = await patron.post('owner_order_decide.php', corps);
  return { rep, tEnvoi, tRetour: Date.now() };
}
const decisionOk = (d, statut) => d.rep.status === 200 && d.rep.json && d.rep.json.ok === true && d.rep.json.order.status === statut;

/** Attend que toutes les pages aient laissé s'écouler `ms` depuis l'instant `depuis`. */
async function attendreJusqua(instant) {
  while (Date.now() < instant) await sleep(Math.min(250, instant - Date.now()));
}

// ---------------------------------------------------------------------------------------------------------------- phase 1
async function phase1(nav) {
  section('Phase 1 — 8 pages de suivi simultanées (à emporter + livraison), jamais rechargées');
  for (const c of SCEN) c.suivi = await ouvrirSuivi(nav, site, c.client, c.commandeId, { etiquette: c.cle, geste: c.geste });
  info(`${SCEN.length} pages ouvertes (hôtes suivi<N>.localhost, un client par page)`);

  // --- premier affichage
  await Promise.all(SCEN.map(async (c) => { try { c.tNew = await c.suivi.attendreStatut('new', 12000); } catch (e) { c.tNew = null; info(e.message); } }));
  for (const c of SCEN) {
    const l = await c.suivi.lire();
    const j = await c.suivi.journal();
    groupe(`${etiquette(c)} premier affichage : « en attente de confirmation »`, c.tNew === null ? [['statut jamais affiché', false, 'aucun']] : elementsNew(c, l));
    groupe(`${etiquette(c)} aucun signal au premier affichage (activation utilisateur ${l.activation ? 'présente' : 'absente'})`, [
      ['0 notification', j.notif.length === 0, j.notif.length],
      ['0 vibration', j.vib.length === 0, j.vib.length],
      ['titre inchangé', j.titres.length === 0 && l.titre === TITRE_DE_BASE, l.titre],
      ['activation conforme', l.activation === c.geste, l.activation]
    ]);
    await c.suivi.poserMarqueur(`M04-${c.cle}-${c.commandeId}-${process.pid}`);
  }
  {
    const vis = await Promise.all(SCEN.map((c) => c.suivi.lire().then((l) => l.vraiCache)));
    controle(vis.every((v) => v === false), 'les 8 pages sont réellement visibles (minuteurs du navigateur non ralentis)', json(vis));
  }

  // --- laisser le sondage tourner en attente (au moins 3 requêtes par page : 2 intervalles)
  const d0 = Date.now();
  while (!SCEN.every((c) => c.suivi.reqs.length >= 3) && Date.now() - d0 < 20000) await sleep(200);

  // --- instants décalés : P3 et P6 sont « cachés » (document.hidden simulé) au moment du changement
  await C.P3.suivi.cacher(true);
  await C.P6.suivi.cacher(true);
  for (let i = 0; i < SCEN.length; i++) {
    const c = SCEN[i];
    if (i > 0) await sleep(650);
    const d = await decider(c, c.fin === 'refused' ? 'refuse' : 'accept');
    c.decision = d;
    controle(decisionOk(d, c.fin === 'refused' ? 'refused' : 'accepted'), `${etiquette(c)} API patron : ${c.fin === 'refused' ? 'refus' : 'acceptation ' + c.delai + ' min'}`,
      `HTTP ${d.rep.status}${d.rep.json && d.rep.json.order ? ' statut ' + d.rep.json.order.status : ''}`);
    if (c.saut) {
      const d2 = await decider(c, 'ready');
      c.decisionPrete = d2;
      controle(decisionOk(d2, 'ready'), `${etiquette(c)} API patron : « prête » aussitôt après l'acceptation (l'état « acceptée » peut passer inaperçu)`, `HTTP ${d2.rep.status}`);
    }
  }

  // --- première transition vue dans chaque page
  await Promise.all(SCEN.map(async (c) => {
    const attendu = c.saut ? 'ready' : c.fin === 'refused' ? 'refused' : 'accepted';
    try { c.tDom1 = await c.suivi.attendreStatut(attendu, 15000); } catch (e) { c.tDom1 = null; info(e.message); }
  }));
  for (const c of SCEN) {
    const l = await c.suivi.lire();
    const j = await c.suivi.journal();
    const cache = c.cle === 'P3' || c.cle === 'P6';
    if (c.saut) {
      const t = c.tDom1 === null ? null : c.tDom1 - c.decisionPrete.tRetour;
      controleLatence(`${etiquette(c)} new → ready (sans passer par l'écran « acceptée ») : DOM mis à jour`, t, BORNE_ATTENTE);
      if (t !== null) mesurer('new→ready', Math.max(0, t));
      const seq = sequenceStatuts(j);
      groupe(`${etiquette(c)} état « prête » affiché directement`, [
        ['séquence des statuts ' + json(seq), json(seq) === json(['new', 'ready']) || json(seq) === json(['new', 'accepted', 'ready']), json(seq)],
        ...elementsReady(c, l),
        ...elementsSignaux(c, j, seq.slice(1), c.geste)
      ]);
      continue;
    }
    const etat = c.fin === 'refused' ? 'refused' : 'accepted';
    const t = c.tDom1 === null ? null : c.tDom1 - c.decision.tRetour;
    controleLatence(`${etiquette(c)} new → ${etat} : DOM mis à jour sans rechargement`, t, BORNE_ATTENTE);
    if (t !== null) mesurer(etat === 'accepted' ? 'new→accepted' : 'new→refused', Math.max(0, t));
    groupe(`${etiquette(c)} textes de l'état « ${etat} »`, etat === 'accepted' ? elementsAccepted(c, l) : elementsRefused(c, l));
    groupe(`${etiquette(c)} signaux à la transition (activation ${c.geste ? 'présente' : 'absente'})`, elementsSignaux(c, j, [etat], c.geste));
    groupe(`${etiquette(c)} titre de l'onglet (${cache ? 'caché' : 'visible'})`, cache
      ? [['titre « ● … — Subito Pizza »', l.titre === titreCache(etat, c.mode), l.titre], ['une seule écriture', j.titres.length === 1, j.titres.length]]
      : [['titre inchangé', l.titre === TITRE_DE_BASE && j.titres.length === 0, l.titre]]);
    if (etat === 'accepted') {
      const premier = j.cd.find((e) => secondesMinuteur(e.v) !== null);
      if (premier) {
        const v = secondesMinuteur(premier.v);
        const attendu = c.delai * 60 - (premier.t - c.decision.tRetour) / 1000;
        controle(Math.abs(v - attendu) <= 3, `${etiquette(c)} minuteur initial ${premier.v} pour un délai de ${c.delai} min`,
          `attendu ${Math.round(attendu)} s ±3, observé ${v} s (retard d'affichage ${Math.round(c.delai * 60 - v)} s)`);
      } else controle(false, `${etiquette(c)} minuteur initial`, 'aucune valeur M:SS');
    }
  }

  // --- retour au premier plan de P3 : rafraîchissement immédiat, titre rétabli
  {
    const p3 = C.P3.suivi;
    const tEv = Date.now();
    await p3.cacher(false);
    await sleep(1500);
    const l = await p3.lire();
    const j = await p3.journal();
    const immediates = p3.reqs.filter((r) => r.t >= tEv - 50 && r.t <= tEv + 1200);
    groupe('[P3] retour au premier plan (visibilitychange) : titre rétabli et état relu aussitôt', [
      ['titre de base', l.titre === TITRE_DE_BASE, l.titre],
      ['requête order_status immédiate', immediates.length >= 1, immediates.length],
      ['toujours « accepted »', l.statut === 'accepted', l.statut],
      ['pas de nouveau signal', j.notif.length === 1, j.notif.length]
    ]);
  }

  // --- laisser le minuteur courir : 9 s après la dernière acceptation vue (le sondage « accepted » continue)
  const accepteesVues = SCEN.filter((c) => c.fin !== 'refused' && !c.saut).map((c) => c.tDom1).filter(Boolean);
  await attendreJusqua(Math.max(...accepteesVues) + 9000);
  for (const c of SCEN.filter((x) => x.fin !== 'refused' && !x.saut)) {
    const j = await c.suivi.journal();
    const nums = j.cd.map((e) => ({ t: e.t, v: secondesMinuteur(e.v) })).filter((e) => e.v !== null);
    if (nums.length < 3) { controle(false, `${etiquette(c)} minuteur : décroissance`, `seulement ${nums.length} valeurs`); continue; }
    const a = nums[0];
    const b = nums[nums.length - 1];
    const dt = (b.t - a.t) / 1000;
    const dv = a.v - b.v;
    controle(dt >= 8 && Math.abs(dv - dt) <= 2.5 && Math.abs(nums.length - 1 - dt) <= 2.5,
      `${etiquette(c)} minuteur : −1 s par seconde`, `${a.v} s → ${b.v} s (−${dv} s) en ${dt.toFixed(1)} s, ${nums.length - 1} mises à jour`);
    const l = await c.suivi.lire();
    controle(secondesMinuteur(l.cd) !== null && l.statut === 'accepted' && l.sorry && l.sorry.cache === true, `${etiquette(c)} toujours « acceptée » avec minuteur, mot d'excuse masqué`, `${l.statut} ${l.cd}`);
  }

  // --- « prête » : P4 est caché au moment du changement ; P5 revient au premier plan juste après
  await C.P4.suivi.cacher(true);
  await C.P5.suivi.cacher(true);
  const aMarquerPrete = SCEN.filter((c) => c.fin === 'ready' && !c.saut);
  for (let i = 0; i < aMarquerPrete.length; i++) {
    const c = aMarquerPrete[i];
    if (i > 0) await sleep(650);
    const d = await decider(c, 'ready');
    c.decisionPrete = d;
    controle(decisionOk(d, 'ready'), `${etiquette(c)} API patron : « prête »`, `HTTP ${d.rep.status}`);
    if (c.cle === 'P5') { c.tRetourPremierPlan = Date.now(); await c.suivi.cacher(false); }
  }
  await Promise.all(aMarquerPrete.map(async (c) => {
    try { c.tDomPrete = await c.suivi.attendreStatut('ready', 15000); } catch (e) { c.tDomPrete = null; info(e.message); }
  }));
  for (const c of aMarquerPrete) {
    const l = await c.suivi.lire();
    const j = await c.suivi.journal();
    const retour = c.cle === 'P5';
    const t = c.tDomPrete === null ? null : c.tDomPrete - c.decisionPrete.tRetour;
    if (retour) {
      const t2 = c.tDomPrete === null ? null : c.tDomPrete - c.tRetourPremierPlan;
      controleLatence(`${etiquette(c)} accepted → ready après retour au premier plan : DOM à jour`, t2, 2500);
      if (t2 !== null) mesurer('retour au premier plan', Math.max(0, t2));
    } else {
      controleLatence(`${etiquette(c)} accepted → ready : DOM mis à jour sans rechargement`, t, BORNE_ACCEPTEE);
      if (t !== null) mesurer('accepted→ready', Math.max(0, t));
    }
    groupe(`${etiquette(c)} textes de l'état « ready »`, elementsReady(c, l));
    groupe(`${etiquette(c)} signaux : acceptée puis prête`, elementsSignaux(c, j, ['accepted', 'ready'], c.geste));
    const caches = c.cle === 'P3' ? [titreCache('accepted', c.mode), TITRE_DE_BASE] : c.cle === 'P4' ? [titreCache('ready', c.mode)] : [];
    groupe(`${etiquette(c)} titre de l'onglet à « prête » (${c.cle === 'P4' ? 'caché' : 'visible'})`, c.cle === 'P4'
      ? [['titre « ● Votre commande est prête ! — Subito Pizza »', l.titre === titreCache('ready', c.mode), l.titre], ['une seule écriture', j.titres.length === 1, j.titres.length]]
      : [['titre de base, jamais modifié', (c.cle === 'P3' ? j.titres.length === 2 : titresInoffensifs(j)) && l.titre === TITRE_DE_BASE, `${j.titres.length} écriture(s), titre « ${l.titre} »`],
        ...(c.cle === 'P3' ? [['historique des titres', json(j.titres.map((x) => x.v)) === json(caches), json(j.titres.map((x) => x.v))]] : [])]);
  }
  // P4 revient au premier plan : le titre est rétabli et AUCUNE requête n'est relancée (état final)
  {
    const p4 = C.P4.suivi;
    await p4.cacher(false);
    await sleep(300);
    const l = await p4.lire();
    controle(l.titre === TITRE_DE_BASE, '[P4 livraison] retour au premier plan après « prête » : titre de base rétabli', l.titre);
  }

  // --- le sondage doit être arrêté (ready / refused) : plus aucune requête order_status
  const finals = SCEN.map((c) => ({ c, t: c.saut || c.fin === 'refused' ? c.tDom1 : c.tDomPrete })).filter((x) => x.t);
  await attendreJusqua(Math.max(...finals.map((x) => x.t)) + SILENCE_MS);
  for (const { c, t } of finals) {
    const apres = c.suivi.reqs.filter((r) => r.t > t + 300);
    controle(apres.length === 0, `${etiquette(c)} sondage arrêté après « ${c.fin} » : aucune requête order_status pendant ${((Date.now() - t) / 1000).toFixed(1)} s`, `${apres.length} requête(s) tardive(s)`);
  }
  // --- le sondage continuait pendant l'état « acceptée », au rythme attendu
  const tousNew = [];
  const tousAcc = [];
  for (const c of SCEN) {
    const j = await c.suivi.journal();
    const iv = intervallesSondage(c.suivi, j.status);
    tousNew.push(...iv.new);
    tousAcc.push(...iv.accepted);
    const nNew = iv.new.length;
    const moyNew = nNew ? iv.new.reduce((a, b) => a + b, 0) / nNew : 0;
    controle(nNew >= 1 && iv.new.every((x) => x >= 3900 && x <= BORNE_ATTENTE) && moyNew >= 3950 && moyNew <= 4800,
      `${etiquette(c)} cadence du sondage en attente`, texteStats(stats(iv.new)));
    if (c.fin === 'ready' && !c.saut) {
      const nAcc = iv.accepted.length;
      const moyAcc = nAcc ? iv.accepted.reduce((a, b) => a + b, 0) / nAcc : 0;
      controle(nAcc >= 1 && iv.accepted.every((x) => x >= 4900 && x <= BORNE_ACCEPTEE) && moyAcc >= 4950 && moyAcc <= 5800,
        `${etiquette(c)} le sondage continue une fois acceptée (cadence 5 s)`, texteStats(stats(iv.accepted)));
    }
    const rebuilds = nbReconstructions(j);
    controle(rebuilds === j.status.length, `${etiquette(c)} page reconstruite seulement à chaque changement d'état (pas à chaque sondage)`,
      `${rebuilds} reconstruction(s) pour ${j.status.length} état(s) ${json(sequenceStatuts(j))}, ${c.suivi.reqs.length} requêtes order_status`);
  }
  for (const v of tousNew) mesurer('intervalle new', v);
  for (const v of tousAcc) mesurer('intervalle accepted', v);

  // --- aucune page rechargée ni remplacée
  for (const c of SCEN) {
    const s = c.suivi;
    const m = await s.eval('window.__marqueur');
    const origine = await s.eval('performance.timeOrigin');
    groupe(`${etiquette(c)} page jamais rechargée (marqueur, origine du document, navigations)`, [
      ['marqueur présent', m === s.marqueur, m],
      ['même document', origine === s.origineMarqueur, origine],
      ['0 navigation depuis le marqueur', s.navs.length === s.navsAuMarqueur && s.navsDoc.length === s.navsDocAuMarqueur, `${s.navs.length - s.navsAuMarqueur} + ${s.navsDoc.length - s.navsDocAuMarqueur}`]
    ]);
    groupe(`${etiquette(c)} requêtes order_status : toutes en HTTP 200, aucune en échec`, [
      ['HTTP 200', s.reponses.length > 0 && s.reponses.every((r) => r.status === 200), json([...new Set(s.reponses.map((r) => r.status))])],
      ['aucun échec réseau', s.echecs.length === 0, s.echecs.length],
      ['réponses reçues', s.reqs.length - s.reponses.length <= 1, `${s.reponses.length}/${s.reqs.length}`]
    ]);
  }
  const erreurs = SCEN.flatMap((c) => c.suivi.page.erreurs.map((e) => `${c.cle}: ${e}`));
  controle(erreurs.length === 0, 'aucune exception JavaScript ni console.error dans les 8 pages', erreurs.slice(0, 3).join(' | '));
  for (const c of SCEN) await c.suivi.fermer();
}

// ---------------------------------------------------------------------------------------------------------------- phase 2
async function phase2(nav) {
  section('Phase 2 — page ouverte APRÈS le changement ; deux onglets sur la même commande');
  const t = C.T;
  // Pages ouvertes sur des commandes déjà prête (P1) et refusée (P6), « cachées » dès le chargement.
  const T4 = await ouvrirSuivi(nav, site, C.P1.client, C.P1.commandeId, { etiquette: 'T4', cache: true });
  const T5 = await ouvrirSuivi(nav, site, C.P6.client, C.P6.commandeId, { etiquette: 'T5', cache: true });
  const T1 = await ouvrirSuivi(nav, site, t.client, t.commandeId, { etiquette: 'T1' });
  const T2 = await ouvrirSuivi(nav, site, t.client, t.commandeId, { etiquette: 'T2' });
  const [t4, t5, t1, t2] = await Promise.all([
    T4.attendreStatut('ready', 12000).catch((e) => { info(e.message); return null; }),
    T5.attendreStatut('refused', 12000).catch((e) => { info(e.message); return null; }),
    T1.attendreStatut('new', 12000).catch((e) => { info(e.message); return null; }),
    T2.attendreStatut('new', 12000).catch((e) => { info(e.message); return null; })
  ]);
  for (const s of [T1, T2, T4, T5]) await s.poserMarqueur(`M04-${s.etiquette}-${process.pid}`);

  // Pages ouvertes après le changement : état direct, aucun signal (l'activation utilisateur est présente, la vibration serait permise)
  for (const [s, c, etat, tDom] of [[T4, C.P1, 'ready', t4], [T5, C.P6, 'refused', t5]]) {
    const l = await s.lire();
    const j = await s.journal();
    groupe(`[${s.etiquette}] page ouverte après le changement : affiche directement « ${etat} »`, [
      ['état affiché', tDom !== null, tDom === null ? 'jamais' : 'oui'],
      ['séquence des statuts', json(sequenceStatuts(j)) === json([etat]), json(sequenceStatuts(j))],
      ...(etat === 'ready' ? elementsReady(c, l) : elementsRefused(c, l))
    ]);
    groupe(`[${s.etiquette}] aucun signal au premier affichage (page « cachée », activation ${l.activation ? 'présente' : 'absente'})`, [
      ['0 notification', j.notif.length === 0, j.notif.length],
      ['0 vibration', j.vib.length === 0, j.vib.length],
      ['titre inchangé', j.titres.length === 0 && l.titre === TITRE_DE_BASE, l.titre],
      ['activation présente', l.activation === true, l.activation]
    ]);
  }

  // Deux onglets T1/T2 sur la commande T : le patron accepte, les deux se mettent à jour
  controle(t1 !== null && t2 !== null, '[T1 T2] deux onglets sur la même commande affichent « en attente »', `${t1 !== null} / ${t2 !== null}`);
  const dAcc = await decider(t, 'accept');
  controle(decisionOk(dAcc, 'accepted'), '[T] API patron : acceptation 30 min', `HTTP ${dAcc.rep.status}`);
  const [a1, a2] = await Promise.all([
    T1.attendreStatut('accepted', 15000).catch((e) => { info(e.message); return null; }),
    T2.attendreStatut('accepted', 15000).catch((e) => { info(e.message); return null; })
  ]);
  for (const [s, a] of [[T1, a1], [T2, a2]]) {
    controleLatence(`[${s.etiquette}] new → accepted (deux onglets) : DOM mis à jour`, a === null ? null : a - dAcc.tRetour, BORNE_ATTENTE);
    if (a !== null) mesurer('deux onglets new→accepted', Math.max(0, a - dAcc.tRetour));
  }
  controle(a1 !== null && a2 !== null && Math.abs(a1 - a2) <= SONDAGE_ATTENTE_MS + 1000, '[T1 T2] les deux onglets se mettent à jour ensemble (écart ≤ 1 période de sondage)',
    a1 !== null && a2 !== null ? `écart ${sec(Math.abs(a1 - a2))}` : 'un onglet n\'a pas bougé');
  for (const s of [T1, T2]) {
    const l = await s.lire();
    const j = await s.journal();
    groupe(`[${s.etiquette}] état « acceptée » et signaux de l'onglet`, [
      ...elementsAccepted(t, l),
      ...elementsSignaux(t, j, ['accepted'], true)
    ]);
  }

  // T3 : ouverte après l'acceptation (« cachée » dès le chargement) : état direct, minuteur à jour, aucun signal
  const T3 = await ouvrirSuivi(nav, site, t.client, t.commandeId, { etiquette: 'T3', cache: true });
  const a3 = await T3.attendreStatut('accepted', 12000).catch((e) => { info(e.message); return null; });
  await T3.poserMarqueur(`M04-T3-${process.pid}`);
  {
    const l = await T3.lire();
    const j = await T3.journal();
    const premier = j.cd.find((e) => secondesMinuteur(e.v) !== null);
    const attendu = t.delai * 60 - (premier ? premier.t - dAcc.tRetour : 0) / 1000;
    groupe('[T3] page ouverte après l\'acceptation : affiche directement « acceptée » avec le bon minuteur', [
      ['état affiché', a3 !== null, a3 === null ? 'jamais' : 'oui'],
      ['séquence des statuts', json(sequenceStatuts(j)) === json(['accepted']), json(sequenceStatuts(j))],
      ...elementsAccepted(t, l),
      ['minuteur à ±3 s du temps restant', premier && Math.abs(secondesMinuteur(premier.v) - attendu) <= 3, `${premier ? premier.v : 'aucun'} (attendu ≈ ${Math.round(attendu)} s)`]
    ]);
    groupe('[T3] aucun signal au premier affichage (page « cachée », activation présente)', [
      ['0 notification', j.notif.length === 0, j.notif.length],
      ['0 vibration', j.vib.length === 0, j.vib.length],
      ['titre inchangé', j.titres.length === 0 && l.titre === TITRE_DE_BASE, l.titre]
    ]);
  }
  await sleep(6500); // au moins une relève supplémentaire (5 s) pour T3, sans changement d'état
  {
    const l = await T3.lire();
    const j = await T3.journal();
    groupe('[T3] relève sans changement d\'état : toujours aucun signal, le sondage continue', [
      ['sondage actif (≥ 2 requêtes)', T3.reqs.length >= 2, T3.reqs.length],
      ['0 notification', j.notif.length === 0, j.notif.length],
      ['0 vibration', j.vib.length === 0, j.vib.length],
      ['titre inchangé', j.titres.length === 0 && l.titre === TITRE_DE_BASE, l.titre],
      ['une seule construction de la page', nbReconstructions(j) === 1, nbReconstructions(j)]
    ]);
  }

  // Le patron marque « prête » : les trois onglets se mettent à jour
  const dPrete = await decider(t, 'ready');
  controle(decisionOk(dPrete, 'ready'), '[T] API patron : « prête »', `HTTP ${dPrete.rep.status}`);
  const fins = await Promise.all([T1, T2, T3].map((s) => s.attendreStatut('ready', 15000).catch((e) => { info(e.message); return null; })));
  const onglets = [T1, T2, T3];
  for (let i = 0; i < onglets.length; i++) {
    const s = onglets[i];
    controleLatence(`[${s.etiquette}] accepted → ready (trois onglets) : DOM mis à jour`, fins[i] === null ? null : fins[i] - dPrete.tRetour, BORNE_ACCEPTEE);
    if (fins[i] !== null) mesurer('deux onglets accepted→ready', Math.max(0, fins[i] - dPrete.tRetour));
    const l = await s.lire();
    const j = await s.journal();
    const sequence = s === T3 ? ['ready'] : ['accepted', 'ready'];
    groupe(`[${s.etiquette}] état « prête » et signaux de l'onglet`, [
      ...elementsReady(t, l),
      ...elementsSignaux(t, j, sequence, true),
      ['titre', s === T3 ? l.titre === titreCache('ready', t.mode) : l.titre === TITRE_DE_BASE, l.titre]
    ]);
  }
  controle(fins.every((x) => x !== null) && Math.max(...fins) - Math.min(...fins) <= SONDAGE_ACCEPTEE_MS + 1000, '[T1 T2 T3] les trois onglets passent à « prête » ensemble (écart ≤ 1 période de sondage)',
    fins.every((x) => x !== null) ? `écart ${sec(Math.max(...fins) - Math.min(...fins))}` : 'un onglet n\'a pas bougé');

  // Sondage arrêté partout (états finaux), y compris les pages ouvertes directement sur un état final (une seule requête)
  await attendreJusqua(Math.max(...fins.filter(Boolean)) + SILENCE_MS);
  for (const [s, tf] of [[T1, fins[0]], [T2, fins[1]], [T3, fins[2]]]) {
    const apres = s.reqs.filter((r) => r.t > tf + 300);
    controle(apres.length === 0, `[${s.etiquette}] sondage arrêté après « prête » : aucune requête pendant ${((Date.now() - tf) / 1000).toFixed(1)} s`, `${apres.length} requête(s) tardive(s)`);
  }
  for (const s of [T4, T5]) {
    controle(s.reqs.length === 1, `[${s.etiquette}] page ouverte sur un état final : une seule requête order_status, puis plus rien (${((Date.now() - s.reqs[0].t) / 1000).toFixed(0)} s d'observation)`, `${s.reqs.length} requête(s)`);
  }
  for (const s of [T1, T2, T3, T4, T5]) {
    const m = await s.eval('window.__marqueur');
    const origine = await s.eval('performance.timeOrigin');
    groupe(`[${s.etiquette}] page jamais rechargée`, [
      ['marqueur présent', m === s.marqueur, m],
      ['même document', origine === s.origineMarqueur, origine],
      ['0 navigation depuis le marqueur', s.navs.length === s.navsAuMarqueur && s.navsDoc.length === s.navsDocAuMarqueur, `${s.navs.length - s.navsAuMarqueur}`]
    ]);
  }
  const erreurs = [T1, T2, T3, T4, T5].flatMap((s) => s.page.erreurs.map((e) => `${s.etiquette}: ${e}`));
  controle(erreurs.length === 0, 'aucune exception JavaScript ni console.error dans les pages de la phase 2', erreurs.slice(0, 3).join(' | '));
  for (const s of [T1, T2, T3, T4, T5]) await s.fermer();
}

// ---------------------------------------------------------------------------------------------------------------- phase 4
async function phase4(nav) {
  section('Phase 4 — 30 minutes sans changement (horloge de la PAGE avancée de 31 min) : acceptée = suivi maintenu ; en attente = pause puis reprise');
  const acceptees = [C.S1, C.S2];
  const attente = C.S3;
  const lot = [...acceptees, attente];
  for (const c of lot) c.suivi = await ouvrirSuivi(nav, site, c.client, c.commandeId, { etiquette: c.cle, geste: true });
  await Promise.all(lot.map((c) => c.suivi.attendreStatut('new', 12000).catch((e) => { info(e.message); return null; })));
  for (const c of acceptees) {
    c.decision = await decider(c, 'accept');
    controle(decisionOk(c.decision, 'accepted'), `${etiquette(c)} API patron : acceptation ${c.delai} min`, `HTTP ${c.decision.rep.status}`);
  }
  await Promise.all(acceptees.map((c) => c.suivi.attendreStatut('accepted', 15000).catch((e) => { info(e.message); return null; })));
  for (const c of lot) await c.suivi.poserMarqueur(`M04-${c.cle}-${process.pid}`);
  await sleep(1200);

  // 31 minutes passent sans aucun changement d'état (pages restées ouvertes au premier plan)
  for (const c of lot) await c.suivi.avancerHorlogePage(31 * 60 * 1000);
  const tAvance = Date.now();
  await sleep(11000);

  // 4a — commandes acceptées (délais de 60 et 50 min, plus longs que la garde de 30 min) : le suivi continue jusqu'à « prête »
  for (const c of acceptees) {
    const l = await c.suivi.lire();
    const apres = c.suivi.reqs.filter((r) => r.t > tAvance);
    const restant = (Date.parse(c.decision.rep.json.order.ready_at) - (Date.now() + decalageS * 1000)) / 1000;
    groupe(`${etiquette(c)} 31 min après l'acceptation (délai ${c.delai} min) : le suivi continue de se mettre à jour`, [
      ['pas de bandeau de pause', l.notice === null, l.notice],
      ['sondage actif', apres.length >= 2, `${apres.length} requête(s) en 11 s`],
      ['minuteur calé sur l\'heure du serveur, pas sur celle de l\'appareil', secondesMinuteur(l.cd) !== null && Math.abs(secondesMinuteur(l.cd) - restant) <= 5, `${l.cd} pour ≈ ${Math.round(restant)} s restantes`],
      ['toujours « acceptée »', l.statut === 'accepted', l.statut]
    ]);
  }
  for (const c of acceptees) {
    c.decisionPrete = await decider(c, 'ready');
    controle(decisionOk(c.decisionPrete, 'ready'), `${etiquette(c)} API patron : « prête »`, `HTTP ${c.decisionPrete.rep.status}`);
  }
  const vus = await Promise.all(acceptees.map((c) => c.suivi.attendreStatut('ready', 12000).catch(() => null)));
  for (let i = 0; i < acceptees.length; i++) {
    const c = acceptees[i];
    controleLatence(`${etiquette(c)} accepted → ready après 31 min d'attente : DOM mis à jour sans rechargement`, vus[i] === null ? null : vus[i] - c.decisionPrete.tRetour, BORNE_ACCEPTEE);
    if (vus[i] !== null) mesurer('accepted→ready', Math.max(0, vus[i] - c.decisionPrete.tRetour));
    const l = await c.suivi.lire();
    const j = await c.suivi.journal();
    groupe(`${etiquette(c)} état « prête » et signaux après 31 min d'attente`, [...elementsReady(c, l), ...elementsSignaux(c, j, ['accepted', 'ready'], true)]);
  }

  // 4b — commande restée « en attente » pendant 30 min : le suivi se met en pause (bandeau), reprend au retour au premier plan
  {
    const c = attente;
    const bandeau = 'Mise à jour automatique en pause : rechargez la page pour voir si votre commande a changé.';
    const l = await c.suivi.lire();
    const j = await c.suivi.journal();
    const tPause = nbReconstructions(j) >= 2 ? j.rebuilds[j.rebuilds.length - 1].t : null;
    const tardives = tPause === null ? null : c.suivi.reqs.filter((r) => r.t > tPause + 300);
    groupe(`${etiquette(c)} 31 min sans réponse du restaurant : le suivi se met en pause avec un bandeau`, [
      ['bandeau', l.notice === bandeau, l.notice],
      ['pause dans le délai d\'une relève', tPause !== null && tPause - tAvance <= BORNE_ATTENTE, tPause === null ? 'jamais' : sec(tPause - tAvance)],
      ['plus aucune requête ensuite', tardives !== null && tardives.length === 0, tardives === null ? 'pas de pause' : `${tardives.length} requête(s)`],
      ['toujours « en attente »', l.statut === 'new', l.statut]
    ]);
    if (tPause !== null) mesurer('pause après 30 min', Math.max(0, tPause - tAvance));
    c.decision = await decider(c, 'accept');
    controle(decisionOk(c.decision, 'accepted'), `${etiquette(c)} API patron : acceptation ${c.delai} min (page en pause)`, `HTTP ${c.decision.rep.status}`);
    await sleep(6500);
    {
      const l2 = await c.suivi.lire();
      const apres = tPause === null ? [] : c.suivi.reqs.filter((r) => r.t > tPause + 300);
      controle(l2.statut === 'new' && apres.length === 0, `${etiquette(c)} page en pause : l'acceptation n'apparaît pas toute seule (comportement voulu, le bandeau le dit)`, `statut ${l2.statut}, ${apres.length} requête(s)`);
    }
    const tRetour = Date.now();
    await c.suivi.cacher(true);
    await c.suivi.cacher(false);
    const vu = await c.suivi.attendreStatut('accepted', 4000).then((t) => t, () => null);
    await sleep(6000);
    const l3 = await c.suivi.lire();
    const j3 = await c.suivi.journal();
    const apresRetour = c.suivi.reqs.filter((r) => r.t >= tRetour - 50);
    groupe(`${etiquette(c)} retour au premier plan : l'état est relu aussitôt, le bandeau disparaît, le suivi reprend`, [
      ['état « acceptée » affiché', vu !== null && vu - tRetour <= 2500, vu === null ? 'non' : sec(vu - tRetour)],
      ['bandeau retiré', l3.notice === null, l3.notice],
      ['notification « acceptée »', j3.notif.length === 1 && j3.notif[0].titre === 'Commande acceptée', json(j3.notif.map((n) => n.titre))],
      ['sondage repris (≥ 2 requêtes en 6 s)', apresRetour.length >= 2, apresRetour.length],
      ['minuteur « acceptée » en marche', secondesMinuteur(l3.cd) !== null, l3.cd]
    ]);
    if (vu !== null) mesurer('retour au premier plan', Math.max(0, vu - tRetour));
  }
  for (const c of lot) {
    const s = c.suivi;
    const m = await s.eval('window.__marqueur');
    const origine = await s.eval('performance.timeOrigin');
    groupe(`${etiquette(c)} page jamais rechargée`, [
      ['marqueur présent', m === s.marqueur, m],
      ['même document', origine === s.origineMarqueur, origine],
      ['0 navigation depuis le marqueur', s.navs.length === s.navsAuMarqueur && s.navsDoc.length === s.navsDocAuMarqueur, `${s.navs.length - s.navsAuMarqueur}`]
    ]);
  }
  const erreurs = lot.flatMap((c) => c.suivi.page.erreurs.map((e) => `${c.cle}: ${e}`));
  controle(erreurs.length === 0, 'aucune exception JavaScript ni console.error dans les pages de la phase 4', erreurs.slice(0, 3).join(' | '));
  for (const c of lot) await c.suivi.fermer();
}

// ---------------------------------------------------------------------------------------------------------------- phase 3
async function phase3(nav) {
  section('Phase 3 — fin du minuteur et expiration du suivi (horloge du SERVEUR avancée)');
  const lot = [C.R1, C.R2];
  for (const c of lot) c.suivi = await ouvrirSuivi(nav, site, c.client, c.commandeId, { etiquette: c.cle, geste: true });
  await Promise.all(lot.map((c) => c.suivi.attendreStatut('new', 12000).catch((e) => { info(e.message); return null; })));
  for (const c of lot) {
    c.decision = await decider(c, 'accept');
    controle(decisionOk(c.decision, 'accepted'), `${etiquette(c)} API patron : acceptation ${c.delai} min`, `HTTP ${c.decision.rep.status}`);
    await sleep(500);
  }
  await Promise.all(lot.map((c) => c.suivi.attendreStatut('accepted', 15000).catch((e) => { info(e.message); return null; })));
  for (const c of lot) await c.suivi.poserMarqueur(`M04-${c.cle}-${process.pid}`);

  // Saut de l'horloge du serveur : 4 s avant l'heure prévue de la première commande (la page se cale sur server_now à chaque relève)
  const prevu = Date.parse(C.R1.decision.rep.json.order.ready_at) / 1000;
  decalageS = (prevu - 4) - Date.now() / 1000;
  const tSaut = Date.now();
  info(`horloge du serveur avancée de ${Math.round(decalageS)} s (4 s avant l'heure prévue de R1)`);
  await Promise.all(lot.map(async (c) => {
    c.attenteFin = await c.suivi.attendre("(function () { var e = document.getElementById('orderCountdown'); return e && !/^\\d+:\\d{2}$/.test(e.textContent.trim()); })()", 25000, 'fin du minuteur').catch(() => null);
  }));
  for (const c of lot) {
    const l = await c.suivi.lire();
    const attendu = c.mode === 'delivery' ? 'Votre livreur devrait arriver' : 'Votre commande est prête !';
    controle(c.attenteFin !== null && c.attenteFin <= 25000, `${etiquette(c)} fin du minuteur affichée après le saut d'horloge`, c.attenteFin === null ? 'jamais' : sec(c.attenteFin));
    if (c.attenteFin !== null) mesurer('fin de minuteur', c.attenteFin);
    groupe(`${etiquette(c)} texte de fin du minuteur : « ${attendu} »`, [
      ['texte exact', l.cd === attendu, l.cd],
      ['aria-live annoncé (polite)', l.cdLive === 'polite', l.cdLive],
      ['mot d\'excuse affiché', l.sorry !== null && l.sorry.cache === false && /ne nous en voulez pas/.test(l.sorry.texte) && (c.mode === 'delivery' ? /votre livreur arrive, promis/ : /on fait notre maximum/).test(l.sorry.texte), l.sorry ? l.sorry.texte : null],
      ['commande encore « acceptée »', l.statut === 'accepted', l.statut]
    ]);
  }
  // Le patron marque R1 « prête » : le texte de fin laisse la place à l'écran « prête » ; R2 reste acceptée
  C.R1.decisionPrete = await decider(C.R1, 'ready');
  controle(decisionOk(C.R1.decisionPrete, 'ready'), '[R1 emporter] API patron : « prête »', `HTTP ${C.R1.decisionPrete.rep.status}`);
  await C.R1.suivi.attendreStatut('ready', 15000).catch((e) => info(e.message));
  {
    const l = await C.R1.suivi.lire();
    groupe('[R1 emporter] après la fin du minuteur, « prête » confirmée par le restaurant', elementsReady(C.R1, l));
  }

  // Deux heures après l'heure prévue, le suivi se retire de lui-même (R2 reste ouverte)
  decalageS += 7200 + 30;
  const tExp = Date.now();
  const att = await C.R2.suivi.attendre("/plus disponible/.test(document.getElementById('orderTrackBody').textContent)", 25000, 'expiration').catch(() => null);
  if (att !== null) mesurer('expiration', att);
  {
    const l = await C.R2.suivi.lire();
    const lien = await C.R2.suivi.eval("(function () { var a = document.querySelector('#orderTrackBody a[href=\"compte.html\"]'); return a ? a.textContent.trim() : null; })()");
    groupe('[R2 livraison] 2 h après l\'heure prévue : « Ce suivi n’est plus disponible. » avec lien vers Mon compte', [
      ['affiché dans les 25 s', att !== null, att === null ? 'jamais' : sec(att)],
      ['texte', /Ce suivi n’est plus disponible\./.test(l.corps || ''), l.corps],
      ['lien « Mon compte »', lien === 'Mon compte', lien]
    ]);
  }
  await sleep(7000);
  {
    const tFin = tExp + (att || 0);
    const apres = C.R2.suivi.reqs.filter((r) => r.t > tFin + 1500);
    controle(apres.length === 0, '[R2 livraison] suivi expiré : le sondage est arrêté', `${apres.length} requête(s) après l'expiration`);
  }
  // Pages ouvertes après l'expiration : directement « plus disponible » (commande prête depuis plus de 2 h / acceptée dont l'heure prévue est dépassée de 2 h)
  for (const [c, etat] of [[C.R1, 'prête'], [C.R2, 'acceptée']]) {
    const s = await ouvrirSuivi(nav, site, c.client, c.commandeId, { etiquette: c.cle + 'bis', geste: true });
    await s.attendre("/plus disponible/.test(document.getElementById('orderTrackBody').textContent)", 12000, 'expiration à l\'ouverture').catch((e) => info(e.message));
    const l = await s.lire();
    await sleep(500);
    groupe(`[${c.cle}bis] page ouverte après l'expiration d'une commande ${etat} : directement « plus disponible »`, [
      ['texte', /Ce suivi n’est plus disponible\./.test(l.corps || ''), l.corps],
      ['une seule requête order_status', s.reqs.length === 1, s.reqs.length]
    ]);
    await s.fermer();
  }
  // Marqueurs : R1 et R2 n'ont jamais été rechargées
  for (const c of lot) {
    const s = c.suivi;
    const m = await s.eval('window.__marqueur');
    const origine = await s.eval('performance.timeOrigin');
    groupe(`${etiquette(c)} page jamais rechargée`, [
      ['marqueur présent', m === s.marqueur, m],
      ['même document', origine === s.origineMarqueur, origine],
      ['0 navigation depuis le marqueur', s.navs.length === s.navsAuMarqueur && s.navsDoc.length === s.navsDocAuMarqueur, `${s.navs.length - s.navsAuMarqueur}`]
    ]);
  }
  const erreurs = lot.flatMap((c) => c.suivi.page.erreurs.map((e) => `${c.cle}: ${e}`));
  controle(erreurs.length === 0, 'aucune exception JavaScript ni console.error dans les pages de la phase 3', erreurs.slice(0, 3).join(' | '));
  for (const c of lot) await c.suivi.fermer();
}

// ---------------------------------------------------------------------------------------------------------------- exécution
const phasesNavigateur = [[1, phase1], [4, phase4], [2, phase2], [3, phase3]].filter(([n]) => veut(n));
if (phasesNavigateur.length) {
  const tDemande = Date.now();
  try {
    await avecNavigateur(async (nav) => {
      info(`navigateur ${nav.version} obtenu après ${sec(Date.now() - tDemande)} d'attente`);
      for (const [n, f] of phasesNavigateur) {
        try { await f(nav); } catch (e) { controle(false, `phase ${n} interrompue par une erreur du test`, e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : String(e)); }
      }
    }, { pagesMax: 8 });
  } catch (e) {
    controle(false, 'navigateur indisponible ou interrompu', e && e.message ? e.message : String(e));
  }
}

// ---------------------------------------------------------------------------------------------------------------- contrôles finaux
section('Contrôles finaux : serveur');
{
  const attendus = { P1: 'ready', P2: 'ready', P3: 'ready', P4: 'ready', P5: 'ready', P6: 'refused', P7: 'refused', P8: 'ready' };
  if (veut(2)) Object.assign(attendus, { T: 'ready' });
  if (veut(4)) Object.assign(attendus, { S1: 'ready', S2: 'ready', S3: 'accepted' });
  if (veut(3)) Object.assign(attendus, { R1: 'ready', R2: 'accepted' });
  const ecarts = [];
  for (const [cle, statut] of Object.entries(attendus)) {
    const c = C[cle];
    if (!c.commandeId || (cle.startsWith('P') && !veut(1))) continue;
    const rep = await c.client.get('order_status.php?id=' + c.commandeId);
    const o = rep.json && rep.json.order;
    if (!o || o.status !== statut) ecarts.push(`${cle}: ${o ? o.status : rep.status} au lieu de ${statut}`);
    if (o && statut === 'ready' && !o.prepared_at) ecarts.push(`${cle}: prepared_at absent`);
    if (o && statut === 'refused' && !o.refused_at) ecarts.push(`${cle}: refused_at absent`);
    if (o && ['accepted', 'ready'].includes(statut) && o.delay_minutes !== c.delai) ecarts.push(`${cle}: délai ${o.delay_minutes} au lieu de ${c.delai}`);
  }
  controle(ecarts.length === 0, 'états finaux des commandes relus par l\'API client (order_status) conformes aux décisions du patron', ecarts.join(' ; '));
  const journal = site.journal();
  controle(!/ 500 | server_error/.test(journal), 'journal du serveur : aucune erreur 500', journal.trim() ? journal.trim().split('\n').slice(0, 3).join(' | ') : '(vide)');
}

await terminer(false);
