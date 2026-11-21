// Batterie 05 — FILE DU COMMERÇANT QUI SE MET A JOUR TOUTE SEULE ET DÉCISIONS À L'ÉCRAN (navigateur réel).
//   node tests/massif/lancer.mjs tests/massif/05-patron-file-dynamique.mjs --timeout=480
//
// Une page commerçant réelle (Chrome headless, tablette 1280x800, cookies du patron injectés) reste ouverte, SANS jamais être
// rechargée, pendant que 56 faux clients envoient des commandes par l'API (compte-gouttes, rafale, page sur un autre onglet,
// coupure du réseau). Puis les décisions sont prises COMME UN HUMAIN, par clics réels (Input.dispatchMouseEvent) :
// sélectionner, Accepter -> délai 20/30/40/50/60 -> Confirmer, Refuser -> confirmer, « Commande prête · prévenir le client »,
// doubles clics. Après chaque clic : état serveur (owner_orders) ET interface. Une page de suivi client (2e onglet) et une
// 2e tablette patron (3e onglet, sondage figé) complètent le scénario. Graine fixe ; attentes bornées ; aucune donnée réelle.
import { demarrerSite } from './lib/env.mjs';
import { creerClients, patronConnecte, enParallele } from './lib/clients.mjs';
import { rng, construireCommande } from './lib/commandes.mjs';
import { avecNavigateur } from './lib/chrome.mjs';
import {
  sleep, creerBilan, norm, eur, hm, hms, libelleDelai, libelleDelaiCourt, statistiques, fmtStat, nomsAnnonces, attendre,
  installerSondes, lireSonde, lireToasts, lireLive, suivreReseau, cliquer, doubleCliquer, mettreAuPremierPlan,
  coupureReseau, figerSondage, recouvrements
} from './lib/05-pilote.mjs';

const NB_CLIENTS = 60;
const VUE = { largeur: 1280, hauteur: 800, mobile: false };
const DELAI_GLOBAL_S = 450;
const APPARITION_MAX_MS = 7000; // sondage 4 s + requête + rendu + marge de charge
const B = creerBilan();
const stats = { reclics: 0, collateral: 0 };

function terminer() {
  clearTimeout(garde);
  console.log('\n──────── RÉSUMÉ ────────');
  for (const m of B.metriques) console.log('  mesure : ' + m);
  const total = B.reussis + B.echoues;
  console.log(`  Bilan : ${total} contrôles, ${B.reussis} réussis, ${B.echoues} échoués · durée ${B.duree().toFixed(0)} s`);
  if (B.echecs.length) {
    console.log('  Échecs :');
    for (const e of B.echecs) console.log('   - ' + e);
  }
  process.exit(B.echoues === 0 ? 0 : 1);
}
const garde = setTimeout(() => { B.controle(`Le script se termine en moins de ${DELAI_GLOBAL_S} s`, false, 'délai global dépassé'); terminer(); }, DELAI_GLOBAL_S * 1000);
process.on('unhandledRejection', (e) => { B.controle('Aucune erreur interne du test', false, String(e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e)); });

// ───────────────────────────── État partagé ─────────────────────────────

const r = rng(5005);
let site;
let patron;
let clients;
let A = null; // onglet patron principal : { page, journal, nom }
let P2 = null; // 2e tablette patron
let T = null; // page de suivi d'un client
const attendu = new Map(); // id -> { status, delay } : ce que le test sait avoir décidé
const envoyees = [];
let delaiParDefaut = 30;

async function passer(client, opts = {}) {
  const mode = opts.mode || (r.vrai(0.5) ? 'pickup' : 'delivery');
  const { body, totals } = construireCommande(r, { mode, ville: client.ville, ...(opts.commande || {}) });
  const rep = await client.post('order_create.php', body);
  const t = Date.now();
  if (rep.status !== 201) throw new Error(`order_create ${rep.status} ${rep.text.slice(0, 160)} (client ${client.num}, ${mode})`);
  const o = { id: rep.json.order.id, nom: `Client${client.num} Massif`, client, mode, totals, t };
  envoyees.push(o);
  attendu.set(o.id, { status: 'new', delay: null });
  return o;
}

async function etat() {
  const rep = await patron.get('owner_orders.php');
  if (rep.status !== 200) throw new Error('owner_orders ' + rep.status + ' ' + rep.text.slice(0, 120));
  const liste = rep.json.orders;
  return { liste, parId: new Map(liste.map((o) => [o.id, o])), texte: rep.text };
}
const nouvellesServeur = (e) => e.liste.filter((o) => o.status === 'new').map((o) => o.id);

async function attendreServeur(id, pred, timeout = 6000) {
  let dernier = null;
  const res = await attendre(async () => { dernier = (await etat()).parId.get(id); return dernier && pred(dernier) ? dernier : null; }, timeout, 100);
  return { ok: res.ok, ordre: res.ok ? res.valeur : dernier, ms: res.ms };
}

function derives(avant, apres, cibles) {
  const diffs = [];
  for (const [id, o] of avant.parId) {
    if (cibles.includes(id)) continue;
    const p = apres.parId.get(id);
    if (!p) { diffs.push(`#${id} disparue`); continue; }
    if (p.status !== o.status || p.delay_minutes !== o.delay_minutes || p.accepted_at !== o.accepted_at || p.prepared_at !== o.prepared_at || p.refused_at !== o.refused_at) diffs.push(`#${id} ${o.status}->${p.status}`);
  }
  return diffs;
}

const selChip = (id) => `#queue .qchip[data-id="${id}"]`;
const selPrep = (id) => `#prep-queue .qchip[data-id="${id}"]`;
const lireIds = (ong, zone = '#queue') => ong.page.evaluate(`Array.from(document.querySelectorAll('${zone} .qchip')).map((b) => Number(b.getAttribute('data-id')))`);
const chipPresent = (ong, id) => ong.page.evaluate(`!!document.querySelector('${selChip(id)}')`);
const prepPresent = (ong, id) => ong.page.evaluate(`!!document.querySelector('${selPrep(id)}')`);

const lireDecision = (ong) => ong.page.evaluate(`(() => {
  const tuiles = Array.from(document.querySelectorAll('#decision [data-action="delay"]')).map((b) => ({ min: Number(b.getAttribute('data-min')), on: b.classList.contains('is-on'), pressed: b.getAttribute('aria-pressed') }));
  const t = (s) => { const e = document.querySelector(s); return e ? e.textContent.replace(/\\s+/g, ' ').trim() : null; };
  const conf = document.querySelector('#decision [data-action="accept-confirm"]');
  return { tuiles, confirmer: t('#decision [data-action="accept-confirm"]'), confirmerActif: conf ? !conf.disabled : null, accepter: t('#decision [data-action="accept"]'), refuser: t('#decision [data-action="refuse"]'), annuler: t('#decision [data-action="edit-cancel"]') };
})()`);

const lireDialogue = (ong) => ong.page.evaluate(`(() => {
  const d = document.getElementById('dlg');
  if (!d.open) return { ouvert: false };
  const h = d.querySelector('h3');
  return { ouvert: true, titre: h ? h.textContent : null, texte: d.textContent.replace(/\\s+/g, ' ').trim(), boutons: Array.from(d.querySelectorAll('button')).map((b) => ({ action: b.getAttribute('data-action'), texte: b.textContent.trim(), actif: !b.disabled })) };
})()`);

const lireDetail = (ong) => ong.page.evaluate(`(() => {
  const g = (s) => { const e = document.querySelector(s); return e ? e.textContent : null; };
  const pill = document.querySelector('#order-detail .pill');
  const on = document.querySelector('#queue .qchip.is-on');
  return {
    nom: g('#order-detail .od-num'), total: g('#order-detail .od-total strong'), mode: g('#order-detail .pickup'), eyebrow: g('#order-detail .eyebrow'),
    pill: pill ? pill.className : null, pillTexte: pill ? pill.textContent : null, nbLignes: document.querySelectorAll('#order-detail .items > li').length,
    paiement: g('#order-detail .od-pay'), texte: g('#order-detail'), selection: on ? Number(on.getAttribute('data-id')) : null,
    colonneDecision: !document.querySelector('.decide-col').hidden, vide: !!document.querySelector('#order-detail .empty')
  };
})()`);

function libellePaiement(o) {
  if (o.mode !== 'delivery') return 'Au retrait';
  const L = { card: 'Carte bancaire', cash: 'Espèces', ticket: 'Ticket restaurant', ticket_card: 'Carte ticket restaurant' };
  let t = (o.payment_methods || []).map((m) => L[m] || m).join(' + ') || 'Non précisé';
  if ((o.payment_methods || []).includes('cash') && o.cash_change_for != null) t += Number(o.cash_change_for) === 0 ? ' · appoint' : ` · billet de ${o.cash_change_for} €`;
  return t;
}

/** Clique sur un onglet de l'en-tête (orders | avail | patron) et attend que la vue soit affichée. */
async function allerVue(ong, vue) {
  await cliquer(ong.page, `[data-action="view"][data-view="${vue}"]`, { nom: `onglet ${vue}` });
  const ok = await attendre(() => ong.page.evaluate(`(() => { const v = (n) => !document.getElementById('view-' + n).hidden; return v('${vue}') && ['orders', 'avail', 'patron'].filter((n) => n !== '${vue}').every((n) => !v(n)); })()`), 3000, 40);
  return ok;
}

/** Remet l'onglet dans un état connu entre deux scénarios : pas de fenêtre ouverte, vue « Commandes », réseau rétabli. */
async function remettreEnEtat(ong) {
  try {
    await coupureReseau(ong.page, false);
    const d = await lireDialogue(ong);
    if (d.ouvert) {
      B.info(`remise en état : fenêtre « ${d.titre} » encore ouverte, fermée par le test`);
      await cliquer(ong.page, '#dlg [data-action="dlg-close"]', { nom: 'fermer la fenêtre' });
      await attendre(async () => !(await lireDialogue(ong)).ouvert, 2000, 50);
    }
    const v = await ong.page.evaluate(`!document.getElementById('view-orders').hidden`);
    if (!v) { B.info('remise en état : retour sur la vue « Commandes »'); await allerVue(ong, 'orders'); }
  } catch (e) { B.info('remise en état impossible : ' + (e && e.message)); }
}

async function selectionner(ong, o) {
  for (let essai = 1; essai <= 3; essai++) {
    await cliquer(ong.page, selChip(o.id), { nom: `pastille de ${o.nom}` });
    const ok = await attendre(() => ong.page.evaluate(`(() => { const e = document.querySelector('#queue .qchip.is-on'); return !!e && e.getAttribute('data-id') === '${o.id}'; })()`), 2500, 50);
    if (ok.ok) return essai;
    stats.reclics++;
  }
  throw new Error(`La pastille de ${o.nom} ne se sélectionne pas après 3 clics`);
}

