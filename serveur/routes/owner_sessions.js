// GET owner_sessions — sessions propriétaire actives.
import { allowMethods, ok } from '../core.js';
import { requireOwner } from '../auth.js';
import { all } from '../db.js';
import { nowUtc } from '../util.js';

export default async function ownerSessions(c) {
  allowMethods(c, ['GET']);
  const [session, owner] = await requireOwner(c);

  const rows = await all(
    `SELECT id, device, created_at, last_seen_at, expires_at, remember FROM sessions
     WHERE user_type = 'owner' AND user_id = ? AND revoked_at IS NULL AND expires_at > ?
     ORDER BY last_seen_at DESC, id DESC`,
    [Number(owner.id), nowUtc()]
  );
  const list = rows.map((r) => ({
    id: Number(r.id),
    device: String(r.device),
    created_at: String(r.created_at),
    last_seen_at: String(r.last_seen_at),
    expires_at: String(r.expires_at),
    remember: Number(r.remember) === 1,
    current: Number(r.id) === Number(session.id)
  }));
  return ok({ sessions: list });
}
