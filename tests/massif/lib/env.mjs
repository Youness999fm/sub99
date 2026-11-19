// Environnement des tests massifs : site (pages statiques + API) dans CE processus, base Postgres réelle en mémoire.
// Lancer un script avec son propre port :  $env:SUBITO_TEST_PORT='18510'; node tests/massif/mon-test.mjs
import path from 'node:path';
import { writeFileSync } from 'node:fs';
import { makeEnv, openTestDb, runTool, startServer, stopServer, PORT, ORIGIN, OWNER_CODE, responses } from '../../api-vercel/lib/harness.mjs';

/**
 * Démarre un site local complet. Renvoie { db, base, origine, codePatron, journal, arreter }.
 *  - db : accès SYNCHRONE à la base (db.prepare(sql).get/all/run avec « ? ») ; ne pas l'appeler dans une boucle serrée
 *    pendant qu'une rafale de requêtes est en cours (il bloque le processus, serveur compris).
 *  - journal() : texte des erreurs que le serveur a écrites (console.error) ; ne doit jamais contenir de donnée de commande.
 */
export async function demarrerSite({ statique = true, horloge = null, env = {} } = {}) {
  const ctx = makeEnv();
  Object.assign(ctx.env, env);
  // Voyage dans le temps (heure du SERVEUR seulement) : demarrerSite({ horloge: epochSecondes }) puis site.fixerHeure(epoch).
  let fichierHorloge = null;
  if (horloge !== null) {
    fichierHorloge = path.join(ctx.dir, 'horloge.txt');
    writeFileSync(fichierHorloge, String(horloge));
    ctx.env.SUBITO_TEST_CLOCK_FILE = fichierHorloge;
  }
  const inst = await runTool(ctx, 'install.php');
  if (inst.code !== 0) throw new Error('Installation du schéma impossible : ' + inst.stderr);
  const proc = await startServer(ctx, { statique });
  return {
    ctx,
    db: openTestDb(ctx),
    port: PORT,
    origine: ORIGIN,
    base: ORIGIN,
    codePatron: OWNER_CODE,
    journal: () => ctx.serverLog(),
    fixerHeure: (epoch) => { if (fichierHorloge === null) throw new Error('Démarrer avec { horloge: epoch }'); writeFileSync(fichierHorloge, String(Math.floor(epoch))); },
    arreter: () => stopServer(proc)
  };
}

/** Toutes les réponses reçues par les clients du harnais (pour des contrôles transverses). Penser à la vider. */
export const reponses = responses;
export const viderReponses = () => { responses.length = 0; };
export { PORT, ORIGIN, OWNER_CODE };
