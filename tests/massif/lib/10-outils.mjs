// Batterie 10 : rapport PASS / FAIL, appels bornés, banc d'essai (clients, horloge du SERVEUR, comptage en base),
// comparaison d'une commande acceptée avec l'oracle et audit complet de la base.
// Aucune dépendance au code du produit : seulement les briques de tests/massif/lib et l'oracle de la batterie.
import { performance } from 'node:perf_hooks';
import { isDeepStrictEqual } from 'node:util';
import { calculerCommande, ZONES } from './10-oracle.mjs';

// ------------------------------------------------------------------ rapport

/**
 * Une ligne par contrôle, qui COMMENCE par PASS ou FAIL (le regroupeur tests/massif/tout.mjs les compte).
 * Les lignes de détail commencent par autre chose.
 */
export function creerRapport() {
  const etat = { pass: 0, fail: 0, echecs: [], debut: Date.now() };
  const ligne = (ok, nom, observe) => {
    console.log(`${ok ? 'PASS' : 'FAIL'} ${nom}${observe === undefined || observe === '' ? '' : ' | ' + observe}`);
    if (ok) etat.pass++;
    else { etat.fail++; etat.echecs.push(nom); }
    return ok;
  };
  return {
    etat,
    controle: (nom, condition, observe) => ligne(Boolean(condition), nom, observe),
    detail: (texte) => console.log('     > ' + String(texte).replace(/\s+/g, ' ').slice(0, 1200)),
    info: (texte) => console.log('INFO ' + texte),
    titre: (texte) => console.log('\n=== ' + texte + ' ==='),
    resume() {
      const duree = Math.round((Date.now() - etat.debut) / 1000);
      console.log(`\nRESUME : ${etat.pass + etat.fail} contrôles, ${etat.pass} réussis, ${etat.fail} échoués, ${duree} s`);
      for (const e of etat.echecs) console.log('ECHEC> ' + e);
      return { controles: etat.pass + etat.fail, reussis: etat.pass, echoues: etat.fail, duree_s: duree };
    }
  };
}

/** Délai maximal d'une promesse (la requête sous-jacente n'est pas annulée, mais le script n'attend plus). */
export function avecDelai(promesse, ms, etiquette) {
  let minuteur;
  const garde = new Promise((_, rejeter) => { minuteur = setTimeout(() => rejeter(new Error(`délai de ${ms} ms dépassé (${etiquette})`)), ms); });
  return Promise.race([promesse, garde]).finally(() => clearTimeout(minuteur));
}

export function percentile(valeurs, p) {
  if (!valeurs.length) return 0;
  const t = [...valeurs].sort((a, b) => a - b);
  return t[Math.min(t.length - 1, Math.max(0, Math.ceil((p / 100) * t.length) - 1))];
}

// ------------------------------------------------------------------ banc d'essai

/**
 * Banc d'essai : clients du harnais, horloge du serveur (fichier), compteur de tentatives par client.
 * La création de commande est limitée à 20 envois / 10 min par client : le banc avance l'horloge du SERVEUR de 601 s
 * dès qu'un client a atteint `plafond` envois (le plafond est bien en dessous de 20), ce qui rouvre toutes les fenêtres.
 * Seule l'heure du serveur change ; le test ne dépend jamais de l'heure réelle.
 */
