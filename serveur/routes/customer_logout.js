// POST customer_logout — révoque la session client courante. Toujours 200.
import { allowMethods, readJsonBody, ok } from '../core.js';
import { clearAuthCookie, currentSession, revokeSession } from '../auth.js';

export default async function customerLogout(c) {
  allowMethods(c, ['POST']);
  await readJsonBody(c);
  const s = await currentSession(c, 'customer');
  if (s !== null) await revokeSession(Number(s.id));
  clearAuthCookie(c, 'customer');
  return ok();
}
