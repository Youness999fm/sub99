// Aides de la batterie 11 : disponibilité des produits en direct.
//  - rapport PASS / FAIL / MESURE ;
//  - lignes de commande ciblées sur le vrai catalogue, prix calés par le catalogue ;
//  - oracle de la règle de disponibilité, écrit d'après le cadrage (reports/2026-11-19-reprise-site-cadrage.md et
//    l'en-tête de assets/js/disponibilite.js), pas recopié du code serveur : une pizza est indisponible si elle figure dans la
//    liste des pizzas, ou si un de ses ingrédients fixes figure dans la liste des ingrédients, ou si toutes ses garnitures au choix le sont ;
//  - copie de lecture du MENU de la tablette (assets/js/commercant.js) pour vérifier qu'elle colle au catalogue serveur ;
//  - chronologie des bascules du patron et verdict « certain » pour un intervalle de requête.
import { performance } from 'node:perf_hooks';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ClientIP } from './clients.mjs';
import { rng, construireCommande, calibrer } from './commandes.mjs';
import { catalogue } from '../../../serveur/catalogue.js';

export const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const attendre = (ms) => new Promise((r) => setTimeout(r, ms));
export const maintenant = () => performance.now();

/* ------------------------------------------------------------------ rapport */
const etat = { pass: 0, fail: 0, echecs: [], mesures: [] };
export const bilan = () => etat;

export function court(v, n = 260) {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s && s.length > n ? s.slice(0, n) + '…' : String(s);
}

/** Un contrôle : une ligne PASS ou FAIL avec la valeur observée. */
export function ctl(nom, cond, observe = '') {
  const ok = Boolean(cond);
  if (ok) etat.pass += 1; else { etat.fail += 1; etat.echecs.push(nom); }
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${nom}${observe === '' || observe === undefined ? '' : '  — ' + court(observe)}`);
  return ok;
}

export function mesure(nom, valeur) {
  const t = `${nom} : ${valeur}`;
  etat.mesures.push(t);
  console.log('MESURE  ' + t);
}

export const titre = (t) => console.log(`\n== ${t} ==`);

/* ------------------------------------------------------------------ dates (heure du serveur d'essai) */
export const epoch = (iso) => Math.floor(Date.parse(iso) / 1000);
const FORMAT_JOUR = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' });
/** Jour civil Europe/Paris (AAAA-MM-JJ) d'une époque en secondes. */
export const jourParis = (epochS) => FORMAT_JOUR.format(new Date(epochS * 1000));

/* ------------------------------------------------------------------ noms : forme de comparaison du cadrage */
/** Casse, accents, apostrophes typographiques et « œ » sans importance, espaces réduits. */
export const norme = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/œ/g, 'oe').replace(/[’‘`´]/g, "'").replace(/\s+/g, ' ').trim();

/** Une pizza est reconnue avec sa parenthèse finale ou sans (« Calzone » pour « Calzone (soufflée) »). */
export function cles(nom) {
  const full = norme(nom);
  const core = norme(String(nom ?? '').replace(/\s*\([^()]*\)\s*$/, ''));
  return core && core !== full ? [full, core] : [full];
}

export const majuscule1 = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** Nom avant la garniture : « Calzone (soufflée) — Thon » -> « Calzone (soufflée) ». */
export const nomBase = (nom) => String(nom).split(/\s*[—–]\s*|\s+-\s+/u)[0].trim();

/* ------------------------------------------------------------------ catalogue : lignes de commande ciblées */
export function ligne(nom, variante = '', o = {}) {
  return calibrer({
    name: nom, variant: variante, qty: o.qty ?? 1, unit_price_cents: 1,
    removed: o.removed ?? [],
    extras: (o.extras ?? []).map((n) => ({ name: n, price_cents: 0, qty: 1 })),
    half: o.half ? { flavor1: o.half[0], flavor2: o.half[1] } : null,
    note: o.note ?? ''
  });
}

const rngCorps = rng(1111);
/** Corps de order_create pour des lignes déjà calées. Livraison : fournir ville (adresse du client) et paiements. */
export function corps(lignes, o = {}) {
  return construireCommande(rngCorps, {
    mode: o.mode || 'pickup', ville: o.ville || 'Hénin-Beaumont', lignes, cle: o.cle, paiements: o.paiements, billet: o.billet
  }).body;
}

export async function envoyer(client, lignes, o = {}) {
  const body = o.corps || corps(lignes, o);
  const a = maintenant();
  const rep = await client.post('order_create.php', body);
  const b = maintenant();
  return { rep, body, a, b, status: rep.status, json: rep.json };
}

