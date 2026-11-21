// Batterie 14 : gestes de haut niveau d'un client (inscription par le formulaire, ajout au panier, commande) et comparaisons
// « ce que le client voit » / « ce que le test a cliqué » / « ce que le commerçant reçoit ». Tout passe par de vrais clics.
import { sleep } from '../../e2e/lib/cdp.mjs';
import { prixPizza, prixProduit, ordreAffichage, totaux, detailsAttendus } from './14-attendus.mjs';
import { enEuros } from './14-ui.mjs';

/** Dernière étape d'un geste qui a échoué : { etape, ...résultat }. */
const echec = (liste, etape, r) => { if (!r || !r.ok) liste.push({ etape, ...(r || {}) }); };

/**
 * Remplit le formulaire d'inscription de compte.html (onglet « Créer un compte ») puis le soumet.
 * compte : { prenom, nom, email, tel, mdp, confirmation?, rue?, ville? }. Renvoie { echecs }.
 */
export async function remplirInscription(ui, c, { soumettre = true } = {}) {
  const echecs = [];
  // L'onglet « Créer un compte » n'ouvre le formulaire qu'une fois ses écouteurs posés par compte.js
  // (init() après le chargement de window.SubitoAccount). On attend donc que la page soit prête, puis
  // on vérifie que le formulaire est bien révélé — un clic parti trop tôt ne basculerait pas l'onglet.
  await ui.attendre("!!window.SubitoAccount && !!document.getElementById('tabSignup')", 8000);
  echec(echecs, 'onglet', await ui.cliquer('#tabSignup'));
  if (!(await ui.attendre("(() => { const f = document.getElementById('signupForm'); return !!f && !f.hidden; })()", 4000))) {
    echec(echecs, 'onglet (2e essai)', await ui.cliquer('#tabSignup'));
    await ui.attendre("(() => { const f = document.getElementById('signupForm'); return !!f && !f.hidden; })()", 4000);
  }
  echec(echecs, 'prénom', await ui.saisir('#signupFirstName', c.prenom));
  echec(echecs, 'nom', await ui.saisir('#signupLastName', c.nom));
  echec(echecs, 'email', await ui.saisir('#signupEmail', c.email));
  echec(echecs, 'téléphone', await ui.saisir('#signupPhone', c.tel));
  echec(echecs, 'mot de passe', await ui.saisir('#signupPassword', c.mdp));
  echec(echecs, 'confirmation', await ui.saisir('#signupPasswordConfirm', c.confirmation === undefined ? c.mdp : c.confirmation));
  if (c.rue !== undefined) echec(echecs, 'rue', await ui.saisir('#signupStreet', c.rue));
  if (c.ville) echec(echecs, 'ville', await ui.choisir('#signupCity', c.ville));
  if (c.logement) echec(echecs, 'logement', await ui.choisir('#signupHousingType', c.logement));
  if (soumettre) {
    echec(echecs, 'envoi', await ui.cliquer('#signupSubmit'));
    // Depuis le 20/11, une inscription réussie affiche d'abord l'écran « Compte créé ! »
    // (#accountCreated) : il faut appuyer sur « Continuer » pour atteindre l'écran connecté.
    // Exceptions, où cet écran n'apparaît pas : les inscriptions refusées (erreur affichée,
    // pas de compte créé) et le détour de commande (reprise automatique qui quitte compte.html
    // tout de suite). On attend donc soit l'écran, soit l'un de ces deux dénouements, puis on
    // ne clique « Continuer » que si l'écran est bien présent.
    const ecranVisible = await ui.attendre(
      "(() => { const cr = document.getElementById('accountCreated'); if (cr && !cr.hidden) return true;"
      + " const er = document.getElementById('signupError'); if (er && !er.hidden) return true;"
      + " return location.pathname !== '/compte.html'; })()", 15000);
    if (ecranVisible && (await ui.evaluer("(() => { const e = document.getElementById('accountCreated'); return !!e && !e.hidden; })()"))) {
      echec(echecs, 'continuer', await ui.cliquer('#accountCreatedContinue'));
    }
  }
  return { echecs };
}

