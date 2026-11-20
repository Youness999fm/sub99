// Batterie 13 — E2E massif sur TOUT le site, navigateur réel (Chrome headless).
// Pages visitées : toutes les pages HTML publiées de la racine (hors concours, grand-tirage, subito-popup, tests, reports, tools) + commercant/index.html,
// chacune en mobile 320x640, mobile 390x844, tablette 768x1024 et bureau 1440x900 (au plus 4 onglets simultanés ; limite autorisée : 6).
// Contrôles : statut 200, titre, exceptions JS / console.error, requêtes locales en échec, images réellement chargées, liens internes et ancres,
// débordement horizontal, h1 unique, textes alternatifs, libellés de champs, inventaire des requêtes vers des domaines tiers, service worker du
// commerçant (enregistrement, portée, aucune réponse /api/ en cache), en-têtes Cache-Control de /api/, poids et temps de chargement, captures d'écran.
// Complément : pages dynamiques avec des données saisies par un client très long (noms de 60 caractères sans espace, adresse de 150, remarque de 300) :
// suivi de commande dans ses 4 états, Mon compte connecté, espace commerçant connecté (3 onglets).
// Tout reste local : le site de test tourne dans ce processus ; tout hôte autre que le site est REFUSÉ côté navigateur (aucune sortie vers Internet).
//
//   node tests/massif/lancer.mjs tests/massif/13-pages-navigateur-massif.mjs --timeout=480
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { demarrerSite, reponses } from './lib/env.mjs';
import { avecNavigateur } from './lib/chrome.mjs';
import { enParallele, ipFictive } from './lib/clients.mjs';
import { rng, construireCommande, lignePizza, ligneProduit } from './lib/commandes.mjs';
import { sleep } from '../e2e/lib/cdp.mjs';
import * as C from './lib/13-collecte.mjs';
const { ClientRobuste } = C;

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DOSSIER_CAPTURES = path.join(os.tmpdir(), 'subito-massif-captures', '13');
const CONCURRENCE = 4; // onglets simultanés (limite de la mission : 6)
const DEBUT = Date.now();
const DELAI_GLOBAL_MS = 440000; // le lanceur coupe à 480 s : on s'arrête avant, avec un bilan

