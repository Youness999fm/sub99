// Horloge de l'API : heure réelle en production ; horloge de test lue dans un fichier,
// uniquement hors Vercel et avec SUBITO_TEST_MODE=1 (jamais pilotable par une requête).
import { readFileSync } from 'node:fs';

/** Époque courante en secondes. */
export function maintenantEpoch() {
  const fichier = process.env.SUBITO_TEST_CLOCK_FILE;
  if (fichier && process.env.SUBITO_TEST_MODE === '1' && !process.env.VERCEL) {
    const brut = readFileSync(fichier, 'utf8').trim();
    if (!/^[0-9]{1,12}$/.test(brut)) throw new Error('Horloge de test illisible.');
    return Number(brut);
  }
  return Math.floor(Date.now() / 1000);
}