async function verifierDetail(ong, o, serv, rang) {
  const d = await lireDetail(ong);
  const txt = norm(d.texte);
  const absents = serv.items.filter((it) => !txt.includes(norm(it.variant ? `${it.name} · ${it.variant}` : it.name))).map((it) => it.name);
  B.controle(`Détail ${o.nom} : nom du client`, norm(d.nom) === serv.customer_name, norm(d.nom));
  B.controle(`Détail ${o.nom} : rang « Commande ${rang} de la file »`, norm(d.eyebrow) === `Commande ${rang} de la file`, norm(d.eyebrow));
  B.controle(`Détail ${o.nom} : total ${eur(serv.total_cents)}`, norm(d.total) === eur(serv.total_cents), norm(d.total));
  B.controle(`Détail ${o.nom} : ${serv.items.length} article(s) listés, tous lisibles`, d.nbLignes === serv.items.length && absents.length === 0, `lignes=${d.nbLignes} absents=${absents.join(',')}`);
  B.controle(`Détail ${o.nom} : mode ${serv.mode === 'delivery' ? 'livraison' : 'à emporter'}`, norm(d.mode).includes(serv.mode === 'delivery' ? 'Livraison' : 'À emporter'), norm(d.mode));
  B.controle(`Détail ${o.nom} : paiement « ${libellePaiement(serv)} »`, norm(d.paiement) === norm(libellePaiement(serv)), norm(d.paiement));
  B.controle(`Détail ${o.nom} : téléphone${serv.mode === 'delivery' ? ' et adresse' : ''}`, txt.includes(norm(serv.customer_phone)) && (serv.mode !== 'delivery' || txt.includes(norm(`${serv.delivery_address.street}, ${serv.delivery_address.city}`))), '');
  B.controle(`Détail ${o.nom} : pastille « Nouvelle » et colonne de décision`, /pill-new/.test(d.pill || '') && norm(d.pillTexte) === 'Nouvelle' && d.colonneDecision, `${d.pill}/${d.pillTexte}`);
}

const postsDecision = (ong, id, depuis) => ong.journal.filter((e) => e.route === 'owner_order_decide' && e.methode === 'POST' && e.t >= depuis && e.donnees && e.donnees.id === id);

async function attendreToast(ong, texte, depuis, timeout = 4000) {
  return attendre(async () => (await lireToasts(ong.page)).find((x) => x.t >= depuis - 80 && x.texte === texte) || null, timeout, 60);
}

// ───────────────────────────── Parcours « comme un humain » ─────────────────────────────

/** Sélectionner -> Accepter -> délai -> Confirmer, avec contrôles serveur + écran après CHAQUE clic. */
async function parcoursAccepter(ong, o, delai, opt = {}) {
  const { annulerAvant = false, double = null, entre = null, detail = false, ui = true } = opt;
  const lib = `Accepter ${libelleDelaiCourt(delai)} · ${o.nom}`;
  const idsAvant = await lireIds(ong);
  const e0 = await etat();
  const serv0 = e0.parId.get(o.id);
  await selectionner(ong, o);
  if (detail) await verifierDetail(ong, o, serv0, nouvellesServeur(e0).indexOf(o.id) + 1);

  await cliquer(ong.page, '#decision [data-action="accept"]', { nom: 'Accepter' });
  // « Tout de suite » s'ajoute aux 6 délais de base uniquement à emporter (n'a pas de sens en livraison).
  const delaisAttendus = o.mode === 'delivery' ? [10, 20, 30, 40, 50, 60] : [10, 20, 30, 40, 50, 60, 0];
  const d1 = await attendre(async () => { const d = await lireDecision(ong); return d.tuiles.length === delaisAttendus.length ? d : null; }, 2500, 50);
  B.controle(`${lib} : « Accepter » propose les ${delaisAttendus.length} délais`, d1.ok && d1.valeur.tuiles.map((t) => t.min).join() === delaisAttendus.join(), d1.ok ? d1.valeur.tuiles.map((t) => t.min).join() : 'absent');
  if (d1.ok) {
    // Livraison : 1 heure présélectionnée (trajet du livreur), jamais le délai par défaut de préparation.
    const delaiPreselectionAttendu = o.mode === 'delivery' ? 60 : delaiParDefaut;
    const confirmerAttenduDefaut = o.mode === 'delivery' ? `Confirmer · plus ou moins ${libelleDelaiCourt(delaiPreselectionAttendu)}` : `Confirmer · ${libelleDelaiCourt(delaiPreselectionAttendu)}`;
    B.controle(`${lib} : délai par défaut (${delaiPreselectionAttendu}) présélectionné`, d1.valeur.tuiles.filter((t) => t.on).map((t) => t.min).join() === String(delaiPreselectionAttendu) && d1.valeur.confirmer === confirmerAttenduDefaut, `${d1.valeur.tuiles.filter((t) => t.on).map((t) => t.min)} / ${d1.valeur.confirmer}`);
  }
  let e = (await etat()).parId.get(o.id);
  B.controle(`${lib} : après « Accepter », rien n'est encore décidé (serveur)`, e.status === 'new', e.status);

  if (annulerAvant) {
    await cliquer(ong.page, '#decision [data-action="edit-cancel"]', { nom: 'Annuler' });
    const dn = await attendre(async () => { const d = await lireDecision(ong); return d.tuiles.length === 0 && d.accepter ? d : null; }, 2500, 50);
    B.controle(`${lib} : « Annuler » revient à Accepter / Refuser`, dn.ok, '');
    e = (await etat()).parId.get(o.id);
    B.controle(`${lib} : après « Annuler », la commande est toujours nouvelle (serveur)`, e.status === 'new', e.status);
    await cliquer(ong.page, '#decision [data-action="accept"]', { nom: 'Accepter (2e fois)' });
    await attendre(async () => (await lireDecision(ong)).tuiles.length === 5, 2500, 50);
  }

  // Livraison : « plus ou moins » devant le délai (trajet du livreur jamais exact), jamais à emporter.
  const confirmeAttendu = o.mode === 'delivery' ? `Confirmer · plus ou moins ${libelleDelaiCourt(delai)}` : `Confirmer · ${libelleDelaiCourt(delai)}`;
  await cliquer(ong.page, `#decision [data-action="delay"][data-min="${delai}"]`, { nom: `tuile ${delai}` });
  const d2 = await attendre(async () => { const d = await lireDecision(ong); return d.tuiles.find((t) => t.min === delai && t.on) ? d : null; }, 2500, 50);
  B.controle(`${lib} : la tuile ${delai} est choisie, bouton « ${confirmeAttendu} »`, d2.ok && d2.valeur.confirmer === confirmeAttendu && d2.valeur.tuiles.filter((t) => t.on).length === 1, d2.ok ? `${d2.valeur.confirmer}` : 'tuile non choisie');
  e = (await etat()).parId.get(o.id);
  B.controle(`${lib} : délai choisi mais rien envoyé (serveur)`, e.status === 'new', e.status);

  if (entre) await entre();

  const avant = await etat();
  const sondeAvant = await lireSonde(ong.page);
  const nClics = sondeAvant.clics.length;
  const clic = double === null
    ? await cliquer(ong.page, '#decision [data-action="accept-confirm"]', { nom: 'Confirmer' })
    : await doubleCliquer(ong.page, '#decision [data-action="accept-confirm"]', { ecartMs: double, nom: 'Confirmer (double clic)' });

  const srv = await attendreServeur(o.id, (x) => x.status === 'accepted', 6000);
  B.controle(`${lib} : serveur « accepted » avec délai ${delai}`, srv.ok && srv.ordre.delay_minutes === delai, `${srv.ordre && srv.ordre.status}/${srv.ordre && srv.ordre.delay_minutes}`);
  if (srv.ok) {
    const ac = Date.parse(srv.ordre.accepted_at);
    B.controle(`${lib} : accepted_at = instant du clic, ready_at = +${delai} min`, ac >= clic.t - 2000 && ac <= Date.now() + 1500 && Date.parse(srv.ordre.ready_at) - ac === delai * 60000, `accepted_at=${srv.ordre.accepted_at} ready_at=${srv.ordre.ready_at}`);
    attendu.set(o.id, { status: 'accepted', delay: delai });
  }
  const apres = await etat();
  const dv = derives(avant, apres, [o.id]);
  stats.collateral += dv.length;
  B.controle(`${lib} : aucune autre commande modifiée`, dv.length === 0, dv.slice(0, 3).join(' ; '));

  if (double !== null) {
    await sleep(900);
    const posts = postsDecision(ong, o.id, clic.t - 300);
    const s = await lireSonde(ong.page);
    const clicsConfirmer = s.clics.slice(nClics).filter((c) => c.action === 'accept-confirm').length;
    B.controle(`${lib} : double clic -> UNE seule requête de décision`, posts.length === 1, `${posts.length} requête(s), ${clicsConfirmer} clic(s) reçus sur Confirmer`);
    const e2 = (await etat()).parId.get(o.id);
    B.controle(`${lib} : double clic -> accepted_at inchangé`, srv.ok && e2.accepted_at === srv.ordre.accepted_at && e2.status === 'accepted', `${e2.accepted_at}`);
    const nbToasts = (await lireToasts(ong.page)).filter((x) => x.t >= clic.t - 80 && /acceptée/.test(x.texte)).length;
    B.controle(`${lib} : double clic -> un seul message « acceptée »`, nbToasts === 1, `${nbToasts}`);
  }

  if (ui) {
    const sorti = await attendre(async () => !(await chipPresent(ong, o.id)), 4000, 40);
    B.controle(`${lib} : la commande quitte « À traiter »`, sorti.ok, sorti.ok ? `${Date.now() - clic.t} ms après le clic` : 'toujours présente');
    if (sorti.ok) stats.latencesUiDecision.push(Date.now() - clic.t);
    const prep = await attendre(() => ong.page.evaluate(`(() => { const b = document.querySelector('${selPrep(o.id)}'); return b ? { titre: b.querySelector('.qchip-title').textContent, sous: b.querySelector('.qchip-sub').textContent } : null; })()`), 3000, 50);
    const attenduSous = `Prête vers ${hm(srv.ordre.ready_at)} · ${eur(srv.ordre.total_cents)}`;
    B.controle(`${lib} : entre dans « En préparation » avec « Prête vers HH:MM »`, prep.ok && norm(prep.valeur.sous) === attenduSous && norm(prep.valeur.titre) === o.nom, prep.ok ? norm(prep.valeur.sous) : 'absente de la bande');
    const bande = await ong.page.evaluate(`!document.getElementById('prep-strip').hidden`);
    B.controle(`${lib} : la bande « En préparation » est visible`, bande, '');
    const delaiAnnonceAttendu = o.mode === 'delivery' ? `plus ou moins ${libelleDelai(delai)}` : libelleDelai(delai);
    const tt = await attendreToast(ong, `Commande de ${o.nom} acceptée · délai annoncé : ${delaiAnnonceAttendu}`, clic.t, 3000);
    B.controle(`${lib} : message « acceptée · délai annoncé : ${delaiAnnonceAttendu} »`, tt.ok, tt.ok ? `${tt.valeur.t - clic.t} ms` : 'message absent');
    // la sélection passe à la 1re commande restante
    const restantes = idsAvant.filter((id) => id !== o.id);
    const sel = await attendre(async () => { const d = await lireDetail(ong); return restantes.length ? d.selection === restantes[0] : d.vide ? d : null; }, 3000, 60);
    B.controle(`${lib} : la sélection passe à la commande suivante`, sel.ok, `attendu #${restantes[0]}`);
  }
  return { clic, serveur: srv.ordre };
}

