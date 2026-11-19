// Batterie 08 — FORCE BRUTE ET LIMITES DE DÉBIT (API, usage abusif).
//   node tests/massif/lancer.mjs tests/massif/08-force-brute-limites.mjs --timeout=480
//
// Tout est local : serveur + base Postgres en mémoire (PGlite) dans ce processus, adresses IP simulées (x-subito-test-ip),
// comptes et codes fabriqués par le script. L'horloge du SERVEUR est pilotée (voyage dans le temps) : date fixe, jamais
// l'heure réelle, donc les délais annoncés (Retry-After) sont exacts et reproductibles.
//
// Sections : 1 connexion client (verrou à 5 échecs) · 2 connexion patron · 3 IPv6 et IPv4 mappée · 4 rafales de 100 tentatives
// simultanées · 5 inscription (10 par heure) · 6 commandes (20 par 10 minutes) · 7 durées « e-mail inconnu » / « mauvais mot de
// passe » · 8 politique de mot de passe et de code · 9 corps hostiles · 10 table throttle sous 5000 adresses · 11 contrôles finaux.
import net from 'node:net';
import { performance } from 'node:perf_hooks';
import { demarrerSite, reponses } from './lib/env.mjs';
import { corpsInscription, enParallele } from './lib/clients.mjs';
import { rng, construireCommande } from './lib/commandes.mjs';
import { throttleIpKey } from '../../serveur/throttle.js';
import {
  bilan, controle, info, mesure, titre, resume, secondesEcoulees, avecDelai, ipNeuve, mediane, moyenne, percentile, fmt,
  compter, texteStatuts, nbCinqCent, appel, lire, rafale, espionBcrypt, verifier429, Client08, creerComptes, transport
} from './lib/08-aides.mjs';

// Date fixe du serveur (2034-06-14 10:00 UTC) : postérieure à l'heure réelle (les cookies persistants du client de test ne
// sont pas jugés expirés) et antérieure à 2038 (colonnes INTEGER de la table throttle).
const T0 = Date.UTC(2034, 5, 14, 10, 0, 0) / 1000;
const site = await demarrerSite({ horloge: T0 });
const espion = espionBcrypt();
let horloge = T0;
function fixerHorloge(epoch) {
  if (epoch < horloge) throw new Error('horloge non monotone');
  horloge = epoch;
  site.fixerHeure(epoch);
}
const ligne = (seau) => site.db.prepare('SELECT attempts, window_start, locked_until FROM throttle WHERE bucket = ?').get(seau);
const nbLignes = () => Number(site.db.prepare('SELECT COUNT(*) AS n FROM throttle').get().n);

// Garde-fou : le script entier doit rester sous 8 minutes (le lanceur coupe à --timeout).
const garde = setTimeout(() => {
  controle('le script termine dans le délai de 420 s', false, 'délai global dépassé : arrêt');
  resume();
  process.exit(1);
}, 420000);
garde.unref();

const mdpFaux = (etiquette, i) => `faux-${etiquette}-${i}-Zz9!`;
const connexionClient = (ip, email, password) => appel('customer_login.php', { email, password }, ip);
const connexionPatron = (ip, code, remember = false) => appel('owner_login.php', { code, remember }, ip);
let seqCompte = 20000;
const corpsNeuf = (extra = {}) => ({ ...corpsInscription(++seqCompte, { ville: null, prefixe: '08x' }), ...extra });

/** Détail d'une exception, cause comprise (« fetch failed » seul n'apprend rien). */
function detailErreur(e) {
  const pile = e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : String(e);
  const cause = e && e.cause ? ` ; cause : ${e.cause.code || ''} ${e.cause.message || e.cause}` : '';
  return pile + cause;
}

// Développement : --seulement=1,4,10 ne joue que ces sections (la 0 est toujours jouée). Sans argument, tout est joué.
const seulement = (process.argv.find((a) => a.startsWith('--seulement=')) || '').slice(12).split(',').filter(Boolean);
async function section(nom, fn) {
  if (seulement.length && !nom.startsWith('0.') && !seulement.includes(nom.split('.')[0])) return;
  titre(nom);
  const debut = Date.now();
  try {
    await fn();
  } catch (e) {
    controle(`${nom} : section menée à son terme`, false, detailErreur(e));
  }
  mesure(`durée de la section « ${nom} » : ${((Date.now() - debut) / 1000).toFixed(1)} s`);
}

let comptes = [];
const hostiles = []; // réponses 5xx provoquées VOLONTAIREMENT par les corps hostiles (section 9) : exclues des contrôles « aucune erreur 5xx »

