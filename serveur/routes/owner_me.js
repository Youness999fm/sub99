// GET owner_me — propriétaire connecté. Plus d'e-mail : le commerçant se connecte avec un code patron.
import { allowMethods, ok } from '../core.js';
import { requireOwner } from '../auth.js';

export default async function ownerMe(c) {
  allowMethods(c, ['GET']);
  const [session] = await requireOwner(c);

  return ok({
    owner: {
      remember: Number(session.remember) === 1,
      session_id: Number(session.id)
    }
  });
}
