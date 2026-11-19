// Démarre un serveur de test PERSISTANT pour les tests navigateur, avec trois comptes clients de test.
// Usage : node tests/lib/demarrer-serveur.mjs      (arrêt : Ctrl+C, ou fin du processus)
// Données synthétiques uniquement : base SQLite neuve dans un dossier temporaire, hors du dépôt.
// Le fichier comptes-de-test.json (dans ce dossier temporaire) liste le propriétaire et les clients.
import fs from 'node:fs';
import path from 'node:path';
import { appel, BASE, demarrerServeurTest, genererMotDePasse, PROPRIETAIRE } from './serveur-test.mjs';

const MOT_DE_PASSE_CLIENT = process.env.SUBITO_TEST_CLIENT_PASSWORD || genererMotDePasse();
const CLIENTS = [
  { lettre: 'a', prenom: 'Léo', telephone: '06 00 00 00 01' },
  { lettre: 'b', prenom: 'Inès', telephone: '06 00 00 00 02' },
  { lettre: 'c', prenom: 'Nina', telephone: '06 00 00 00 03' },
];

const serveur = await demarrerServeurTest({ nom: 'navigateur' });
const comptes = [];
for (const c of CLIENTS) {
  const email = `client-${c.lettre}@example.test`;
  const r = await appel('customer_signup.php', {
    methode: 'POST',
    corps: {
      first_name: c.prenom,
      last_name: 'Test',
      email,
      phone: c.telephone,
      password: MOT_DE_PASSE_CLIENT,
      street: '1 rue de test',
      city: 'Hénin-Beaumont',
    },
  });
  comptes.push({ nom: `${c.prenom} Test`, email, motDePasse: MOT_DE_PASSE_CLIENT, inscription: r.status });
}

const fichier = path.join(serveur.dossier, 'comptes-de-test.json');
fs.writeFileSync(fichier, JSON.stringify({
  base: BASE,
  proprietaire: PROPRIETAIRE,
  clients: comptes,
  dossierTemporaire: serveur.dossier,
}, null, 2), 'utf8');
console.log(`PRET ${BASE} — comptes de test : ${fichier}`);

const arreter = () => { serveur.stop(); process.exit(0); };
process.on('SIGINT', arreter);
process.on('SIGTERM', arreter);
setInterval(() => {}, 60000);
