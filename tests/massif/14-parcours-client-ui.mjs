// Batterie 14 : PARCOURS CLIENT DE BOUT EN BOUT PAR L'INTERFACE RÉELLE (Chrome headless, vrais clics et vraie frappe).
// 10 parcours depuis une session vide, sur 3 tailles d'écran (390, 768, 1280) : compte (erreurs, connexion, adresse), menu / composer /
// vegetarien, personnalisation, panier, bascule à emporter / livraison, paiement, « Commander en ligne », page de suivi, et
// comparaison exacte entre ce que le client voit et ce que le commerçant reçoit (API). Cas durs : double clic, coupure réseau,
// session expirée en plein panier.
//   node tests/massif/lancer.mjs tests/massif/14-parcours-client-ui.mjs --timeout=480
//   Variable facultative PARCOURS=1,4 pour ne rejouer que certains parcours (mise au point).
import { demarrerSite } from './lib/env.mjs';
import { patronConnecte } from './lib/clients.mjs';
import { avecNavigateur } from './lib/chrome.mjs';
import { Ui, enEuros, reprise } from './lib/14-ui.mjs';
import { ZONES, totaux, ordreAffichage } from './lib/14-attendus.mjs';
import {
  compteTest, remplirInscription, inscrire, connecter, ajouterPizza, ajouterProduit, attendreStatutLivraison, lireSuivi, idDuSuivi,
  passerCommande, commandeChezPatron, commandesDuClient, verifierAffichage, verifierCommande, verifierSuivi
} from './lib/14-scenes.mjs';

const T0 = Date.now();
const secondes = () => ((Date.now() - T0) / 1000).toFixed(1);
const json = (v) => JSON.stringify(v);
const eur = (c) => (c === null || c === undefined ? 'null' : enEuros(c));

// ---------- Comptes rendus : une ligne PASS / FAIL par contrôle ----------
const resultats = [];
const parcoursDurees = [];
let courant = 'infra';
function controle(nom, ok, observe) {
  const passe = !!ok;
  resultats.push({ parcours: courant, nom, ok: passe });
  console.log(`${passe ? 'PASS' : 'FAIL'}  [${courant}] ${nom}${observe === undefined ? '' : ' — ' + observe}`);
  return passe;
}
function bilan(interrompu = false) {
  const reussis = resultats.filter((r) => r.ok).length;
  const echoues = resultats.length - reussis;
  console.log('\n==================== RÉSUMÉ ====================');
  for (const p of parcoursDurees) {
    const rs = resultats.filter((r) => r.parcours === p.id);
    console.log(`${p.id} · ${p.largeur} px · ${p.titre} : ${rs.filter((r) => r.ok).length}/${rs.length} contrôles, ${p.duree} s`);
  }
  console.log(`${resultats.length} contrôles : ${reussis} réussis, ${echoues} échoués${interrompu ? ' (INTERROMPU)' : ''} — durée ${secondes()} s`);
  for (const r of resultats.filter((x) => !x.ok)) console.log(`   ÉCHEC [${r.parcours}] ${r.nom}`);
  return echoues === 0 && !interrompu;
}
// Garde-fou : le script ne dépasse jamais 8 minutes ; au pire on imprime un bilan partiel.
const GARDE = setTimeout(() => { console.log(`\n[garde-fou] 450 s atteintes : arrêt, bilan partiel.`); bilan(true); process.exit(1); }, 450000);
GARDE.unref();

const site = await demarrerSite();
// Appels API du commerçant : rejoués si la MACHINE manque de ports réseau (autres tests en cours), jamais si le serveur répond.
const patronBrut = await reprise(() => patronConnecte('10.250.14.1'));
const patron = {
  get: (route, opts) => reprise(() => patronBrut.get(route, opts)),
  post: (route, body, opts) => reprise(() => patronBrut.post(route, body, opts))
};
const filtre = process.env.PARCOURS ? process.env.PARCOURS.split(',').map(Number) : null;

// ---------- Outils communs aux parcours ----------
const ATTENTE_ERREUR = "(id) => { const e = document.getElementById(id); return !!e && !e.hidden && e.textContent.trim() !== ''; }";
async function lireErreur(ui, id, ms = 8000) {
  await ui.attendre(`(${ATTENTE_ERREUR})(${json(id)})`, ms);
  return ui.texte('#' + id);
}
const nbCommandesBase = (email) => site.db.prepare('SELECT COUNT(*) AS n FROM orders WHERE customer_email = ?').get(email).n;
const compteBase = (email) => site.db.prepare('SELECT id, street, city, phone FROM customers WHERE email = ?').get(email);
const moi = (ui) => ui.evaluer("fetch('/api/customer_me.php', { credentials: 'include' }).then((r) => r.json()).then((j) => j.customer)");

/** Le tiroir est-il contenu dans l'écran (aucun défilement horizontal) ? */
async function controleDebordement(ui, quoi) {
  const d = await ui.debordement();
  controle(`${quoi} : pas de défilement horizontal à ${ui.largeur} px`, d <= 0, `débordement ${d} px`);
}

/** Ouvre le tiroir, lit ce que le client voit, vérifie contre le cliqué. */
async function tiroirEtAffichage(ui, ref, lignes, mode, ville) {
  const ouvert = await ui.ouvrirTiroir();
  controle(`${ref} le tiroir du panier s'ouvre`, ouvert);
  if (mode === 'delivery') await attendreStatutLivraison(ui);
  const aff = await ui.lirePanierAffiche();
  verifierAffichage(controle, ref, aff, lignes, mode, ville);
  return aff;
}

/** Après une commande : suivi affiché, commande chez le commerçant, aucun doublon. */
async function verifierApresCommande(ui, ref, r, ctx) {
  controle(`${ref} « Commander en ligne » : redirection vers la page de suivi`, r.redirige, `url ${r.url}${r.message ? ' · message : ' + r.message : ''}`);
  if (!r.redirige) return null;
  controle(`${ref} une seule requête d'envoi est partie`, r.requetes.length === 1, `${r.requetes.length} requête(s) order_create, statuts ${json(r.requetes.map((q) => q.statut))}`);
  const cmd = await commandeChezPatron(patron, r.id);
  controle(`${ref} la page de suivi porte l'identifiant de la commande reçue (commande.html?id=${r.id})`, !!cmd && cmd.customer_email === ctx.compte.email.toLowerCase(), `commande ${r.id} : ${cmd ? cmd.customer_email : 'introuvable'}`);
  verifierCommande(controle, ref, cmd, ctx);
  const mine = await commandesDuClient(patron, ctx.compte.email.toLowerCase());
  controle(`${ref} une seule commande pour ce client chez le commerçant`, mine && mine.length === (ctx.attendues || 1), `${mine ? mine.length : '?'} commande(s)`);
  await ui.attendre("(() => { const b = document.getElementById('orderTrackBody'); return !!b && !!b.getAttribute('data-order-status'); })()", 15000);
  const suivi = await lireSuivi(ui);
  verifierSuivi(controle, ref, suivi, cmd);
  await controleDebordement(ui, `${ref} page de suivi`);
  const panier = await ui.panierStocke();
  controle(`${ref} le panier est vidé après l'envoi`, Array.isArray(panier) && panier.length === 0, json(panier));
  return { cmd, suivi };
}