/** Inscription complète depuis une session vide : va sur compte.html, remplit, envoie, attend l'état connecté. */
export async function inscrire(ui, c) {
  await ui.aller('/compte.html');
  const { echecs } = await remplirInscription(ui, c);
  const connecte = await ui.attendre("(() => { const e = document.getElementById('accountLoggedIn'); return !!e && !e.hidden; })()", 15000);
  return { connecte, echecs, erreur: connecte ? null : await ui.texte('#signupError') };
}

/** Connexion par le formulaire (onglet « Se connecter »). */
export async function connecter(ui, email, mdp) {
  const echecs = [];
  echec(echecs, 'onglet', await ui.cliquer('#tabLogin'));
  echec(echecs, 'email', await ui.saisir('#loginEmail', email));
  echec(echecs, 'mot de passe', await ui.saisir('#loginPassword', mdp));
  echec(echecs, 'envoi', await ui.cliquer('#loginSubmit'));
  return { echecs };
}

/** Compte de test n° num : valeurs fabriquées, jamais réelles. */
export function compteTest(num, { ville = null, rue = null, logement = 'Maison' } = {}) {
  return {
    prenom: 'Alice' + num, nom: 'Parcours', email: `parcours14-${num}@example.test`,
    tel: '06 14 14 14 ' + String(10 + num).slice(-2), mdp: `Essai-14-${num}-Aa1!`,
    rue: ville ? (rue || `${num + 3} rue des Tests`) : undefined, ville,
    // Type de logement : obligatoire avec l'adresse de livraison depuis le 20/11 (voir cart.js SUBITO_HOUSING_TYPES).
    logement: ville ? logement : undefined
  };
}

/**
 * Ajoute une pizza depuis une carte de menu (menu.html, vegetarien.html) ou le widget de composer.html.
 * d : { carte | racine, nomLigne?, taille, garniture?, retraits?, supplements?, moitie? (nom de la seconde moitié), note?, qte?, rapide?, base? }
 * Renvoie { echecs, ligne } où `ligne` décrit ce que le client doit voir (prix calculés à part).
 */
export async function ajouterPizza(ui, d) {
  const echecs = [];
  const R = d.racine ? { dans: d.racine } : { carte: d.carte };
  const S = (sel, plus = {}) => ({ sel, ...R, ...plus });
  const retraits = d.retraits || [];
  const supplements = d.supplements || [];
  const perso = retraits.length > 0 || supplements.length > 0 || !!d.moitie || !!d.note;
  const base = d.base || d.nomLigne || d.carte;
  let resume = null;
  let libelleAjout = null;
  echec(echecs, 'taille ' + d.taille, await ui.cliquer(S('.pizza-widget__size', { debut: d.taille })));
  if (d.garniture) echec(echecs, 'garniture ' + d.garniture, await ui.cliquer(S('.pizza-widget__filler-btn', { texte: d.garniture })));
  if (!perso) {
    libelleAjout = await ui.texte(S('.pizza-widget__quickadd'));
    for (let k = 0; k < (d.qte || 1); k++) echec(echecs, 'ajout rapide', await ui.cliquer(S('.pizza-widget__quickadd')));
  } else {
    echec(echecs, 'personnaliser', await ui.cliquer(S('.pizza-widget__toggle')));
    if (d.moitie) {
      echec(echecs, 'moitié-moitié (case)', await ui.cliquer(S('.customize__half-toggle input')));
      echec(echecs, 'seconde moitié', await ui.choisir(S('label.customize__half-row select'), d.moitie));
    }
    for (const r of retraits) echec(echecs, 'sans ' + r, await ui.cliquer(S('.customize__chip', { texte: 'Sans ' + r })));
    if (supplements.length) {
      const pret = await ui.attendre(`(() => { const r = ${d.racine ? `document.querySelector(${JSON.stringify(d.racine)})` : `window.__t14.carte(${JSON.stringify(d.carte)})`}; return !!r && r.querySelectorAll('.customize__chip--extra').length > 0; })()`, 8000);
      if (!pret) echecs.push({ etape: 'suppléments non chargés' });
      for (const s of supplements) echec(echecs, '+ ' + s, await ui.cliquer(S('.customize__chip--extra', { texte: '+ ' + s })));
    }
    if (d.note) echec(echecs, 'demande', await ui.saisir(S('.customize__note'), d.note));
    resume = await ui.texte(S('.customize__summary'));
    for (let k = 0; k < (d.qte || 1); k++) echec(echecs, 'ajouter au panier', await ui.cliquer(S('.customize__add')));
  }
  const { unite, prixSupplements } = prixPizza(base, d.taille, { retraits, supplements });
  const ligne = {
    nom: d.nomLigne || (d.garniture ? `${d.carte} — ${d.garniture}` : (d.carte || base)),
    taille: d.taille, qte: d.qte || 1, retraits, supplements, prixSupplements, note: d.note || '', unite,
    moitie: d.moitie ? { flavor1: d.carte, flavor2: d.moitie } : null
  };
  return { echecs, ligne, resume, libelleAjout };
}