export const estRefusDispo = (r) => r.status === 422 && r.json && r.json.error === 'unavailable_items';
export const trier = (l) => (Array.isArray(l) ? [...l].map(String).sort() : null);
export const memeListe = (a, b) => JSON.stringify(trier(a)) === JSON.stringify(trier(b));

/** Résumé court d'une réponse de commande (résultat de envoyer(), ou réponse brute du client HTTP) pour l'affichage. */
export function resume(r) {
  const j = r.json || {};
  if (r.status === 422 && j.error === 'unavailable_items') return `422 unavailable_items noms=${JSON.stringify(j.unavailable)} ingredients=${JSON.stringify(j.unavailable_ingredients)}`;
  if (r.status === 201 || r.status === 200) return `${r.status} commande ${j.order && j.order.id}${j.replayed ? ' (rejeu)' : ''}`;
  return `${r.status} ${j.error || ''} ${j.message || (r.rep || r).text || ''}`.trim();
}

/** Toutes les lignes commandables du catalogue, une par garniture pour la calzone et pour la base à composer. */
export function lignesCatalogue() {
  const sortie = [];
  for (const p of catalogue().products) {
    if (!p.orderable) continue;
    const fixes = (p.availability.fixed || []).map(norme);
    const choix = (p.availability.choice || []).map(String);
    if (p.kind === 'pizza' && p.choice && p.choice.required) {
      for (const g of choix) {
        const nom = `${p.line_name} — ${majuscule1(g)}`;
        sortie.push({ produit: p, kind: 'pizza', nom, variante: 'Solo', fixes: new Set([...fixes, norme(g)]), choixTous: null, filler: norme(g), fabrique: () => ligne(nom, 'Solo') });
      }
    } else if (p.kind === 'pizza' && choix.length) {
      // Base à choisir, facultative (Marguerita) : sans choix, bloquée seulement si toutes les bases manquent.
      sortie.push({ produit: p, kind: 'pizza', nom: p.line_name, variante: 'Solo', fixes: new Set(fixes), choixTous: choix.map(norme), filler: null, fabrique: () => ligne(p.line_name, 'Solo') });
      for (const g of choix) {
        const nom = `${p.line_name} — ${majuscule1(g)}`;
        sortie.push({ produit: p, kind: 'pizza', nom, variante: 'Solo', fixes: new Set([...fixes, norme(g)]), choixTous: null, filler: norme(g), fabrique: () => ligne(nom, 'Solo') });
      }
    } else if (p.kind === 'pizza') {
      sortie.push({ produit: p, kind: 'pizza', nom: p.line_name, variante: 'Solo', fixes: new Set(fixes), choixTous: null, filler: null, fabrique: () => ligne(p.line_name, 'Solo') });
    } else if (p.choice && p.choice.required) {
      // Choix obligatoire sur un produit (base des subitowichs, décision du 22/11/2026) : même principe
      // que la garniture de la calzone ci-dessus, une ligne par option — jamais le nom nu seul.
      for (const g of choix) {
        const nom = `${p.line_name} — ${majuscule1(g)}`;
        sortie.push({ produit: p, kind: 'product', nom, variante: '', fixes: new Set([...fixes, norme(g)]), choixTous: null, filler: norme(g), fabrique: () => ligne(nom, '') });
      }
    } else {
      sortie.push({ produit: p, kind: 'product', nom: p.line_name, variante: '', fixes: new Set(fixes), choixTous: null, filler: null, fabrique: () => ligne(p.line_name, '') });
    }
  }
  return sortie;
}

/**
 * Règle du cadrage appliquée à une ligne du catalogue. out = { pizzas: [noms], produits: [noms], ingredients: [noms] }.
 * Renvoie les causes (liste vide = commandable) : 'pizza', 'produit', 'ingredient:<nom>', 'choix'.
 */
export function causes(l, out) {
  const c = [];
  const ing = new Set((out.ingredients || []).map(norme));
  if (l.kind === 'pizza') {
    const kl = cles(l.produit.name);
    if ((out.pizzas || []).some((n) => cles(n).some((k) => kl.includes(k)))) c.push('pizza');
  } else {
    const kp = [...cles(l.produit.name), ...cles(l.produit.line_name)];
    if ((out.produits || []).some((n) => cles(n).some((k) => kp.includes(k)))) c.push('produit');
  }
  for (const f of l.fixes) if (ing.has(f)) c.push(l.filler === f ? 'garniture:' + f : 'ingredient:' + f);
  if (l.choixTous && l.choixTous.length && l.choixTous.every((o) => ing.has(o))) c.push('choix');
  return c;
}

