// Aides de la batterie 06 (courses critiques et idempotence) : appels bornés par un délai, rafales, statistiques,
// rapport PASS / FAIL, cohérence d'une commande (statut / horodatages), analyse d'une rafale de décisions,
// clients qui raccrochent, suivi de commande. Aucune dépendance au produit en dehors des briques de tests/massif/lib.
import http from 'node:http';
import { performance } from 'node:perf_hooks';
import { PORT, ORIGIN } from './env.mjs';

// ------------------------------------------------------------------ rapport

/** Rapport PASS / FAIL : une ligne par contrôle, avec la valeur observée. */
export function creerRapport() {
  const etat = { pass: 0, fail: 0, echecs: [], debut: Date.now() };
  const ligne = (ok, nom, observe) => {
    const texte = `${ok ? 'PASS' : 'FAIL'} ${nom}${observe === undefined ? '' : ' | observé : ' + observe}`;
    console.log(texte);
    if (ok) etat.pass++;
    else { etat.fail++; etat.echecs.push(texte); }
    return ok;
  };
  return {
    etat,
    /** controle(nom, condition, observé) */
    controle: (nom, condition, observe) => ligne(Boolean(condition), nom, observe),
    /** egal(nom, observé, attendu) : égalité (JSON) ; la valeur observée est toujours affichée. */
    egal(nom, observe, attendu) {
      const ok = Object.is(observe, attendu) || JSON.stringify(observe) === JSON.stringify(attendu);
      return ligne(ok, nom, ok ? JSON.stringify(observe) : `${JSON.stringify(observe)} (attendu ${JSON.stringify(attendu)})`);
    },
    /** info(texte) : mesure ou constat sans verdict. */
    info: (texte) => console.log('INFO ' + texte),
    titre: (texte) => console.log('\n=== ' + texte + ' ==='),
    resume() {
      const duree = Math.round((Date.now() - etat.debut) / 1000);
      console.log(`\nRESUME : ${etat.pass + etat.fail} contrôles, ${etat.pass} PASS, ${etat.fail} FAIL, ${duree} s`);
      for (const e of etat.echecs) console.log('  ' + e);
      return { controles: etat.pass + etat.fail, reussis: etat.pass, echoues: etat.fail, duree_s: duree };
    }
  };
}

// ------------------------------------------------------------------ appels et rafales

/** Délai maximal d'une promesse (la requête sous-jacente n'est pas annulée, mais le script n'attend plus). */
export function avecDelai(promesse, ms, etiquette) {
  let minuteur;
  const garde = new Promise((_, rejeter) => { minuteur = setTimeout(() => rejeter(new Error(`délai de ${ms} ms dépassé (${etiquette})`)), ms); });
  return Promise.race([promesse, garde]).finally(() => clearTimeout(minuteur));
}

/**
 * Appel d'une route par un client du harnais. Ne lève jamais : renvoie { status, json, text, ms, setCookies, erreurReseau }.
 * status 0 = erreur réseau ou délai dépassé (jamais le cas d'une réponse HTTP).
 */
export async function appeler(client, route, { corps, methode = 'POST', delai = 90000 } = {}) {
  const t0 = performance.now();
  try {
    const rep = await avecDelai(methode === 'GET' ? client.get(route) : client.post(route, corps ?? {}), delai, route);
    return { status: rep.status, json: rep.json, text: rep.text, ms: performance.now() - t0, setCookies: rep.setCookies, headers: rep.headers };
  } catch (e) {
    return { status: 0, json: null, text: '', ms: performance.now() - t0, setCookies: [], erreurReseau: causeReseau(e) };
  }
}

/** Message d'une erreur réseau avec sa cause (« fetch failed » seul ne dit rien). */
export function causeReseau(e) {
  const c = e && e.cause;
  return String((e && e.message) || e) + (c ? ` [${c.code || ''} ${c.message || c}]` : '');
}

/** Corps JSON déjà sérialisé (ordre des clés, indentation libres). */
export async function appelerBrut(client, route, raw, { delai = 90000 } = {}) {
  const t0 = performance.now();
  try {
    const rep = await avecDelai(client.request('POST', route, { raw, headers: { 'Content-Type': 'application/json' } }), delai, route);
    return { status: rep.status, json: rep.json, text: rep.text, ms: performance.now() - t0, setCookies: rep.setCookies, headers: rep.headers };
  } catch (e) {
    return { status: 0, json: null, text: '', ms: performance.now() - t0, setCookies: [], erreurReseau: causeReseau(e) };
  }
}

