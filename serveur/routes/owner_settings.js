// GET/POST owner_settings — délai par défaut, ouverture/fermeture manuelle des commandes.
import { allowMethods, readJsonBody, failValidation, ok } from '../core.js';
import { requireOwner } from '../auth.js';
import { one, exec, estViolationUnique } from '../db.js';
import { DELAY_CHOICES } from '../util.js';

async function ecrireReglage(cle, valeur) {
  if ((await exec('UPDATE settings SET svalue = ? WHERE skey = ?', [valeur, cle])) === 0) {
    try {
      await exec('INSERT INTO settings (skey, svalue) VALUES (?, ?)', [cle, valeur]);
    } catch (e) {
      if (!estViolationUnique(e)) throw e;
      await exec('UPDATE settings SET svalue = ? WHERE skey = ?', [valeur, cle]);
    }
  }
}

export default async function ownerSettings(c) {
  const method = allowMethods(c, ['GET', 'POST']);
  let b = null;
  if (method === 'POST') b = await readJsonBody(c);
  await requireOwner(c);

  if (method === 'POST') {
    if (b.default_delay_minutes !== undefined) {
      const d = b.default_delay_minutes;
      if (!Number.isInteger(d) || !DELAY_CHOICES.includes(d)) {
        failValidation({ default_delay_minutes: 'Délai attendu : 10, 20, 30, 40, 50 ou 60 minutes.' });
      }
      await ecrireReglage('default_delay_minutes', String(d));
    }
    if (b.store_open !== undefined) {
      if (typeof b.store_open !== 'boolean') failValidation({ store_open: 'Valeur attendue : vrai ou faux.' });
      await ecrireReglage('store_open', b.store_open ? '1' : '0');
    }
  }

  const delayRow = await one('SELECT svalue FROM settings WHERE skey = ?', ['default_delay_minutes']);
  const default_delay_minutes = delayRow !== null && /^[0-9]+$/.test(String(delayRow.svalue)) ? Number(delayRow.svalue) : 30;

  const openRow = await one('SELECT svalue FROM settings WHERE skey = ?', ['store_open']);
  const store_open = openRow === null || openRow.svalue !== '0';

  return ok({ default_delay_minutes, store_open });
}