// =====================================================================================================================
// P01 · 390 px · compte (erreurs, déconnexion, connexion, adresse) puis une pizza à emporter jusqu'à « prête »
// =====================================================================================================================
async function p01({ ui }) {
  const c = compteTest(1);
  await ui.aller('/compte.html');
  controle('compte.html : le formulaire de connexion est affiché, l\'inscription est masquée', (await ui.existe('#loginForm')) && !(await ui.existe('#signupForm')));
  await controleDebordement(ui, 'compte.html');

  // Connexion avec un compte qui n'existe pas
  await connecter(ui, 'inconnu14@example.test', 'Quelconque-1234');
  let msg = await lireErreur(ui, 'loginError');
  controle('connexion avec un e-mail inconnu : message « E-mail ou mot de passe incorrect. »', msg === 'E-mail ou mot de passe incorrect.', `« ${msg} »`);

  // Cas d'erreur de l'inscription (aucune ne doit créer de compte)
  const cas = [
    { nom: 'prénom manquant', champs: { prenom: '' }, texte: 'Indiquez votre prénom et votre nom.', requete: 0 },
    { nom: 'e-mail invalide (sans @)', champs: { prenom: c.prenom, email: 'pas-un-email' }, texte: 'Adresse e-mail invalide : vérifiez-la (exemple : nom@domaine.fr).', requete: 0 },
    { nom: 'e-mail invalide pour le serveur (a@b..c)', champs: { email: 'a@b..c' }, texte: 'E-mail : Adresse e-mail invalide.', requete: 1, statut: 422 },
    { nom: 'mot de passe trop court (6 caractères)', champs: { email: c.email, mdp: 'abc123', confirmation: 'abc123' }, texte: 'Le mot de passe doit faire au moins 8 caractères.', requete: 0 },
    { nom: 'confirmation différente', champs: { mdp: 'Motdepasse-1', confirmation: 'Motdepasse-2' }, texte: 'Les deux mots de passe ne correspondent pas.', requete: 0 },
    { nom: 'téléphone vide', champs: { mdp: c.mdp, confirmation: c.mdp, tel: '' }, texte: 'Le numéro de téléphone est obligatoire.', requete: 0 },
    { nom: 'téléphone invalide (abc)', champs: { tel: 'abc' }, texte: 'Téléphone : Numéro de téléphone invalide.', requete: 1, statut: 422 },
    { nom: 'téléphone trop court (12345)', champs: { tel: '12345' }, texte: 'Téléphone : Numéro de téléphone invalide.', requete: 1, statut: 422 }
  ];
  const form = { ...c, rue: undefined, ville: null };
  for (const k of cas) {
    Object.assign(form, k.champs);
    const m = Date.now();
    const { echecs } = await remplirInscription(ui, form);
    const lu = await lireErreur(ui, 'signupError');
    const reqs = ui.requetes('customer_signup', m);
    controle(`inscription, ${k.nom} : message « ${k.texte} »`, echecs.length === 0 && lu === k.texte, `« ${lu} »${echecs.length ? ' · gestes en échec ' + json(echecs) : ''}`);
    controle(`inscription, ${k.nom} : ${k.requete} requête(s) vers le serveur${k.statut ? ' (statut ' + k.statut + ')' : ''}`, reqs.length === k.requete && (!k.statut || reqs[0].statut === k.statut), json(reqs.map((q) => q.statut)));
  }
  controle('aucun compte créé par les inscriptions refusées', compteBase(c.email) === undefined && compteBase('a@b..c') === undefined);

  // Inscription valide
  Object.assign(form, c, { confirmation: c.mdp });
  await remplirInscription(ui, form);
  const connecte = await ui.attendre("(() => { const e = document.getElementById('accountLoggedIn'); return !!e && !e.hidden; })()", 15000);
  controle('inscription valide : la page passe à « connecté »', connecte);
  controle('inscription valide : nom et e-mail affichés', (await ui.texte('#accountName')) === `${c.prenom} ${c.nom}` && (await ui.texte('#accountEmail')) === c.email, `${await ui.texte('#accountName')} · ${await ui.texte('#accountEmail')}`);
  controle('inscription valide : « Aucune commande pour le moment. »', (await ui.texte('#accountOrders')) === 'Aucune commande pour le moment.', await ui.texte('#accountOrders'));
  const cli = compteBase(c.email);
  controle('inscription valide : le compte existe en base (téléphone enregistré tel quel)', !!cli && cli.phone === c.tel, json(cli));

  // Déconnexion
  await ui.cliquer('#logoutBtn');
  const invite = await ui.attendre("(() => { const e = document.getElementById('accountGuest'); return !!e && !e.hidden; })()", 8000);
  controle('déconnexion : la page repasse en mode invité', invite);
  controle('déconnexion : le serveur ne reconnaît plus la session', (await moi(ui)) === null);

  // E-mail déjà pris (même casse, puis majuscules)
  for (const [lib, email] of [['même e-mail', c.email], ['e-mail en majuscules', c.email.toUpperCase()]]) {
    const m = Date.now();
    await remplirInscription(ui, { ...c, email, ville: null, rue: undefined });
    const lu = await lireErreur(ui, 'signupError');
    const reqs = ui.requetes('customer_signup', m);
    controle(`inscription, ${lib} déjà pris : message « Un compte existe déjà avec cet e-mail — connectez-vous plutôt. »`, lu === 'Un compte existe déjà avec cet e-mail — connectez-vous plutôt.' && reqs.length === 1 && reqs[0].statut === 409, `« ${lu} » · ${json(reqs.map((q) => q.statut))}`);
  }
  controle('toujours un seul compte pour cet e-mail', site.db.prepare('SELECT COUNT(*) AS n FROM customers WHERE email = ?').get(c.email).n === 1);

  // Connexion : mauvais mot de passe puis bon
  await connecter(ui, c.email, 'Mauvais-mot-de-passe-1');
  msg = await lireErreur(ui, 'loginError');
  controle('connexion avec un mauvais mot de passe : message « E-mail ou mot de passe incorrect. »', msg === 'E-mail ou mot de passe incorrect.', `« ${msg} »`);
  controle('connexion refusée : toujours invité', (await moi(ui)) === null);
  await connecter(ui, c.email, c.mdp);
  const reco = await ui.attendre("(() => { const e = document.getElementById('accountLoggedIn'); return !!e && !e.hidden; })()", 15000);
  controle('connexion avec le bon mot de passe : connecté', reco && (await ui.texte('#accountName')) === `${c.prenom} ${c.nom}`, await ui.texte('#accountName'));
  controle('connexion réussie : le serveur reconnaît le client', ((await moi(ui)) || {}).email === c.email);

  // Adresse en zone
  c.rue = '14 rue des Parcours';
  c.ville = 'Hénin-Beaumont';
  await ui.saisir('#addressStreet', c.rue);
  await ui.choisir('#addressCity', c.ville);
  await ui.cliquer('#addressSubmit');
  await ui.attendre("(() => { const e = document.getElementById('addressSuccess'); return !!e && !e.hidden; })()", 8000);
  controle('adresse en zone : message « Adresse enregistrée ✓ »', (await ui.texte('#addressSuccess')) === 'Adresse enregistrée ✓', await ui.texte('#addressSuccess'));
  const apres = await moi(ui);
  controle('adresse en zone : enregistrée côté serveur', apres && apres.street === c.rue && apres.city === c.ville, json(apres));

  // Une pizza simple à emporter
  await ui.aller('/menu.html', { menu: true });
  await controleDebordement(ui, 'menu.html');
  const a = await ajouterPizza(ui, { carte: 'Végétarienne', taille: 'Solo' });
  controle('pizza simple (Végétarienne Solo) : gestes réussis', a.echecs.length === 0, json(a.echecs));
  const lignes = [a.ligne];
  const aff = await tiroirEtAffichage(ui, 'P01', lignes, 'pickup', null);
  await controleDebordement(ui, 'tiroir du panier');
  controle('à emporter : le tiroir annonce le mode « À emporter »', aff.mode === 'pickup' && aff.libelleTotal === 'Total à emporter', `${aff.mode} / ${aff.libelleTotal}`);
  const r = await passerCommande(ui);
  const res = await verifierApresCommande(ui, 'P01', r, { aff, lignes, mode: 'pickup', compte: c });
  if (!res) return;

  // Le commerçant accepte puis marque « prête » : la page de suivi suit sans rechargement
  const acc = await patron.post('owner_order_decide.php', { id: r.id, action: 'accept', delay_minutes: 20 });
  controle('le commerçant accepte la commande (20 min)', acc.status === 200, `HTTP ${acc.status}`);
  const vuAcceptee = await ui.attendre("document.getElementById('orderTrackBody').getAttribute('data-order-status') === 'accepted'", 15000);
  controle('suivi : « acceptée » apparaît sans recharger la page (sondage)', vuAcceptee);
  const sAcc = await lireSuivi(ui);
  controle('suivi : minuteur M:SS autour de 20:00', /^(19|20):\d{2}$/.test(sAcc.minuteur), sAcc.minuteur);
  controle('suivi : bloc « acceptée » (classe order-track-status--ok)', sAcc.classes.includes('order-track-status--ok'), sAcc.classes);
  const pret = await patron.post('owner_order_decide.php', { id: r.id, action: 'ready' });
  controle('le commerçant marque la commande prête', pret.status === 200, `HTTP ${pret.status}`);
  const vuPrete = await ui.attendre("document.getElementById('orderTrackBody').getAttribute('data-order-status') === 'ready'", 15000);
  controle('suivi : « prête » apparaît sans recharger la page', vuPrete);
  const sPret = await lireSuivi(ui);
  controle('suivi : « Votre commande est prête ! »', sPret.texte.includes('Votre commande est prête !') && sPret.classes.includes('order-track-status--ready'), sPret.classes);

  // Historique du compte
  await ui.aller('/compte.html');
  await ui.attendre("document.querySelector('#accountOrders .account-order') !== null", 8000);
  const hist = await ui.evaluer("[...document.querySelectorAll('#accountOrders .account-order')].map((e) => ({ tag: e.tagName, href: e.getAttribute('href'), texte: e.textContent.replace(/\\s+/g, ' ').trim() }))");
  controle('historique du compte : une commande, lien vers son suivi, statut « Prête »', hist.length === 1 && hist[0].href === `commande.html?id=${r.id}` && hist[0].texte.includes('Prête') && hist[0].texte.includes(eur(lignes[0].unite)), json(hist));
}

/** Inscription par le formulaire + contrôle de l'adresse enregistrée. */
async function inscriptionCheck(ui, c) {
  const ins = await inscrire(ui, c);
  controle(`inscription par le formulaire (${c.ville ? 'adresse ' + c.ville : 'sans adresse'})`, ins.connecte && ins.echecs.length === 0, ins.connecte ? json(ins.echecs) : `erreur affichée : ${ins.erreur}`);
  const m = await moi(ui);
  controle('compte créé : adresse enregistrée comme saisie', !!m && m.city === (c.ville || null) && m.street === (c.ville ? c.rue : null), json(m && { street: m.street, city: m.city }));
  return ins.connecte;
}

const contient = (texte, attendu) => typeof texte === 'string' && texte.includes(attendu);