/** Nom attendu dans « unavailable » : la ligne entière si la garniture choisie manque, sinon le nom sans garniture. */
export function nomAttendu(l, cs) {
  return cs.some((x) => x.startsWith('garniture:')) ? l.nom : nomBase(l.nom);
}

let indexNoms = null;
/**
 * Relecture d'une ligne ENREGISTRÉE (nom du catalogue, moitié, suppléments) : causes qui l'auraient bloquée si l'état `out`
 * avait été en vigueur. Liste vide = ligne légitime. Sert à auditer la base après une rafale.
 */
export function ligneStockeeCauses(row, out) {
  if (indexNoms === null) indexNoms = new Map(lignesCatalogue().map((l) => [l.nom, l]));
  const l = indexNoms.get(row.name);
  if (!l) return ['ligne inconnue du catalogue : ' + row.name];
  const cs = [...causes(l, out)];
  if (row.half_json) {
    const h = JSON.parse(row.half_json);
    const p2 = catalogue().products.find((p) => p.kind === 'pizza' && p.name === h.flavor2);
    if (!p2) cs.push('2e moitié inconnue : ' + h.flavor2);
    else cs.push(...causes({ kind: 'pizza', produit: p2, fixes: new Set((p2.availability.fixed || []).map(norme)), choixTous: null, filler: null }, out).map((c) => '2e moitié ' + c));
  }
  const ing = new Set((out.ingredients || []).map(norme));
  for (const ex of JSON.parse(row.extras_json || '[]')) {
    const nom = String(ex.name).replace(/\*$/, '').trim();
    const g = catalogue().supplement_groups.find((x) => x.names.some((n) => norme(n) === norme(nom)));
    const cle = g ? g.names.find((n) => norme(n) === norme(nom)) : nom;
    const alias = g && g.availability_keys && g.availability_keys[cle] ? g.availability_keys[cle] : [nom];
    if (alias.some((k) => ing.has(norme(k)))) cs.push('supplément ' + nom);
  }
  return cs;
}

/* ------------------------------------------------------------------ MENU de la tablette (copie de lecture) */
export function menuTablette() {
  const src = readFileSync(path.join(RACINE, 'assets', 'js', 'commercant.js'), 'utf8');
  const i = src.indexOf('const MENU = [');
  if (i < 0) throw new Error('MENU introuvable dans commercant.js');
  const j = src.indexOf('\n  ];', i);
  // eslint-disable-next-line no-new-func
  return new Function('return ' + src.slice(i + 'const MENU = '.length, j + 4))();
}

/** Produits de la tablette, comme PRODUCTS de commercant.js. */
export function produitsTablette(menu = menuTablette()) {
  const sortie = [];
  menu.forEach((cat) => cat.items.forEach((it, i) => sortie.push({
    id: cat.key + '-' + i, cat: cat.key, kind: cat.key === 'pizzas' ? 'pizza' : 'product', name: it.name, ing: it.ing
  })));
  return sortie;
}

/** Ingrédients proposés par la tablette (clés en minuscules, « a|b » éclaté), comme INGREDIENTS de commercant.js. */
export function ingredientsTablette(produits) {
  const keys = new Set();
  produits.forEach((p) => p.ing.forEach((g) => g.split('|').forEach((m) => keys.add(m))));
  return [...keys].sort((a, b) => a.localeCompare(b, 'fr'));
}

/* ------------------------------------------------------------------ patron et public */
export async function bascule(patron, kind, name, status) {
  return patron.post('owner_availability.php', { kind, name, status });
}

/** Bascule et exige un 200 : sinon exception (préparation d'un scénario). */
export async function pose(patron, kind, name, status) {
  const r = await bascule(patron, kind, name, status);
  if (r.status !== 200) throw new Error(`Préparation impossible : ${kind} « ${name} » -> ${status} : ${r.status} ${r.text}`);
  return r;
}

let anonymeCompteur = 0;
export function anonyme() {
  anonymeCompteur += 1;
  return new ClientIP('public-' + anonymeCompteur, `10.200.${(anonymeCompteur >> 8) & 255}.${anonymeCompteur & 255}`);
}

export async function lirePublic(client = anonyme()) {
  const r = await client.get('availability.php');
  return r;
}

/** Remet tout à zéro (accès base direct, jamais pendant une rafale). */
export function toutRemettre(site) {
  site.db.exec('DELETE FROM availability');
  site.db.exec('DELETE FROM throttle');
}

/* ------------------------------------------------------------------ chronologie des bascules */
/**
 * Pour chaque entrée (clé « kind|nom »), liste ordonnée des bascules du patron : { a, b, etat } où a = instant avant l'envoi,
 * b = instant après la réponse, etat = 'hors' | 'dispo'. Une seule suite de bascules par entrée (donc jamais de chevauchement).
 */