async function parcoursRefuser(ong, o, opt = {}) {
  const { annulerAvant = false, double = null, ui = true } = opt;
  const lib = `Refuser · ${o.nom}`;
  const idsAvant = await lireIds(ong);
  await selectionner(ong, o);
  await cliquer(ong.page, '#decision [data-action="refuse"]', { nom: 'Refuser' });
  let dlg = await attendre(async () => { const d = await lireDialogue(ong); return d.ouvert ? d : null; }, 2500, 50);
  B.controle(`${lib} : « Refuser » ouvre la fenêtre de confirmation`, dlg.ok && dlg.valeur.titre === `Refuser la commande de ${o.nom} ?`, dlg.ok ? dlg.valeur.titre : 'pas de fenêtre');
  let e = (await etat()).parId.get(o.id);
  B.controle(`${lib} : fenêtre ouverte, rien n'est encore décidé (serveur)`, e.status === 'new', e.status);
  if (annulerAvant) {
    await cliquer(ong.page, '#dlg [data-action="dlg-close"]', { nom: 'Annuler (fenêtre)' });
    const ferme = await attendre(async () => !(await lireDialogue(ong)).ouvert, 2000, 50);
    e = (await etat()).parId.get(o.id);
    B.controle(`${lib} : « Annuler » ferme la fenêtre, commande intacte`, ferme.ok && e.status === 'new' && (await chipPresent(ong, o.id)), e.status);
    await cliquer(ong.page, '#decision [data-action="refuse"]', { nom: 'Refuser (2e fois)' });
    dlg = await attendre(async () => { const d = await lireDialogue(ong); return d.ouvert ? d : null; }, 2500, 50);
  }
  const avant = await etat();
  const nClics = (await lireSonde(ong.page)).clics.length;
  const clic = double === null
    ? await cliquer(ong.page, '#dlg [data-action="dlg-confirm-refuse"]', { nom: 'Oui, refuser' })
    : await doubleCliquer(ong.page, '#dlg [data-action="dlg-confirm-refuse"]', { ecartMs: double, nom: 'Oui, refuser (double clic)' });
  const srv = await attendreServeur(o.id, (x) => x.status === 'refused', 6000);
  B.controle(`${lib} : serveur « refused » avec refused_at`, srv.ok && !!srv.ordre.refused_at && srv.ordre.accepted_at === null && srv.ordre.delay_minutes === null, `${srv.ordre && srv.ordre.status}/${srv.ordre && srv.ordre.refused_at}`);
  if (srv.ok) {
    B.controle(`${lib} : refused_at = instant du clic`, Date.parse(srv.ordre.refused_at) >= clic.t - 2000 && Date.parse(srv.ordre.refused_at) <= Date.now() + 1500, srv.ordre.refused_at);
    attendu.set(o.id, { status: 'refused', delay: null });
  }
  const apres = await etat();
  const dv = derives(avant, apres, [o.id]);
  stats.collateral += dv.length;
  B.controle(`${lib} : aucune autre commande modifiée`, dv.length === 0, dv.slice(0, 3).join(' ; '));
  if (double !== null) {
    await sleep(900);
    const posts = postsDecision(ong, o.id, clic.t - 300);
    const s = await lireSonde(ong.page);
    B.controle(`${lib} : double clic -> UNE seule requête de décision`, posts.length === 1, `${posts.length} requête(s), clics reçus : ${s.clics.slice(nClics).map((c) => c.action).join(',')}`);
    const e2 = (await etat()).parId.get(o.id);
    B.controle(`${lib} : double clic -> refused_at inchangé`, srv.ok && e2.refused_at === srv.ordre.refused_at, e2.refused_at);
    const suivante = (await etat());
    const nbDecidees = suivante.liste.filter((x) => attendu.get(x.id) && attendu.get(x.id).status !== x.status).length;
    B.controle(`${lib} : double clic -> la commande suivante n'est pas touchée`, nbDecidees === 0, `${nbDecidees} écart(s) avec les décisions attendues`);
  }
  if (ui) {
    const sorti = await attendre(async () => !(await chipPresent(ong, o.id)), 4000, 40);
    B.controle(`${lib} : la commande quitte « À traiter »`, sorti.ok, sorti.ok ? `${Date.now() - clic.t} ms après le clic` : 'toujours présente');
    const ferme = (await lireDialogue(ong)).ouvert === false;
    B.controle(`${lib} : la fenêtre est refermée`, ferme, '');
    B.controle(`${lib} : absente de « En préparation »`, !(await prepPresent(ong, o.id)), '');
    const tt = await attendreToast(ong, `Commande de ${o.nom} refusée`, clic.t, 3000);
    B.controle(`${lib} : message « refusée »`, tt.ok, tt.ok ? `${tt.valeur.t - clic.t} ms` : 'message absent');
    const restantes = idsAvant.filter((id) => id !== o.id);
    const sel = await attendre(async () => { const d = await lireDetail(ong); return restantes.length ? d.selection === restantes[0] : d.vide ? d : null; }, 3000, 60);
    B.controle(`${lib} : la sélection passe à la commande suivante`, sel.ok, `attendu #${restantes[0]}`);
  }
  return { clic, serveur: srv.ordre };
}

/** Pastille « En préparation » -> ticket -> « Commande prête · prévenir le client ». */
async function parcoursPrete(ong, o, opt = {}) {
  const { double = null, ui = true } = opt;
  const lib = `Prête · ${o.nom}`;
  const e0 = (await etat()).parId.get(o.id);
  await cliquer(ong.page, selPrep(o.id), { nom: `pastille « en préparation » de ${o.nom}` });
  // Livraison : « Livreur sur la route » à la place de « Commande prête » (c'est le livreur qui part, pas le client qui vient).
  const texteBoutonPret = e0.mode === 'delivery' ? 'Livreur sur la route · prévenir le client' : 'Commande prête · prévenir le client';
  const dlg = await attendre(async () => { const d = await lireDialogue(ong); return d.ouvert && d.boutons.some((b) => b.action === 'mark-ready') ? d : null; }, 2500, 50);
  B.controle(`${lib} : la pastille ouvre le ticket avec « ${texteBoutonPret} »`, dlg.ok && dlg.valeur.titre === `Ticket — ${o.nom}` && dlg.valeur.boutons.some((b) => b.texte === texteBoutonPret), dlg.ok ? dlg.valeur.titre : 'pas de fenêtre');
  if (dlg.ok) {
    const t = dlg.valeur.texte;
    const delaiAnnonceTicket = e0.mode === 'delivery' ? `plus ou moins ${libelleDelai(e0.delay_minutes)}` : libelleDelai(e0.delay_minutes);
    // Un retrait au commerce n'affiche volontairement aucune étiquette de mode sur le ticket (voir le commentaire
    // « rien de plus ici pour un retrait au commerce » dans buildTicketBytes, assets/js/commercant.js) : seule la
    // livraison affiche « LIVRAISON ».
    const modeOk = e0.mode === 'delivery' ? t.includes('LIVRAISON') : true;
    B.controle(`${lib} : le ticket indique mode, client, total, délai annoncé et heure prévue`,
      modeOk && t.includes(o.nom) && t.includes(eur(e0.total_cents)) && t.includes(delaiAnnonceTicket) && t.includes(`Prête vers${hm(e0.ready_at)}`.replace('vers', 'vers')) ,
      t.slice(0, 160));
  }
  let e = (await etat()).parId.get(o.id);
  B.controle(`${lib} : ticket ouvert, la commande est toujours « accepted » (serveur)`, e.status === 'accepted' && e.prepared_at === null, `${e.status}/${e.prepared_at}`);
  const avant = await etat();
  const nClics = (await lireSonde(ong.page)).clics.length;
  const clic = double === null
    ? await cliquer(ong.page, '#dlg [data-action="mark-ready"]', { nom: 'Commande prête' })
    : await doubleCliquer(ong.page, '#dlg [data-action="mark-ready"]', { ecartMs: double, nom: 'Commande prête (double clic)' });
  const srv = await attendreServeur(o.id, (x) => x.status === 'ready', 6000);
  B.controle(`${lib} : serveur « ready » avec prepared_at`, srv.ok && !!srv.ordre.prepared_at, `${srv.ordre && srv.ordre.status}/${srv.ordre && srv.ordre.prepared_at}`);
  if (srv.ok) {
    const p = Date.parse(srv.ordre.prepared_at);
    B.controle(`${lib} : prepared_at = instant du clic, ready_at (estimation) et délai inchangés`, p >= clic.t - 2000 && p <= Date.now() + 1500 && p >= Date.parse(srv.ordre.accepted_at) && srv.ordre.ready_at === e0.ready_at && srv.ordre.delay_minutes === e0.delay_minutes, `prepared_at=${srv.ordre.prepared_at}`);
    attendu.set(o.id, { status: 'ready', delay: e0.delay_minutes });
  }
  const apres = await etat();
  const dv = derives(avant, apres, [o.id]);
  stats.collateral += dv.length;
  B.controle(`${lib} : aucune autre commande modifiée`, dv.length === 0, dv.slice(0, 3).join(' ; '));
  if (double !== null) {
    await sleep(900);
    const posts = postsDecision(ong, o.id, clic.t - 300);
    const s = await lireSonde(ong.page);
    B.controle(`${lib} : double clic -> UNE seule requête « prête »`, posts.length === 1, `${posts.length} requête(s), clics reçus : ${s.clics.slice(nClics).map((c) => c.action).join(',')}`);
    const e2 = (await etat()).parId.get(o.id);
    B.controle(`${lib} : double clic -> prepared_at inchangé`, srv.ok && e2.prepared_at === srv.ordre.prepared_at, e2.prepared_at);
  }
  if (ui) {
    const ferme = await attendre(async () => !(await lireDialogue(ong)).ouvert, 3000, 50);
    B.controle(`${lib} : la fenêtre du ticket se referme`, ferme.ok, '');
    const sorti = await attendre(async () => !(await prepPresent(ong, o.id)), 4000, 40);
    B.controle(`${lib} : la commande quitte « En préparation »`, sorti.ok, sorti.ok ? `${Date.now() - clic.t} ms après le clic` : 'toujours présente');
    const texteToastPret = e0.mode === 'delivery' ? `Livreur en route pour ${o.nom} · le client est prévenu` : `Commande de ${o.nom} prête · le client est prévenu`;
    const tt = await attendreToast(ong, texteToastPret, clic.t, 3000);
    B.controle(`${lib} : message « ${texteToastPret} »`, tt.ok, tt.ok ? `${tt.valeur.t - clic.t} ms` : 'message absent');
  }
  return { clic, serveur: srv.ordre };
}

function analyserAlertes(sonde, depuis, jusqua, commandes, libelle, { geste = true } = {}) {
  const annonces = sonde.live.filter((x) => x.t >= depuis && x.t <= jusqua);
  const noms = [];
  for (const a of annonces) { const n = nomsAnnonces(a.texte); if (n) noms.push(...n); }
  const attendus = commandes.map((c) => c.nom);
  const manquants = attendus.filter((n) => !noms.includes(n));
  const doublons = noms.filter((n, i) => noms.indexOf(n) !== i);
  B.controle(`${libelle} : chaque commande est annoncée dans la zone aria-live`, manquants.length === 0, `${noms.length} nom(s) annoncé(s) pour ${attendus.length} commande(s) en ${annonces.length} annonce(s) ; manquants : ${manquants.slice(0, 3).join(',')}`);
  B.controle(`${libelle} : aucune commande annoncée deux fois`, doublons.length === 0, doublons.slice(0, 3).join(','));
  const vib = sonde.vib.filter((x) => x.t >= depuis && x.t <= jusqua);
  if (geste) {
    B.controle(`${libelle} : une vibration [250,120,250] par alerte`, vib.length === annonces.length && vib.every((v) => JSON.stringify(v.p) === '[250,120,250]'), `${vib.length} vibration(s) pour ${annonces.length} alerte(s)`);
    const sansBip = annonces.filter((a) => sonde.osc.filter((t) => t >= a.t - 500 && t <= a.t + 300).length < 2);
    B.controle(`${libelle} : un bip sonore (2 notes) à chaque alerte`, sansBip.length === 0, `${sansBip.length} alerte(s) sans bip`);
  } else {
    B.controle(`${libelle} : sans geste de l'utilisateur, aucune vibration appelée (règle du navigateur respectée)`, vib.length === 0, `${vib.length}`);
  }
  return { annonces, noms };
}

