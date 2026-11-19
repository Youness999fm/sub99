// Aides de la batterie 08 (force brute et limites de débit) :
//  - comptage des contrôles (une ligne PASS / FAIL chacun), mesures et informations ;
//  - adresses IPv4 fictives jamais réutilisées ;
//  - statistiques (médiane, percentiles) ;
//  - espion de bcrypt : compte les vérifications et les hachages RÉELLEMENT exécutés par le serveur (même module en mémoire) ;
//  - rafales bornées par un délai maximal.
import { performance } from 'node:perf_hooks';
import bcrypt from 'bcryptjs';
import { ClientIP, ipFictive, VILLES, corpsInscription, enParallele } from './clients.mjs';

export const DEBUT = Date.now();
export const bilan = { total: 0, reussis: 0, echoues: 0, echecs: [] };

/** Une ligne par contrôle : PASS ou FAIL, avec la valeur observée. */
export function controle(nom, condition, observe = '') {
  bilan.total++;
  const ligne = observe === '' ? nom : `${nom} · ${observe}`;
  if (condition) {
    bilan.reussis++;
    console.log('PASS ' + ligne);
  } else {
    bilan.echoues++;
    bilan.echecs.push(nom);
    console.log('FAIL ' + ligne);
  }
  return Boolean(condition);
}

export const info = (texte) => console.log('INFO ' + texte);
export const mesure = (texte) => console.log('MESURE ' + texte);
export const titre = (texte) => console.log('\n== ' + texte + ' ==');
export const secondesEcoulees = () => Math.round((Date.now() - DEBUT) / 1000);

export function resume() {
  console.log(`\nRESUME : ${bilan.total} contrôles, ${bilan.reussis} réussis, ${bilan.echoues} échoués, durée ${secondesEcoulees()} s`);
  if (bilan.echecs.length) {
    console.log('Contrôles échoués :');
    for (const e of bilan.echecs) console.log('  - ' + e);
  }
}

/** Promesse bornée : rejette si elle dépasse `ms`. */
export function avecDelai(promesse, ms, nom = 'opération') {
  let minuteur;
  const limite = new Promise((_, rejet) => { minuteur = setTimeout(() => rejet(new Error(`délai de ${ms} ms dépassé : ${nom}`)), ms); });
  return Promise.race([promesse, limite]).finally(() => clearTimeout(minuteur));
}

let compteurIp = 0;
/** Adresse IPv4 fictive (172.16.0.0/12) jamais renvoyée deux fois dans ce script : un seau de limitation neuf à chaque appel. */
export function ipNeuve() {
  let n = ++compteurIp;
  if ((n & 255) === 0) n = ++compteurIp;
  return `172.${16 + ((n >> 16) & 15)}.${(n >> 8) & 255}.${n & 255}`;
}
export const nombreAdressesDistribuees = () => compteurIp;

export function percentile(valeurs, p) {
  const t = [...valeurs].sort((a, b) => a - b);
  if (t.length === 0) return NaN;
  const i = ((t.length - 1) * p) / 100;
  const bas = Math.floor(i);
  const haut = Math.ceil(i);
  return t[bas] + (t[haut] - t[bas]) * (i - bas);
}
export const mediane = (v) => percentile(v, 50);
export const moyenne = (v) => v.reduce((a, b) => a + b, 0) / (v.length || 1);
export const fmt = (x) => (Number.isFinite(x) ? x.toFixed(1) + ' ms' : 'n/a');

/** Compte les statuts HTTP : { 401: 95, 429: 5 }. */
export function compter(reponses) {
  const m = {};
  for (const r of reponses) m[r.status] = (m[r.status] || 0) + 1;
  return m;
}
export const texteStatuts = (m) => Object.entries(m).sort(([a], [b]) => Number(a) - Number(b)).map(([k, v]) => `${k}×${v}`).join(' ');
export const nbCinqCent = (reponses) => reponses.filter((r) => r.status >= 500).length;

export const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Erreurs de connexion survenues AVANT l'envoi de la requête (aucun octet n'a atteint le serveur : la rejouer ne compte pas deux
 * fois). Sous Windows, quand beaucoup de scripts tournent en même temps sur la machine, les ports éphémères (16 384, gardés
 * 2 minutes en TIME_WAIT) s'épuisent et connect() échoue avec EADDRINUSE : c'est un défaut de la machine, pas du produit.
 */
const ECHECS_AVANT_ENVOI = new Set(['EADDRINUSE', 'EADDRNOTAVAIL', 'ENOBUFS', 'UND_ERR_CONNECT_TIMEOUT']);
export const transport = { reessais: 0 };

