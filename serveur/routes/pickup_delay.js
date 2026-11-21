// GET pickup_delay — délai actuel à emporter, public (affiché aux visiteurs avant de commander).
// Lit le même réglage que owner_settings.php (default_delay_minutes) mais sans authentification :
// aucune autre donnée exposée, aucune règle de calcul changée, simple lecture publique d'une valeur
// déjà destinée à être visible par les clients.
import { allowMethods, ok } from '../core.js';
import { one } from '../db.js';

export default async function pickupDelay(c) {
  allowMethods(c, ['GET']);
  const row = await one('SELECT svalue FROM settings WHERE skey = ?', ['default_delay_minutes']);
  const pickup_delay_minutes = row !== null && /^[0-9]+$/.test(String(row.svalue)) ? Number(row.svalue) : 30;
  return ok({ pickup_delay_minutes });
}