/** Lance toutes les tâches dans le même tour de boucle (rafale réelle) ; renvoie les résultats dans l'ordre et la durée. */
export async function rafale(taches) {
  const t0 = performance.now();
  const resultats = await Promise.all(taches.map((f) => f()));
  return { resultats, ms: performance.now() - t0 };
}

export const repeter = (n, f) => Array.from({ length: n }, (_, i) => () => f(i));

/** « 201 neuf », « 200 rejoué », « 409 idempotency_conflict »… : clé de regroupement d'une réponse. */
export function cleReponse(r) {
  if (r.status === 0) return 'réseau/délai';
  let k = String(r.status);
  if (r.json && r.json.ok === false && r.json.error) k += ' ' + r.json.error;
  if (r.json && r.json.ok === true && r.json.replayed === true) k += ' rejoué';
  if (r.json && r.json.ok === true && r.json.replayed === false) k += ' neuf';
  return k;
}

/** Répartition { clé: nombre } triée par effectif décroissant. */
export function repartition(resultats, cle = cleReponse) {
  const m = new Map();
  for (const r of resultats) m.set(cle(r), (m.get(cle(r)) || 0) + 1);
  return Object.fromEntries([...m.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))));
}

export const texteRepartition = (rep) => Object.entries(rep).map(([k, n]) => `${n}×${k}`).join(', ');

export function percentile(valeurs, p) {
  if (!valeurs.length) return 0;
  const t = [...valeurs].sort((a, b) => a - b);
  return t[Math.min(t.length - 1, Math.max(0, Math.ceil((p / 100) * t.length) - 1))];
}

/** Latences d'une rafale : { p50, p95, max } en ms, arrondies. */
export function latences(resultats) {
  const v = resultats.map((r) => r.ms);
  return { p50: Math.round(percentile(v, 50)), p95: Math.round(percentile(v, 95)), max: Math.round(Math.max(0, ...v)) };
}

export const aucune5xx = (resultats) => resultats.every((r) => r.status > 0 && r.status < 500);
export const compter = (resultats, f) => resultats.filter(f).length;

// ------------------------------------------------------------------ commandes : cohérence

export const RETARDS = [20, 30, 40, 50, 60];
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const nul = (v) => v === null || v === undefined;
const plusMinutes = (iso, minutes) => new Date(Date.parse(iso) + minutes * 60000).toISOString().replace(/\.\d{3}Z$/, 'Z');

/**
 * Cohérence d'une commande (vue API ou ligne de la base) : statut, horodatages, délai.
 * Renvoie la liste des anomalies (vide = cohérente).
 */
export function incoherences(o) {
  const p = [];
  const s = o.status;
  if (!['new', 'accepted', 'ready', 'refused'].includes(s)) return ['statut inconnu : ' + s];
  if (!nul(o.accepted_at) && !nul(o.refused_at)) p.push('accepted_at ET refused_at renseignés');
  if (s === 'new') {
    for (const k of ['accepted_at', 'refused_at', 'prepared_at', 'delay_minutes', 'ready_at']) if (!nul(o[k])) p.push(`new mais ${k} renseigné`);
  } else if (s === 'accepted') {
    if (nul(o.accepted_at)) p.push('accepted sans accepted_at');
    if (!RETARDS.includes(o.delay_minutes)) p.push('accepted avec délai ' + o.delay_minutes);
    for (const k of ['refused_at', 'prepared_at']) if (!nul(o[k])) p.push(`accepted mais ${k} renseigné`);
  } else if (s === 'ready') {
    if (nul(o.accepted_at)) p.push('ready sans accepted_at');
    if (nul(o.prepared_at)) p.push('ready sans prepared_at');
    if (!RETARDS.includes(o.delay_minutes)) p.push('ready avec délai ' + o.delay_minutes);
    if (!nul(o.refused_at)) p.push('ready mais refused_at renseigné');
    if (!nul(o.accepted_at) && !nul(o.prepared_at) && String(o.prepared_at) < String(o.accepted_at)) p.push('prepared_at avant accepted_at');
  } else if (s === 'refused') {
    if (nul(o.refused_at)) p.push('refused sans refused_at');
    for (const k of ['accepted_at', 'prepared_at', 'delay_minutes', 'ready_at']) if (!nul(o[k])) p.push(`refused mais ${k} renseigné`);
  }
  for (const k of ['accepted_at', 'refused_at', 'prepared_at']) if (!nul(o[k]) && !ISO.test(String(o[k]))) p.push(`${k} mal formé : ${o[k]}`);
  // Heure prévue = acceptation + délai (présente dans les vues API seulement).
  if (o.ready_at !== undefined && !nul(o.accepted_at) && RETARDS.includes(o.delay_minutes) && o.ready_at !== plusMinutes(o.accepted_at, o.delay_minutes)) {
    p.push(`ready_at ${o.ready_at} ≠ accepted_at + ${o.delay_minutes} min`);
  }
  return p;
}