/**
 * Ajoute un produit sans taille. d : { carte, nomLigne, qte?, retraits?, note? }.
 * Sans personnalisation : bouton « Ajouter » puis « + » du compteur ; avec : panneau « Personnaliser » (pâtes, Subitowichs).
 */
export async function ajouterProduit(ui, d) {
  const echecs = [];
  const S = (sel, plus = {}) => ({ sel, carte: d.carte, ...plus });
  const retraits = d.retraits || [];
  const qte = d.qte || 1;
  if (retraits.length === 0 && !d.note) {
    echec(echecs, 'ajouter', await ui.cliquer(S('.add-to-cart__btn')));
    for (let k = 1; k < qte; k++) echec(echecs, '+ compteur', await ui.cliquer(S('.add-to-cart__inc')));
  } else {
    echec(echecs, 'personnaliser', await ui.cliquer(S('.pizza-widget__toggle')));
    for (const r of retraits) echec(echecs, 'sans ' + r, await ui.cliquer(S('.customize__chip', { texte: 'Sans ' + r })));
    if (d.note) echec(echecs, 'demande', await ui.saisir(S('.customize__note'), d.note));
    for (let k = 0; k < qte; k++) echec(echecs, 'ajouter au panier', await ui.cliquer(S('.customize__add')));
  }
  const ligne = { nom: d.nomLigne, taille: '', qte, retraits, supplements: [], prixSupplements: [], note: d.note || '', unite: prixProduit(d.nomLigne), moitie: null };
  return { echecs, ligne };
}

/** Attend que le statut de livraison soit calculé (le tiroir lit le compte avant de se prononcer). */
export async function attendreStatutLivraison(ui) {
  return ui.attendre("(() => { const s = document.getElementById('deliveryStatus'); return !!s && s.textContent.trim() !== '' && !/V.rification de votre adresse/.test(s.textContent); })()", 8000);
}