// =====================================================================================================================
// P02 · 768 px · Duo personnalisée (retrait, suppléments, échange gratuit, demande), XXL, Solo ; promo et bascule livraison / emporter
// =====================================================================================================================
async function p02({ ui }) {
  const c = compteTest(2, { ville: 'Montigny-en-Gohelle' });
  if (!(await inscriptionCheck(ui, c))) return;
  await ui.aller('/menu.html', { menu: true });
  await controleDebordement(ui, 'menu.html');
  const a1 = await ajouterPizza(ui, { carte: 'Végétarienne', taille: 'Duo', retraits: ['poivrons'], supplements: ['câpres', 'artichauts', 'thon'], note: 'Bien cuite' });
  controle('Végétarienne Duo, sans poivrons, + câpres + artichauts + thon, « Bien cuite » : gestes réussis', a1.echecs.length === 0, json(a1.echecs));
  controle('résumé sous la pizza : câpres « échange offert » et prix 19,50 €', contient(a1.resume, 'câpres (échange offert)') && a1.resume.endsWith('Prix : 19,50 €'), a1.resume);
  const a2 = await ajouterPizza(ui, { carte: '4 Saisons', taille: 'XXL' });
  controle('4 Saisons XXL : bouton d\'ajout annonce 33,00 €', a2.echecs.length === 0 && contient(a2.libelleAjout, '33,00 €'), a2.libelleAjout);
  const a3 = await ajouterPizza(ui, { carte: '3 Jambons', taille: 'Solo', retraits: ['jambon'], supplements: ['kebab', 'olives'] });
  controle('3 Jambons Solo, sans jambon, + kebab (échange) + olives (payante) : prix 12,00 €', a3.echecs.length === 0 && contient(a3.resume, 'kebab (échange offert)') && a3.resume.endsWith('Prix : 12,00 €'), a3.resume || json(a3.echecs));
  const lignes = [a1.ligne, a2.ligne, a3.ligne];
  const aff = await tiroirEtAffichage(ui, 'P02', lignes, 'pickup', null);
  await controleDebordement(ui, 'tiroir du panier');
  controle('3 pizzas à emporter : relance « Ajoutez encore 1 pizza » visible, promo = la moins chère offerte', contient(aff.relance, 'Ajoutez encore 1 pizza') && contient(aff.promoLibelle, '1 offerte'), `relance « ${aff.relance} » · promo « ${aff.promoLibelle} »`);
  // Bascule livraison (adresse à Montigny-en-Gohelle) puis retour à emporter : tout est recalculé
  await ui.basculer('delivery');
  await attendreStatutLivraison(ui);
  const affL = await ui.lirePanierAffiche();
  verifierAffichage(controle, 'P02 livraison', affL, lignes, 'delivery', 'Montigny-en-Gohelle');
  controle('livraison : « Livraison disponible à Montigny-en-Gohelle (minimum 15,00 €). » et pas de frais (pizzas)', contient(affL.statutLivraison, 'Livraison disponible à Montigny-en-Gohelle (minimum 15,00 €)') && contient(affL.statutLivraison, 'Pas de frais de livraison'), affL.statutLivraison);
  controle('livraison : la promo devient « 2ème à −50 % »', contient(affL.promoLibelle, '−50 %'), affL.promoLibelle);
  await ui.basculer('pickup');
  const affP = await ui.lirePanierAffiche();
  verifierAffichage(controle, 'P02 retour à emporter', affP, lignes, 'pickup', null);
  const r = await passerCommande(ui);
  await verifierApresCommande(ui, 'P02', r, { aff: affP, lignes, mode: 'pickup', compte: c });
}

// =====================================================================================================================
// P03 · 1280 px · moitié-moitié XXL (retrait de la 2e moitié + échange), Solo ×2, quantités +/−, bascule, DOUBLE CLIC sur « Commander »
// =====================================================================================================================
async function p03({ ui }) {
  const c = compteTest(3, { ville: 'Dourges' });
  if (!(await inscriptionCheck(ui, c))) return;
  await ui.aller('/menu.html', { menu: true });
  await controleDebordement(ui, 'menu.html');
  const a1 = await ajouterPizza(ui, { carte: 'Régina', taille: 'XXL', moitie: 'Chèvre miel', retraits: ['miel'], supplements: ['olives'] });
  controle('Régina XXL / Chèvre miel, sans miel (2e moitié), + olives : gestes réussis', a1.echecs.length === 0, json(a1.echecs));
  controle('résumé : « Régina / Chèvre miel (XXL) », olives en échange offert, prix 33,00 €', contient(a1.resume, 'Régina / Chèvre miel (XXL)') && contient(a1.resume, 'olives (échange offert)') && a1.resume.endsWith('Prix : 33,00 €'), a1.resume);
  const a2 = await ajouterPizza(ui, { carte: 'Végétarienne', taille: 'Solo', qte: 2 });
  controle('Végétarienne Solo ajoutée deux fois : une seule ligne de quantité 2', a2.echecs.length === 0 && (await ui.panierStocke()).filter((l) => l.name === 'Végétarienne')[0].qty === 2, json(a2.echecs));
  const lignes = [a1.ligne, a2.ligne];
  let aff = await tiroirEtAffichage(ui, 'P03', lignes, 'pickup', null);
  controle('3 pizzas à emporter : 1 offerte, 1 en reste (relance affichée)', contient(aff.relance, 'Ajoutez encore 1 pizza'), aff.relance);
  await ui.basculer('delivery');
  await attendreStatutLivraison(ui);
  aff = await ui.lirePanierAffiche();
  verifierAffichage(controle, 'P03 livraison', aff, lignes, 'delivery', 'Dourges');
  // Quantité −1 sur la Végétarienne (ligne Solo, première dans le tiroir) : tout est recalculé
  const dec = await ui.cliquer({ sel: '.cart-line__dec', index: 0 });
  controle('bouton « − » du tiroir (Végétarienne 2 → 1)', dec.ok);
  lignes[1] = { ...lignes[1], qte: 1 };
  aff = await ui.lirePanierAffiche();
  verifierAffichage(controle, 'P03 quantité 1', aff, lignes, 'delivery', 'Dourges');
  const inc = await ui.cliquer({ sel: '.cart-line__inc', index: 0 });
  controle('bouton « + » du tiroir (Végétarienne 1 → 2)', inc.ok);
  lignes[1] = { ...lignes[1], qte: 2 };
  aff = await ui.lirePanierAffiche();
  verifierAffichage(controle, 'P03 quantité 2', aff, lignes, 'delivery', 'Dourges');
  const dec2 = await ui.cliquer({ sel: '.cart-line__dec', index: 0 });
  lignes[1] = { ...lignes[1], qte: 1 };
  await ui.basculer('pickup');
  aff = await ui.lirePanierAffiche();
  controle('retour à emporter avec quantité 1', dec2.ok);
  verifierAffichage(controle, 'P03 à emporter', aff, lignes, 'pickup', null);
  controle('2 pizzas à emporter (XXL + Solo) : pas de relance, la Solo est offerte', !aff.relance && aff.promo === 1100, `relance « ${aff.relance} », promo ${eur(aff.promo)}`);
  const r = await passerCommande(ui, { fois: 2 });
  await verifierApresCommande(ui, 'P03 (double clic)', r, { aff, lignes, mode: 'pickup', compte: c });
}