/** Une suite de statuts observés par un même suiveur est-elle possible ? (jamais de retour en arrière, refused terminal.) */
export function suiteValide(statuts) {
  let dernier = null;
  for (const s of statuts) {
    if (dernier === null || s === dernier) { dernier = s; continue; }
    if (dernier === 'new' && ['accepted', 'refused', 'ready'].includes(s)) { dernier = s; continue; }
    if (dernier === 'accepted' && s === 'ready') { dernier = s; continue; }
    return false;
  }
  return true;
}

/**
 * Analyse d'une rafale de décisions sur UNE commande.
 *  actions : [{ action, delay_minutes? }] dans l'ordre d'envoi ; reps : réponses de même rang ;
 *  final : ligne de la base après la rafale ; initial : { status: 'new' } ou { status: 'accepted', delay: D }.
 * Renvoie { anomalies, stats, premier } ; anomalies vide = tout est cohérent.
 */
export function analyserDecisions(actions, reps, final, initial = { status: 'new' }) {
  const anomalies = [];
  const st = { neufsDepart: 0, neufsPrete: 0, rejoues: 0, conflits: 0, autres: 0 };
  let premier = null;
  const delaiInitial = initial.status === 'accepted' ? initial.delay : null;
  const accepteeFinale = (d) => ['accepted', 'ready'].includes(final.status) && final.delay_minutes === d;

  reps.forEach((x, i) => {
    const a = actions[i];
    const nom = a.action + (a.delay_minutes ? ' ' + a.delay_minutes : '');
    if (x.status === 200 && x.json && x.json.ok === true) {
      const o = x.json.order;
      for (const m of incoherences(o)) anomalies.push(`${nom} : réponse incohérente (${m})`);
      if (x.json.replayed === false) {
        if (a.action === 'ready') st.neufsPrete++;
        else { st.neufsDepart++; premier = a; }
      } else if (x.json.replayed === true) {
        st.rejoues++;
        if (a.action === 'refuse' && final.status !== 'refused') anomalies.push(`${nom} : rejoué mais l'état final est ${final.status}`);
        if (a.action === 'accept' && !accepteeFinale(a.delay_minutes)) anomalies.push(`${nom} : rejoué mais l'état final est ${final.status}/${final.delay_minutes}`);
        if (a.action === 'ready' && final.status !== 'ready') anomalies.push(`${nom} : rejoué mais l'état final est ${final.status}`);
      } else anomalies.push(`${nom} : champ replayed absent`);
      if (a.action === 'refuse' && o.status !== 'refused') anomalies.push(`${nom} : statut ${o.status} dans la réponse`);
      if (a.action === 'accept' && (!['accepted', 'ready'].includes(o.status) || o.delay_minutes !== a.delay_minutes)) anomalies.push(`${nom} : statut ${o.status}/${o.delay_minutes} dans la réponse`);
      if (a.action === 'ready' && o.status !== 'ready') anomalies.push(`${nom} : statut ${o.status} dans la réponse`);
    } else if (x.status === 409 && x.json && x.json.error === 'already_decided') {
      st.conflits++;
      const s = x.json.status;
      const d = x.json.delay_minutes;
      if (a.action === 'ready') {
        if (!['new', 'refused', 'accepted'].includes(s)) anomalies.push(`${nom} : 409 annonçant le statut ${s}`);
      } else if (a.action === 'refuse') {
        if (!['accepted', 'ready'].includes(s)) anomalies.push(`${nom} : 409 annonçant le statut ${s}`);
        if (final.status === 'refused') anomalies.push(`${nom} : 409 alors que l'état final est refused`);
      } else {
        if (s === 'new') anomalies.push(`${nom} : 409 annonçant le statut new`);
        if (accepteeFinale(a.delay_minutes)) anomalies.push(`${nom} : 409 alors que l'état final est ${final.status}/${final.delay_minutes} (devait être un rejeu)`);
      }
      if ((s === 'new' || s === 'refused') && d !== null) anomalies.push(`${nom} : 409 statut ${s} avec délai ${d}`);
      if (['accepted', 'ready'].includes(s) && d !== final.delay_minutes) anomalies.push(`${nom} : 409 annonçant le délai ${d} (final ${final.delay_minutes})`);
    } else {
      st.autres++;
      anomalies.push(`${nom} : réponse inattendue ${x.status} ${(x.json && x.json.error) || x.erreurReseau || ''}`);
    }
  });

  // Ensemble : un seul résultat gagnant au départ de « new », au plus une transition vers « ready ».
  const attendDepart = initial.status === 'new' && actions.some((a) => a.action !== 'ready') ? 1 : 0;
  if (st.neufsDepart !== attendDepart) anomalies.push(`${st.neufsDepart} transition(s) depuis new (attendu ${attendDepart})`);
  for (const m of incoherences(final)) anomalies.push('état final : ' + m);
  if (premier !== null) {
    if (premier.action === 'refuse') {
      if (final.status !== 'refused') anomalies.push(`gagnant refuse mais état final ${final.status}`);
    } else if (!accepteeFinale(premier.delay_minutes)) {
      anomalies.push(`gagnant accept ${premier.delay_minutes} mais état final ${final.status}/${final.delay_minutes}`);
    }
  }
  if (initial.status === 'accepted' && !accepteeFinale(delaiInitial)) anomalies.push(`commande acceptée à ${delaiInitial} min au départ, état final ${final.status}/${final.delay_minutes}`);
  const attendPrete = final.status === 'ready' ? 1 : 0;
  if (st.neufsPrete !== attendPrete) anomalies.push(`${st.neufsPrete} transition(s) vers ready (attendu ${attendPrete}, état final ${final.status})`);
  return { anomalies, stats: st, premier };
}

