// Batterie 10 : altérations d'UN SEUL champ d'une commande valide. Chaque altération produit une commande que le serveur
// DOIT refuser, avec le statut et le code attendus (le résultat est connu d'avance, jamais « refusé ou accepté »).
// b = { corps, ville, mode, calcul } (commande valide + calcul de l'oracle) ; appliquer() modifie b.corps sur place
// (ou renvoie un autre corps) et renvoie { att, desc } ; preparer() ajoute si besoin la ligne dont l'altération a besoin.
import * as O from './10-oracle.mjs';

const val = (...champs) => ({ statut: 422, code: 'validation', champs });
const misLigne = (index, exp, sent) => ({ statut: 422, code: 'price_mismatch_line', extra: { index, expected_unit_cents: exp, sent_unit_cents: sent } });
const inconnu = (name) => ({ statut: 422, code: 'unknown_item', extra: { name } });
const mismatch = (b) => ({
  statut: 409, code: 'price_mismatch',
  extra: { server_total_cents: b.calcul.t.total, server_promo_cents: b.calcul.t.promo, server_products_cents: b.calcul.t.produits, server_delivery_fee_cents: b.calcul.t.frais }
});

const nbArticles = (corps) => corps.items.reduce((s, l) => s + l.qty, 0);
const indices = (b, test) => b.corps.items.map((_, i) => i).filter((i) => test(b.corps.items[i], b.calcul.lignes[i], i));

function assurerMinimum(r, idx, b) {
  for (let g = 0; g < 20 && b.mode === 'delivery' && !b.calcul.t.minimumAtteint; g++) {
    b.corps.items.push(O.genererLigne(r, idx, { qty: 1 }).ligne);
    b.calcul = O.recalibrer(idx, b.corps, b.ville);
  }
}

/** Ajoute une ligne fabriquée si aucune ligne ne satisfait déjà `test`. */
function assurer(r, idx, b, test, optsLigne) {
  if (indices(b, test).length > 0) return;
  b.corps.items.push(O.genererLigne(r, idx, { qty: 1, ...optsLigne }).ligne);
  b.calcul = O.recalibrer(idx, b.corps, b.ville);
  assurerMinimum(r, idx, b);
}

const estPizza = (l, c) => c.pizza;
const estSupp = (l, c) => c.pizza && l.extras.length > 0;
const estSolo = (l, c) => c.pizza && l.variant === 'Solo' && l.half === null && c.produit.half_allowed;
const estDuoDemi = (l, c) => c.pizza && l.variant !== 'Solo' && l.half === null && c.produit.half_allowed;
const sansDemi = (l, c) => c.pizza && !c.produit.half_allowed;
const estEchange = (l, c) => c.pizza && l.removed.length === 1 && l.extras.length === 1 && c.extras[0] === 0;

const prixSupp = (idx, g, variant) => idx.groupes[g].prix[variant];
const valeur = (r, tab) => r.choix(tab);