export function creerBanc({ site, clients, epoch0, plafond = 12 }) {
  let epoch = epoch0;
  const stats = { requetes: 0, latences: [], parCode: new Map(), renouvellements: 0, tentatives: 0 };
  const acceptes = new Map(); // id de commande -> { client, corps }
  const parVille = new Map();
  for (const c of clients) {
    if (!parVille.has(c.ville)) parVille.set(c.ville, []);
    parVille.get(c.ville).push(c);
    c.essais = 0;
  }
  const curseurs = new Map();
  let curseurGlobal = 0;

  const banc = {
    stats, acceptes, clients,
    /** Avance l'horloge du serveur : toutes les fenêtres de limitation de débit sont rouvertes. */
    renouveler() {
      epoch += 601;
      site.fixerHeure(epoch);
      for (const c of clients) c.essais = 0;
      stats.renouvellements++;
    },
    horloge: () => epoch,
    /** Client suivant (tourniquet sur tous les clients). */
    suivant() { return clients[curseurGlobal++ % clients.length]; },
    /** Client suivant habitant dans cette ville (tourniquet). */
    clientDe(ville) {
      const liste = parVille.get(ville);
      if (!liste || !liste.length) throw new Error('aucun client à ' + ville);
      const k = curseurs.get(ville) ?? 0;
      curseurs.set(ville, k + 1);
      return liste[k % liste.length];
    },
    nbCommandes: () => Number(site.db.prepare('SELECT COUNT(*) AS n FROM orders').get().n),
    nbLignes: () => Number(site.db.prepare('SELECT COUNT(*) AS n FROM order_items').get().n),
    /**
     * Envoie un corps à order_create. Ne lève jamais : status 0 = erreur réseau ou délai dépassé.
     * options : brut (texte JSON envoyé tel quel), route, methode, entetes.
     */
    async commander(client, corps, { brut = null, route = 'order_create.php', methode = 'POST', entetes = {} } = {}) {
      if (route === 'order_create.php') {
        if ((client.essais ?? 0) >= plafond) banc.renouveler();
        client.essais = (client.essais ?? 0) + 1;
        stats.tentatives++;
      }
      const t0 = performance.now();
      let rep;
      try {
        const opts = brut !== null
          ? { raw: brut, headers: { 'Content-Type': 'application/json', ...entetes } }
          : { body: corps, headers: entetes };
        rep = await avecDelai(methode === 'GET' ? client.get(route, { headers: entetes }) : client.request(methode, route, opts), 60000, route);
      } catch (e) {
        return { status: 0, json: null, text: '', ms: performance.now() - t0, erreurReseau: String((e && e.message) || e) };
      }
      const ms = performance.now() - t0;
      stats.requetes++;
      stats.latences.push(ms);
      const cle = `${rep.status} ${rep.json && rep.json.ok === false ? rep.json.error : rep.json && rep.json.ok ? (rep.json.replayed ? 'rejoué' : 'ok') : '?'}`;
      stats.parCode.set(cle, (stats.parCode.get(cle) ?? 0) + 1);
      if (rep.status === 201 && rep.json && rep.json.order && Number.isInteger(rep.json.order.id)) {
        acceptes.set(rep.json.order.id, { client, corps });
      }
      return { status: rep.status, json: rep.json, text: rep.text, ms, headers: rep.headers };
    }
  };
  return banc;
}

// ------------------------------------------------------------------ évaluation d'une réponse

/** Compare une réponse à une attente { statut, code?, champs?, extra? } ; renvoie la liste des écarts. */
export function evaluer(rep, att) {
  const e = [];
  if (rep.status !== att.statut) e.push(`statut ${rep.status} au lieu de ${att.statut}${rep.erreurReseau ? ' (' + rep.erreurReseau + ')' : ''}`);
  const j = rep.json;
  if (att.statut >= 400) {
    if (!j || j.ok !== false) e.push('ok !== false');
    if (att.code && (!j || j.error !== att.code)) e.push(`code ${j && j.error} au lieu de ${att.code}`);
    for (const ch of att.champs ?? []) if (!j || !j.fields || !(ch in j.fields)) e.push(`champ ${ch} absent de fields (${j && j.fields ? Object.keys(j.fields).join(',') : '-'})`);
    for (const [k, v] of Object.entries(att.extra ?? {})) {
      if (!isDeepStrictEqual(j && j[k], v)) e.push(`${k} = ${JSON.stringify(j && j[k])} au lieu de ${JSON.stringify(v)}`);
    }
  }
  return e;
}

/** « 422 price_mismatch_line (index 0, attendu 1100, envoyé 1099) » : valeur observée, courte. */
export function observe(rep) {
  const j = rep.json;
  if (rep.status === 0) return 'aucune réponse (' + rep.erreurReseau + ')';
  if (!j) return `${rep.status} (corps non JSON)`;
  if (j.ok === false) {
    let s = `${rep.status} ${j.error}`;
    if (j.fields) s += ' {' + Object.keys(j.fields).join(', ') + '}';
    if (j.error === 'price_mismatch_line') s += ` (ligne ${j.index}, attendu ${j.expected_unit_cents}, envoyé ${j.sent_unit_cents})`;
    if (j.error === 'price_mismatch') s += ` (serveur : total ${j.server_total_cents}, promo ${j.server_promo_cents}, frais ${j.server_delivery_fee_cents})`;
    if (j.error === 'minimum_not_reached') s += ` (minimum ${j.minimum_cents}, produits ${j.products_after_promo_cents})`;
    if ((j.error === 'unknown_item' || j.error === 'unpriced_item') && j.name !== undefined) s += ` (« ${String(j.name).slice(0, 40)} »)`;
    return s;
  }
  if (j.order) return `${rep.status} ${j.replayed ? 'rejoué' : 'créée'} #${j.order.id} total ${j.order.total_cents}`;
  return `${rep.status} ok`;
}

