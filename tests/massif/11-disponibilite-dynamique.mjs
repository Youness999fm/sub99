// Batterie 11 — disponibilité des produits en direct (API, puis navigateur réel).
//   node tests/massif/lancer.mjs tests/massif/11-disponibilite-dynamique.mjs --timeout=480
// Options (développement seulement) : --phases=temps,api,flip,nav  (défaut : toutes)
//
// Le patron déclare des pizzas, produits et ingrédients indisponibles (owner_availability : out_manual, out_today, available) ;
// le public lit availability. Ce script vérifie :
//   temps : out_today expire au changement de jour parisien (heure d'été, d'hiver, jours de changement d'heure), out_manual reste ;
//   api   : refus 422 unavailable_items avec les noms, correspondance des noms, balayage complet pizzas / produits / ingrédients
//           de la tablette, écritures concurrentes, rafale de 100 clients, rejeu ;
//   flip  : 100 clients commandent pendant que le patron bascule en continu : aucune commande invalide enregistrée ;
//   nav   : menu.html grisé, mise à jour sans rechargement (mesure), panier rempli puis article indisponible, tablette.
import { demarrerSite } from './lib/env.mjs';
import { creerClients, patronConnecte, enParallele, ClientIP } from './lib/clients.mjs';
import { definirAdresse } from './lib/commandes.mjs';
import { catalogue } from '../../serveur/catalogue.js';
import {
  ctl, mesure, titre, bilan, court, attendre, maintenant, epoch, jourParis, norme, nomBase,
  ligne, corps, envoyer, resume, estRefusDispo, memeListe, lignesCatalogue, causes, nomAttendu, ligneStockeeCauses,
  menuTablette, produitsTablette, ingredientsTablette, bascule, pose, anonyme, lirePublic, toutRemettre,
  Chronologie, demarrerBascules, percentile, fetchResilient
} from './lib/11-dispo.mjs';
import { phaseNavigateur } from './lib/11-nav.mjs';

const DEBUT = Date.now();
const reessaisReseau = fetchResilient();
const arg =(nom) => { const a = process.argv.find((x) => x.startsWith('--' + nom + '=')); return a ? a.slice(nom.length + 3) : ''; };
const PHASES = new Set((arg('phases') || 'temps,api,flip,nav').split(','));
const sec = () => ((Date.now() - DEBUT) / 1000).toFixed(1) + ' s';

/** Exécute une phase ; une exception devient un FAIL sans empêcher les phases suivantes. */
async function proteger(nom, fn) {
  try { await fn(); } catch (e) { ctl(`${nom} : phase menée à son terme sans exception`, false, (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : String(e))); }
}

/* =====================================================================================================================
 * Phase « temps » : out_today expire à minuit (Paris), out_manual reste. Voyage dans le temps : l'heure du SERVEUR seulement.
 * ===================================================================================================================== */