/** Client de test dont chaque requête est bornée dans le temps (120 s) et rejouée si la connexion n'a pas pu s'établir. */
export class Client08 extends ClientIP {
  async request(method, route, opts = {}) {
    const limite = Date.now() + 120000;
    for (;;) {
      try {
        return await avecDelai(super.request(method, route, opts), Math.max(1000, limite - Date.now()), `${method} ${route}`);
      } catch (e) {
        const code = e && e.cause && e.cause.code;
        if (!ECHECS_AVANT_ENVOI.has(code) || Date.now() > limite) throw e;
        transport.reessais++;
        await attendre(50 + Math.floor(Math.random() * 250));
      }
    }
  }
}

/** Comme creerClients() de lib/clients.mjs, mais avec des clients Client08 (délai borné, reprise sur échec de connexion). */
export async function creerComptes(n, { debut = 1, concurrence = 5, prefixe = 'massif', ville = true } = {}) {
  const numeros = Array.from({ length: n }, (_, k) => debut + k);
  return enParallele(numeros, concurrence, async (num) => {
    const client = new Client08('client-' + num, ipFictive(num));
    const villeClient = ville ? VILLES[num % VILLES.length] : null;
    const corps = corpsInscription(num, { ville: villeClient, prefixe });
    const r = await client.post('customer_signup.php', corps);
    if (r.status !== 201) throw new Error(`Inscription du client ${num} refusée : ${r.status} ${r.text}`);
    Object.assign(client, { num, email: corps.email, password: corps.password, customer: r.json.customer, ville: villeClient });
    return client;
  });
}

/** Un POST depuis une adresse donnée (nouvelle boîte à cookies) ; r.ms = durée mesurée côté client, r.client = le client utilisé. */
export async function appel(route, corps, ip, opts = {}) {
  const client = new Client08('essai', ip);
  const debut = performance.now();
  const r = await client.post(route, corps, opts);
  r.ms = performance.now() - debut;
  r.client = client;
  r.ip = ip;
  return r;
}

/** Même chose en GET. */
export async function lire(route, ip, opts = {}) {
  const client = new Client08('lecture', ip);
  const debut = performance.now();
  const r = await client.get(route, opts);
  r.ms = performance.now() - debut;
  r.client = client;
  return r;
}

/** n appels simultanés (tous lancés avant d'en attendre un seul). */
export async function rafale(n, fabrique, { delaiMs = 150000, nom = 'rafale' } = {}) {
  const debut = performance.now();
  const rs = await avecDelai(Promise.all(Array.from({ length: n }, (_, i) => fabrique(i))), delaiMs, nom);
  return { rs, duree: performance.now() - debut, statuts: compter(rs) };
}

/**
 * Espion de bcrypt : le serveur importe le même module « bcryptjs » que ce script (même fichier, même instance),
 * donc remplacer compare / hash sur l'objet par défaut compte les opérations réellement exécutées par les routes.
 */
export function espionBcrypt() {
  const compare = bcrypt.compare;
  const hash = bcrypt.hash;
  const etat = { compare: 0, hash: 0 };
  bcrypt.compare = function espionCompare(...a) { etat.compare++; return compare.apply(bcrypt, a); };
  bcrypt.hash = function espionHash(...a) { etat.hash++; return hash.apply(bcrypt, a); };
  etat.raz = () => { etat.compare = 0; etat.hash = 0; };
  etat.retirer = () => { bcrypt.compare = compare; bcrypt.hash = hash; };
  return etat;
}

/**
 * Réponse 429 attendue : code, retry_after_seconds, en-tête Retry-After identique, délai exact (horloge figée),
 * et, pour une requête SANS session, aucun cookie posé (une requête authentifiée peut renouveler son cookie existant :
 * passer { cookies: false }).
 */
export function verifier429(libelle, r, secondes = null, { cookies = true } = {}) {
  const j = r.json || {};
  controle(`${libelle} : 429 « too_many_attempts »`, r.status === 429 && j.error === 'too_many_attempts' && j.ok === false, `statut ${r.status}, code ${j.error}`);
  const entete = r.headers.get('retry-after');
  const coherent = Number.isInteger(j.retry_after_seconds) && j.retry_after_seconds > 0 && entete === String(j.retry_after_seconds);
  controle(`${libelle} : Retry-After = retry_after_seconds`, coherent, `en-tête « ${entete} », corps ${j.retry_after_seconds}`);
  if (secondes !== null) {
    controle(`${libelle} : délai annoncé = ${secondes} s`, j.retry_after_seconds === secondes, `observé ${j.retry_after_seconds}`);
  }
  if (cookies) controle(`${libelle} : aucun cookie de session posé`, r.setCookies.length === 0, `${r.setCookies.length} cookie(s)`);
}