export class Chronologie {
  constructor() { this.liste = new Map(); }

  initial(cle, etat = 'dispo') { this.liste.set(cle, [{ a: -Infinity, b: -Infinity, etat }]); }

  note(cle, a, b, etat) { this.liste.get(cle).push({ a, b, etat }); }

  /** État CERTAIN de l'entrée pendant tout l'intervalle [a, b] : 'hors', 'dispo', ou 'incertain'. */
  certitude(cle, a, b) {
    const l = this.liste.get(cle);
    if (!l) return 'dispo';
    let idx = 0;
    for (let i = 0; i < l.length; i++) { if (l[i].b <= a) idx = i; else break; }
    const suivant = l[idx + 1];
    if (suivant && suivant.a <= b) return 'incertain';
    return l[idx].etat;
  }
}

/**
 * Bascule en continu des entrées avec un patron : alterne hors / disponible, pause aléatoire bornée entre deux bascules.
 * entrees : [{ kind, name, hors: 'out_manual' | 'out_today', pauseMin, pauseMax }]. Renvoie { arreter() -> stats }.
 */
export function demarrerBascules(patron, entrees, chrono, graine = 5) {
  const r = rng(graine);
  const stats = { bascules: 0, erreurs: [], incoherences: [], latenceMax: 0 };
  let fin = false;
  const courant = new Map();
  for (const e of entrees) { chrono.initial(`${e.kind}|${e.name}`); courant.set(`${e.kind}|${e.name}`, 'dispo'); }
  const boucle = (async () => {
    while (!fin) {
      for (const e of entrees) {
        if (fin) break;
        const cle = `${e.kind}|${e.name}`;
        const etatVoulu = courant.get(cle) === 'dispo' ? 'hors' : 'dispo';
        const statut = etatVoulu === 'hors' ? e.hors : 'available';
        const a = maintenant();
        let rep;
        try { rep = await patron.post('owner_availability.php', { kind: e.kind, name: e.name, status: statut }); } catch (err) { stats.erreurs.push(String(err)); continue; }
        const b = maintenant();
        stats.latenceMax = Math.max(stats.latenceMax, b - a);
        if (rep.status !== 200) { stats.erreurs.push(`${cle} -> ${statut} : ${rep.status} ${rep.text.slice(0, 120)}`); continue; }
        courant.set(cle, etatVoulu);
        chrono.note(cle, a, b, etatVoulu);
        stats.bascules += 1;
        // La réponse décrit l'état APRÈS l'écriture : l'entrée y figure si et seulement si elle vient d'être mise hors service.
        const present = (rep.json.out || []).some((x) => x.kind === e.kind && x.name === e.name);
        if (present !== (etatVoulu === 'hors')) stats.incoherences.push(`${cle} -> ${statut} : présent=${present}`);
        await attendre(e.pauseMin + Math.floor(r() * (e.pauseMax - e.pauseMin + 1)));
      }
    }
  })();
  return { arreter: async () => { fin = true; await boucle; return stats; }, stats };
}

/* ------------------------------------------------------------------ résilience du poste d'essai */
/**
 * Quand la machine est saturée en ports éphémères (beaucoup de scripts de test en parallèle : sockets en TIME_WAIT), un connect()
 * local échoue avec EADDRINUSE avant que la moindre requête soit partie. On réessaie ces seuls échecs de connexion (aucune
 * requête n'a été envoyée : rejeu sans risque), avec une attente croissante. Renvoie une fonction qui donne le nombre de réessais.
 */
export function fetchResilient() {
  const original = globalThis.fetch;
  const etat = { reessais: 0 };
  globalThis.fetch = async function fetchResilientInterne(...args) {
    for (let i = 0; ; i++) {
      try {
        return await original.apply(this, args);
      } catch (e) {
        const code = e && e.cause && e.cause.code;
        if (i < 80 && (code === 'EADDRINUSE' || code === 'EADDRNOTAVAIL' || code === 'ENOBUFS')) {
          etat.reessais += 1;
          await attendre(150 + Math.min(i, 20) * 120);
          continue;
        }
        throw e;
      }
    }
  };
  return () => etat.reessais;
}

/* ------------------------------------------------------------------ rapport final */
export function pourcent(n, d) { return d === 0 ? '0 %' : Math.round((100 * n) / d) + ' %'; }
export function percentile(valeurs, p) {
  if (!valeurs.length) return 0;
  const t = [...valeurs].sort((x, y) => x - y);
  return t[Math.min(t.length - 1, Math.floor((p / 100) * t.length))];
}
