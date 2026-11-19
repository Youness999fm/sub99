// GET/POST owner_settings — délai par défaut.
import { allowMethods, readJsonBody, failValidation, ok } from '../core.js';
import { requireOwner } from '../auth.js';
import { one, exec, estViolationUnique } from '../db.js';
import { DELAY_CHOICES } from '../util.js';

export default async function ownerSettings(c) {
  const method = allowMethods(c, ['GET', 'POST']);
  let b = null;
  if (method === 'POST') b = await readJsonBody(c);
  await requireOwner(c);

  if (method === 'POST') {
    const d = b.default_delay_minutes === undefined ? null : b.default_delay_minutes;
    if (!Number.isInteger(d) || !DELAY_CHOICES.includes(d)) {
      failValidation({ default_delay_minutes: 'Délai attendu : 20, 30, 40, 50 ou 60 minutes.' });
    }
    if ((await exec('UPDATE settings SET svalue = ? WHERE skey = ?', [String(d), 'default_delay_minutes'])) === 0) {
      try {
        await exec('INSERT INTO settings (skey, svalue) VALUES (?, ?)', ['default_delay_minutes', String(d)]);
      } catch (e) {
        if (!estViolationUnique(e)) throw e;
        await exec('UPDATE settings SET svalue = ? WHERE skey = ?', [String(d), 'default_delay_minutes']);
      }
    }
  }

  const row = await one('SELECT svalue FROM settings WHERE skey = ?', ['default_delay_minutes']);
  const value = row !== null && /^[0-9]+$/.test(String(row.svalue)) ? Number(row.svalue) : 30;
  return ok({ default_delay_minutes: value });
}
