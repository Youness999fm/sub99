// GET/POST owner_availability — ruptures enregistrées (pizza, produit, ingrédient).
import { allowMethods, readJsonBody, failValidation, ok } from '../core.js';
import { requireOwner } from '../auth.js';
import { all, exec, estViolationUnique } from '../db.js';
import { AVAILABILITY_KINDS, availabilityEffective } from '../availability.js';
import { cleanSpaces, strChars, nameKeysIntersect, nowUtc, serviceDay } from '../util.js';

export default async function ownerAvailability(c) {
  const method = allowMethods(c, ['GET', 'POST']);
  let b = null;
  if (method === 'POST') b = await readJsonBody(c);
  await requireOwner(c);

  if (method === 'POST') {
    const err = {};
    const kind = b.kind === undefined ? null : b.kind;
    if (typeof kind !== 'string' || !AVAILABILITY_KINDS.includes(kind)) {
      err.kind = 'Type attendu : pizza, product ou ingredient.';
    }
    const status = b.status === undefined ? null : b.status;
    if (!['available', 'out_today', 'out_manual'].includes(status)) {
      err.status = 'Statut attendu : available, out_today ou out_manual.';
    }
    const name = typeof b.name === 'string' ? cleanSpaces(b.name) : '';
    // Le caractère NUL est refusé (Postgres ne le stocke pas) : 422 plutôt qu'une erreur 500.
    if (name === '' || strChars(name) > 120 || name.includes('\0')) {
      err.name = 'Nom attendu (1 à 120 caractères).';
    }
    if (Object.keys(err).length) failValidation(err);

    const now = nowUtc();
    if (status === 'available') {
      await exec('DELETE FROM availability WHERE kind = ? AND name = ?', [kind, name]);
      // Supprime aussi les entrées du même type dont le nom correspond après normalisation
      // (« Calzone » rend disponible « Calzone (soufflée) », et inversement).
      for (const row of await all('SELECT id, name FROM availability WHERE kind = ?', [kind])) {
        if (nameKeysIntersect(String(row.name), name)) {
          await exec('DELETE FROM availability WHERE id = ?', [Number(row.id)]);
        }
      }
    } else {
      const day = status === 'out_today' ? serviceDay() : null;
      const params = [status, day, now, kind, name];
      const sqlUpdate = 'UPDATE availability SET status = ?, service_day = ?, updated_at = ? WHERE kind = ? AND name = ?';
      if ((await exec(sqlUpdate, params)) === 0) {
        try {
          await exec('INSERT INTO availability (kind, name, status, service_day, updated_at) VALUES (?, ?, ?, ?, ?)',
            [kind, name, status, day, now]);
        } catch (e) {
          if (!estViolationUnique(e)) throw e;
          await exec(sqlUpdate, params);
        }
      }
    }
  }

  return ok({ out: await availabilityEffective() });
}