// =====================================================================================================================
// P04 · 390 px · calzone + garniture, pâtes, boisson, dessert ; +/− ; supprimer une ligne ; vider le panier ; rechargement
// =====================================================================================================================
async function p04({ ui }) {
  const c = compteTest(4);
  if (!(await inscriptionCheck(ui, c))) return;
  await ui.aller('/menu.html', { menu: true });
  await controleDebordement(ui, 'menu.html');
  const CAL = 'Calzone (soufflée)';
  // Calzone : la garniture est obligatoire
  await ui.cliquer({ sel: '.pizza-widget__size', carte: CAL, debut: 'Duo' });
  controle('calzone sans garniture : « Ajouter telle quelle » désactivé', (await ui.actif({ sel: '.pizza-widget__quickadd', carte: CAL })) === false);
  controle('calzone : choix de garniture proposé (jambon, thon, kebab, viande hachée, poulet)', (await ui.compte({ sel: '.pizza-widget__filler-btn', carte: CAL })) === 5, `${await ui.compte({ sel: '.pizza-widget__filler-btn', carte: CAL })} boutons`);
  await ui.cliquer({ sel: '.pizza-widget__toggle', carte: CAL });
  controle('calzone : pas de moitié-moitié proposée', (await ui.existe({ sel: '.customize__half-toggle', carte: CAL })) === false);
  await ui.cliquer({ sel: '.pizza-widget__toggle', carte: CAL });
  const a1 = await ajouterPizza(ui, { carte: CAL, nomLigne: 'Calzone (soufflée) — Poulet', taille: 'Duo', garniture: 'Poulet', base: CAL });
  controle('calzone Duo + garniture Poulet : ajoutée', a1.echecs.length === 0, json(a1.echecs));
  const a2 = await ajouterProduit(ui, { carte: 'Bolognaise', nomLigne: 'Pâtes Bolognaise', retraits: ['oignons'], note: 'Spaghettis' });
  controle('Pâtes Bolognaise sans oignons, « Spaghettis » : ajoutées', a2.echecs.length === 0, json(a2.echecs));
  const a3 = await ajouterProduit(ui, { carte: 'Oasis Pomme Poire canette', nomLigne: 'Boisson Oasis Pomme Poire canette', qte: 2 });
  controle('Boisson Oasis Pomme Poire canette ×2 (bouton Ajouter puis « + » du compteur)', a3.echecs.length === 0 && (await ui.texte({ sel: '.add-to-cart__qty', carte: 'Oasis Pomme Poire canette' })) === '2', json(a3.echecs));
  const a4 = await ajouterProduit(ui, { carte: 'Tiramisubito Oreo', nomLigne: 'Dessert Tiramisubito Oreo' });
  controle('Dessert Tiramisubito Oreo : ajouté', a4.echecs.length === 0, json(a4.echecs));
  // Une boisson a 11 parfums : le client peut-il dire lequel ?
  const choixBoisson = (await ui.existe({ sel: '.pizza-widget__toggle', carte: 'Oasis Pomme Poire canette' })) || (await ui.existe({ sel: '.customize__note', carte: 'Oasis Pomme Poire canette', visible: false }));
  controle('Boisson Oasis Pomme Poire canette (11 parfums sur la carte) : le client peut indiquer son parfum (choix ou demande libre)', choixBoisson, choixBoisson ? 'oui' : 'aucun champ ni bouton de choix : la commande part sans le parfum');
  let lignes = [a1.ligne, a2.ligne, a3.ligne, a4.ligne];
  let aff = await tiroirEtAffichage(ui, 'P04', lignes, 'pickup', null);
  await controleDebordement(ui, 'tiroir du panier');
  // Ordre d'affichage : produits sans taille d'abord, puis les tailles
  controle('tiroir : produits sans taille d\'abord, la calzone (Duo) en dernier', json(aff.lignes.map((l) => l.nom)) === json(['Pâtes Bolognaise', 'Boisson Oasis Pomme Poire canette', 'Dessert Tiramisubito Oreo', 'Calzone (soufflée) — Poulet']), json(aff.lignes.map((l) => l.nom)));
  // « + » sur les pâtes (ligne 1) puis « − »
  await ui.cliquer({ sel: '.cart-line__inc', index: 0 });
  lignes[1] = { ...lignes[1], qte: 2 };
  aff = await ui.lirePanierAffiche();
  verifierAffichage(controle, 'P04 pâtes ×2', aff, lignes, 'pickup', null);
  await ui.cliquer({ sel: '.cart-line__dec', index: 0 });
  lignes[1] = { ...lignes[1], qte: 1 };
  aff = await ui.lirePanierAffiche();
  verifierAffichage(controle, 'P04 pâtes ×1', aff, lignes, 'pickup', null);
  // Corbeille sur le dessert (3e ligne)
  await ui.cliquer({ sel: '.cart-line__remove', index: 2 });
  lignes = [a1.ligne, a2.ligne, a3.ligne];
  aff = await ui.lirePanierAffiche();
  verifierAffichage(controle, 'P04 dessert retiré', aff, lignes, 'pickup', null);
  // Vider le panier : annulé puis confirmé
  ui.reponseDialogue = false;
  const nd = ui.dialogues.length;
  await ui.cliquer('#cartDrawerClear');
  controle('« Vider le panier » : la confirmation « Vider tout le panier ? » est demandée', ui.dialogues.length === nd + 1 && ui.dialogues[nd].message === 'Vider tout le panier ?', json(ui.dialogues.slice(nd)));
  controle('« Vider le panier » annulé : le panier reste intact', (await ui.panierStocke()).length === 3, `${(await ui.panierStocke()).length} lignes`);
  ui.reponseDialogue = true;
  await ui.cliquer('#cartDrawerClear');
  await ui.attendre("(() => (JSON.parse(localStorage.getItem('subito_cart_v1') || '[]')).length === 0)()", 4000);
  aff = await ui.lirePanierAffiche();
  controle('« Vider le panier » confirmé : panier vide, tiroir « vide pour le moment », barre masquée', (await ui.panierStocke()).length === 0 && contient(await ui.texte('.cart-drawer__empty'), 'Votre panier est vide') && !aff.barre.visible, `${(await ui.panierStocke()).length} lignes · barre visible ${aff.barre.visible}`);
  await ui.fermerTiroir();
  // Nouveau panier, persistance après rechargement, puis commande
  const b1 = await ajouterPizza(ui, { carte: CAL, nomLigne: 'Calzone (soufflée) — Thon', taille: 'Quatro', garniture: 'Thon', base: CAL });
  const b2 = await ajouterProduit(ui, { carte: 'Carbonara', nomLigne: 'Pâtes Carbonara' });
  const b3 = await ajouterProduit(ui, { carte: 'Coca-Cola Original Taste grande bouteille', nomLigne: 'Boisson Coca-Cola Original Taste grande bouteille' });
  const b4 = await ajouterProduit(ui, { carte: 'Part de Tarte au Daim', nomLigne: 'Dessert Part de Tarte au Daim' });
  controle('nouveau panier : calzone Quatro Thon, pâtes Carbonara, grande bouteille, tarte au Daim', [b1, b2, b3, b4].every((x) => x.echecs.length === 0), json([b1, b2, b3, b4].map((x) => x.echecs)));
  lignes = [b1.ligne, b2.ligne, b3.ligne, b4.ligne];
  await ui.aller('/menu.html', { menu: true });
  const stocke = await ui.panierStocke();
  controle('rechargement de la page : le panier est conservé (4 lignes)', Array.isArray(stocke) && stocke.length === 4, `${Array.isArray(stocke) ? stocke.length : stocke} lignes`);
  const barre = await ui.lirePanierAffiche();
  controle('rechargement : la barre du panier affiche 4 articles et 37,50 €', barre.barre.visible && barre.barre.nb === '4' && barre.barre.total === 3750, json(barre.barre));
  controle('rechargement : les compteurs des cartes se resynchronisent (boisson : « Ajouter » devient compteur à 1)', (await ui.texte({ sel: '.add-to-cart__qty', carte: 'Coca-Cola Original Taste grande bouteille' })) === '1', await ui.texte({ sel: '.add-to-cart__qty', carte: 'Coca-Cola Original Taste grande bouteille' }));
  aff = await tiroirEtAffichage(ui, 'P04 après rechargement', lignes, 'pickup', null);
  const r = await passerCommande(ui);
  await verifierApresCommande(ui, 'P04', r, { aff, lignes, mode: 'pickup', compte: c });
}

/** « Commander en ligne » doit être refusé par la page elle-même : message attendu, aucune requête d'envoi. */
async function commandeBloquee(ui, ref, attendu) {
  const r = await passerCommande(ui, { attente: 1200 });
  controle(`${ref} : « Commander en ligne » refusé avec « ${attendu} », aucun envoi`, !r.redirige && contient(r.message, attendu) && r.requetes.length === 0, `message « ${r.message} » · ${r.requetes.length} envoi(s)`);
}
const payer = (ui, methode) => ui.cliquer(`.payment-method__btn[data-method="${methode}"]`);
const billet = (ui, montant) => ui.cliquer(`.payment-method__btn[data-change="${montant}"]`);
const statutContient = (ui, texte, ms = 8000) => ui.attendre(`(() => { const s = document.getElementById('deliveryStatus'); return !!s && s.textContent.includes(${json(texte)}); })()`, ms);