async function phaseTemps() {
  titre('TEMPS — out_today / out_manual au fil des jours parisiens (voyage dans le temps du serveur)');
  // Dates : l'année SUIVANTE (calculée), pour que l'heure fictive du serveur reste dans le futur du poste : le client HTTP du
  // harnais écarte les cookies dont « Expires » est déjà passé d'après l'horloge réelle. Changements d'heure européens : le dernier
  // dimanche de mars et d'octobre, à 01:00 UTC.
  const A = Number(jourParis(Math.floor(Date.now() / 1000)).slice(0, 4)) + 1;
  const dernierDimanche = (annee, mois) => { const d = new Date(Date.UTC(annee, mois, 0)); d.setUTCDate(d.getUTCDate() - d.getUTCDay()); return d.toISOString().slice(0, 10); };
  const jourPlus = (jour, n) => new Date(Date.parse(jour + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
  const D = dernierDimanche(A, 3); // printemps : 02:00 -> 03:00, journée de 23 h
  const F = dernierDimanche(A, 10); // automne : 03:00 -> 02:00, journée de 25 h
  const E = `${A}-07-14`; // été
  const N = `${A}-11-19`; // scénario complet
  const Z = (jour, hms) => `${jour}T${hms}Z`;
  mesure('scénario du temps', `année fictive ${A} : changement de printemps le ${D}, d'automne le ${F}`);
  const site = await demarrerSite({ horloge: epoch(Z(jourPlus(D, -1), '22:00:00')) });
  try {
    const client = (await creerClients(1, { concurrence: 1, prefixe: 'temps' }))[0];
    let patron = await patronConnecte('10.251.0.1', true);
    const pub = anonyme();
    const ouvrir = async () => {
      // Les sessions durent 30 jours : après un grand saut, on se reconnecte (le client et le patron).
      patron = await patronConnecte('10.251.0.1', true);
      const r = await client.post('customer_login.php', { email: client.email, password: client.password });
      if (r.status !== 200) throw new Error('Reconnexion du client impossible : ' + r.status + ' ' + r.text);
    };
    const aller = (iso) => { site.fixerHeure(epoch(iso)); site.db.exec('DELETE FROM throttle'); };

    // Sondes : une commande d'une ligne chacune. « refuse » = 422 unavailable_items, « accepte » = 201.
    const SONDES = {
      'Régina': () => ligne('Régina', 'Solo'),
      'Kebab': () => ligne('Kebab', 'Solo'),
      'Napolitaine': () => ligne('Napolitaine', 'Solo'),
      'Neptune (thon)': () => ligne('Neptune', 'Solo'),
      'Calzone — Thon': () => ligne('Calzone (soufflée) — Thon', 'Solo'),
      'Chèvre miel (miel)': () => ligne('Chèvre miel', 'Solo'),
      'Canette Oasis pomme poire': () => ligne('Canette Oasis pomme poire', ''),
      'Tiramisubito Oreo': () => ligne('Dessert Tiramisubito Oreo', ''),
      'Végétarienne (témoin)': () => ligne('Végétarienne', 'Solo')
    };
    async function sonder(attendu) {
      const ecarts = [];
      const vus = {};
      for (const [nom, f] of Object.entries(SONDES)) {
        const voulu = attendu.includes(nom) ? 'refuse' : 'accepte';
        const r = await envoyer(client, [f()]);
        const obtenu = estRefusDispo(r) ? 'refuse' : (r.status === 201 ? 'accepte' : 'autre ' + r.status);
        vus[nom] = obtenu === 'refuse' ? 422 : r.status;
        if (obtenu !== voulu) ecarts.push(`${nom}: attendu ${voulu}, obtenu ${obtenu}`);
      }
      return { ecarts, vus };
    }
    const sortie = (liste) => liste.map((e) => `${e.kind}|${e.name}|${e.status}|${e.service_day}`).sort();

    async function etape(libelle, iso, jourAttendu, att) {
      // att : { pizzas, ingredients, patron (entrées visibles par le patron), refuses (sondes refusées) }
      aller(iso);
      const jourReel = jourParis(epoch(iso));
      ctl(`${libelle} — jour parisien du scénario = ${jourAttendu} (vérification du test)`, jourReel === jourAttendu, jourReel);
      const p = await lirePublic(pub);
      ctl(`${libelle} — public : misAJourLe = ${jourAttendu}`, p.status === 200 && p.json.misAJourLe === jourAttendu, p.json && p.json.misAJourLe);
      ctl(`${libelle} — public : pizzas ${JSON.stringify(att.pizzas)}, ingrédients ${JSON.stringify(att.ingredients)}`,
        memeListe(p.json.pizzasIndisponibles, att.pizzas) && memeListe(p.json.ingredientsIndisponibles, att.ingredients), p.json);
      const o = await patron.get('owner_availability.php');
      ctl(`${libelle} — patron : ${att.patron.length} entrée(s) effective(s)`, o.status === 200 && JSON.stringify(sortie(o.json.out)) === JSON.stringify([...att.patron].sort()), o.status === 200 ? sortie(o.json.out) : o.text);
      const s = await sonder(att.refuses);
      ctl(`${libelle} — ${Object.keys(SONDES).length} commandes sondes conformes (refusées : ${att.refuses.length})`, s.ecarts.length === 0, s.ecarts.length ? s.ecarts : s.vus);
    }

    // ------- Période 1 : changement d'heure de printemps (journée de 23 h) -------
    aller(Z(jourPlus(D, -1), '22:59:59')); // 23:59:59 à Paris (UTC+1), la veille du changement
    await ouvrir();
    await pose(patron, 'pizza', 'Napolitaine', 'out_today'); // service_day = veille
    await pose(patron, 'pizza', 'Kebab', 'out_manual');
    await pose(patron, 'ingredient', 'miel', 'out_manual');
    await pose(patron, 'product', 'Tiramisubito Oreo', 'out_manual');
    const MANUELLES = ['pizza|Kebab|out_manual|null', 'ingredient|miel|out_manual|null', 'product|Tiramisubito Oreo|out_manual|null'];
    const REFUS_MANUEL = ['Kebab', 'Chèvre miel (miel)', 'Tiramisubito Oreo'];
    const veille = jourPlus(D, -1);
    await etape('Printemps, veille : 23:59:59 à Paris (UTC+1)', Z(veille, '22:59:59'), veille,
      { pizzas: ['Napolitaine', 'Kebab'], ingredients: ['miel'], patron: [...MANUELLES, `pizza|Napolitaine|out_today|${veille}`], refuses: [...REFUS_MANUEL, 'Napolitaine'] });
    await etape('Printemps : minuit passé (00:00:00, UTC+1), la rupture du jour est revenue', Z(veille, '23:00:00'), D,
      { pizzas: ['Kebab'], ingredients: ['miel'], patron: MANUELLES, refuses: REFUS_MANUEL });
    aller(Z(D, '08:00:00')); // 10:00 à Paris, déjà UTC+2
    await pose(patron, 'pizza', 'Régina', 'out_today'); // service_day = D
    await etape('Printemps, jour du changement d\'heure : 10:00 (UTC+2)', Z(D, '08:00:00'), D,
      { pizzas: ['Kebab', 'Régina'], ingredients: ['miel'], patron: [...MANUELLES, `pizza|Régina|out_today|${D}`], refuses: [...REFUS_MANUEL, 'Régina'] });
    await etape('Printemps, journée de 23 h : 21:59:59Z = 23:59:59 à Paris (UTC+2)', Z(D, '21:59:59'), D,
      { pizzas: ['Kebab', 'Régina'], ingredients: ['miel'], patron: [...MANUELLES, `pizza|Régina|out_today|${D}`], refuses: [...REFUS_MANUEL, 'Régina'] });
    await etape('Printemps, journée de 23 h : 22:00:00Z = minuit à Paris (un décalage « UTC+1 » figé garderait la rupture)', Z(D, '22:00:00'), jourPlus(D, 1),
      { pizzas: ['Kebab'], ingredients: ['miel'], patron: MANUELLES, refuses: REFUS_MANUEL });

    // ------- Période 2 : été (UTC+2), minuit à 22:00Z -------
    aller(Z(E, '10:00:00'));
    await ouvrir();
    await pose(patron, 'pizza', 'Napolitaine', 'out_today'); // ligne périmée réutilisée : nouvelle date
    await etape('Été, 12:00 à Paris : les out_manual posées au printemps sont conservées', Z(E, '10:00:00'), E,
      { pizzas: ['Kebab', 'Napolitaine'], ingredients: ['miel'], patron: [...MANUELLES, `pizza|Napolitaine|out_today|${E}`], refuses: [...REFUS_MANUEL, 'Napolitaine'] });
    await etape('Été : 21:59:59Z = 23:59:59 à Paris (UTC+2)', Z(E, '21:59:59'), E,
      { pizzas: ['Kebab', 'Napolitaine'], ingredients: ['miel'], patron: [...MANUELLES, `pizza|Napolitaine|out_today|${E}`], refuses: [...REFUS_MANUEL, 'Napolitaine'] });
    await etape('Été : 22:00:00Z = minuit à Paris (le jour UTC n\'a pas encore changé)', Z(E, '22:00:00'), jourPlus(E, 1),
      { pizzas: ['Kebab'], ingredients: ['miel'], patron: MANUELLES, refuses: REFUS_MANUEL });

    // ------- Période 3 : changement d'heure d'automne (journée de 25 h) -------
    aller(Z(F, '08:00:00')); // 09:00 à Paris, UTC+1
    await ouvrir();
    await pose(patron, 'pizza', 'Régina', 'out_today');
    await etape('Automne, jour de 25 h : 09:00 (UTC+1)', Z(F, '08:00:00'), F,
      { pizzas: ['Kebab', 'Régina'], ingredients: ['miel'], patron: [...MANUELLES, `pizza|Régina|out_today|${F}`], refuses: [...REFUS_MANUEL, 'Régina'] });
    await etape('Automne, jour de 25 h : 22:30Z = 23:30 à Paris (UTC+1) ; un décalage « UTC+2 » figé aurait déjà expiré la rupture', Z(F, '22:30:00'), F,
      { pizzas: ['Kebab', 'Régina'], ingredients: ['miel'], patron: [...MANUELLES, `pizza|Régina|out_today|${F}`], refuses: [...REFUS_MANUEL, 'Régina'] });
    await etape('Automne, jour de 25 h : 22:59:59Z = 23:59:59 à Paris', Z(F, '22:59:59'), F,
      { pizzas: ['Kebab', 'Régina'], ingredients: ['miel'], patron: [...MANUELLES, `pizza|Régina|out_today|${F}`], refuses: [...REFUS_MANUEL, 'Régina'] });
    await etape('Automne, jour de 25 h : 23:00:00Z = minuit à Paris', Z(F, '23:00:00'), jourPlus(F, 1),
      { pizzas: ['Kebab'], ingredients: ['miel'], patron: MANUELLES, refuses: REFUS_MANUEL });

    // ------- Période 4 : scénario complet (pizza, ingrédient et produit en out_today ; autres en out_manual) -------
    const N1 = jourPlus(N, 1);
    const N2 = jourPlus(N, 2);
    const N3 = jourPlus(N, 3);
    aller(Z(N, '19:00:00')); // 20:00 à Paris, UTC+1
    await ouvrir();
    await pose(patron, 'pizza', 'Régina', 'out_today');
    await pose(patron, 'ingredient', 'thon', 'out_today');
    await pose(patron, 'product', 'Canette Oasis pomme poire', 'out_today');
    const AUJ = [`pizza|Régina|out_today|${N}`, `ingredient|thon|out_today|${N}`, `product|Canette Oasis pomme poire|out_today|${N}`];
    const REFUS_AUJ = ['Régina', 'Neptune (thon)', 'Calzone — Thon', 'Canette Oasis pomme poire'];
    await etape('Scénario complet, soirée 20:00 : pizza, ingrédient et produit en out_today', Z(N, '19:00:00'), N,
      { pizzas: ['Kebab', 'Régina'], ingredients: ['miel', 'thon'], patron: [...MANUELLES, ...AUJ], refuses: [...REFUS_MANUEL, ...REFUS_AUJ] });
    await etape('Scénario complet, 23:59:59 (dernière seconde)', Z(N, '22:59:59'), N,
      { pizzas: ['Kebab', 'Régina'], ingredients: ['miel', 'thon'], patron: [...MANUELLES, ...AUJ], refuses: [...REFUS_MANUEL, ...REFUS_AUJ] });
    await etape('Scénario complet, 00:00:00 le lendemain : pizza, ingrédient et produit en out_today sont revenus', Z(N, '23:00:00'), N1,
      { pizzas: ['Kebab'], ingredients: ['miel'], patron: MANUELLES, refuses: REFUS_MANUEL });
    aller(Z(N1, '10:00:00'));
    await pose(patron, 'pizza', 'Régina', 'out_today'); // refaite le lendemain : nouvelle date
    await etape('Lendemain midi : Régina remise en out_today (nouvelle date)', Z(N1, '10:00:00'), N1,
      { pizzas: ['Kebab', 'Régina'], ingredients: ['miel'], patron: [...MANUELLES, `pizza|Régina|out_today|${N1}`], refuses: [...REFUS_MANUEL, 'Régina'] });
    await etape('Lendemain 23:59:59', Z(N1, '22:59:59'), N1,
      { pizzas: ['Kebab', 'Régina'], ingredients: ['miel'], patron: [...MANUELLES, `pizza|Régina|out_today|${N1}`], refuses: [...REFUS_MANUEL, 'Régina'] });
    await etape('Surlendemain 00:00:00 : Régina revenue', Z(N1, '23:00:00'), N2,
      { pizzas: ['Kebab'], ingredients: ['miel'], patron: MANUELLES, refuses: REFUS_MANUEL });
    // out_today -> out_manual avant minuit : la rupture doit survivre au changement de jour.
    aller(Z(N2, '12:00:00'));
    await pose(patron, 'pizza', 'Régina', 'out_today');
    await pose(patron, 'pizza', 'Régina', 'out_manual');
    aller(Z(N3, '12:00:00'));
    let r = await patron.get('owner_availability.php');
    ctl('out_today changé en out_manual avant minuit : toujours hors service le surlendemain', r.json.out.some((e) => e.name === 'Régina' && e.status === 'out_manual' && e.service_day === null), sortie(r.json.out));
    r = await envoyer(client, [ligne('Régina', 'Solo')]);
    ctl('… et la commande de Régina est refusée ce jour-là', estRefusDispo(r), resume(r));
    await pose(patron, 'pizza', 'Régina', 'available');
    r = await envoyer(client, [ligne('Régina', 'Solo')]);
    ctl('remise disponible : Régina commandable', r.status === 201, resume(r));
    ctl('journal serveur de la phase « temps » sans erreur 500', !/server_error/.test(site.journal()), site.journal().trim().slice(0, 300) || '(vide)');
  } finally {
    site.arreter();
  }
}

/* =====================================================================================================================
 * Phases sur le site d'essai « jour figé » (heure du serveur = midi à Paris du jour courant : pas de passage de minuit en cours de script).
 * ===================================================================================================================== */
const S = { site: null, patron: null, clients: [], jour: '', rang: 0, marque: 0 };
const client = () => S.clients[(S.rang++) % S.clients.length];
const nbCommandes = () => Number(S.site.db.prepare('SELECT COUNT(*) AS n FROM orders').get().n);
const reinit = () => toutRemettre(S.site);

/** Une commande d'une ligne ou plus ; verdict « refusée avec ces noms et ces ingrédients » ou « acceptée ». */
async function verifier(nom, lignes, att, o = {}) {
  const c = o.client || client();
  const n0 = nbCommandes();
  const r = await envoyer(c, lignes, o);
  const n1 = nbCommandes();
  if (att.accepte) {
    return ctl(nom, r.status === 201 && n1 === n0 + 1, resume(r));
  }
  const bon = estRefusDispo(r) && n1 === n0
    && (att.noms === undefined || memeListe(r.json.unavailable, att.noms))
    && (att.ingredients === undefined || memeListe(r.json.unavailable_ingredients, att.ingredients));
  return ctl(nom, bon, `${resume(r)}${n1 !== n0 ? ' — COMMANDE ENREGISTRÉE' : ''}${att.noms ? ' ; attendu noms=' + JSON.stringify(att.noms) : ''}${att.ingredients ? ' ingredients=' + JSON.stringify(att.ingredients) : ''}`);
}

async function apiBases() {
  titre('API 1 — lecture publique, droits et validation des écritures du patron');
  const { patron } = S;
  reinit();
  const pub = anonyme();
  let r = await lirePublic(pub);
  ctl('GET availability : 200 et JSON', r.status === 200 && r.json !== null, r.status);
  ctl('GET availability : clés exactes (comme assets/data/disponibilite.json, sans « ok » ni clé inconnue)',
    JSON.stringify(Object.keys(r.json).sort()) === JSON.stringify(['ingredientsIndisponibles', 'misAJourLe', 'pizzasIndisponibles', 'produitsIndisponibles']), Object.keys(r.json));
  ctl('GET availability : Cache-Control no-store (jamais de lecture périmée)', /no-store/.test(r.headers.get('cache-control') || ''), r.headers.get('cache-control'));
  ctl('GET availability : misAJourLe = jour parisien du serveur', r.json.misAJourLe === S.jour, `${r.json.misAJourLe} / ${S.jour}`);
  ctl('GET availability : tout disponible au départ (deux listes vides)', r.json.pizzasIndisponibles.length === 0 && r.json.ingredientsIndisponibles.length === 0, r.json);
  r = await pub.post('availability.php', {});
  ctl('POST availability : 405', r.status === 405, r.status);
  r = await pub.get('owner_availability.php');
  ctl('GET owner_availability sans session : 401', r.status === 401 && r.json.error === 'unauthorized', `${r.status} ${r.json && r.json.error}`);
  r = await pub.post('owner_availability.php', { kind: 'pizza', name: 'Régina', status: 'out_manual' });
  ctl('POST owner_availability sans session : 401 (rien d\'écrit)', r.status === 401, r.status);
  r = await client().get('owner_availability.php');
  ctl('GET owner_availability avec session CLIENT : 403', r.status === 403 && r.json.error === 'forbidden', `${r.status} ${r.json && r.json.error}`);
  r = await client().post('owner_availability.php', { kind: 'pizza', name: 'Régina', status: 'out_manual' });
  ctl('POST owner_availability avec session CLIENT : 403', r.status === 403, r.status);
  r = await lirePublic(pub);
  ctl('aucune écriture n\'a abouti (liste publique toujours vide)', r.json.pizzasIndisponibles.length === 0, r.json);

  // Validation : chaque corps invalide donne 422 « validation » avec les champs fautifs, sans rien écrire.
  const bon = { kind: 'pizza', name: 'Régina', status: 'out_manual' };
  const cas = [
    ['kind absent', { name: 'Régina', status: 'out_manual' }, ['kind']],
    ['kind « Pizza » (casse)', { ...bon, kind: 'Pizza' }, ['kind']],
    ['kind « drink »', { ...bon, kind: 'drink' }, ['kind']],
    ['kind nombre', { ...bon, kind: 7 }, ['kind']],
    ['kind tableau', { ...bon, kind: ['pizza'] }, ['kind']],
    ['kind null', { ...bon, kind: null }, ['kind']],
    ['status absent', { kind: 'pizza', name: 'Régina' }, ['status']],
    ['status « out »', { ...bon, status: 'out' }, ['status']],
    ['status « OUT_TODAY » (casse)', { ...bon, status: 'OUT_TODAY' }, ['status']],
    ['status vide', { ...bon, status: '' }, ['status']],
    ['status nombre', { ...bon, status: 1 }, ['status']],
    ['status objet', { ...bon, status: {} }, ['status']],
    ['name absent', { kind: 'pizza', status: 'out_manual' }, ['name']],
    ['name vide', { ...bon, name: '' }, ['name']],
    ['name d\'espaces', { ...bon, name: '   \n\t ' }, ['name']],
    ['name de 121 caractères', { ...bon, name: 'x'.repeat(121) }, ['name']],
    ['name de 5000 caractères', { ...bon, name: 'x'.repeat(5000) }, ['name']],
    ['name nombre', { ...bon, name: 42 }, ['name']],
    ['name tableau', { ...bon, name: ['Régina'] }, ['name']],
    ['name objet', { ...bon, name: { a: 1 } }, ['name']],
    ['tout invalide', {}, ['kind', 'name', 'status']]
  ];
  const ecarts = [];
  for (const [nom, corps, champs] of cas) {
    const x = await patron.post('owner_availability.php', corps);
    const f = x.json && x.json.fields ? Object.keys(x.json.fields).sort() : null;
    if (!(x.status === 422 && x.json.error === 'validation' && JSON.stringify(f) === JSON.stringify([...champs].sort()))) ecarts.push(`${nom}: ${x.status} ${court(x.text, 90)}`);
  }
  ctl(`${cas.length} corps invalides : tous refusés en 422 « validation » avec les bons champs`, ecarts.length === 0, ecarts.length ? ecarts : 'ok');
  r = await patron.get('owner_availability.php');
  ctl('… et aucun de ces refus n\'a rien écrit', r.json.out.length === 0, r.json.out);

  // Enveloppe HTTP.
  r = await patron.post('owner_availability.php', null, { raw: '{pas du json', headers: { 'Content-Type': 'application/json' } });
  ctl('corps non JSON : 400 bad_request', r.status === 400 && r.json.error === 'bad_request', `${r.status} ${r.json && r.json.error}`);
  r = await patron.post('owner_availability.php', null, { raw: JSON.stringify(bon), headers: { 'Content-Type': 'text/plain' } });
  ctl('type de contenu text/plain : 415', r.status === 415, r.status);
  r = await patron.post('owner_availability.php', null, { raw: '[]', headers: { 'Content-Type': 'application/json' } });
  ctl('corps JSON « [] » (pas un objet) : 400', r.status === 400, r.status);
  r = await patron.post('owner_availability.php', { ...bon, bourrage: 'x'.repeat(70000) });
  ctl('corps de plus de 64 Ko : 413', r.status === 413, r.status);
  r = await patron.request('POST', 'owner_availability.php', { body: bon, origin: 'https://evil.example' });
  ctl('origine étrangère : 403 bad_origin (rien d\'écrit)', r.status === 403 && r.json.error === 'bad_origin', `${r.status} ${r.json && r.json.error}`);
  r = await patron.request('PUT', 'owner_availability.php', { body: bon });
  ctl('méthode PUT : 405', r.status === 405, r.status);

  // Limites acceptées : 120 caractères, espaces nettoyés.
  r = await patron.post('owner_availability.php', { kind: 'pizza', name: 'é'.repeat(120), status: 'out_manual' });
  ctl('nom de 120 caractères accompagnés : accepté', r.status === 200 && r.json.out.some((e) => e.name === 'é'.repeat(120)), r.status);
  r = await patron.post('owner_availability.php', { kind: 'pizza', name: '  Régina   \n  ', status: 'out_manual' });
  ctl('espaces et sauts de ligne nettoyés : « Régina »', r.status === 200 && r.json.out.some((e) => e.name === 'Régina'), r.status === 200 ? r.json.out.map((e) => e.name).filter((n) => n.length < 30) : r.text);
  r = await patron.post('owner_availability.php', { kind: 'pizza', name: "'; DROP TABLE availability;--", status: 'out_manual' });
  const apres = await patron.get('owner_availability.php');
  ctl('nom d\'injection SQL : stocké tel quel, table intacte', r.status === 200 && apres.status === 200 && apres.json.out.some((e) => e.name === "'; DROP TABLE availability;--"), r.status);
  r = await lirePublic(pub);
  ctl('lecture publique toujours en JSON valide après ces noms étranges', r.status === 200 && Array.isArray(r.json.pizzasIndisponibles), r.status);
  // Caractère NUL : Postgres le refuse ; l'API doit répondre 422 (comme pour une remarque de commande), jamais 500.
  const nul1 = await patron.post('owner_availability.php', { kind: 'pizza', name: 'Rég\u0000ina', status: 'out_manual' });
  const nul2 = await patron.post('owner_availability.php', { kind: 'ingredient', name: 'thon\u0000', status: 'out_today' });
  ctl('nom contenant un caractère NUL (kind pizza) : refus propre 422, pas de 500', nul1.status === 422, `${nul1.status} ${court(nul1.text, 120)}`);
  ctl('nom contenant un caractère NUL (kind ingredient) : refus propre 422, pas de 500', nul2.status === 422, `${nul2.status} ${court(nul2.text, 120)}`);
  reinit();
}

async function apiEtats() {
  titre('API 2 — états, dates et lecture publique / patron');
  const { patron } = S;
  reinit();
  const pub = anonyme();
  let r = await pose(patron, 'pizza', 'Régina', 'out_manual');
  ctl('pizza out_manual : le patron relit { kind, name, status, service_day: null }', JSON.stringify(r.json.out) === JSON.stringify([{ kind: 'pizza', name: 'Régina', status: 'out_manual', service_day: null }]), r.json.out);
  let p = await lirePublic(pub);
  ctl('pizza out_manual : listée publiquement', memeListe(p.json.pizzasIndisponibles, ['Régina']), p.json);
  r = await pose(patron, 'pizza', 'Régina', 'out_today');
  ctl('passage à out_today : service_day = jour du serveur', r.json.out.length === 1 && r.json.out[0].status === 'out_today' && r.json.out[0].service_day === S.jour, r.json.out);
  r = await pose(patron, 'pizza', 'Régina', 'out_manual');
  ctl('retour à out_manual : service_day effacé, toujours une seule entrée', r.json.out.length === 1 && r.json.out[0].service_day === null, r.json.out);
  r = await pose(patron, 'pizza', 'Régina', 'out_manual');
  ctl('même état renvoyé deux fois : 200, toujours une seule entrée', r.status === 200 && r.json.out.length === 1, r.json.out);
  r = await pose(patron, 'pizza', 'Régina', 'available');
  ctl('available : entrée supprimée', r.json.out.length === 0, r.json.out);
  r = await pose(patron, 'pizza', 'Régina', 'available');
  ctl('available sur une entrée absente : 200 sans effet', r.status === 200 && r.json.out.length === 0, r.status);
  r = await pose(patron, 'ingredient', 'thon', 'out_today');
  p = await lirePublic(pub);
  ctl('ingrédient out_today : listé dans ingredientsIndisponibles (pas dans les pizzas)', memeListe(p.json.ingredientsIndisponibles, ['thon']) && p.json.pizzasIndisponibles.length === 0, p.json);
  await pose(patron, 'product', 'Bolognaise', 'out_manual');
  p = await lirePublic(pub);
  ctl('produit hors service : listé dans produitsIndisponibles (affiché sur le site, comme les pizzas)', memeListe(p.json.produitsIndisponibles, ['Bolognaise']), p.json);
  r = await patron.get('owner_availability.php');
  ctl('… mais le patron le voit', r.json.out.some((e) => e.kind === 'product' && e.name === 'Bolognaise'), r.json.out.length + ' entrées');
  // Plusieurs graphies d'une même pizza : « available » les efface toutes.
  reinit();
  for (const nom of ['regina', 'Régina', 'RÉGINA', 'Régina.']) await pose(patron, 'pizza', nom, 'out_manual');
  r = await patron.get('owner_availability.php');
  const avant = r.json.out.length;
  r = await pose(patron, 'pizza', 'Régina', 'available');
  ctl(`4 graphies d'une même pizza (${avant} lignes) : « available » les efface toutes`, avant === 4 && r.json.out.length === 0, `${avant} -> ${r.json.out.length}`);
  await pose(patron, 'pizza', 'Calzone (soufflée)', 'out_manual');
  r = await pose(patron, 'pizza', 'Calzone', 'available');
  ctl('« Calzone » remet disponible « Calzone (soufflée) » (parenthèse finale)', r.json.out.length === 0, r.json.out);
  await pose(patron, 'pizza', 'Calzone', 'out_manual');
  r = await pose(patron, 'pizza', 'Calzone (soufflée)', 'available');
  ctl('« Calzone (soufflée) » remet disponible « Calzone »', r.json.out.length === 0, r.json.out);
  // Nom hors carte : accepté, listé, sans effet sur les commandes de la carte.
  await pose(patron, 'pizza', 'Pizza fantôme', 'out_manual');
  p = await lirePublic(pub);
  ctl('nom hors carte : listé publiquement (la page le signale en console, sans rien retirer)', memeListe(p.json.pizzasIndisponibles, ['Pizza fantôme']), p.json);
  await verifier('nom hors carte : aucune commande de la carte n\'est refusée à tort', [ligne('Régina', 'Solo'), ligne('Kebab', 'Duo')], { accepte: true });
  // Isolation par type d'entrée.
  reinit();
  await pose(patron, 'ingredient', 'Régina', 'out_manual');
  await verifier('ingrédient nommé « Régina » : ne bloque pas la pizza Régina', [ligne('Régina', 'Solo')], { accepte: true });
  reinit();
  await pose(patron, 'product', 'Régina', 'out_manual');
  await verifier('produit nommé « Régina » : ne bloque pas la pizza Régina', [ligne('Régina', 'Solo')], { accepte: true });
  reinit();
  await pose(patron, 'pizza', 'jambon', 'out_manual');
  await verifier('pizza nommée « jambon » : ne bloque pas les pizzas qui contiennent l\'ingrédient jambon', [ligne('Régina', 'Solo')], { accepte: true });
  reinit();
  await pose(patron, 'product', 'Kebab', 'out_manual');
  await verifier('produit « Kebab » (Subitowich) : la pizza Kebab reste commandable', [ligne('Kebab', 'Solo')], { accepte: true });
  await verifier('produit « Kebab » (Subitowich) : le Subitowich Kebab est refusé', [ligne('Subitowich Kebab', '')], { noms: ['Subitowich Kebab'], ingredients: [] });
  reinit();
  await pose(patron, 'pizza', 'Kebab', 'out_manual');
  await verifier('pizza « Kebab » : le Subitowich Kebab reste commandable', [ligne('Subitowich Kebab', '')], { accepte: true });
  await verifier('pizza « Kebab » : la pizza Kebab est refusée', [ligne('Kebab', 'Solo')], { noms: ['Kebab'], ingredients: [] });
  reinit();
  await pose(patron, 'pizza', '4 fromages', 'out_manual');
  await verifier('pizza « 4 fromages » (casse) : le Subitowich 4 fromages reste commandable', [ligne('Subitowich 4 fromages', '')], { accepte: true });
  await verifier('pizza « 4 fromages » : la pizza 4 Fromages est refusée', [ligne('4 Fromages', 'Duo')], { noms: ['4 Fromages'], ingredients: [] });
  reinit();
}

/** Matrice de refus : une situation du cahier des charges par bloc, avec les noms exacts attendus. */
async function apiMatrice() {
  titre('API 3 — matrice de refus (noms exacts) et commandes qui passent malgré tout');
  const { patron, site } = S;
  S.marque = site.journal().length;

  // -- pizzas ---------------------------------------------------------------------------------------------------
  reinit();
  await pose(patron, 'pizza', 'Régina', 'out_manual');
  await pose(patron, 'pizza', 'Kebab', 'out_today');
  await verifier('pizza hors service : seule la ligne Régina est refusée, nommée', [ligne('Régina', 'Solo')], { noms: ['Régina'], ingredients: [] });
  await verifier('pizza hors service (out_today) : Kebab refusée, nommée', [ligne('Kebab', 'Solo')], { noms: ['Kebab'], ingredients: [] });
  await verifier('une autre pizza passe (Campione)', [ligne('Campione', 'Solo')], { accepte: true });
  await verifier('panier mêlé : seules les deux lignes hors service sont nommées, rien n\'est enregistré',
    [ligne('Régina', 'Solo'), ligne('Campione', 'Duo'), ligne('Kebab', 'Quatro'), ligne('Neptune', 'Solo'), ligne('Canette Oasis pomme poire', '', { qty: 2 })], { noms: ['Régina', 'Kebab'], ingredients: [] });
  await verifier('nom envoyé en minuscules : refusé, nom renvoyé tel qu\'envoyé', [ligne('régina', 'Solo')], { noms: ['régina'], ingredients: [] });
  await verifier('nom envoyé en capitales sans accent : refusé', [ligne('REGINA', 'Solo')], { noms: ['REGINA'], ingredients: [] });
  await verifier('livraison : le refus de disponibilité passe avant l\'adresse et le minimum', [ligne('Régina', 'XXL')], { noms: ['Régina'], ingredients: [] }, { mode: 'delivery', ville: 'Hénin-Beaumont', paiements: ['card'] });
  await pose(patron, 'pizza', 'Régina', 'available');
  await pose(patron, 'pizza', 'Kebab', 'available');
  await verifier('remises disponibles : Régina passe de nouveau', [ligne('Régina', 'Solo')], { accepte: true });
  await verifier('remises disponibles : Kebab passe de nouveau', [ligne('Kebab', 'Solo')], { accepte: true });

  // -- ingrédient fixe ---------------------------------------------------------------------------------------------
  reinit();
  await pose(patron, 'ingredient', 'champignons', 'out_manual');
  await verifier('ingrédient fixe hors service : la pizza qui le contient est refusée (Régina)', [ligne('Régina', 'Solo')], { noms: ['Régina'], ingredients: ['champignons'] });
  await verifier('ingrédient fixe RETIRÉ par le client : la ligne reste bloquée (règle de la carte)', [ligne('Régina', 'Solo', { removed: ['champignons'] })], { noms: ['Régina'], ingredients: ['champignons'] });
  await verifier('l\'ingrédient bloque aussi Campione', [ligne('Campione', 'Solo')], { noms: ['Campione'], ingredients: ['champignons'] });
  await verifier('une pizza sans cet ingrédient passe (Kebab)', [ligne('Kebab', 'Duo')], { accepte: true });
  await verifier('des pâtes sans cet ingrédient passent', [ligne('Pâtes Bolognaise', '')], { accepte: true });
  await verifier('moitié-moitié dont la 2e moitié contient l\'ingrédient : seule la 2e moitié est nommée', [ligne('Kebab', 'Duo', { half: ['Kebab', 'Campione'] })], { noms: ['Campione'], ingredients: ['champignons'] });
  await verifier('moitié-moitié dont la 1re moitié contient l\'ingrédient : la 1re est nommée', [ligne('Régina', 'Duo', { half: ['Régina', 'Kebab'] })], { noms: ['Régina'], ingredients: ['champignons'] });
  await verifier('supplément « Champignons » sur une pizza sans champignons : refusé, nommé', [ligne('Neptune', 'Duo', { extras: ['Champignons'] })], { noms: ['Champignons'], ingredients: ['champignons'] });
  await verifier('retirer les champignons d\'une pizza qui n\'en a pas ne change rien (Kebab passe, sans retrait)', [ligne('Kebab', 'Solo', { removed: ['oignons'] })], { accepte: true });

  // -- suppléments -----------------------------------------------------------------------------------------------
  reinit();
  await pose(patron, 'ingredient', 'thon', 'out_today');
  await verifier('supplément thon hors service : seul le supplément est nommé (la pizza est intacte)', [ligne('Régina', 'Solo', { extras: ['thon'] })], { noms: ['thon'], ingredients: ['thon'] });
  await verifier('supplément écrit « thon* » (astérisque résiduelle) : refusé sous le nom « thon »', [ligne('Régina', 'Solo', { extras: ['thon*'] })], { noms: ['thon'], ingredients: ['thon'] });
  await verifier('un autre supplément passe (olives)', [ligne('Régina', 'Solo', { extras: ['olives'] })], { accepte: true });
  reinit();
  await pose(patron, 'ingredient', 'fromage de chèvre', 'out_today');
  await verifier('alias : « chèvre » (supplément) est couvert par l\'ingrédient « fromage de chèvre »', [ligne('Régina', 'Duo', { extras: ['chèvre'] })], { noms: ['chèvre'], ingredients: ['fromage de chèvre'] });
  await verifier('… et la pizza Chèvre miel (ingrédient fixe « fromage de chèvre ») est refusée', [ligne('Chèvre miel', 'Solo')], { noms: ['Chèvre miel'], ingredients: ['fromage de chèvre'] });
  reinit();
  await pose(patron, 'ingredient', 'chèvre', 'out_manual');
  await verifier('ingrédient nommé « chèvre » : bloque le supplément chèvre', [ligne('Régina', 'Duo', { extras: ['chèvre'] })], { noms: ['chèvre'], ingredients: ['chèvre'] });
  await verifier('… mais pas la pizza Chèvre miel (fixe : « fromage de chèvre »)', [ligne('Chèvre miel', 'Solo')], { accepte: true });
  reinit();
  await pose(patron, 'ingredient', 'reblochons', 'out_manual');
  await verifier('alias : « reblochon » (supplément) est couvert par « reblochons »', [ligne('Régina', 'Duo', { extras: ['reblochon'] })], { noms: ['reblochon'], ingredients: ['reblochons'] });
  await verifier('… et la Savoyarde (fixe « reblochons ») est refusée', [ligne('Savoyarde', 'Solo')], { noms: ['Savoyarde'], ingredients: ['reblochons'] });

  // -- calzone ---------------------------------------------------------------------------------------------------
  reinit();
  await pose(patron, 'ingredient', 'thon', 'out_manual');
  await verifier('calzone : la garniture manquante (thon) est refusée, ligne complète nommée', [ligne('Calzone (soufflée) — Thon', 'Duo')], { noms: ['Calzone (soufflée) — Thon'], ingredients: ['thon'] });
  await verifier('calzone : une autre garniture (jambon) passe', [ligne('Calzone (soufflée) — Jambon', 'Duo')], { accepte: true });
  await verifier('calzone : les autres garnitures passent (kebab, viande hachée, poulet)', [ligne('Calzone (soufflée) — Kebab', 'Solo'), ligne('Calzone (soufflée) — Viande hachée', 'Solo'), ligne('Calzone (soufflée) — Poulet', 'Solo')], { accepte: true });
  for (const g of ['jambon', 'kebab', 'viande hachée']) await pose(patron, 'ingredient', g, 'out_manual');
  await verifier('calzone : 4 garnitures sur 5 manquantes, la dernière (poulet) passe encore', [ligne('Calzone (soufflée) — Poulet', 'Duo')], { accepte: true });
  await pose(patron, 'ingredient', 'poulet', 'out_manual');
  const noms5 = ['Thon', 'Jambon', 'Kebab', 'Viande hachée', 'Poulet'];
  for (const g of noms5) {
    await verifier(`calzone : toutes les garnitures manquantes — « ${g} » refusée`, [ligne(`Calzone (soufflée) — ${g}`, 'Solo')], { noms: [`Calzone (soufflée) — ${g}`], ingredients: [g.toLowerCase()] });
  }
  reinit();
  await pose(patron, 'ingredient', 'jaune d’œuf', 'out_manual');
  await verifier('calzone : ingrédient fixe « jaune d’œuf » manquant bloque toutes les garnitures (nom sans garniture)', [ligne('Calzone (soufflée) — Poulet', 'Solo')], { noms: ['Calzone (soufflée)'], ingredients: ['jaune d’œuf'] });
  reinit();
  await pose(patron, 'ingredient', "jaune d'oeuf", 'out_manual');
  await verifier('« jaune d\'oeuf » (apostrophe droite, oe) équivaut à « jaune d’œuf » de la carte', [ligne('Calzone (soufflée) — Poulet', 'Solo')], { noms: ['Calzone (soufflée)'], ingredients: ["jaune d'oeuf"] });
  reinit();
  await pose(patron, 'pizza', 'Calzone', 'out_manual');
  await verifier('pizza « Calzone » hors service : toutes les garnitures sont refusées', [ligne('Calzone (soufflée) — Thon', 'Solo')], { noms: ['Calzone (soufflée)'], ingredients: [] });

  // -- moitié-moitié -------------------------------------------------------------------------------------------
  reinit();
  await pose(patron, 'pizza', 'Campione', 'out_manual');
  await verifier('moitié-moitié : 2e moitié hors service refusée, seule elle est nommée', [ligne('Kebab', 'Duo', { half: ['Kebab', 'Campione'] })], { noms: ['Campione'], ingredients: [] });
  await verifier('moitié-moitié : 1re moitié hors service refusée', [ligne('Campione', 'Duo', { half: ['Campione', 'Kebab'] })], { noms: ['Campione'], ingredients: [] });
  await pose(patron, 'pizza', 'Kebab', 'out_manual');
  await verifier('moitié-moitié : deux moitiés hors service, les deux sont nommées', [ligne('Kebab', 'Quatro', { half: ['Kebab', 'Campione'] })], { noms: ['Kebab', 'Campione'], ingredients: [] });
  await verifier('moitié-moitié avec deux pizzas disponibles : passe', [ligne('Régina', 'Duo', { half: ['Régina', 'Neptune'] })], { accepte: true });
  reinit();
  await pose(patron, 'ingredient', 'anchois', 'out_today');
  await verifier('moitié-moitié : ingrédient de la 2e moitié manquant (anchois / Napolitaine)', [ligne('Régina', 'Duo', { half: ['Régina', 'Napolitaine'] })], { noms: ['Napolitaine'], ingredients: ['anchois'] });
  await verifier('moitié-moitié : 2e moitié envoyée en minuscules, nom renvoyé tel qu\'envoyé', [ligne('Régina', 'Duo', { half: ['Régina', 'napolitaine'] })], { noms: ['napolitaine'], ingredients: ['anchois'] });

  // -- produits --------------------------------------------------------------------------------------------------
  reinit();
  await pose(patron, 'product', 'Bolognaise', 'out_manual');
  await verifier('produit « Bolognaise » (nom de la tablette) : « Pâtes Bolognaise » refusées', [ligne('Pâtes Bolognaise', '')], { noms: ['Pâtes Bolognaise'], ingredients: [] });
  await verifier('… les autres pâtes passent', [ligne('Pâtes Carbonara', '')], { accepte: true });
  reinit();
  await pose(patron, 'product', 'Pâtes Bolognaise', 'out_today');
  await verifier('produit nommé comme la ligne de commande (« Pâtes Bolognaise ») : refusé aussi', [ligne('Pâtes Bolognaise', '')], { noms: ['Pâtes Bolognaise'], ingredients: [] });
  reinit();
  await pose(patron, 'product', 'Wings (5 pièces)', 'out_manual');
  await verifier('produit avec parenthèse (« Wings (5 pièces) ») : refusé', [ligne('Tex-Mex Wings (5 pièces)', '')], { noms: ['Tex-Mex Wings (5 pièces)'], ingredients: [] });
  await verifier('… les autres Tex-Mex passent', [ligne('Tex-Mex Tenders (4 pièces)', '')], { accepte: true });
  reinit();
  await pose(patron, 'product', 'Wings', 'out_manual');
  await verifier('produit « Wings » sans parenthèse : couvre « Wings (5 pièces) »', [ligne('Tex-Mex Wings (5 pièces)', '')], { noms: ['Tex-Mex Wings (5 pièces)'], ingredients: [] });
  reinit();
  await pose(patron, 'product', 'Canette Oasis pomme poire', 'out_manual');
  await verifier('produit « Canette Oasis pomme poire » : refusé (quantité 2)', [ligne('Canette Oasis pomme poire', '', { qty: 2 })], { noms: ['Canette Oasis pomme poire'], ingredients: [] });
  await verifier('… une autre boisson passe', [ligne('Maxi Coca', '')], { accepte: true });
  await verifier('… un nom de produit différent n\'est pas une correspondance approximative (seul « Oasis Pomme Poire » reste refusé)', [ligne('Maxi Coca', ''), ligne('Canette Oasis pomme poire', '')], { noms: ['Canette Oasis pomme poire'], ingredients: [] });
  reinit();
  await pose(patron, 'ingredient', 'poulet', 'out_manual');
  await verifier('ingrédient « poulet » : Tex-Mex Wings refusé (fixe de la tablette)', [ligne('Tex-Mex Wings (5 pièces)', '')], { noms: ['Tex-Mex Wings (5 pièces)'], ingredients: ['poulet'] });
  await verifier('ingrédient « poulet » : Subitowich Milano refusé', [ligne('Subitowich Milano', '')], { noms: ['Subitowich Milano'], ingredients: ['poulet'] });
  await verifier('ingrédient « poulet » : pizza Chicken refusée', [ligne('Chicken', 'Solo')], { noms: ['Chicken'], ingredients: ['poulet'] });
  await verifier('ingrédient « poulet » : les boissons passent (aucun ingrédient fixe)', [ligne('Canette Oasis pomme poire', '')], { accepte: true });
  reinit();
  await pose(patron, 'ingredient', 'coca cola', 'out_manual');
  await verifier('ingrédient hors tablette (« coca cola ») : aucun effet sur la boisson', [ligne('Canette Oasis pomme poire', '')], { accepte: true });

  // -- correspondance des noms : accents, casse, parenthèses, apostrophes ----------------------------------------------
  reinit();
  const noms = [
    ['pizza', 'regina', ligne('Régina', 'Solo'), 'Régina'],
    ['pizza', 'RÉGINA', ligne('Régina', 'Solo'), 'Régina'],
    ['pizza', '  régina  ', ligne('Régina', 'Solo'), 'Régina'],
    ['pizza', 'Calzone', ligne('Calzone (soufflée) — Thon', 'Solo'), 'Calzone (soufflée)'],
    ['pizza', 'calzone (SOUFFLEE)', ligne('Calzone (soufflée) — Thon', 'Solo'), 'Calzone (soufflée)'],
    ['pizza', 'L’Extravagante', ligne("L'Extravagante", 'Duo'), "L'Extravagante"],
    ['pizza', "l'extravagante", ligne("L'Extravagante", 'Duo'), "L'Extravagante"],
    ['pizza', 'Chevre miel', ligne('Chèvre miel', 'Solo'), 'Chèvre miel'],
    ['pizza', '4 FROMAGES', ligne('4 Fromages', 'Solo'), '4 Fromages'],
    ['pizza', 'fruits de MER', ligne('Fruits de mer', 'Solo'), 'Fruits de mer'],
    ['pizza', 'Marguerita', ligne('Marguerita (base)', 'Solo'), 'Marguerita (base)'],
    ['pizza', 'marguerita (BASE)', ligne('Marguerita (base) — Crème fraîche', 'Solo'), 'Marguerita (base)'],
    ['ingredient', 'Œuf', ligne('Kefta', 'Solo'), 'Kefta'],
    ['ingredient', 'OEUF', ligne('Orientale', 'Solo'), 'Orientale'],
    ['ingredient', 'creme fraiche', ligne('Venezia', 'Solo'), 'Venezia'],
    ['ingredient', 'CRÈME FRAÎCHE', ligne('Pacifico', 'Solo'), 'Pacifico'],
    ['ingredient', 'saumon fume', ligne('Pacifico', 'Duo'), 'Pacifico'],
    ['ingredient', 'MAÏS', ligne('Salade Exotique', ''), 'Salade Exotique'],
    ['ingredient', 'mais', ligne('Salade Exotique', ''), 'Salade Exotique'],
    ['ingredient', 'Pommes de Terre', ligne('Milano', 'Solo'), 'Milano'],
    ['ingredient', 'm&m’s', ligne('Dessert Tiramisubito M&M\'s', ''), 'Dessert Tiramisubito M&M\'s'],
    ['product', 'tiramisubito OREO', ligne('Dessert Tiramisubito Oreo', ''), 'Dessert Tiramisubito Oreo'],
    ['product', 'PÂTES carbonara', ligne('Pâtes Carbonara', ''), 'Pâtes Carbonara'],
    ['product', 'Part de tarte au daim', ligne('Dessert Part de Tarte au Daim', ''), 'Dessert Part de Tarte au Daim']
  ];
  const ecartsNoms = [];
  for (const [kind, nomSaisi, l, attendu] of noms) {
    reinit();
    await pose(patron, kind, nomSaisi, 'out_manual');
    const r = await envoyer(client(), [l]);
    const ok = estRefusDispo(r) && r.json.unavailable.length === 1 && norme(nomBase(r.json.unavailable[0])) === norme(attendu);
    if (!ok) ecartsNoms.push(`${kind} « ${nomSaisi} » vs ${l.name}: ${resume(r)}`);
  }
  ctl(`correspondance des noms : ${noms.length} graphies (accents, casse, œ, apostrophes, parenthèses, espaces) refusent la bonne ligne`, ecartsNoms.length === 0, ecartsNoms.length ? ecartsNoms : 'ok');
  // Pas de correspondance approximative.
  reinit();
  await pose(patron, 'ingredient', 'saumon', 'out_manual');
  await verifier('exactitude : « saumon » bloque les pâtes au saumon…', [ligne('Pâtes Saumon', '')], { noms: ['Pâtes Saumon'], ingredients: ['saumon'] });
  await verifier('… mais pas le « saumon fumé » (Pacifico, Venezia, Subitowich Norvégien)', [ligne('Pacifico', 'Solo'), ligne('Venezia', 'Solo'), ligne('Subitowich Norvégien', '')], { accepte: true });
  reinit();
  await pose(patron, 'ingredient', 'fromage', 'out_manual');
  await verifier('exactitude : « fromage » ne bloque pas « fromage de chèvre » (Fajitas) ni « fromage à raclette » (Suisse)', [ligne('Fajitas', 'Solo'), ligne('Suisse', 'Solo'), ligne('Savoyarde', 'Solo')], { accepte: true });
  await verifier('… mais bloque Régina', [ligne('Régina', 'Solo')], { noms: ['Régina'], ingredients: ['fromage'] });
  reinit();
  await pose(patron, 'pizza', 'Marguerita (base)', 'out_manual');
  await verifier('pizza à composer : « Marguerita (base) » hors service refusée', [ligne('Marguerita (base)', 'Solo')], { noms: ['Marguerita (base)'], ingredients: [] });
  reinit();
  await pose(patron, 'ingredient', 'sauce tomate', 'out_manual');
  await verifier('base à composer : sans choix transmis, une seule base manquante laisse passer', [ligne('Marguerita (base)', 'Duo')], { accepte: true });
  await pose(patron, 'ingredient', 'crème fraîche', 'out_manual');
  await verifier('base à composer : les deux bases manquantes bloquent la ligne', [ligne('Marguerita (base)', 'Duo')], { noms: ['Marguerita (base)'], ingredients: ['sauce tomate', 'crème fraîche'] });

  // -- forme de la réponse -------------------------------------------------------------------------------------
  reinit();
  await pose(patron, 'pizza', 'Régina', 'out_manual');
  const rep = await envoyer(client(), [ligne('Régina', 'Solo')]);
  const j = rep.json;
  ctl('réponse de refus : { ok:false, error, message, unavailable[], unavailable_ingredients[] } et rien d\'autre',
    JSON.stringify(Object.keys(j).sort()) === JSON.stringify(['error', 'message', 'ok', 'unavailable', 'unavailable_ingredients']) && j.ok === false, Object.keys(j));
  ctl('réponse de refus : message en français, lisible', typeof j.message === 'string' && /disponibles/.test(j.message) && !/rupture/i.test(j.message), j.message);
  ctl('réponse de refus : JSON no-store, sans cookie de session posé', /json/.test(rep.rep.headers.get('content-type') || '') && /no-store/.test(rep.rep.headers.get('cache-control') || '') && rep.rep.setCookies.length === 0, `${rep.rep.headers.get('content-type')} ${rep.rep.headers.get('cache-control')} cookies=${rep.rep.setCookies.length}`);
  ctl('journal serveur : aucune erreur 500 pendant la matrice', !/server_error/.test(site.journal().slice(S.marque)), site.journal().slice(S.marque).trim().slice(0, 300) || '(vide)');
  reinit();
}

/** Cohérence de la copie du menu de la tablette avec le catalogue serveur, puis balayages complets. */
async function apiBalayages() {
  titre('API 4 — tablette ↔ catalogue ↔ serveur : balayage de chaque pizza, produit et ingrédient');
  const { patron } = S;
  const menu = menuTablette();
  const prods = produitsTablette(menu);
  const cat = catalogue();
  const parCat = cat.products.filter((p) => p.category !== 'composer');
  const ecarts = [];
  for (const t of prods) {
    const p = parCat.find((x) => x.category === t.cat && x.name === t.name);
    if (!p) { ecarts.push(`tablette « ${t.name} » (${t.cat}) absent du catalogue`); continue; }
    const tab = new Set(t.ing.flatMap((g) => g.split('|')).map(norme));
    const srv = new Set([...(p.availability.fixed || []), ...(p.availability.choice || [])].map(norme));
    const manque = [...srv].filter((x) => !tab.has(x));
    const trop = [...tab].filter((x) => !srv.has(x));
    if (manque.length || trop.length) ecarts.push(`${t.name}: la tablette ne propose pas [${manque}] / propose en trop [${trop}]`);
  }
  for (const p of parCat) if (!prods.some((t) => t.cat === p.category && t.name === p.name)) ecarts.push(`catalogue « ${p.name} » absent de la tablette`);
  ctl(`menu de la tablette (${prods.length} produits) identique au catalogue serveur (noms, catégories, ingrédients fixes et au choix)`, ecarts.length === 0, ecarts.length ? ecarts : `${prods.length} produits`);
  const lignes = lignesCatalogue();
  const trouve = (kind, nom) => lignes.filter((l) => l.kind === kind && l.produit.name === nom);

  // -- chaque pizza et chaque produit de la tablette, déclaré hors service tel que la tablette l'envoie --------------------
  for (const [kind, titreType] of [['pizza', 'pizzas'], ['product', 'produits']]) {
    const liste = prods.filter((t) => t.kind === kind);
    const defauts = [];
    reinit();
    let n = 0;
    for (let i = 0; i < liste.length; i++) {
      const t = liste[i];
      const cibles = trouve(kind, t.name);
      const voisine = trouve(kind, liste[(i + 1) % liste.length].name)[0];
      await pose(patron, kind, t.name, 'out_manual');
      for (const l of cibles) {
        const r = await envoyer(client(), [l.fabrique()]); n++;
        const attendu = l.kind === 'pizza' ? (l.nom.includes('—') ? nomBase(l.nom) : l.nom) : l.nom;
        if (!(estRefusDispo(r) && memeListe(r.json.unavailable, [attendu]))) defauts.push(`${t.name} (${l.nom}) hors service: ${resume(r)}`);
      }
      const rv = await envoyer(client(), [voisine.fabrique()]); n++;
      if (rv.status !== 201) defauts.push(`${t.name} hors service : la voisine « ${voisine.nom} » devrait passer: ${resume(rv)}`);
      await pose(patron, kind, t.name, 'available');
      const ra = await envoyer(client(), [cibles[0].fabrique()]); n++;
      if (ra.status !== 201) defauts.push(`${t.name} remise disponible: ${resume(ra)}`);
      if (i % 8 === 7) S.site.db.exec('DELETE FROM throttle');
    }
    ctl(`balayage ${titreType} : ${liste.length} déclarés hors service un par un (nom de la tablette) -> ligne refusée et nommée, voisine intacte, remise disponible -> repasse (${n} commandes)`, defauts.length === 0, defauts.length ? defauts.slice(0, 6) : `${liste.length} ${titreType} conformes`);
  }

  // -- chaque ingrédient de la tablette -------------------------------------------------------------------------------
  const ingredients = ingredientsTablette(prods);
  titre(`API 4b — ${ingredients.length} ingrédients de la tablette : chaque ligne du catalogue (${lignes.length} lignes) refusée si et seulement si l'ingrédient la concerne`);
  let totalSondes = 0;
  let totalIng = 0;
  for (const K of ingredients) {
    reinit();
    await pose(patron, 'ingredient', K, 'out_manual');
    const out = { pizzas: [], produits: [], ingredients: [K] };
    const bloquees = [];
    const libres = [];
    for (const l of lignes) { const cs = causes(l, out); (cs.length ? bloquees : libres).push([l, cs]); }
    // Toutes les lignes bloquées, et 3 lignes libres choisies à intervalle régulier (témoins).
    const temoins = [0, Math.floor(libres.length / 2), libres.length - 1].map((i) => libres[i]);
    const sondes = [...bloquees, ...temoins];
    const defauts = [];
    await enParallele(sondes, 8, async ([l, cs], i) => {
      const r = await envoyer(S.clients[(S.rang + i) % S.clients.length], [l.fabrique()]);
      totalSondes++;
      if (cs.length) {
        const att = nomAttendu(l, cs);
        if (!(estRefusDispo(r) && memeListe(r.json.unavailable, [att]) && memeListe(r.json.unavailable_ingredients, [K.toLowerCase()]))) defauts.push(`${l.nom} attendu refus [${att}] : ${resume(r)}`);
      } else if (r.status !== 201) defauts.push(`${l.nom} (non concernée) devrait passer : ${resume(r)}`);
    });
    S.rang += sondes.length;
    totalIng++;
    ctl(`ingrédient « ${K} » : ${bloquees.length} ligne(s) refusée(s) comme prévu, 3 témoins acceptés`, defauts.length === 0, defauts.length ? defauts.slice(0, 4) : '');
  }
  mesure('balayage des ingrédients', `${totalIng} ingrédients, ${totalSondes} commandes sondes`);
  reinit();
}

/** Tout hors service d'un coup, puis tout remis. */
async function apiTout() {
  titre('API 5 — tout hors service d\'un coup (pizzas, produits, ingrédients), puis tout remis');
  const { patron } = S;
  reinit();
  const menu = menuTablette();
  const prods = produitsTablette(menu);
  const ingredients = ingredientsTablette(prods);
  const lignes = lignesCatalogue();
  const t0 = maintenant();
  const reps = await enParallele([...prods.map((p) => [p.kind, p.name]), ...ingredients.map((i) => ['ingredient', i])], 6, ([k, n]) => bascule(patron, k, n, 'out_manual'));
  const dt = maintenant() - t0;
  ctl(`${reps.length} déclarations hors service (6 en parallèle) : toutes 200`, reps.every((r) => r.status === 200), reps.filter((r) => r.status !== 200).slice(0, 3).map((r) => r.status));
  mesure('déclarer tout hors service', `${reps.length} requêtes en ${Math.round(dt)} ms (${Math.round(dt / reps.length)} ms chacune)`);
  const pub = await lirePublic();
  const nbPizzas = prods.filter((p) => p.kind === 'pizza').length;
  const nbProduits = prods.filter((p) => p.kind === 'product').length;
  ctl(`liste publique : ${nbPizzas} pizzas, ${nbProduits} produits et ${ingredients.length} ingrédients`,
    pub.json.pizzasIndisponibles.length === nbPizzas && pub.json.produitsIndisponibles.length === nbProduits && pub.json.ingredientsIndisponibles.length === ingredients.length,
    `${pub.json.pizzasIndisponibles.length} pizzas, ${pub.json.produitsIndisponibles.length} produits, ${pub.json.ingredientsIndisponibles.length} ingrédients, ${pub.text.length} octets`);
  S.site.db.exec('DELETE FROM throttle');
  const n0 = nbCommandes();
  const res = await enParallele(lignes, 10, async (l, i) => ({ l, r: await envoyer(S.clients[i % S.clients.length], [l.fabrique()]) }));
  const mauvais = res.filter(({ r }) => !estRefusDispo(r));
  ctl(`les ${lignes.length} lignes du catalogue sont toutes refusées (422 unavailable_items) ; ${nbCommandes() - n0} commande enregistrée`, mauvais.length === 0 && nbCommandes() === n0, mauvais.slice(0, 3).map(({ l, r }) => `${l.nom}: ${resume(r)}`));
  // Une commande avec des dizaines de lignes toutes refusées : tous les noms sortent, une fois chacun.
  S.site.db.exec('DELETE FROM throttle');
  const pizzasCmd = lignes.filter((l) => l.kind === 'pizza' && !l.nom.includes('—')).slice(0, 12);
  const grosse = await envoyer(client(), pizzasCmd.map((l) => l.fabrique()));
  ctl('une commande de 12 pizzas toutes hors service : les 12 noms sont nommés, une fois chacun', estRefusDispo(grosse) && new Set(grosse.json.unavailable).size === 12 && grosse.json.unavailable.length === 12, resume(grosse));
  // Tout remettre.
  const t1 = maintenant();
  const rem = await enParallele([...prods.map((p) => [p.kind, p.name]), ...ingredients.map((i) => ['ingredient', i])], 6, ([k, n]) => bascule(patron, k, n, 'available'));
  mesure('tout remettre disponible', `${rem.length} requêtes en ${Math.round(maintenant() - t1)} ms`);
  ctl('tout remis : 200 partout', rem.every((r) => r.status === 200), rem.filter((r) => r.status !== 200).slice(0, 3).map((r) => r.status));
  const pub2 = await lirePublic();
  ctl('liste publique vide de nouveau', pub2.json.pizzasIndisponibles.length === 0 && pub2.json.produitsIndisponibles.length === 0 && pub2.json.ingredientsIndisponibles.length === 0, pub2.json);
  S.site.db.exec('DELETE FROM throttle');
  const res2 = await enParallele(lignes, 10, async (l, i) => ({ l, r: await envoyer(S.clients[i % S.clients.length], [l.fabrique()]) }));
  const mauvais2 = res2.filter(({ r }) => r.status !== 201);
  ctl(`les ${lignes.length} lignes du catalogue repassent toutes (201)`, mauvais2.length === 0, mauvais2.slice(0, 3).map(({ l, r }) => `${l.nom}: ${resume(r)}`));
  reinit();
}

/** Écritures du patron en concurrence sur une même entrée. */
async function apiConcurrence() {
  titre('API 6 — écritures concurrentes du patron sur les mêmes entrées');
  reinit();
  const patrons = [S.patron, ...await Promise.all([1, 2, 3].map((i) => patronConnecte('10.250.7.' + i)))];
  const lignesCount = (k, n) => Number(S.site.db.prepare('SELECT COUNT(*) AS n FROM availability WHERE kind = ? AND name = ?').get(k, n).n);
  // 60 écritures identiques simultanées d'une entrée neuve : course entre UPDATE et INSERT.
  let reps = await enParallele(Array.from({ length: 60 }, (_, i) => i), 60, (i) => bascule(patrons[i % 4], 'pizza', 'Régina', 'out_manual'));
  ctl('60 écritures simultanées de la même entrée neuve : toutes 200 (pas de 500 sur la contrainte d\'unicité)', reps.every((r) => r.status === 200), [...new Set(reps.map((r) => r.status))]);
  ctl('… et une seule ligne en base', lignesCount('pizza', 'Régina') === 1, lignesCount('pizza', 'Régina'));
  // 120 écritures mêlées sur 3 entrées, 4 sessions.
  const statuts = ['out_manual', 'out_today', 'available'];
  const cibles = [['pizza', 'Kebab'], ['ingredient', 'thon'], ['pizza', 'Napolitaine']];
  const r2 = rngSimple(77);
  reps = await enParallele(Array.from({ length: 120 }, (_, i) => i), 40, (i) => bascule(patrons[i % 4], cibles[i % 3][0], cibles[i % 3][1], statuts[r2() % 3]));
  ctl('120 écritures mêlées (hors service / aujourd\'hui / disponible) sur 4 sessions : toutes 200', reps.every((r) => r.status === 200), [...new Set(reps.map((r) => r.status))]);
  const doublons = S.site.db.prepare('SELECT kind, name, COUNT(*) AS n FROM availability GROUP BY kind, name HAVING COUNT(*) > 1').all();
  ctl('… aucune entrée en double en base', doublons.length === 0, doublons);
  const pub = await lirePublic();
  const out = (await S.patron.get('owner_availability.php')).json.out;
  ctl('… et la lecture publique est cohérente avec celle du patron', memeListe(pub.json.pizzasIndisponibles, out.filter((e) => e.kind === 'pizza').map((e) => e.name)) && memeListe(pub.json.ingredientsIndisponibles, out.filter((e) => e.kind === 'ingredient').map((e) => e.name)), out);
  // 300 lectures publiques simultanées pendant que le patron écrit.
  const pubs = [];
  const ecr = (async () => { for (let i = 0; i < 40; i++) await bascule(patrons[1], 'pizza', 'Régina', i % 2 ? 'available' : 'out_manual'); })();
  const lect = enParallele(Array.from({ length: 300 }, (_, i) => i), 60, async () => { const a = maintenant(); const r = await lirePublic(); pubs.push(maintenant() - a); return r; });
  const rl = await lect;
  await ecr;
  ctl('300 lectures publiques simultanées pendant des écritures : toutes 200, JSON valide, deux listes', rl.every((r) => r.status === 200 && r.json && Array.isArray(r.json.pizzasIndisponibles) && Array.isArray(r.json.ingredientsIndisponibles)), [...new Set(rl.map((r) => r.status))]);
  mesure('lecture publique (60 en parallèle)', `médiane ${Math.round(percentile(pubs, 50))} ms, p95 ${Math.round(percentile(pubs, 95))} ms, max ${Math.round(Math.max(...pubs))} ms`);
  reinit();
}

function rngSimple(graine) {
  let a = graine >>> 0;
  return () => { a = (a * 1664525 + 1013904223) >>> 0; return (a >>> 8) % 1000; };
}

/** Rejeu, clé d'idempotence et indisponibilité. */
async function apiRejeu() {
  titre('API 7 — rejeu d\'une commande et indisponibilité');
  const { patron } = S;
  reinit();
  const c = client();
  const lignes = [ligne('Régina', 'Solo'), ligne('Canette Oasis pomme poire', '')];
  const b = corps(lignes, { cle: 'rejeu-' + Date.now().toString(36) + '-a' });
  let r1 = await c.post('order_create.php', b);
  ctl('commande valide : 201', r1.status === 201, resume({ ...r1, rep: r1 }));
  await pose(patron, 'pizza', 'Régina', 'out_manual');
  const n0 = nbCommandes();
  let r2 = await c.post('order_create.php', b);
  ctl('même clé, même corps, après mise hors service : 200 « rejeu » de la commande existante (pas de refus, pas de doublon)', r2.status === 200 && r2.json.replayed === true && r2.json.order.id === r1.json.order.id && nbCommandes() === n0, `${r2.status} replayed=${r2.json && r2.json.replayed}`);
  const autre = { ...b, items: [ligne('Kebab', 'Solo')] };
  autre.total_cents = 1100; autre.delivery_fee_cents = 0;
  let r3 = await c.post('order_create.php', autre);
  ctl('même clé, contenu différent : 409 idempotency_conflict (avant toute vérification de disponibilité)', r3.status === 409 && r3.json.error === 'idempotency_conflict', `${r3.status} ${r3.json && r3.json.error}`);
  // Un refus n'use pas la clé.
  const cle2 = 'rejeu-' + Date.now().toString(36) + '-b';
  const b2 = corps([ligne('Régina', 'Duo')], { cle: cle2 });
  let r4 = await c.post('order_create.php', b2);
  ctl('commande refusée (Régina hors service)', estRefusDispo({ status: r4.status, json: r4.json }), r4.status);
  await pose(patron, 'pizza', 'Régina', 'available');
  let r5 = await c.post('order_create.php', b2);
  ctl('même clé et même corps après remise disponible : 201 (le refus n\'a pas consommé la clé)', r5.status === 201 && r5.json.replayed === false, `${r5.status} replayed=${r5.json && r5.json.replayed}`);
  // 25 envois simultanés de la même commande pendant que le patron bascule : une seule commande au plus.
  S.site.db.exec('DELETE FROM throttle');
  const b3 = corps([ligne('Neptune', 'Duo')], { cle: 'rejeu-' + Date.now().toString(36) + '-c' });
  const c2 = client();
  const bascules = (async () => { for (let i = 0; i < 12; i++) { await bascule(patron, 'pizza', 'Neptune', i % 2 ? 'available' : 'out_manual'); await attendre(2); } await bascule(patron, 'pizza', 'Neptune', 'available'); })();
  const envois = await enParallele(Array.from({ length: 12 }, (_, i) => i), 12, () => c2.post('order_create.php', b3));
  await bascules;
  const created = envois.filter((x) => x.status === 201).length;
  const replays = envois.filter((x) => x.status === 200 && x.json.replayed).length;
  const refus = envois.filter((x) => x.status === 422).length;
  const ids = new Set(envois.filter((x) => x.json && x.json.order).map((x) => x.json.order.id));
  ctl(`12 envois simultanés du même corps pendant des bascules : au plus une commande créée (${created} créée, ${replays} rejeu, ${refus} refus)`, created <= 1 && ids.size <= 1 && created + replays + refus === 12, envois.map((x) => x.status));
  reinit();
}

/** Rafale stable : 100 clients, résultat attendu exact pour chaque commande (état figé). */
async function apiRafaleStable() {
  titre('API 8 — rafale de 100 clients sur un état de disponibilité figé : résultat exact de chaque commande');
  const { patron } = S;
  reinit();
  await pose(patron, 'pizza', 'Régina', 'out_manual');
  await pose(patron, 'pizza', 'Napolitaine', 'out_today');
  await pose(patron, 'ingredient', 'champignons', 'out_manual');
  await pose(patron, 'ingredient', 'thon', 'out_today');
  await pose(patron, 'product', 'Bolognaise', 'out_manual');
  await pose(patron, 'product', 'Canette Oasis pomme poire', 'out_today');
  // Chaque « modèle » : lignes, verdict attendu, noms attendus.
  const M = [
    { id: 'ok-1', lignes: () => [ligne('Kebab', 'Duo'), ligne('Pâtes Carbonara', ''), ligne('Maxi Coca', '')], att: null },
    { id: 'ok-2', lignes: () => [ligne('Calzone (soufflée) — Jambon', 'Duo'), ligne('3 Jambons', 'Quatro', { half: ['3 Jambons', 'Carnivora'] })], att: null },
    { id: 'ok-3', lignes: () => [ligne('Carolina', 'Solo', { extras: ['olives', 'miel'] }), ligne('Subitowich Milano', '', { qty: 2 })], att: null },
    { id: 'ko-pizza', lignes: () => [ligne('Régina', 'Solo')], att: { noms: ['Régina'], ing: ['champignons'] } },
    { id: 'ko-pizza-2', lignes: () => [ligne('Napolitaine', 'Duo'), ligne('Kebab', 'Solo')], att: { noms: ['Napolitaine'], ing: [] } },
    { id: 'ko-ingredient', lignes: () => [ligne('Végétarienne', 'Solo')], att: { noms: ['Végétarienne'], ing: ['champignons'] } },
    { id: 'ko-supplement', lignes: () => [ligne('Kebab', 'Duo', { extras: ['thon'] })], att: { noms: ['thon'], ing: ['thon'] } },
    { id: 'ko-calzone', lignes: () => [ligne('Calzone (soufflée) — Thon', 'Duo'), ligne('Calzone (soufflée) — Poulet', 'Duo')], att: { noms: ['Calzone (soufflée) — Thon'], ing: ['thon'] } },
    { id: 'ko-moitie', lignes: () => [ligne('Kebab', 'Duo', { half: ['Kebab', 'Régina'] })], att: { noms: ['Régina'], ing: ['champignons'] } },
    { id: 'ko-produit', lignes: () => [ligne('Pâtes Bolognaise', ''), ligne('Canette Oasis pomme poire', '', { qty: 3 })], att: { noms: ['Pâtes Bolognaise', 'Canette Oasis pomme poire'], ing: [] } },
    { id: 'ko-multiple', lignes: () => [ligne('Régina', 'Solo'), ligne('Campione', 'Duo'), ligne('Neptune', 'Solo'), ligne('Pâtes Bolognaise', ''), ligne('Kebab', 'Solo', { extras: ['champignons'] }), ligne('Carnivora', 'Duo')], att: { noms: ['Régina', 'Campione', 'Neptune', 'Pâtes Bolognaise', 'champignons'], ing: ['champignons', 'thon'] } },
    { id: 'ko-livraison', lignes: () => [ligne('Régina', 'XXL'), ligne('Kebab', 'Duo')], att: { noms: ['Régina'], ing: ['champignons'] }, livraison: true }
  ];
  const taches = [];
  S.clients.forEach((c, i) => {
    const a = M[i % 3];                                   // une commande valide
    const b = M[3 + (i % (M.length - 3))];                // une commande refusée
    const d = M[3 + ((i * 5 + 2) % (M.length - 3))];      // une autre commande refusée
    for (const m of [a, b, d]) taches.push({ c, m });
  });
  const n0 = nbCommandes();
  const maxId0 = Number(S.site.db.prepare('SELECT COALESCE(MAX(id), 0) AS m FROM orders').get().m);
  const t0 = maintenant();
  const res = await enParallele(taches, 40, async ({ c, m }) => {
    const o = m.livraison ? { mode: 'delivery', ville: c.ville, paiements: ['card'] } : {};
    return { m, c, r: await envoyer(c, m.lignes(), o) };
  });
  const dt = maintenant() - t0;
  const faux = [];
  let acceptees = 0;
  for (const { m, r } of res) {
    if (m.att === null) { if (r.status === 201) acceptees++; else faux.push(`${m.id}: ${resume(r)}`); }
    else if (!(estRefusDispo(r) && memeListe(r.json.unavailable, m.att.noms) && memeListe(r.json.unavailable_ingredients, m.att.ing))) faux.push(`${m.id}: ${resume(r)}`);
  }
  ctl(`${res.length} commandes de 100 clients (40 en parallèle) : chacune a le résultat exact attendu`, faux.length === 0, faux.length ? faux.slice(0, 5) : `${acceptees} acceptées, ${res.length - acceptees} refusées`);
  ctl('base de données : exactement les commandes acceptées, aucune refusée enregistrée', nbCommandes() - n0 === acceptees, `${nbCommandes() - n0} en base / ${acceptees} acceptées`);
  mesure('rafale figée', `${res.length} commandes en ${Math.round(dt)} ms (${Math.round(dt / res.length)} ms / commande)`);
  // Relecture de la base : aucune ligne enregistrée (nom, moitié, supplément) n'est bloquée par l'état figé.
  const bd = S.site.db.prepare('SELECT i.name, i.half_json, i.extras_json FROM order_items i WHERE i.order_id > ?').all(maxId0);
  const OUT = { pizzas: ['Régina', 'Napolitaine'], produits: ['Bolognaise', 'Canette Oasis pomme poire'], ingredients: ['champignons', 'thon'] };
  const interdits = bd.map((x) => [x, ligneStockeeCauses(x, OUT)]).filter(([, c]) => c.length);
  ctl(`relecture de la base : les ${bd.length} lignes enregistrées par la rafale sont toutes légitimes (nom, moitié, suppléments)`, interdits.length === 0, interdits.slice(0, 4).map(([x, c]) => `${x.name} : ${c}`));
  reinit();
}

/* =====================================================================================================================
 * Phase « flip » : 100 clients commandent pendant que le patron bascule en continu. Verdict par intervalles certains.
 * ===================================================================================================================== */
// Modèles de lignes. « bloqueurs » : entrées dont la mise hors service bloque la ligne (S = stable hors service, F = bascule),
// avec le nom attendu dans « unavailable » et l'ingrédient attendu dans « unavailable_ingredients ».
const ENTREES = {
  F1: { kind: 'pizza', name: 'Régina', hors: 'out_manual', pauseMin: 120, pauseMax: 380 },
  F2: { kind: 'pizza', name: 'Napolitaine', hors: 'out_today', pauseMin: 3, pauseMax: 25 },
  F3: { kind: 'ingredient', name: 'artichauts', hors: 'out_manual', pauseMin: 150, pauseMax: 420 },
  F4: { kind: 'ingredient', name: 'thon', hors: 'out_today', pauseMin: 4, pauseMax: 30 },
  F5: { kind: 'product', name: 'Canette Oasis pomme poire', hors: 'out_manual', pauseMin: 100, pauseMax: 350 },
  F6: { kind: 'product', name: 'Tiramisubito Oreo', hors: 'out_today', pauseMin: 6, pauseMax: 40 }
};
const STABLES = [
  { id: 'S1', kind: 'pizza', name: 'Kebab', statut: 'out_manual' },
  { id: 'S2', kind: 'ingredient', name: 'maïs', statut: 'out_manual' },
  { id: 'S3', kind: 'product', name: 'Carbonara', statut: 'out_today' },
  { id: 'S4', kind: 'ingredient', name: 'miel', statut: 'out_manual' }
];
const MODELES = [
  // libres : jamais bloquées
  { id: 'libre-veg', f: () => ligne('Végétarienne', 'Solo'), b: {} },
  { id: 'libre-3j', f: () => ligne('3 Jambons', 'Duo'), b: {} },
  { id: 'libre-campione', f: () => ligne('Campione', 'Solo'), b: {} },
  { id: 'libre-calz-jambon', f: () => ligne('Calzone (soufflée) — Jambon', 'Solo'), b: {} },
  { id: 'libre-bolo', f: () => ligne('Pâtes Bolognaise', ''), b: {} },
  { id: 'libre-milano', f: () => ligne('Subitowich Milano', '', { qty: 2 }), b: {} },
  { id: 'libre-gb', f: () => ligne('Maxi Coca', ''), b: {} },
  { id: 'libre-sp', f: () => ligne('Dessert Tiramisubito Spéculoos', ''), b: {} },
  { id: 'libre-nug', f: () => ligne('Tex-Mex Nuggets (4 pièces)', ''), b: {} },
  { id: 'libre-4f', f: () => ligne('4 Fromages', 'Quatro', { extras: ['olives'] }), b: {} },
  // bascules
  { id: 'F1-reg', f: () => ligne('Régina', 'Solo'), b: { F1: { nom: 'Régina' } } },
  { id: 'F1-reg-moitie', f: () => ligne('Régina', 'Duo', { half: ['Régina', 'Végétarienne'] }), b: { F1: { nom: 'Régina' } } },
  { id: 'F1-veg-moitie', f: () => ligne('Végétarienne', 'Duo', { half: ['Végétarienne', 'Régina'] }), b: { F1: { nom: 'Régina' } } },
  { id: 'F2-nap', f: () => ligne('Napolitaine', 'Quatro'), b: { F2: { nom: 'Napolitaine' } } },
  { id: 'F3-4saisons', f: () => ligne('4 Saisons', 'Solo'), b: { F3: { nom: '4 Saisons', ing: 'artichauts' } } },
  { id: 'F3-extra', f: () => ligne('Campione', 'Duo', { extras: ['artichauts'] }), b: { F3: { nom: 'artichauts', ing: 'artichauts' } } },
  { id: 'F4-nep', f: () => ligne('Neptune', 'Duo'), b: { F4: { nom: 'Neptune', ing: 'thon' } } },
  { id: 'F4-calz', f: () => ligne('Calzone (soufflée) — Thon', 'Solo'), b: { F4: { nom: 'Calzone (soufflée) — Thon', ing: 'thon' } } },
  { id: 'F4-rome', f: () => ligne('Subitowich Rome', ''), b: { F4: { nom: 'Subitowich Rome', ing: 'thon' } } },
  { id: 'F5-boi', f: () => ligne('Canette Oasis pomme poire', '', { qty: 2 }), b: { F5: { nom: 'Canette Oasis pomme poire' } } },
  { id: 'F6-oreo', f: () => ligne('Dessert Tiramisubito Oreo', ''), b: { F6: { nom: 'Dessert Tiramisubito Oreo' } } },
  { id: 'F1F3-reg-art', f: () => ligne('Régina', 'Duo', { extras: ['artichauts'] }), b: { F1: { nom: 'Régina' }, F3: { nom: 'artichauts', ing: 'artichauts' } } },
  // stables hors service : toujours refusées
  { id: 'S1-keb', f: () => ligne('Kebab', 'Solo'), b: { S1: { nom: 'Kebab' } } },
  { id: 'S1-moitie', f: () => ligne('3 Jambons', 'Duo', { half: ['3 Jambons', 'Kebab'] }), b: { S1: { nom: 'Kebab' } } },
  { id: 'S2-exo', f: () => ligne('Salade Exotique', ''), b: { S2: { nom: 'Salade Exotique', ing: 'maïs' } } },
  { id: 'S3-carbo', f: () => ligne('Pâtes Carbonara', ''), b: { S3: { nom: 'Pâtes Carbonara' } } },
  { id: 'S4-chm', f: () => ligne('Chèvre miel', 'Solo'), b: { S4: { nom: 'Chèvre miel', ing: 'miel' } } },
  { id: 'S4-extra', f: () => ligne('Carnivora', 'Duo', { extras: ['miel'] }), b: { S4: { nom: 'miel', ing: 'miel' } } }
];

/**
 * Une manche : le patron bascule en continu pendant que les clients commandent et que des lecteurs lisent la liste publique.
 * Verdict a posteriori par intervalles : un état est « certain » pour une requête si la bascule qui l'a posé était déjà terminée
 * à l'envoi et si la suivante n'était pas encore partie à la réponse.
 */
const sousEnsemble = (ok) => MODELES.filter((m) => ok(Object.keys(m.b)));
const LIBRES = sousEnsemble((b) => b.length === 0);
const LENTS = sousEnsemble((b) => b.length > 0 && b.every((x) => ['F1', 'F3', 'F5'].includes(x)));
const RAPIDES = sousEnsemble((b) => b.length > 0 && b.every((x) => ['F2', 'F4', 'F6'].includes(x)));
const STABLES_M = sousEnsemble((b) => b.some((x) => x.startsWith('S')));

async function executerFlip(nom, cfg) {
  titre(`FLIP ${nom} — ${cfg.commandesParClient} commandes pour chacun des 100 clients, ${cfg.concurrence} clients à la fois, patron en bascule continue, ${cfg.lecteurs} lecteur(s) public(s)`);
  reinit();
  const nbPatrons = 3;
  const patrons = await Promise.all(Array.from({ length: nbPatrons }, (_, i) => patronConnecte('10.250.9.' + (i + 1 + (cfg.decalageIp || 0)))));
  for (const e of STABLES) await pose(patrons[0], e.kind, e.name, e.statut);
  const chrono = new Chronologie();
  const toutes = Object.entries(ENTREES).map(([id, e]) => ({ id, ...e, pauseMin: cfg.pauses[id][0], pauseMax: cfg.pauses[id][1] }));
  const parPatron = [[], [], []];
  toutes.forEach((e, i) => parPatron[i % nbPatrons].push(e));
  const flippers = parPatron.map((liste, i) => demarrerBascules(patrons[i], liste, chrono, 100 + i + (cfg.graine || 0)));

  // Lecteurs publics : on garde chaque lecture, le verdict vient après l'arrêt des bascules.
  const lectures = [];
  const anomaliesLecture = [];
  let finLecteurs = false;
  const lecteur = async () => {
    const c = anonyme();
    while (!finLecteurs) {
      const a = maintenant();
      const r = await lirePublic(c);
      const b = maintenant();
      if (r.status !== 200 || !r.json) { anomaliesLecture.push('lecture ' + r.status); continue; }
      lectures.push({ a, b, pizza: r.json.pizzasIndisponibles, ingredient: r.json.ingredientsIndisponibles });
      if (cfg.pauseLecteur) await attendre(cfg.pauseLecteur);
    }
  };
  const lecteursEnCours = Array.from({ length: cfg.lecteurs }, () => lecteur());

  S.marque = S.site.journal().length;
  const maxId0 = Number(S.site.db.prepare('SELECT COALESCE(MAX(id), 0) AS m FROM orders').get().m);
  const n0 = nbCommandes();
  const resultats = [];
  const t0 = maintenant();
  await enParallele(S.clients.map((c, ci) => ({ c, ci })), cfg.concurrence, async ({ c, ci }) => {
    const rand = rngSimple(2026 + ci + (cfg.graine || 0));
    for (let k = 0; k < cfg.commandesParClient; k++) {
      const tirer = (liste) => liste[rand() % liste.length];
      const t = rand() % 100;
      let choisis;
      if (t < 55) choisis = [tirer(LENTS)];
      else if (t < 65) choisis = [tirer(RAPIDES)];
      else if (t < 75) choisis = [tirer(STABLES_M)];
      else if (t < 88) choisis = [tirer(LIBRES)];
      else choisis = [tirer(MODELES), tirer(MODELES)];
      if (rand() % 100 < 40) choisis.push(tirer(LIBRES));
      if (rand() % 100 < 15) choisis.push(tirer(LIBRES));
      // Livraison pour un quart des commandes : une pizza XXL libre garantit le minimum de n'importe quelle ville.
      const livraison = rand() % 4 === 0;
      const lignes = choisis.map((m) => m.f());
      if (livraison) lignes.push(ligne('3 Jambons', 'XXL'));
      const o = livraison ? { mode: 'delivery', ville: c.ville, paiements: ['card'] } : {};
      const r = await envoyer(c, lignes, o);
      resultats.push({ r, modeles: choisis, ci, k, livraison });
    }
  });
  const duree = maintenant() - t0;
  finLecteurs = true;
  await Promise.all(lecteursEnCours);
  const st = await Promise.all(flippers.map((f) => f.arreter()));
  const bascules = st.reduce((s, x) => s + x.bascules, 0);

  // ----- verdict des lectures publiques -----
  let verifLectures = 0;
  for (const l of lectures) {
    for (const [id, e] of Object.entries(ENTREES)) {
      if (e.kind === 'product') continue;
      const cert = chrono.certitude(`${e.kind}|${e.name}`, l.a, l.b);
      const present = l[e.kind].includes(e.name);
      if (cert === 'hors') { verifLectures++; if (!present) anomaliesLecture.push(`${id} certainement hors service mais absent de la liste publique`); }
      else if (cert === 'dispo') { verifLectures++; if (present) anomaliesLecture.push(`${id} certainement disponible mais présent dans la liste publique`); }
    }
    for (const s of STABLES) if (s.kind !== 'product' && !l[s.kind].includes(s.name)) anomaliesLecture.push(`${s.id} stable hors service absent de la liste publique`);
  }

  // ----- verdict des commandes -----
  const stats = { total: resultats.length, accepte: 0, refus: 0, autre: [], certainHors201: [], certainLibre422: [], stableAccepte: [], nomsFaux: [], certHors: 0, certLibre: 0, incertains: 0 };
  for (const x of resultats) {
    const { r, modeles } = x;
    const etiquette = modeles.map((m) => m.id).join('+');
    const bloqueursStables = new Set();
    const bloqueursFlip = new Set();
    for (const m of modeles) for (const id of Object.keys(m.b)) (id.startsWith('S') ? bloqueursStables : bloqueursFlip).add(id);
    let certHors = false;
    let toutCertLibre = true;
    for (const id of bloqueursFlip) {
      const e = ENTREES[id];
      const cert = chrono.certitude(`${e.kind}|${e.name}`, r.a, r.b);
      if (cert === 'hors') certHors = true;
      if (cert !== 'dispo') toutCertLibre = false;
    }
    if (r.status === 201) {
      stats.accepte++;
      if (bloqueursStables.size) stats.stableAccepte.push(etiquette);
      if (certHors) stats.certainHors201.push(etiquette);
    } else if (estRefusDispo(r)) {
      stats.refus++;
      // noms possibles = noms des bloqueurs en jeu ; noms obligatoires = ceux des bloqueurs stables ou certainement hors service
      const possibles = new Set();
      const obligatoires = new Set();
      const ingPossibles = new Set();
      for (const m of modeles) for (const [id, b] of Object.entries(m.b)) {
        possibles.add(b.nom); if (b.ing) ingPossibles.add(b.ing);
        const e = ENTREES[id] || STABLES.find((s) => s.id === id);
        if (id.startsWith('S')) obligatoires.add(b.nom);
        else if (chrono.certitude(`${e.kind}|${e.name}`, r.a, r.b) === 'hors') obligatoires.add(b.nom);
      }
      const noms = r.json.unavailable;
      const ok = noms.every((n) => possibles.has(n)) && [...obligatoires].every((n) => noms.includes(n))
        && r.json.unavailable_ingredients.every((i) => ingPossibles.has(i));
      if (!ok) stats.nomsFaux.push(`${etiquette} -> ${JSON.stringify(noms)} / ing ${JSON.stringify(r.json.unavailable_ingredients)}`);
      if (bloqueursStables.size === 0 && toutCertLibre) stats.certainLibre422.push(`${etiquette} : ${JSON.stringify(noms)}`);
    } else {
      stats.autre.push(`${r.status} ${court(r.rep.text, 100)}`);
    }
    if (bloqueursStables.size === 0 && bloqueursFlip.size > 0) { if (certHors) stats.certHors++; else if (toutCertLibre) stats.certLibre++; else stats.incertains++; }
  }
  const p = `FLIP ${nom} :`;
  ctl(`${p} ${stats.total} commandes de 100 clients : toutes répondent 201 ou 422 unavailable_items (aucun 4xx / 5xx inattendu, pas de limite de débit)`, stats.autre.length === 0, stats.autre.slice(0, 4));
  ctl(`${p} aucune commande avec un article STABLEMENT hors service n'a été acceptée`, stats.stableAccepte.length === 0, stats.stableAccepte.slice(0, 5));
  ctl(`${p} aucune commande acceptée alors qu'un article était CERTAINEMENT hors service pendant tout l'envoi (bascule terminée avant l'envoi, suivante partie après la réponse)`, stats.certainHors201.length === 0, stats.certainHors201.slice(0, 5));
  ctl(`${p} aucune commande refusée à tort alors que tout était CERTAINEMENT disponible pendant tout l'envoi (pas de lecture périmée)`, stats.certainLibre422.length === 0, stats.certainLibre422.slice(0, 5));
  ctl(`${p} chaque refus nomme exactement les articles concernés (obligatoires présents, aucun nom étranger)`, stats.nomsFaux.length === 0, stats.nomsFaux.slice(0, 4));
  if (cfg.force) {
    ctl(`${p} force du test : au moins 40 commandes à article bascule envoyées pendant qu'il était CERTAINEMENT hors service`, stats.certHors >= 40, `${stats.certHors}`);
    ctl(`${p} force du test : au moins 40 commandes à article bascule envoyées pendant qu'il était CERTAINEMENT disponible`, stats.certLibre >= 40, `${stats.certLibre}`);
  }
  const incoh = st.flatMap((x) => x.incoherences);
  const errs = st.flatMap((x) => x.erreurs);
  ctl(`${p} ${bascules} bascules du patron (3 sessions, 6 entrées) : toutes 200 et chaque réponse décrit l'état écrit`, errs.length === 0 && incoh.length === 0 && bascules > 20, [...errs, ...incoh].slice(0, 4));
  ctl(`${p} ${lectures.length} lectures publiques simultanées : jamais une liste contraire à l'état certain (${verifLectures} vérifications certaines)`, anomaliesLecture.length === 0 && lectures.length > 30, anomaliesLecture.slice(0, 4));
  mesure(`flip ${nom} : commandes`, `${stats.total} envoyées en ${(duree / 1000).toFixed(1)} s : ${stats.accepte} acceptées, ${stats.refus} refusées ; articles bascule : ${stats.certHors} envoyées certainement hors service, ${stats.certLibre} certainement disponibles, ${stats.incertains} pendant une bascule`);
  mesure(`flip ${nom} : bascules`, `${bascules} bascules (réponse la plus lente ${Math.round(Math.max(...st.map((x) => x.latenceMax)))} ms) ; ${lectures.length} lectures publiques, ${verifLectures} vérifications certaines`);

  // ----- relecture de la base -----
  const ids = new Set(resultats.filter((x) => x.r.status === 201).map((x) => x.r.json.order.id));
  const nBd = nbCommandes() - n0;
  ctl(`${p} base de données : ${nBd} commandes ajoutées = ${ids.size} acceptées (aucune commande fantôme, aucune perdue)`, nBd === ids.size, `${nBd} / ${ids.size}`);
  const sansLigne = S.site.db.prepare('SELECT o.id FROM orders o WHERE o.id > ? AND NOT EXISTS (SELECT 1 FROM order_items i WHERE i.order_id = o.id)').all(maxId0);
  ctl(`${p} toute commande enregistrée a au moins une ligne (transaction complète)`, sansLigne.length === 0, sansLigne.slice(0, 5));
  const bd = S.site.db.prepare('SELECT i.name, i.half_json, i.extras_json FROM order_items i WHERE i.order_id > ?').all(maxId0);
  const OUT_STABLE = { pizzas: ['Kebab'], produits: ['Carbonara'], ingredients: ['maïs', 'miel'] };
  const interdits = bd.map((x) => [x, ligneStockeeCauses(x, OUT_STABLE)]).filter(([, c]) => c.length);
  ctl(`${p} relecture de la base : les ${bd.length} lignes enregistrées n'ont aucune cause d'indisponibilité stable (Kebab, Carbonara, maïs, miel : nom, moitié, suppléments)`, interdits.length === 0, interdits.slice(0, 4).map(([x, c]) => `${x.name} : ${c}`));
  // Commandes enregistrées pendant qu'un article bascule : le total enregistré est celui du serveur (aucune ligne tronquée).
  const incoherentes = S.site.db.prepare(`SELECT o.id FROM orders o WHERE o.id > ? AND o.products_cents <> (SELECT COALESCE(SUM(i.line_total_cents), 0) FROM order_items i WHERE i.order_id = o.id)`).all(maxId0);
  ctl(`${p} chaque commande enregistrée : produits = somme de ses lignes`, incoherentes.length === 0, incoherentes.slice(0, 5));
  const doublons = S.site.db.prepare('SELECT customer_id, idempotency_key, COUNT(*) AS n FROM orders GROUP BY customer_id, idempotency_key HAVING COUNT(*) > 1').all();
  ctl(`${p} aucune clé d'idempotence en double`, doublons.length === 0, doublons.slice(0, 3));
  ctl(`${p} journal serveur : aucune erreur 500 pendant la manche`, !/server_error/.test(S.site.journal().slice(S.marque)), S.site.journal().slice(S.marque).trim().slice(0, 300) || '(vide)');
  // Les bascules se sont arrêtées : l'état final est celui de la dernière réponse de chaque entrée.
  const sortie = (await patrons[0].get('owner_availability.php')).json.out;
  let ecartFinal = 0;
  for (const [, e] of Object.entries(ENTREES)) {
    const l = chrono.liste.get(`${e.kind}|${e.name}`);
    const dernier = l[l.length - 1].etat;
    const present = sortie.some((x) => x.kind === e.kind && x.name === e.name);
    if ((dernier === 'hors') !== present) ecartFinal++;
  }
  ctl(`${p} état final lu par le patron = dernière bascule acceptée de chaque entrée`, ecartFinal === 0, `${ecartFinal} écart(s)`);
  reinit();
}

async function phaseFlip() {
  // Manche A (mesurée) : 4 clients à la fois (envois d'une centaine de ms), états de longue durée pour les entrées « lentes »
  // (F1, F3, F5) afin que beaucoup d'envois aient un état CERTAIN ; les entrées « rapides » (F2, F4, F6) bousculent le serveur.
  await executerFlip('A (états certains)', {
    concurrence: 3, commandesParClient: 5, lecteurs: 1, pauseLecteur: 20, force: true, graine: 0,
    pauses: { F1: [200, 500], F2: [2, 25], F3: [250, 550], F4: [3, 30], F5: [200, 450], F6: [4, 35] }
  });
  // Manche B (brutale) : les 100 clients à la fois, toutes les bascules rapides, 4 lecteurs publics en continu.
  await executerFlip('B (brutale)', {
    concurrence: 50, commandesParClient: 2, lecteurs: 4, pauseLecteur: 0, force: false, graine: 500, decalageIp: 10,
    pauses: { F1: [0, 12], F2: [0, 12], F3: [0, 12], F4: [0, 12], F5: [0, 12], F6: [0, 12] }
  });
}

/* =====================================================================================================================
 * Programme
 * ===================================================================================================================== */
async function main() {
  if (PHASES.has('temps')) await proteger('temps', phaseTemps);

  if (['api', 'flip', 'nav'].some((p) => PHASES.has(p))) {
    const jour = jourParis(Math.floor(Date.now() / 1000));
    // Jour figé : midi à Paris du jour courant (10:00 UTC est toujours entre 11:00 et 12:00 à Paris).
    const site = await demarrerSite({ horloge: epoch(jour + 'T10:00:00Z') });
    S.site = site;
    S.jour = jour;
    try {
      const t0 = Date.now();
      S.clients = await creerClients(100, { concurrence: 25 });
      await enParallele(S.clients, 25, (c) => definirAdresse(c, c.ville));
      S.patron = await patronConnecte();
      console.log(`site local sur ${site.base}, jour de service figé ${jour} (${sec()}) ; 100 clients et leur adresse en ${Date.now() - t0} ms`);
      ctl('heure du serveur d\'essai : jour de service = jour parisien courant', (await lirePublic()).json.misAJourLe === jour, jour);
      if (PHASES.has('api')) {
        await proteger('api 1', apiBases);
        await proteger('api 2', apiEtats);
        await proteger('api 3', apiMatrice);
        await proteger('api 4', apiBalayages);
        await proteger('api 5', apiTout);
        await proteger('api 6', apiConcurrence);
        await proteger('api 7', apiRejeu);
        await proteger('api 8', apiRafaleStable);
      }
      if (PHASES.has('flip')) await proteger('flip', phaseFlip);
      if (PHASES.has('nav')) await proteger('nav', () => phaseNavigateur(S, { ligne, envoyer, resume, anonyme, lirePublic, pose, bascule, reinit }));
    } finally {
      S.journal = site.journal();
      site.arreter();
    }
  }

  if (reessaisReseau()) mesure('poste d\'essai', `${reessaisReseau()} connexions locales réessayées (ports éphémères de la machine saturés par les autres scripts : EADDRINUSE avant tout envoi)`);
  const b = bilan();
  const dureeS = Math.round((Date.now() - DEBUT) / 1000);
  console.log(`\n==== BILAN : ${b.pass + b.fail} contrôles · ${b.pass} PASS · ${b.fail} FAIL · ${dureeS} s ====`);
  for (const m of b.mesures) console.log('  MESURE ' + m);
  if (b.fail) { console.log('Échecs :'); for (const e of b.echecs) console.log('  - ' + e); }
  process.exit(b.fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error('ERREUR FATALE', e); process.exit(1); });
