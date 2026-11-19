// POST customer_update_address — {"street", "city"} ; ville vide = adresse effacée.
import { allowMethods, readJsonBody, failValidation, ok } from '../core.js';
import { one, exec } from '../db.js';
import { requireCustomer } from '../auth.js';
import { customerView, validateAddress } from '../customers.js';
import { nowUtc } from '../util.js';

export default async function customerUpdateAddress(c) {
  allowMethods(c, ['POST']);
  const b = await readJsonBody(c);
  const [, cust] = await requireCustomer(c);

  const err = {};
  const [street, city] = validateAddress(b, err);
  if (Object.keys(err).length) failValidation(err);
  await exec('UPDATE customers SET street = ?, city = ?, updated_at = ? WHERE id = ?', [street, city, nowUtc(), Number(cust.id)]);
  return ok({ customer: customerView(await one('SELECT * FROM customers WHERE id = ?', [Number(cust.id)])) });
}