// =====================================================================================================================
// P05 · 768 px · livraison SANS pizza : frais, minimum non atteint, moyens de paiement (espèces + billet, carte ticket), appoint exact
// =====================================================================================================================
async function p05({ ui }) {
  const c = compteTest(5, { ville: 'Hénin-Beaumont' });
  if (!(await inscriptionCheck(ui, c))) return;
  await ui.aller('/menu.html', { menu: true });
  const a1 = await ajouterProduit(ui, { carte: 'Carbonara', nomLigne: 'Pâtes Carbonara' });
  controle('Pâtes Carbonara ajoutées', a1.echecs.length === 0, json(a1.echecs));
  const lignes = [a1.ligne];
  await ui.ouvrirTiroir();
  await ui.basculer('delivery');
  await attendreStatutLivraison(ui);
  let aff = await ui.lirePanierAffiche();
  verifierAffichage(controle, 'P05 sous le minimum', aff, lignes, 'delivery', 'Hénin-Beaumont');
  controle('livraison sans pizza sous le minimum : « Minimum pour Hénin-Beaumont : 10,00 € — il manque 1,50 €. »', contient(aff.statutLivraison, 'Minimum pour Hénin-Beaumont : 10,00 € — il manque 1,50 €.'), aff.statutLivraison);
  controle('livraison sans pizza : total = 8,50 € + frais 5,50 € = 14,00 €', aff.total === 1400 && aff.libelleTotal === 'Total livraison', `${eur(aff.total)} (« ${aff.libelleTotal} »)`);
  await commandeBloquee(ui, 'P05 minimum non atteint', 'Minimum pour Hénin-Beaumont : 10,00 € — il manque 1,50 €.');
  // Quantité 2 : le minimum est atteint
  await ui.cliquer({ sel: '.cart-line__inc', index: 0 });
  lignes[0] = { ...lignes[0], qte: 2 };
  await statutContient(ui, 'Livraison disponible');
  aff = await ui.lirePanierAffiche();
  verifierAffichage(controle, 'P05 minimum atteint', aff, lignes, 'delivery', 'Hénin-Beaumont');
  controle('minimum atteint : « Livraison disponible à Hénin-Beaumont (minimum 10,00 €). » + « Frais de livraison : 5,50 € (commande sans pizza). »', contient(aff.statutLivraison, 'Livraison disponible à Hénin-Beaumont (minimum 10,00 €).') && contient(aff.statutLivraison, 'Frais de livraison : 5,50 € (commande sans pizza).'), aff.statutLivraison);
  controle('livraison : total = 17,00 € + frais 5,50 € = 22,50 €', aff.total === 2250, eur(aff.total));
  // Paiement : rien de choisi, puis espèces sans billet
  controle('livraison : aucun moyen de paiement choisi au départ, bloc billet absent', aff.paiements.length === 0 && (await ui.compte('.payment-method__btn[data-change]')) === 0, json(aff.paiements));
  await commandeBloquee(ui, 'P05 aucun moyen de paiement', 'Choisissez au moins un moyen de paiement pour la livraison.');
  await payer(ui, 'cash');
  controle('« Espèces » choisi : le choix du billet apparaît (10, 20, 50, 100 €, appoint exact)', (await ui.compte('.payment-method__btn[data-change]')) === 5, `${await ui.compte('.payment-method__btn[data-change]')} boutons`);
  await commandeBloquee(ui, 'P05 espèces sans billet', 'Précisez avec quel billet vous réglez, pour que le livreur prépare la monnaie.');
  // Plusieurs moyens : espèces + carte ticket restaurant, billet 50 €, puis on retire les espèces (le billet s'efface)
  await payer(ui, 'ticket_card');
  await billet(ui, 50);
  aff = await ui.lirePanierAffiche();
  controle('espèces + carte ticket restaurant, billet 50 € : boutons actifs', json(aff.paiements) === json(['cash', 'ticket_card']) && aff.billet === 50, json([aff.paiements, aff.billet]));
  await payer(ui, 'cash');
  aff = await ui.lirePanierAffiche();
  controle('espèces retirées : seule la carte ticket reste, le choix du billet disparaît', json(aff.paiements) === json(['ticket_card']) && (await ui.compte('.payment-method__btn[data-change]')) === 0, json([aff.paiements, aff.billet]));
  await payer(ui, 'cash');
  aff = await ui.lirePanierAffiche();
  controle('espèces re-choisies : le billet 50 € n\'est pas conservé (à re-choisir)', json(aff.paiements) === json(['cash', 'ticket_card']) && aff.billet === null, json([aff.paiements, aff.billet]));
  await commandeBloquee(ui, 'P05 billet oublié', 'Précisez avec quel billet vous réglez');
  await billet(ui, 0);
  aff = await ui.lirePanierAffiche();
  controle('« Appoint exact » choisi (billet 0)', aff.billet === 0, json(aff.billet));
  await controleDebordement(ui, 'tiroir du panier (livraison)');
  const r = await passerCommande(ui);
  const res = await verifierApresCommande(ui, 'P05', r, { aff, lignes, mode: 'delivery', compte: c, paiements: ['cash', 'ticket_card'], billet: 0, ville: 'Hénin-Beaumont' });
  if (res) {
    controle('suivi : moyens de paiement « Espèces (appoint exact) · Carte Ticket Restaurant »', contient(res.suivi.paiement, 'Espèces (appoint exact)') && contient(res.suivi.paiement, 'Carte Ticket Restaurant'), res.suivi.paiement);
    controle('suivi : frais de livraison 5,50 € affichés', res.suivi.frais === 550, eur(res.suivi.frais));
  }
}

// =====================================================================================================================
// P06 · 1280 px · INVITÉ : panier d'abord, livraison + paiement choisis, « Commander » -> inscription avec adresse -> la commande repart seule
// =====================================================================================================================
async function p06({ ui }) {
  const c = compteTest(6, { ville: 'Rouvroy' });
  await ui.aller('/menu.html', { menu: true });
  const a1 = await ajouterPizza(ui, { carte: 'Kebab', taille: 'XXL' });
  const a2 = await ajouterPizza(ui, { carte: 'Napolitaine', taille: 'Duo' });
  controle('invité : Kebab XXL et Napolitaine Duo ajoutées', a1.echecs.length === 0 && a2.echecs.length === 0, json([a1.echecs, a2.echecs]));
  const lignes = [a1.ligne, a2.ligne];
  await ui.ouvrirTiroir();
  await ui.basculer('delivery');
  await attendreStatutLivraison(ui);
  await payer(ui, 'card');
  await payer(ui, 'cash');
  await billet(ui, 100);
  const aff = await ui.lirePanierAffiche();
  verifierAffichage(controle, 'P06 invité', aff, lignes, 'delivery', null);
  controle('invité en livraison : « Connectez-vous pour vérifier le minimum de votre ville. »', contient(aff.statutLivraison, 'Connectez-vous pour vérifier le minimum de votre ville.'), aff.statutLivraison);
  controle('paiement choisi : carte bancaire + espèces, billet 100 €', json(aff.paiements) === json(['card', 'cash']) && aff.billet === 100, json([aff.paiements, aff.billet]));
  const panierAvant = await ui.stockage('subito_cart_v1');
  const clic = await ui.cliquer('#checkoutOrder');
  controle('invité : « Commander en ligne » renvoie vers compte.html avec retour au menu', clic.ok && (await ui.attendre("location.pathname === '/compte.html'", 8000)) && (await ui.url()) === '/compte.html?retour=%2Fmenu.html', await ui.url());
  controle('aucune commande envoyée tant que le client n\'est pas connecté', ui.requetes('order_create').length === 0);
  controle('mémoire du départ : mode livraison, paiements, billet et panier conservés', (await ui.stockage('subito_pending_order_mode', true)) === 'delivery'
    && (await ui.stockage('subito_pending_payment_methods', true)) === '["card","cash"]' && (await ui.stockage('subito_pending_cash_change', true)) === '100'
    && (await ui.stockage('subito_pending_cart', true)) === panierAvant && /^\d{10,}$/.test((await ui.stockage('subito_pending_order_redirect', true)) || ''),
  json([await ui.stockage('subito_pending_order_mode', true), await ui.stockage('subito_pending_payment_methods', true), await ui.stockage('subito_pending_cash_change', true)]));
  controle('panier intact pendant la connexion', (await ui.stockage('subito_cart_v1')) === panierAvant);
  // Inscription avec adresse : la commande doit repartir toute seule
  const t = Date.now();
  const { echecs } = await remplirInscription(ui, c);
  controle('inscription (avec adresse à Rouvroy) depuis le détour de commande : gestes réussis', echecs.length === 0, json(echecs));
  const redirige = await ui.attendre("location.pathname === '/commande.html'", 30000);
  const id = redirige ? await idDuSuivi(ui) : null;
  const reqs = ui.requetes('order_create', t);
  const r = { redirige, id, message: null, url: await ui.url(), requetes: reqs };
  const res = await verifierApresCommande(ui, 'P06 (reprise après inscription)', r, { aff, lignes, mode: 'delivery', compte: c, paiements: ['card', 'cash'], billet: 100, ville: 'Rouvroy' });
  if (res) controle('suivi : « Carte bancaire · Espèces (billet de 100 €) »', contient(res.suivi.paiement, 'Carte bancaire') && contient(res.suivi.paiement, 'Espèces (billet de 100 €)'), res.suivi.paiement);
}