// ------------------------------------------------------------------ commande acceptée vs oracle

/** Écarts entre la commande renvoyée par le serveur et le calcul de l'oracle (liste vide = identique). */
export function comparerCommande(order, corps, calcul, ville) {
  const e = [];
  const t = calcul.t;
  if (!order) return ['pas de commande dans la réponse'];
  if (order.status !== 'new') e.push(`statut ${order.status} au lieu de new`);
  if (order.mode !== corps.mode) e.push(`mode ${order.mode}`);
  for (const [k, v] of [['products_cents', t.produits], ['promo_cents', t.promo], ['delivery_fee_cents', t.frais], ['total_cents', t.total]]) {
    if (order[k] !== v) e.push(`${k} ${order[k]} au lieu de ${v}`);
  }
  if (!Array.isArray(order.items) || order.items.length !== calcul.lignes.length) {
    e.push(`lignes ${order.items && order.items.length} au lieu de ${calcul.lignes.length}`);
  } else {
    order.items.forEach((it, i) => {
      const c = calcul.lignes[i];
      const l = corps.items[i];
      if (it.name !== c.nom) e.push(`ligne ${i} nom « ${it.name} » au lieu de « ${c.nom} »`);
      if (it.variant !== l.variant) e.push(`ligne ${i} taille ${it.variant}`);
      if (it.qty !== l.qty) e.push(`ligne ${i} quantité ${it.qty}`);
      if (it.unit_price_cents !== c.unit) e.push(`ligne ${i} prix ${it.unit_price_cents} au lieu de ${c.unit}`);
      if (it.line_total_cents !== c.unit * l.qty) e.push(`ligne ${i} total de ligne ${it.line_total_cents} au lieu de ${c.unit * l.qty}`);
      if (!isDeepStrictEqual(it.half, c.demi)) e.push(`ligne ${i} moitié ${JSON.stringify(it.half)}`);
      if (!isDeepStrictEqual(it.removed, l.removed)) e.push(`ligne ${i} retraits ${JSON.stringify(it.removed)}`);
      const extras = l.extras.map((x, k) => ({ name: x.name, price_cents: c.extras[k], qty: 1 }));
      if (!isDeepStrictEqual(it.extras, extras)) e.push(`ligne ${i} suppléments ${JSON.stringify(it.extras)}`);
      if (it.note !== l.note) e.push(`ligne ${i} remarque`);
    });
  }
  const moyens = corps.mode === 'delivery' ? [...new Set(corps.payment_methods)] : [];
  if (!isDeepStrictEqual(order.payment_methods, moyens)) e.push(`moyens ${JSON.stringify(order.payment_methods)} au lieu de ${JSON.stringify(moyens)}`);
  const billet = corps.mode === 'delivery' && moyens.includes('cash') ? corps.cash_change_for : null;
  if (order.cash_change_for !== billet) e.push(`billet ${order.cash_change_for} au lieu de ${billet}`);
  if (corps.mode === 'delivery') {
    if (!order.delivery_address || order.delivery_address.city !== ville) e.push(`adresse ${JSON.stringify(order.delivery_address)}`);
  } else if (order.delivery_address !== null) e.push('adresse de livraison sur une commande à emporter');
  return e;
}

// ------------------------------------------------------------------ audit de la base

/**
 * Relit TOUTES les commandes et lignes enregistrées et les recalcule avec l'oracle. Aucune requête ne doit être en cours.
 * Renvoie { anomalies: [..], commandes, lignes }.
 */
