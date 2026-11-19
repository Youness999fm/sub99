// Calcule le hash bcrypt du code patron, à mettre dans la variable OWNER_CODE_HASH.
// Usage (sur votre PC, jamais sur un ordinateur partagé) :  npm run hash-code
// Le code est saisi sans affichage, jamais écrit dans un fichier ni dans l'historique du terminal.
import bcrypt from 'bcryptjs';

function lireMasque(invite) {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) {
      reject(new Error('Ce script doit être lancé dans un terminal interactif.'));
      return;
    }
    process.stdout.write(invite);
    let saisie = '';
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    const fin = () => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.removeListener('data', surDonnees);
      process.stdout.write('\n');
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

try {
  const code = await lireMasque('Code patron : ');
  const confirmation = await lireMasque('Retapez le code : ');
  if (code !== confirmation) throw new Error('Les deux saisies sont différentes.');
  if (code.length < 6) throw new Error('Code trop court : 6 caractères au minimum (8 ou plus recommandés).');
  if (code.length < 8) console.log('Attention : un code de moins de 8 caractères se devine plus facilement.');
  const hash = await bcrypt.hash(code, 12);
  console.log('\nValeur à coller dans la variable OWNER_CODE_HASH (Vercel > Settings > Environment Variables) :\n');
  console.log(hash);
  console.log('\nDans un fichier .env local, mettez-la entre apostrophes : OWNER_CODE_HASH=\'...\'');
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
}