/** Lit la page de suivi (commande.html) telle que le client la voit. */
export async function lireSuivi(ui) {
  return ui.evaluer(`(() => {
    const n = window.__t14.norm; const c = window.__t14.cents;
    const body = document.getElementById('orderTrackBody');
    if (!body) return null;
    const frais = {};
    for (const r of body.querySelectorAll('.order-track-fee')) { const sp = r.querySelectorAll('span'); frais[n(sp[0].textContent)] = c(sp[1].textContent); }
    return {
      statut: body.getAttribute('data-order-status'),
      classes: (body.querySelector('.order-track-status') || { className: '' }).className,
      entete: n((body.querySelector('.order-track-number') || { textContent: '' }).textContent),
      lignes: [...body.querySelectorAll('.order-track-item')].map((i) => {
        const sp = i.querySelectorAll('.order-track-item__head span');
        const det = i.querySelector('.order-track-item__details');
        return { tete: n(sp[0].textContent), prix: c(sp[1].textContent), details: det ? n(det.textContent) : '' };
      }),
      promo: frais['Promotion'] === undefined ? null : frais['Promotion'],
      frais: frais['Frais de livraison'] === undefined ? null : frais['Frais de livraison'],
      total: c((body.querySelector('.order-track-total strong') || { textContent: '' }).textContent),
      paiement: n((body.querySelector('.order-track-payment') || { textContent: '' }).textContent),
      minuteur: n((document.getElementById('orderCountdown') || { textContent: '' }).textContent),
      notes: [...document.querySelectorAll('.account-hint[role="status"]')].map((e) => n(e.textContent)),
      texte: n(body.textContent)
    };
  })()`);
}

/** Identifiant de commande lu dans l'adresse de la page de suivi (commande.html?id=N…), ou null. */
export async function idDuSuivi(ui) {
  const u = await ui.evaluer('location.pathname + location.search');
  const m = /^\/commande\.html\?id=(\d+)/.exec(u);
  return m ? Number(m[1]) : null;
}

/**
 * Appuie sur « Commander en ligne » (fois = nombre de clics rapides) et attend soit la page de suivi, soit un message.
 * Renvoie { redirige, id, message, url, requetes } ; `requetes` = envois order_create partis depuis l'appui.
 */
export async function passerCommande(ui, { fois = 1, attente = 25000 } = {}) {
  const t = Date.now();
  const clic = await ui.cliquer('#checkoutOrder', { fois });
  if (!clic.ok) return { redirige: false, id: null, message: null, url: await ui.url(), clic, requetes: [] };
  const redirige = await ui.attendre("location.pathname === '/commande.html'", attente);
  await sleep(50);
  const id = redirige ? await idDuSuivi(ui) : null;
  const message = redirige ? null : await ui.texte('#checkoutOrderStatus');
  return { redirige, id, message, url: await ui.url(), clic, requetes: ui.requetes('order_create', t) };
}

/** Commande vue par le commerçant (API), ou null. */
export async function commandeChezPatron(patron, id) {
  const r = await patron.get('owner_orders.php');
  if (r.status !== 200 || !r.json) return null;
  return r.json.orders.find((o) => o.id === id) || null;
}

/** Toutes les commandes d'un client chez le commerçant (par e-mail). */
export async function commandesDuClient(patron, email) {
  const r = await patron.get('owner_orders.php');
  if (r.status !== 200 || !r.json) return null;
  return r.json.orders.filter((o) => o.customer_email === email);
}

const eur = (c) => (c === null || c === undefined ? 'null' : enEuros(c));
const json = (v) => JSON.stringify(v);

/**
 * Ce que le client voit dans le tiroir contre ce qui est attendu (prix calculés à part).
 * ctl(nom, ok, observé) enregistre un contrôle.
 */
