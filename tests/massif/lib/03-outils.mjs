// Aides de la batterie 03 : réception des commandes dans la vraie tablette du commerçant (navigateur réel).
// Les valeurs ATTENDUES sont recalculées ici à partir des règles métier (prix par taille, suppléments gratuits après
// un retrait, promotion, frais, libellés de paiement, formats français) : on ne rappelle JAMAIS le code de calcul du site,
// seules les données du catalogue sont lues. Un écart entre l'écran et ces valeurs est donc un vrai défaut (ou une règle mal lue).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const DOSSIER_CAPTURES = path.join(os.tmpdir(), 'subito-massif-captures', '03');
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const coupe = (s, n = 300) => { const t = String(s); return t.length > n ? t.slice(0, n) + '…' : t; };

// ---------------------------------------------------------------------------------------------- rapport
export function creerRapport() {
  const r = { controles: 0, reussis: 0, echoues: 0, champs: 0, echecs: [], debut: Date.now() };
  r.controle = (nom, ok, observe = '') => {
    r.controles++;
    if (ok) r.reussis++; else { r.echoues++; r.echecs.push({ nom, observe: String(observe) }); }
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${nom}${observe === '' ? '' : '  — ' + coupe(observe, 420)}`);
    return !!ok;
  };
  r.info = (texte) => console.log('INFO  ' + texte);
  return r;
}

// ---------------------------------------------------------------------------------------------- formats français
/** Espaces insécables (milliers U+202F, devise U+00A0) ramenés à une espace simple. */
export const normEsp = (s) => String(s == null ? '' : s).replace(/[  ]/g, ' ');

/** 1485,00 € → « 1 485,00 € » (espaces simples ; comparer après normEsp). */
export function eurTest(cents) {
  const neg = cents < 0;
  const abs = Math.abs(cents);
  const entier = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${neg ? '-' : ''}${entier},${String(abs % 100).padStart(2, '0')} €`;
}

/** « 12,50 € » ou « 1 485,00 € » → 1250 / 148500 ; null si illisible. */
export function parseEur(texte) {
  const m = /^(-?)\s*([0-9 ]+),([0-9]{2})\s*€$/.exec(normEsp(texte).trim());
  if (!m) return null;
  return (m[1] ? -1 : 1) * (Number(m[2].replace(/ /g, '')) * 100 + Number(m[3]));
}

const FMT_HM = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' });
const FMT_HMS = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', second: '2-digit' });
const FMT_JOUR = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' });
export const hmParis = (d) => FMT_HM.format(d);
export const hmsParis = (d) => FMT_HMS.format(d);
export const jourParis = (d) => FMT_JOUR.format(d);

/** Minutes « HH:MM » (heure de Paris) possibles pour une commande créée entre deMs et aMs (le serveur compte en secondes entières). */
export function minutesRecu(deMs, aMs) {
  const ok = new Set();
  for (let t = Math.floor(deMs / 1000) * 1000; t <= aMs; t += 10000) ok.add(hmParis(new Date(t)));
  ok.add(hmParis(new Date(aMs)));
  return [...ok];
}

/**
 * Textes « Reçue … » acceptables pour une commande créée entre deMs et aMs, affichés à l'instant maintenantMs
 * (le jour n'est répété que s'il n'est pas celui d'aujourd'hui, à minuit près).
 */
export function formatsRecu(deMs, aMs, maintenantMs) {
  const ok = new Set();
  const aujourdhui = jourParis(new Date(maintenantMs));
  const ajouter = (t) => {
    const d = new Date(t);
    const j = jourParis(d);
    if (j === aujourdhui) ok.add(`Reçue à ${hmParis(d)}`);
    else { const [y, m, dd] = j.split('-'); ok.add(`Reçue le ${dd}/${m}/${y} à ${hmParis(d)}`); }
  };
  for (let t = Math.floor(deMs / 1000) * 1000; t <= aMs; t += 10000) ajouter(t);
  ajouter(aMs);
  return [...ok];
}

export const capitaliser = (s) => { const c = Array.from(String(s)); return c.length ? c[0].toUpperCase() + c.slice(1).join('') : ''; };

// ---------------------------------------------------------------------------------------------- règles métier (indépendantes)
const cle = (s) => String(s).toLowerCase().replace(/\*$/, '').trim();

/**
 * Prix attendu d'une ligne : prix de la taille (ou prix fixe), plus suppléments ; chaque ingrédient retiré (présent sur la pizza,
 * compté une fois) rend gratuit le premier supplément suivant du même groupe. Renvoie { unite, supp } (prix de chaque supplément).
 */
export function prixAttendu(cat, produit, taille, retraits, supplements) {
  if (produit.kind !== 'pizza') return { unite: produit.price_cents, supp: [] };
  const groupes = cat.supplement_groups;
  const groupeDe = (nom) => groupes.findIndex((g) => g.names.some((n) => cle(n) === cle(nom)));
  const presents = new Set(produit.ingredients.map(cle));
  const credits = groupes.map(() => 0);
  const vus = new Set();
  for (const r of retraits) {
    const k = cle(r);
    if (vus.has(k) || !presents.has(k)) continue;
    vus.add(k);
    const g = groupeDe(r);
    if (g >= 0) credits[g]++;
  }
  let unite = produit.prices_by_size[taille];
  const supp = [];
  for (const nom of supplements) {
    const g = groupeDe(nom);
    if (g < 0) throw new Error('Supplément inconnu : ' + nom);
    let prix = groupes[g].prices_by_size[taille];
    if (credits[g] > 0) { credits[g]--; prix = 0; }
    supp.push(prix);
    unite += prix;
  }
  return { unite, supp };
}

/**
 * Totaux d'une commande. lignes : [{ unite, qty, taille }] (taille vide = pas une pizza). zone : { fee_cents } ou null.
 * À emporter : la moins chère de chaque paire de pizzas est offerte ; livraison : elle est à moitié prix (arrondi par paire) ;
 * frais de livraison seulement s'il n'y a AUCUNE pizza.
 */
export function calculerTotaux(lignes, mode, zone) {
  const brut = lignes.reduce((s, l) => s + l.unite * l.qty, 0);
  const prix = [];
  for (const l of lignes) if (l.taille) for (let i = 0; i < l.qty; i++) prix.push(l.unite);
  prix.sort((a, b) => b - a);
  let promo = 0;
  for (let i = 0; i + 1 < prix.length; i += 2) promo += mode === 'pickup' ? prix[i + 1] : Math.ceil(prix[i + 1] / 2);
  const aPizza = lignes.some((l) => l.taille);
  const frais = mode === 'delivery' && !aPizza && zone ? zone.fee_cents : 0;
  return { brut, promo, frais, total: brut - promo + frais, nbPizzas: prix.length };
}

const LIBELLES_PAIEMENT = { card: 'Carte bancaire', cash: 'Espèces', ticket: 'Ticket restaurant', ticket_card: 'Carte ticket restaurant' };

/** Libellé de paiement attendu sur la tablette. */
export function libellePaiement(mode, methodes, billet) {
  if (mode !== 'delivery') return 'Au retrait';
  let t = methodes.map((m) => LIBELLES_PAIEMENT[m]).join(' + ');
  if (methodes.includes('cash')) t += billet === 0 ? ' · appoint' : ` · billet de ${billet} €`;
  return t;
}

// ---------------------------------------------------------------------------------------------- script injecté avant le chargement de la page
// Sentinelle (la page ne doit jamais être rechargée), faux AudioContext (comptage des bips, aucun son), journal des annonces
// d'accessibilité (#live) et des notifications visuelles.
export const SCRIPT_INITIAL = `(() => {
  window.__sentinelle = Math.random().toString(36).slice(2);
  window.__bips = [];
  window.__annonces = [];
  window.__xss = undefined;
  class FauxAudio {
    constructor() { this.state = 'running'; this.currentTime = 0; this.destination = {}; }
    resume() { return Promise.resolve(); }
    createOscillator() { window.__bips.push(Date.now()); return { type: 'sine', frequency: { value: 0 }, connect() {}, start() {}, stop() {} }; }
    createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; }
  }
  window.AudioContext = FauxAudio;
  window.webkitAudioContext = FauxAudio;
  document.addEventListener('DOMContentLoaded', () => {
    const live = document.getElementById('live');
    if (!live) return;
    new MutationObserver(() => { if (live.textContent) window.__annonces.push({ t: Date.now(), texte: live.textContent }); })
      .observe(live, { childList: true, characterData: true, subtree: true });
  });
})();`;

// ---------------------------------------------------------------------------------------------- lecture de l'écran (exécutée dans la page)
/** Instantané complet : détail de la commande choisie, file, panneau de décision, débordements. */
export const lireTout = (largeur) => `(() => {
  const txt = (n) => (n ? n.textContent : null);
  const d = document.getElementById('order-detail');
  const q = document.getElementById('queue');
  const dec = document.getElementById('decision');
  const colDec = dec ? dec.closest('.decide-col') : null;
  const items = [...d.querySelectorAll('.items > li')].map((li) => {
    const nom = li.querySelector('.item-name');
    return {
      qty: txt(li.querySelector('.qty')),
      titre: nom ? [...nom.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('') : null,
      mods: nom ? [...nom.querySelectorAll('small')].map((s) => ({ cls: s.className, texte: s.textContent })) : [],
      total: txt(li.querySelector('.lp'))
    };
  });
  const client = d.querySelector('.od-client');
  const pickup = d.querySelector('.pickup');
  const pill = d.querySelector('.pill');
  const detail = {
    vide: !!d.querySelector('.empty'),
    texteVide: d.querySelector('.empty') ? d.querySelector('.empty').textContent.replace(/\\s+/g, ' ').trim() : null,
    rang: txt(d.querySelector('.eyebrow')),
    nom: txt(d.querySelector('.od-num')),
    heure: txt(d.querySelector('.od-time')),
    pastille: txt(pill),
    pastilleClasse: pill ? pill.className : null,
    mode: txt(pickup),
    modeVisuel: pickup ? pickup.innerText : null,
    clientNom: client ? txt(client.querySelector('strong')) : null,
    clientLignes: client ? [...client.querySelectorAll(':scope > span')].map(txt) : [],
    titresBlocs: [...d.querySelectorAll('.od-block h4')].map(txt),
    paiement: txt(d.querySelector('.od-pay')),
    items,
    sous: [...d.querySelectorAll('.od-sub')].map((s) => [...s.children].map(txt)),
    libelleTotal: txt(d.querySelector('.od-total > span')),
    total: txt(d.querySelector('.od-total strong')),
    intrus: d.querySelectorAll('img, script, iframe, b, i, u, a, svg, style, form, input').length
  };
  const chips = [...q.querySelectorAll('.qchip')].map((b) => ({
    id: b.dataset.id, action: b.dataset.action, actif: b.classList.contains('is-on'),
    titre: txt(b.querySelector('.qchip-title')), sous: txt(b.querySelector('.qchip-sub')), aria: b.getAttribute('aria-label')
  }));
  const file = {
    n: chips.length, chips,
    vide: !!q.querySelector('.queue-empty'),
    texteVide: q.querySelector('.queue-empty') ? q.querySelector('.queue-empty').textContent.trim() : null,
    doublons: chips.length - new Set(chips.map((c) => c.id)).size
  };
  const btn = (sel) => dec ? dec.querySelector(sel) : null;
  const decision = {
    colonneVisible: !!colDec && !colDec.hidden,
    texte: dec ? dec.textContent.replace(/\\s+/g, ' ').trim() : null,
    accepterId: btn('[data-action="accept"]') ? btn('[data-action="accept"]').dataset.id : null,
    refuserId: btn('[data-action="refuse"]') ? btn('[data-action="refuse"]').dataset.id : null,
    confirmerId: btn('[data-action="accept-confirm"]') ? btn('[data-action="accept-confirm"]').dataset.id : null,
    nbDelais: dec ? dec.querySelectorAll('[data-action="delay"]').length : 0,
    boutons: dec ? [...dec.querySelectorAll('button')].map((b) => { const r = b.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; }) : []
  };
  const L = ${Number(largeur) || 0};
  const doc = document.documentElement;
  const hors = [];
  const tronques = [];
  const textesHors = [];
  if (L > 0) {
    for (const el of document.querySelectorAll('#main *, #app-top *')) {
      const p = el.parentElement;
      if (p && p.closest('.queue, .cat-tabs')) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (r.right > L + 1 || r.left < -1) hors.push((el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\\s+/).join('.') : '')) + ' droite=' + Math.round(r.right) + ' « ' + (el.textContent || '').trim().slice(0, 40) + ' »');
    }
    const cadre = d.closest('.detail-col') || d;
    const limite = Math.min(L, cadre.getBoundingClientRect().right) + 1;
    const tw = document.createTreeWalker(d, NodeFilter.SHOW_TEXT);
    for (let nd = tw.nextNode(); nd; nd = tw.nextNode()) {
      if (!nd.textContent.trim()) continue;
      const rg = document.createRange();
      rg.selectNodeContents(nd);
      const rr = rg.getBoundingClientRect();
      if (rr.width > 0 && rr.right > limite) textesHors.push(nd.textContent.trim().slice(0, 36) + ' (droite ' + Math.round(rr.right) + ' px, limite ' + Math.round(limite) + ' px)');
    }
    for (const el of d.querySelectorAll('*')) {
      const cs = getComputedStyle(el);
      if ((cs.overflowX === 'hidden' || cs.overflowX === 'clip') && el.scrollWidth > el.clientWidth + 1) tronques.push(el.tagName.toLowerCase() + '.' + String(el.className).trim().split(/\\s+/).join('.'));
    }
  }
  const net = document.getElementById('net-banner');
  return {
    detail, file, decision,
    debordement: { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth, innerWidth: window.innerWidth, hors: hors.slice(0, 6), nbHors: hors.length, tronques: tronques.slice(0, 6), textesHors: textesHors.slice(0, 4), nbTextesHors: textesHors.length },
    reseauPerdu: !!net && !net.hidden,
    visibilite: document.visibilityState,
    xss: window.__xss === undefined ? null : String(window.__xss),
    sentinelle: window.__sentinelle,
    horloge: txt(document.getElementById('clock')),
    scrollY: Math.round(window.scrollY)
  };
})()`;

// ---------------------------------------------------------------------------------------------- gestes et attentes
/** Attend qu'une expression devienne vraie dans la page. Renvoie { ok, ms }. */
export async function attendre(page, expression, timeoutMs = 8000, pas = 40) {
  const t = Date.now();
  try { await page.waitFor(expression, timeoutMs, pas); return { ok: true, ms: Date.now() - t }; } catch { return { ok: false, ms: Date.now() - t }; }
}

/**
 * Vrai toucher : fait défiler l'élément au centre, vérifie qu'il est bien celui qui reçoit le toucher (rien ne le recouvre),
 * puis envoie un appui et un relâchement de souris au centre. Renvoie { ok, atteint, couvertPar, repli }.
 */
export async function taper(page, selecteur, { repli = true } = {}) {
  const pos = await page.evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selecteur)});
    if (!el) return null;
    el.scrollIntoView({ block: 'center', inline: 'center' });
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    const haut = document.elementFromPoint(x, y);
    return { x, y, w: r.width, h: r.height, atteint: !!haut && (haut === el || el.contains(haut)),
      couvertPar: haut ? (haut.tagName.toLowerCase() + (haut.id ? '#' + haut.id : '') + '.' + String(haut.className).slice(0, 40)) : null };
  })()`);
  if (pos === null) return { ok: false, introuvable: true };
  if (!pos.atteint) {
    if (repli) await page.evaluate(`document.querySelector(${JSON.stringify(selecteur)}).click()`);
    return { ok: false, atteint: false, couvertPar: pos.couvertPar, repli };
  }
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pos.x, y: pos.y });
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pos.x, y: pos.y, button: 'left', buttons: 1, clickCount: 1 });
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pos.x, y: pos.y, button: 'left', buttons: 0, clickCount: 1 });
  return { ok: true, atteint: true, tailleTouch: [Math.round(pos.w), Math.round(pos.h)] };
}

/** Capture PNG (page entière si pleinePage, hauteur plafonnée). Renvoie { fichier, octets }. */
export async function capturer(page, nomFichier, { pleinePage = true, hauteurMax = 2600 } = {}) {
  fs.mkdirSync(DOSSIER_CAPTURES, { recursive: true });
  const fichier = path.join(DOSSIER_CAPTURES, nomFichier);
  await page.evaluate('window.scrollTo(0, 0)');
  const params = { format: 'png' };
  if (pleinePage) {
    const m = await page.send('Page.getLayoutMetrics');
    const taille = m.cssContentSize || m.contentSize;
    params.captureBeyondViewport = true;
    params.clip = { x: 0, y: 0, width: Math.ceil(taille.width), height: Math.min(Math.ceil(taille.height), hauteurMax), scale: 1 };
  }
  const { data } = await page.send('Page.captureScreenshot', params);
  fs.writeFileSync(fichier, Buffer.from(data, 'base64'));
  return { fichier, octets: fs.statSync(fichier).size };
}

/** Texte réellement visible du nom de chaque pastille de la file (mesure du texte coupé par « … »). */
export const LIRE_NOMS_VISIBLES = `(() => {
  const cv = document.createElement('canvas').getContext('2d');
  return [...document.querySelectorAll('#queue .qchip')].map((b) => {
    const t = b.querySelector('.qchip-title');
    const complet = t.textContent;
    const cs = getComputedStyle(t);
    cv.font = cs.fontStyle + ' ' + cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily;
    const tronque = t.scrollWidth > t.clientWidth + 1;
    let visible = complet;
    if (tronque) {
      const c = Array.from(complet);
      let k = c.length;
      while (k > 0 && cv.measureText(c.slice(0, k).join('') + '…').width > t.clientWidth) k--;
      visible = c.slice(0, k).join('').trimEnd() + '…';
    }
    return { id: b.dataset.id, complet, visible, tronque, sous: b.querySelector('.qchip-sub').textContent, largeur: Math.round(t.clientWidth) };
  });
})()`;

// ---------------------------------------------------------------------------------------------- échecs réseau locaux
/**
 * La machine de test est partagée par une vingtaine de batteries qui ouvrent des milliers de connexions locales : les ports
 * éphémères Windows s'épuisent (« fetch failed », cause EADDRINUSE). Ces échecs n'ont rien à voir avec le site : on réessaie
 * (l'envoi d'une commande est rejouable grâce à sa clé d'idempotence) et on compte ce qui a été rattrapé.
 */
export const reseau = { echecs: 0, rattrapes: 0, codes: {} };
export async function reessayer(fn, { essais = 16 } = {}) {
  let derniere = null;
  for (let i = 1; i <= essais; i++) {
    try {
      const r = await fn();
      if (i > 1) reseau.rattrapes++;
      return r;
    } catch (e) {
      derniere = e;
      const code = (e && e.cause && (e.cause.code || e.cause.message)) || (e && e.code) || String(e);
      if (!/fetch failed|EADDRINUSE|ECONNRESET|ECONNREFUSED|EPIPE|UND_ERR|socket|terminated/i.test(`${e} ${code}`)) throw e;
      reseau.echecs++;
      reseau.codes[code] = (reseau.codes[code] || 0) + 1;
      await sleep(Math.min(120 * i, 1500) + ((i * 37) % 90));
    }
  }
  throw derniere;
}

/** Description d'une erreur pour le rapport (pile courte + cause). */
export function decrire(e) {
  const pile = e && e.stack ? e.stack.split('\n').slice(0, 4).join(' / ') : String(e);
  const cause = e && e.cause ? ` cause=${e.cause.code || e.cause.message}` : '';
  return pile + cause;
}