export const ALTERATIONS = [
  {
    id: 'prix_plus',
    appliquer(r, idx, b) {
      const i = r.entier(0, b.corps.items.length - 1);
      const u = b.calcul.lignes[i].unit;
      const d = r.entier(1, 400);
      b.corps.items[i].unit_price_cents = u + d;
      return { att: misLigne(i, u, u + d), desc: `ligne ${i} : ${u} -> ${u + d}` };
    }
  },
  {
    id: 'prix_moins',
    appliquer(r, idx, b) {
      const i = r.entier(0, b.corps.items.length - 1);
      const u = b.calcul.lignes[i].unit;
      const d = r.entier(1, Math.min(400, u - 1));
      b.corps.items[i].unit_price_cents = u - d;
      return { att: misLigne(i, u, u - d), desc: `ligne ${i} : ${u} -> ${u - d}` };
    }
  },
  {
    id: 'prix_zero_negatif',
    appliquer(r, idx, b) {
      const i = r.entier(0, b.corps.items.length - 1);
      const u = b.calcul.lignes[i].unit;
      const v = valeur(r, [0, -1, -u, -1000000]);
      b.corps.items[i].unit_price_cents = v;
      return { att: val(`items[${i}].unit_price_cents`), desc: `ligne ${i} : prix ${v}` };
    }
  },
  {
    id: 'prix_flottant',
    appliquer(r, idx, b) {
      const i = r.entier(0, b.corps.items.length - 1);
      const u = b.calcul.lignes[i].unit;
      const v = valeur(r, [u + 0.5, u - 0.5, u + 0.25, u + 0.01]);
      b.corps.items[i].unit_price_cents = v;
      return { att: val(`items[${i}].unit_price_cents`), desc: `ligne ${i} : prix ${v}` };
    }
  },
  {
    id: 'prix_chaine',
    appliquer(r, idx, b) {
      const i = r.entier(0, b.corps.items.length - 1);
      const u = b.calcul.lignes[i].unit;
      const v = valeur(r, [String(u), `${u}.0`, '1 100', '11,00', `${u} `, '', 'abc', '0x44c', '1e3']);
      b.corps.items[i].unit_price_cents = v;
      return { att: val(`items[${i}].unit_price_cents`), desc: `ligne ${i} : prix ${JSON.stringify(v)}` };
    }
  },
  {
    id: 'prix_enorme',
    appliquer(r, idx, b) {
      const i = r.entier(0, b.corps.items.length - 1);
      const v = valeur(r, [50001, 1e6, 99999999, 2 ** 31, Number.MAX_SAFE_INTEGER, 1e21, Number.MAX_VALUE]);
      b.corps.items[i].unit_price_cents = v;
      return { att: val(`items[${i}].unit_price_cents`), desc: `ligne ${i} : prix ${v}` };
    }
  },
  {
    id: 'prix_absent',
    appliquer(r, idx, b) {
      const i = r.entier(0, b.corps.items.length - 1);
      const k = r.entier(0, 6);
      if (k === 0) delete b.corps.items[i].unit_price_cents;
      else b.corps.items[i].unit_price_cents = [null, null, true, false, [], {}, [b.calcul.lignes[i].unit]][k];
      return { att: val(`items[${i}].unit_price_cents`), desc: `ligne ${i} : prix de type ${k}` };
    }
  },
  {
    id: 'supplement_prix',
    preparer(r, idx, b) { assurer(r, idx, b, estSupp, { pizza: true, extras: r.entier(1, 3) }); },
    appliquer(r, idx, b) {
      const i = r.choix(indices(b, estSupp));
      const l = b.corps.items[i];
      const k = r.entier(0, l.extras.length - 1);
      const vieux = l.extras[k].price_cents;
      const nv = r.choix([vieux + 1, vieux + 50, vieux + 100, vieux + 1000, vieux - 1, vieux - 50, 0, 150, 200].filter((v) => v !== vieux && v >= 0 && v <= 10000));
      l.extras[k].price_cents = nv;
      const u = b.calcul.lignes[i].unit;
      return { att: misLigne(i, u, u), desc: `ligne ${i} supplément ${k} : ${vieux} -> ${nv}` };
    }
  },
  {
    id: 'supplement_quantite',
    preparer(r, idx, b) { assurer(r, idx, b, estSupp, { pizza: true, extras: r.entier(1, 3) }); },
    appliquer(r, idx, b) {
      const i = r.choix(indices(b, estSupp));
      const l = b.corps.items[i];
      const k = r.entier(0, l.extras.length - 1);
      const v = valeur(r, [0, 2, 3, 10, -1, 1.5, '1', true, 100, 1e9, [1], {}]);
      l.extras[k].qty = v;
      return { att: val(`items[${i}].extras[${k}].qty`), desc: `ligne ${i} supplément ${k} : quantité ${JSON.stringify(v)}` };
    }
  },
  {
    id: 'supplement_doublon',
    preparer(r, idx, b) { assurer(r, idx, b, estSupp, { pizza: true, extras: r.entier(1, 3) }); },
    appliquer(r, idx, b) {
      const i = r.choix(indices(b, estSupp));
      const l = b.corps.items[i];
      const k = r.entier(0, l.extras.length - 1);
      const f = valeur(r, [(n) => n, (n) => n.toUpperCase(), (n) => n + '*', (n) => n + ' ', (n) => O.capPremiere(n)]);
      const copie = { name: f(l.extras[k].name), price_cents: l.extras[k].price_cents, qty: 1 };
      l.extras.push(copie);
      return { att: val(`items[${i}].extras[${l.extras.length - 1}].name`), desc: `ligne ${i} : doublon « ${copie.name} »` };
    }
  },
  {
    id: 'supplement_inconnu',
    appliquer(r, idx, b) {
      const i = r.entier(0, b.corps.items.length - 1);
      const nom = valeur(r, O.SUPPLEMENTS_INCONNUS);
      b.corps.items[i].extras.push({ name: nom, price_cents: valeur(r, [0, 100, 150, 200]), qty: 1 });
      return { att: inconnu(nom), desc: `ligne ${i} : supplément « ${nom} »` };
    }
  },
  {
    id: 'supplement_type',
    preparer(r, idx, b) { assurer(r, idx, b, estPizza, { pizza: true }); },
    appliquer(r, idx, b) {
      const i = r.choix(indices(b, estPizza));
      const v = valeur(r, ['olives', { a: 1 }, [1], [null], ['olives'], [{ name: 5, price_cents: 0, qty: 1 }], [{ name: 'olives' }], [{ name: 'olives', price_cents: '150', qty: 1 }], [{ name: 'olives', price_cents: null, qty: 1 }]]);
      b.corps.items[i].extras = v;
      return { att: val(`items[${i}].extras`), desc: `ligne ${i} : suppléments ${JSON.stringify(v)}` };
    }
  },
  {
    id: 'taille_inventee',
    preparer(r, idx, b) { assurer(r, idx, b, estPizza, { pizza: true }); },
    appliquer(r, idx, b) {
      const i = r.choix(indices(b, estPizza));
      const v = valeur(r, ['XL', 'Mega', 'solo', 'SOLO', 'Familiale', 'xxl', 'Duo ', ' Solo', 'Solo\n', 'XXXL', 'S', 'M', 'L', '3 parts', 'Quatro​', 5, true, ['Solo'], {}]);
      b.corps.items[i].variant = v;
      return { att: val(`items[${i}].variant`), desc: `ligne ${i} : taille ${JSON.stringify(v)}` };
    }
  },
  {
    id: 'taille_echangee',
    preparer(r, idx, b) { assurer(r, idx, b, (l, c) => c.pizza && l.half === null, { pizza: true, demi: false }); },
    appliquer(r, idx, b) {
      const i = r.choix(indices(b, (l, c) => c.pizza && l.half === null));
      const l = b.corps.items[i];
      const nv = r.choix(O.TAILLES.filter((t) => t !== l.variant));
      const attendu = O.prixLigne(idx, { ...l, variant: nv });
      const u = b.calcul.lignes[i].unit;
      l.variant = nv;
      return { att: misLigne(i, attendu.unit, u), desc: `ligne ${i} : taille ${b.calcul.lignes[i].produit.name} ${nv} au prix de l'autre taille (${u})` };
    }
  },
  {
    id: 'nom_trafique',
    appliquer(r, idx, b) {
      const i = r.entier(0, b.corps.items.length - 1);
      const nom = b.corps.items[i].name + ' — Truffe';
      b.corps.items[i].name = nom;
      return { att: inconnu(nom), desc: `ligne ${i} : « ${nom} »` };
    }
  },
  {
    id: 'article_inconnu',
    appliquer(r, idx, b) {
      const i = r.entier(0, b.corps.items.length - 1);
      const nom = valeur(r, O.ARTICLES_INCONNUS);
      b.corps.items[i].name = nom;
      return { att: inconnu(nom), desc: `ligne ${i} : « ${nom} »` };
    }
  },
  {
    id: 'type_echange',
    appliquer(r, idx, b) {
      const i = r.entier(0, b.corps.items.length - 1);
      const l = b.corps.items[i];
      l.variant = b.calcul.lignes[i].pizza ? '' : r.choix(O.TAILLES);
      return { att: inconnu(l.name), desc: `ligne ${i} : taille ${JSON.stringify(l.variant)} sur « ${l.name} »` };
    }
  },
  {
    id: 'moitie_solo',
    preparer(r, idx, b) { assurer(r, idx, b, estSolo, { pizza: true, taille: 'Solo', produit: r.choix(idx.demis), demi: false }); },
    appliquer(r, idx, b) {
      const i = r.choix(indices(b, estSolo));
      const p = b.calcul.lignes[i].produit;
      b.corps.items[i].half = { flavor1: p.name, flavor2: r.choix(idx.demis.filter((x) => x.name !== p.name)).name };
      return { att: val(`items[${i}].half`), desc: `ligne ${i} : moitié-moitié en Solo` };
    }
  },
  {
    id: 'moitie_calzone',
    preparer(r, idx, b) {
      assurer(r, idx, b, sansDemi, { pizza: true, produit: r.choix(idx.pizzas.filter((x) => !x.half_allowed)), taille: r.choix(O.TAILLES), demi: false });
    },
    appliquer(r, idx, b) {
      const i = r.choix(indices(b, sansDemi));
      const p = b.calcul.lignes[i].produit;
      b.corps.items[i].half = { flavor1: p.name, flavor2: r.choix(idx.demis).name };
      return { att: val(`items[${i}].half`), desc: `ligne ${i} : moitié-moitié sur « ${p.name} »` };
    }
  },
  {
    id: 'moitie_inconnue',
    preparer(r, idx, b) { assurer(r, idx, b, estDuoDemi, { pizza: true, taille: r.choix(['Duo', 'Quatro', 'XXL']), produit: r.choix(idx.demis), demi: false }); },
    appliquer(r, idx, b) {
      const i = r.choix(indices(b, estDuoDemi));
      const p = b.calcul.lignes[i].produit;
      const f2 = valeur(r, ['Hawaïenne', 'Margherita', 'Pizza Licorne', 'Boisson Oasis Pomme Poire canette', 'Pâtes Bolognaise', 'Calzone Nutella']);
      b.corps.items[i].half = { flavor1: p.name, flavor2: f2 };
      return { att: inconnu(f2), desc: `ligne ${i} : moitié « ${f2} »` };
    }
  },
  {
    id: 'moitie_saveur1',
    preparer(r, idx, b) { assurer(r, idx, b, estDuoDemi, { pizza: true, taille: r.choix(['Duo', 'Quatro', 'XXL']), produit: r.choix(idx.demis), demi: false }); },
    appliquer(r, idx, b) {
      const i = r.choix(indices(b, estDuoDemi));
      const p = b.calcul.lignes[i].produit;
      const [a, c] = r.melanger(idx.demis.filter((x) => x.name !== p.name));
      b.corps.items[i].half = { flavor1: a.name, flavor2: c.name };
      return { att: inconnu(b.corps.items[i].name), desc: `ligne ${i} : première moitié « ${a.name} » au lieu de « ${p.name} »` };
    }
  },
  {
    id: 'moitie_saveur2_interdite',
    preparer(r, idx, b) { assurer(r, idx, b, estDuoDemi, { pizza: true, taille: r.choix(['Duo', 'Quatro', 'XXL']), produit: r.choix(idx.demis), demi: false }); },
    appliquer(r, idx, b) {
      const i = r.choix(indices(b, estDuoDemi));
      const p = b.calcul.lignes[i].produit;
      const f2 = valeur(r, ['Calzone (soufflée)', 'Marguerita (base)']);
      b.corps.items[i].half = { flavor1: p.name, flavor2: f2 };
      return { att: inconnu(f2), desc: `ligne ${i} : deuxième moitié « ${f2} »` };
    }
  },
  {
    id: 'moitie_forme',
    preparer(r, idx, b) { assurer(r, idx, b, estPizza, { pizza: true }); },
    appliquer(r, idx, b) {
      const i = r.choix(indices(b, estPizza));
      const v = valeur(r, [{}, [], 'Kebab', { flavor1: 'x' }, { flavor1: 1, flavor2: 2 }, { flavor1: 'a'.repeat(121), flavor2: 'b' }, false, 0, 'x', '']);
      b.corps.items[i].half = v;
      return { att: val(`items[${i}].half`), desc: `ligne ${i} : half ${JSON.stringify(v)}` };
    }
  },
  {
    id: 'retrait_absent',
    appliquer(r, idx, b) {
      const i = r.entier(0, b.corps.items.length - 1);
      const c = b.calcul.lignes[i];
      const absent = r.choix(idx.ingredients.filter((x) => !c.autorises.has(O.norm(x))));
      b.corps.items[i].removed.push(absent);
      return { att: val(`items[${i}].removed`), desc: `ligne ${i} : retrait de « ${absent} » absent de « ${c.nom} »` };
    }
  },
  {
    id: 'retrait_trop_long',
    appliquer(r, idx, b) {
      const i = r.entier(0, b.corps.items.length - 1);
      const ing = String(b.calcul.lignes[i].produit.ingredients[0]);
      b.corps.items[i].removed = Array(21).fill(ing);
      return { att: val(`items[${i}].removed`), desc: `ligne ${i} : 21 retraits de « ${ing} »` };
    }
  },
  {
    id: 'retrait_type',
    appliquer(r, idx, b) {
      const i = r.entier(0, b.corps.items.length - 1);
      const v = valeur(r, ['jambon', { a: 1 }, [1], [null], ['x'.repeat(61)], [[]], 'x']);
      b.corps.items[i].removed = v;
      return { att: val(`items[${i}].removed`), desc: `ligne ${i} : retraits ${JSON.stringify(v)}` };
    }
  },
  {
    id: 'credit_gratuit_sans_retrait',
    preparer(r, idx, b) { assurer(r, idx, b, estPizza, { pizza: true }); },
    appliquer(r, idx, b) {
      for (const i of r.melanger(indices(b, estPizza))) {
        const l = b.corps.items[i];
        const c = b.calcul.lignes[i];
        const pris = new Set(l.extras.map((e) => O.cleGroupe(e.name)));
        for (const g of r.melanger([0, 1])) {
          if (c.creditsRestants[g] !== 0) continue;
          const cands = idx.supplements.filter((s) => s.groupe === g && !pris.has(O.cleGroupe(s.nom)));
          if (!cands.length) continue;
          const s = r.choix(cands);
          l.extras.push({ name: s.nom, price_cents: 0, qty: 1 });
          return { att: misLigne(i, c.unit + prixSupp(idx, g, l.variant), c.unit), desc: `ligne ${i} : « ${s.nom} » gratuit sans retrait` };
        }
      }
      return null;
    }
  },
  {
    id: 'credit_second_gratuit',
    preparer(r, idx, b) { assurer(r, idx, b, estEchange, { pizza: true, echange: true }); },
    appliquer(r, idx, b) {
      const i = r.choix(indices(b, estEchange));
      const l = b.corps.items[i];
      const c = b.calcul.lignes[i];
      const g = idx.groupeDe.get(O.cleGroupe(l.extras[0].name));
      const s = r.choix(idx.supplements.filter((x) => x.groupe === g && O.cleGroupe(x.nom) !== O.cleGroupe(l.extras[0].name)));
      l.extras.push({ name: s.nom, price_cents: 0, qty: 1 });
      return { att: misLigne(i, c.unit + prixSupp(idx, g, l.variant), c.unit), desc: `ligne ${i} : 1 retrait, 2 suppléments gratuits (« ${s.nom} »)` };
    }
  },
  {
    id: 'credit_autre_groupe',
    preparer(r, idx, b) { assurer(r, idx, b, estEchange, { pizza: true, echange: true }); },
    appliquer(r, idx, b) {
      const i = r.choix(indices(b, estEchange));
      const l = b.corps.items[i];
      const c = b.calcul.lignes[i];
      const g = idx.groupeDe.get(O.cleGroupe(l.extras[0].name));
      const autre = 1 - g;
      const s = r.choix(idx.supplements.filter((x) => x.groupe === autre));
      l.extras[0].name = s.nom;
      return { att: misLigne(i, c.unit + prixSupp(idx, autre, l.variant), c.unit), desc: `ligne ${i} : retrait d'un groupe, gratuit dans l'autre (« ${s.nom} »)` };
    }
  },
  {
    id: 'quantite_invalide',
    appliquer(r, idx, b) {
      const i = r.entier(0, b.corps.items.length - 1);
      const v = valeur(r, [0, 21, -1, 1.5, '2', null, 100, 1e9, true, [], 2 ** 31]);
      b.corps.items[i].qty = v;
      return { att: val(`items[${i}].qty`), desc: `ligne ${i} : quantité ${JSON.stringify(v)}` };
    }
  },
  {
    id: 'trop_darticles',
    appliquer(r, idx, b) {
      let reste = 61 - nbArticles(b.corps);
      while (reste > 0) {
        const copie = structuredClone(b.corps.items[0]);
        copie.qty = Math.min(20, reste);
        b.corps.items.push(copie);
        reste -= copie.qty;
      }
      return { att: val('items'), desc: `${nbArticles(b.corps)} articles sur ${b.corps.items.length} lignes` };
    }
  },
  {
    id: 'trop_de_lignes',
    appliquer(r, idx, b) {
      while (b.corps.items.length < 41) b.corps.items.push(structuredClone(b.corps.items[0]));
      return { att: val('items'), desc: `${b.corps.items.length} lignes` };
    }
  },
  {
    id: 'total_decale',
    appliquer(r, idx, b) {
      const T = b.calcul.t.total;
      const d = r.entier(1, 3000);
      b.corps.total_cents = T - d >= 0 && r.vrai() ? T - d : T + d;
      return { att: mismatch(b), desc: `total ${T} -> ${b.corps.total_cents}` };
    }
  },
  {
    id: 'frais_decales',
    appliquer(r, idx, b) {
      const F = b.calcul.t.frais;
      const v = r.choix([F + 1, F + 50, F + 550, F + 800, F > 0 ? F - 1 : 7, F > 0 ? 0 : 549, 550, 800, 1].filter((x) => x !== F));
      b.corps.delivery_fee_cents = v;
      return { att: mismatch(b), desc: `frais ${F} -> ${v}` };
    }
  },
  {
    id: 'total_invalide',
    appliquer(r, idx, b) {
      const T = b.calcul.t.total;
      const v = valeur(r, [-1, -T, T + 0.5, String(T), null, 10000001, 1e12, true, 'abc', [T], {}]);
      b.corps.total_cents = v;
      return { att: val('total_cents'), desc: `total ${JSON.stringify(v)}` };
    }
  },
  {
    id: 'frais_invalides',
    appliquer(r, idx, b) {
      const F = b.calcul.t.frais;
      const v = valeur(r, [-1, -F - 1, F + 0.5, String(F), null, 10000001, true, 'abc', [F]]);
      b.corps.delivery_fee_cents = v;
      return { att: val('delivery_fee_cents'), desc: `frais ${JSON.stringify(v)}` };
    }
  },
  {
    id: 'mode_invalide',
    appliquer(r, idx, b) {
      const v = valeur(r, ['eatin', 'PICKUP', 'Delivery', 'livraison', '', null, 0, true, ['pickup'], {}, 'pickup ', ' pickup', 'pick up']);
      b.corps.mode = v;
      return { att: val('mode'), desc: `mode ${JSON.stringify(v)}` };
    }
  },
  {
    id: 'cle_invalide',
    appliquer(r, idx, b) {
      const v = valeur(r, ['', 'court', 'x'.repeat(65), 'avec des espaces', 'clé-accentuée-123', null, 12345678, 'abcdefgh\n', 'abcdefgh!', 'abcdefgh_ijkl', undefined]);
      if (v === undefined) delete b.corps.idempotency_key;
      else b.corps.idempotency_key = v;
      return { att: val('idempotency_key'), desc: `clé ${JSON.stringify(v)}` };
    }
  },
  {
    id: 'moyen_paiement_invalide',
    mode: 'delivery',
    appliquer(r, idx, b) {
      const v = valeur(r, [[], ['bitcoin'], ['card', 'paypal'], 'card', [1], [null], { a: 'card' }, ['CARD'], ['card', 'Cash'], [['card']], ['card '], {}, undefined]);
      if (v === undefined) delete b.corps.payment_methods;
      else b.corps.payment_methods = v;
      return { att: val('payment_methods'), desc: `moyens ${JSON.stringify(v)}` };
    }
  },
  {
    id: 'billet_invalide',
    mode: 'delivery',
    cash: true,
    appliquer(r, idx, b) {
      const v = valeur(r, [5, 15, 200, -10, 10.5, '20', true, null, 1e9, 101, 9, '', [20], undefined]);
      if (v === undefined) delete b.corps.cash_change_for;
      else b.corps.cash_change_for = v;
      return { att: val('cash_change_for'), desc: `billet ${JSON.stringify(v)}` };
    }
  },
  {
    id: 'sous_le_minimum',
    mode: 'delivery',
    appliquer(r, idx, b) {
      const zone = O.ZONES[b.ville];
      for (let essai = 0; essai < 200; essai++) {
        const items = [];
        const n = r.entier(1, 5);
        for (let k = 0; k < n; k++) {
          const pizza = zone.min > 1100 && r.vrai(0.5);
          items.push(O.genererLigne(r, idx, pizza ? { pizza: true, qty: 1, extras: 0, retraits: 0, demi: false } : { pizza: false, qty: 1 }).ligne);
        }
        const t = O.totaux(O.calculerCommande(idx, { mode: 'delivery', items }, b.ville).lignes, 'delivery', b.ville);
        if (t.apres >= zone.min) continue;
        const corps = {
          idempotency_key: b.corps.idempotency_key, mode: 'delivery', payment_methods: ['card'], cash_change_for: null, hot_sauce: true, items,
          delivery_fee_cents: t.frais, total_cents: t.total
        };
        return {
          corps,
          att: { statut: 422, code: 'minimum_not_reached', extra: { minimum_cents: zone.min, products_after_promo_cents: t.apres } },
          desc: `${b.ville} : ${t.apres} < minimum ${zone.min}`
        };
      }
      return null;
    }
  },
  {
    id: 'promo_gonflee',
    preparer(r, idx, b) {
      for (let g = 0; g < 6 && b.calcul.t.pizzas < 2; g++) {
        b.corps.items.push(O.genererLigne(r, idx, { pizza: true, qty: 1 }).ligne);
        b.calcul = O.recalibrer(idx, b.corps, b.ville);
      }
    },
    appliquer(r, idx, b) {
      const T = b.calcul.t.total;
      const c = Math.min(...b.calcul.lignes.filter((l) => l.pizza).map((l) => l.unit));
      b.corps.total_cents = Math.max(0, T - c);
      return { att: mismatch(b), desc: `promo gonflée : total ${T} -> ${b.corps.total_cents}` };
    }
  },
  {
    id: 'promo_du_mauvais_mode',
    preparer(r, idx, b) {
      for (let g = 0; g < 6 && b.calcul.t.pizzas < 2; g++) {
        b.corps.items.push(O.genererLigne(r, idx, { pizza: true, qty: 1 }).ligne);
        b.calcul = O.recalibrer(idx, b.corps, b.ville);
      }
    },
    appliquer(r, idx, b) {
      const autre = b.mode === 'delivery' ? 'pickup' : 'delivery';
      const t2 = O.totaux(b.calcul.lignes, autre, b.ville);
      b.corps.total_cents = t2.total;
      return { att: mismatch(b), desc: `total du mode ${autre} (${t2.total}) sur une commande ${b.mode} (${b.calcul.t.total})` };
    }
  },
  {
    id: 'nom_vide_ou_long',
    appliquer(r, idx, b) {
      const i = r.entier(0, b.corps.items.length - 1);
      const v = valeur(r, ['', ' ', '   ', 'x'.repeat(121), '\t', 5, null, [], {}]);
      b.corps.items[i].name = v;
      return { att: val(`items[${i}].name`), desc: `ligne ${i} : nom ${JSON.stringify(v)}` };
    }
  },
  {
    id: 'panier_invalide',
    appliquer(r, idx, b) {
      const v = valeur(r, [[], {}, null, 'x', 5, true, { 0: b.corps.items[0] }]);
      b.corps.items = v;
      const vide = Array.isArray(v) ? v.length === 0 : v !== null && typeof v === 'object' && Object.keys(v).length === 0;
      return { att: vide ? { statut: 422, code: 'empty_cart' } : val('items'), desc: `items ${JSON.stringify(v).slice(0, 30)}` };
    }
  },
  {
    id: 'ligne_invalide',
    appliquer(r, idx, b) {
      const i = r.entier(0, b.corps.items.length - 1);
      const v = valeur(r, [null, 5, 'str', true, [1]]);
      b.corps.items[i] = v;
      return { att: val(`items[${i}]`), desc: `ligne ${i} : ${JSON.stringify(v)}` };
    }
  },
  {
    id: 'remarque_invalide',
    appliquer(r, idx, b) {
      const i = r.entier(0, b.corps.items.length - 1);
      const v = valeur(r, ['a'.repeat(301), 'x\u0000y', 5, true, ['a'], {}]);
      b.corps.items[i].note = v;
      return { att: val(`items[${i}].note`), desc: `ligne ${i} : remarque ${JSON.stringify(v).slice(0, 30)}` };
    }
  }
];
