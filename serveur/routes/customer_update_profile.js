// POST customer_update_profile — {"first_name", "last_name", "phone"} (mêmes règles qu'à l'inscription).
// Ni l'adresse (customer_update_address), ni l'e-mail, ni le mot de passe.
import { allowMethods, readJsonBody, failValidation, ok } from '../core.js';
import { one, exec } from '../db.js';
import { requireCustomer } from '../auth.js';
import { customerView, validateProfile } from '../customers.js';
import { nowUtc } from '../util.js';

export default async function customerUpdateProfile(c) {
  allowMethods(c, ['POST']);
  const b = await readJsonBody(c);
  const [, cust] = await requireCustomer(c);

  const err = {};
  const [first, last, phone] = validateProfile(b, err);
  if (Object.keys(err).length) failValidation(err);
  await exec('UPDATE customers SET first_name = ?, last_name = ?, phone = ?, updated_at = ? WHERE id = ?',
    [first, last, phone, nowUtc(), Number(cust.id)]);
  return ok({ customer: customerView(await one('SELECT * FROM customers WHERE id = ?', [Number(cust.id)])) });
}