// =====================================================================================================================
// P07 · 390 px · livraison SANS adresse : message, « Ajouter mon adresse », oubli de la ville, bonne adresse, retour au panier, minimum
// =====================================================================================================================
async function p07({ ui }) {
  const c = compteTest(7);
  if (!(await inscriptionCheck(ui, c))) return;
  await ui.aller('/menu.html', { menu: true });
  const a1 = await ajouterPizza(ui, { carte: 'Subito', taille: 'Solo' });
  const a2 = await ajouterProduit(ui, { carte: 'Oasis Pomme Poire canette', nomLigne: 'Boisson Oasis Pomme Poire canette' });
  controle('Subito Solo et Boisson Oasis Pomme Poire canette ajoutées', a1.echecs.length === 0 && a2.echecs.length === 0, json([a1.echecs, a2.echecs]));
  const lignes = [a1.ligne, a2.ligne];
  await ui.ouvrirTiroir();
  await ui.basculer('delivery');
  await attendreStatutLivraison(ui);
  let aff = await ui.lirePanierAffiche();
  controle('livraison sans adresse : « Ajoutez votre adresse dans Mon compte pour commander en livraison. » + bouton « Ajouter mon adresse »', contient(aff.statutLivraison, 'Ajoutez votre adresse dans Mon compte pour commander en livraison.') && (await ui.existe('#deliveryAddAddress')), aff.statutLivraison);
  await commandeBloquee(ui, 'P07 sans adresse', 'Ajoutez votre adresse dans Mon compte pour commander en livraison.');
  // Aller ajouter l'adresse
  await ui.cliquer('#deliveryAddAddress');
  await ui.attendre("location.pathname === '/compte.html'", 8000);
  controle('« Ajouter mon adresse » : compte.html avec retour au menu', (await ui.url()) === '/compte.html?retour=%2Fmenu.html&addAddress=1', await ui.url());
  await ui.attendre("(() => { const e = document.getElementById('accountLoggedIn'); return !!e && !e.hidden; })()", 8000);
  await ui.saisir('#addressStreet', '7 rue du Test');
  await ui.cliquer('#addressSubmit');
  // Oubli de la ville : la page doit refuser et le dire ; elle ne doit ni renvoyer au panier ni afficher « enregistrée ».
  await ui.attendre("location.pathname !== '/compte.html' || (document.getElementById('addressError') && !document.getElementById('addressError').hidden) || (document.getElementById('addressSuccess') && !document.getElementById('addressSuccess').hidden)", 6000);
  const urlOubli = await ui.url();
  const erreurOubli = await ui.texte('#addressError');
  const m = await moi(ui);
  controle('adresse saisie SANS ville : la page refuse et demande la ville (rien d\'enregistré, pas de retour au panier)', urlOubli.startsWith('/compte.html') && !!erreurOubli && m.street === null,
    `url ${urlOubli} · erreur « ${erreurOubli} » · serveur : rue ${json(m.street)}, ville ${json(m.city)}`);
  if (!urlOubli.startsWith('/compte.html')) {
    // Le site a renvoyé au panier sans adresse : on y retourne, le tiroir rouvert en livraison redemande l'adresse
    await ui.attendre("(() => { const o = document.getElementById('cartOverlay'); return !!o && !o.hidden; })()", 8000);
    const manque = await statutContient(ui, 'Ajoutez votre adresse');
    controle('après le retour au panier, l\'adresse manque toujours (message affiché)', manque, await ui.texte('#deliveryStatus'));
    await ui.cliquer('#deliveryAddAddress');
    await ui.attendre("location.pathname === '/compte.html'", 8000);
    await ui.attendre("(() => { const e = document.getElementById('accountLoggedIn'); return !!e && !e.hidden; })()", 8000);
  }
  c.rue = '7 rue du Test';
  c.ville = 'Billy-Montigny';
  await ui.saisir('#addressStreet', c.rue);
  await ui.choisir('#addressCity', c.ville);
  await ui.cliquer('#addressSubmit');
  const retour = await ui.attendre("location.pathname === '/menu.html'", 10000);
  controle('adresse en zone enregistrée : retour au menu', retour, await ui.url());
  const ouvert = await ui.attendre("(() => { const o = document.getElementById('cartOverlay'); return !!o && !o.hidden && !!document.querySelector('.order-mode-toggle__btn.is-active'); })()", 8000);
  await attendreStatutLivraison(ui);
  aff = await ui.lirePanierAffiche();
  controle('retour du compte : le tiroir se rouvre tout seul en mode Livraison, panier conservé', ouvert && aff.mode === 'delivery' && aff.lignes.length === 2, `ouvert ${ouvert}, mode ${aff.mode}, ${aff.lignes.length} lignes`);
  controle('retour du compte : aucune commande envoyée toute seule', ui.requetes('order_create').length === 0);
  controle('Billy-Montigny : « Minimum pour Billy-Montigny : 20,00 € — il manque 7,50 €. »', contient(aff.statutLivraison, 'Minimum pour Billy-Montigny : 20,00 € — il manque 7,50 €.'), aff.statutLivraison);
  verifierAffichage(controle, 'P07 sous le minimum', aff, lignes, 'delivery', 'Billy-Montigny');
  // Subito ×2 (ligne 2 du tiroir) : 2e pizza à moitié prix ; boisson ×3 (ligne 1) : le minimum est atteint
  await ui.cliquer({ sel: '.cart-line__inc', index: 1 });
  lignes[0] = { ...lignes[0], qte: 2 };
  await statutContient(ui, 'il manque 2,00 €');
  aff = await ui.lirePanierAffiche();
  controle('Subito ×2 (2e à −50 %) : « il manque 2,00 € »', contient(aff.statutLivraison, 'il manque 2,00 €'), aff.statutLivraison);
  await ui.cliquer({ sel: '.cart-line__inc', index: 0 });
  await ui.cliquer({ sel: '.cart-line__inc', index: 0 });
  lignes[1] = { ...lignes[1], qte: 3 };
  await statutContient(ui, 'Livraison disponible');
  aff = await ui.lirePanierAffiche();
  verifierAffichage(controle, 'P07 minimum atteint', aff, lignes, 'delivery', 'Billy-Montigny');
  controle('Billy-Montigny : « Livraison disponible à Billy-Montigny (minimum 20,00 €). », pas de frais (pizzas)', contient(aff.statutLivraison, 'Livraison disponible à Billy-Montigny (minimum 20,00 €).') && contient(aff.statutLivraison, 'Pas de frais de livraison'), aff.statutLivraison);
  await payer(ui, 'ticket');
  aff = await ui.lirePanierAffiche();
  controle('paiement : Ticket Restaurant seul, pas de billet', json(aff.paiements) === json(['ticket']) && aff.billet === null, json([aff.paiements, aff.billet]));
  const r = await passerCommande(ui);
  await verifierApresCommande(ui, 'P07', r, { aff, lignes, mode: 'delivery', compte: c, paiements: ['ticket'], billet: null, ville: 'Billy-Montigny' });
}

// =====================================================================================================================
// P08 · 768 px · composer.html + vegetarien.html, panier d'une page à l'autre, DEUX ONGLETS, rechargement
// =====================================================================================================================
async function p08({ ui, nav, p }) {
  const c = compteTest(8);
  if (!(await inscriptionCheck(ui, c))) return;
  await ui.aller('/composer.html');
  await ui.attendre("document.querySelector('.compose-pizza .pizza-widget') !== null", 8000);
  await controleDebordement(ui, 'composer.html');
  const a1 = await ajouterPizza(ui, { racine: '.compose-pizza', base: 'Marguerita (base)', nomLigne: 'Marguerita (base)', taille: 'Duo', supplements: ['poulet', 'miel'], note: 'Base crème fraîche' });
  controle('composer.html : Marguerita Duo + poulet + miel + « Base crème fraîche »', a1.echecs.length === 0 && a1.resume.endsWith('Prix : 16,50 €'), a1.resume || json(a1.echecs));
  controle('composer.html : pas de « Sans » ni de moitié-moitié (aucun ingrédient / parfum à proposer)', (await ui.compte({ sel: '.customize__half-toggle', dans: '.compose-pizza' })) === 0 && (await ui.compte({ sel: '.customize__chip:not(.customize__chip--extra)', dans: '.compose-pizza' })) === 0);
  await ui.aller('/vegetarien.html', { menu: true });
  await controleDebordement(ui, 'vegetarien.html');
  const barreV = await ui.lirePanierAffiche();
  controle('vegetarien.html : le panier de composer.html est là (barre : 1 article, 13,00 € + suppléments = 16,50 €)', barreV.barre.visible && barreV.barre.nb === '1' && barreV.barre.total === 1650, json(barreV.barre));
  const parfums = await ui.evaluer("[...document.querySelectorAll('.menu-item')].map((a) => a.querySelector('.menu-item__name').textContent.trim())");
  const opts = await ui.evaluer("[...document.querySelectorAll('.pizza-widget')[0].closest('.menu-item').querySelectorAll('label.customize__half-row select option')].map((o) => o.textContent.trim()).slice(1)");
  controle('vegetarien.html : la 2e moitié ne propose que les pizzas de la page', json(opts) === json(parfums), `${opts.length} parfums / ${parfums.length} pizzas`);
  const a2 = await ajouterPizza(ui, { carte: 'Chèvre miel', taille: 'Solo' });
  controle('vegetarien.html : Chèvre miel Solo ajoutée', a2.echecs.length === 0, json(a2.echecs));
  const lignes = [a1.ligne, a2.ligne];
  // Deuxième onglet : même panier
  const uiB = await Ui.ouvrir(nav, { largeur: p.largeur, hauteur: p.hauteur, ip: `10.14.${p.num}.1`, base: ui.base });
  try {
    await uiB.activer();
    await uiB.aller('/menu.html', { menu: true });
    let affB = await uiB.lirePanierAffiche();
    controle('2e onglet (menu.html) : panier identique (2 articles, 16,50 €)', affB.barre.visible && affB.barre.nb === '2' && affB.barre.total === 1650, json(affB.barre));
    await uiB.ouvrirTiroir();
    await uiB.cliquer({ sel: '.cart-line__inc', index: 0 });
    await ui.activer();
    const sync = await ui.attendre("document.getElementById('cartBarCount').textContent === '3'", 5000);
    controle('onglet 1 : la quantité changée dans l\'onglet 2 apparaît sans recharger (3 articles)', sync, await ui.texte('#cartBarCount'));
    await ui.ouvrirTiroir();
    let aff = await ui.lirePanierAffiche();
    const l2 = [a1.ligne, { ...a2.ligne, qte: 2 }];
    verifierAffichage(controle, 'P08 onglet 1 après « + » de l\'onglet 2', aff, l2, 'pickup', null);
    // Tiroir ouvert dans les deux onglets : « − » dans l'onglet 2 -> l'onglet 1 se met à jour
    await uiB.activer();
    await uiB.cliquer({ sel: '.cart-line__dec', index: 0 });
    await ui.activer();
    const sync2 = await ui.attendre("(() => { const l = document.querySelector('#cartDrawerBody .cart-line__qty-value'); return !!l && l.textContent === '1'; })()", 5000);
    controle('onglet 1 (tiroir ouvert) : « − » fait dans l\'onglet 2, la ligne repasse à 1 sans recharger', sync2, await ui.texte('#cartDrawerBody .cart-line__qty-value'));
    // Rechargement de l'onglet 1 : le panier est conservé
    await ui.aller('/vegetarien.html', { menu: true });
    const stocke = await ui.panierStocke();
    controle('rechargement : panier conservé (2 lignes, quantités 1)', Array.isArray(stocke) && stocke.length === 2 && stocke.every((l) => l.qty === 1), json(Array.isArray(stocke) ? stocke.map((l) => [l.name, l.qty]) : stocke));
    aff = await tiroirEtAffichage(ui, 'P08 après rechargement', lignes, 'pickup', null);
    const r = await passerCommande(ui);
    await verifierApresCommande(ui, 'P08', r, { aff, lignes, mode: 'pickup', compte: c });
    // L'autre onglet voit le panier vidé (tiroir encore ouvert chez lui)
    await uiB.activer();
    const vide = await uiB.attendre("(() => { const b = document.getElementById('cartBar'); return !!b && b.hidden; })()", 6000);
    controle('onglet 2 : après la commande faite dans l\'onglet 1, son panier est vidé sans recharger', vide && (await uiB.panierStocke()).length === 0 && contient(await uiB.texte('.cart-drawer__empty'), 'Votre panier est vide'), `barre masquée ${vide}`);
    controle('onglet 2 : aucune exception JavaScript', uiB.erreurs.length === 0, json(uiB.erreurs.slice(0, 3)));
  } finally {
    await uiB.fermer();
  }
}

