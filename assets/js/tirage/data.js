// Source de données unique du "Grand Tirage". Les 30 pseudos ci-dessous
// sont les résultats officiels et définitifs communiqués par Subito —
// ne jamais corriger l'orthographe, ajouter, retirer, dupliquer ou
// réordonner un pseudo. L'ordre de chaque liste EST l'ordre de révélation
// (gagnant n°1 en premier, etc.), donc aussi une donnée officielle.
//
// Chaque gagnant n'existe qu'à cet endroit : tout le reste du module
// (reveal, recherche, partage, liste brute) lit ce tableau, jamais de
// pseudo recopié à la main ailleurs.

export const PIZZA_WINNERS = Object.freeze([
  'Ophelie-lana',
  'P_poteau2020',
  'Yz.mess',
  'Unzerr.ln4',
  'Anita200311',
  'Siba6259',
  'Gwendd',
  'Yohan0311',
  'Damienbou',
  'Melodydsx',
  'Cammar91',
  'Juustdoudou62',
  'Ibti2307',
  'Alisounaye',
  'Marineszyy',
]);

export const TIRAMISU_WINNERS = Object.freeze([
  'Mathislens62',
  'Wehd_59',
  'Jlp.off',
  'Odjellali',
  'E_srbb',
  'Holaquetall5962',
  'Ndinadinadina',
  'Nina62640',
  'Natouboulanger',
  'Maeva03078',
  'Fatouxflora',
  'Grazou62740',
  'Melodygims',
  'Madame1506',
  'Celineshalimar',
]);

export const PRIZES = Object.freeze({
  pizza: { emoji: '🍕🍕', label: '2 pizzas XXL', short: 'pizza' },
  tiramisu: { emoji: '🍰', label: '1 tiramisu', short: 'tiramisu' },
});

// Liste plate ordonnée : acte 1 (pizzas, dans l'ordre) puis acte 2
// (tiramisus, dans l'ordre). C'est cette liste que consomment le moteur
// de révélation et la recherche de pseudo.
export const WINNERS = Object.freeze([
  ...PIZZA_WINNERS.map((pseudo, i) => ({ pseudo, prize: 'pizza', rank: i + 1 })),
  ...TIRAMISU_WINNERS.map((pseudo, i) => ({ pseudo, prize: 'tiramisu', rank: i + 1 })),
]);

export const STATS = Object.freeze({
  participants: 250,
  winners: 30,
  gifts: 45, // 30 pizzas XXL (15 x 2) + 15 tiramisus
});

// Contrôle d'intégrité exécuté au chargement de la page (voir main.js).
// Ne modifie jamais les données : il ne fait que constater et signaler.
// Toute incohérence doit être visible immédiatement, pas découverte
// après publication.
export function validateWinners() {
  const errors = [];

  if (PIZZA_WINNERS.length !== 15) {
    errors.push(`Attendu 15 gagnants pizza, trouvé ${PIZZA_WINNERS.length}.`);
  }
  if (TIRAMISU_WINNERS.length !== 15) {
    errors.push(`Attendu 15 gagnants tiramisu, trouvé ${TIRAMISU_WINNERS.length}.`);
  }
  if (WINNERS.length !== 30) {
    errors.push(`Attendu 30 gagnants au total, trouvé ${WINNERS.length}.`);
  }

  const seen = new Map();
  WINNERS.forEach(({ pseudo }) => {
    seen.set(pseudo, (seen.get(pseudo) || 0) + 1);
  });
  const duplicates = [...seen.entries()].filter(([, count]) => count > 1).map(([pseudo]) => pseudo);
  if (duplicates.length > 0) {
    errors.push(`Pseudo(s) en double : ${duplicates.join(', ')}.`);
  }

  const distinctCount = seen.size;
  if (distinctCount !== 30) {
    errors.push(`Attendu 30 pseudos distincts, trouvé ${distinctCount}.`);
  }

  const totalGifts = PIZZA_WINNERS.length * 2 + TIRAMISU_WINNERS.length;
  if (totalGifts !== STATS.gifts) {
    errors.push(`Attendu ${STATS.gifts} cadeaux au total (30 pizzas + 15 tiramisus), calculé ${totalGifts}.`);
  }

  return { ok: errors.length === 0, errors };
}

// Normalisation utilisée par la recherche de pseudo : insensible à la
// casse et aux espaces superflus, mais ne modifie jamais le pseudo
// affiché (toujours celui écrit tel quel dans les tableaux ci-dessus).
export function findWinner(query) {
  const normalized = String(query || '').trim().toLowerCase();
  if (!normalized) return null;
  return WINNERS.find((w) => w.pseudo.toLowerCase() === normalized) || null;
}