export function auditerBase(idx, db, idsAttendus = null) {
  const anomalies = [];
  const commandes = db.prepare('SELECT * FROM orders ORDER BY id').all();
  const lignes = db.prepare('SELECT * FROM order_items ORDER BY order_id, position').all();
  const parCommande = new Map();
  for (const l of lignes) {
    const id = Number(l.order_id);
    if (!parCommande.has(id)) parCommande.set(id, []);
    parCommande.get(id).push(l);
  }
  const ids = new Set(commandes.map((o) => Number(o.id)));
  for (const id of parCommande.keys()) if (!ids.has(id)) anomalies.push(`lignes orphelines de la commande ${id}`);
  if (idsAttendus !== null) {
    for (const id of ids) if (!idsAttendus.has(id)) anomalies.push(`commande ${id} enregistrée alors que le serveur ne l'a jamais acceptée`);
    for (const id of idsAttendus) if (!ids.has(id)) anomalies.push(`commande ${id} acceptée mais absente de la base`);
  }
  const cles = new Set();
  for (const o of commandes) {
    const id = Number(o.id);
    const items = parCommande.get(id) ?? [];
    const cle = `${o.customer_id}/${o.idempotency_key}`;
    if (cles.has(cle)) anomalies.push(`#${id} clé d'envoi en double`);
    cles.add(cle);
    if (items.length === 0) anomalies.push(`#${id} sans aucune ligne`);
    if (o.status !== 'new') anomalies.push(`#${id} statut ${o.status}`);
    for (const k of ['products_cents', 'promo_cents', 'delivery_fee_cents', 'total_cents']) {
      if (!Number.isInteger(Number(o[k])) || Number(o[k]) < 0) anomalies.push(`#${id} ${k} = ${o[k]}`);
    }
    if (!(Number(o.total_cents) > 0)) anomalies.push(`#${id} total non positif`);
    const corps = {
      mode: o.mode,
      items: items.map((l) => ({
        name: l.name, variant: l.variant, qty: Number(l.qty),
        removed: JSON.parse(l.removed_json), extras: JSON.parse(l.extras_json), half: l.half_json === null ? null : JSON.parse(l.half_json)
      }))
    };
    const ville = o.mode === 'delivery' ? String(o.delivery_city) : null;
    if (o.mode === 'delivery' && !(ville in ZONES)) { anomalies.push(`#${id} livraison dans une ville hors zone : ${ville}`); continue; }
    if (o.mode === 'pickup' && (o.delivery_city !== null || o.delivery_street !== null)) anomalies.push(`#${id} adresse sur une commande à emporter`);
    const calcul = calculerCommande(idx, corps, ville);
    if (calcul.t === null) { anomalies.push(`#${id} ligne non reconnue par l'oracle : ${calcul.erreurs.join(' ; ')}`); continue; }
    const t = calcul.t;
    for (const [k, v] of [['products_cents', t.produits], ['promo_cents', t.promo], ['delivery_fee_cents', t.frais], ['total_cents', t.total]]) {
      if (Number(o[k]) !== v) anomalies.push(`#${id} ${k} = ${o[k]} au lieu de ${v}`);
    }
    if (Number(o.total_cents) !== Number(o.products_cents) - Number(o.promo_cents) + Number(o.delivery_fee_cents)) anomalies.push(`#${id} total incohérent avec produits - promo + frais`);
    if (o.mode === 'delivery' && !t.minimumAtteint) anomalies.push(`#${id} livraison sous le minimum de ${ville} (${t.apres} < ${t.min})`);
    items.forEach((l, i) => {
      const c = calcul.lignes[i];
      if (Number(l.unit_price_cents) !== c.unit) anomalies.push(`#${id} ligne ${i} prix ${l.unit_price_cents} au lieu de ${c.unit}`);
      if (Number(l.line_total_cents) !== c.unit * Number(l.qty)) anomalies.push(`#${id} ligne ${i} total de ligne ${l.line_total_cents}`);
      if (l.name !== c.nom) anomalies.push(`#${id} ligne ${i} nom stocké « ${l.name} » au lieu de « ${c.nom} »`);
    });
    const moyens = JSON.parse(o.payment_methods);
    if (o.mode === 'pickup' && moyens.length !== 0) anomalies.push(`#${id} moyens de paiement sur une commande à emporter`);
    if (o.mode === 'delivery' && (moyens.length === 0 || moyens.some((m) => !['card', 'cash', 'ticket', 'ticket_card'].includes(m)))) anomalies.push(`#${id} moyens de paiement ${o.payment_methods}`);
    if (!moyens.includes('cash') && o.cash_change_for !== null) anomalies.push(`#${id} billet sans espèces`);
  }
  return { anomalies, commandes: commandes.length, lignes: lignes.length };
}
