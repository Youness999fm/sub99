// POST owner_sessions_revoke — {"scope": "others"} ou {"scope": "all"}.
import { allowMethods, readJsonBody, failValidation, ok } from '../core.js';
import { requireOwner, clearAuthCookie } from '../auth.js';
import { exec } from '../db.js';
import { nowUtc } from '../util.js';

export default async function ownerSessionsRevoke(c) {
  allowMethods(c, ['POST']);
  const b = await readJsonBody(c);
  const [session, owner] = await requireOwner(c);

  const scope = b.scope === undefined ? null : b.scope;
  if (scope !== 'others' && scope !== 'all') {
    failValidation({ scope: 'Valeur attendue : others ou all.' });
  }

  const now = nowUtc();
  let sql = `UPDATE sessions SET revoked_at = ?
             WHERE user_type = 'owner' AND user_id = ? AND revoked_at IS NULL AND expires_at > ?`;
  const params = [now, Number(owner.id), now];
  if (scope === 'others') {
    sql += ' AND id <> ?';
    params.push(Number(session.id));
  }
  const revoked = await exec(sql, params);

  if (scope === 'all') {
    clearAuthCookie(c, 'owner');
    return ok({ revoked, logged_out: true });
  }
  return ok({ revoked });
}
