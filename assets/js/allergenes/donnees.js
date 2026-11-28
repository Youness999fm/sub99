/* ============================================================================
   SUBITO PIZZA — Données allergènes (source unique)
   ----------------------------------------------------------------------------
   Transcription STRICTE du « Tableau de Présence des Allergènes » (document
   qualité interne, 4 pages, règlement UE n°1169/2011). Une seule règle tenue :
   on ne recopie QUE ce que le tableau affirme. Aucune déduction depuis un nom
   de produit, une photo ou une recette ; une case vide n'est jamais transformée
   en « sans allergène ».

   Un produit absent de ce fichier n'affiche AUCUN accordéon sur le site : il
   vaut mieux ne rien dire que dire une chose non vérifiée.

   Clé = catégorie + nom, car trois produits de catégories différentes portent
   des noms voisins (pizza « 4 Fromages », pâtes « 3 fromages », subitowich
   « 4 fromages ») : les confondre serait une faute alimentaire.

   Pour mettre à jour : modifier ce seul fichier, rien d'autre.
   ========================================================================== */
(function (global) {
  'use strict';

  /* Les 14 catégories réglementaires. `nom` est TOUJOURS affiché à côté du
     pictogramme : jamais d'information transmise par le seul symbole. */
  var CATEGORIES = {
    gluten:     { nom: 'Céréales contenant du gluten', detail: 'Blé, seigle, orge, avoine, épeautre, kamut, froment.' },
    crustaces:  { nom: 'Crustacés' },
    oeufs:      { nom: 'Œufs' },
    poissons:   { nom: 'Poissons' },
    arachides:  { nom: 'Arachides' },
    soja:       { nom: 'Soja' },
    lait:       { nom: 'Lait', detail: 'Y compris le lactose.' },
    fruitsCoque:{ nom: 'Fruits à coque', detail: 'Amandes, noisettes, noix, noix de cajou, noix de pécan, noix du Brésil, pistaches, noix de macadamia et noix du Queensland.' },
    celeri:     { nom: 'Céleri' },
    moutarde:   { nom: 'Moutarde' },
    sesame:     { nom: 'Graines de sésame' },
    sulfites:   { nom: 'Anhydride sulfureux et sulfites', detail: 'Si la quantité dépasse 10 mg/kg de produit fini.' },
    lupin:      { nom: 'Lupin' },
    mollusques: { nom: 'Mollusques' }
  };

  /* Page 1/3 — NOS PIZZAS, base tomate puis base crème fraîche. */
  var PIZZAS = {
    'napolitaine':      ['gluten', 'poissons', 'lait'],
    'neptune':          ['gluten', 'poissons', 'lait'],
    'regina':           ['gluten', 'lait'],
    'campione':         ['gluten', 'lait'],
    'vegetarienne':     ['gluten', 'lait'],
    'calzone':          ['gluten', 'poissons', 'lait'],
    'kefta':            ['gluten', 'oeufs', 'lait'],
    '4 saisons':        ['gluten', 'lait'],
    'orientale':        ['gluten', 'oeufs', 'lait', 'sulfites'],
    '4 fromages':       ['gluten', 'lait'],
    'chicken':          ['gluten', 'lait'],
    'kebab':            ['gluten', 'soja', 'lait'],
    'fruits de mer':    ['gluten', 'crustaces', 'poissons', 'lait', 'mollusques'],
    'pacifico':         ['gluten', 'poissons', 'lait'],
    'l extravagante':   ['gluten', 'oeufs', 'lait', 'sulfites'],
    'subito':           ['gluten', 'oeufs', 'lait', 'sulfites'],
    'carolina':         ['gluten', 'lait', 'moutarde', 'sulfites'],
    'carnivora':        ['gluten', 'lait', 'sulfites'],
    '3 jambons':        ['gluten', 'lait', 'sulfites'],
    'venezia':          ['gluten', 'poissons', 'lait'],
    'milano':           ['gluten', 'lait'],
    'maroilles':        ['gluten', 'lait'],
    'chicken chika':    ['gluten', 'lait'],
    'normande':         ['gluten', 'lait'],
    'chevre miel':      ['gluten', 'lait'],
    'indienne':         ['gluten', 'lait', 'celeri', 'moutarde'],
    'fajitas':          ['gluten', 'lait'],
    'pollame':          ['gluten', 'soja', 'lait'],
    'savoyarde':        ['gluten', 'lait']
    /* « Suisse » : absente du tableau — volontairement non renseignée. */
  };

  /* Page 2/3 — NOS PÂTES. */
  var PATES = {
    'bolognaise': ['gluten'],
    'saumon':     ['gluten', 'poissons', 'lait']
    /* « 3 fromages » : le tableau liste « 4 FROMAGES » en pâtes, le site vend
       « 3 fromages ». Noms différents = produit non confirmé, donc non publié.
       « Carbonara » : absente du tableau. */
  };

  /* Page 2/3 — NOS SALADES. */
  var SALADES = {
    'exotique':    ['crustaces', 'oeufs'],
    'nicoise':     ['oeufs', 'poissons'],
    'printaniere': ['oeufs', 'lait'],
    'di roma':     ['oeufs', 'poissons']
  };

  /* Page 2/3 — NOS PANINIS = les Subitowichs du site (correspondance autorisée
     explicitement par le commerçant, cahier des charges § 9). */
  var SUBITOWICHS = {
    'milano':    ['gluten', 'lait'],
    'vesuvio':   ['gluten', 'lait'],
    'rome':      ['gluten', 'poissons', 'lait'],
    'venise':    ['gluten', 'lait'],
    'norvegien': ['gluten', 'poissons', 'lait'],
    'kebab':     ['gluten', 'soja', 'lait']
    /* « 4 fromages » : le tableau liste « 3 FROMAGES » en paninis, le site vend
       « 4 fromages ». Non confirmé, donc non publié. */
  };

  /* Page 3/3 — TEX-MEX. */
  var TEXMEX = {
    'wings':       ['gluten', 'oeufs', 'soja', 'lait', 'celeri', 'moutarde'],
    'tenders':     ['gluten', 'oeufs', 'soja', 'lait', 'celeri', 'moutarde'],
    'nuggets':     ['gluten', 'oeufs', 'soja', 'lait', 'celeri', 'moutarde'],
    'oignon ring': ['gluten', 'oeufs', 'lait']
  };

  /* Page 3/3 — NOS DESSERTS, + Calzone Nutella (§ 12 du cahier des charges :
     pâte traditionnelle au blé + Nutella → gluten, fruits à coque (noisettes),
     lait, soja. Source fabricant : nutella.com). */
  var DESSERTS = {
    'part de tarte au daim': ['gluten', 'oeufs', 'lait', 'fruitsCoque'],
    'calzone nutella':       ['gluten', 'fruitsCoque', 'lait', 'soja']
    /* Les trois « Tiramisubito » (Spéculoos, Oreo, M&M's) : le tableau ne liste
       qu'un « TIRAMISU » générique. Trois recettes distinctes ne peuvent pas
       hériter d'une seule ligne — non publiées en attente de confirmation. */
  };

  /* Catégories reconnues sur le site → table de données correspondante.
     Une catégorie absente d'ici n'affiche jamais d'accordéon (boissons : voir
     le compte rendu, références à vérifier une par une auprès des fabricants). */
  var PAR_CATEGORIE = {
    pizzas: PIZZAS,
    pates: PATES,
    salades: SALADES,
    subitowichs: SUBITOWICHS,
    texmex: TEXMEX,
    desserts: DESSERTS
  };

  /* Normalise un nom de produit pour la correspondance : minuscules, sans
     accents, sans ponctuation ni mention de contenance « (5 pièces) ». */
  function normaliser(nom) {
    return String(nom || '')
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/\([^)]*\)/g, ' ')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  /* Allergènes d'un produit, ou null si non documenté (jamais un tableau vide :
     « rien à afficher » et « aucun allergène » ne veulent pas dire la même chose). */
  function allergenesDe(categorie, nomProduit) {
    var table = PAR_CATEGORIE[categorie];
    if (!table) return null;
    var cles = table[normaliser(nomProduit)];
    return cles && cles.length ? cles.slice() : null;
  }

  global.SubitoAllergenes = {
    CATEGORIES: CATEGORIES,
    allergenesDe: allergenesDe,
    normaliser: normaliser,
    parCategorie: PAR_CATEGORIE,
    /* Le lait reste un allergène : la pasteurisation ne le supprime pas. */
    MENTION_FROMAGE: 'Tous nos fromages sont élaborés à partir de lait pasteurisé.',
    MENTION_CROISEE: 'Des contaminations croisées avec d’autres allergènes restent possibles.',
    MENTION_PERSO: 'Les allergènes indiqués concernent la recette d’origine. La personnalisation de votre produit peut modifier ces informations.'
  };
})(window);