function latences(sonde, commandes) {
  return commandes.map((c) => (sonde.chips[c.id] === undefined ? Infinity : sonde.chips[c.id] - c.t));
}

async function convergence(ong, libelle, timeout = 9000) {
  let dernier = null;
  const res = await attendre(async () => {
    const [s, c] = [await etat(), await lireIds(ong)];
    dernier = { serveur: nouvellesServeur(s), page: c };
    return JSON.stringify(dernier.serveur) === JSON.stringify(dernier.page);
  }, timeout, 150);
  let detail = '';
  if (!res.ok && dernier) {
    const manquantes = dernier.serveur.filter((id) => !dernier.page.includes(id));
    const enTrop = dernier.page.filter((id) => !dernier.serveur.includes(id));
    detail = `serveur ${dernier.serveur.length}, page ${dernier.page.length}, manquantes [${manquantes.slice(0, 5)}], en trop [${enTrop.slice(0, 5)}]`;
  } else detail = `${dernier ? dernier.page.length : '?'} pastille(s), convergence en ${res.ms} ms`;
  B.controle(`${libelle} : file affichée = commandes « new » du serveur, même ordre d'arrivée`, res.ok, detail);
  return res;
}

stats.latencesUiDecision = [];

// ───────────────────────────── Scénario ─────────────────────────────

async function phase(titre, fn) {
  B.section(titre);
  try { await fn(); } catch (e) {
    B.controle(`Phase « ${titre} » menée à son terme`, false, String(e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e));
  }
  if (A && A.page) await remettreEnEtat(A);
}

