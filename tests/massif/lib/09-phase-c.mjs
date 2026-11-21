// Phase C — clients et commandes XSS créés par l'API : chaque charge (prénom, nom, rue, remarque) tente
// d'exécuter window.__pwn=1 si elle est un jour interprétée comme du HTML ou du script. Au niveau de l'API,
// la seule garantie à prouver est que le texte est stocké et relu EXACTEMENT comme saisi (JSON, jamais de
// HTML) : la protection réelle contre l'exécution est l'échappement à l'affichage (fonctions esc() côté
// commerçant, textContent côté client), vérifié en navigateur réel par la phase D. Teste aussi les e-mails
// piégés (valides pour le serveur, dangereux pour du SQL ou du HTML) et les textes Unicode légitimes.
import { api, apiGet } from './09-http.mjs';
import { controle, detail, phase } from './09-verifs.mjs';
import { nettoyerNom, nettoyerRue, nettoyerNote, XSS_CLIENTS, EMAILS_PIEGES, TEXTES_UNICODE } from './09-charges.mjs';

export async function phaseXssApi({ compterTables, patron, commandeRetrait, cleOrdre, suffixe, etatIntact, lot, cas }) {
  phase('C · Clients et commandes XSS créés par l\'API');
  const avantC = compterTables();
  const crees = [];
  let nCommandes = 0;

  // C1 : chaque client XSS (prénom + nom + rue en une seule inscription) : stocké et relu tel quel.
  const casC1 = XSS_CLIENTS.map((x) => cas(x.id, async () => {
    const email = `xssc1-${x.id}-${suffixe()}@example.test`;
    const corps = { first_name: x.prenom, last_name: x.nom, email, phone: '0612345678', password: 'Xss-pass-1234!', street: x.rue, city: 'Dourges', housing_type: 'maison' };
    const r = await api('customer_signup', corps);
    if (r.status === 201) crees.push({ id: x.id, email, password: corps.password, customerId: r.json.customer.id });
    return r;
  }, { x }));
  await lot('C1 · client (prénom, nom, rue) : compte créé, chaque champ relu tel quel (JSON, jamais de HTML)', casC1, (r, c) => {
    if (r.status !== 201) return `attendu 201 (reçu ${r.status} ${r.json && r.json.error})`;
    const cu = r.json.customer;
    const attPrenom = nettoyerNom(c.x.prenom); const attNom = nettoyerNom(c.x.nom); const attRue = nettoyerRue(c.x.rue);
    if (cu.first_name !== attPrenom) return `prénom « ${cu.first_name} » ≠ attendu « ${attPrenom} »`;
    if (cu.last_name !== attNom) return `nom « ${cu.last_name} » ≠ attendu « ${attNom} »`;
    if (cu.street !== attRue) return `rue « ${cu.street} » ≠ attendu « ${attRue} »`;
    return null;
  });

  // C2 : pour chaque client XSS créé, une commande avec la remarque XSS : relue telle quelle côté client.
  const casC2 = [];
  let premiereCommandeId = null;
  for (const x of XSS_CLIENTS) {
    const trouve = crees.find((c) => c.id === x.id);
    if (!trouve) continue; // le compte C1 n'a pas été créé (déjà signalé ci-dessus) : pas de commande à tenter.
    casC2.push(cas(x.id, async () => {
      const l = await api('customer_login', { email: trouve.email, password: trouve.password });
      const cookie = (l.entetes['set-cookie'] || []).map((s) => s.split(';')[0]).join('; ');
      const body = commandeRetrait({ note: x.note, cle: cleOrdre('xssc2') });
      const r = await api('order_create', body, { cookie });
      if (r.status === 201) { nCommandes++; if (premiereCommandeId === null) premiereCommandeId = r.json.order.id; }
      return r;
    }, { x, trouve }));
  }
  await lot('C2 · commande (remarque XSS) : créée, remarque relue telle quelle côté client', casC2, (r, c) => {
    if (r.status !== 201) return `attendu 201 (reçu ${r.status} ${r.json && r.json.error})`;
    const ligne = r.json.order && r.json.order.items && r.json.order.items[0];
    const attendu = nettoyerNote(c.x.note);
    return ligne && ligne.note === attendu ? null : `remarque relue « ${ligne && ligne.note} » ≠ attendu « ${attendu} »`;
  });

  // C3 : même vérification côté patron (owner_orders) — la vue du commerçant ne doit pas non plus altérer le texte.
  const po = await apiGet('owner_orders', { cookie: patron().cookieHeader() });
  let ecartsC3 = 0;
  if (po.status === 200 && po.json && Array.isArray(po.json.orders)) {
    for (const x of XSS_CLIENTS) {
      const trouve = crees.find((c) => c.id === x.id);
      if (!trouve) continue;
      const o = po.json.orders.find((cmd) => cmd.customer_email === trouve.email);
      const attendu = nettoyerNote(x.note);
      const ligne = o && o.items && o.items[0];
      if (!o || !ligne || ligne.note !== attendu) { ecartsC3++; detail(`${x.id} → patron : ${ligne ? ligne.note : 'commande introuvable'} ≠ attendu « ${attendu} »`); }
    }
  } else ecartsC3 = -1;
  controle('C3 · vue du patron (owner_orders) : chaque remarque XSS relue telle quelle', ecartsC3 === 0, ecartsC3 === -1 ? `owner_orders : ${po.status}` : `${ecartsC3} écart(s)`);

  // C4 : e-mails piégés (valides pour le serveur, dangereux pour du SQL/HTML) : acceptés, normalisés (minuscules, coupés).
  // Un suffixe est inséré avant le « @ » pour que chaque exécution reste unique (la phase A4 du même fichier
  // utilise déjà ces mêmes adresses piégées une fois par lancement : sans suffixe, ce serait un doublon 409, pas un bug).
  let nMails = 0;
  const casC4 = EMAILS_PIEGES.map((modele) => {
    const email = modele.replace('@example.test', `+${suffixe()}@example.test`);
    return cas(modele, async () => {
      const r = await api('customer_signup', { first_name: 'Piege', last_name: 'Mail', email, phone: '0612345678', password: 'Xss-pass-1234!' });
      if (r.status === 201) nMails++;
      return r;
    }, { email });
  });
  await lot('C4 · e-mail piégé (valide mais dangereux pour SQL/HTML) : accepté, normalisé', casC4, (r, c) => {
    if (r.status !== 201) return `attendu 201 (reçu ${r.status} ${r.json && r.json.error})`;
    const attendu = c.email.trim().toLowerCase();
    return r.json.customer && r.json.customer.email === attendu ? null : `e-mail stocké « ${r.json.customer && r.json.customer.email} » ≠ attendu « ${attendu} »`;
  });

  // C5 : textes Unicode légitimes ou inhabituels (emoji, RTL, combinants, astraux) : jamais refusés pour leur seul contenu
  // (sauf si le nettoyage les vide entièrement, auquel cas 422 est correct — un prénom vide n'est jamais valide).
  let nUnicode = 0;
  const casC5 = TEXTES_UNICODE.map((texte) => cas(JSON.stringify(texte).slice(0, 30), async () => {
    const r = await api('customer_signup', { first_name: texte, last_name: 'Unicode', email: `xssc5-${suffixe()}@example.test`, phone: '0612345678', password: 'Xss-pass-1234!' });
    if (r.status === 201) nUnicode++;
    return r;
  }, { texte }));
  await lot('C5 · prénom Unicode légitime ou inhabituel : jamais refusé pour son seul contenu', casC5, (r, c) => {
    const nettoye = nettoyerNom(c.texte);
    if (nettoye === '') return r.status === 422 ? null : `prénom vide après nettoyage : attendu 422 (reçu ${r.status})`;
    return r.status === 201 && r.json.customer && r.json.customer.first_name === nettoye ? null : `attendu 201 avec prénom « ${nettoye} » (reçu ${r.status} ${r.status === 201 ? r.json.customer.first_name : r.json && r.json.error})`;
  });

  // Bilan : seuls les comptes et commandes effectivement créés ci-dessus ont changé les tables, rien d'autre.
  const apresC = compterTables();
  etatIntact('C · après toutes les charges XSS', avantC, apresC, {
    customers: crees.length + nMails + nUnicode,
    orders: nCommandes,
    order_items: nCommandes
  });

  return { crees, premiereCommandeId, note: 'clients et commandes XSS créés par l\'API, pour une éventuelle vérification en navigateur (phase D).' };
}
