// GET customer_me — client connecté, ou null pour un invité (jamais 401).
import { allowMethods, ok } from '../core.js';
import { optionalCustomer } from '../auth.js';
import { customerView } from '../customers.js';

export default async function customerMe(c) {
  allowMethods(c, ['GET']);
  const r = await optionalCustomer(c);
  return ok({ customer: r === null ? null : customerView(r[1]) });
}