// ---------------------------------------------------------------------------------------------------------------------
// Sortie : une ligne PASS / FAIL par contrôle
// ---------------------------------------------------------------------------------------------------------------------
let nbPass = 0;
let nbFail = 0;
const lignesFail = [];
function controle(id, ok, detail = '') {
  if (ok) nbPass++; else { nbFail++; lignesFail.push(id + (detail !== '' ? '  — ' + detail : '')); }
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}${detail !== '' ? '  — ' + detail : ''}`);
  return !!ok;
}
const info = (texte) => console.log('INFO  ' + texte);
const titre = (texte) => console.log('\n=== ' + texte + ' ===');
const court = (s, n = 140) => { s = String(s); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const liste = (tab, n = 4) => tab.slice(0, n).join(' ; ') + (tab.length > n ? ` … (+${tab.length - n})` : '');

// ---------------------------------------------------------------------------------------------------------------------
// Inventaire des pages
// ---------------------------------------------------------------------------------------------------------------------
const EXCLUES = new Set(['concours.html', 'grand-tirage.html']);
const TOUTES_PAGES = [...fs.readdirSync(RACINE).filter((f) => f.endsWith('.html') && !EXCLUES.has(f)).sort(), 'commercant/index.html'];
// Option de mise au point : --pages=index.html,menu.html limite les visites (non utilisée pour la livraison : sans option, toutes les pages).
const ARG_PAGES = (process.argv.find((a) => a.startsWith('--pages=')) || '').slice(8).split(',').filter(Boolean);
const PAGES = ARG_PAGES.length ? TOUTES_PAGES.filter((p) => ARG_PAGES.includes(p)) : TOUTES_PAGES;
const estPrivee = (p) => p.startsWith('commercant/');
const PAGES_CAPTURE = ['index.html', 'menu.html', 'compte.html', 'commercant/index.html', '404.html'];
const nomFichier = (p) => p.replace(/[\\/]/g, '_').replace(/\.html$/, '');
const VP = Object.fromEntries(C.VIEWPORTS.map((v) => [v.nom, v]));

// ---------------------------------------------------------------------------------------------------------------------
// Visite d'une page dans un onglet (un onglet par visite, fermé ensuite)
// ---------------------------------------------------------------------------------------------------------------------
async function visiter(nav, base, cible, vp, { cookies = null, attendre = null, apres = null } = {}) {
  const v = { cible, vp: vp.nom, l: vp.l, h: vp.h, erreurVisite: null };
  let page = null;
  try {
    page = await nav.ouvrirPage('about:blank', { largeur: vp.l, hauteur: vp.h, mobile: vp.mobile, cookies: cookies || undefined });
    const col = await C.instrumenter(page, base);
    const t0 = Date.now();
    try { await page.navigate(base + cible, 300); } catch (e) { v.erreurVisite = 'navigation : ' + e.message; }
    v.dureeNav = Date.now() - t0;
    if (!v.erreurVisite) {
      await C.attendreCalme(col, { silence: 600, max: 8000 });
      await page.waitFor("!document.getElementById('intro-splash')", 6000).catch(() => {});
      if (attendre) { try { await attendre(page, col, v); } catch (e) { v.erreurAttente = e.message; } }
      v.naturel = col.resume();
      v.analyse = await C.evaluerAvecDelai(page, C.enExpression(C.analyserPage, { largeur: vp.l }), 30000, 'analyse');
      v.parcours = await C.evaluerAvecDelai(page, C.enExpression(C.parcourirPage), 45000, 'parcours');
      v.images = await C.evaluerAvecDelai(page, C.enExpression(C.chargerImages, 8000), 20000, 'chargement des images');
      await C.attendreCalme(col, { silence: 500, max: 6000 });
      v.analyse2 = await C.evaluerAvecDelai(page, C.enExpression(C.analyserPage, { largeur: vp.l }), 30000, 'analyse finale');
      v.reseau = col.resume();
      if (apres) await apres(page, col, v);
    }
    const e = col.etat;
    v.exceptions = [...e.exceptions];
    v.consoleErreurs = [...e.consoleErreurs];
    v.avertissements = [...e.consoleAvert];
    v.journal = [...e.journal];
    v.dialogues = [...e.dialogues];
    v.doc = e.docPrincipal ? { url: e.docPrincipal.url, statut: e.docPrincipal.statut, mime: e.docPrincipal.mime } : null;
  } catch (err) {
    v.erreurVisite = (v.erreurVisite ? v.erreurVisite + ' ; ' : '') + err.message;
  } finally {
    if (page) { try { await page.fermer(); } catch { /* onglet déjà fermé */ } }
  }
  return v;
}

const ERREURS_INFRA = /ERR_ADDRESS_IN_USE|ERR_CONNECTION_REFUSED|ERR_CONNECTION_RESET|ERR_CONNECTION_CLOSED|ERR_EMPTY_RESPONSE|ERR_CONNECTION_TIMED_OUT|ERR_ADDRESS_UNREACHABLE|ERR_INSUFFICIENT_RESOURCES|ERR_NETWORK_CHANGED/;
let nbReprises = 0;
/** Rejoue une visite (jusqu'à 3 essais) quand le navigateur n'a pas pu ÉTABLIR la connexion locale : saturation des ports TCP du poste partagé, pas un défaut du site. */
async function visiterAvecReprise(nav, base, cible, vp, opts) {
  let v;
  for (let essai = 1; essai <= 3; essai++) {
    v = await visiter(nav, base, cible, vp, opts);
    v.essais = essai;
    const infra = (v.erreurVisite && ERREURS_INFRA.test(v.erreurVisite)) || (v.reseau && v.reseau.echecs.some((r) => r.echec && ERREURS_INFRA.test(r.echec)));
    if (!infra) break;
    nbReprises++;
    await sleep(400 * essai);
  }
  return v;
}

/** Capture d'écran PNG (fenêtre seule, ou page entière plafonnée) ; renvoie la taille du fichier. */
async function capturer(page, fichier, { pleinePage = false, largeur = 390, hauteurPage = 0, plafond = 3600 } = {}) {
  const params = { format: 'png' };
  if (pleinePage && hauteurPage > 0) {
    params.captureBeyondViewport = true;
    params.clip = { x: 0, y: 0, width: largeur, height: Math.min(hauteurPage, plafond), scale: 1 };
  }
  const { data } = await C.avecDelai(page.send('Page.captureScreenshot', params), 20000, 'capture');
  const buf = Buffer.from(data, 'base64');
  fs.writeFileSync(fichier, buf);
  return buf.length;
}

// ---------------------------------------------------------------------------------------------------------------------
// Évaluation des visites
// ---------------------------------------------------------------------------------------------------------------------
let ORIGINE = '';
const estLocalUrl = (u) => { try { return new URL(u).origin === ORIGINE; } catch { return false; } };
const cheminDe = (u) => { try { const x = new URL(u); return x.pathname + x.search; } catch { return String(u); } };

function problemesAlt(images) {
  const pb = [];
  for (const i of images) {
    if (!i.aSrc || i.src === '') continue; // gabarit sans source (rempli au clic) : traité à part
    if (i.alt === null) pb.push(`alt absent : ${i.src}`);
    else if (i.alt === '' && i.dansLien && !i.nomParent) pb.push(`alt vide dans un ${i.dansLien} sans nom : ${i.src}`);
    else if (i.alt !== '' && (/\.(jpe?g|png|gif|webp|svg)\b/i.test(i.alt) || /^(image|img|photo|picture|graphic|icon)\s*\d*$/i.test(i.alt.trim()))) pb.push(`alt non descriptif « ${i.alt} » : ${i.src}`);
  }
  return pb;
}

/** Erreurs du navigateur (journal Log) qui comptent : hors tiers bloqués par le test et hors 401 attendu de owner_me hors connexion. */
function journalPertinent(v, privee) {
  return (v.journal || []).filter((j) => {
    if (j.url && !estLocalUrl(j.url)) return false;
    if (privee && /\/api\/owner_me\.php$/.test(cheminDe(j.url || '')) && /401/.test(j.texte)) return false;
    return true;
  });
}

function requetesEnEchec(v, privee) {
  return (v.reseau.echecs || []).filter((r) => !(privee && /\/api\/owner_me\.php$/.test(cheminDe(r.url)) && r.statut === 401));
}

const TYPES_CRITIQUES = new Set(['Document', 'Stylesheet', 'Script', 'Image', 'Font', 'Manifest']);
const visiteOk = (v) => v && !v.erreurVisite && v.analyse && v.analyse2 && v.reseau;

/** Contrôles qui ne dépendent pas de la taille d'écran (évalués à chaque taille, une seule ligne par contrôle). */
function evaluerIndependants(page, vsOk, { privee, complet = true } = {}) {
  const tag = `[${page}]`;
  const a0 = vsOk[0].analyse;
  if (complet) {
    const statuts = vsOk.map((v) => (v.doc ? v.doc.statut : null));
    const mimes = vsOk.map((v) => (v.doc ? v.doc.mime : ''));
    controle(`${tag} statut HTTP 200 (text/html, sans redirection)`,
      statuts.every((s) => s === 200) && mimes.every((m) => /^text\/html/.test(m)) && vsOk.every((v) => v.analyse.url.endsWith('/' + page)),
      `${statuts.join('/')} ${mimes[0]} ${a0.url.replace(ORIGINE, '')}`);

    const titres = [...new Set(vsOk.map((v) => v.analyse.titre))];
    controle(`${tag} titre présent, explicite, sans valeur brute`,
      titres.length === 1 && titres[0].trim().length >= 10 && /subito/i.test(titres[0]) && !/\b(undefined|null|todo|localhost)\b/i.test(titres[0]),
      `« ${titres.join(' | ')} » (${titres[0].length} car.)`);
  }

  const h1 = vsOk.map((v) => v.analyse.h1.visibles);
  controle(`${tag} un seul h1 visible`, h1.every((n) => n === 1), `h1 visibles ${h1.join('/')} (dans le DOM : ${a0.h1.total}) « ${court(a0.h1.textes[0] || '', 50)} »`);
  if (complet) controle(`${tag} un seul repère main`, vsOk.every((v) => v.analyse.nbMain === 1), `main = ${vsOk.map((v) => v.analyse.nbMain).join('/')}`);

  const alts = [...new Set(vsOk.flatMap((v) => problemesAlt(v.analyse2.images)))];
  const nbImg = Math.max(...vsOk.map((v) => v.analyse2.images.length));
  const sansSrc = Math.max(...vsOk.map((v) => v.analyse2.images.filter((i) => !i.src).length));
  controle(`${tag} texte alternatif de toutes les images`, alts.length === 0, `${nbImg} image(s)${sansSrc ? ` dont ${sansSrc} gabarit sans src` : ''}${alts.length ? ' ; ' + liste(alts) : ''}`);

  const sansLibelle = [...new Set(vsOk.flatMap((v) => v.analyse2.champs.filter((c) => !c.via).map((c) => `${c.desc}${c.placeholderSeul ? ' (placeholder seul)' : ''}`)))];
  const nbChamps = Math.max(...vsOk.map((v) => v.analyse2.champs.length));
  const nbSans = Math.max(...vsOk.map((v) => v.analyse2.champs.filter((c) => !c.via).length));
  controle(`${tag} libellé de chaque champ de formulaire`, nbSans === 0 && vsOk.every((v) => v.analyse2.etiquettesOrphelines.length === 0),
    `${nbChamps} champ(s)${nbSans ? ` dont ${nbSans} sans libellé : ${liste(sansLibelle, 3)}` : ''}`);

  const sansNom = [...new Set(vsOk.flatMap((v) => [
    ...v.analyse2.boutons.filter((b) => !b.nom && !b.masque).map((b) => 'bouton ' + b.desc),
    ...v.analyse2.liens.filter((l) => !l.nom && !l.masque).map((l) => 'lien ' + l.href)
  ]))];
  controle(`${tag} boutons et liens visibles ont un nom accessible`, sansNom.length === 0, sansNom.length ? liste(sansNom) : `${vsOk[0].analyse2.boutons.length} bouton(s), ${vsOk[0].analyse2.liens.length} lien(s)`);

  const doublons = [...new Set(vsOk.flatMap((v) => v.analyse2.idsDoublons))];
  controle(`${tag} identifiants (id) uniques`, doublons.length === 0, doublons.length ? liste(doublons) : `${vsOk[0].analyse2.ids.length} id`);

  const motifs = [...new Set(vsOk.flatMap((v) => v.analyse2.motifsSuspects))];
  controle(`${tag} aucune valeur de gabarit brute visible (undefined, NaN, [object Object], null)`, motifs.length === 0, motifs.length ? liste(motifs.map((m) => `« ${m} »`), 2) : `${a0.texteLongueur} caractères de texte`);
  if (!complet) return;

  const metaOk = vsOk.every((v) => v.analyse.lang === 'fr' && /width=device-width/.test(v.analyse.meta.viewport || '') && !/user-scalable\s*=\s*(no|0)|maximum-scale\s*=\s*1(\.0)?\b/.test(v.analyse.meta.viewport || ''));
  controle(`${tag} langue fr et viewport sans blocage du zoom`, metaOk, `lang=${a0.lang} viewport=« ${a0.meta.viewport} »`);
  if (!privee) controle(`${tag} meta description présente`, vsOk.every((v) => (v.analyse.meta.description || '').trim().length >= 20), `${(a0.meta.description || '').length} car.`);
  else controle(`${tag} page privée non indexable (meta robots noindex)`, /noindex/.test(a0.meta.robots || ''), `robots=« ${a0.meta.robots} »`);

  // Tiers : hôtes contactés (tentatives), scripts externes, outils d'analyse
  const hotes = new Map();
  for (const v of vsOk) for (const t of v.reseau.tiers) {
    if (!hotes.has(t.hote)) hotes.set(t.hote, { n: 0, types: new Set() });
    const h = hotes.get(t.hote); h.n = Math.max(h.n, t.n); t.types.forEach((x) => h.types.add(x));
  }
  const inconnus = [...hotes.keys()].filter((h) => !C.TIERS_CONNUS.includes(h));
  const scriptsExt = [...new Set(vsOk.flatMap((v) => v.analyse2.externes.scripts))];
  const analytics = [...new Set(vsOk.flatMap((v) => v.analyse2.analyticsGlobaux))];
  const formsExt = [...new Set(vsOk.flatMap((v) => v.analyse2.externes.formulaires))];
  const inventaire = [...hotes.entries()].map(([h, x]) => `${h} ×${x.n} (${[...x.types].join(',')})`);
  info(`tiers ${tag} tentatives vers : ${inventaire.length ? inventaire.join(' ; ') : '(aucun domaine tiers)'}`);
  controle(`${tag} aucun domaine tiers hors Google Fonts / Maps, aucun script externe, aucun outil d'analyse`,
    inconnus.length === 0 && scriptsExt.length === 0 && analytics.length === 0 && formsExt.length === 0,
    inconnus.length || scriptsExt.length || analytics.length || formsExt.length
      ? `hôtes inconnus : ${inconnus.join(', ') || '-'} ; scripts : ${scriptsExt.join(', ') || '-'} ; globaux : ${analytics.join(', ') || '-'} ; formulaires : ${formsExt.join(', ') || '-'}`
      : `${hotes.size} hôte(s) connu(s)`);
  const iframes = vsOk[0].analyse2.externes.iframes;
  if (iframes.length) controle(`${tag} chaque iframe a un titre`, iframes.every((f) => (f.title || '').trim() !== ''), iframes.map((f) => `${court(f.src, 60)} → « ${f.title} »`).join(' ; '));
}

