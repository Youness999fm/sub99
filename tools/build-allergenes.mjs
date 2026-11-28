#!/usr/bin/env node
// Génère allergenes.html — la page publique « Nos allergènes ».
//
// La coquille (head, en-tête, navigation, pied de page) est RECOPIÉE depuis
// faq.html : la page ne peut donc jamais diverger du reste du site, et une
// modification future de l'en-tête ou du pied de page se propage ici d'un
// simple `node tools/build-allergenes.mjs`.
//
// Le contenu est écrit en dur dans le HTML (pas rendu par JavaScript) : la page
// reste lisible sans JS, référençable, et accessible. Le JS ne sert qu'à la
// recherche et aux filtres, qui sont du confort.
//
// Usage : node tools/build-allergenes.mjs            → écrit allergenes.html
//         node tools/build-allergenes.mjs --check     → vérifie qu'il est à jour
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = process.argv.includes('--check');
const SORTIE = path.join(ROOT, 'allergenes.html');

/* ---------- 1. Charger les données et les pictogrammes (modules navigateur) ---------- */
function chargerModuleNavigateur(relatif, cle) {
  const contexte = { window: {} };
  vm.createContext(contexte);
  vm.runInContext(readFileSync(path.join(ROOT, relatif), 'utf8'), contexte);
  return contexte.window[cle];
}
const D = chargerModuleNavigateur('assets/js/allergenes/donnees.js', 'SubitoAllergenes');
const P = chargerModuleNavigateur('assets/js/allergenes/pictos.js', 'SubitoAllergenePictos');

/* ---------- 2. Lire la carte réelle : noms exacts, dans l'ordre du menu ---------- */
const menu = readFileSync(path.join(ROOT, 'menu.html'), 'utf8');

const LIBELLE_CATEGORIE = {
  pizzas: 'Pizzas',
  pates: 'Pâtes',
  subitowichs: 'Subitowichs',
  texmex: 'Tex-Mex',
  salades: 'Salades',
  desserts: 'Desserts'
};
const ID_DOM_VERS_CLE = { pizzas: 'pizzas', pates: 'pates', subitowichs: 'subitowichs', 'tex-mex': 'texmex', salades: 'salades', desserts: 'desserts' };