// ------------------------------------------------------------------ clients qui raccrochent, suivi, sérialisation

/** Envoie une requête POST complète puis raccroche aussitôt : le serveur reçoit tout, le client ne lira jamais la réponse. */
export function envoyerEtRaccrocher(client, route, corps) {
  return new Promise((resolve) => {
    const data = JSON.stringify(corps);
    const entetes = { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), Origin: ORIGIN, 'x-subito-test-ip': client.ip };
    if (client.cookies.size) entetes.Cookie = client.cookieHeader();
    const req = http.request(`http://127.0.0.1:${PORT}/api/${route}`, { method: 'POST', agent: false, headers: entetes }, () => {});
    const fin = setTimeout(() => { try { req.destroy(); } catch { /* déjà fermé */ } resolve(); }, 8000);
    req.on('error', () => {});
    req.on('finish', () => setImmediate(() => { try { req.destroy(); } catch { /* déjà fermé */ } clearTimeout(fin); resolve(); }));
    req.end(data);
  });
}

/** Suiveur : interroge order_status toutes les `pas` ms jusqu'à ce qu'on l'arrête ; garde les statuts vus et les anomalies. */
export function demarrerSuivi(client, id, pas = 8) {
  const e = { fin: false, statuts: [], anomalies: [], erreurs: 0, n: 0 };
  e.promesse = (async () => {
    while (!e.fin) {
      const x = await appeler(client, `order_status.php?id=${id}`, { methode: 'GET' });
      e.n++;
      if (x.status !== 200 || !x.json || !x.json.order) e.erreurs++;
      else {
        e.statuts.push(x.json.order.status);
        for (const m of incoherences(x.json.order)) e.anomalies.push(m);
      }
      await pause(pas);
    }
  })();
  e.arreter = async () => { e.fin = true; await e.promesse; return e; };
  return e;
}

/** Sérialisation JSON d'un objet avec un ordre de clés mélangé (graine du générateur r) et une indentation libre. */
export function serialiserVariante(r, valeur, indentation) {
  const melanger = (v) => {
    if (Array.isArray(v)) return v.map(melanger);
    if (v !== null && typeof v === 'object') return Object.fromEntries(r.melanger(Object.entries(v)).map(([k, x]) => [k, melanger(x)]));
    return v;
  };
  return JSON.stringify(melanger(valeur), null, indentation);
}

// ------------------------------------------------------------------ divers

export const pause = (ms) => new Promise((r) => setTimeout(r, ms));

/** Copie les cookies d'un client dans un autre (même navigateur, autre onglet). */
export function copierCookies(source, cible) {
  for (const [k, v] of source.cookies) cible.cookies.set(k, v);
  return cible;
}

/** Variante de casse déterministe d'une adresse e-mail (k = numéro de variante), avec espaces parasites pour certaines. */
export function varianteEmail(email, k) {
  const mode = k % 4;
  const m = [...email].map((ch, i) => {
    if (mode === 0) return ch.toLowerCase();
    if (mode === 1) return ch.toUpperCase();
    return (i + k) % 2 === 0 ? ch.toUpperCase() : ch.toLowerCase();
  }).join('');
  const avant = k % 6 === 0 ? ' ' : '';
  const apres = k % 7 === 0 ? '  ' : '';
  return avant + m + apres;
}
