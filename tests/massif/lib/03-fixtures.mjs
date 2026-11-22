// Jeu de commandes de la batterie 03 : tous les types de commandes que la tablette du commerçant doit afficher.
// Chaque fixture contient : le profil du client (nom, téléphone, adresse), le corps de order_create à envoyer, et l'ATTENDU
// (ce que la tablette doit afficher), calculé ici par les règles métier (voir 03-outils.mjs), jamais par le code du site.
import { catalogue } from '../../../serveur/catalogue.js';
import { rng } from './commandes.mjs';
import { prixAttendu, calculerTotaux, libellePaiement, eurTest, capitaliser } from './03-outils.mjs';

const PRENOMS = ['Camille', 'Léa', 'Hugo', 'Inès', 'Lucas', 'Manon', 'Nathan', 'Chloé', 'Louis', 'Jade', 'Gabriel', 'Louise', 'Arthur', 'Alice', 'Jules',
  'Emma', 'Raphaël', 'Anna', 'Adam', 'Zoé', 'Tom', 'Lina', 'Noé', 'Eva', 'Léo', 'Rose', 'Paul', 'Sarah', 'Éloïse', 'Yanis'];
const NOMS = ['Martin', 'Bernard', 'Dubois', 'Thomas', 'Robert', 'Richard', 'Petit', 'Durand', 'Leroy', 'Moreau', 'Simon', 'Laurent', 'Lefebvre', 'Michel',
  'Garcia', 'David', 'Bertrand', 'Roux', 'Vincent', 'Fournier', 'Morel', 'Girard', 'André', 'Mercier', 'Dupont', 'Lambert', 'Bonnet', 'François', 'Martinez', 'Legrand'];
const RUES = ['rue Jean Jaurès', 'avenue de la République', "place de l'Hôtel de Ville", 'boulevard Basly', 'impasse des Lilas', "rue de l'Église", 'cité Darcy',
  'rue Émile Zola', 'chemin des Tilleuls', 'rue Pasteur'];
const p2 = (n) => String(10 + (((n % 89) + 89) % 89));

/** Téléphones de formats variés (tous valides : 8 à 20 caractères, au moins 8 chiffres). */
function telephone(k) {
  const [a, b, c, d] = [1, 2, 3, 4].map((i) => p2(k * 13 + i * 17));
  const premier = 6 + (k % 2);
  return [`0${premier} ${a} ${b} ${c} ${d}`, `0${premier}${a}${b}${c}${d}`, `0${premier}.${a}.${b}.${c}.${d}`, `+33 ${premier} ${a} ${b} ${c} ${d}`, `(03) ${a} ${b} ${c} ${d}`][k % 5];
}

const SOUS_ENSEMBLES_SANS_ESPECES = [['card'], ['ticket'], ['ticket_card'], ['card', 'ticket'], ['card', 'ticket_card'], ['ticket', 'ticket_card'], ['card', 'ticket', 'ticket_card']];
const ESPECES_AVEC_AUTRES = [[['card', 'cash'], 10], [['cash', 'ticket'], 20], [['cash', 'ticket_card'], 50], [['card', 'cash', 'ticket'], 100],
  [['card', 'cash', 'ticket_card'], 0], [['cash', 'ticket', 'ticket_card'], 20], [['card', 'cash', 'ticket', 'ticket_card'], 50]];

/** Remarque de 300 caractères exactement (points de code) avec accents, apostrophes, guillemets, emoji, < et &. */
function remarque300() {
  const motif = `Sans oignons, s'il vous plaît ! "Bien cuite" – couper en 8 parts <svp> & merci 🙏 Éloïse à l'étage n°3, digicode : 1234A… 🍕 `;
  let s = '';
  while (Array.from(s).length < 300) s += motif;
  const c = Array.from(s).slice(0, 300);
  if (c[299] === ' ') c[299] = '.';
  return c.join('');
}