async function principal() {
  site = await demarrerSite();
  B.section(`Préparation : site local, ${NB_CLIENTS} comptes clients, session du patron`);
  const t0 = Date.now();
  const preparation = creerClients(NB_CLIENTS, { concurrence: 20 }).then((v) => ({ v }), (e) => ({ e }));
  patron = await patronConnecte('10.250.250.250');
  const prep = await preparation;
  if (prep.e) throw prep.e;
  clients = prep.v;
  B.controle(`${NB_CLIENTS} comptes clients créés (une adresse IP simulée chacun)`, clients.length === NB_CLIENTS, `${Date.now() - t0} ms`);

  // 3 commandes déjà en attente AVANT l'ouverture de la page.
  const initiales = [];
  for (let i = 0; i < 3; i++) initiales.push(await passer(clients[i], { mode: i === 1 ? 'delivery' : 'pickup' }));

  await avecNavigateur(async (nav) => {
    const ouvrir = async (nom, cookies, type) => {
      const page = await nav.ouvrirPage('about:blank', { cookies, ...VUE });
      await installerSondes(page, type);
      return { page, journal: suivreReseau(page, { corps: true }), nom };
    };

    // ─────────────── 1. Chargement ───────────────
    await phase('1. Chargement : file initiale, horloge, état du son sans geste', async () => {
      A = await ouvrir('A', patron, 'patron');
      await A.page.navigate(`${site.base}/commercant/index.html`);
      const pret = await attendre(() => A.page.evaluate(`document.querySelectorAll('#queue .qchip').length === ${initiales.length}`), 10000, 100);
      B.controle('La page commerçant s\'ouvre déjà connectée (cookies du patron), la file initiale s\'affiche', pret.ok, `${pret.ms} ms`);
      const ecran = await A.page.evaluate(`({ main: !document.getElementById('main').hidden, login: !document.getElementById('login-view').hidden, boot: !document.getElementById('boot').hidden, bandeau: !document.getElementById('net-banner').hidden, prep: !document.getElementById('prep-strip').hidden, vis: document.visibilityState })`);
      B.controle('Écran principal visible, pas de connexion, pas de bandeau « Connexion perdue »', ecran.main && !ecran.login && !ecran.boot && !ecran.bandeau, JSON.stringify(ecran));
      B.controle('Bande « En préparation » masquée tant qu\'aucune commande n\'est acceptée', !ecran.prep, '');
      B.controle('La page est au premier plan (sondage toutes les 4 s)', ecran.vis === 'visible', ecran.vis);
      await convergence(A, 'Chargement');
      const s0 = await etat();
      const idsServeur = nouvellesServeur(s0);
      const detail = await lireDetail(A);
      B.controle('La 1re commande (la plus ancienne) est sélectionnée d\'office', detail.selection === idsServeur[0], `sélection #${detail.selection}, attendu #${idsServeur[0]}`);
      await verifierDetail(A, initiales[0], s0.parId.get(initiales[0].id), 1);
      const libs = await A.page.evaluate(`Array.from(document.querySelectorAll('#queue .qchip')).map((b) => b.getAttribute('aria-label'))`);
      B.controle('Chaque pastille annonce son rang (« Commande 1 de la file… »)', libs.every((l, i) => l.startsWith(`Commande ${i + 1} de la file, `)), libs[0]);
      const sonde = await lireSonde(A.page);
      B.controle('Aucune alerte pour les commandes déjà là au chargement (pas d\'annonce, pas de vibration)', sonde.live.length === 0 && sonde.vib.length === 0, `${sonde.live.length} annonce(s), ${sonde.vib.length} vibration(s)`);
      const h1 = await A.page.evaluate(`document.getElementById('clock').textContent`);
      await sleep(1300);
      const h2 = await A.page.evaluate(`document.getElementById('clock').textContent`);
      const n = new Date();
      const secs = (t) => { const [h, m, s] = t.split(':').map(Number); return h * 3600 + m * 60 + s; };
      const ecart = Math.abs(secs(h2) - secs(hms(n)));
      B.controle('L\'horloge affiche HH:MM:SS (heure de Paris), avance toute seule', /^\d\d:\d\d:\d\d$/.test(h2) && h1 !== h2 && Math.min(ecart, 86400 - ecart) <= 3, `${h1} -> ${h2} (attendu ~${hms(n)})`);
    });

    await phase('2. Alerte de nouvelle commande SANS geste puis avec un geste', async () => {
      await sleep(1700);
      const s1 = await lireSonde(A.page);
      B.controle('Sans geste de l\'utilisateur : l\'AudioContext du navigateur reste suspendu (politique de lecture automatique)', s1.ctx.length === 1 && s1.ctx[0] === 'suspended' && s1.osc.length === 0 && s1.activation === false, `ctx=${s1.ctx} bips=${s1.osc.length} activation=${s1.activation}`);
      const tDebut = Date.now() - 50;
      const o = await passer(clients[3], { mode: 'pickup' });
      const ap = await attendre(() => A.page.evaluate(`!!document.querySelector('${selChip(o.id)}')`), 9000, 40);
      const lat = Date.now() - o.t;
      B.controle(`Nouvelle commande ${o.nom} affichée sans recharger la page, en ≤ ${APPARITION_MAX_MS / 1000} s`, ap.ok && lat <= APPARITION_MAX_MS, `${lat} ms`);
      await sleep(400);
      const s2 = await lireSonde(A.page);
      analyserAlertes(s2, tDebut, Date.now(), [o], 'Alerte sans geste', { geste: false });
      B.controle('Alerte sans geste : annonce « Nouvelle commande de … » dans la zone aria-live assertive', s2.live.some((x) => x.texte === `Nouvelle commande de ${o.nom}`), s2.live.map((x) => x.texte).join(' | '));
      B.controle('Alerte sans geste : AudioContext toujours suspendu, aucun bip (constat)', s2.ctx[0] === 'suspended' && s2.osc.length === 0, `ctx=${s2.ctx} bips=${s2.osc.length}`);
      // 1er geste réel : l'onglet « Commandes ».
      const tGeste = Date.now();
      await cliquer(A.page, '[data-action="view"][data-view="orders"]', { nom: 'onglet Commandes' });
      const run = await attendre(async () => (await lireSonde(A.page)).ctx[0] === 'running', 3000, 50);
      B.controle('Après le 1er toucher, l\'AudioContext passe à « running » (déverrouillage du son)', run.ok, `${run.ms} ms`);
      const bip = await attendre(async () => (await lireSonde(A.page)).osc.filter((t) => t >= tGeste).length >= 2, 4000, 60);
      B.controle('L\'alarme sonne (2 notes) dès que le son est déverrouillé, tant qu\'une commande attend', bip.ok, `${bip.ms} ms`);
      const s3 = await lireSonde(A.page);
      B.controle('Le toucher donne l\'activation utilisateur (la vibration devient possible)', s3.activation === true, `${s3.activation}`);
    });

    // ─────────────── 3. Compte-gouttes ───────────────
    let goutte = [];
    let tDebutFlux = 0;
    await phase('3. Compte-gouttes : 12 commandes, une toutes les ~1,3 s, page ouverte et inactive', async () => {
      tDebutFlux = Date.now();
      const idsAvant = (await lireIds(A)).length;
      for (let i = 0; i < 12; i++) {
        goutte.push(await passer(clients[4 + i], { mode: i % 3 === 0 ? 'delivery' : 'pickup' }));
        await sleep(850 + Math.floor(r() * 900));
      }
      const tous = await attendre(() => A.page.evaluate(`document.querySelectorAll('#queue .qchip').length === ${idsAvant + 12}`), 10000, 80);
      B.controle('Les 12 commandes du compte-gouttes sont toutes apparues', tous.ok, `${tous.ok ? 'ok' : 'pastilles : ' + (await lireIds(A)).length + ' / ' + (idsAvant + 12)}`);
      await sleep(600);
      const sonde = await lireSonde(A.page);
      const lat = latences(sonde, goutte);
      const st = statistiques(lat.filter(Number.isFinite));
      B.controle(`Délai d'apparition de chaque commande ≤ ${APPARITION_MAX_MS / 1000} s (sondage 4 s)`, lat.every((x) => x <= APPARITION_MAX_MS), fmtStat(st));
      B.metrique(`apparition d'une commande dans la file (compte-gouttes) : ${fmtStat(st)}`);
      B.controle('Aucune commande n\'apparaît avant d\'avoir été créée', lat.every((x) => x >= -150), `min ${Math.round(st.min)} ms`);
      analyserAlertes(sonde, tDebutFlux - 20, Date.now(), goutte, 'Compte-gouttes');
      await convergence(A, 'Compte-gouttes');
      const dom = await lireIds(A);
      B.controle('Aucune pastille en double', new Set(dom).size === dom.length, `${dom.length} pastilles`);
    });

    // ─────────────── 4. Rafale ───────────────
    let rafale = [];
    await phase('4. Rafale : 20 clients envoient au même instant', async () => {
      const base = (await lireIds(A)).length;
      const tR = Date.now() - 20;
      rafale = await enParallele(clients.slice(16, 36), 20, (c, i) => passer(c, { mode: i % 2 ? 'delivery' : 'pickup' }));
      const dureeEnvoi = Date.now() - tR;
      const tous = await attendre(() => A.page.evaluate(`document.querySelectorAll('#queue .qchip').length === ${base + 20}`), 12000, 80);
      B.controle('Les 20 commandes de la rafale sont toutes apparues', tous.ok, `envoi en ${dureeEnvoi} ms, ${tous.ms} ms pour tout afficher`);
      await sleep(600);
      const sonde = await lireSonde(A.page);
      const lat = latences(sonde, rafale);
      const st = statistiques(lat.filter(Number.isFinite));
      B.controle(`Délai d'apparition de chaque commande de la rafale ≤ ${APPARITION_MAX_MS / 1000} s`, lat.every((x) => x <= APPARITION_MAX_MS), fmtStat(st));
      B.metrique(`apparition d'une commande dans la file (rafale de 20) : ${fmtStat(st)}`);
      analyserAlertes(sonde, tR, Date.now(), rafale, 'Rafale');
      await convergence(A, 'Rafale');
      const e = await etat();
      const nouvelles = e.liste.filter((o) => o.status === 'new');
      let croissant = true;
      for (let i = 1; i < nouvelles.length; i++) {
        const a = nouvelles[i - 1];
        const b = nouvelles[i];
        if (a.created_at > b.created_at || (a.created_at === b.created_at && a.id > b.id)) croissant = false;
      }
      B.controle('Tri par arrivée : created_at croissant, à égalité l\'identifiant (serveur)', croissant, `${nouvelles.length} commandes`);
      const ids = await lireIds(A);
      B.controle('Tri par arrivée : les pastilles de la page suivent exactement cet ordre', JSON.stringify(ids) === JSON.stringify(nouvelles.map((o) => o.id)), '');
      // cadence du sondage observée (page visible, inactive)
      const polls = A.journal.filter((x) => x.route === 'owner_orders' && x.t >= tDebutFlux && x.t <= Date.now() && x.erreur === null);
      const ecarts = [];
      for (let i = 1; i < polls.length; i++) ecarts.push(polls[i].t - polls[i - 1].t);
      const sc = statistiques(ecarts);
      B.controle('Cadence du sondage de la file : ≈ 4 s entre deux requêtes (page visible)', ecarts.length >= 5 && sc.p50 >= 3700 && sc.p50 <= 4800 && sc.max <= 7000, fmtStat(sc));
      B.metrique(`intervalle entre deux sondages de la file (page visible) : ${fmtStat(sc)}`);
      B.controle('Aucune erreur JavaScript dans la page commerçant', A.page.erreurs.length === 0, A.page.erreurs.slice(0, 2).join(' | '));
    });

    await phase('4b. Page sur un autre espace (« Espace patron ») : les arrivées sont quand même reçues et annoncées', async () => {
      const va = await allerVue(A, 'patron');
      B.controle('L\'espace patron est affiché, la file masquée', va.ok, `${va.ms} ms`);
      const recv = await attendre(() => A.page.evaluate(`document.getElementById('recap-total') ? { total: document.getElementById('recap-total').textContent, vide: (document.querySelector('#recap-list .recap-empty') || {}).textContent || null } : null`), 3000, 50);
      const rec = recv.ok ? recv.valeur : { total: '', vide: null };
      B.controle('Recette du jour vide : « 0,00 € » et message « Aucune commande acceptée »', norm(rec.total) === '0,00 €' && /Aucune commande acceptée/.test(rec.vide || ''), `${norm(rec.total)} / ${rec.vide}`);
      const base = (await lireIds(A)).length;
      const tR = Date.now() - 20;
      const six = await enParallele(clients.slice(36, 42), 6, (c, i) => passer(c, { mode: i % 2 ? 'delivery' : 'pickup' }));
      const tous = await attendre(() => A.page.evaluate(`document.querySelectorAll('#queue .qchip').length === ${base + 6}`), 12000, 80);
      B.controle('Les 6 commandes arrivées pendant que la file est masquée sont reçues', tous.ok, `${tous.ms} ms`);
      await sleep(500);
      analyserAlertes(await lireSonde(A.page), tR, Date.now(), six, 'Autre espace');
      await allerVue(A, 'orders');
      const visible = await A.page.evaluate(`(() => { const q = document.querySelector('#queue .qchip'); return { vue: !document.getElementById('view-orders').hidden, pastilleVisible: !!q && q.offsetParent !== null }; })()`);
      B.controle('De retour sur « Commandes », la file à jour est visible', visible.vue && visible.pastilleVisible, JSON.stringify(visible));
      await convergence(A, 'Retour sur Commandes');
    });

    // ─────────────── 5. Décisions ───────────────
    await phase('5a. Décisions : Accepter avec chacun des délais 20, 30, 40, 50, 60 (clics réels)', async () => {
      const e = await etat();
      const ids = nouvellesServeur(e);
      const parId = new Map(envoyees.map((o) => [o.id, o]));
      B.info(`${ids.length} commandes en attente avant les décisions`);
      // 1re : une pastille qui n'est pas en tête (rang 5), avec l'annulation d'abord.
      await parcoursAccepter(A, parId.get(ids[4]), 20, { annulerAvant: true, detail: true });
      const rangs = [0, 3, 0, 7];
      for (const [k, d] of [30, 40, 50, 60].entries()) {
        const cur = nouvellesServeur(await etat());
        await parcoursAccepter(A, parId.get(cur[rangs[k]]), d, { detail: d === 30 });
      }
      B.controle('Aucune erreur JavaScript dans la page commerçant (décisions)', A.page.erreurs.length === 0, A.page.erreurs.slice(0, 2).join(' | '));
    });

    await phase('5b. Décisions : Refuser (annulation puis confirmation) x3', async () => {
      const parId = new Map(envoyees.map((o) => [o.id, o]));
      let cur = nouvellesServeur(await etat());
      await parcoursRefuser(A, parId.get(cur[0]), { annulerAvant: true });
      cur = nouvellesServeur(await etat());
      await parcoursRefuser(A, parId.get(cur[2]));
      cur = nouvellesServeur(await etat());
      await parcoursRefuser(A, parId.get(cur[0]));
    });

    await phase('5c. Décisions : marquer prête (ticket -> « Commande prête · prévenir le client ») x3', async () => {
      const prepIds = await lireIds(A, '#prep-queue');
      B.controle('La bande « En préparation » contient les 5 commandes acceptées, par ordre d\'acceptation', prepIds.length === 5, `${prepIds.length} pastille(s)`);
      const parId = new Map(envoyees.map((o) => [o.id, o]));
      for (const id of prepIds.slice(0, 3)) await parcoursPrete(A, parId.get(id));
      const reste = await lireIds(A, '#prep-queue');
      B.controle('Il reste 2 commandes en préparation', reste.length === 2, `${reste.length}`);
    });

    await phase('5d. Double clic rapide sur Confirmer, « Commande prête » et « Oui, refuser » : une seule décision', async () => {
      const parId = new Map(envoyees.map((o) => [o.id, o]));
      let cur = nouvellesServeur(await etat());
      const x = parId.get(cur[0]);
      await parcoursAccepter(A, x, 40, { double: 0 });
      await parcoursPrete(A, x, { double: 0 });
      cur = nouvellesServeur(await etat());
      await parcoursRefuser(A, parId.get(cur[0]), { double: 0 });
      // double clic « humain » (écart de 110 ms) sur Confirmer
      cur = nouvellesServeur(await etat());
      const y = parId.get(cur[0]);
      await parcoursAccepter(A, y, 50, { double: 110, ui: false });
      const ouvert = await lireDialogue(A);
      if (ouvert.ouvert) {
        B.info(`constat : le 2e clic du double clic espacé a ouvert une fenêtre (« ${ouvert.titre} ») : fermée par le test`);
        await cliquer(A.page, '#dlg [data-action="dlg-close"]', { nom: 'fermer la fenêtre' });
      }
      const apres = await etat();
      const nbSuivante = apres.liste.filter((o) => o.status === 'new' && attendu.get(o.id) && attendu.get(o.id).status !== 'new').length;
      B.controle('Double clic espacé de 110 ms : une seule décision, la commande suivante reste nouvelle', nbSuivante === 0, `${nbSuivante}`);
    });

    // Fenêtre sans arrivée : l'alarme doit s'arrêter 30 s après la dernière arrivée alors que des commandes attendent.
    await phase('5e. Alarme : 30 s au plus après la dernière nouvelle commande', async () => {
      const s = await lireSonde(A.page);
      const derniere = s.live.length ? s.live[s.live.length - 1].t : null;
      const maintenant = Date.now();
      if (derniere === null || maintenant - derniere < 36000) {
        B.info(`fenêtre trop courte (${derniere === null ? 'aucune annonce' : Math.round((maintenant - derniere) / 1000) + ' s'} depuis la dernière arrivée) : attente jusqu'à 36 s`);
        if (derniere !== null) await sleep(Math.max(0, 36000 - (maintenant - derniere)));
      }
      const s2 = await lireSonde(A.page);
      const t0 = s2.live[s2.live.length - 1].t;
      const avant = s2.osc.filter((t) => t > t0 + 2000 && t <= t0 + 28000).length;
      const apres = s2.osc.filter((t) => t > t0 + 32000).length;
      const en = await etat();
      B.controle('Alarme : elle sonne pendant ~30 s après la dernière arrivée (≥ 12 notes entre +2 s et +28 s)', avant >= 12, `${avant} note(s)`);
      B.controle('Alarme : plus aucun bip au-delà de 32 s sans nouvelle commande, alors que des commandes attendent', apres === 0 && nouvellesServeur(en).length > 0, `${apres} note(s) après +32 s, ${nouvellesServeur(en).length} commande(s) en attente`);
    });

    await phase('5f. Une nouvelle commande arrive PENDANT le choix du délai : le choix en cours est conservé', async () => {
      // À emporter explicitement (et non la première venue) : l'assertion ci-dessous vérifie un texte
      // de confirmation fixe (« 50 min », sans « plus ou moins »), propre à l'emporter.
      const parId = new Map(envoyees.map((o) => [o.id, o]));
      const cur = nouvellesServeur(await etat());
      const x = parId.get(cur.find((id) => parId.get(id).mode !== 'delivery'));
      const arrivees = [];
      await parcoursAccepter(A, x, 50, {
        ui: false,
        entre: async () => {
          const base = (await lireIds(A)).length;
          arrivees.push(await passer(clients[42], { mode: 'pickup' }), await passer(clients[43], { mode: 'pickup' }), await passer(clients[44], { mode: 'pickup' }));
          const ap = await attendre(() => A.page.evaluate(`document.querySelectorAll('#queue .qchip').length === ${base + 3}`), 9000, 80);
          B.controle('Pendant le choix du délai, 3 nouvelles commandes apparaissent dans la file', ap.ok, `${ap.ms} ms`);
          const d = await lireDecision(A);
          const det = await lireDetail(A);
          B.controle('Le choix en cours est intact : même commande, tuile 50 choisie, « Confirmer · 50 min »', det.selection === x.id && d.confirmer === 'Confirmer · 50 min' && d.tuiles.find((t) => t.min === 50 && t.on) !== undefined, `sélection #${det.selection}, ${d.confirmer}`);
        }
      });
    });

    await phase('5g. Décision prise ailleurs (API) pendant que la commande est sélectionnée à l\'écran', async () => {
      const parId = new Map(envoyees.map((o) => [o.id, o]));
      const cur = nouvellesServeur(await etat());
      const y = parId.get(cur[1]);
      await selectionner(A, y);
      await cliquer(A.page, '#decision [data-action="accept"]', { nom: 'Accepter' });
      const rep = await patron.post('owner_order_decide.php', { id: y.id, action: 'accept', delay_minutes: 20 });
      const tAutre = Date.now();
      attendu.set(y.id, { status: 'accepted', delay: 20 });
      B.controle('Décision prise depuis un autre appareil (API) : 200', rep.status === 200 && rep.json.order.status === 'accepted', `${rep.status}`);
      const sorti = await attendre(async () => !(await chipPresent(A, y.id)), 9000, 60);
      B.controle(`La pastille de ${y.nom} disparaît de « À traiter » toute seule (≤ ${APPARITION_MAX_MS / 1000} s)`, sorti.ok && Date.now() - tAutre <= APPARITION_MAX_MS, `${Date.now() - tAutre} ms`);
      const prep = await attendre(() => prepPresent(A, y.id), 3000, 60);
      B.controle(`${y.nom} apparaît dans « En préparation »`, prep.ok, '');
      const det = await lireDetail(A);
      B.controle('La sélection saute à une autre commande en attente (le choix du délai interrompu est abandonné)', det.selection !== y.id && det.selection !== null && (await lireDecision(A)).tuiles.length === 0, `sélection #${det.selection}`);
      B.controle('Le détail affiché ne montre plus la commande décidée ailleurs', !norm(det.texte).includes(y.nom), '');
    });

    await phase('5h. Délai par défaut : réglage, présélection', async () => {
      await cliquer(A.page, '[data-action="default-delay-open"]', { nom: 'Délai par défaut' });
      const dlg = await attendre(async () => { const d = await lireDialogue(A); return d.ouvert ? d : null; }, 2500, 50);
      B.controle('« Délai par défaut » ouvre la fenêtre des 6 délais', dlg.ok && dlg.valeur.boutons.filter((b) => b.action === 'set-default').length === 6, dlg.ok ? dlg.valeur.titre : 'pas de fenêtre');
      const t0 = Date.now();
      await cliquer(A.page, '#dlg [data-action="set-default"][data-min="50"]', { nom: 'défaut 50' });
      const tt = await attendreToast(A, 'Délai par défaut : 50 min', t0, 3000);
      B.controle('Le réglage affiche « Délai par défaut : 50 min »', tt.ok, '');
      const srv = await patron.get('owner_settings.php');
      B.controle('Le serveur retient 50 minutes', srv.json.default_delay_minutes === 50, `${srv.json.default_delay_minutes}`);
      delaiParDefaut = 50;
      const bouton = await A.page.evaluate(`document.getElementById('default-delay-btn').textContent`);
      B.controle('Le bouton annonce « Délai par défaut · 50 min »', norm(bouton) === 'Délai par défaut · 50 min', norm(bouton));
      await attendre(async () => !(await lireDialogue(A)).ouvert, 2500, 60);
      // Choisie explicitement à emporter (et non la première venue) : le délai par défaut réglé ici ne
      // s'applique qu'à l'emporter, la livraison présélectionne toujours 1 heure (voir plus haut).
      const parId = new Map(envoyees.map((o) => [o.id, o]));
      const cur = nouvellesServeur(await etat());
      const idPickup = cur.find((id) => parId.get(id).mode !== 'delivery');
      await selectionner(A, parId.get(idPickup));
      await cliquer(A.page, '#decision [data-action="accept"]', { nom: 'Accepter' });
      const d = await attendre(async () => { const x = await lireDecision(A); return x.tuiles.length === 7 ? x : null; }, 2500, 50);
      B.controle('Au clic sur Accepter, la tuile 50 est présélectionnée', d.ok && d.valeur.tuiles.filter((t) => t.on).map((t) => t.min).join() === '50' && d.valeur.confirmer === 'Confirmer · 50 min', d.ok ? d.valeur.confirmer : '');
      await cliquer(A.page, '#decision [data-action="edit-cancel"]', { nom: 'Annuler' });
      await cliquer(A.page, '[data-action="default-delay-open"]', { nom: 'Délai par défaut' });
      await attendre(async () => (await lireDialogue(A)).ouvert, 2500, 50);
      await cliquer(A.page, '#dlg [data-action="set-default"][data-min="30"]', { nom: 'défaut 30' });
      await attendre(async () => !(await lireDialogue(A)).ouvert, 2500, 60);
      delaiParDefaut = 30;
      B.controle('Délai par défaut remis à 30 min', (await patron.get('owner_settings.php')).json.default_delay_minutes === 30, '');
    });

    // ─────────────── 6. Page de suivi du client ───────────────
    await phase('6. Page de suivi d\'un client (2e onglet) : chaque décision apparaît toute seule', async () => {
      const suiveur = clients[45];
      const o1 = await passer(suiveur, { mode: 'pickup' });
      const o2 = await passer(suiveur, { mode: 'delivery' });
      const o3 = await passer(suiveur, { mode: 'pickup' });
      const vus = await attendre(async () => { const ids = await lireIds(A); return [o1, o2, o3].every((o) => ids.includes(o.id)); }, 10000, 100);
      B.controle('Les 3 commandes du client suivi apparaissent dans la file', vus.ok, `${vus.ms} ms`);
      T = await ouvrir('T', suiveur, 'suivi');
      await T.page.navigate(`${site.base}/commande.html?id=${o1.id}`);
      await mettreAuPremierPlan(T.page);
      await cliquer(T.page, '#orderTrackBody', { nom: 'corps de la page de suivi' }).catch(() => {});
      await mettreAuPremierPlan(A.page);
      await sleep(200);
      const pend = await attendre(() => T.page.evaluate(`document.getElementById('orderTrackBody').getAttribute('data-order-status')`), 8000, 80);
      B.controle(`Suivi #${o1.id} : la page affiche « en attente » (new, spinner)`, pend.ok && pend.valeur === 'new' && (await T.page.evaluate(`!!document.querySelector('.order-track-status--pending')`)), `${pend.valeur}`);
      const vis = await A.page.evaluate('document.visibilityState');
      B.controle('La page commerçant reste au premier plan pendant ce temps', vis === 'visible', vis);

      const suivi = async (statut, depuis, borneMs, libelle) => {
        const rr = await attendre(async () => (await T.page.evaluate('window.__sonde.statuts')).find((x) => x.statut === statut && x.t >= depuis - 20) || null, 16000, 100);
        const lat = rr.ok ? rr.valeur.t - depuis : null;
        B.controle(`${libelle} : la page de suivi passe à « ${statut} » sans recharger, en ≤ ${borneMs / 1000} s`, rr.ok && lat <= borneMs, rr.ok ? `${lat} ms` : 'jamais');
        return rr;
      };
      const mesures = [];

      // O1 : acceptée 20 min puis prête.
      const a1 = await parcoursAccepter(A, o1, 20, { ui: false });
      const s1 = await suivi('accepted', a1.clic.t, 8000, `Suivi #${o1.id}`);
      if (s1.ok) mesures.push(s1.valeur.t - a1.clic.t);
      const cls = await T.page.evaluate(`({ ok: !!document.querySelector('.order-track-status--ok'), compte: (document.getElementById('orderCountdown') || {}).textContent || null, titre: (document.querySelector('.order-track-status__title') || {}).textContent || '' })`);
      const restant = (Date.parse(a1.serveur.ready_at) - Date.now()) / 1000;
      const lu = (cls.compte || '').split(':').map(Number);
      const luS = lu.length === 2 ? lu[0] * 60 + lu[1] : NaN;
      B.controle(`Suivi #${o1.id} : « Commande acceptée ! » et minuteur M:SS proche de 20:00`, cls.ok && /^\d+:\d\d$/.test(cls.compte || '') && Math.abs(luS - restant) <= 6, `${cls.compte} (attendu ~${Math.round(restant)} s)`);
      const p1 = await parcoursPrete(A, o1, { ui: false });
      const s2 = await suivi('ready', p1.clic.t, 9000, `Suivi #${o1.id}`);
      if (s2.ok) mesures.push(s2.valeur.t - p1.clic.t);
      const fin1 = Date.now();
      const txt = await T.page.evaluate(`document.getElementById('orderTrackBody').textContent`);
      B.controle(`Suivi #${o1.id} : « Votre commande est prête ! » (classe --ready)`, /Votre commande est prête/.test(txt) && (await T.page.evaluate(`!!document.querySelector('.order-track-status--ready')`)), norm(txt).slice(0, 80));
      const vib = (await lireSonde(T.page)).vib.map((v) => JSON.stringify(v.p));
      B.controle(`Suivi #${o1.id} : la page vibre à chaque changement d'état (200 puis 300,150,300)`, vib.join() === '[200],[300,150,300]', vib.join());

      // O2 : refusée.
      await T.page.navigate(`${site.base}/commande.html?id=${o2.id}`);
      await attendre(() => T.page.evaluate(`document.getElementById('orderTrackBody').getAttribute('data-order-status') === 'new'`), 8000, 80);
      const rf = await parcoursRefuser(A, o2, { ui: false });
      const s3 = await suivi('refused', rf.clic.t, 8000, `Suivi #${o2.id}`);
      if (s3.ok) mesures.push(s3.valeur.t - rf.clic.t);
      const fin2 = Date.now();
      const txt2 = await T.page.evaluate(`({ t: document.getElementById('orderTrackBody').textContent, err: !!document.querySelector('.order-track-status--error'), tel: !!document.querySelector('a[href^="tel:"]') })`);
      B.controle(`Suivi #${o2.id} : « Commande refusée par le restaurant. » avec le lien pour appeler`, /Commande refusée par le restaurant/.test(txt2.t) && txt2.err && txt2.tel, norm(txt2.t).slice(0, 80));

      // O3 : acceptée 60 min.
      await T.page.navigate(`${site.base}/commande.html?id=${o3.id}`);
      await attendre(() => T.page.evaluate(`document.getElementById('orderTrackBody').getAttribute('data-order-status') === 'new'`), 8000, 80);
      const a3 = await parcoursAccepter(A, o3, 60, { ui: false });
      const s4 = await suivi('accepted', a3.clic.t, 8000, `Suivi #${o3.id}`);
      if (s4.ok) mesures.push(s4.valeur.t - a3.clic.t);
      const c3 = await T.page.evaluate(`(document.getElementById('orderCountdown') || {}).textContent || null`);
      B.controle(`Suivi #${o3.id} : minuteur proche de 60:00 (délai 1 heure)`, /^(59:[3-5]\d|60:00)$/.test(c3 || ''), `${c3}`);
      const st = statistiques(mesures);
      B.metrique(`page de suivi : décision -> écran du client mis à jour, sans recharger (onglet en arrière-plan) : ${fmtStat(st)}`);

      // le suivi s'arrête de lui-même à « ready » / « refused »
      await sleep(Math.max(0, 6500 - (Date.now() - Math.max(fin1, fin2))));
      const apresFin1 = T.journal.filter((x) => x.route === 'order_status' && x.url.endsWith('id=' + o1.id) && x.t > fin1 + 800).length;
      const apresFin2 = T.journal.filter((x) => x.route === 'order_status' && x.url.endsWith('id=' + o2.id) && x.t > fin2 + 800).length;
      B.controle(`Suivi #${o1.id} (prête) : le sondage s'arrête, plus aucune requête`, apresFin1 === 0, `${apresFin1} requête(s) après`);
      B.controle(`Suivi #${o2.id} (refusée) : le sondage s'arrête, plus aucune requête`, apresFin2 === 0, `${apresFin2} requête(s) après`);
      B.controle('Aucune erreur JavaScript sur la page de suivi', T.page.erreurs.length === 0, T.page.erreurs.slice(0, 2).join(' | '));
      await T.page.fermer();
      T = null;
    });

    // ─────────────── 7. Deux tablettes ───────────────
    await phase('7. Deux onglets patron : décision dans l\'un, l\'autre affiche « déjà traitée » sans erreur', async () => {
      const lot = [];
      for (let i = 0; i < 8; i++) lot.push(await passer(clients[46 + i], { mode: 'pickup', commande: { nbPizzas: 1, nbAutres: 0 } }));
      const [x1, x2, x3, x4, x5, x6, x7, x8] = lot;
      P2 = await ouvrir('P2', patron, 'patron');
      await P2.page.navigate(`${site.base}/commercant/index.html`);
      await mettreAuPremierPlan(P2.page);
      await attendre(async () => { const ids = await lireIds(P2); return lot.every((o) => ids.includes(o.id)); }, 12000, 100);
      const ids2 = await lireIds(P2);
      B.controle('La 2e tablette affiche aussi les 8 nouvelles commandes', lot.every((o) => ids2.includes(o.id)), `${ids2.length} pastilles`);
      await mettreAuPremierPlan(A.page);
      await attendre(async () => { const ids = await lireIds(A); return lot.every((o) => ids.includes(o.id)); }, 12000, 100);
      const snapshot = (await etat()).texte;
      const fig = await figerSondage(P2.page, snapshot);
      // Décisions sur la tablette A, par clics.
      await parcoursAccepter(A, x1, 30, { ui: false });
      await parcoursAccepter(A, x2, 30, { ui: false });
      await parcoursAccepter(A, x3, 20, { ui: false });
      await parcoursRefuser(A, x4, { ui: false });
      await parcoursRefuser(A, x5, { ui: false });
      // x6, x7, x8 : acceptées puis prêtes (autre appareil = API, pour gagner du temps)
      for (const o of [x6, x7, x8]) {
        const a = await patron.post('owner_order_decide.php', { id: o.id, action: 'accept', delay_minutes: 20 });
        const p = await patron.post('owner_order_decide.php', { id: o.id, action: 'ready' });
        B.controle(`${o.nom} : acceptée puis prête par l'autre appareil (API)`, a.status === 200 && p.status === 200 && p.json.order.status === 'ready', `${a.status}/${p.status}`);
        attendu.set(o.id, { status: 'ready', delay: 20 });
      }
      // La 2e tablette n'a rien vu (sondage figé) : elle croit encore à 8 commandes nouvelles.
      await mettreAuPremierPlan(P2.page);
      await sleep(400);
      const ids3 = await lireIds(P2);
      B.controle('La 2e tablette (sondage figé) affiche encore les 8 commandes comme nouvelles', lot.every((o) => ids3.includes(o.id)), `${ids3.length} pastilles, ${fig.servis()} sondage(s) figés servis`);

      // attenduToast : texte exact, ou { pas: /regex/, libelle } (le message ne doit pas contenir cela).
      const scenario = async (o, libelle, action, delai, attenduToast, attenduHttp) => {
        const avant = await etat();
        const t0 = Date.now();
        if (action === 'accept') await parcoursClicsAccepter(P2, o, delai);
        else await parcoursClicsRefuser(P2, o);
        const tt = await attendre(async () => (await lireToasts(P2.page)).find((x) => x.t >= t0 - 50 && /(acceptée|refusée|introuvable|Connexion|n'a pas)/.test(x.texte)) || null, 5000, 60);
        await sleep(250);
        const post = P2.journal.filter((x) => x.route === 'owner_order_decide' && x.t >= t0 && x.donnees && x.donnees.id === o.id);
        const sonde = await lireSonde(P2.page);
        const apres = await etat();
        const eAvant = avant.parId.get(o.id);
        const eApres = apres.parId.get(o.id);
        const http = post.length ? `${post[0].status}${post[0].reponse && post[0].reponse.replayed ? ' rejeu' : ''}${post[0].reponse && post[0].reponse.error ? ' ' + post[0].reponse.error : ''}` : 'aucune requête';
        B.controle(`${libelle} : la tablette en retard reçoit « ${attenduHttp} »`, post.length === 1 && http.startsWith(attenduHttp), http);
        if (typeof attenduToast === 'string') B.controle(`${libelle} : message affiché « ${attenduToast} »`, tt.ok && tt.valeur.texte === attenduToast, tt.ok ? tt.valeur.texte : 'aucun message');
        else B.controle(`${libelle} : ${attenduToast.libelle}`, tt.ok && !attenduToast.pas.test(tt.valeur.texte), tt.ok ? `message affiché : « ${tt.valeur.texte} »` : 'aucun message');
        B.controle(`${libelle} : la décision du premier appareil est conservée (statut, délai, horodatages)`,
          eApres.status === eAvant.status && eApres.delay_minutes === eAvant.delay_minutes && eApres.accepted_at === eAvant.accepted_at && eApres.refused_at === eAvant.refused_at && eApres.prepared_at === eAvant.prepared_at,
          `${eApres.status}/${eApres.delay_minutes}`);
        const dv = derives(avant, apres, []);
        stats.collateral += dv.length;
        B.controle(`${libelle} : aucune autre commande modifiée`, dv.length === 0, dv.slice(0, 3).join(' ; '));
        B.controle(`${libelle} : aucun message d'erreur ni de panne à l'écran`, !sonde.toasts.filter((x) => x.t >= t0 - 50).some((x) => /pas pu|Connexion impossible|introuvable/.test(x.texte)) && P2.page.erreurs.length === 0, P2.page.erreurs.slice(0, 1).join(''));
        return { tt, http };
      };
      const n = (o) => o.nom;
      await scenario(x1, 'Autre appareil : accepte 30 puis ici accepte 30 (même décision)', 'accept', 30, `Commande de ${n(x1)} acceptée · délai annoncé : 30 min`, '200 rejeu');
      await scenario(x2, 'Autre appareil : accepte 30 puis ici accepte 40', 'accept', 40, `La commande de ${n(x2)} était déjà acceptée (délai 30 min).`, '409 already_decided');
      await scenario(x3, 'Autre appareil : accepte 20 puis ici refuse', 'refuse', null, `La commande de ${n(x3)} était déjà acceptée (délai 20 min).`, '409 already_decided');
      await scenario(x4, 'Autre appareil : refuse puis ici accepte 30', 'accept', 30, `La commande de ${n(x4)} était déjà refusée.`, '409 already_decided');
      await scenario(x5, 'Autre appareil : refuse puis ici refuse (même décision)', 'refuse', null, `Commande de ${n(x5)} refusée`, '200 rejeu');
      // Commandes déjà PRÊTES chez l'autre appareil : le message doit dire que la commande est prête (ou au moins ne pas dire « refusée »).
      const pasRefusee = { pas: /refusée/, libelle: 'le message ne dit pas « refusée » alors que la commande est prête' };
      const rep6 = await scenario(x6, 'Autre appareil : accepte 20 et marque prête, ici accepte 20', 'accept', 20, pasRefusee, '200 rejeu');
      const rep7 = await scenario(x7, 'Autre appareil : accepte 20 et marque prête, ici accepte 40', 'accept', 40, pasRefusee, '409 already_decided');
      const rep8 = await scenario(x8, 'Autre appareil : accepte 20 et marque prête, ici accepte 20 (2e cas)', 'accept', 20, pasRefusee, '200 rejeu');
      stats.resultats7 = { rep6: rep6.tt.ok ? rep6.tt.valeur.texte : null, rep7: rep7.tt.ok ? rep7.tt.valeur.texte : null, rep8: rep8.tt.ok ? rep8.tt.valeur.texte : null };
      await fig.relacher();
      const ok = await attendre(async () => { const ids = await lireIds(P2); return lot.every((o) => !ids.includes(o.id)); }, 10000, 100);
      B.controle('Sondage rétabli : la 2e tablette retire d\'elle-même les 8 commandes déjà traitées', ok.ok, `${ok.ms} ms`);
      await convergence(P2, 'Deuxième tablette');
      await mettreAuPremierPlan(A.page);
      await convergence(A, 'Première tablette');
      await P2.page.fermer();
      P2 = null;
    });

    // ─────────────── 8. Coupure du réseau ───────────────
    await phase('8. Perte du réseau : bandeau « Connexion perdue », décision impossible, retour et rattrapage', async () => {
      await mettreAuPremierPlan(A.page);
      await sleep(300);
      const avant = await etat();
      const parId = new Map(envoyees.map((o) => [o.id, o]));
      const cible = parId.get(nouvellesServeur(avant)[0]);
      await coupureReseau(A.page, true);
      const tOff = Date.now();
      const banniere = await attendre(() => A.page.evaluate(`!document.getElementById('net-banner').hidden`), 10000, 60);
      const t1 = Date.now();
      B.controle('Réseau coupé : le bandeau « Connexion perdue » s\'affiche (≤ 6 s)', banniere.ok && t1 - tOff <= 6000, `${t1 - tOff} ms`);
      const txt = await A.page.evaluate(`document.getElementById('net-banner').textContent`);
      B.controle('Le bandeau dit « Connexion perdue, nouvelle tentative… »', /Connexion perdue/.test(txt), txt);
      B.metrique(`coupure du réseau -> bandeau « Connexion perdue » : ${t1 - tOff} ms`);

      // Pendant la coupure : 5 clients envoient des commandes (le serveur, lui, répond).
      const manquees = await enParallele(clients.slice(54, 59), 5, (c) => passer(c, { mode: 'pickup' }));
      const tManquees = Date.now() - 20;

      // Décision tentée hors connexion.
      await selectionner(A, cible);
      await cliquer(A.page, '#decision [data-action="accept"]', { nom: 'Accepter' });
      await cliquer(A.page, '#decision [data-action="delay"][data-min="30"]', { nom: 'tuile 30' });
      const tc = Date.now();
      await cliquer(A.page, '#decision [data-action="accept-confirm"]', { nom: 'Confirmer (hors connexion)' });
      const msg = await attendreToast(A, 'Connexion impossible : la décision n\'a pas été envoyée. Réessayez.', tc, 4000);
      B.controle('Décision hors connexion : message « Connexion impossible : la décision n\'a pas été envoyée »', msg.ok, msg.ok ? '' : 'aucun message');
      const live = await lireLive(A.page);
      B.controle('Décision hors connexion : le message est aussi annoncé (zone aria-live)', live.some((x) => x.t >= tc && /Connexion impossible/.test(x.texte)), '');
      const btn = await lireDecision(A);
      const confirmerAttendu = cible.mode === 'delivery' ? 'Confirmer · plus ou moins 30 min' : 'Confirmer · 30 min';
      B.controle(`Décision hors connexion : le bouton « ${confirmerAttendu} » est de nouveau actif (pas de blocage sur « Envoi… »)`, btn.confirmer === confirmerAttendu && btn.confirmerActif === true, `${btn.confirmer}/${btn.confirmerActif}`);
      const e1 = (await etat()).parId.get(cible.id);
      B.controle('Décision hors connexion : rien n\'a été enregistré (serveur) et la pastille reste dans « À traiter »', e1.status === 'new' && (await chipPresent(A, cible.id)), e1.status);
      const hors = (await lireIds(A)).filter((id) => manquees.some((m) => m.id === id));
      B.controle('Hors connexion, les commandes arrivées pendant la coupure ne sont pas (encore) affichées', hors.length === 0, `${hors.length} affichée(s)`);

      // Remise en ligne après ~10 s de coupure.
      const resteAttendre = 10000 - (Date.now() - tOff);
      if (resteAttendre > 0) await sleep(resteAttendre);
      await coupureReseau(A.page, false);
      const tOn = Date.now();
      const rattrape = await attendre(async () => {
        const [b, ids] = [await A.page.evaluate(`document.getElementById('net-banner').hidden`), await lireIds(A)];
        return b && manquees.every((m) => ids.includes(m.id));
      }, 45000, 100);
      B.controle('Réseau rétabli : le bandeau disparaît et les 5 commandes manquées apparaissent (≤ 35 s)', rattrape.ok && Date.now() - tOn <= 35000, rattrape.ok ? `${Date.now() - tOn} ms après le retour du réseau` : 'jamais');
      B.metrique(`retour du réseau -> bandeau retiré et commandes manquées affichées : ${Date.now() - tOn} ms (coupure de ${Math.round((tOn - tOff) / 1000)} s, 2 sondages ratés)`);
      await sleep(400);
      const sonde = await lireSonde(A.page);
      analyserAlertes(sonde, tOn - 20, Date.now(), manquees, 'Rattrapage après coupure');
      await convergence(A, 'Après la coupure');
      // La décision peut être refaite. L'échec hors connexion n'a jamais réinitialisé l'état « en train de choisir »
      // (state.editingId reste fixé sur cible.id, voir la vérification du bouton « Confirmer » plus haut) : le panneau
      // est toujours sur l'écran des tuiles de délai, pas sur le bouton initial « Accepter ». On confirme directement.
      await selectionner(A, cible);
      const tr = Date.now();
      await cliquer(A.page, '#decision [data-action="accept-confirm"]', { nom: 'Confirmer' });
      const ok = await attendreServeur(cible.id, (x) => x.status === 'accepted' && x.delay_minutes === 30, 6000);
      B.controle('Réseau rétabli : la décision refaite est enregistrée (accepted, 30 min)', ok.ok, `${ok.ms} ms`);
      if (ok.ok) attendu.set(cible.id, { status: 'accepted', delay: 30 });
      B.controle('Aucune erreur JavaScript pendant la coupure (rejets non gérés compris)', A.page.erreurs.length === 0, A.page.erreurs.slice(0, 2).join(' | '));
      void tr; void tManquees;
    });

    // ─────────────── 9. Recette et son ───────────────
    await phase('9. Espace patron (recette du jour) et bouton du son', async () => {
      const e = await etat();
      await allerVue(A, 'patron');
      await attendre(() => A.page.evaluate(`!!document.getElementById('recap-total')`), 3000, 50);
      const jour = e.liste.length ? e.liste[0].service_day : '';
      const acceptees = e.liste.filter((o) => (o.status === 'accepted' || o.status === 'ready') && o.service_day === jour).sort((a, b) => String(a.accepted_at).localeCompare(String(b.accepted_at)));
      const somme = acceptees.reduce((s, o) => s + o.total_cents, 0);
      const rec = await attendre(async () => {
        const x = await A.page.evaluate(`({ lignes: Array.from(document.querySelectorAll('#recap-list .rcard')).map((b) => ({ nom: b.querySelector('.rc-num').textContent, info: b.querySelector('.rc-info').textContent, montant: b.querySelector('.rc-amt').textContent })), total: document.getElementById('recap-total').textContent })`);
        return x.lignes.length === acceptees.length && norm(x.total) === eur(somme) ? x : null;
      }, 6000, 100);
      B.controle(`Recette du jour : ${acceptees.length} commandes acceptées, total ${eur(somme)}`, rec.ok, rec.ok ? '' : 'écart');
      if (rec.ok) {
        const ecarts = rec.valeur.lignes.map((l, i) => {
          const o = acceptees[i];
          const delaiAttenduRecap = o.mode === 'delivery' ? `plus ou moins ${libelleDelai(o.delay_minutes)}` : libelleDelai(o.delay_minutes);
          // Espace avant « Délai » : les deux <span> de .rc-info (commercant.js, fillRecap) sont séparés par un saut de
          // ligne dans le gabarit, donc un espace réel existe dans le DOM entre eux, qu'importe le statut « ready ».
          const attenduInfo = `Acceptée à ${hm(o.accepted_at)}${o.status === 'ready' ? ' · Prête' : ''} Délai ${delaiAttenduRecap}`;
          return norm(l.nom) === o.customer_name && norm(l.info) === attenduInfo && norm(l.montant) === eur(o.total_cents) ? null : `${i}: ${norm(l.nom)} | ${norm(l.info)} | ${norm(l.montant)} (attendu ${o.customer_name} | ${attenduInfo})`;
        }).filter(Boolean);
        B.controle('Recette du jour : chaque ligne (nom, heure d\'acceptation, « Prête », délai, montant) est exacte, par ordre d\'acceptation', ecarts.length === 0, ecarts.slice(0, 2).join(' ; '));
      }
      await allerVue(A, 'orders');

      // Bouton du son.
      const s0 = await lireSonde(A.page);
      await cliquer(A.page, '#sound-btn', { nom: 'Couper le son' });
      await sleep(300);
      const lbl = await A.page.evaluate(`document.getElementById('sound-btn').textContent`);
      B.controle('« Couper le son » devient « Réactiver le son »', norm(lbl) === 'Réactiver le son', norm(lbl));
      const nOsc = (await lireSonde(A.page)).osc.length;
      await sleep(3800);
      const nOsc2 = (await lireSonde(A.page)).osc.length;
      B.controle('Son coupé : plus aucun bip pendant 3,8 s alors que des commandes attendent', nOsc2 === nOsc, `${nOsc2 - nOsc} note(s)`);
      const lv = await lireLive(A.page);
      B.controle('« Son coupé » est annoncé (zone aria-live)', lv.some((x) => x.texte === 'Son coupé'), '');
      // Une nouvelle commande réveille l'alarme (constat).
      const nv = await passer(clients[59], { mode: 'pickup' });
      const ap = await attendre(() => A.page.evaluate(`!!document.querySelector('${selChip(nv.id)}')`), 9000, 60);
      await sleep(500);
      const s3 = await lireSonde(A.page);
      const lbl2 = await A.page.evaluate(`document.getElementById('sound-btn').textContent`);
      B.info(`constat : après « Couper le son », une nouvelle commande ${ap.ok ? 'est apparue' : 'n\'est pas apparue'} ; bips depuis : ${s3.osc.length - nOsc2} ; bouton : « ${norm(lbl2)} »`);
      B.controle('Une nouvelle commande reste annoncée et visible même son coupé', ap.ok && s3.live.some((x) => x.texte === `Nouvelle commande de ${nv.nom}`), '');
      void s0;
    });

    // ─────────────── Bilan de cohérence ───────────────
    await phase('10. Bilan de cohérence : aucune commande perdue, aucune décision non voulue', async () => {
      await mettreAuPremierPlan(A.page);
      await convergence(A, 'Fin de scénario');
      const e = await etat();
      const manquantes = envoyees.filter((o) => !e.parId.has(o.id));
      B.controle(`Les ${envoyees.length} commandes envoyées sont toutes présentes côté serveur`, manquantes.length === 0, `${manquantes.length} manquante(s)`);
      const ecarts = [];
      for (const o of envoyees) {
        const s = e.parId.get(o.id);
        const att = attendu.get(o.id);
        if (!s || !att) continue;
        if (s.status !== att.status || (att.delay !== null && s.delay_minutes !== att.delay)) ecarts.push(`#${o.id} ${att.status}/${att.delay} -> ${s.status}/${s.delay_minutes}`);
      }
      B.controle('Chaque commande a exactement le statut décidé par le test (aucune décision non voulue)', ecarts.length === 0, ecarts.slice(0, 3).join(' ; '));
      const rep = {};
      for (const o of e.liste) rep[o.status] = (rep[o.status] || 0) + 1;
      B.info('répartition finale : ' + JSON.stringify(rep));
      B.controle('Aucune modification collatérale constatée pendant tout le scénario', stats.collateral === 0, `${stats.collateral}`);
      const lv = (await lireSonde(A.page)).live;
      B.controle('Aucune erreur JavaScript dans la page commerçant sur tout le scénario', A.page.erreurs.length === 0, A.page.erreurs.slice(0, 3).join(' | '));
      const sondeFin = await lireSonde(A.page);
      const noms = new Set();
      for (const a of sondeFin.live) { const n = nomsAnnonces(a.texte); if (n) n.forEach((x) => noms.add(x)); }
      B.controle(`Toutes les commandes arrivées pendant que la page était ouverte ont été annoncées (${noms.size} / ${envoyees.length - 3})`, envoyees.slice(3).every((o) => noms.has(o.nom) || o.nom === ''), `${envoyees.slice(3).filter((o) => !noms.has(o.nom)).length} non annoncée(s) (dont celles décidées avant l'arrivée)`);
      B.metrique(`pastilles recouvertes par le message d'action (toast) au moment d'un clic : ${recouvrements.toast} fois (attente cumulée ${recouvrements.attenteMs} ms) ; autres recouvrements : ${recouvrements.autres} ; clics rejoués : ${stats.reclics}`);
      if (stats.latencesUiDecision.length) B.metrique(`clic sur Confirmer -> pastille retirée de « À traiter » : ${fmtStat(statistiques(stats.latencesUiDecision))}`);
      void lv;
      await A.page.fermer();
    });
  }, { pagesMax: 5 });

  // Contrôles directs sur la base une fois le navigateur fermé (aucune requête en vol).
  B.section('Intégrité de la base et journal du serveur');
  const n = Number(site.db.prepare('SELECT COUNT(*) AS n FROM orders').get().n);
  B.controle(`Base : ${envoyees.length} commandes enregistrées`, n === envoyees.length, `${n}`);
  const sansLigne = Number(site.db.prepare('SELECT COUNT(*) AS n FROM orders o WHERE NOT EXISTS (SELECT 1 FROM order_items i WHERE i.order_id = o.id)').get().n);
  B.controle('Base : chaque commande a au moins une ligne', sansLigne === 0, `${sansLigne}`);
  const doublons = site.db.prepare('SELECT customer_id, idempotency_key FROM orders GROUP BY customer_id, idempotency_key HAVING COUNT(*) > 1').all();
  B.controle('Base : aucune commande en double (clé d\'idempotence)', doublons.length === 0, `${doublons.length}`);
  const incoherentes = site.db.prepare("SELECT id FROM orders WHERE (status = 'new' AND (accepted_at IS NOT NULL OR refused_at IS NOT NULL OR prepared_at IS NOT NULL)) OR (status = 'accepted' AND (accepted_at IS NULL OR delay_minutes IS NULL OR prepared_at IS NOT NULL OR refused_at IS NOT NULL)) OR (status = 'ready' AND (accepted_at IS NULL OR prepared_at IS NULL OR refused_at IS NOT NULL)) OR (status = 'refused' AND (refused_at IS NULL OR accepted_at IS NOT NULL OR prepared_at IS NOT NULL))").all();
  B.controle('Base : horodatages cohérents avec le statut de chaque commande', incoherentes.length === 0, incoherentes.map((x) => x.id).slice(0, 5).join(','));
  const journal = site.journal().trim();
  B.controle('Journal du serveur : aucune erreur (pas de 5xx, rien de bloqué)', journal === '', journal.slice(0, 200));
}

let exception = null;
try {
  await principal();
} catch (e) {
  exception = e;
  B.controle('Exécution du script', false, String(e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : e));
} finally {
  try { if (site) site.arreter(); } catch (e) { /* déjà arrêté */ }
}
void exception;
terminer();

// ── parcours de clics d'une tablette en retard (sans les contrôles détaillés) ──
async function parcoursClicsAccepter(ong, o, delai) {
  await selectionner(ong, o);
  await cliquer(ong.page, '#decision [data-action="accept"]', { nom: 'Accepter' });
  await attendre(async () => (await lireDecision(ong)).tuiles.length === 5, 2500, 50);
  await cliquer(ong.page, `#decision [data-action="delay"][data-min="${delai}"]`, { nom: `tuile ${delai}` });
  await attendre(async () => (await lireDecision(ong)).tuiles.find((t) => t.min === delai && t.on) !== undefined, 2500, 50);
  await cliquer(ong.page, '#decision [data-action="accept-confirm"]', { nom: 'Confirmer' });
}

async function parcoursClicsRefuser(ong, o) {
  await selectionner(ong, o);
  await cliquer(ong.page, '#decision [data-action="refuse"]', { nom: 'Refuser' });
  await attendre(async () => (await lireDialogue(ong)).ouvert, 2500, 50);
  await cliquer(ong.page, '#dlg [data-action="dlg-confirm-refuse"]', { nom: 'Oui, refuser' });
}
