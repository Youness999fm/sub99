// POST customer_login — connexion client.
import bcrypt from 'bcryptjs';
import { allowMethods, readJsonBody, fail, ok } from '../core.js';
import { one, exec } from '../db.js';
import { createSession, currentSession, revokeSession, dummyPasswordHash } from '../auth.js';
import { throttleEnforce, throttleRefund, throttleIpKey } from '../throttle.js';
import { customerView } from '../customers.js';
import { nowUtc } from '../util.js';

export default async function customerLogin(c) {
  allowMethods(c, ['POST']);
  const b = await readJsonBody(c);

  const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : '';
  const password = typeof b.password === 'string' ? b.password : '';

  // Verrou par adresse IP seulement : aucun verrou par e-mail, pour qu'un tiers ne puisse pas bloquer
  // la connexion d'un client. IPv6 : seau par préfixe /64.
  const ipBucket = 'customer_login:ip:' + throttleIpKey(c.ip);
  // Chaque tentative est comptée (atomiquement) avant la vérification : seules les 5 premières d'une fenêtre de
  // 15 min sont vérifiées, même envoyées en même temps ; une réussite est décomptée ensuite.
  await throttleEnforce(ipBucket, 5, 900, 900);

  const cust = email !== '' && Buffer.byteLength(email) <= 190 ? await one('SELECT * FROM customers WHERE email = ?', [email]) : null;
  const hash = cust !== null ? String(cust.password_hash) : await dummyPasswordHash();
  const valid = Buffer.byteLength(password) <= 4096 && (await bcrypt.compare(password, hash)) && cust !== null;
  if (!valid) fail(401, 'invalid_credentials', 'Email ou mot de passe incorrect.');

  // Pas de remise à zéro : sinon un client connecté à son propre compte effacerait ses échecs sur les comptes d'autrui.
  await throttleRefund(ipBucket, 5);
  await exec('UPDATE customers SET last_login_at = ? WHERE id = ?', [nowUtc(), Number(cust.id)]);
  // Une seule session client active par navigateur : l'ancienne est révoquée.
  const previous = await currentSession(c, 'customer');
  if (previous !== null) await revokeSession(Number(previous.id));
  await createSession(c, 'customer', Number(cust.id), true);

  return ok({ customer: customerView(cust) });
}
