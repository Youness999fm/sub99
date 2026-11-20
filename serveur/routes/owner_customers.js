// POST owner_customers {"code": "...", "q": "..."} — fiches clients (500 au plus).
// POST uniquement : la recherche (nom, téléphone, e-mail) ne passe jamais dans l'URL ni les journaux.
// Réservé à l'« accès supérieur » (code distinct du code de connexion, haché dans SUPER_CODE_HASH) : le code de
// connexion commerçant seul ne donne plus accès aux fiches clients (nom, téléphone, e-mail, adresse).
import { allowMethods, readJsonBody, failValidation, bodyStr, ok } from '../core.js';
import { requireOwner, requireSuperCode } from '../auth.js';
import { all } from '../db.js';
import { customerView } from '../customers.js';
import { cleanSpaces, strChars } from '../util.js';

export default async function ownerCustomers(c) {
  allowMethods(c, ['POST']);
  const b = await readJsonBody(c);
  await requireOwner(c);
  await requireSuperCode(c, bodyStr(b, 'code'));
  // isset() PHP : une valeur null équivaut à une clé absente.
  if (b.q !== undefined && b.q !== null && typeof b.q !== 'string') {
    failValidation({ q: 'Recherche invalide.' });
  }
  const q = cleanSpaces(typeof b.q === 'string' ? b.q : '');
  // Postgres refuse le caractère NUL dans un texte : refus propre (422) plutôt qu'une erreur 500.
  if (q.includes('\0')) {
    failValidation({ q: 'Recherche invalide.' });
  }
  if (strChars(q) > 80) {
    failValidation({ q: 'Recherche trop longue (80 caractères au plus).' });
  }

  let sql = 'SELECT c.*, (SELECT MAX(o.created_at) FROM orders o WHERE o.customer_id = c.id) AS last_order_at FROM customers c';
  let params = [];
  if (q !== '') {
    const like = '%' + q.replace(/[!%_]/g, (m) => '!' + m) + '%';
    // ILIKE : insensible à la casse, comme la collation MySQL / le LIKE SQLite de l'original.
    sql += " WHERE c.first_name ILIKE ? ESCAPE '!' OR c.last_name ILIKE ? ESCAPE '!'"
      + " OR c.phone ILIKE ? ESCAPE '!' OR c.email ILIKE ? ESCAPE '!'";
    params = [like, like, like, like];
  }
  sql += ' ORDER BY c.last_name, c.first_name, c.id LIMIT 500';

  const list = (await all(sql, params)).map((r) => ({
    ...customerView(r),
    created_at: String(r.created_at),
    last_order_at: r.last_order_at === null ? null : String(r.last_order_at)
  }));
  return ok({ customers: list });
}