/** Contrôles qui dépendent de la taille d'écran : une ligne par taille. */
function evaluerParTaille(etiquette, vsOk, { privee = false } = {}) {
  for (const v of vsOk) {
    const t = `[${etiquette} @ ${v.vp}]`;
    const erreursJs = [...v.exceptions, ...v.consoleErreurs.map((x) => 'console.error ' + x)];
    const jp = journalPertinent(v, privee);
    const total = erreursJs.length + jp.length + v.dialogues.length;
    controle(`${t} aucune exception JavaScript, console.error ni erreur du navigateur`, total === 0,
      total === 0 ? `0 (avertissements : ${v.avertissements.length})` : liste([...erreursJs, ...jp.map((j) => `${j.source} : ${j.texte}`), ...v.dialogues.map((d) => 'dialogue ' + d)], 3));

    const ech = requetesEnEchec(v, privee);
    const annulees = (v.reseau.annulees || []).filter((r) => TYPES_CRITIQUES.has(r.type));
    controle(`${t} aucune requête locale en échec (404, 5xx, réseau) ni ressource annulée`, ech.length === 0 && annulees.length === 0,
      ech.length || annulees.length ? liste([...ech.map((r) => `${r.statut ?? r.echec} ${cheminDe(r.url)}`), ...annulees.map((r) => `annulée ${cheminDe(r.url)}`)], 4) : `${v.reseau.nbRequetes} requêtes locales, toutes en succès`);

    const cassees = v.images.filter((i) => i.src && (!i.complete || i.w === 0));
    const avecSrc = v.images.filter((i) => i.src).length;
    controle(`${t} images réellement chargées (naturalWidth > 0)`, cassees.length === 0, cassees.length ? liste(cassees.map((i) => `${i.src} (w=${i.w})`)) : `${avecSrc} image(s) chargée(s)`);

    const d1 = v.analyse.debord;
    const d2 = Math.max(v.analyse2.debord.depasse, v.parcours.maxScrollWidth - Math.min(v.l, v.parcours.clientWidth));
    const depasse = Math.max(d1.depasse, d2);
    const fautifs = (v.analyse.debord.fautifs.length ? v.analyse.debord.fautifs : v.analyse2.debord.fautifs).slice(0, 3);
    controle(`${t} pas de défilement horizontal (scrollWidth <= largeur)`, depasse <= 0,
      depasse <= 0 ? `scrollWidth ${d1.scrollWidth} <= ${v.l} px` : `dépasse de ${depasse} px (scrollWidth ${Math.max(d1.scrollWidth, v.parcours.maxScrollWidth)} pour ${v.l} px ; innerWidth ${d1.innerWidth}) ; éléments : ${fautifs.map((f) => `${f.el} [${f.gauche}→${f.droite}]`).join(', ')}`);
  }
}

function evaluerPage(page, vs) {
  const vsOk = vs.filter(visiteOk);
  const echecsVisite = vs.filter((v) => !visiteOk(v));
  controle(`[${page}] visite complète aux ${C.VIEWPORTS.length} tailles d'écran`, echecsVisite.length === 0,
    echecsVisite.length ? echecsVisite.map((v) => `${v.vp} : ${court(v.erreurVisite || 'analyse absente', 100)}`).join(' ; ') : vs.map((v) => v.vp.replace('-', ' ')).join(', '));
  if (!vsOk.length) return;
  evaluerIndependants(page, vsOk, { privee: estPrivee(page) });
  evaluerParTaille(page, vsOk, { privee: estPrivee(page) });
}

// ---------------------------------------------------------------------------------------------------------------------
// Fichiers du site : favicon, manifestes, icônes, robots, plan du site, balises link, références dans les scripts
// ---------------------------------------------------------------------------------------------------------------------
async function verifierManifeste(base, chemin, { scopeAttendu = null } = {}) {
  const r = await C.recuperer(base + chemin);
  let m = null;
  try { m = JSON.parse(r.corps.toString('utf8')); } catch { /* contrôlé ci-dessous */ }
  controle(`${chemin} : 200 et JSON valide`, r.statut === 200 && m !== null && typeof m === 'object', `${r.statut} ${r.type} ${r.taille} o`);
  if (!m) return null;
  controle(`${chemin} : nom, nom court, affichage, couleurs et langue renseignés`, !!(m.name && m.short_name && m.display && m.theme_color && m.background_color && m.lang),
    `name=« ${m.name} » short_name=« ${m.short_name} » display=${m.display} lang=${m.lang}`);
  const url = new URL(chemin, base);
  const start = new URL(m.start_url, url);
  const portee = new URL(m.scope || '.', m.scope ? url : start);
  const rs = await C.recuperer(start.href);
  controle(`${chemin} : start_url répond 200 et reste dans la portée`, rs.statut === 200 && start.pathname.startsWith(portee.pathname), `start_url ${start.pathname} → ${rs.statut} ; portée ${portee.pathname}`);
  if (scopeAttendu !== null) controle(`${chemin} : portée déclarée = ${scopeAttendu}`, m.scope === scopeAttendu, `scope=« ${m.scope} »`);
  const icones = Array.isArray(m.icons) ? m.icons : [];
  const detail = [];
  let toutOk = icones.length >= 2;
  for (const ic of icones) {
    const ri = await C.recuperer(new URL(ic.src, url).href);
    const dim = C.dimensionsPng(ri.corps);
    const [l, h] = String(ic.sizes || '').split('x').map(Number);
    const ok = ri.statut === 200 && dim && dim.l === l && dim.h === h;
    if (!ok) toutOk = false;
    detail.push(`${ic.sizes} → ${ri.statut} ${dim ? dim.l + 'x' + dim.h : 'illisible'}`);
  }
  controle(`${chemin} : icônes (192 et 512) existantes, au format PNG et aux dimensions annoncées`, toutOk && icones.some((i) => i.sizes === '192x192') && icones.some((i) => i.sizes === '512x512'), detail.join(' ; '));
  return m;
}

