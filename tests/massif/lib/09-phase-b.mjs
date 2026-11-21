// Phase B — injection SQL dans chaque champ texte accepté par l'API (prénom, nom, rue, remarque de commande,
// recherche client côté patron). Le code serveur n'utilise que des requêtes préparées (placeholders « ? »,
// voir serveur/db.js) : aucune charge ne doit jamais être interprétée comme du SQL. Vérifié pour chaque
// charge : statut propre (201 ou 422, jamais 500 ni message de base de données — déjà contrôlé par lot()/
// problemes() importé indirectement), valeur stockée et relue identique à la charge envoyée (donc traitée
// comme un simple texte), tables et schéma intacts, et les charges temporelles (pg_sleep) ne ralentissent
// jamais la réponse (sinon la charge aurait été exécutée).
import { api } from './09-http.mjs';
import { controle, detail, phase } from './09-verifs.mjs';
import { nettoyerNom, nettoyerRue, nettoyerNote, SQLI, SQLI_TEMPS } from './09-charges.mjs';

const DELAI_SUSPECT_MS = 3000; // bien en dessous des 6 s de pg_sleep(6) demandés par SQLI_TEMPS : marge large.

export async function phaseSql({
  site, clients, patron, compterTables, schemaBase, schemaInitial, clientSuivant, commandeRetrait, baseInscription, cleOrdre, suffixe, etatIntact, lot, cas
}) {
  phase('B · Injection SQL dans chaque champ texte');
  const avantB = compterTables();

  // B1 : prénom, à l'inscription. Chaque charge doit soit créer un compte (nom stocké tel quel), jamais être exécutée.
  const casB1 = SQLI.map((charge) => cas(charge.slice(0, 40), async () => {
    const corps = { ...baseInscription(), first_name: charge, email: `sqlb1-${suffixe()}@example.test` };
    return api('customer_signup', corps);
  }, { charge }));
  await lot('B1 · prénom (customer_signup) : compte créé, prénom stocké tel quel', casB1, (r, c) => {
    if (r.status !== 201) return `attendu 201 (reçu ${r.status} ${r.json && r.json.error})`;
    const attendu = nettoyerNom(c.charge);
    return r.json.customer && r.json.customer.first_name === attendu ? null : `prénom stocké « ${r.json.customer && r.json.customer.first_name} » ≠ attendu « ${attendu} »`;
  });

  // B2 : rue, à l'inscription (avec une ville valide pour exercer tout le chemin de validation d'adresse).
  const casB2 = SQLI.map((charge) => cas(charge.slice(0, 40), async () => {
    const corps = { ...baseInscription(), street: charge, city: 'Dourges', housing_type: 'maison', email: `sqlb2-${suffixe()}@example.test` };
    return api('customer_signup', corps);
  }, { charge }));
  await lot('B2 · rue (customer_signup) : compte créé, rue stockée telle quelle', casB2, (r, c) => {
    if (r.status !== 201) return `attendu 201 (reçu ${r.status} ${r.json && r.json.error})`;
    const attendu = nettoyerRue(c.charge);
    return r.json.customer && r.json.customer.street === attendu ? null : `rue stockée « ${r.json.customer && r.json.customer.street} » ≠ attendu « ${attendu} »`;
  });

  // B3 : remarque d'une ligne de commande (à emporter). La commande doit être acceptée, la remarque relue à l'identique.
  const casB3 = SQLI.map((charge) => cas(charge.slice(0, 40), async () => {
    const c = clientSuivant();
    const body = commandeRetrait({ note: charge, cle: cleOrdre('sqlb3') });
    return api('order_create', body, { cookie: c.cookieHeader() });
  }, { charge }));
  await lot('B3 · remarque de commande (order_create) : commande créée, remarque relue telle quelle', casB3, (r, c) => {
    if (r.status !== 201) return `attendu 201 (reçu ${r.status} ${r.json && r.json.error})`;
    const ligne = r.json.order && r.json.order.items && r.json.order.items[0];
    const attendu = nettoyerNote(c.charge);
    return ligne && ligne.note === attendu ? null : `remarque relue « ${ligne && ligne.note} » ≠ attendu « ${attendu} »`;
  });

  // B4 : recherche client côté patron (owner_customers, accès supérieur) — la requête ILIKE échappe ses jokers (%, _).
  const casB4 = SQLI.map((charge) => cas(charge.slice(0, 40), async () => api('owner_customers', { code: site.codeSuperieur, q: charge }, { cookie: patron().cookieHeader() }), { charge }));
  await lot('B4 · recherche client (owner_customers) : jamais d\'erreur, résultat toujours une liste', casB4, (r) => {
    if (r.status === 422) return null; // requête trop longue ou invalide : refus propre admis, pas une anomalie.
    return r.status === 200 && r.json && Array.isArray(r.json.customers) ? null : `attendu 200 avec « customers » (reçu ${r.status})`;
  });

  // B5 : charges temporelles (pg_sleep) dans le prénom ET la recherche patron — si elles étaient exécutées, la
  // réponse mettrait plus de 6 s (voir le commentaire de SQLI_TEMPS) ; on vérifie une marge large (3 s).
  const casB5 = [
    ...SQLI_TEMPS.map((charge) => cas('prénom : ' + charge.slice(0, 30), async () => api('customer_signup', { ...baseInscription(), first_name: charge, email: `sqlb5-${suffixe()}@example.test` }), { charge })),
    ...SQLI_TEMPS.map((charge) => cas('recherche : ' + charge.slice(0, 30), async () => api('owner_customers', { code: site.codeSuperieur, q: charge }, { cookie: patron().cookieHeader() }), { charge }))
  ];
  await lot(`B5 · charges temporelles (pg_sleep) : réponse en moins de ${DELAI_SUSPECT_MS} ms (jamais exécutées)`, casB5, (r) => (r.ms < DELAI_SUSPECT_MS ? null : `réponse en ${Math.round(r.ms)} ms`));

  // B6 : bilan — tables et schéma intacts (à part les comptes/commandes créés ci-dessus, tous attendus).
  const apresB = compterTables();
  const creeB1B2 = casB1.length + casB2.length; // chaque cas B1/B2 réussi crée un compte ; B4/B5(recherche) n'en créent aucun ; B5(prénom) si.
  etatIntact('B · après toutes les injections SQL', avantB, apresB, {
    customers: creeB1B2 + SQLI_TEMPS.length,
    orders: casB3.length,
    order_items: casB3.length
  });
  controle('B · schéma de la base inchangé (aucune table ni colonne modifiée ou supprimée)', schemaBase() === schemaInitial, schemaBase() === schemaInitial ? '' : 'schéma différent après les injections');
}