export function construireFixtures() {
  const cat = catalogue();
  const zones = Object.fromEntries(cat.zones.map((z) => [z.city, z]));
  const VILLES = cat.zones.map((z) => z.city);
  const produit = (nom) => {
    const p = cat.products.find((x) => x.line_name === nom);
    if (!p) throw new Error('Produit inconnu du catalogue : ' + nom);
    return p;
  };

  /** Ligne de commande : corps envoyé, ce que l'écran doit montrer, données de calcul. */
  const ligne = (nom, { taille = '', qty = 1, retraits = [], supplements = [], moitie = null, choix = null, note = '' } = {}) => {
    const p = produit(nom);
    const pizza = p.kind === 'pizza';
    if (pizza && !taille) throw new Error('Taille manquante : ' + nom);
    const { unite, supp } = prixAttendu(cat, p, taille, retraits, supplements);
    const nomEnvoye = p.line_name + (choix ? ' — ' + choix : '');
    const nomAffiche = p.line_name + (choix ? ' — ' + capitaliser(choix) : '');
    const mods = [];
    if (moitie) mods.push({ cls: 'mod-half', texte: `Moitié ${p.name} / moitié ${moitie}` });
    for (const r of retraits) mods.push({ cls: 'mod-minus', texte: `− ${r}` });
    supplements.forEach((n, i) => mods.push({ cls: 'mod-plus', texte: `+ ${n}${supp[i] ? ` (${eurTest(supp[i])})` : ''}` }));
    if (note.trim() !== '') mods.push({ cls: 'item-note', texte: `Remarque : ${note.trim()}` });
    return {
      envoi: {
        name: nomEnvoye, variant: taille, qty, unit_price_cents: unite, removed: retraits,
        extras: supplements.map((n, i) => ({ name: n, price_cents: supp[i], qty: 1 })),
        half: moitie ? { flavor1: p.name, flavor2: moitie } : null, note
      },
      attendu: {
        qty: `${qty}×`, nomAffiche, taille, titre: taille ? `${nomAffiche} · ${taille}` : nomAffiche, mods, total: unite * qty,
        unite, retraits, supplements: supplements.map((n, i) => ({ name: n, price_cents: supp[i], qty: 1 })), moitie: moitie ? { flavor1: p.name, flavor2: moitie } : null, note: note.trim(), nbQty: qty
      },
      calc: { unite, qty, taille: pizza ? taille : '' }
    };
  };

  const liste = [];
  const noms = new Set();
  const fixture = (id, vague, titre, { mode = 'pickup', ville = 'Hénin-Beaumont', paiements = [], billet = null, lignes, profil = {}, memeClient = null }) => {
    const k = liste.length;
    const ref = memeClient ? liste.find((x) => x.id === memeClient) : null;
    if (memeClient && !ref) throw new Error('Client de référence inconnu : ' + memeClient);
    let prenom = PRENOMS[k % PRENOMS.length];
    let nom = NOMS[(k * 7 + 3 + Math.floor(k / 30) * 11) % NOMS.length];
    const p = ref ? { ...ref.profil, ...profil } : {
      prenom, nom, tel: telephone(k), rue: `${1 + ((k * 7) % 98)} ${RUES[k % RUES.length]}`, ville, ...profil
    };
    prenom = p.prenom; nom = p.nom;
    const nomComplet = `${prenom} ${nom}`;
    if (!ref && noms.has(nomComplet)) throw new Error('Nom de client en double : ' + nomComplet);
    if (nomComplet.includes(', ') || nomComplet.includes(':')) throw new Error('Nom interdit dans ce jeu (virgule ou deux-points) : ' + nomComplet);
    noms.add(nomComplet);
    const zone = mode === 'delivery' ? zones[p.ville] : null;
    if (mode === 'delivery' && !zone) throw new Error('Ville hors zone : ' + p.ville);
    const tot = calculerTotaux(lignes.map((l) => l.calc), mode, zone);
    if (mode === 'delivery' && tot.brut - tot.promo < zone.minimum_cents) throw new Error(`Fixture ${id} sous le minimum de ${p.ville} : ${tot.brut - tot.promo}`);
    if (mode === 'delivery' && paiements.includes('cash') && billet === null) throw new Error(`Fixture ${id} : billet manquant`);
    const f = {
      id, vague, titre, mode, memeClient, profil: p, paiements: mode === 'delivery' ? paiements : [], billet: mode === 'delivery' && paiements.includes('cash') ? billet : null, lignes, tot,
      body: {
        idempotency_key: `ui03-${id.toLowerCase()}-k1`,
        mode,
        payment_methods: mode === 'delivery' ? paiements : [],
        cash_change_for: mode === 'delivery' && paiements.includes('cash') ? billet : null,
        hot_sauce: mode === 'delivery' ? true : null,
        items: lignes.map((l) => l.envoi),
        delivery_fee_cents: tot.frais,
        total_cents: tot.total
      },
      attendu: {
        nom: nomComplet,
        tel: p.tel,
        adresse: mode === 'delivery' ? `${p.rue}, ${p.ville}` : null,
        modeTexte: mode === 'delivery' ? 'Livraison' : 'À emporter · retrait au commerce',
        paiement: libellePaiement(mode, paiements, billet),
        lignes: lignes.map((l) => l.attendu),
        brut: tot.brut, promo: tot.promo, frais: tot.frais, total: tot.total
      }
    };
    liste.push(f);
    return f;
  };

  // ------------------------------------------------------------------ V1 : à emporter
  const NOTE300 = remarque300();
  fixture('P01', 'V1', 'Solo simple', { lignes: [ligne('Végétarienne', { taille: 'Solo' })] });
  fixture('P02', 'V1', '2 pizzas : la moins chère offerte', { lignes: [ligne('Régina', { taille: 'Duo' }), ligne('Kebab', { taille: 'Solo' })] });
  fixture('P03', 'V1', '3 pizzas : une seule paire', { lignes: [ligne('Subito', { taille: 'Solo' }), ligne('Chicken', { taille: 'Duo' }), ligne('Carnivora', { taille: 'Quatro' })] });
  fixture('P04', 'V1', '4 pizzas : deux paires', { lignes: [ligne('Neptune', { taille: 'XXL' }), ligne('Orientale', { taille: 'XXL' }), ligne('Pacifico', { taille: 'Duo' }), ligne('Savoyarde', { taille: 'Solo' })] });
  fixture('P05', 'V1', 'supplément payant', { lignes: [ligne('Campione', { taille: 'Quatro', supplements: ['Viande hachée'] })] });
  fixture('P06', 'V1', 'supplément gratuit après un retrait du même groupe', { lignes: [ligne('Kebab', { taille: 'Duo', retraits: ['oignons'], supplements: ['olives'] })] });
  fixture('P07', 'V1', 'moitié-moitié Duo', { lignes: [ligne('Végétarienne', { taille: 'Duo', moitie: 'Régina' })] });
  fixture('P08', 'V1', 'trois retraits', { lignes: [ligne('4 Saisons', { taille: 'Quatro', retraits: ['olives', 'artichauts', 'poivrons'] })] });
  fixture('P09', 'V1', 'remarque de 300 caractères spéciaux', { lignes: [ligne('Fajitas', { taille: 'Duo', note: NOTE300 })] });
  fixture('P10', 'V1', 'six lignes sans promotion (une seule pizza), remarques à espaces superflus ou vide', {
    lignes: [ligne('Normande', { taille: 'Solo' }), ligne('Pâtes Bolognaise', { note: '  Sans fromage  ' }), ligne('Canette Oasis pomme poire', { qty: 2 }), ligne("Dessert Tiramisubito M&M's"), ligne('Salade Niçoise', { note: '   ' }), ligne('Tex-Mex Wings (5 pièces)')]
  });
  fixture('P11', 'V1', 'une ligne de 2 pizzas : promotion sur la ligne', { lignes: [ligne('Maroilles', { taille: 'Duo', qty: 2 })] });
  fixture('P12', 'V1', 'calzone avec garniture au choix', { lignes: [ligne('Calzone (soufflée)', { taille: 'Duo', choix: 'thon' })] });
  fixture('P13', 'V1', 'pizza à composer avec base au choix', { lignes: [ligne('Marguerita (base)', { taille: 'Solo', choix: 'crème fraîche' })] });
  fixture('P14', 'V1', 'boissons seules (aucune pizza)', { lignes: [ligne('Canette Oasis pomme poire', { qty: 3 })] });
  fixture('P15', 'V1', 'XXL avec moitié, retraits, suppléments payants et gratuits, remarque', {
    lignes: [ligne('Carnivora', { taille: 'XXL', moitie: 'Orientale', retraits: ['merguez', 'chorizo'], supplements: ['Champignons', 'poulet', 'miel'], note: 'Bien cuite, couper en 12 svp' })]
  });
  fixture('P16', 'V1', 'plusieurs pizzas avec options, pâtes et boisson', {
    lignes: [
      ligne('Savoyarde', { taille: 'Duo', qty: 2, retraits: ['oignons'], note: 'Sans oignons' }),
      ligne('Chèvre miel', { taille: 'Solo', supplements: ['jambon'] }),
      ligne("L'Extravagante", { taille: 'Quatro', moitie: '3 Jambons' }),
      ligne('Pâtes Carbonara', { qty: 2 }),
      ligne('Maxi Coca')
    ]
  });

  // ------------------------------------------------------------------ V2 : livraison, chaque moyen de paiement
  const panierPizza = (ville, i) => {
    const min = zones[ville].minimum_cents;
    const noms8 = ['Végétarienne', 'Régina', 'Kebab', 'Subito', 'Chicken', 'Orientale', 'Neptune', 'Campione'];
    const n = noms8[i % noms8.length];
    if (min <= 1000) return [ligne(n, { taille: 'Solo' })];
    if (min <= 1500) return [ligne(n, { taille: 'Duo' })];
    if (min <= 2000) return [ligne(n, { taille: 'Quatro' })];
    return [ligne(n, { taille: 'Quatro' }), ligne(noms8[(i + 3) % noms8.length], { taille: 'Solo' })];
  };
  let d = 0;
  const livraison = (id, titre, paiements, billet) => {
    const ville = VILLES[d % VILLES.length];
    fixture(id, 'V2', titre, { mode: 'delivery', ville, paiements, billet, lignes: panierPizza(ville, d) });
    d++;
  };
  for (const [i, m] of SOUS_ENSEMBLES_SANS_ESPECES.entries()) livraison('D' + String(i + 1).padStart(2, '0'), 'paiement ' + m.join(' + '), m, null);
  for (const [i, b] of [0, 10, 20, 50, 100].entries()) livraison('D' + String(8 + i).padStart(2, '0'), 'espèces seules, ' + (b === 0 ? 'appoint' : 'billet de ' + b + ' €'), ['cash'], b);
  for (const [i, [m, b]] of ESPECES_AVEC_AUTRES.entries()) livraison('D' + String(13 + i).padStart(2, '0'), 'paiement ' + m.join(' + ') + ', billet ' + b, m, b);

  // ------------------------------------------------------------------ V3 : frais de livraison par ville (aucune pizza), promotions en livraison
  const MOYENS_Z = [[['card'], null], [['cash'], 50], [['ticket'], null], [['ticket_card'], null], [['cash'], 0], [['card', 'cash'], 50], [['card', 'ticket'], null], [['cash'], 100]];
  VILLES.forEach((ville, i) => {
    const min = zones[ville].minimum_cents;
    const idx = min <= 1000 ? 0 : min <= 1500 ? 1 : min <= 2000 ? 2 : 3;
    // Les lignes d'une fixture ne sont jamais partagées : on reconstruit à chaque fois.
    const lignes = [
      () => [ligne('Pâtes Saumon', { qty: 2 })],
      () => [ligne('Pâtes Carbonara', { qty: 2 })],
      () => [ligne('Pâtes Bolognaise', { qty: 3 })],
      () => [ligne('Pâtes 3 fromages', { qty: 2 }), ligne('Dessert Part de Tarte au Daim'), ligne('Maxi Coca'), ligne('Tex-Mex Wings (5 pièces)')]
    ][idx]();
    const [m, b] = MOYENS_Z[i];
    fixture('Z' + String(i + 1).padStart(2, '0'), 'V3', `frais de livraison ${ville} (aucune pizza)`, { mode: 'delivery', ville, paiements: m, billet: b, lignes });
  });
  fixture('R01', 'V3', 'livraison : 2 Solo, la 2e à moitié prix', { mode: 'delivery', paiements: ['card'], lignes: [ligne('Végétarienne', { taille: 'Solo' }), ligne('Régina', { taille: 'Solo' })] });
  fixture('R02', 'V3', 'livraison : XXL + Quatro + Solo', { mode: 'delivery', ville: 'Dourges', paiements: ['cash'], billet: 100, lignes: [ligne('Subito', { taille: 'XXL' }), ligne('Chicken', { taille: 'Quatro' }), ligne('Kefta', { taille: 'Solo' })] });
  fixture('R03', 'V3', 'livraison : 4 pizzas dont une ligne de 2 XXL, pâtes et boisson', {
    mode: 'delivery', ville: 'Billy-Montigny', paiements: ['card', 'cash'], billet: 50,
    lignes: [ligne('Neptune', { taille: 'XXL', qty: 2 }), ligne('Pacifico', { taille: 'Duo' }), ligne('Venezia', { taille: 'Duo' }), ligne('Pâtes Saumon'), ligne('Canette Oasis pomme poire', { qty: 2 })]
  });
  fixture('R04', 'V3', 'livraison : une pizza et des boissons (aucun frais, aucune promotion)', {
    mode: 'delivery', ville: 'Noyelles-Godault', paiements: ['ticket_card'], lignes: [ligne('Pollame', { taille: 'Duo' }), ligne('Canette Oasis pomme poire', { qty: 3 })]
  });
  fixture('R05', 'V3', 'livraison : 3 pizzas avec moitié-moitié et suppléments', {
    mode: 'delivery', ville: 'Fouquières-lès-Lens', paiements: ['card', 'ticket'],
    lignes: [ligne('Indienne', { taille: 'Quatro', moitie: 'Carolina', supplements: ['Viande hachée'] }), ligne('Suisse', { taille: 'Duo', retraits: ['pommes de terre'] }), ligne('Milano', { taille: 'Solo' })]
  });

  fixture('M01', 'V3', 'même client que P02 : 2e commande à emporter (deux pastilles au même nom)', { memeClient: 'P02', lignes: [ligne('Kefta', { taille: 'Quatro' })] });
  fixture('M02', 'V3', 'même client que P03 : commande en livraison (deux pastilles au même nom)', { memeClient: 'P03', mode: 'delivery', paiements: ['cash'], billet: 20, lignes: [ligne('Maroilles', { taille: 'Duo' })] });

  // ------------------------------------------------------------------ V4 : caractères spéciaux, noms et adresses longs
  fixture('S01', 'V4', 'guillemets et apostrophes dans le nom et la remarque', {
    profil: { prenom: 'Zoé "Zozo"', nom: "O'Brien-Müller" },
    lignes: [ligne("L'Extravagante", { taille: 'Solo', note: `Sans "oignons" svp, c'est l'anniv' d'Éloïse !` })]
  });
  fixture('S02', 'V4', 'chevrons et esperluette dans le nom et l\'adresse (livraison)', {
    mode: 'delivery', ville: 'Rouvroy', paiements: ['card'],
    profil: { prenom: 'A&B <Pizza>', nom: 'Dupont & Fils <SA>', rue: '5 allée des "Tilleuls" <bis> & l\'Église, bât. B' },
    lignes: [ligne('Végétarienne', { taille: 'Quatro' }), ligne('Régina', { taille: 'Solo' })]
  });
  fixture('S03', 'V4', 'emoji dans le nom et la remarque', {
    profil: { prenom: 'Léa 🍕', nom: 'Martin 🔥' },
    lignes: [ligne('Chicken Chika', { taille: 'Duo', note: 'Merci 🙏 🍕🍕🍕 à très vite 😀' })]
  });
  fixture('S04', 'V4', 'téléphone international avec parenthèses et points (livraison)', {
    mode: 'delivery', ville: 'Courrières', paiements: ['cash'], billet: 50,
    profil: { tel: '+33 (0)6.12.34.56.78' },
    lignes: [ligne('Kefta', { taille: 'Quatro' })]
  });
  fixture('S05', 'V4', 'nom en arabe', { profil: { prenom: 'محمد', nom: 'العلي' }, lignes: [ligne('Campione', { taille: 'Solo' })] });
  fixture('S06', 'V4', 'noms vietnamien et chinois', { profil: { prenom: 'Nguyễn Thị', nom: '李小龍' }, lignes: [ligne('Napolitaine', { taille: 'Duo', note: '请不要洋葱 – merci' })] });
  fixture('S07', 'V4', 'tentative d\'injection HTML dans la remarque', {
    lignes: [ligne('Orientale', { taille: 'Solo', note: '<img src=x onerror="window.__xss=1"><script>window.__xss=2</script>&lt;b&gt;gras&lt;/b&gt; </small></li></ul><b>fin</b> {{7*7}} ${7*7} `tick`' })]
  });
  fixture('S08', 'V4', 'remarque avec retour à la ligne, tabulation et espaces doubles', {
    lignes: [ligne('Pacifico', { taille: 'Duo', note: 'Ligne 1\nLigne 2\tTab  deux espaces' })]
  });
  const longPrenom = 'Jean-Baptiste-Emmanuel Marie-Joseph Alexandre Charles-Henri';
  const longNom = "de la Tour d'Auvergne-Lauraguais de Montmorency-Beaumanoir";
  if (Array.from(longPrenom).length > 60 || Array.from(longNom).length > 60) throw new Error('Nom long trop long pour le profil');
  fixture('L01', 'V4', 'prénom et nom de 59 et 58 caractères avec espaces', { profil: { prenom: longPrenom, nom: longNom }, lignes: [ligne('Savoyarde', { taille: 'Solo' })] });
  fixture('L02', 'V4', 'prénom et nom de 60 caractères sans aucune espace', {
    profil: { prenom: 'ABCDEFGHIJ'.repeat(6), nom: 'KLMNOPQRST'.repeat(6) }, lignes: [ligne('Suisse', { taille: 'Duo' })]
  });
  fixture('L03', 'V4', 'rue de 150 caractères sans aucune espace (livraison)', {
    mode: 'delivery', ville: 'Dourges', paiements: ['ticket'], profil: { rue: 'Avenue' + 'Longue'.repeat(24) }, lignes: [ligne('Normande', { taille: 'Duo' })]
  });
  const rueLongue = "12 boulevard du Général de Gaulle et de la Libération, résidence Les Hauts Jardins de l'Artois, bâtiment B, escalier 3, 4e étage, porte gauche";
  if (Array.from(rueLongue).length > 150) throw new Error('Rue longue trop longue : ' + Array.from(rueLongue).length);
  fixture('L04', 'V4', 'rue de 150 caractères avec espaces et nom long (livraison)', {
    mode: 'delivery', ville: 'Hénin-Beaumont', paiements: ['card', 'ticket'],
    profil: { prenom: longPrenom.slice(0, 40).trim(), nom: longNom.slice(0, 40).trim(), rue: rueLongue }, lignes: [ligne('Fruits de mer', { taille: 'Solo' })]
  });

  // ------------------------------------------------------------------ V5 : extrêmes
  const pizzas8 = ['Végétarienne', 'Régina', 'Kebab', 'Subito', 'Chicken', 'Orientale', 'Neptune', 'Campione', 'Kefta', 'Pollame', 'Fajitas', 'Maroilles', 'Suisse', 'Carolina'];
  const autres = ['Pâtes Bolognaise', 'Pâtes Saumon', 'Subitowich Kebab', 'Subitowich Rome', 'Tex-Mex Nuggets (4 pièces)', 'Salade Exotique', 'Salade Di Roma', 'Dessert Tiramisubito Oreo',
    'Dessert Calzone Nutella', 'Canette Oasis pomme poire', 'Maxi Coca', 'Tex-Mex Tenders (4 pièces)', 'Pâtes 3 fromages'];
  const tailles = ['Solo', 'Duo', 'Quatro', 'XXL'];
  const quarante = [];
  for (let i = 0; i < 40; i++) {
    if (i % 3 === 0) quarante.push(ligne(pizzas8[(i / 3) % pizzas8.length], { taille: tailles[(i / 3) % 4], qty: i % 4 === 0 ? 2 : 1 }));
    else quarante.push(ligne(autres[i % autres.length], { qty: i % 5 === 0 ? 2 : 1 }));
  }
  fixture('X01', 'V5', '40 lignes, 49 articles (à emporter)', { lignes: quarante });
  fixture('X02', 'V5', '60 pizzas XXL : total au-delà de 1 000 € (livraison)', {
    mode: 'delivery', ville: 'Rouvroy', paiements: ['card', 'ticket'],
    lignes: [ligne('Subito', { taille: 'XXL', qty: 20 }), ligne('Carnivora', { taille: 'XXL', qty: 20 }), ligne('Orientale', { taille: 'XXL', qty: 20 })]
  });
  const retraitsX = ['poivrons', 'champignons', 'oignons'];
  const groupe0 = cat.supplement_groups[0].names.filter((n) => !retraitsX.includes(String(n).toLowerCase()));
  const groupe1 = cat.supplement_groups[1].names.slice(0, 12);
  fixture('X03', 'V5', '20 suppléments sur une pizza dont trois gratuits (retraits)', {
    lignes: [ligne('Végétarienne', { taille: 'Solo', retraits: retraitsX, supplements: [...groupe0, ...groupe1], note: 'Pizza « monstre »' })]
  });

  // ------------------------------------------------------------------ V6 : rafale de 25 commandes simultanées
  const r = rng(303);
  const pizzasB = ['Végétarienne', 'Régina', 'Kebab', 'Subito', 'Chicken', 'Orientale', 'Neptune', 'Campione', 'Kefta', 'Pollame'];
  for (let i = 0; i < 25; i++) {
    const mode = i % 2 === 0 ? 'pickup' : 'delivery';
    const taille = r.choix(['Solo', 'Duo', 'Quatro']);
    const sous = r.choix([...SOUS_ENSEMBLES_SANS_ESPECES, ['cash']]);
    fixture('B' + String(i + 1).padStart(2, '0'), 'V6', 'rafale ' + (i + 1), {
      mode, ville: 'Hénin-Beaumont', paiements: sous, billet: sous.includes('cash') ? r.choix([0, 10, 20, 50, 100]) : null,
      lignes: [ligne(r.choix(pizzasB), { taille }), ...(r.vrai(0.4) ? [ligne('Canette Oasis pomme poire', { qty: r.entier(1, 2) })] : [])]
    });
  }

  // ------------------------------------------------------------------ V7 : arrivées pendant l'affichage sur téléphone
  fixture('T01', 'V7', 'téléphone : 2 pizzas à emporter avec remarque', { lignes: [ligne('Pacifico', { taille: 'Duo', note: 'Sans crème' }), ligne('Venezia', { taille: 'Solo' })] });
  fixture('T02', 'V7', 'téléphone : livraison espèces billet de 50 €', { mode: 'delivery', ville: 'Courrières', paiements: ['cash'], billet: 50, lignes: [ligne('Carnivora', { taille: 'Quatro', moitie: 'Subito', supplements: ['Champignons'] })] });
  fixture('T03', 'V7', 'téléphone : caractères spéciaux et remarque de 300 caractères', {
    profil: { prenom: "Zoé O'Neil", nom: '"Le Grand" <JP> & Cie 🍕' }, lignes: [ligne('Chèvre miel', { taille: 'Quatro', note: NOTE300 })]
  });
  // ------------------------------------------------------------------ A01 : commande d'appoint pour l'essai de l'alerte sonore
  fixture('A01', 'V8', 'commande d\'appoint (alerte sonore)', { lignes: [ligne('Régina', { taille: 'Solo' })] });

  return { liste, zones, cat };
}
