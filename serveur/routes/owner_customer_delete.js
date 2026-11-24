// POST owner_customer_delete {"id": ..., "code": "..."} — suppression d'un client (demande du 24/11/2026),
// réservée à l'accès supérieur. Un client qui n'a JAMAIS passé commande est supprimé pour de bon. Un client
// qui a déjà commandé ne peut techniquement pas être effacé (orders.customer_id, ON DELETE RESTRICT, voir
// serveur/schema.js) : ses commandes gardent déjà leur propre copie du nom/téléphone/adresse (prises au
// moment de la commande, voir order_create.js), donc leur historique reste intact même sans la fiche
// client — on anonymise à la place (nom/e-mail/téléphone/adresse effacés, mot de passe invalidé, sessions
// actives révoquées) : le client ne peut plus se reconnecter ni être retrouvé par recherche, sans jamais
// casser une commande déjà passée.
import bcrypt from 'bcryptjs';
import { allowMethods, readJsonBody, bodyStr, failValidation, fail, ok } from '../core.js';
import { requireOwner, requireSuperCode } from '../auth.js';
import { one, exec } from '../db.js';
import { nowUtc, entreeBcrypt } from '../util.js';

export default async function ownerCustomerDelete(c) {
  allowMethods(c, ['POST']);
  const b = await readJsonBody(c);
  await requireOwner(c);
  await requireSuperCode(c, bodyStr(b, 'code'));

  const id = Number(b.id);
  if (!Number.isInteger(id) || id < 1) failValidation({ id: 'Client invalide.' });

  const client = await one('SELECT id FROM customers WHERE id = ?', [id]);
  if (client === null) fail(404, 'not_found', 'Client introuvable.');

  const aCommande = await one('SELECT 1 AS x FROM orders WHERE customer_id = ? LIMIT 1', [id]);
  const now = nowUtc();

  if (aCommande === null) {
    await exec('DELETE FROM sessions WHERE user_type = ? AND user_id = ?', ['customer', id]);
    await exec('DELETE FROM customers WHERE id = ?', [id]);
    return ok({ deleted: true, anonymized: false });
  }

  // Anonymisation : e-mail unique mais sans valeur (jamais réutilisable par un vrai client), mot de passe
  // aléatoire inconnu de tous (le compte ne peut plus jamais se reconnecter).
  const emailAnonyme = 'client-supprime-' + id + '-' + Date.now().toString(36) + '@supprime.invalid';
  const motDePasseAleatoire = await bcrypt.hash(entreeBcrypt(newRandomToken()), 10);
  await exec(
    `UPDATE customers SET first_name = ?, last_name = ?, email = ?, phone = ?, password_hash = ?,
        street = NULL, city = NULL, housing_type = NULL, updated_at = ? WHERE id = ?`,
    ['Client', 'supprimé', emailAnonyme, '0000000000', motDePasseAleatoire, now, id]
  );
  await exec('UPDATE sessions SET revoked_at = ? WHERE user_type = ? AND user_id = ? AND revoked_at IS NULL', [now, 'customer', id]);

  return ok({ deleted: true, anonymized: true });
}

function newRandomToken() {
  // Pas besoin de cryptographiquement fort ici (juste un mot de passe qui ne doit plus jamais être deviné
  // ni utilisé) : Math.random() suffit, on n'en fait rien d'autre que le hacher et l'oublier.
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}
