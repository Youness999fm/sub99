// POST owner_logout — révoque la session propriétaire courante.
import { allowMethods, readJsonBody, ok } from '../core.js';
import { requireOwner, revokeSession, clearAuthCookie } from '../auth.js';

export default async function ownerLogout(c) {
  allowMethods(c, ['POST']);
  await readJsonBody(c);
  const [session] = await requireOwner(c);

  await revokeSession(Number(session.id));
  clearAuthCookie(c, 'owner');
  return ok();
}