function produitsDuMenu() {
  const parCategorie = {};
  const sections = menu.split(/<section class="menu-category" id="/).slice(1);
  for (const bloc of sections) {
    const id = bloc.slice(0, bloc.indexOf('"'));
    const cle = ID_DOM_VERS_CLE[id];
    if (!cle) continue;
    const noms = [];
    const re = /<h[23][^>]*class="[^"]*menu-item__name[^"]*"[^>]*>([\s\S]*?)<\/h[23]>/g;
    let m;
    while ((m = re.exec(bloc))) noms.push(m[1].replace(/<[^>]*>/g, '').trim());
    parCategorie[cle] = noms;
  }
  return parCategorie;
}

/* ---------- 3. Fabriquer le contenu ---------- */
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const MOTS_FROMAGE = /fromage|mozzarella|brie|bleu|parmesan|ch[eè]vre|maroilles|reblochon|mascarpone|raclette/i;

function ingredientsDe(nom) {
  // Récupère la ligne d'ingrédients affichée sur la carte, pour savoir si le
  // produit contient du fromage (décide l'affichage de la mention pasteurisé).
  const i = menu.indexOf('>' + nom + '<');
  if (i === -1) return '';
  const suite = menu.slice(i, i + 600);
  const m = /class="menu-item__ingredients"[^>]*>([\s\S]*?)<\/p>/.exec(suite);
  return m ? m[1].replace(/<[^>]*>/g, ' ') : '';
}

function ficheProduit(nom, cles) {
  const puces = cles.map((cle) => {
    const cat = D.CATEGORIES[cle];
    return cat ? `<li class="subito-allergen__item">${P.svg(cle)}<span>${esc(cat.nom)}</span></li>` : '';
  }).join('');
  const fromage = MOTS_FROMAGE.test(ingredientsDe(nom))
    ? `<p class="subito-allergen__fromage"><svg class="subito-allergen-picto" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.5 5 6v5.5c0 4 3 7.6 7 9 4-1.4 7-5 7-9V6l-7-2.5Z"/><path d="m9.2 12 2 2 3.6-3.8"/></svg><span>${esc(D.MENTION_FROMAGE)}</span></p>`
    : '';
  return `        <details class="subito-allergen subito-allergen--page" data-nom="${esc(nom.toLowerCase())}">
          <summary class="subito-allergen__resume"><span class="subito-allergen__label">${esc(nom)}</span><svg class="subito-allergen__chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></summary>
          <div class="subito-allergen__contenu">
            <ul class="subito-allergen__liste">${puces}</ul>
${fromage ? '            ' + fromage + '\n' : ''}          </div>
        </details>`;
}

function contenu() {
  const duMenu = produitsDuMenu();
  const sections = [];
  let documentes = 0;
  const nonDocumentes = [];

  for (const [cle, libelle] of Object.entries(LIBELLE_CATEGORIE)) {
    const noms = duMenu[cle] || [];
    const fiches = [];
    for (const nom of noms) {
      const cles = D.allergenesDe(cle, nom);
      if (cles) { fiches.push(ficheProduit(nom, cles)); documentes++; }
      else nonDocumentes.push(libelle + ' — ' + nom);
    }
    if (!fiches.length) continue;
    sections.push(`      <section class="subito-allergen-page__cat" data-categorie="${cle}">
        <h2 class="subito-allergen-page__cat-titre">${esc(libelle)}</h2>
${fiches.join('\n')}
      </section>`);
  }

  const legende = Object.entries(D.CATEGORIES).map(([cle, cat]) =>
    `          <li class="subito-allergen__item">${P.svg(cle)}<span>${esc(cat.nom)}</span></li>`).join('\n');

  const filtres = ['<button type="button" class="subito-allergen-page__filtre is-actif" data-filtre="tout">Tout</button>']
    .concat(Object.entries(LIBELLE_CATEGORIE)
      .filter(([cle]) => (duMenu[cle] || []).some((n) => D.allergenesDe(cle, n)))
      .map(([cle, lib]) => `<button type="button" class="subito-allergen-page__filtre" data-filtre="${cle}">${esc(lib)}</button>`))
    .join('\n        ');

  return { documentes, nonDocumentes, html: `<main id="main-content" tabindex="-1">
  <section class="subito-allergen-page">
    <h1 class="section-title">Nos allergènes</h1>
    <p class="subito-allergen-page__sous-titre">Le goût en toute transparence.</p>
    <p class="section-intro">Parce que votre confiance compte autant que votre plaisir, retrouvez les informations relatives aux allergènes présents dans nos recettes.</p>

    <div class="subito-allergen-page__outils">
      <label class="subito-allergen-page__recherche">
        <span class="visually-hidden">Rechercher un produit</span>
        <svg class="subito-allergen-page__loupe" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
        <input type="search" id="allergenRecherche" placeholder="Rechercher un produit…" autocomplete="off">
      </label>
      <div class="subito-allergen-page__filtres" role="group" aria-label="Filtrer par catégorie">
        ${filtres}
      </div>
    </div>

    <p class="subito-allergen-page__vide" id="allergenVide" hidden>Aucun produit ne correspond à votre recherche.</p>

${sections.join('\n')}

    <details class="subito-allergen subito-allergen--page subito-allergen--engagement">
      <summary class="subito-allergen__resume"><span class="subito-allergen__label">Notre engagement qualité</span><svg class="subito-allergen__chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></summary>
      <div class="subito-allergen__contenu">
        <p class="subito-allergen__fromage"><svg class="subito-allergen-picto" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.5 5 6v5.5c0 4 3 7.6 7 9 4-1.4 7-5 7-9V6l-7-2.5Z"/><path d="m9.2 12 2 2 3.6-3.8"/></svg><span>${esc(D.MENTION_FROMAGE)}</span></p>
        <p class="subito-allergen__note">Le lait reste un allergène à déclarer : la pasteurisation ne le supprime pas.</p>
      </div>
    </details>

    <details class="subito-allergen subito-allergen--page">
      <summary class="subito-allergen__resume"><span class="subito-allergen__label">Les 14 catégories réglementaires</span><svg class="subito-allergen__chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></summary>
      <div class="subito-allergen__contenu">
        <ul class="subito-allergen__liste">
${legende}
        </ul>
        <p class="subito-allergen__note">Pictogrammes créés pour ce site afin d'aider à la lecture : ce ne sont pas des symboles réglementaires officiels. Le nom écrit à côté de chacun fait seul référence.</p>
      </div>
    </details>

    <p class="subito-allergen-page__avis">Les informations présentées concernent les allergènes identifiés dans nos recettes. Notre cuisine manipule différents ingrédients allergènes. Des contaminations croisées restent possibles. Pour toute question relative à une allergie ou une intolérance alimentaire, notre équipe reste à votre disposition.</p>

    <p class="subito-allergen-page__retour"><a class="btn-outline" href="menu.html">Retour à la carte</a></p>
  </section>
</main>` };
}

/* ---------- 4. Assembler avec la coquille de faq.html ---------- */
const faq = readFileSync(path.join(ROOT, 'faq.html'), 'utf8');
const avant = faq.slice(0, faq.indexOf('<main id="main-content"'));

/* Version de cache lue sur la page modèle, pour que allergenes.html suive
   automatiquement les autres pages à chaque déploiement. */
const versionAssets = (/style\.min\.css\?v=([0-9a-z]+)/.exec(faq) || [, '1'])[1];
const apres = faq.slice(faq.indexOf('</main>') + '</main>'.length);

const { html: principal, documentes, nonDocumentes } = contenu();

const tete = avant
  .replace(/<title>[\s\S]*?<\/title>/, '<title>Nos allergènes — Subito Pizza Hénin-Beaumont</title>')
  .replace(/(<meta name="description" content=")[^"]*(">)/, '$1Allergènes présents dans les recettes Subito Pizza à Hénin-Beaumont. Tous nos fromages sont élaborés à partir de lait pasteurisé.$2')
  .replace(/(<meta property="og:title" content=")[^"]*(">)/, '$1Nos allergènes — Subito Pizza Hénin-Beaumont$2')
  .replace(/(<meta property="og:description" content=")[^"]*(">)/, '$1Le goût en toute transparence.$2')
  .replace(/(<meta property="og:url" content="[^"]*\/)faq\.html(">)/, '$1allergenes.html$2')
  .replace(/(<link rel="canonical" href="[^"]*\/)faq\.html(">)/, '$1allergenes.html$2')
  /* La page a besoin des styles de l'accordéon ; le JS de recherche lui est propre.
     La version est reprise de la page modèle (28/11/2026) : elle était écrite en
     dur, donc figée — la page générée gardait un vieux ?v= que les navigateurs
     continuaient de servir depuis leur cache après un déploiement. */
  .replace('</head>', `<link rel="stylesheet" href="assets/css/allergenes.min.css?v=${versionAssets}">\n<script src="assets/js/allergenes/page.js?v=${versionAssets}" defer></script>\n</head>`)
  /* Retire les blocs JSON-LD de la FAQ, qui ne décrivent pas cette page. */
  .replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>\s*/g, '');

const html = tete + principal + apres;

if (CHECK) {
  const actuel = existsSync(SORTIE) ? readFileSync(SORTIE, 'utf8') : null;
  if (actuel !== html) {
    console.error('allergenes.html n’est plus à jour — relancer : node tools/build-allergenes.mjs');
    process.exit(1);
  }
  console.log('allergenes.html est à jour.');
} else {
  writeFileSync(SORTIE, html);
  console.log(`allergenes.html écrit — ${documentes} produits documentés.`);
  if (nonDocumentes.length) {
    console.log(`${nonDocumentes.length} produits sans donnée (volontairement absents de la page) :`);
    nonDocumentes.forEach((n) => console.log('  - ' + n));
  }
}