// =====================================================================================================================
// P09 · 1280 px · COUPURE RÉSEAU pendant l'envoi : hors ligne puis retour, réponse perdue, renvoi retrouve la commande, double clic
// =====================================================================================================================
async function p09({ ui }) {
  const c = compteTest(9);
  if (!(await inscriptionCheck(ui, c))) return;
  await ui.aller('/menu.html', { menu: true });
  const a1 = await ajouterPizza(ui, { carte: 'Subito', taille: 'Solo' });
  const a2 = await ajouterProduit(ui, { carte: 'Oasis Pomme Poire canette', nomLigne: 'Boisson Oasis Pomme Poire canette' });
  const lignes = [a1.ligne, a2.ligne];
  const aff = await tiroirEtAffichage(ui, 'P09', lignes, 'pickup', null);
  const MSG = 'Connexion interrompue : votre commande n’a peut-être pas été reçue. Vous pouvez réessayer sans risque.';
  const attendreMessage = (texte) => ui.attendre(`(() => { const e = document.getElementById('checkoutOrderStatus'); return !!e && !e.hidden && e.textContent.includes(${json(texte)}); })()`, 10000);

  // 1. Le client passe hors ligne au moment d'envoyer : la requête ne part pas
  await ui.couper('avant');
  await ui.cliquer('#checkoutOrder');
  const m1 = await attendreMessage('Connexion interrompue');
  const msg1 = await ui.texte('#checkoutOrderStatus');
  controle('hors ligne à l\'envoi : message clair « Connexion interrompue… Vous pouvez réessayer sans risque. »', m1 && msg1 === MSG, `« ${msg1} »`);
  controle('hors ligne à l\'envoi : la requête a été tentée une seule fois', ui.coupure.n === 1, `${ui.coupure.n}`);
  controle('hors ligne à l\'envoi : aucune commande enregistrée', nbCommandesBase(c.email) === 0, `${nbCommandesBase(c.email)}`);
  controle('hors ligne à l\'envoi : bouton « Commander en ligne » de nouveau actif, panier intact', (await ui.actif('#checkoutOrder')) === true && (await ui.panierStocke()).length === 2, `actif ${await ui.actif('#checkoutOrder')}`);
  const tentatives = JSON.parse((await ui.stockage('subito_order_attempt')) || '[]');
  controle('hors ligne à l\'envoi : la clé d\'envoi est gardée (issue inconnue) pour un renvoi sans doublon', Array.isArray(tentatives) && tentatives.length === 1 && tentatives[0].unknown === true, json(tentatives));
  const cle = tentatives[0] && tentatives[0].key;
  const corps1 = JSON.parse(ui.coupure.corps[0] || '{}');
  controle('hors ligne à l\'envoi : la clé envoyée est celle qui est gardée', corps1.idempotency_key === cle, `${corps1.idempotency_key} / ${cle}`);
  await ui.retablir();

  // 2. Réseau revenu, mais la RÉPONSE se perd : le serveur a enregistré la commande, la page croit à un échec
  await ui.couper('apres');
  await ui.cliquer('#checkoutOrder');
  const m2 = await attendreMessage('Connexion interrompue');
  const msg2 = await ui.texte('#checkoutOrderStatus');
  controle('réponse perdue : le serveur a bien répondu 201 (la page, elle, ne le sait pas)', ui.coupure.n === 1 && ui.coupure.statuts[0] === 201, json(ui.coupure.statuts));
  controle('réponse perdue : même message clair, panier non vidé, bouton actif', m2 && msg2 === MSG && (await ui.panierStocke()).length === 2 && (await ui.actif('#checkoutOrder')) === true, `« ${msg2} »`);
  const apres2 = await commandesDuClient(patron, c.email.toLowerCase());
  controle('réponse perdue : exactement UNE commande enregistrée chez le commerçant', apres2 && apres2.length === 1, `${apres2 ? apres2.length : '?'}`);
  const corps2 = JSON.parse(ui.coupure.corps[0] || '{}');
  controle('réponse perdue : le renvoi utilise la même clé d\'envoi que la tentative précédente', corps2.idempotency_key === cle, `${corps2.idempotency_key} / ${cle}`);
  await ui.retablir();

  // 3. Renvoi (double clic rapide) : le serveur retrouve la commande déjà enregistrée
  const t = Date.now();
  const r = await passerCommande(ui, { fois: 2 });
  controle('renvoi : redirigé vers la commande déjà enregistrée (commande.html?id=…&deja=1)', r.redirige && !!apres2 && r.id === apres2[0].id && (await ui.url()).includes('&deja=1'), `url ${r.url} · attendu id ${apres2 && apres2[0].id}`);
  controle('renvoi (double clic) : une seule requête, répondue 200 (rejeu, pas 201)', r.requetes.length === 1 && r.requetes[0].statut === 200, json(r.requetes.map((q) => q.statut)));
  const corps3 = JSON.parse(r.requetes[0] && r.requetes[0].corps || '{}');
  controle('renvoi : toujours la même clé d\'envoi', corps3.idempotency_key === cle, corps3.idempotency_key);
  const final = await commandesDuClient(patron, c.email.toLowerCase());
  controle('renvoi : toujours UNE seule commande (pas de doublon)', final && final.length === 1 && nbCommandesBase(c.email) === 1, `${final ? final.length : '?'} chez le commerçant, ${nbCommandesBase(c.email)} en base`);
  await ui.attendre("(() => { const b = document.getElementById('orderTrackBody'); return !!b && !!b.getAttribute('data-order-status'); })()", 15000);
  const suivi = await lireSuivi(ui);
  controle('suivi : message « Cette commande avait déjà été enregistrée : aucune nouvelle commande n’a été créée. »', suivi.notes.includes('Cette commande avait déjà été enregistrée : aucune nouvelle commande n’a été créée.'), json(suivi.notes));
  verifierCommande(controle, 'P09', final && final[0], { aff, lignes, mode: 'pickup', compte: c });
  verifierSuivi(controle, 'P09', suivi, final && final[0]);
  controle('le panier est vidé et la mémoire d\'envoi effacée après le renvoi', (await ui.panierStocke()).length === 0 && (await ui.stockage('subito_order_attempt')) === null, json([await ui.panierStocke(), await ui.stockage('subito_order_attempt')]));
}