export function verifierAffichage(ctl, ref, aff, lignes, mode, ville) {
  const att = ordreAffichage(lignes);
  const t = totaux(att, mode, ville);
  ctl(`${ref} tiroir : nombre de lignes`, aff.lignes.length === att.length, `${aff.lignes.length} affichées / ${att.length} attendues`);
  att.forEach((l, i) => {
    const a = aff.lignes[i] || {};
    const okId = a.nom === l.nom && a.variante === l.taille && a.qte === l.qte;
    const okPrix = a.unitaire === l.unite && a.sousTotal === l.unite * l.qte;
    const okDet = json(a.details) === json(detailsAttendus(l));
    ctl(`${ref} ligne ${i + 1} « ${l.nom}${l.taille ? ' (' + l.taille + ')' : ''} » ×${l.qte} : nom, taille, quantité, prix, détails`, okId && okPrix && okDet,
      `affiché ${json([a.nom, a.variante, a.qte, eur(a.unitaire), eur(a.sousTotal), a.details])} / attendu ${json([l.nom, l.taille, l.qte, eur(l.unite), eur(l.unite * l.qte), detailsAttendus(l)])}`);
  });
  ctl(`${ref} tiroir : promotion affichée = ${eur(t.promo)}`, (aff.promo || 0) === t.promo, `affichée ${eur(aff.promo)} (« ${aff.promoLibelle || 'aucune'} »)`);
  ctl(`${ref} tiroir : total affiché = ${eur(t.total)} (${mode === 'pickup' ? 'à emporter' : 'livraison, frais ' + eur(t.frais)})`, aff.total === t.total, `affiché ${eur(aff.total)} (« ${aff.libelleTotal} »)`);
  ctl(`${ref} barre du panier : total = tiroir`, aff.barre.visible && aff.barre.total === aff.total, `barre ${eur(aff.barre.total)} / tiroir ${eur(aff.total)}`);
  ctl(`${ref} barre du panier : nombre d'articles = ${att.reduce((s, l) => s + l.qte, 0)}`, Number(aff.barre.nb) === att.reduce((s, l) => s + l.qte, 0), `affiché ${aff.barre.nb}`);
  return t;
}

/**
 * La commande reçue par le commerçant contre ce que le client a vu et ce qui a été cliqué.
 * ctx : { aff, lignes, mode, compte (avec ville/rue effectives en livraison), paiements, billet, ville }.
 */
export function verifierCommande(ctl, ref, cmd, { aff, lignes, mode, compte, paiements = [], billet = null, ville = null }) {
  const att = ordreAffichage(lignes);
  const t = totaux(att, mode, ville);
  if (!cmd) { ctl(`${ref} commerçant : la commande est présente`, false, 'introuvable dans owner_orders'); return; }
  ctl(`${ref} commerçant : statut « new » (nouvelle), mode ${mode}`, cmd.status === 'new' && cmd.mode === mode, `statut ${cmd.status}, mode ${cmd.mode}`);
  ctl(`${ref} commerçant : client ${compte.prenom} ${compte.nom}, ${compte.email}, ${compte.tel}`,
    cmd.customer_name === `${compte.prenom} ${compte.nom}` && cmd.customer_email === compte.email.toLowerCase() && cmd.customer_phone === compte.tel,
    json([cmd.customer_name, cmd.customer_email, cmd.customer_phone]));
  ctl(`${ref} commerçant : ${att.length} ligne(s), mêmes que le panier affiché`, cmd.items.length === att.length, `${cmd.items.length} reçues / ${att.length}`);
  att.forEach((l, i) => {
    const it = cmd.items[i] || {};
    const extras = (it.extras || []).map((e) => [e.name, e.price_cents, e.qty]);
    const attExtras = l.supplements.map((n, k) => [n, l.prixSupplements[k], 1]);
    const ok = it.name === l.nom && it.variant === l.taille && it.qty === l.qte && it.unit_price_cents === l.unite
      && it.line_total_cents === l.unite * l.qte && json(it.removed) === json(l.retraits) && json(extras) === json(attExtras)
      && json(it.half) === json(l.moitie) && it.note === l.note;
    ctl(`${ref} commerçant : ligne ${i + 1} « ${l.nom}${l.taille ? ' (' + l.taille + ')' : ''} » identique (nom, taille, qté, prix, sans, suppléments, moitiés, demande)`, ok,
      `reçu ${json([it.name, it.variant, it.qty, eur(it.unit_price_cents), eur(it.line_total_cents), it.removed, extras, it.half, it.note])} / attendu ${json([l.nom, l.taille, l.qte, eur(l.unite), eur(l.unite * l.qte), l.retraits, attExtras, l.moitie, l.note])}`);
    // Ce que le client VOYAIT sur cette ligne = ce que le commerçant reçoit.
    const a = aff.lignes[i] || {};
    ctl(`${ref} affiché = reçu, ligne ${i + 1} : prix unitaire et sous-total`, a.unitaire === it.unit_price_cents && a.sousTotal === it.line_total_cents && a.qte === it.qty,
      `affiché ${json([eur(a.unitaire), eur(a.sousTotal), a.qte])} / reçu ${json([eur(it.unit_price_cents), eur(it.line_total_cents), it.qty])}`);
  });
  ctl(`${ref} commerçant : total ${eur(t.total)} = total affiché au client`, cmd.total_cents === t.total && cmd.total_cents === aff.total, `reçu ${eur(cmd.total_cents)}, affiché ${eur(aff.total)}, attendu ${eur(t.total)}`);
  ctl(`${ref} commerçant : produits ${eur(t.brut)}, promotion ${eur(t.promo)}, frais ${eur(t.frais)}`,
    cmd.products_cents === t.brut && cmd.promo_cents === t.promo && cmd.delivery_fee_cents === t.frais,
    `reçu ${json([eur(cmd.products_cents), eur(cmd.promo_cents), eur(cmd.delivery_fee_cents)])}`);
  ctl(`${ref} commerçant : promotion reçue = promotion affichée`, cmd.promo_cents === (aff.promo || 0), `reçue ${eur(cmd.promo_cents)}, affichée ${eur(aff.promo)}`);
  if (mode === 'delivery') {
    ctl(`${ref} commerçant : adresse ${compte.rue}, ${compte.ville}`, !!cmd.delivery_address && cmd.delivery_address.street === compte.rue && cmd.delivery_address.city === compte.ville, json(cmd.delivery_address));
    ctl(`${ref} commerçant : paiement ${json(paiements)}, billet ${billet}`, json(cmd.payment_methods) === json(paiements) && cmd.cash_change_for === billet, json([cmd.payment_methods, cmd.cash_change_for]));
  } else {
    ctl(`${ref} commerçant : à emporter, sans adresse ni moyen de paiement`, cmd.delivery_address === null && cmd.payment_methods.length === 0 && cmd.cash_change_for === null, json([cmd.delivery_address, cmd.payment_methods, cmd.cash_change_for]));
  }
}