async function verifierFichiersSite(base) {
  titre('Fichiers du site : favicon, manifestes, robots, plan du site');
  const fav = await C.recuperer(base + '/favicon.ico');
  controle('favicon.ico : 200, image, en-tête ICO valide', fav.statut === 200 && /image\//.test(fav.type) && fav.taille > 100 && fav.corps.readUInt16LE(0) === 0 && fav.corps.readUInt16LE(2) === 1, `${fav.statut} ${fav.type} ${fav.taille} o`);
  await verifierManifeste(base, '/manifest.json');
  await verifierManifeste(base, '/commercant/manifest.webmanifest', { scopeAttendu: '/commercant/' });

  const robots = await C.recuperer(base + '/robots.txt');
  const txt = robots.corps.toString('utf8');
  controle('robots.txt : 200, interdit /api/ et /commercant/, annonce le plan du site', robots.statut === 200 && /^Disallow:\s*\/api\/\s*$/m.test(txt) && /^Disallow:\s*\/commercant\/\s*$/m.test(txt) && /^Sitemap:\s*https:\/\//m.test(txt), `${robots.statut} ${robots.taille} o`);

  const plan = await C.recuperer(base + '/sitemap.xml');
  const locs = [...plan.corps.toString('utf8').matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
  const morts = [];
  for (const loc of locs) {
    const chemin = new URL(loc).pathname;
    const r = await C.recuperer(base + chemin);
    if (r.statut !== 200) morts.push(`${r.statut} ${chemin}`);
  }
  controle('sitemap.xml : 200 et chaque adresse listée existe sur le site', plan.statut === 200 && locs.length >= 5 && morts.length === 0 && new Set(locs).size === locs.length, `${locs.length} adresses${morts.length ? ' ; absentes : ' + liste(morts) : ''}`);
  controle('sitemap.xml : toutes les adresses sont sur un seul domaine https', locs.length > 0 && new Set(locs.map((l) => new URL(l).origin)).size === 1 && locs.every((l) => l.startsWith('https://')), [...new Set(locs.map((l) => new URL(l).origin))].join(', '));
}

/** Les balises link de chaque page (icônes, manifeste, feuilles) pointent vers des fichiers qui existent. */
async function verifierBalisesLink(base, visites) {
  const cibles = new Map();
  for (const [p, vs] of visites) for (const v of vs) {
    if (!visiteOk(v)) continue;
    for (const l of v.analyse2.liensLink) { if (estLocalUrl(l.href)) { const k = new URL(l.href).pathname; if (!cibles.has(k)) cibles.set(k, new Set()); cibles.get(k).add(p); } }
  }
  const manquants = [];
  await enParallele([...cibles.keys()], 6, async (chemin) => { const r = await C.recuperer(base + chemin); if (r.statut !== 200 || r.taille === 0) manquants.push(`${r.statut} ${chemin} (${[...cibles.get(chemin)].slice(0, 2).join(', ')})`); });
  controle('balises <link> (icônes, apple-touch-icon, manifeste, feuilles de style) : tous les fichiers locaux existent', manquants.length === 0 && cibles.size > 0, `${cibles.size} fichier(s) distinct(s)${manquants.length ? ' ; manquants : ' + liste(manquants) : ''}`);
}

/** Chemins assets/... cités dans les scripts, feuilles de style et pages : le fichier existe (photos du carrousel d'accueil, icônes, données). */
async function verifierReferencesStatiques(base, visites) {
  const sources = new Map(); // url absolue -> true
  for (const [, vs] of visites) for (const v of vs) {
    if (!visiteOk(v)) continue;
    for (const r of v.reseau.locales) if (['Script', 'Stylesheet'].includes(r.type) && r.statut === 200) sources.set(r.url, true);
  }
  for (const p of PAGES) sources.set(base + '/' + p, true);
  sources.set(base + '/commercant/sw.js', true);
  const cibles = new Map();
  for (const src of sources.keys()) {
    const r = await C.recuperer(src);
    const texte = r.corps.toString('utf8');
    const racine = src.includes('commercant') ? new URL('/commercant/index.html', ORIGINE) : (/\.html$/.test(src) ? new URL(src) : new URL('/index.html', ORIGINE));
    for (const m of texte.matchAll(/(?:\.\.\/|\.\/|\/)?assets\/[A-Za-z0-9_\-./%]+\.(?:png|jpe?g|gif|webp|svg|ico|wav|mp3|json|css|js)\b/g)) {
      const abs = new URL(m[0], racine).href;
      if (!cibles.has(abs)) cibles.set(abs, new Set());
      cibles.get(abs).add(path.basename(new URL(src).pathname));
    }
  }
  const manquants = [];
  await enParallele([...cibles.keys()], 8, async (u) => { const r = await C.recuperer(u); if (r.statut !== 200 || r.taille === 0) manquants.push(`${r.statut} ${new URL(u).pathname} (cité par ${[...cibles.get(u)].slice(0, 2).join(', ')})`); });
  controle('références assets/... citées dans les pages, scripts, feuilles et service worker : tous les fichiers existent', manquants.length === 0 && cibles.size > 20, `${cibles.size} référence(s) distincte(s) vérifiée(s) dans ${sources.size} fichier(s)${manquants.length ? ' ; manquants : ' + liste(manquants) : ''}`);
}

// ---------------------------------------------------------------------------------------------------------------------
// Liens internes, ancres, liens externes
// ---------------------------------------------------------------------------------------------------------------------
async function verifierLiens(base, visites) {
  titre('Liens : cibles internes, ancres, liens externes, tel et mailto');
  const idsParPage = new Map();
  for (const [p, vs] of visites) {
    const v = vs.find((x) => x.vp === 'bureau-1440' && visiteOk(x)) || vs.find(visiteOk);
    if (v) idsParPage.set(p, new Set([...v.analyse2.ids, ...v.analyse2.noms]));
  }
  const reponsesHttp = new Map();
  const cible = (url) => { if (!reponsesHttp.has(url)) reponsesHttp.set(url, C.recuperer(url)); return reponsesHttp.get(url); };
  const pageDe = (pathname) => { let p = decodeURIComponent(pathname).replace(/^\//, ''); if (p === '' || p.endsWith('/')) p += 'index.html'; return p; };
  const publiques = PAGES.filter((p) => !estPrivee(p));
  const liensDesPages = new Map();

  for (const p of PAGES) {
    const vs = (visites.get(p) || []).filter(visiteOk);
    if (!vs.length) { controle(`[${p}] liens vérifiés`, false, 'aucune visite exploitable'); continue; }
    const liens = new Map();
    for (const v of vs) for (const l of v.analyse2.liens) liens.set(l.abs + '|' + l.href, l);
    liensDesPages.set(p, [...liens.values()]);
    const problemes = [];
    let nbInt = 0; let nbExt = 0; let nbAutre = 0;
    for (const l of liens.values()) {
      const href = l.href;
      if (href === '#' || href === '') { problemes.push(`ancre vide « ${href} » (${l.nom || 'sans nom'})`); continue; }
      if (/^javascript:/i.test(href)) { problemes.push(`javascript: dans un lien (${l.nom})`); continue; }
      if (/^mailto:/i.test(href)) { nbAutre++; if (!/^mailto:[^@\s?]+@[^@\s?]+\.[^@\s?]+/i.test(href)) problemes.push(`mailto invalide ${href}`); continue; }
      if (/^tel:/i.test(href)) { nbAutre++; if (!/^tel:\+?[0-9 ().-]{6,20}$/i.test(href)) problemes.push(`tel invalide ${href}`); continue; }
      let u;
      try { u = new URL(l.abs); } catch { problemes.push(`URL invalide ${href}`); continue; }
      if (u.origin !== ORIGINE) {
        nbExt++;
        if (u.protocol !== 'https:') problemes.push(`lien externe non sécurisé ${l.abs}`);
        if (l.cible === '_blank' && !/noopener|noreferrer/.test(l.rel || '')) problemes.push(`_blank sans noopener ${court(l.abs, 70)}`);
        continue;
      }
      nbInt++;
      const rep = await cible(u.origin + u.pathname + u.search);
      if (rep.statut !== 200) { problemes.push(`cible ${rep.statut} ${u.pathname}`); continue; }
      if (u.hash && u.hash.length > 1) {
        const frag = decodeURIComponent(u.hash.slice(1));
        const cibleP = pageDe(u.pathname);
        let ids = idsParPage.get(cibleP);
        if (!ids) ids = C.idsDuHtml(rep.corps.toString('utf8'));
        if (!ids.has(frag)) problemes.push(`ancre #${frag} absente de ${u.pathname}`);
      }
    }
    controle(`[${p}] liens : cibles internes en 200, ancres existantes, liens externes sûrs, tel/mailto valides`, problemes.length === 0,
      `${liens.size} liens (${nbInt} internes, ${nbExt} externes, ${nbAutre} tel/mailto)${problemes.length ? ' ; ' + liste(problemes) : ''}`);
  }
  const uniques = [...reponsesHttp.entries()];
  const resolues = await Promise.all(uniques.map(async ([u, pr]) => [u, await pr]));
  const mauvaises = resolues.filter(([, r]) => r.statut !== 200).map(([u, r]) => `${r.statut} ${cheminDe(u)}`);
  controle('toutes les cibles internes distinctes répondent 200', mauvaises.length === 0 && resolues.length >= 8, `${resolues.length} adresses internes distinctes suivies${mauvaises.length ? ' ; ' + liste(mauvaises) : ''}`);

  // Cohérence entre pages
  const titres = [];
  for (const p of PAGES) { const v = (visites.get(p) || []).find(visiteOk); if (v) titres.push([p, v.analyse.titre]); }
  const doublons = titres.filter(([, t], i) => titres.findIndex(([, t2]) => t2 === t) !== i).map(([p, t]) => `${p} « ${t} »`);
  controle('titres distincts sur toutes les pages', doublons.length === 0 && titres.length === PAGES.length, doublons.length ? liste(doublons) : `${titres.length} titres distincts`);
  const sansLegal = publiques.filter((p) => !(liensDesPages.get(p) || []).some((l) => /(^|\/)mentions-legales\.html(#.*)?$/.test(l.href)));
  controle('lien « Mentions légales » présent sur chaque page publique', sansLegal.length === 0, sansLegal.length ? 'absent de : ' + sansLegal.join(', ') : `${publiques.length} pages`);
  const navPrincipale = ['index.html', 'menu.html', 'reseaux.html', 'compte.html'];
  const sansNav = publiques.filter((p) => !navPrincipale.every((n) => (liensDesPages.get(p) || []).some((l) => new RegExp('(^|/)' + n.replace('.', '\\.') + '$').test(l.href))));
  controle('navigation principale (accueil, menu, réseaux, compte) présente sur chaque page publique', sansNav.length === 0, sansNav.length ? 'incomplète sur : ' + sansNav.join(', ') : `${publiques.length} pages`);
}

// ---------------------------------------------------------------------------------------------------------------------
// API : Cache-Control: no-store sur toutes les réponses (succès comme erreurs)
// ---------------------------------------------------------------------------------------------------------------------
const MOT = (n) => 'Anticonstitutionnellement'.repeat(Math.ceil(n / 25)).slice(0, n);

function enTetesApiOk(rep) {
  const h = (n) => rep.headers.get(n) || '';
  return /\bno-store\b/i.test(h('cache-control')) && /nosniff/i.test(h('x-content-type-options')) && /^application\/json/i.test(h('content-type'));
}
const resumeEnTetes = (rep) => `${rep.status} cc=« ${rep.headers.get('cache-control')} »`;

async function verifierEnTetesApi() {
  titre('API : Cache-Control: no-store, nosniff et JSON sur toutes les réponses');
  const routes = fs.readdirSync(path.join(RACINE, 'serveur', 'routes')).filter((f) => f.endsWith('.js')).map((f) => f.slice(0, -3)).sort();
  const anon = new ClientRobuste('anonyme-13', ipFictive(920001));
  controle('routes de l\'API recensées', routes.length >= 18, `${routes.length} routes`);
  for (const nom of routes) {
    const g = await anon.get(nom + '.php');
    const p = await anon.post(nom + '.php', {});
    controle(`API ${nom}.php : GET ${g.status} et POST ${p.status} sans session portent no-store, nosniff et JSON`, enTetesApiOk(g) && enTetesApiOk(p), `GET ${g.headers.get('cache-control')} / POST ${p.headers.get('cache-control')}`);
  }
  const cas = [
    ['404 route inconnue', () => anon.get('route_inconnue.php')],
    ['404 racine /api/', () => anon.get('')],
    ['404 nom invalide', () => anon.get('..%2fserveur%2fdb')],
    ['405 méthode refusée (GET sur une route POST)', () => anon.get('order_create.php')],
    ['405 OPTIONS', () => anon.request('OPTIONS', 'order_create.php')],
    ['415 type de contenu refusé', () => anon.request('POST', 'customer_login.php', { raw: 'x=1', headers: { 'Content-Type': 'text/plain' } })],
    ['400 JSON illisible', () => anon.request('POST', 'customer_login.php', { raw: '{oops', headers: { 'Content-Type': 'application/json' } })],
    ['413 corps trop volumineux', () => anon.request('POST', 'customer_login.php', { raw: '{"a":"' + 'x'.repeat(70000) + '"}', headers: { 'Content-Type': 'application/json' } })],
    ['403 origine étrangère', () => anon.request('POST', 'customer_login.php', { body: {}, origin: 'https://evil.example' })],
    ['401 sans session', () => anon.get('owner_orders.php')],
    ['422 validation', () => anon.post('customer_signup.php', {})]
  ];
  for (const [nom, f] of cas) {
    const rep = await f();
    controle(`API cas « ${nom} » : en-têtes de cache`, enTetesApiOk(rep), resumeEnTetes(rep));
  }
  const limite = new ClientRobuste('limite-13', ipFictive(920002));
  let derniere = null;
  for (let i = 0; i < 7 && (!derniere || derniere.status !== 429); i++) derniere = await limite.post('customer_login.php', { email: 'inconnu-13@example.test', password: 'Essai-limite-13-Aa1!' });
  controle('API cas « 429 trop de tentatives » : en-têtes de cache', derniere.status === 429 && enTetesApiOk(derniere), resumeEnTetes(derniere));

  const vercel = JSON.parse(fs.readFileSync(path.join(RACINE, 'vercel.json'), 'utf8'));
  const regle = (vercel.headers || []).find((h) => /\/api\//.test(h.source));
  const cc = regle && regle.headers.find((x) => x.key.toLowerCase() === 'cache-control');
  controle('vercel.json : règle d\'en-têtes pour /api/(.*) avec Cache-Control: no-store (déploiement)', !!cc && /no-store/i.test(cc.value), cc ? `${regle.source} → ${cc.value}` : 'aucune règle');
}

/** À appeler en fin de script : toutes les réponses d'API reçues par les clients HTTP du script (succès et erreurs de tous types). */
function verifierToutesLesReponsesApi() {
  const mauvaises = reponses.filter((r) => !enTetesApiOk({ headers: r.headers }));
  const statuts = {};
  for (const r of reponses) statuts[r.status] = (statuts[r.status] || 0) + 1;
  controle(`toutes les réponses d'API reçues pendant le script (${reponses.length}) portent no-store, nosniff et JSON`, mauvaises.length === 0 && reponses.length > 50,
    `statuts vus : ${Object.entries(statuts).map(([s, n]) => s + '×' + n).join(', ')}${mauvaises.length ? ' ; sans en-tête : ' + liste(mauvaises.map((r) => `${r.status} ${r.method} ${r.route}`)) : ''}`);
}

// ---------------------------------------------------------------------------------------------------------------------
// Données pour les pages dynamiques : un client aux saisies très longues et 5 commandes dans tous les états
// ---------------------------------------------------------------------------------------------------------------------
async function preparerDonnees() {
  const r = rng(1313);
  const client = new ClientRobuste('client-long-13', ipFictive(910001));
  const corps = {
    first_name: MOT(60), last_name: MOT(60).toUpperCase(),
    email: `${'a'.repeat(60)}.${'b'.repeat(60)}@${'c'.repeat(50)}.example.test`,
    phone: '06 12 34 56 78', password: 'Essai-massif-13-Aa1!', street: MOT(150), city: 'Hénin-Beaumont', housing_type: 'maison'
  };
  const s = await client.post('customer_signup.php', corps);
  if (s.status !== 201) throw new Error('Inscription du client aux saisies longues refusée : ' + s.status + ' ' + s.text.slice(0, 200));
  const patron = await C.patronConnecteRobuste('10.250.250.251');
  const note = MOT(300);
  const lignes = () => [lignePizza(r, { taille: 'Duo', qty: 2, extras: 2, retraits: 2, moitie: true, note }), ligneProduit(r, { qty: 2, note })];
  const creer = async (mode) => {
    const { body } = construireCommande(r, { mode, ville: 'Hénin-Beaumont', lignes: lignes(), paiements: mode === 'delivery' ? ['cash', 'ticket_card'] : [], billet: 50 });
    const rep = await client.post('order_create.php', body);
    if (rep.status !== 201) throw new Error(`Commande ${mode} refusée : ${rep.status} ${rep.text.slice(0, 200)}`);
    return rep.json.order.id;
  };
  const decider = async (id, corpsDecision) => {
    const rep = await patron.post('owner_order_decide.php', { id, ...corpsDecision });
    if (rep.status !== 200) throw new Error(`Décision ${JSON.stringify(corpsDecision)} refusée : ${rep.status} ${rep.text.slice(0, 200)}`);
  };
  const ids = { nouvelle: await creer('pickup'), acceptee: await creer('delivery'), prete: await creer('pickup'), refusee: await creer('pickup'), nouvelleLivraison: await creer('delivery') };
  await decider(ids.acceptee, { action: 'accept', delay_minutes: 30 });
  await decider(ids.prete, { action: 'accept', delay_minutes: 20 });
  await decider(ids.prete, { action: 'ready' });
  await decider(ids.refusee, { action: 'refuse' });
  return { client, patron, ids };
}

const ETATS_SUIVI = [
  { cle: 'nouvelle', statut: 'new', classe: 'order-track-status--pending' },
  { cle: 'acceptee', statut: 'accepted', classe: 'order-track-status--ok' },
  { cle: 'prete', statut: 'ready', classe: 'order-track-status--ready' },
  { cle: 'refusee', statut: 'refused', classe: 'order-track-status--error' }
];

async function visiterPagesDynamiques(nav, base, donnees) {
  titre('Pages dynamiques avec saisies très longues : suivi de commande (4 états) et Mon compte connecté');
  const taches = [];
  for (const e of ETATS_SUIVI) for (const vp of C.VIEWPORTS) taches.push({ type: 'suivi', e, vp });
  for (const vp of C.VIEWPORTS) taches.push({ type: 'compte', vp });
  const sorties = await enParallele(taches, CONCURRENCE, async (t) => {
    if (t.type === 'suivi') {
      const id = donnees.ids[t.e.cle];
      const capture = t.e.cle === 'acceptee' && t.vp.nom === 'mobile-390';
      return visiterAvecReprise(nav, base, `/commande.html?id=${id}`, t.vp, {
        cookies: donnees.client,
        attendre: async (page, col, v) => {
          await page.waitFor(`document.getElementById('orderTrackBody').getAttribute('data-order-status') === '${t.e.statut}'`, 12000);
          if (t.e.statut === 'accepted') await page.waitFor("/^\\d+:\\d{2}$/.test((document.getElementById('orderCountdown') || {}).textContent || '')", 6000);
          v.suivi = await page.evaluate(`(() => { const b = document.getElementById('orderTrackBody'); const st = b.querySelector('.order-track-status'); const cd = document.getElementById('orderCountdown'); return { statut: b.getAttribute('data-order-status'), classe: st ? st.className : '', compte: cd ? cd.textContent : null, texteLong: (b.querySelector('.order-track-item__details') || {}).textContent ? true : false }; })()`);
        },
        apres: capture ? async (page, col, v) => {
          const base2 = path.join(DOSSIER_CAPTURES, 'suivi-commande-390');
          v.captures = [{ fichier: base2 + '-ecran.png', octets: await capturer(page, base2 + '-ecran.png') }, { fichier: base2 + '-page.png', octets: await capturer(page, base2 + '-page.png', { pleinePage: true, largeur: t.vp.l, hauteurPage: v.analyse.hauteurPage }) }];
        } : null
      }).then((v) => ({ ...v, groupe: 'suivi:' + t.e.cle }));
    }
    return visiterAvecReprise(nav, base, '/compte.html', t.vp, {
      cookies: donnees.client,
      attendre: async (page, col, v) => {
        await page.waitFor("document.getElementById('accountLoggedIn') && !document.getElementById('accountLoggedIn').hidden && document.querySelectorAll('.account-order').length >= 5", 12000);
        v.compte = await page.evaluate("({ nom: document.getElementById('accountName').textContent.length, email: document.getElementById('accountEmail').textContent.length, commandes: document.querySelectorAll('.account-order').length })");
      }
    }).then((v) => ({ ...v, groupe: 'compte' }));
  });
  for (const e of ETATS_SUIVI) {
    const vs = C.VIEWPORTS.map((vp) => sorties.find((v) => v.groupe === 'suivi:' + e.cle && v.vp === vp.nom));
    const vsOk = vs.filter(visiteOk);
    const etiquette = `commande.html [${e.cle}]`;
    controle(`[${etiquette}] visite complète aux 4 tailles d'écran`, vsOk.length === 4, vs.filter((v) => !visiteOk(v)).map((v) => `${v.vp} : ${court(v.erreurVisite || 'analyse absente', 90)}`).join(' ; ') || '4 tailles');
    if (!vsOk.length) continue;
    controle(`[${etiquette}] le suivi affiche l'état « ${e.statut} » avec sa classe ${e.classe}${e.statut === 'accepted' ? ' et un minuteur M:SS' : ''}`,
      vsOk.every((v) => v.suivi && v.suivi.statut === e.statut && v.suivi.classe.includes(e.classe) && (e.statut !== 'accepted' || /^\d+:\d{2}$/.test(v.suivi.compte || ''))),
      vsOk.map((v) => v.suivi ? `${v.suivi.statut}${v.suivi.compte ? ' ' + v.suivi.compte : ''}` : (v.erreurAttente || '?')).join(' / '));
    evaluerIndependants(`commande.html?id=${e.cle}`, vsOk, { privee: false, complet: false });
    evaluerParTaille(etiquette, vsOk);
  }
  const vsC = C.VIEWPORTS.map((vp) => sorties.find((v) => v.groupe === 'compte' && v.vp === vp.nom));
  const okC = vsC.filter(visiteOk);
  controle('[compte.html connecté] visite complète aux 4 tailles d\'écran', okC.length === 4, vsC.filter((v) => !visiteOk(v)).map((v) => `${v.vp} : ${court(v.erreurVisite || 'analyse absente', 90)}`).join(' ; ') || '4 tailles');
  if (okC.length) {
    controle('[compte.html connecté] profil et historique affichés (5 commandes, nom de 60+60 caractères, e-mail de 185)', okC.every((v) => v.compte && v.compte.commandes === 5 && v.compte.nom >= 120 && v.compte.email >= 180), okC.map((v) => v.compte ? `${v.compte.commandes} cmd / nom ${v.compte.nom} / e-mail ${v.compte.email}` : (v.erreurAttente || '?')).join(' ; '));
    evaluerIndependants('compte.html connecté', okC, { privee: false, complet: false });
    evaluerParTaille('compte.html connecté', okC);
  }
  return sorties;
}

// ---------------------------------------------------------------------------------------------------------------------
// Service worker du commerçant, cache, et espace commerçant connecté
// ---------------------------------------------------------------------------------------------------------------------
const LIRE_ENREGISTREMENT = `(async () => {
  if (!('serviceWorker' in navigator)) return { absent: true };
  const r = await Promise.race([navigator.serviceWorker.ready, new Promise((res) => setTimeout(() => res(null), 10000))]);
  if (!r) return { enregistre: false };
  const regs = await navigator.serviceWorker.getRegistrations();
  return { enregistre: true, scope: r.scope, nb: regs.length, actif: r.active ? { url: r.active.scriptURL, etat: r.active.state } : null, installing: !!r.installing, waiting: !!r.waiting, controle: !!navigator.serviceWorker.controller };
})()`;
const LIRE_CACHES = `(async () => { const sortie = {}; for (const k of await caches.keys()) { const c = await caches.open(k); sortie[k] = (await c.keys()).map((q) => { const u = new URL(q.url); return u.pathname + u.search; }); } return sortie; })()`;
const COUVERTURE_SHELL = ['/commercant/', '/commercant/index.html', '/commercant/manifest.webmanifest', '/assets/css/commercant.css', '/assets/js/commercant.js'];

async function saisir(page, selecteur, texte) {
  await page.evaluate(`(() => { const e = document.querySelector(${JSON.stringify(selecteur)}); e.focus(); e.value = ''; return true; })()`);
  await page.send('Input.insertText', { text: texte });
}

async function verifierServiceWorker(nav, site, donnees) {
  titre('Service worker de l\'espace commerçant, cache et interface connectée');
  const base = site.base;
  const page = await nav.ouvrirPage('about:blank', { largeur: 768, hauteur: 1024, mobile: true });
  const col = await C.instrumenter(page, base);
  const ev = (expr, ms = 20000, et = 'évaluation') => C.evaluerAvecDelai(page, expr, ms, et);
  const resultats = { captures: [] };
  try {
    await page.navigate(base + '/commercant/', 300);
    // Repartir d'un état vierge (les visites précédentes ont déjà enregistré le service worker dans ce navigateur)
    await ev(`(async () => { for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister(); for (const k of await caches.keys()) await caches.delete(k); return true; })()`);
    col.vider();
    await page.navigate(base + '/commercant/', 300);
    const reg = await ev(LIRE_ENREGISTREMENT, 20000, 'service worker prêt');
    controle('service worker : enregistré et actif après le chargement de /commercant/', reg.enregistre === true && !!reg.actif && reg.actif.etat === 'activated', `enregistré=${reg.enregistre} état=${reg.actif && reg.actif.etat} installation=${reg.installing} attente=${reg.waiting}`);
    controle('service worker : portée = /commercant/ (et rien de plus large)', reg.scope === base + '/commercant/', `scope=${reg.scope}`);
    controle('service worker : script = /commercant/sw.js, un seul enregistrement', !!reg.actif && reg.actif.url === base + '/commercant/sw.js' && reg.nb === 1, `script=${reg.actif && reg.actif.url} enregistrements=${reg.nb}`);
    const manif = JSON.parse((await C.recuperer(base + '/commercant/manifest.webmanifest')).corps.toString('utf8'));
    controle('service worker : portée identique à celle du manifeste', new URL(manif.scope, base).href === reg.scope, `manifeste ${manif.scope} / service worker ${reg.scope}`);

    await sleep(600);
    let caches1 = await ev(LIRE_CACHES, 15000, 'lecture des caches');
    const noms = Object.keys(caches1);
    const entrees1 = noms.flatMap((n) => caches1[n]);
    controle('cache du service worker : seulement des caches « subito-commercant-* »', noms.length >= 1 && noms.every((n) => n.startsWith('subito-commercant-')), noms.join(', ') || '(aucun cache)');
    controle('cache du service worker : la coquille statique (5 fichiers) est en cache, rien d\'autre', COUVERTURE_SHELL.every((c) => entrees1.includes(c)) && entrees1.every((e) => COUVERTURE_SHELL.includes(e)), `${entrees1.length} entrée(s) : ${entrees1.join(', ')}`);

    // Page contrôlée par le service worker
    await page.navigate(base + '/commercant/', 300);
    await page.waitFor("!document.getElementById('boot') || document.getElementById('boot').hidden", 8000).catch(() => {});
    const ctl = await ev('({ controle: !!navigator.serviceWorker.controller, url: navigator.serviceWorker.controller && navigator.serviceWorker.controller.scriptURL })');
    controle('service worker : la page /commercant/ est contrôlée après rechargement', ctl.controle === true, `contrôleur=${ctl.url}`);

    // Connexion par l'interface (code patron fabriqué par le harnais), puis trafic d'API
    await page.waitFor("!document.getElementById('login-view').hidden", 8000);
    await saisir(page, '#login-password', site.codePatron);
    await ev("document.getElementById('login-submit').click()");
    await page.waitFor("!document.getElementById('app-top').hidden && !document.getElementById('main').hidden", 10000);
    controle('espace commerçant : connexion par l\'interface réussie (code d\'essai), application affichée', true, 'app-top et main visibles');
    await page.waitFor("document.querySelectorAll('#queue .qchip[data-action=\"select\"]').length >= 2", 10000).catch(() => {});
    const file = await ev("({ chips: document.querySelectorAll('#queue .qchip[data-action=\"select\"]').length, prep: document.querySelectorAll('#prep-queue [data-action=\"prep-open\"]').length, detail: document.getElementById('order-detail').textContent.length })");
    controle('espace commerçant : la file affiche les commandes en attente (2) et la bande « en préparation » (1)', file.chips === 2 && file.prep === 1 && file.detail > 50, `en attente=${file.chips} en préparation=${file.prep} détail=${file.detail} car.`);
    for (const v of ['avail', 'patron', 'orders']) { await ev(`document.querySelector('[data-action="view"][data-view="${v}"]').click()`); await sleep(500); }
    // quelques sondages de plus + appels explicites
    await sleep(4500);
    const explicite = await ev(`(async () => {
      const urls = ['/api/availability.php', '/api/owner_me.php', '/api/owner_orders.php'];
      const sortie = [];
      for (let i = 0; i < 2; i++) for (const u of urls) { const r = await fetch(u); sortie.push({ u, statut: r.status, cc: r.headers.get('cache-control') }); }
      const enCache = [];
      for (const u of urls) { if (await caches.match(u)) enCache.push(u); }
      return { sortie, enCache };
    })()`);
    controle('API appelée depuis la page contrôlée par le service worker : no-store sur chaque réponse, rien dans le cache', explicite.sortie.every((s) => s.statut === 200 && /no-store/i.test(s.cc || '')) && explicite.enCache.length === 0, `${explicite.sortie.length} appels : ${explicite.sortie.map((s) => s.statut).join('/')} ; en cache : ${explicite.enCache.length}`);
    const api = col.resume().api;
    const parRoute = {};
    for (const r of api) { const n = cheminDe(r.url); parRoute[n] = (parRoute[n] || 0) + 1; }
    controle('requêtes /api/ de la session : aucune n\'est servie par le service worker', api.length >= 6 && api.every((r) => r.depuisSW === false), `${api.length} requêtes (${Object.entries(parRoute).map(([k, n]) => k.replace('/api/', '') + '×' + n).join(', ')}) ; servies par le service worker : ${api.filter((r) => r.depuisSW).length}`);
    controle('requêtes /api/ de la session : toutes en Cache-Control: no-store', api.every((r) => /no-store/i.test(C.entete(r.entetes, 'cache-control') || '')), `${api.filter((r) => !/no-store/i.test(C.entete(r.entetes, 'cache-control') || '')).map((r) => cheminDe(r.url)).join(', ') || 'toutes'}`);
    const shellServi = col.resume().locales.filter((r) => /\/commercant\/|commercant\.(css|js)/.test(r.url) && !/\/api\//.test(r.url));
    info(`coquille statique chargée via le service worker : ${shellServi.filter((r) => r.depuisSW).length}/${shellServi.length} requêtes`);
    const caches2 = await ev(LIRE_CACHES, 15000, 'lecture des caches');
    const entrees2 = Object.values(caches2).flat();
    controle('cache du service worker après connexion et sondages : aucune réponse /api/ en cache', !entrees2.some((e) => /\/api\//.test(e)) && entrees2.every((e) => COUVERTURE_SHELL.includes(e)), `${entrees2.length} entrée(s) : ${entrees2.join(', ')}`);

    // Interface connectée : débordement horizontal par onglet et par taille d'écran, avec les commandes aux saisies longues
    for (const vue of ['orders', 'avail', 'patron']) {
      await ev(`document.querySelector('[data-action="view"][data-view="${vue}"]').click()`);
      for (const vp of C.VIEWPORTS) {
        await page.cdp.setViewport(vp.l, vp.h, vp.mobile);
        await sleep(450);
        const a = await ev(C.enExpression(C.analyserPage, { largeur: vp.l }), 30000, 'analyse commerçant');
        const dep = a.debord.depasse;
        controle(`[commercant connecté : onglet ${vue} @ ${vp.nom}] pas de défilement horizontal`, dep <= 0,
          dep <= 0 ? `scrollWidth ${a.debord.scrollWidth} <= ${vp.l} px` : `dépasse de ${dep} px (scrollWidth ${a.debord.scrollWidth} pour ${vp.l} px) ; éléments : ${a.debord.fautifs.slice(0, 3).map((f) => `${f.el} [${f.gauche}→${f.droite}]`).join(', ')}`);
        if (vue === 'orders' && vp.nom === 'tablette-768') {
          const f = path.join(DOSSIER_CAPTURES, 'commercant-connecte-768.png');
          resultats.captures.push({ fichier: f, octets: await capturer(page, f) });
          controle('[commercant connecté : onglet orders @ tablette-768] titres et champs : un seul h1 visible, champs étiquetés', a.h1.visibles === 1 && a.champs.every((c) => c.via), `h1=${a.h1.visibles} champs=${a.champs.length}`);
        }
      }
    }
    await page.cdp.setViewport(768, 1024, true);
    const e = col.etat;
    const erreursJs = [...e.exceptions, ...e.consoleErreurs];
    const jp = e.journal.filter((j) => !(j.url && !estLocalUrl(j.url)) && !(/\/api\/owner_me\.php$/.test(cheminDe(j.url || '')) && /401/.test(j.texte)));
    controle('espace commerçant connecté : aucune exception JavaScript ni console.error pendant toute la session', erreursJs.length === 0 && jp.length === 0, erreursJs.length || jp.length ? liste([...erreursJs, ...jp.map((j) => j.texte)], 3) : `0 (avertissements : ${e.consoleAvert.length})`);
    const echecs = col.resume().echecs.filter((r) => !(/\/api\/owner_me\.php$/.test(cheminDe(r.url)) && r.statut === 401));
    controle('espace commerçant connecté : aucune requête locale en échec pendant toute la session', echecs.length === 0, echecs.length ? liste(echecs.map((r) => `${r.statut ?? r.echec} ${cheminDe(r.url)}`)) : `${col.resume().nbRequetes} requêtes`);
  } finally {
    try { await page.fermer(); } catch { /* déjà fermé */ }
  }

  // Les pages publiques ne sont pas contrôlées par le service worker du commerçant
  const publics = await enParallele(['/index.html', '/commande.html', '/menu.html'], 3, async (chemin) => {
    const p = await nav.ouvrirPage('about:blank', { largeur: 390, hauteur: 844, mobile: true });
    await C.instrumenter(p, base);
    try {
      await p.navigate(base + chemin, 300);
      await sleep(500);
      return { chemin, ...(await C.evaluerAvecDelai(p, `(async () => ({ controle: !!navigator.serviceWorker.controller, scopes: (await navigator.serviceWorker.getRegistrations()).map((r) => r.scope) }))()`, 10000)) };
    } finally { try { await p.fermer(); } catch { /* ignoré */ } }
  });
  controle('portée du service worker : les pages publiques ne sont pas contrôlées', publics.every((p) => p.controle === false && p.scopes.every((s) => s === base + '/commercant/')), publics.map((p) => `${p.chemin} contrôlée=${p.controle} registres=[${p.scopes.map((s) => s.replace(base, '')).join(',')}]`).join(' ; '));
  return resultats;
}

// ---------------------------------------------------------------------------------------------------------------------
// Mesures : poids et temps de chargement
// ---------------------------------------------------------------------------------------------------------------------
function mesures(visites) {
  titre('Mesures : poids et temps de chargement (premier chargement, sans défilement)');
  const lignes = [];
  for (const p of PAGES) for (const v of visites.get(p) || []) {
    if (!visiteOk(v)) continue;
    const gros = v.naturel.locales.filter((r) => r.fini && !r.echec).sort((a, b) => C.poidsReponse(b) - C.poidsReponse(a))[0];
    lignes.push({
      page: p, vp: v.vp, octets: v.naturel.octets, octetsTotal: v.reseau.octets, req: v.naturel.nbRequetes, reqTotal: v.reseau.nbRequetes,
      load: v.analyse.perf.load, dcl: v.analyse.perf.dcl, fcp: v.analyse.perf.fcp, lcp: v.analyse.perf.lcp, cls: v.analyse.perf.cls,
      plusGros: gros ? { url: cheminDe(gros.url), octets: C.poidsReponse(gros) } : null
    });
  }
  const mobile = lignes.filter((l) => l.vp === 'mobile-390');
  info('Page'.padEnd(26) + 'Poids (chargement)'.padEnd(20) + 'Poids (tout défilé)'.padEnd(21) + 'Req'.padEnd(6) + 'load'.padEnd(9) + 'FCP'.padEnd(8) + 'LCP'.padEnd(8) + 'CLS');
  for (const l of [...mobile].sort((a, b) => b.octets - a.octets)) {
    info(l.page.padEnd(26) + C.mo(l.octets).padEnd(20) + C.mo(l.octetsTotal).padEnd(21) + String(l.req).padEnd(6) + C.ms(l.load).padEnd(9) + C.ms(l.fcp).padEnd(8) + C.ms(l.lcp).padEnd(8) + l.cls);
  }
  const lourdes = [...lignes].sort((a, b) => b.octetsTotal - a.octetsTotal);
  const parPage = new Map();
  for (const l of lourdes) if (!parPage.has(l.page)) parPage.set(l.page, l);
  info('5 pages les plus lourdes (toutes images chargées, taille d\'écran la plus lourde) : ' + [...parPage.values()].slice(0, 5).map((l) => `${l.page} ${C.mo(l.octetsTotal)} (${l.vp})`).join(' ; '));
  const lentes = [...lignes].filter((l) => l.load !== null).sort((a, b) => b.load - a.load);
  info('5 chargements les plus longs (événement load) : ' + lentes.slice(0, 5).map((l) => `${l.page} ${l.load} ms (${l.vp})`).join(' ; '));
  const gros = lignes.filter((l) => l.plusGros).sort((a, b) => b.plusGros.octets - a.plusGros.octets);
  info('ressource locale la plus lourde : ' + (gros[0] ? `${gros[0].plusGros.url} ${C.ko(gros[0].plusGros.octets)} (${gros[0].page})` : 'n/a'));
  return { lignes, mobile, parPage: [...parPage.values()], lentes };
}

function controlerBudgets(m) {
  const trop = m.lignes.filter((l) => l.octets > 3 * 1048576);
  controle('poids au premier chargement <= 3 Mo, à chaque page et chaque taille d\'écran', trop.length === 0, trop.length ? liste(trop.map((l) => `${l.page} ${l.vp} ${C.mo(l.octets)}`)) : `maximum ${C.mo(Math.max(...m.lignes.map((l) => l.octets)))} (${m.lignes.slice().sort((a, b) => b.octets - a.octets)[0].page})`);
  const lentes = m.lignes.filter((l) => l.load === null || l.load > 10000);
  controle('chargement complet (événement load) en moins de 10 s, à chaque page et chaque taille d\'écran', lentes.length === 0, lentes.length ? liste(lentes.map((l) => `${l.page} ${l.vp} ${l.load} ms`)) : `maximum ${Math.max(...m.lignes.map((l) => l.load || 0))} ms`);
  const cls = m.lignes.filter((l) => l.cls !== null && l.cls > 0.25);
  controle('décalage de mise en page cumulé (CLS) <= 0,25, à chaque page et chaque taille d\'écran', cls.length === 0, cls.length ? liste(cls.map((l) => `${l.page} ${l.vp} CLS ${l.cls}`)) : `maximum ${Math.max(...m.lignes.map((l) => l.cls || 0))}`);
  const lourdes = m.lignes.filter((l) => l.plusGros && l.plusGros.octets > 500 * 1024);
  controle('aucune ressource locale de plus de 500 Ko au premier chargement', lourdes.length === 0, lourdes.length ? liste(lourdes.map((l) => `${l.plusGros.url} ${C.ko(l.plusGros.octets)}`)) : `plus lourde : ${C.ko(Math.max(...m.lignes.map((l) => (l.plusGros ? l.plusGros.octets : 0))))}`);
}

function verifierCaptures(visites, supplementaires) {
  titre('Captures d\'écran (mobile 390x844)');
  const toutes = [];
  for (const [, vs] of visites) for (const v of vs) if (v.captures) toutes.push(...v.captures);
  toutes.push(...supplementaires);
  for (const c of toutes) controle(`capture ${path.basename(c.fichier)}`, fs.existsSync(c.fichier) && c.octets > 8000, `${(c.octets / 1024).toFixed(0)} Ko`);
  info(`captures écrites dans ${DOSSIER_CAPTURES}`);
  const ecran = toutes.filter((c) => /-ecran\.png$/.test(c.fichier)).map((c) => path.basename(c.fichier).replace('-390-ecran.png', ''));
  controle('captures des 4 pages principales en mobile : accueil, menu, compte, suivi de commande', ['index', 'menu', 'compte', 'suivi-commande'].every((n) => ecran.includes(n)), ecran.join(', '));
}

// ---------------------------------------------------------------------------------------------------------------------
// Programme principal
// ---------------------------------------------------------------------------------------------------------------------
const minuteurGlobal = setTimeout(() => {
  console.log(`\nFAIL  délai global de ${DELAI_GLOBAL_MS / 1000} s dépassé : arrêt du script`);
  console.log(`RESUME  ${nbPass + nbFail + 1} contrôles : ${nbPass} réussis, ${nbFail + 1} échoués`);
  process.exit(1);
}, DELAI_GLOBAL_MS);
minuteurGlobal.unref();

const site = await demarrerSite();
ORIGINE = new URL(site.base).origin;
try {
  titre('Inventaire');
  info(`${PAGES.length} pages : ${PAGES.join(', ')}`);
  info(`site local ${site.base} ; navigateur : ${CONCURRENCE} onglets simultanés au plus ; tout hôte non local est refusé`);
  controle('inventaire : toutes les pages publiées de la racine + espace commerçant', PAGES.length >= 13 && PAGES.includes('index.html') && PAGES.includes('menu.html') && PAGES.includes('commercant/index.html'), `${PAGES.length} pages`);
  fs.mkdirSync(DOSSIER_CAPTURES, { recursive: true });

  const visites = new Map(); // page -> [visite par taille]
  let supplementaires = [];
  await avecNavigateur(async (nav) => {
    titre('Visites : toutes les pages x 4 tailles d\'écran');
    const taches = [];
    for (const p of PAGES) for (const vp of C.VIEWPORTS) taches.push({ p, vp });
    const t0 = Date.now();
    const sorties = await enParallele(taches, CONCURRENCE, async ({ p, vp }) => {
      const capture = PAGES_CAPTURE.includes(p) && vp.nom === 'mobile-390';
      return visiterAvecReprise(nav, site.base, '/' + p, vp, {
        apres: capture ? async (page, col, v) => {
          const b = path.join(DOSSIER_CAPTURES, nomFichier(p) + '-390');
          v.captures = [
            { fichier: b + '-ecran.png', octets: await capturer(page, b + '-ecran.png') },
            { fichier: b + '-page.png', octets: await capturer(page, b + '-page.png', { pleinePage: true, largeur: vp.l, hauteurPage: v.analyse.hauteurPage }) }
          ];
        } : null
      });
    });
    info(`${sorties.length} visites en ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    for (const v of sorties) {
      const p = v.cible.slice(1);
      if (!visites.has(p)) visites.set(p, []);
      visites.get(p).push(v);
    }
    for (const p of PAGES) {
      titre(`Page ${p}`);
      evaluerPage(p, C.VIEWPORTS.map((vp) => visites.get(p).find((v) => v.vp === vp.nom)));
    }

    await verifierLiens(site.base, visites);
    titre('Fichiers référencés par les pages');
    await verifierBalisesLink(site.base, visites);
    await verifierReferencesStatiques(site.base, visites);
    await verifierFichiersSite(site.base);
    await verifierEnTetesApi();

    const donnees = await preparerDonnees();
    const dyn = await visiterPagesDynamiques(nav, site.base, donnees);
    for (const v of dyn) { if (v.captures) supplementaires.push(...v.captures); }
    const sw = await verifierServiceWorker(nav, site, donnees);
    supplementaires.push(...sw.captures);
    verifierToutesLesReponsesApi();
    const m = mesures(visites);
    controlerBudgets(m);
  }, { pagesMax: CONCURRENCE });

  verifierCaptures(visites, supplementaires);
  console.log('\nJournal du serveur : ' + (site.journal().trim() || '(vide)'));
} catch (err) {
  controle('exécution du script sans erreur interne', false, err && err.stack ? err.stack.split('\n').slice(0, 4).join(' | ') : String(err));
} finally {
  site.arreter();
}

titre('Résumé');
console.log(`RESUME  ${nbPass + nbFail} contrôles : ${nbPass} réussis, ${nbFail} échoués, durée ${((Date.now() - DEBUT) / 1000).toFixed(1)} s`);
if (nbFail) { console.log('Échecs :'); for (const l of lignesFail) console.log('  - ' + l); }
process.exit(nbFail === 0 ? 0 : 1);
