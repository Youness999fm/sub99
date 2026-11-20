// POST customer_update_address — {"street", "city", "housing_type"} ; ville vide = adresse (et type de logement) effacés.
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
  const [street, city, housingType] = validateAddress(b, err);
  if (Object.keys(err).length) failValidation(err);
  await exec('UPDATE customers SET street = ?, city = ?, housing_type = ?, updated_at = ? WHERE id = ?', [street, city, housingType, nowUtc(), Number(cust.id)]);
  return ok({ customer: customerView(await one('SELECT * FROM customers WHERE id = ?', [Number(cust.id)])) });
}