/** La page de suivi affiche cette commande (client, lignes, prix, total, statut). */
export function verifierSuivi(ctl, ref, suivi, cmd, statutAttendu = 'new') {
  if (!suivi) { ctl(`${ref} suivi : la page affiche la commande`, false, 'conteneur absent'); return; }
  ctl(`${ref} suivi : statut « ${statutAttendu} » affiché`, suivi.statut === statutAttendu, `data-order-status = ${suivi.statut}`);
  ctl(`${ref} suivi : en-tête « Commande de ${cmd.customer_name} »`, suivi.entete.startsWith('Commande de ' + cmd.customer_name) && suivi.entete.includes(cmd.mode === 'delivery' ? 'Livraison' : 'À emporter'), suivi.entete);
  const attendu = cmd.items.map((it) => [`${it.qty} × ${it.name}${it.variant ? ' (' + it.variant + ')' : ''}`, it.line_total_cents]);
  const vu = suivi.lignes.map((l) => [l.tete, l.prix]);
  ctl(`${ref} suivi : ${cmd.items.length} ligne(s) avec leurs prix`, json(vu) === json(attendu), `vu ${json(vu)} / attendu ${json(attendu)}`);
  ctl(`${ref} suivi : total ${eur(cmd.total_cents)}, promotion ${eur(cmd.promo_cents)}, frais ${eur(cmd.delivery_fee_cents)}`,
    suivi.total === cmd.total_cents && (suivi.promo || 0) === cmd.promo_cents && (suivi.frais || 0) === cmd.delivery_fee_cents,
    `vu total ${eur(suivi.total)}, promo ${eur(suivi.promo)}, frais ${eur(suivi.frais)}`);
}
