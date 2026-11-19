// POST customer_signup — création d'un compte client.
import bcrypt from 'bcryptjs';
import { allowMethods, readJsonBody, fail, failValidation, ok } from '../core.js';
import { one, insert, estViolationUnique } from '../db.js';
import { createSession, currentSession, revokeSession } from '../auth.js';
import { throttleGuard, throttleEnforce, throttleIpKey } from '../throttle.js';
import { customerView, validateProfile, normalizeEmail, validateAddress } from '../customers.js';
import { nowUtc } from '../util.js';

export default async function customerSignup(c) {
  allowMethods(c, ['POST']);
  const b = await readJsonBody(c);

  const ipBucket = 'customer_signup:ip:' + throttleIpKey(c.ip);
  await throttleGuard([ipBucket]);

  const err = {};
  const [first, last, phone] = validateProfile(b, err);
  const email = normalizeEmail(b.email);
  if (email === null) err.email = 'Adresse e-mail invalide.';
  const password = b.password;
  if (typeof password !== 'string' || Buffer.byteLength(password) < 8 || Buffer.byteLength(password) > 200) {
    err.password = 'Mot de passe de 8 caractères au moins.';
  }
  const [street, city] = validateAddress(b, err);
  if (Object.keys(err).length) failValidation(err);

  await throttleEnforce(ipBucket, 10, 3600);

  if ((await one('SELECT id FROM customers WHERE email = ?', [email])) !== null) {
    fail(409, 'email_taken', 'Un compte existe déjà avec cette adresse e-mail.');
  }
  const now = nowUtc();
  let id;
  try {
    id = await insert(
      `INSERT INTO customers (email, password_hash, first_name, last_name, phone, street, city, created_at, updated_at, last_login_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [email, await bcrypt.hash(password, 10), first, last, phone, street, city, now, now, now]
    );
  } catch (e) {
    if (estViolationUnique(e)) fail(409, 'email_taken', 'Un compte existe déjà avec cette adresse e-mail.');
    throw e;
  }

  // Une seule session client active par navigateur : l'ancienne est révoquée (comme à la connexion).
  const precedente = await currentSession(c, 'customer');
  if (precedente !== null) await revokeSession(Number(precedente.id));
  await createSession(c, 'customer', id, true);
  const customer = await one('SELECT * FROM customers WHERE id = ?', [id]);
  return ok({ customer: customerView(customer) }, 201);
}