try {
  // ------------------------------------------------------------------------------------------------ 0. préparation
  await section('0. Préparation', async () => {
    comptes = await creerComptes(10, { debut: 8001, concurrence: 5, prefixe: '08' });
    controle('10 comptes clients fabriqués par l\'inscription (201)', comptes.length === 10 && comptes.every((c) => Number.isInteger(c.customer && c.customer.id)), `${comptes.length} comptes`);
    const p = await connexionPatron(ipNeuve(), site.codePatron);
    controle('le code patron de test ouvre une session (200)', p.status === 200 && p.json && p.json.ok === true, `statut ${p.status}`);
  });
  if (comptes.length !== 10) throw new Error('préparation impossible');
  const [v1, v2, v3, v4] = comptes;

  // ------------------------------------------------------------------------------------------------ 1. connexion client
  await section('1. Connexion client : 5 échecs par adresse -> 429', async () => {
    const t1 = horloge;
    const a1 = ipNeuve();
    const seau1 = 'customer_login:ip:' + a1;
    const cinq = [];
    for (let i = 1; i <= 5; i++) cinq.push(await connexionClient(a1, v1.email, mdpFaux('a1', i)));
    controle('5 mauvais mots de passe depuis une adresse : 5 réponses 401 « invalid_credentials »',
      cinq.every((r) => r.status === 401 && r.json && r.json.error === 'invalid_credentials'), texteStatuts(compter(cinq)));
    controle('les 5 réponses 401 sont identiques (aucune indication sur le rang de la tentative)', new Set(cinq.map((r) => r.text)).size === 1, cinq[0].text);
    const sixieme = await connexionClient(a1, v1.email, mdpFaux('a1', 6));
    verifier429('6e tentative (mauvais mot de passe)', sixieme, 900);
    const bon = await connexionClient(a1, v1.email, v1.password);
    verifier429('BON mot de passe pendant le verrou', bon, 900);
    const moi = await bon.client.get('customer_me.php');
    controle('BON mot de passe pendant le verrou : aucune session ouverte', moi.json && moi.json.customer === null, `customer_me -> ${JSON.stringify(moi.json && moi.json.customer)}`);
    espion.raz();
    const plus = await rafale(20, (i) => connexionClient(a1, v1.email, i % 2 ? v1.password : mdpFaux('a1+', i)));
    controle('20 tentatives de plus pendant le verrou : 20 × 429', plus.statuts[429] === 20, texteStatuts(plus.statuts));
    controle('pendant le verrou : aucun hachage bcrypt exécuté (le verrou protège aussi le processeur)', espion.compare === 0 && espion.hash === 0, `${espion.compare} vérification(s), ${espion.hash} hachage(s)`);
    const rang = ligne(seau1);
    controle('pendant le verrou : compteur figé à 5 et fin de verrou inchangée (les refus ne prolongent rien)',
      rang && rang.attempts === 5 && rang.window_start === t1 && rang.locked_until === t1 + 900, JSON.stringify(rang));

    // Une autre adresse n'est pas touchée.
    const autre = await connexionClient(ipNeuve(), v1.email, v1.password);
    controle('une autre adresse n\'est pas touchée : bon mot de passe -> 200', autre.status === 200 && autre.json.customer && autre.json.customer.email === v1.email, `statut ${autre.status}`);
    const autre401 = await connexionClient(ipNeuve(), v1.email, mdpFaux('autre', 1));
    controle('une autre adresse : un mauvais mot de passe reste un 401 (pas un 429)', autre401.status === 401, `statut ${autre401.status}`);
    // Seaux séparés : l'adresse verrouillée en connexion client peut encore se connecter comme patron et s'inscrire.
    const patron = await connexionPatron(a1, site.codePatron);
    controle('adresse verrouillée en connexion client : la connexion patron reste ouverte (seau séparé)', patron.status === 200, `statut ${patron.status}`);
    const insc = await appel('customer_signup.php', corpsNeuf(), a1);
    controle('adresse verrouillée en connexion client : l\'inscription reste ouverte (seau séparé)', insc.status === 201, `statut ${insc.status}`);

    // Voyage dans le temps : le verrou se lève à +900 s, pas avant.
    fixerHorloge(t1 + 450);
    verifier429('à +450 s', await connexionClient(a1, v1.email, mdpFaux('a1', 7)), 450);
    fixerHorloge(t1 + 899);
    verifier429('à +899 s', await connexionClient(a1, v1.email, v1.password), 1);
    fixerHorloge(t1 + 900);
    const rouvert = await connexionClient(a1, v1.email, v1.password);
    controle('à +900 s : la fenêtre se rouvre, le bon mot de passe passe (200)', rouvert.status === 200 && rouvert.json.ok === true, `statut ${rouvert.status}`);
    const apres = ligne(seau1);
    controle('à +900 s : nouvelle fenêtre, compteur à 0 après la réussite décomptée', apres && apres.attempts === 0 && apres.window_start === t1 + 900 && apres.locked_until === null, JSON.stringify(apres));
    const neuf = [];
    for (let i = 1; i <= 5; i++) neuf.push(await connexionClient(a1, v1.email, mdpFaux('a1n', i)));
    controle('fenêtre rouverte : 5 nouveaux échecs permis (5 × 401)', neuf.every((r) => r.status === 401), texteStatuts(compter(neuf)));
    verifier429('fenêtre rouverte : 6e échec', await connexionClient(a1, v1.email, mdpFaux('a1n', 6)), 900);

    // Le verrou est par adresse, pas par e-mail : 5 e-mails différents (dont inconnus) depuis une même adresse le déclenchent.
    const a3 = ipNeuve();
    const emails = [v1.email, 'inconnu-a@example.test', v2.email, 'inconnu-b@example.test', v3.email];
    const cinqEmails = [];
    for (let i = 0; i < 5; i++) cinqEmails.push(await connexionClient(a3, emails[i], mdpFaux('a3', i)));
    controle('5 e-mails différents (dont inconnus) depuis une adresse : 5 × 401', cinqEmails.every((r) => r.status === 401), texteStatuts(compter(cinqEmails)));
    verifier429('6e tentative, encore un autre e-mail', await connexionClient(a3, v4.email, mdpFaux('a3', 6)), 900);
    // Aucun verrou par e-mail : le titulaire du compte visé depuis d'autres adresses se connecte.
    const titulaire = await connexionClient(ipNeuve(), v2.email, v2.password);
    controle('aucun verrou par e-mail : le titulaire d\'un compte attaqué se connecte depuis une autre adresse (200)', titulaire.status === 200, `statut ${titulaire.status}`);

    // Un bon mot de passe ne remet pas à zéro les échecs commis sur d'autres comptes.
    const a5 = ipNeuve();
    const seau5 = 'customer_login:ip:' + a5;
    const quatre = [];
    for (let i = 1; i <= 4; i++) quatre.push(await connexionClient(a5, v2.email, mdpFaux('a5', i)));
    controle('4 échecs sur le compte B : 4 × 401', quatre.every((r) => r.status === 401), texteStatuts(compter(quatre)));
    const reussite = await connexionClient(a5, v1.email, v1.password);
    controle('puis une réussite sur son propre compte A : acceptée (200)', reussite.status === 200, `statut ${reussite.status}`);
    controle('la réussite ne remet pas le compteur à zéro (compteur = 4)', ligne(seau5).attempts === 4 && ligne(seau5).locked_until === null, JSON.stringify(ligne(seau5)));
    const cinquieme = await connexionClient(a5, v2.email, mdpFaux('a5', 5));
    controle('5e échec cumulé : 401 (verrou posé)', cinquieme.status === 401, `statut ${cinquieme.status}`);
    verifier429('après 4 échecs + 1 réussite + 1 échec : la tentative suivante (bon mot de passe)', await connexionClient(a5, v1.email, v1.password), 900);

    // Les réussites ne comptent pas : un client légitime qui se connecte 8 fois de suite n'est jamais bloqué.
    const a6 = ipNeuve();
    const huit = [];
    for (let i = 0; i < 8; i++) huit.push(await connexionClient(a6, v3.email, v3.password));
    controle('8 connexions réussies de suite depuis une adresse : 8 × 200, jamais de 429', huit.every((r) => r.status === 200), texteStatuts(compter(huit)));
    controle('8 réussites : compteur à 0', ligne('customer_login:ip:' + a6).attempts === 0, JSON.stringify(ligne('customer_login:ip:' + a6)));

    // Les requêtes refusées avant le décompte ne consomment pas le quota (aucun verrouillage possible par un site tiers).
    const a8 = ipNeuve();
    const seau8 = 'customer_login:ip:' + a8;
    const evil = [];
    for (let i = 0; i < 10; i++) evil.push(await appel('customer_login.php', { email: v1.email, password: mdpFaux('a8', i) }, a8, { origin: 'https://site-tiers.example' }));
    controle('10 requêtes d\'une origine étrangère : 10 × 403 « bad_origin »', evil.every((r) => r.status === 403 && r.json.error === 'bad_origin'), texteStatuts(compter(evil)));
    const get = await lire('customer_login.php', a8);
    controle('GET sur la connexion : 405 et en-tête Allow', get.status === 405 && /POST/.test(get.headers.get('allow') || ''), `statut ${get.status}, Allow ${get.headers.get('allow')}`);
    const clientBrut = new Client08('brut', a8);
    const brutes = [
      await clientBrut.post('customer_login.php', undefined, { raw: '{"email":', headers: { 'content-type': 'application/json' } }),
      await clientBrut.post('customer_login.php', undefined, { raw: '[]', headers: { 'content-type': 'application/json' } }),
      await clientBrut.post('customer_login.php', undefined, { raw: JSON.stringify({ email: v1.email, password: 'x' }), headers: { 'content-type': 'text/plain' } })
    ];
    controle('JSON illisible / tableau / mauvais type : 400, 400, 415', brutes.map((r) => r.status).join(',') === '400,400,415', brutes.map((r) => r.status).join(','));
    controle('aucune de ces requêtes refusées en amont n\'a créé ni incrémenté de seau', ligne(seau8) === undefined, JSON.stringify(ligne(seau8)));
    const sain = await connexionClient(a8, v1.email, v1.password);
    controle('cette adresse peut ensuite se connecter normalement (200)', sain.status === 200, `statut ${sain.status}`);

    // Mesure : la fenêtre est fixe. 4 essais en fin de fenêtre + 5 au début de la suivante = 9 vérifications en 900 s.
    const a7 = ipNeuve();
    const debutFenetre = horloge;
    const premiers = [];
    for (let i = 1; i <= 4; i++) premiers.push(await connexionClient(a7, v1.email, mdpFaux('a7', i)));
    fixerHorloge(debutFenetre + 900);
    const suivants = [];
    for (let i = 1; i <= 5; i++) suivants.push(await connexionClient(a7, v1.email, mdpFaux('a7b', i)));
    const verifications = [...premiers, ...suivants].filter((r) => r.status === 401).length;
    mesure(`fenêtre fixe : 4 essais à T puis 5 essais à T+900 s -> ${verifications} vérifications en 900 s (la règle annoncée est 5 échecs / 15 min)`);
    const dernier = await connexionClient(a7, v1.email, mdpFaux('a7b', 6));
    controle('fenêtre fixe : après ces 9 vérifications, la suivante est refusée (429)', dernier.status === 429, `statut ${dernier.status}`);
  });

  // ------------------------------------------------------------------------------------------------ 2. connexion patron
  await section('2. Connexion patron (code) : 5 échecs par adresse -> 429', async () => {
    const t1 = horloge;
    const a1 = ipNeuve();
    const seau1 = 'owner_login:ip:' + a1;
    const cinq = [];
    for (let i = 1; i <= 5; i++) cinq.push(await connexionPatron(a1, mdpFaux('p1', i)));
    controle('5 mauvais codes depuis une adresse : 5 réponses 401 « invalid_credentials »', cinq.every((r) => r.status === 401 && r.json.error === 'invalid_credentials'), texteStatuts(compter(cinq)));
    verifier429('6e tentative (mauvais code)', await connexionPatron(a1, mdpFaux('p1', 6)), 900);
    const bon = await connexionPatron(a1, site.codePatron);
    verifier429('BON code pendant le verrou', bon, 900);
    const me = await bon.client.get('owner_me.php');
    controle('BON code pendant le verrou : aucune session patron ouverte (owner_me -> 401)', me.status === 401, `statut ${me.status}`);
    espion.raz();
    const plus = await rafale(20, (i) => connexionPatron(a1, i % 2 ? site.codePatron : mdpFaux('p1+', i)));
    controle('20 tentatives de plus pendant le verrou : 20 × 429', plus.statuts[429] === 20, texteStatuts(plus.statuts));
    controle('pendant le verrou : aucune vérification bcrypt exécutée', espion.compare === 0, `${espion.compare} vérification(s)`);
    const rang = ligne(seau1);
    controle('pendant le verrou : compteur figé à 5 et fin de verrou inchangée', rang && rang.attempts === 5 && rang.locked_until === t1 + 900, JSON.stringify(rang));
    const autre = await connexionPatron(ipNeuve(), site.codePatron);
    controle('une autre adresse n\'est pas touchée : bon code -> 200', autre.status === 200 && autre.json.ok === true, `statut ${autre.status}`);
    const sessionAutre = await autre.client.get('owner_me.php');
    controle('la session ouverte depuis l\'autre adresse fonctionne (owner_me -> 200)', sessionAutre.status === 200, `statut ${sessionAutre.status}`);
    const clientEnLigne = await connexionClient(a1, v1.email, v1.password);
    controle('adresse verrouillée en connexion patron : la connexion client reste ouverte (seau séparé)', clientEnLigne.status === 200, `statut ${clientEnLigne.status}`);

    fixerHorloge(t1 + 450);
    verifier429('à +450 s', await connexionPatron(a1, site.codePatron), 450);
    fixerHorloge(t1 + 899);
    verifier429('à +899 s', await connexionPatron(a1, site.codePatron), 1);
    fixerHorloge(t1 + 900);
    const rouvert = await connexionPatron(a1, site.codePatron);
    controle('à +900 s : la fenêtre se rouvre, le bon code passe (200)', rouvert.status === 200, `statut ${rouvert.status}`);
    const apres = ligne(seau1);
    controle('à +900 s : compteur à 0 dans une fenêtre neuve', apres && apres.attempts === 0 && apres.window_start === t1 + 900 && apres.locked_until === null, JSON.stringify(apres));
    const neuf = [];
    for (let i = 1; i <= 5; i++) neuf.push(await connexionPatron(a1, mdpFaux('p1n', i)));
    controle('fenêtre rouverte : 5 nouveaux échecs permis (5 × 401)', neuf.every((r) => r.status === 401), texteStatuts(compter(neuf)));
    verifier429('fenêtre rouverte : 6e échec', await connexionPatron(a1, mdpFaux('p1n', 6)), 900);

    // Un bon code ne remet pas à zéro les échecs.
    const a5 = ipNeuve();
    for (let i = 1; i <= 4; i++) await connexionPatron(a5, mdpFaux('p5', i));
    const reussite = await connexionPatron(a5, site.codePatron);
    controle('4 échecs puis le bon code : accepté (200)', reussite.status === 200, `statut ${reussite.status}`);
    controle('le bon code ne remet pas le compteur à zéro (compteur = 4)', ligne('owner_login:ip:' + a5).attempts === 4, JSON.stringify(ligne('owner_login:ip:' + a5)));
    await connexionPatron(a5, mdpFaux('p5', 5));
    verifier429('4 échecs + 1 réussite + 1 échec : la tentative suivante (bon code)', await connexionPatron(a5, site.codePatron), 900);

    // 8 connexions réussies de suite ne verrouillent pas le patron.
    const a6 = ipNeuve();
    const huit = [];
    for (let i = 0; i < 8; i++) huit.push(await connexionPatron(a6, site.codePatron, i % 2 === 0));
    controle('8 connexions patron réussies de suite : 8 × 200', huit.every((r) => r.status === 200), texteStatuts(compter(huit)));

    // 20 adresses différentes : chacune comptée séparément.
    const adresses = Array.from({ length: 20 }, () => ipNeuve());
    const tours = [];
    for (let tour = 1; tour <= 5; tour++) tours.push(await Promise.all(adresses.map((ip) => connexionPatron(ip, mdpFaux('p20-' + tour, 0)))));
    const tous = tours.flat();
    controle('20 adresses × 5 faux codes (100 essais) : chaque essai est vérifié (401), aucun blocage', tous.every((r) => r.status === 401), texteStatuts(compter(tous)));
    const sixiemes = await Promise.all(adresses.map((ip) => connexionPatron(ip, mdpFaux('p20-6', 0))));
    controle('6e essai de chacune des 20 adresses : 20 × 429 (comptage séparé par adresse)', sixiemes.every((r) => r.status === 429), texteStatuts(compter(sixiemes)));
    const compteurs = adresses.map((ip) => ligne('owner_login:ip:' + ip));
    controle('table throttle : 20 lignes distinctes, chacune à 5 tentatives', compteurs.every((l) => l && l.attempts === 5), compteurs.map((l) => l && l.attempts).join(','));
    const legitime = await connexionPatron(ipNeuve(), site.codePatron);
    controle('pendant ce balayage distribué, le vrai patron se connecte depuis une 21e adresse (200)', legitime.status === 200, `statut ${legitime.status}`);
    info('RISQUE DOCUMENTÉ : le verrou est par adresse, sans plafond global. 100 essais de code depuis 20 adresses n\'ont déclenché aucun blocage ; un attaquant distribué (botnet, IPv6) garde ~5 essais par adresse et par 15 min.');
  });

  // ------------------------------------------------------------------------------------------------ 3. IPv6 et IPv4 mappée
  await section('3. IPv6 (/64 partagé) et IPv4 mappée', async () => {
    const base = '2001:db8:aaaa:1';
    const cinq = [];
    for (const ip of [`${base}::1`, `${base}::1`, `${base}::1`, `${base}:ffff:ffff:ffff:ffff`, '2001:0DB8:AAAA:0001:0000:0000:0000:00FF']) cinq.push(await connexionPatron(ip, mdpFaux('v6', cinq.length)));
    controle('IPv6 : 5 échecs répartis sur 3 adresses du même /64 : 5 × 401', cinq.every((r) => r.status === 401), texteStatuts(compter(cinq)));
    verifier429('IPv6 : 6e tentative depuis une 4e adresse du même /64', await connexionPatron(`${base}:1234:5678:9abc:def0`, mdpFaux('v6', 6)), 900);
    verifier429('IPv6 : BON code depuis encore une autre adresse du même /64', await connexionPatron(`${base}:1111::2`, site.codePatron), 900);
    const voisin = await connexionPatron('2001:db8:aaaa:2::1', site.codePatron);
    controle('IPv6 : le /64 voisin (…:2::/64) n\'est pas touché (200)', voisin.status === 200, `statut ${voisin.status}`);
    const lignesV6 = site.db.prepare("SELECT bucket, attempts FROM throttle WHERE bucket LIKE 'owner_login:ip:2001:%'").all();
    controle('IPv6 : un seul seau par /64 (clé « 2001:0db8:aaaa:0001::/64 », 5 tentatives)',
      lignesV6.some((l) => l.bucket === 'owner_login:ip:2001:0db8:aaaa:0001::/64' && l.attempts === 5), JSON.stringify(lignesV6));
    // Même partage du /64 pour la connexion client (5 échecs répartis sur 2 adresses) et pour l'inscription (10 sur 5 adresses).
    const baseC = '2001:db8:bbbb:7';
    const cinqC = [];
    for (const ip of [`${baseC}::a`, `${baseC}::b`, `${baseC}::a`, `${baseC}:0:0:0:c`, `${baseC}::d`]) cinqC.push(await connexionClient(ip, v1.email, mdpFaux('v6c', cinqC.length)));
    controle('IPv6, connexion client : 5 échecs répartis sur 4 adresses du même /64 : 5 × 401', cinqC.every((r) => r.status === 401), texteStatuts(compter(cinqC)));
    verifier429('IPv6, connexion client : 6e tentative depuis une 5e adresse du même /64 (bon mot de passe)', await connexionClient(`${baseC}:9::9`, v1.email, v1.password), 900);
    const baseS = '2001:db8:cccc:9';
    const dixS = [];
    for (let i = 0; i < 10; i++) dixS.push(await appel('customer_signup.php', corpsNeuf(), `${baseS}::${(i % 5) + 1}`));
    controle('IPv6, inscription : 10 inscriptions réparties sur 5 adresses du même /64 : 10 × 201', dixS.every((r) => r.status === 201), texteStatuts(compter(dixS)));
    verifier429('IPv6, inscription : 11e depuis une 6e adresse du même /64', await appel('customer_signup.php', corpsNeuf(), `${baseS}:f::6`), 3600);
    const inscVoisin = await appel('customer_signup.php', corpsNeuf(), '2001:db8:cccc:a::1');
    controle('IPv6, inscription : le /64 voisin n\'est pas touché (201)', inscVoisin.status === 201, `statut ${inscVoisin.status}`);

    // IPv4 mappée : mêmes seaux que l'IPv4.
    const v4 = '198.51.100.7';
    const mixte = [];
    for (const ip of [`::ffff:${v4}`, `::ffff:${v4}`, `::ffff:${v4}`, v4, v4]) mixte.push(await connexionPatron(ip, mdpFaux('map', mixte.length)));
    controle('IPv4 mappée : 3 échecs en « ::ffff:a.b.c.d » + 2 en IPv4 simple : 5 × 401', mixte.every((r) => r.status === 401), texteStatuts(compter(mixte)));
    verifier429('IPv4 mappée : forme hexadécimale « ::ffff:c633:6407 » après le verrou', await connexionPatron('::ffff:c633:6407', site.codePatron), 900);
    verifier429('IPv4 mappée : forme en majuscules « ::FFFF:198.51.100.7 » après le verrou', await connexionPatron(`::FFFF:${v4}`, site.codePatron), 900);
    verifier429('IPv4 simple après le verrou', await connexionPatron(v4, site.codePatron), 900);
    const seauxMappes = site.db.prepare("SELECT bucket, attempts FROM throttle WHERE bucket LIKE 'owner_login:ip:198.51.100.7' OR bucket LIKE 'owner_login:ip:%ffff%'").all();
    controle('IPv4 mappée : un seul seau « owner_login:ip:198.51.100.7 » (5 tentatives), aucun seau « ::ffff »',
      seauxMappes.length === 1 && seauxMappes[0].bucket === 'owner_login:ip:198.51.100.7' && seauxMappes[0].attempts === 5, JSON.stringify(seauxMappes));

    // Notations équivalentes de l'IPv4 mappée écrites sans compression : même hôte, donc même seau attendu.
    for (const [notation, hote] of [['0:0:0:0:0:ffff:', '198.51.100.8'], ['0000:0000:0000:0000:0000:ffff:', '198.51.100.9']]) {
      const lot = [];
      for (let i = 1; i <= 5; i++) lot.push(await connexionPatron(hote, mdpFaux('nota', i)));
      const via = await connexionPatron(notation + hote, site.codePatron);
      controle(`IPv4 mappée écrite « ${notation}${hote} » : même seau que ${hote} (verrouillé -> 429)`, lot.every((r) => r.status === 401) && via.status === 429,
        `5 échecs en IPv4 simple puis la notation mappée -> statut ${via.status}, clé ${throttleIpKey(notation + hote)}`);
    }

    // Balayage de notations (fonction pure, graine fixe) : toutes les écritures d'une même adresse doivent donner la même clé.
    const clef = (ip) => new URL('http://[' + ip + ']/').hostname.slice(1, -1);
    const groupes = (ip) => {
      const [tete, queue] = clef(ip).split('::');
      const a = tete ? tete.split(':') : [];
      const b = queue === undefined ? [] : (queue ? queue.split(':') : []);
      const g = queue === undefined ? a : [...a, ...Array(8 - a.length - b.length).fill('0'), ...b];
      return g.map((x) => parseInt(x, 16));
    };
    const cleAttendue = (ip) => {
      const g = groupes(ip);
      if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return [g[6] >> 8, g[6] & 255, g[7] >> 8, g[7] & 255].join('.');
      return g.slice(0, 4).map((x) => x.toString(16).padStart(4, '0')).join(':') + '::/64';
    };
    const hex = (x, remplir = false, maj = false) => { let s = x.toString(16); if (remplir) s = s.padStart(4, '0'); return maj ? s.toUpperCase() : s; };
    const compresser = (g, fin) => {
      let debut = -1;
      let longueur = 0;
      for (let i = 0; i < fin;) {
        if (g[i] !== 0) { i++; continue; }
        let j = i;
        while (j < fin && g[j] === 0) j++;
        if (j - i > longueur) { debut = i; longueur = j - i; }
        i = j;
      }
      if (longueur < 2) return g.slice(0, fin).map((x) => hex(x)).join(':');
      return g.slice(0, debut).map((x) => hex(x)).join(':') + '::' + g.slice(debut + longueur, fin).map((x) => hex(x)).join(':');
    };
    const pointee = (g) => `${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.${g[7] & 255}`;
    const notations = {
      complete: (g) => g.map((x) => hex(x, true)).join(':'),
      majuscules: (g) => g.map((x) => hex(x, true, true)).join(':'),
      sans_zeros_de_tete: (g) => g.map((x) => hex(x)).join(':'),
      compressee: (g) => compresser(g, 8),
      ipv4_pointee_non_compressee: (g) => g.slice(0, 6).map((x) => hex(x)).join(':') + ':' + pointee(g),
      ipv4_pointee_compressee: (g) => { const p = compresser(g, 6); return (p.endsWith('::') ? p : p + ':') + pointee(g); }
    };
    const r = rng(8888);
    const ecarts = Object.fromEntries(Object.keys(notations).map((k) => [k, { essais: 0, ecarts: 0, exemple: '' }]));
    let invalides = 0;
    for (let n = 0; n < 400; n++) {
      const g = Array.from({ length: 8 }, () => r.entier(0, 0xffff));
      const type = n % 5;
      if (type === 0) { for (let i = 0; i < 5; i++) g[i] = 0; g[5] = 0xffff; } // IPv4 mappée
      if (type === 1) { const d = r.entier(0, 5); const f = r.entier(d + 2, 8); for (let i = d; i < f; i++) g[i] = 0; } // plage de zéros
      if (type === 2) { g[0] = 0x2001; g[1] = 0xdb8; g[4] = 0; g[5] = 0; }
      for (const [nom, fabrique] of Object.entries(notations)) {
        const ecriture = fabrique(g);
        if (!net.isIPv6(ecriture)) { invalides++; continue; }
        const attendu = cleAttendue(ecriture);
        const obtenu = throttleIpKey(ecriture);
        ecarts[nom].essais++;
        if (obtenu !== attendu) { ecarts[nom].ecarts++; if (!ecarts[nom].exemple) ecarts[nom].exemple = `${ecriture} -> ${obtenu} (attendu ${attendu})`; }
      }
    }
    controle('balayage : 400 adresses, toutes écritures valides acceptées par net.isIPv6 (générateur sain)', invalides === 0, `${invalides} écriture(s) invalide(s)`);
    for (const nom of ['complete', 'majuscules', 'sans_zeros_de_tete', 'compressee']) {
      controle(`clé de seau identique à la clé attendue : notation « ${nom} » (${ecarts[nom].essais} adresses)`, ecarts[nom].ecarts === 0, ecarts[nom].ecarts ? `${ecarts[nom].ecarts} écart(s), ex. ${ecarts[nom].exemple}` : 'aucun écart');
    }
    for (const nom of ['ipv4_pointee_non_compressee', 'ipv4_pointee_compressee']) {
      controle(`clé de seau identique à la clé attendue : notation « ${nom} » (${ecarts[nom].essais} adresses)`, ecarts[nom].ecarts === 0, ecarts[nom].ecarts ? `${ecarts[nom].ecarts} écart(s), ex. ${ecarts[nom].exemple}` : 'aucun écart');
    }
  });

  // ------------------------------------------------------------------------------------------------ 4. rafales de 100
  await section('4. 100 tentatives SIMULTANÉES depuis une adresse (au plus 5 vérifications)', async () => {
    for (let rep = 1; rep <= 3; rep++) {
      const ip = ipNeuve();
      espion.raz();
      const { rs, duree, statuts } = await rafale(100, (i) => connexionClient(ip, v4.email, mdpFaux('rc' + rep, i)));
      const verifs = rs.filter((r) => r.status !== 429).length;
      controle(`connexion client, rafale n°${rep} : 100 tentatives simultanées -> au plus 5 vérifications du mot de passe`, verifs <= 5,
        `${verifs} vérifications (${texteStatuts(statuts)}) ; bcrypt.compare exécuté ${espion.compare} fois ; ${Math.round(duree)} ms`);
      controle(`connexion client, rafale n°${rep} : le nombre de bcrypt.compare exécutés est au plus 5`, espion.compare <= 5, `${espion.compare} exécutions`);
      controle(`connexion client, rafale n°${rep} : aucune réponse 5xx`, nbCinqCent(rs) === 0, `${nbCinqCent(rs)} réponse(s) 5xx`);
      controle(`connexion client, rafale n°${rep} : toute réponse est un 401 ou un 429`, rs.every((r) => r.status === 401 || r.status === 429), texteStatuts(statuts));
      const suite = await connexionClient(ip, v4.email, v4.password);
      controle(`connexion client, rafale n°${rep} : le verrou est bien posé après la rafale (bon mot de passe -> 429)`, suite.status === 429, `statut ${suite.status}`);
      const l = ligne('customer_login:ip:' + ip);
      mesure(`rafale client n°${rep} : compteur final en base = ${l && l.attempts} (seuil 5)`);
      const lignesSeau = Number(site.db.prepare('SELECT COUNT(*) AS n FROM throttle WHERE bucket = ?').get('customer_login:ip:' + ip).n);
      controle(`connexion client, rafale n°${rep} : une seule ligne de seau malgré les insertions concurrentes (contrainte d'unicité)`, lignesSeau === 1, `${lignesSeau} ligne(s)`);
      const ailleurs = await connexionClient(ipNeuve(), v4.email, v4.password);
      controle(`connexion client, rafale n°${rep} : une autre adresse reste servie (200)`, ailleurs.status === 200, `statut ${ailleurs.status}`);
      if (rep === 1) {
        // La rafale ne laisse aucune sanction durable : 15 minutes plus tard la fenêtre est neuve.
        const t = horloge;
        fixerHorloge(t + 899);
        verifier429('après la rafale, à +899 s', await connexionClient(ip, v4.email, v4.password), 1);
        fixerHorloge(t + 900);
        const rouvert = await connexionClient(ip, v4.email, v4.password);
        controle('après la rafale, à +900 s : la fenêtre se rouvre, le bon mot de passe passe (200)', rouvert.status === 200, `statut ${rouvert.status}`);
        controle('après la rafale, à +900 s : compteur remis à 0', ligne('customer_login:ip:' + ip).attempts === 0, JSON.stringify(ligne('customer_login:ip:' + ip)));
      }
    }
    for (let rep = 1; rep <= 3; rep++) {
      const ip = ipNeuve();
      espion.raz();
      const { rs, duree, statuts } = await rafale(100, (i) => connexionPatron(ip, mdpFaux('rp' + rep, i)));
      const verifs = rs.filter((r) => r.status !== 429).length;
      controle(`connexion patron, rafale n°${rep} : 100 tentatives simultanées -> au plus 5 vérifications du code`, verifs <= 5,
        `${verifs} vérifications (${texteStatuts(statuts)}) ; bcrypt.compare exécuté ${espion.compare} fois ; ${Math.round(duree)} ms`);
      controle(`connexion patron, rafale n°${rep} : aucune réponse 5xx`, nbCinqCent(rs) === 0, `${nbCinqCent(rs)} réponse(s) 5xx`);
      const suite = await connexionPatron(ip, site.codePatron);
      controle(`connexion patron, rafale n°${rep} : le verrou est bien posé après la rafale (bon code -> 429)`, suite.status === 429, `statut ${suite.status}`);
      const l = ligne('owner_login:ip:' + ip);
      mesure(`rafale patron n°${rep} : compteur final en base = ${l && l.attempts} (seuil 5)`);
    }
    // Rafale mêlant mauvais et bon code : un attaquant qui joint le vrai code à ses essais.
    const ip = ipNeuve();
    const mixte = await rafale(100, (i) => connexionPatron(ip, i === 57 ? site.codePatron : mdpFaux('rm', i)));
    const reussis = mixte.rs.filter((r) => r.status === 200).length;
    controle('rafale de 100 codes dont le bon, depuis une adresse : au plus 5 vérifications (le bon code ne passe que s\'il est parmi les 5 premiers)', mixte.rs.filter((r) => r.status !== 429).length <= 5,
      `${mixte.rs.filter((r) => r.status !== 429).length} vérifications, ${reussis} connexion(s) réussie(s) (${texteStatuts(mixte.statuts)})`);
    controle('rafale mixte : aucune réponse 5xx', nbCinqCent(mixte.rs) === 0, `${nbCinqCent(mixte.rs)} réponse(s) 5xx`);
  });

  // ------------------------------------------------------------------------------------------------ 5. inscription
  await section('5. Inscription : 10 par heure et par adresse (la 11e -> 429)', async () => {
    const t1 = horloge;
    const s1 = ipNeuve();
    const dix = [];
    for (let i = 1; i <= 10; i++) dix.push(await appel('customer_signup.php', corpsNeuf(), s1));
    controle('10 inscriptions valides depuis une adresse : 10 × 201', dix.every((r) => r.status === 201), texteStatuts(compter(dix)));
    const onze = await appel('customer_signup.php', corpsNeuf(), s1);
    verifier429('11e inscription depuis la même adresse', onze, 3600);
    const invalide = await appel('customer_signup.php', { email: 'pas-un-email' }, s1);
    controle('adresse verrouillée : même une inscription invalide reçoit 429 (le verrou passe avant la validation)', invalide.status === 429, `statut ${invalide.status}`);
    const rang = ligne('customer_signup:ip:' + s1);
    controle('compteur figé à 10, fin de verrou = début de fenêtre + 3600 s', rang && rang.attempts === 10 && rang.locked_until === t1 + 3600, JSON.stringify(rang));
    const autre = await appel('customer_signup.php', corpsNeuf(), ipNeuve());
    controle('une autre adresse n\'est pas touchée (201)', autre.status === 201, `statut ${autre.status}`);
    const connex = await connexionClient(s1, v1.email, v1.password);
    controle('adresse verrouillée en inscription : la connexion client reste ouverte (seau séparé)', connex.status === 200, `statut ${connex.status}`);
    fixerHorloge(t1 + 3599);
    verifier429('à +3599 s', await appel('customer_signup.php', corpsNeuf(), s1), 1);
    fixerHorloge(t1 + 3600);
    const neuf = [];
    for (let i = 1; i <= 10; i++) neuf.push(await appel('customer_signup.php', corpsNeuf(), s1));
    controle('à +3600 s : fenêtre rouverte, 10 nouvelles inscriptions permises (10 × 201)', neuf.every((r) => r.status === 201), texteStatuts(compter(neuf)));
    verifier429('fenêtre rouverte : 11e inscription', await appel('customer_signup.php', corpsNeuf(), s1), 3600);

    // Les requêtes invalides (422) ne consomment pas le quota ; une adresse e-mail déjà prise (409) le consomme.
    const s3 = ipNeuve();
    const invalides = [];
    for (let i = 0; i < 15; i++) invalides.push(await appel('customer_signup.php', corpsNeuf({ email: 'pas-un-email-' + i }), s3));
    controle('15 inscriptions invalides depuis une adresse : 15 × 422', invalides.every((r) => r.status === 422), texteStatuts(compter(invalides)));
    controle('les inscriptions invalides ne laissent aucun compteur (validation avant décompte)', ligne('customer_signup:ip:' + s3) === undefined, JSON.stringify(ligne('customer_signup:ip:' + s3)));
    const apresInvalides = [];
    for (let i = 0; i < 10; i++) apresInvalides.push(await appel('customer_signup.php', corpsNeuf(), s3));
    controle('puis 10 inscriptions valides : 10 × 201 (le quota était intact)', apresInvalides.every((r) => r.status === 201), texteStatuts(compter(apresInvalides)));
    const s4 = ipNeuve();
    const pris = [];
    for (let i = 0; i < 10; i++) pris.push(await appel('customer_signup.php', corpsNeuf({ email: v1.email }), s4));
    controle('10 inscriptions avec une adresse e-mail déjà prise : 10 × 409 « email_taken »', pris.every((r) => r.status === 409 && r.json.error === 'email_taken'), texteStatuts(compter(pris)));
    verifier429('11e essai sur e-mail pris (les 409 consomment le quota)', await appel('customer_signup.php', corpsNeuf({ email: v1.email }), s4), 3600);
    info('LIMITE DOCUMENTÉE : le 409 « email_taken » révèle qu\'un compte existe (énumération d\'e-mails), plafonnée à 10 essais par heure et par adresse.');

    // Rafales d'inscriptions simultanées depuis une adresse.
    for (let rep = 1; rep <= 2; rep++) {
      const ip = ipNeuve();
      espion.raz();
      const { rs, duree, statuts } = await rafale(30, () => appel('customer_signup.php', corpsNeuf(), ip));
      const crees = rs.filter((r) => r.status === 201).length;
      controle(`inscriptions, rafale n°${rep} : 30 inscriptions simultanées depuis une adresse -> au plus 10 comptes créés`, crees <= 10,
        `${crees} comptes créés (${texteStatuts(statuts)}) ; bcrypt.hash exécuté ${espion.hash} fois ; ${Math.round(duree)} ms`);
      controle(`inscriptions, rafale n°${rep} : aucune réponse 5xx`, nbCinqCent(rs) === 0, `${nbCinqCent(rs)} réponse(s) 5xx`);
      const suite = await appel('customer_signup.php', corpsNeuf(), ip);
      controle(`inscriptions, rafale n°${rep} : le verrou est posé après la rafale (31e -> 429)`, suite.status === 429, `statut ${suite.status}`);
      mesure(`rafale d'inscriptions n°${rep} : compteur final en base = ${ligne('customer_signup:ip:' + ip).attempts} (seuil 10)`);
    }
    // Même adresse e-mail depuis 30 adresses différentes en même temps : un seul compte, des 409, jamais de 5xx.
    const email = 'course-unique-08@example.test';
    espion.raz();
    const course = await rafale(30, () => appel('customer_signup.php', corpsNeuf({ email }), ipNeuve()));
    controle('30 inscriptions simultanées avec la même adresse e-mail (30 adresses IP) : exactement 1 × 201, le reste en 409', course.statuts[201] === 1 && course.statuts[409] === 29,
      `${texteStatuts(course.statuts)} ; bcrypt.hash exécuté ${espion.hash} fois`);
    controle('même course : aucune réponse 5xx', nbCinqCent(course.rs) === 0, `${nbCinqCent(course.rs)} réponse(s) 5xx`);
    const nb = Number(site.db.prepare('SELECT COUNT(*) AS n FROM customers WHERE email = ?').get(email).n);
    controle('même course : un seul compte en base', nb === 1, `${nb} compte(s)`);
  });

  // ------------------------------------------------------------------------------------------------ 6. commandes
  await section('6. Création de commande : 20 par 10 minutes et par client (la 21e -> 429)', async () => {
    const [o1, o2, o3, o4] = await creerComptes(4, { debut: 8101, concurrence: 4, prefixe: '08o' });
    const r = rng(2024);
    let numero = 0;
    const commande = () => construireCommande(r, { mode: 'pickup', nbPizzas: 1, nbAutres: 0, cle: `cmd08-${String(++numero).padStart(4, '0')}` }).body;
    const t1 = horloge;
    const vingt = [];
    const corps = [];
    for (let i = 0; i < 20; i++) { const b = commande(); corps.push(b); vingt.push(await o1.post('order_create.php', b)); }
    controle('20 commandes valides de suite par un client : 20 × 201', vingt.every((x) => x.status === 201 && x.json.replayed === false), texteStatuts(compter(vingt)));
    const vingtEtUne = await o1.post('order_create.php', commande());
    verifier429('21e commande (nouvelle clé) du même client', vingtEtUne, 600, { cookies: false });
    const seau = 'order_create:customer:' + o1.customer.id;
    const rejeu = await o1.post('order_create.php', corps[0]);
    controle('REJEU de la 1re commande (même clé, même contenu) pendant le verrou : 200 « replayed »', rejeu.status === 200 && rejeu.json.replayed === true && rejeu.json.order.id === vingt[0].json.order.id, `statut ${rejeu.status}, replayed ${rejeu.json && rejeu.json.replayed}`);
    const rejeuDernier = await o1.post('order_create.php', corps[19]);
    controle('REJEU de la 20e commande pendant le verrou : 200 « replayed »', rejeuDernier.status === 200 && rejeuDernier.json.replayed === true, `statut ${rejeuDernier.status}`);
    const conflit = await o1.post('order_create.php', { ...corps[3], total_cents: corps[3].total_cents + 1 });
    controle('même clé avec un contenu différent pendant le verrou : 409 « idempotency_conflict » (pas 429)', conflit.status === 409 && conflit.json.error === 'idempotency_conflict', `statut ${conflit.status}, code ${conflit.json && conflit.json.error}`);
    const rejeux = await rafale(10, () => o1.post('order_create.php', corps[7]));
    controle('10 rejeux simultanés de la même clé pendant le verrou : 10 × 200', rejeux.statuts[200] === 10, texteStatuts(rejeux.statuts));
    const rang = ligne(seau);
    controle('les rejeux, conflits et refus ne consomment pas le quota : compteur = 20, fin de verrou = début + 600 s', rang && rang.attempts === 20 && rang.locked_until === t1 + 600, JSON.stringify(rang));
    const nbCommandes = Number(site.db.prepare('SELECT COUNT(*) AS n FROM orders WHERE customer_id = ?').get(o1.customer.id).n);
    controle('en base : exactement 20 commandes pour ce client (pas de doublon dû aux rejeux)', nbCommandes === 20, `${nbCommandes} commandes`);
    const autreClient = await o2.post('order_create.php', commande());
    controle('un autre client n\'est pas touché (201)', autreClient.status === 201, `statut ${autreClient.status}`);
    const autreAdresse = await o1.post('order_create.php', commande(), { headers: { 'x-subito-test-ip': ipNeuve() } });
    controle('le quota est par client, pas par adresse : changer d\'adresse ne contourne rien (429)', autreAdresse.status === 429, `statut ${autreAdresse.status}`);
    fixerHorloge(t1 + 599);
    verifier429('à +599 s', await o1.post('order_create.php', commande()), 1, { cookies: false });
    fixerHorloge(t1 + 600);
    const rouvert = await o1.post('order_create.php', commande());
    controle('à +600 s : fenêtre rouverte, la commande passe (201)', rouvert.status === 201, `statut ${rouvert.status}`);
    controle('à +600 s : compteur à 1 dans une fenêtre neuve', ligne(seau).attempts === 1 && ligne(seau).window_start === t1 + 600, JSON.stringify(ligne(seau)));

    // Mesure : une seule adresse IP peut-elle inonder le patron de commandes ? 10 comptes (limite d'inscription) × 20 commandes (limite par client).
    const ipSpam = ipNeuve();
    const debutSpam = performance.now();
    const spammeurs = [];
    for (let i = 0; i < 10; i++) spammeurs.push(await appel('customer_signup.php', corpsNeuf(), ipSpam));
    const onzieme = await appel('customer_signup.php', corpsNeuf(), ipSpam);
    const lots = await enParallele(spammeurs, 5, async (s) => {
      const sorties = [];
      for (let k = 0; k < 20; k++) sorties.push(await s.client.post('order_create.php', commande()));
      return sorties;
    });
    const toutes = lots.flat();
    mesure(`inondation depuis UNE adresse : ${spammeurs.filter((s) => s.status === 201).length} comptes (11e inscription -> ${onzieme.status}) puis ${toutes.filter((x) => x.status === 201).length} commandes valides acceptées en ${Math.round(performance.now() - debutSpam)} ms`);
    controle('10 comptes × 20 commandes depuis une adresse : aucune réponse 5xx', nbCinqCent(toutes) === 0 && nbCinqCent(spammeurs) === 0, texteStatuts(compter(toutes)));
    info(`LIMITE DOCUMENTÉE : aucun plafond par adresse ni global sur les commandes : ${toutes.filter((x) => x.status === 201).length} commandes valides arrivent chez le patron depuis une seule adresse en quelques secondes (10 comptes par heure × 20 commandes par 10 minutes).`);

    // Rafales de commandes simultanées pour un même client.
    for (const [rep, client] of [[1, o3], [2, o4]]) {
      const { rs, duree, statuts } = await rafale(30, () => client.post('order_create.php', commande()));
      const creees = rs.filter((x) => x.status === 201).length;
      controle(`commandes, rafale n°${rep} : 30 commandes simultanées (30 clés) d'un client -> au plus 20 créées`, creees <= 20, `${creees} commandes créées (${texteStatuts(statuts)}) ; ${Math.round(duree)} ms`);
      controle(`commandes, rafale n°${rep} : aucune réponse 5xx`, nbCinqCent(rs) === 0, `${nbCinqCent(rs)} réponse(s) 5xx`);
      const enBase = Number(site.db.prepare('SELECT COUNT(*) AS n FROM orders WHERE customer_id = ?').get(client.customer.id).n);
      controle(`commandes, rafale n°${rep} : autant de commandes en base que de réponses 201`, enBase === creees, `${enBase} en base, ${creees} réponses 201`);
      const suite = await client.post('order_create.php', commande());
      controle(`commandes, rafale n°${rep} : le verrou est posé après la rafale (nouvelle commande -> 429)`, suite.status === 429, `statut ${suite.status}`);
    }
  });

  // ------------------------------------------------------------------------------------------------ 7. durées
  await section('7. Durées : e-mail inconnu / mauvais mot de passe d\'un compte existant', async () => {
    const cibles = comptes.slice(0, 5);
    const inconnu = [];
    const existant = [];
    const temoin = [];
    const corpsInconnu = [];
    const corpsExistant = [];
    const tentative = async (genre, i) => {
      const ip = ipNeuve();
      if (genre === 'inconnu') {
        const r = await connexionClient(ip, `inconnu-${i}@example.test`, mdpFaux('t', i));
        return r;
      }
      return connexionClient(ip, cibles[i % cibles.length].email, mdpFaux('t', i));
    };
    for (let i = 0; i < 6; i++) { await tentative('inconnu', 9000 + i); await tentative('existant', 9000 + i); } // échauffement (hachage factice créé, JIT)
    for (let i = 0; i < 100; i++) {
      for (const genre of i % 2 === 0 ? ['inconnu', 'existant'] : ['existant', 'inconnu']) {
        const r = await tentative(genre, i);
        (genre === 'inconnu' ? inconnu : existant).push(r.ms);
        (genre === 'inconnu' ? corpsInconnu : corpsExistant).push(r);
      }
    }
    for (let i = 0; i < 30; i++) temoin.push((await connexionClient(ipNeuve(), cibles[0].email, 'x'.repeat(5000))).ms);
    const resumeDurees = (v) => `médiane ${fmt(mediane(v))}, moyenne ${fmt(moyenne(v))}, p10 ${fmt(percentile(v, 10))}, p90 ${fmt(percentile(v, 90))}, min ${fmt(Math.min(...v))}, max ${fmt(Math.max(...v))}`;
    mesure(`e-mail INCONNU (100 essais)              : ${resumeDurees(inconnu)}`);
    mesure(`mauvais mot de passe, compte EXISTANT (100) : ${resumeDurees(existant)}`);
    mesure(`témoin sans hachage (mot de passe de 5000 octets, 30 essais) : ${resumeDurees(temoin)}`);
    const mi = mediane(inconnu);
    const me = mediane(existant);
    const ecart = Math.abs(mi - me);
    controle('200 tentatives : toutes refusées en 401 (aucune 429, aucune 5xx)', [...corpsInconnu, ...corpsExistant].every((r) => r.status === 401), texteStatuts(compter([...corpsInconnu, ...corpsExistant])));
    controle('corps de réponse identiques (e-mail inconnu / mauvais mot de passe) : aucune énumération par le contenu', new Set([...corpsInconnu, ...corpsExistant].map((r) => r.text)).size === 1, [...new Set([...corpsInconnu, ...corpsExistant].map((r) => r.text))][0]);
    controle('en-têtes de réponse identiques (mêmes noms) : aucune énumération par les en-têtes',
      new Set([...corpsInconnu, ...corpsExistant].map((r) => [...r.headers.keys()].filter((k) => k !== 'date').sort().join(','))).size === 1, [...corpsInconnu[0].headers.keys()].join(','));
    controle('médianes proches : écart ≤ 20 % (ou ≤ 10 ms) entre « e-mail inconnu » et « compte existant »', ecart <= Math.max(0.2 * Math.max(mi, me), 10),
      `inconnu ${fmt(mi)} ; existant ${fmt(me)} ; écart ${fmt(ecart)} (${(100 * ecart / Math.max(mi, me)).toFixed(1)} %)`);
    controle('moyennes proches : écart ≤ 25 %', Math.abs(moyenne(inconnu) - moyenne(existant)) <= 0.25 * Math.max(moyenne(inconnu), moyenne(existant)), `inconnu ${fmt(moyenne(inconnu))} ; existant ${fmt(moyenne(existant))}`);
    controle('témoin : sans hachage la réponse est au moins 3 fois plus rapide (la mesure sait distinguer un hachage de son absence)', mediane(temoin) * 3 <= Math.min(mi, me), `témoin ${fmt(mediane(temoin))} contre ${fmt(Math.min(mi, me))}`);
  });

  // ------------------------------------------------------------------------------------------------ 8. politiques
  await section('8. Politique de mot de passe (8 à 200 octets) et de code', async () => {
    const inscrire = async (password, extra = {}) => {
      const corps = corpsNeuf({ password, ...extra });
      const r = await appel('customer_signup.php', corps, ipNeuve());
      r.corps = corps;
      return r;
    };
    const refus = (r) => r.status === 422 && r.json && r.json.error === 'validation' && typeof (r.json.fields && r.json.fields.password) === 'string';
    const octets = (s) => Buffer.byteLength(s);
    const cas = [
      ['7 octets', '1234567', false],
      ['8 octets', '12345678', true],
      ['200 octets', 'A'.repeat(200), true],
      ['201 octets', 'A'.repeat(201), false],
      ['vide', '', false],
      ['4096 octets', 'A'.repeat(4096), false]
    ];
    for (const [nom, mdp, accepte] of cas) {
      const r = await inscrire(mdp);
      controle(`mot de passe de ${nom} : ${accepte ? 'accepté (201)' : 'refusé (422, champ password)'}`, accepte ? r.status === 201 : refus(r), `statut ${r.status}`);
    }
    for (const [nom, valeur] of [['absent', undefined], ['nombre', 12345678], ['tableau', ['12345678']], ['null', null], ['objet', { a: '12345678' }], ['booléen', true]]) {
      const corps = corpsNeuf();
      if (valeur === undefined) delete corps.password; else corps.password = valeur;
      const r = await appel('customer_signup.php', corps, ipNeuve());
      controle(`mot de passe ${nom} : refusé (422, champ password)`, refus(r), `statut ${r.status}`);
    }
    // La limite est en OCTETS (UTF-8), pas en caractères.
    const accents = await inscrire('éééé');
    const accents200 = await inscrire('é'.repeat(100));
    const accents202 = await inscrire('é'.repeat(101));
    controle('« éééé » (4 caractères, 8 octets) : accepté (la limite est en octets)', accents.status === 201, `statut ${accents.status}`);
    controle('100 × « é » (200 octets) : accepté ; 101 × « é » (202 octets) : refusé', accents200.status === 201 && refus(accents202), `statuts ${accents200.status} / ${accents202.status}`);
    const sept = await inscrire('abcdéfg');
    info(`LIMITE DOCUMENTÉE : la longueur minimale est comptée en OCTETS (8 octets), alors que le formulaire et le message parlent de « 8 caractères » : « abcdéfg » (7 caractères, ${Buffer.byteLength('abcdéfg')} octets) est ${sept.status === 201 ? 'accepté' : 'refusé'} (statut ${sept.status}).`);
    for (const longueur of [201, 300]) {
      const trop = await inscrire('B'.repeat(longueur));
      const message = trop.json && trop.json.fields && trop.json.fields.password;
      controle(`message d'erreur d'un mot de passe trop LONG (${longueur} octets) : indique la limite haute (200 octets)`, /200|long|maximum|trop/i.test(message || ''), `statut ${trop.status}, message observé : « ${message} »`);
    }

    // Connexion avec ces mots de passe.
    const long200 = await inscrire('C'.repeat(200));
    const ok200 = await connexionClient(ipNeuve(), long200.corps.email, long200.corps.password);
    controle('mot de passe de 200 octets : la connexion fonctionne (200)', ok200.status === 200, `statut ${ok200.status}`);
    const ok4096 = await connexionClient(ipNeuve(), long200.corps.email, 'C'.repeat(4097));
    controle('connexion avec un mot de passe de 4097 octets : 401 sans erreur', ok4096.status === 401, `statut ${ok4096.status}`);
    const espaces = await inscrire('  espace ');
    const okEspaces = await connexionClient(ipNeuve(), espaces.corps.email, '  espace ');
    const koEspaces = await connexionClient(ipNeuve(), espaces.corps.email, 'espace');
    controle('espaces de tête et de queue conservés dans le mot de passe (200 avec, 401 sans)', espaces.status === 201 && okEspaces.status === 200 && koEspaces.status === 401, `${espaces.status} / ${okEspaces.status} / ${koEspaces.status}`);
    const majuscule = await connexionClient(ipNeuve(), '  ' + comptes[5].email.toUpperCase() + ' ', comptes[5].password);
    controle('e-mail en majuscules avec espaces : même compte (200)', majuscule.status === 200, `statut ${majuscule.status}`);

    // Troncature bcrypt : seuls les 72 premiers octets comptent.
    for (let k = 1; k <= 2; k++) {
      const tete = String.fromCharCode(64 + k).repeat(72);
      const compte = await inscrire(tete + '-fin-originale-' + k);
      const autreFin = await connexionClient(ipNeuve(), compte.corps.email, tete + '-AUTRE-FIN-' + k);
      const seulementTete = await connexionClient(ipNeuve(), compte.corps.email, tete);
      controle(`mot de passe de ${octets(compte.corps.password)} octets (n°${k}) : une autre fin après les 72 premiers octets est refusée (401)`, autreFin.status === 401,
        `statut ${autreFin.status} : ${autreFin.status === 200 ? 'bcrypt ne lit que 72 octets, la fin du mot de passe est ignorée' : 'ok'}`);
      controle(`mot de passe de ${octets(compte.corps.password)} octets (n°${k}) : les 72 premiers octets seuls sont refusés (401)`, seulementTete.status === 401, `statut ${seulementTete.status}`);
    }
    // Caractère NUL dans le mot de passe : conservé (pas de coupure à la fin de chaîne C).
    const nul = await inscrire('abcdefgh\u0000XYZ');
    const nulAutre = await connexionClient(ipNeuve(), nul.corps.email, 'abcdefgh\u0000QRS');
    const nulCoupe = await connexionClient(ipNeuve(), nul.corps.email, 'abcdefgh');
    controle('mot de passe contenant NUL : accepté, et ni la fin modifiée ni la partie avant NUL ne suffisent (401, 401)', nul.status === 201 && nulAutre.status === 401 && nulCoupe.status === 401, `${nul.status} / ${nulAutre.status} / ${nulCoupe.status}`);

    // Code patron : chaîne non vide d'au plus 4096 octets.
    const essaisCode = [
      ['vide', ''], ['nombre', 123456], ['tableau', ['x']], ['objet', { a: 1 }], ['null', null], ['booléen', true],
      ['4096 octets', 'Z'.repeat(4096)], ['4097 octets', 'Z'.repeat(4097)], ['NUL', 'ab\u0000cd'], ['avec espace final', site.codePatron + ' ']
    ];
    for (const [nom, code] of essaisCode) {
      const r = await appel('owner_login.php', { code }, ipNeuve());
      controle(`code patron « ${nom} » : refusé proprement (401)`, r.status === 401 && r.json.error === 'invalid_credentials', `statut ${r.status}`);
    }
    const pasBooleen = await appel('owner_login.php', { code: site.codePatron, remember: 'oui' }, ipNeuve());
    controle('remember non booléen (« oui ») : ignoré, session courte (200, remember = false)', pasBooleen.status === 200 && pasBooleen.json.owner.remember === false, `statut ${pasBooleen.status}, remember ${pasBooleen.json && pasBooleen.json.owner && pasBooleen.json.owner.remember}`);
    const casseCode = await appel('owner_login.php', { code: site.codePatron.toUpperCase() }, ipNeuve());
    controle('code patron : la casse compte (majuscules -> 401)', casseCode.status === 401, `statut ${casseCode.status}`);
    // Code patron long : au-delà de 72 octets, le serveur passe par SHA-256 avant bcrypt (aucune fin ignorée).
    const ancienHash = process.env.OWNER_CODE_HASH;
    const bcrypt = (await import('bcryptjs')).default;
    const crypto = await import('node:crypto');
    try {
      const codeLong = 'L'.repeat(72) + '-suite-du-code';
      process.env.OWNER_CODE_HASH = bcrypt.hashSync(crypto.createHash('sha256').update(codeLong).digest('hex'), 4);
      const tronque = await appel('owner_login.php', { code: 'L'.repeat(72) + '-AUTRE-SUITE' }, ipNeuve());
      const exact = await appel('owner_login.php', { code: codeLong }, ipNeuve());
      controle('code patron de 86 octets : une autre suite après les 72 premiers octets est refusée (401)', exact.status === 200 && tronque.status === 401, `code exact ${exact.status} ; autre suite ${tronque.status}`);
    } finally {
      process.env.OWNER_CODE_HASH = ancienHash;
    }
  });

  // ------------------------------------------------------------------------------------------------ 9. corps hostiles
  await section('9. Corps hostiles sur les routes limitées (jamais de 5xx)', async () => {
    const sonde = async (nom, route, corps, { attendu = null, ip = ipNeuve(), opts = {} } = {}) => {
      const r = await appel(route, corps, ip, opts);
      const bon = r.status < 500 && (attendu === null || attendu.includes(r.status));
      if (r.status >= 500) { r.hostile = true; hostiles.push(r); }
      controle(nom, bon, `statut ${r.status}${attendu ? ' (attendu ' + attendu.join(' ou ') + ')' : ''}${r.status >= 500 ? ' : ' + r.text.slice(0, 80) : ''}`);
      return r;
    };
    const e190 = 'a'.repeat(190 - '@example.test'.length) + '@example.test';
    const e191 = 'a'.repeat(191 - '@example.test'.length) + '@example.test';
    const lc = (n, email, password) => sonde(`connexion client : ${n}`, 'customer_login.php', { email, password }, { attendu: [401] });
    // NUL dans l'e-mail : le texte part tel quel vers Postgres, qui refuse le NUL (SQLSTATE 22021).
    await lc('e-mail avec NUL au milieu (essai 1)', 'a\u0000b@example.test', 'motdepasse1');
    await lc('e-mail avec NUL au milieu (essai 2)', 'ab\u0000@example.test', 'motdepasse2');
    await lc('e-mail avec NUL au début', '\u0000ab@example.test', 'motdepasse3');
    await lc('e-mail avec NUL à la fin', 'ab@example.test\u0000', 'motdepasse4');
    await lc('e-mail = tableau', ['x@example.test'], 'motdepasse5');
    await lc('e-mail = objet', { a: 1 }, 'motdepasse6');
    await lc('e-mail = nombre', 12345, 'motdepasse7');
    await lc('e-mail = null et mot de passe = null', null, null);
    await lc('mot de passe = tableau', v1.email, ['x']);
    await lc('mot de passe = objet', v1.email, { a: 1 });
    await lc('e-mail de 190 octets (limite)', e190, 'motdepasse8');
    await lc('e-mail de 191 octets (au-delà)', e191, 'motdepasse9');
    await lc('e-mail accentué', 'éèà@exemple.test', 'motdepasse10');
    await lc('e-mail emoji', '😀@example.test', 'motdepasse11');
    await lc('e-mail avec substitut isolé', '\ud800@example.test', 'motdepasse12');
    await lc('mot de passe avec substitut isolé', v1.email, '𐀀\ud800abcdefgh');
    await lc('e-mail = injection SQL classique', "' OR '1'='1' --", 'motdepasse13');
    await lc('e-mail de 60000 caractères', 'a'.repeat(60000), 'motdepasse14');
    await lc('mot de passe de 4096 octets', v1.email, 'p'.repeat(4096));
    await sonde('connexion client : corps {} (aucun champ)', 'customer_login.php', {}, { attendu: [401] });
    await sonde('connexion client : 5000 clés dans le corps', 'customer_login.php', Object.fromEntries(Array.from({ length: 5000 }, (_, i) => ['k' + i, i])), { attendu: [401] });
    await sonde('connexion client : clé « __proto__ » dans le corps', 'customer_login.php', JSON.parse('{"__proto__":{"email":"x@example.test"},"email":"y@example.test","password":"motdepasse15"}'), { attendu: [401] });
    // Corps illisibles (refusés avant le décompte).
    const ipBrut = ipNeuve();
    const brut = async (nom, route, raw, headers, attendu) => {
      const c = new Client08('brut', ipBrut);
      const r = await c.post(route, undefined, { raw, headers });
      if (r.status >= 500) { r.hostile = true; hostiles.push(r); }
      controle(`${route.replace('.php', '')} : ${nom}`, r.status === attendu, `statut ${r.status} (attendu ${attendu})`);
      return r;
    };
    const json = { 'content-type': 'application/json' };
    await brut('JSON tronqué', 'customer_login.php', '{"email":"a@b', json, 400);
    await brut('corps vide', 'customer_login.php', '', json, 400);
    await brut('tableau JSON', 'owner_login.php', '[1,2,3]', json, 400);
    await brut('texte nu', 'owner_login.php', 'code=abc', json, 400);
    await brut('type de contenu text/plain', 'owner_login.php', '{"code":"x"}', { 'content-type': 'text/plain' }, 415);
    await brut('type de contenu absent', 'customer_signup.php', '{"a":1}', {}, 415);
    await brut('corps de 70000 octets (> 64 Kio)', 'customer_login.php', JSON.stringify({ email: 'a@b.test', password: 'x'.repeat(70000) }), json, 413);
    await brut('JSON imbriqué sur 10000 niveaux', 'customer_login.php', '{"a":'.repeat(10000) + '1' + '}'.repeat(10000), json, 400);
    await brut('JSON précédé d\'une marque d\'ordre des octets', 'owner_login.php', '﻿{"code":"x"}', json, 400);
    controle('ces corps illisibles n\'ont créé aucun seau de limitation pour leur adresse', ligne('customer_login:ip:' + ipBrut) === undefined && ligne('owner_login:ip:' + ipBrut) === undefined && ligne('customer_signup:ip:' + ipBrut) === undefined, 'refusés avant le décompte');

    const lp = (n, code) => sonde(`connexion patron : ${n}`, 'owner_login.php', { code }, { attendu: [401] });
    await lp('code avec NUL', 'ab\u0000cd');
    await lp('code avec substitut isolé', '\ud800abc');
    await lp('code de 4096 octets', 'q'.repeat(4096));
    await lp('code de 4097 octets', 'q'.repeat(4097));
    await lp('code de 60000 caractères', 'q'.repeat(60000));
    await lp('code = objet', { $ne: '' });

    // Inscription : NUL dans une valeur stockée (rue) -> Postgres refuse le NUL (SQLSTATE 22021).
    const si = (n, extra, attendu) => sonde(`inscription : ${n}`, 'customer_signup.php', corpsNeuf(extra), { attendu });
    await si('rue avec NUL au milieu (essai 1)', { street: 'rue\u0000x', city: 'Rouvroy' }, [422]);
    await si('rue avec NUL au début (essai 2)', { street: '\u0000rue', city: 'Rouvroy' }, [422]);
    await si('rue avec NUL à la fin (essai 3)', { street: 'rue\u0000', city: 'Rouvroy' }, [422]);
    await si('prénom avec NUL (nettoyé en espace)', { first_name: 'Jean\u0000Paul' }, [201]);
    await si('nom avec NUL', { last_name: 'Du\u0000pont' }, [201]);
    await si('téléphone avec NUL', { phone: '06 12 34 56 7\u00008' }, [422]);
    await si('e-mail avec NUL', { email: 'a\u0000b@example.test' }, [422]);
    await si('ville avec NUL', { city: 'Rouvroy\u0000', street: 'rue' }, [422]);
    await si('mot de passe avec NUL', { password: 'motdepasse\u0000nul' }, [201]);
    await si('rue de 150 emoji (limite en points de code)', { street: '😀'.repeat(150), city: 'Rouvroy' }, [201]);
    await si('rue de 151 emoji', { street: '😀'.repeat(151), city: 'Rouvroy' }, [422]);
    await si('prénom de 60 caractères accentués', { first_name: 'é'.repeat(60) }, [201]);
    await si('prénom de 61 caractères', { first_name: 'é'.repeat(61) }, [422]);
    await si('tous les champs en tableaux', { first_name: ['a'], last_name: ['b'], phone: ['c'], email: ['d'], password: ['e'], street: ['f'], city: ['g'] }, [422]);
    await si('rue avec caractères de contrôle et séparateurs Unicode', { street: 'rue des​Tests\u0007', city: 'Rouvroy' }, [201, 422]);
    // Adresse du compte : même NUL, côté client connecté.
    const [cl1, cl2] = await creerComptes(2, { debut: 8201, concurrence: 2, prefixe: '08h' });
    for (const [n, cl, rue] of [['essai 1', cl1, 'rue\u0000x'], ['essai 2', cl2, '\u0000']]) {
      const r = await cl.post('customer_update_address.php', { street: rue, city: 'Rouvroy' });
      if (r.status >= 500) { r.hostile = true; hostiles.push(r); }
      controle(`changement d'adresse du compte : rue avec NUL (${n}) -> 422 attendu`, r.status === 422, `statut ${r.status}${r.status >= 500 ? ' : ' + r.text.slice(0, 80) : ''}`);
    }
    mesure(`réponses 5xx provoquées par les corps hostiles : ${hostiles.length}`);
  });

  // ------------------------------------------------------------------------------------------------ 10. table throttle
  await section('10. Table throttle sous 5000 adresses différentes (bornée, purgée au passage)', async () => {
    const base = nbLignes();
    const dateA = horloge;
    const sonde = async (n) => {
      const durees = [];
      for (let i = 0; i < n; i++) durees.push((await connexionPatron(ipNeuve(), '')).ms);
      return durees;
    };
    const courbe = [];
    const mesureLatence = async (taille) => { const d = await sonde(10); courbe.push([taille, mediane(d)]); return d.length; };
    let distinctes = 0;
    distinctes += await mesureLatence(0);
    const debut = performance.now();
    const toutes = [];
    for (let palier = 1; palier <= 5; palier++) {
      const adresses = Array.from({ length: 1000 }, () => ipNeuve());
      const rs = await enParallele(adresses, 30, (ip) => connexionPatron(ip, ''));
      toutes.push(...rs);
      distinctes += adresses.length;
      distinctes += await mesureLatence(palier * 1000);
    }
    const duree = performance.now() - debut;
    controle('5000 adresses différentes (code vide, sans hachage) : 5000 × 401, aucune 429, aucune 5xx', toutes.length === 5000 && toutes.every((r) => r.status === 401), `${texteStatuts(compter(toutes))} en ${Math.round(duree)} ms`);
    const apres = nbLignes();
    controle('la table throttle compte une ligne par adresse (5000 + sondes), ni plus ni moins', apres - base === distinctes, `${apres - base} lignes ajoutées pour ${distinctes} adresses distinctes`);
    mesure(`latence médiane d'une requête isolée selon la taille de la table : ${courbe.map(([t, m]) => `${t} lignes -> ${fmt(m)}`).join(' ; ')}`);
    const premiere = courbe[0][1];
    const derniere = courbe[courbe.length - 1][1];
    controle('latence d\'une requête à 5000 lignes : moins de 5 fois celle d\'une table vide (ou 60 ms), et moins de 250 ms', derniere <= Math.max(5 * premiere, 60) && derniere < 250, `${fmt(premiere)} -> ${fmt(derniere)}`);
    // Rejouer les mêmes adresses n'ajoute aucune ligne.
    const rejouees = toutes.slice(0, 500).map((r) => r.ip);
    const r2 = await enParallele(rejouees, 30, (ip) => connexionPatron(ip, ''));
    const r3 = await enParallele(rejouees, 30, (ip) => connexionPatron(ip, ''));
    controle('500 adresses rejouées 2 fois : aucune ligne de plus (une ligne par adresse)', nbLignes() === apres, `${nbLignes()} lignes (avant ${apres})`);
    controle('ces adresses rejouées en sont à 3 tentatives, sans verrou', rejouees.every((ip) => { const l = ligne('owner_login:ip:' + ip); return l && l.attempts === 3 && l.locked_until === null; }), `${r2.length + r3.length} requêtes`);
    // Aucune purge avant 24 h : 3 lignes récentes à +1 h.
    fixerHorloge(dateA + 3600);
    for (let i = 0; i < 3; i++) await connexionPatron(ipNeuve(), '');
    controle('à +1 h : aucune ligne purgée (la purge ne retire que ce qui a plus de 24 h)', nbLignes() === apres + 3, `${nbLignes()} lignes (attendu ${apres + 3})`);
    // À +24 h et 1 s : la première requête purge d'un coup toutes les lignes de plus de 24 h.
    fixerHorloge(dateA + 86401);
    const declencheur = await connexionPatron(ipNeuve(), '');
    controle('à +24 h : la requête suivante répond normalement (401)', declencheur.status === 401, `statut ${declencheur.status}`);
    const apresPurge = nbLignes();
    controle('à +24 h : purge au passage, il ne reste que les 3 lignes récentes + la nouvelle', apresPurge === 4, `${apresPurge} lignes (de ${apres + 3} avant)`);
    fixerHorloge(dateA + 3600 + 86401);
    await connexionPatron(ipNeuve(), '');
    controle('à +25 h : les 3 lignes de +1 h sont purgées à leur tour', nbLignes() === 2, `${nbLignes()} lignes`);
    // Un seau verrouillé n'est jamais purgé tant que son verrou court, même s'il est vieux de plus de 24 h.
    const ipVerrou = ipNeuve();
    for (let i = 1; i <= 5; i++) await connexionPatron(ipVerrou, mdpFaux('purge', i));
    site.db.prepare('UPDATE throttle SET window_start = ? WHERE bucket = ?').run(horloge - 90000, 'owner_login:ip:' + ipVerrou);
    await connexionPatron(ipNeuve(), '');
    controle('un seau encore verrouillé survit à la purge même si sa fenêtre date de plus de 24 h', ligne('owner_login:ip:' + ipVerrou) !== undefined, JSON.stringify(ligne('owner_login:ip:' + ipVerrou)));
    info('LIMITE DOCUMENTÉE : la table n\'est pas plafonnée. Elle grossit d\'une ligne par adresse distincte (par /64 en IPv6) et par route sur 24 h ; l\'attaquant qui change d\'adresse (IPv6, botnet) la fait grossir sans limite pendant la journée.');
  });

  // ------------------------------------------------------------------------------------------------ 11. contrôles finaux
  await section('11. Contrôles finaux (toutes sections)', async () => {
    const normales = reponses.filter((r) => !r.hostile);
    const cinqCent = normales.filter((r) => r.status >= 500);
    controle(`aucune erreur 5xx sur les ${normales.length} réponses reçues (hors corps hostiles de la section 9)`, cinqCent.length === 0, `${cinqCent.length} réponse(s) 5xx ${cinqCent.slice(0, 3).map((r) => r.method + ' ' + r.route).join(', ')}`);
    const statuts = compter(reponses);
    mesure(`toutes réponses reçues (${reponses.length}) : ${texteStatuts(statuts)}`);
    const r429 = reponses.filter((r) => r.status === 429);
    controle('toutes les réponses 429 : Retry-After présent, Cache-Control: no-store', r429.every((r) => r.headers.get('retry-after') !== null && r.headers.get('cache-control') === 'no-store'), `${r429.length} réponses 429`);
    controle('toutes les réponses 429 des routes sans session (connexions, inscription) : aucun cookie posé', r429.filter((r) => r.route !== 'order_create.php').every((r) => r.setCookies.length === 0), `${r429.filter((r) => r.route !== 'order_create.php').length} réponses 429 sans session`);
    const secrets = /faux-|Essai-|code-patron-test-/;
    const fuites = reponses.filter((r) => r.status >= 400 && secrets.test(r.text));
    controle('aucune réponse d\'erreur ne renvoie un mot de passe ou un code saisi', fuites.length === 0, `${fuites.length} fuite(s)`);
    const journal = site.journal();
    const lignes = journal.split('\n').filter(Boolean);
    const forme = /^\[subito-api\] (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z )?([a-z_]+\.php|\?) \d{3} [a-z_]+( \w+( code \w+)?)?$/;
    const horsForme = lignes.filter((l) => !forme.test(l));
    controle(`journal serveur : ${lignes.length} lignes, toutes de la forme « route statut code » (aucun texte libre)`, horsForme.length === 0, `${horsForme.length} hors forme ${horsForme.slice(0, 2).join(' | ')}`);
    const fuitesJournal = lignes.filter((l) => /@|faux-|Essai-|code-patron|(\d{1,3}\.){3}\d{1,3}|:[0-9a-f]{0,4}:[0-9a-f]{0,4}:/i.test(l.replace(/\d{2}:\d{2}:\d{2}Z/g, '')));
    controle('journal serveur : aucune adresse e-mail, aucun mot de passe, aucun code, aucune adresse IP', fuitesJournal.length === 0, `${fuitesJournal.length} ligne(s) suspecte(s) ${fuitesJournal.slice(0, 2).join(' | ')}`);
    const lignes500 = lignes.filter((l) => / 500 server_error/.test(l));
    controle('journal serveur : les seules erreurs 500 sont celles des corps hostiles de la section 9', lignes500.length === hostiles.length, `${lignes500.length} lignes 500 dans le journal, ${hostiles.length} réponses 500 hostiles`);
    const par = {};
    for (const l of lignes) { const m = / (\d{3}) ([a-z_]+)/.exec(l); if (m) par[m[1] + ' ' + m[2]] = (par[m[1] + ' ' + m[2]] || 0) + 1; }
    mesure(`journal serveur par type : ${Object.entries(par).map(([k, v]) => `${k} ×${v}`).join(', ')}`);
    mesure(`bcrypt.compare exécuté ${espion.compare} fois, bcrypt.hash ${espion.hash} fois depuis la dernière remise à zéro`);
    mesure(`connexions TCP rejouées avant envoi (ports éphémères de la machine épuisés, EADDRINUSE) : ${transport.reessais} (0 en temps normal ; aucune requête n'a été envoyée deux fois)`);
  });

  // ------------------------------------------------------------------------------------------------ 12. an 2038
  await section('12. Voyage dans le temps après le 19 janvier 2038 (colonnes INTEGER de la table throttle)', async () => {
    fixerHorloge(Date.UTC(2038, 0, 20, 0, 0, 0) / 1000);
    for (let k = 1; k <= 2; k++) {
      const r = await connexionPatron(ipNeuve(), mdpFaux('y2038', k));
      if (r.status >= 500) { r.hostile = true; hostiles.push(r); }
      controle(`connexion patron au 20/01/2038 (essai ${k}) : refus normal (401), pas d'erreur 5xx`, r.status === 401, `statut ${r.status}${r.status >= 500 ? ' : ' + r.text.slice(0, 80) : ''}`);
    }
  });
} catch (e) {
  controle('exécution sans exception non prévue', false, detailErreur(e));
} finally {
  resume();
  site.arreter();
}
process.exit(bilan.echoues === 0 ? 0 : 1);
