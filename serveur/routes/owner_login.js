// POST owner_login — connexion du commerçant avec le code patron : { "code": "...", "remember": bool }.
// Le code n'existe nulle part en clair : seul son hash bcrypt est lu (variable OWNER_CODE_HASH).
// Remplace l'ancien couple e-mail + mot de passe (décision du 19/11 : code patron uniquement).
import bcrypt from 'bcryptjs';
import { allowMethods, readJsonBody, bodyBool, fail, ok } from '../core.js';
import { createSession, OWNER_ID } from '../auth.js';
import { throttleEnforce, throttleRefund, throttleIpKey } from '../throttle.js';

export default async function ownerLogin(c) {
  allowMethods(c, ['POST']);
  const b = await readJsonBody(c);

  const hash = process.env.OWNER_CODE_HASH;
  if (!hash) throw Object.assign(new Error('OWNER_CODE_HASH absente'), { code: 'CONFIG_CODE' });

  const code = typeof b.code === 'string' ? b.code : '';
  const remember = bodyBool(b, 'remember');

  // Verrou par adresse IP seulement : aucun verrou global, pour qu'un tiers ne puisse pas bloquer le patron.
  // Chaque tentative est comptée AVANT la vérification (verrou à 5 échecs en 15 min) ; une réussite est décomptée ensuite.
  const ipBucket = 'owner_login:ip:' + throttleIpKey(c.ip);
  await throttleEnforce(ipBucket, 5, 900, 900);

  const valid = code !== '' && Buffer.byteLength(code) <= 4096 && (await bcrypt.compare(code, hash));
  if (!valid) fail(401, 'invalid_credentials', 'Code incorrect.');

  await throttleRefund(ipBucket, 5);
  await createSession(c, 'owner', OWNER_ID, remember);
  return ok({ owner: { remember } });
}
