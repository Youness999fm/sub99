// Réinitialise le mot de passe d'un client et révoque toutes ses sessions (port de api/tools/reset_customer.php).
// Usage (variable DATABASE_URL définie) :  node serveur/outils/reset-customer.mjs
// L'e-mail puis le nouveau mot de passe sont lus sur l'entrée standard (une ligne chacun) ;
// le mot de passe n'est jamais affiché ni écrit dans un fichier.
import { pathToFileURL } from 'node:url';
import bcrypt from 'bcryptjs';
import { one, transaction } from '../db.js';
import { normalizeEmail } from '../customers.js';
import { nowUtc, entreeBcrypt } from '../util.js';

/**
 * Remplace le mot de passe du client et révoque ses sessions.
 * Renvoie { code, stdout, stderr } (code 0 = succès), comme l'outil PHP.
 * Aucune donnée personnelle ni mot de passe dans les messages.
 */
export async function resetCustomer(email, nouveauMotDePasse) {
  try {
    const mail = normalizeEmail(String(email === undefined || email === null ? '' : email).trim().toLowerCase());
    const password = typeof nouveauMotDePasse === 'string' ? nouveauMotDePasse : '';
    if (mail === null) return { code: 1, stdout: '', stderr: 'E-mail invalide.\n' };
    const len = Buffer.byteLength(password);
    if (len < 8 || len > 200) {
      return { code: 1, stdout: '', stderr: 'Mot de passe refusé : 8 caractères au moins, 200 octets au plus.\n' };
    }
    const client = await one('SELECT id FROM customers WHERE email = ?', [mail]);
    if (client === null) return { code: 1, stdout: '', stderr: 'Aucun client avec cet e-mail.\n' };

    const now = nowUtc();
    const hash = await bcrypt.hash(entreeBcrypt(password), 10);
    const revoquees = await transaction(async (t) => {
      await t.exec('UPDATE customers SET password_hash = ?, updated_at = ? WHERE id = ?', [hash, now, Number(client.id)]);
      return t.exec(
        "UPDATE sessions SET revoked_at = ? WHERE user_type = 'customer' AND user_id = ? AND revoked_at IS NULL",
        [now, Number(client.id)]
      );
    });
    return { code: 0, stdout: 'Mot de passe du client remplacé. Sessions révoquées : ' + revoquees + '.\n', stderr: '' };
  } catch (e) {
    // Classe et code SQL seulement : le message d'une erreur peut contenir une valeur saisie.
    return { code: 1, stdout: '', stderr: 'Échec : ' + (e && e.constructor ? e.constructor.name : 'Erreur') + (e && e.code ? ' code ' + String(e.code) : '') + '\n' };
  }
}

// ---------------------------------------------------------------- lanceur en ligne de commande
function lireMasque(invite) {
  return new Promise((resolve, reject) => {
    process.stderr.write(invite);
    let saisie = '';
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    const fin = () => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.removeListener('data', surDonnees);
      process.stderr.write('\n');
    };
    const surDonnees = (c) => {
      for (const ch of c) {
        if (ch === '\r' || ch === '\n') { fin(); resolve(saisie); return; }
        if (ch === '\u0003') { fin(); reject(new Error('Annulé.')); return; }
        if (ch === '\u007f' || ch === '\b') saisie = saisie.slice(0, -1);
        else saisie += ch;
      }
    };
    process.stdin.on('data', surDonnees);
  });
}

async function lireToutStdin() {
  const morceaux = [];
  for await (const m of process.stdin) morceaux.push(m);
  return Buffer.concat(morceaux).toString('utf8');
}

async function principal() {
  if (process.argv.length > 2) {
    console.error('Aucune option attendue.');
    return 1;
  }
  if (!process.env.DATABASE_URL) {
    console.error('Variable DATABASE_URL absente.');
    return 1;
  }
  let email;
  let password;
  if (process.stdin.isTTY) {
    const { createInterface } = await import('node:readline/promises');
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    email = await rl.question('E-mail du client : ');
    rl.close();
    password = await lireMasque('Nouveau mot de passe (8 caractères au moins) : ');
  } else {
    const lignes = (await lireToutStdin()).split('\n').map((l) => l.replace(/\r$/, ''));
    email = lignes[0] || '';
    password = lignes[1] || '';
  }
  const r = await resetCustomer(email, password);
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  return r.code;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  principal().then((code) => process.exit(code), (e) => {
    console.error('Échec : ' + (e && e.constructor ? e.constructor.name : 'Erreur'));
    process.exit(1);
  });
}