// =====================================================================================================================
// P10 · 390 px · SESSION EXPIRÉE en plein panier : (1) session périmée en cache, (2) panier modifié ailleurs pendant la connexion, (3) page de suivi
// =====================================================================================================================
const expirerSession = (email) => {
  const cli = compteBase(email);
  return site.db.prepare("UPDATE sessions SET expires_at = '2020-01-01T00:00:00Z' WHERE user_type = 'customer' AND user_id = ? AND revoked_at IS NULL").run(cli.id).changes;
};
async function p10({ ui, nav, p }) {
  const c = compteTest(10, { ville: 'Courrières' });
  if (!(await inscriptionCheck(ui, c))) return;
  await ui.aller('/menu.html', { menu: true });
  const a1 = await ajouterPizza(ui, { carte: 'Kefta', taille: 'XXL' });
  const lignes = [a1.ligne];
  await ui.ouvrirTiroir();
  await ui.basculer('delivery');
  await attendreStatutLivraison(ui);
  await payer(ui, 'cash');
  await billet(ui, 50);
  await payer(ui, 'ticket');
  const aff = await ui.lirePanierAffiche();
  verifierAffichage(controle, 'P10', aff, lignes, 'delivery', 'Courrières');
  controle('paiement : espèces (billet 50 €) + ticket restaurant', json(aff.paiements) === json(['cash', 'ticket']) && aff.billet === 50, json([aff.paiements, aff.billet]));
  const panierAvant = await ui.stockage('subito_cart_v1');

  // (1) La session expire côté serveur pendant que le panier est ouvert (la page garde l'ancienne session en mémoire)
  controle('la session du client est périmée côté serveur', expirerSession(c.email) === 1);
  const t1 = Date.now();
  await ui.cliquer('#checkoutOrder');
  const versLogin = await ui.attendre("location.pathname === '/compte.html'", 10000);
  const envois1 = ui.requetes('order_create', t1);
  controle('session expirée : l\'envoi est refusé (401) puis le client est renvoyé vers la connexion (retour au menu)', versLogin && envois1.length === 1 && envois1[0].statut === 401 && (await ui.url()) === '/compte.html?retour=%2Fmenu.html', `url ${await ui.url()} · envois ${json(envois1.map((q) => q.statut))}`);
  controle('session expirée : le panier est conservé pendant la connexion', (await ui.stockage('subito_cart_v1')) === panierAvant);
  controle('session expirée : mode livraison, paiements et billet mémorisés', (await ui.stockage('subito_pending_order_mode', true)) === 'delivery' && (await ui.stockage('subito_pending_payment_methods', true)) === '["cash","ticket"]' && (await ui.stockage('subito_pending_cash_change', true)) === '50',
    json([await ui.stockage('subito_pending_order_mode', true), await ui.stockage('subito_pending_payment_methods', true), await ui.stockage('subito_pending_cash_change', true)]));
  controle('connexion : la page affiche bien le formulaire (le client n\'est plus connecté)', await ui.attendre("(() => { const e = document.getElementById('accountGuest'); return !!e && !e.hidden; })()", 8000));
  const t2 = Date.now();
  await connecter(ui, c.email, c.mdp);
  const reprise = await ui.attendre("location.pathname === '/commande.html'", 30000);
  const id1 = reprise ? await idDuSuivi(ui) : null;
  const envois2 = ui.requetes('order_create', t2);
  const res = await verifierApresCommande(ui, 'P10 (reprise après connexion)', { redirige: reprise, id: id1, message: null, url: await ui.url(), requetes: envois2 }, { aff, lignes, mode: 'delivery', compte: c, paiements: ['cash', 'ticket'], billet: 50, ville: 'Courrières' });
  if (!res) return;

  // (2) Nouveau panier ; session périmée ; la page est rechargée (aucune session en mémoire) ; le panier change dans un autre onglet pendant la connexion
  await ui.aller('/menu.html', { menu: true });
  const b1 = await ajouterProduit(ui, { carte: 'Coca-Cola Original Taste grande bouteille', nomLigne: 'Boisson Coca-Cola Original Taste grande bouteille' });
  const b2 = await ajouterProduit(ui, { carte: 'Calzone Nutella', nomLigne: 'Dessert Calzone Nutella' });
  controle('2e panier : grande bouteille + calzone Nutella', b1.echecs.length === 0 && b2.echecs.length === 0, json([b1.echecs, b2.echecs]));
  controle('la session du client est de nouveau périmée', expirerSession(c.email) === 1);
  await ui.aller('/menu.html', { menu: true });
  await ui.ouvrirTiroir();
  const t3 = Date.now();
  await ui.cliquer('#checkoutOrder');
  const versLogin2 = await ui.attendre("location.pathname === '/compte.html'", 10000);
  controle('page rechargée avec session périmée : renvoi direct vers la connexion, sans aucun envoi de commande', versLogin2 && ui.requetes('order_create', t3).length === 0, `url ${await ui.url()} · envois ${ui.requetes('order_create', t3).length}`);
  const uiB = await Ui.ouvrir(nav, { largeur: p.largeur, hauteur: p.hauteur, ip: `10.14.${p.num}.1`, base: ui.base });
  try {
    await uiB.activer();
    await uiB.aller('/menu.html', { menu: true });
    const b3 = await ajouterProduit(uiB, { carte: 'Oasis Pomme Poire canette', nomLigne: 'Boisson Oasis Pomme Poire canette' });
    controle('2e onglet : une boisson est ajoutée au panier pendant que la connexion est en cours', b3.echecs.length === 0, json(b3.echecs));
    await ui.activer();
    const t4 = Date.now();
    await connecter(ui, c.email, c.mdp);
    const retour = await ui.attendre("location.pathname === '/menu.html'", 15000);
    const avert = await ui.attendre("(() => { const e = document.getElementById('checkoutOrderStatus'); return !!e && !e.hidden && e.textContent.includes('Votre panier a changé'); })()", 8000);
    controle('panier modifié ailleurs pendant la connexion : la commande ne part PAS toute seule, le client est prévenu', retour && avert && ui.requetes('order_create', t4).length === 0, `message « ${await ui.texte('#checkoutOrderStatus')} » · envois ${ui.requetes('order_create', t4).length}`);
    const lignes2 = [b1.ligne, b2.ligne, b3.ligne];
    const aff2 = await ui.lirePanierAffiche();
    controle('le tiroir montre le panier complet (3 lignes) pour que le client vérifie', aff2.lignes.length === 3 && aff2.tiroirOuvert, `${aff2.lignes.length} lignes`);
    const r2 = await passerCommande(ui);
    await verifierApresCommande(ui, 'P10 2e commande', r2, { aff: aff2, lignes: lignes2, mode: 'pickup', compte: c, attendues: 2 });
  } finally {
    await uiB.fermer();
  }

  // (3) La page de suivi quand la session a expiré : connexion puis retour direct au suivi
  const idSuivi = await idDuSuivi(ui);
  controle('la session du client est périmée (page de suivi)', expirerSession(c.email) === 1);
  await ui.aller('/commande.html?id=' + idSuivi);
  const versLogin3 = await ui.attendre("location.pathname === '/compte.html'", 15000);
  controle('suivi avec session expirée : renvoi vers la connexion avec retour au suivi', versLogin3 && (await ui.url()) === '/compte.html?retour=' + encodeURIComponent('/commande.html?id=' + idSuivi), await ui.url());
  await connecter(ui, c.email, c.mdp);
  const retourSuivi = await ui.attendre("location.pathname === '/commande.html'", 15000);
  await ui.attendre("(() => { const b = document.getElementById('orderTrackBody'); return !!b && !!b.getAttribute('data-order-status'); })()", 15000);
  const sv = await lireSuivi(ui);
  controle('après la connexion : retour direct sur le suivi de la commande, affichée (statut « new »), aucune nouvelle commande', retourSuivi && (await ui.url()) === '/commande.html?id=' + idSuivi && sv && sv.statut === 'new' && nbCommandesBase(c.email) === 2, `url ${await ui.url()} · ${sv && sv.statut} · ${nbCommandesBase(c.email)} commande(s) en base`);
}

// =====================================================================================================================
const PARCOURS = [
  { num: 1, largeur: 390, hauteur: 844, titre: 'compte complet + pizza simple à emporter jusqu\'à « prête »', run: p01 },
  { num: 2, largeur: 768, hauteur: 1024, titre: 'Duo personnalisée, XXL, Solo ; promo ; bascule livraison / emporter', run: p02 },
  { num: 3, largeur: 1280, hauteur: 800, titre: 'moitié-moitié XXL, quantités +/−, bascule, double clic sur « Commander »', run: p03 },
  { num: 4, largeur: 390, hauteur: 844, titre: 'calzone, pâtes, boisson, dessert ; supprimer ; vider ; rechargement', run: p04 },
  { num: 5, largeur: 768, hauteur: 1024, titre: 'livraison sans pizza : frais, minimum, paiement espèces + billet, appoint exact', run: p05 },
  { num: 6, largeur: 1280, hauteur: 800, titre: 'invité : panier, livraison, inscription avec adresse, la commande repart seule', run: p06 },
  { num: 7, largeur: 390, hauteur: 844, titre: "livraison sans adresse : ajout d'adresse, oubli de la ville, minimum", run: p07 },
  { num: 8, largeur: 768, hauteur: 1024, titre: 'composer + vegetarien, panier entre pages et entre deux onglets, rechargement', run: p08 },
  { num: 9, largeur: 1280, hauteur: 800, titre: "coupure réseau pendant l'envoi, renvoi, double clic", run: p09 },
  { num: 10, largeur: 390, hauteur: 844, titre: 'session expirée en plein panier, reprise, panier modifié ailleurs, suivi', run: p10 }
];

await avecNavigateur(async (nav) => {
  for (const p of PARCOURS) {
    if (filtre && !filtre.includes(p.num)) continue;
    p.id = 'P' + String(p.num).padStart(2, '0');
    courant = p.id;
    const debut = Date.now();
    console.log(`\n--- ${p.id} · ${p.largeur} px · ${p.titre} (t=${secondes()} s)`);
    let ui = null;
    try {
      ui = await Ui.ouvrir(nav, { largeur: p.largeur, hauteur: p.hauteur, ip: `10.14.${p.num}.1`, base: site.base });
      await ui.sessionVide();
      await p.run({ ui, nav, p });
    } catch (e) {
      controle('le parcours va jusqu\'au bout sans exception du test', false, String(e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : e));
    } finally {
      if (ui) {
        controle('aucune exception JavaScript ni console.error dans la page', ui.erreurs.length === 0, json(ui.erreurs.slice(0, 3)));
        controle('aucun élément cliqué n\'était recouvert ou hors écran', ui.obstructions.length === 0, json(ui.obstructions.slice(0, 3)));
        try { await ui.fermer(); } catch { /* onglet déjà fermé */ }
      }
      parcoursDurees.push({ id: p.id, largeur: p.largeur, titre: p.titre, duree: ((Date.now() - debut) / 1000).toFixed(1) });
    }
  }
});

courant = 'fin';
const journal = site.journal();
controle('journal serveur : aucune erreur 500', !/ 500 |server_error/.test(journal), journal.trim().split('\n').slice(-3).join(' | ') || '(vide)');
controle('journal serveur : aucune donnée personnelle (e-mail, téléphone)', !/@example\.test|parcours14|06 14 14/.test(journal), 'journal inspecté');
const ok = bilan();
site.arreter();
process.exit(ok ? 0 : 1);
