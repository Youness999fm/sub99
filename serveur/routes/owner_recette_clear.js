// POST owner_recette_clear {"code": "..."} — remise à neuf de fin de journée (décision du 24/11/2026) :
// supprime DÉFINITIVEMENT TOUTES les commandes déjà décidées du jour de service courant (acceptées,
// prêtes, refusées OU annulées) et tout ce qui s'y rattache (lignes, ajouts/annulations, tickets
// complémentaires, tâche d'impression planifiée). Irréversible, réservé au code supérieur : une fois
// supprimées, elles ne réapparaissent nulle part (aucun appareil, aucun rechargement) — tout l'espace
// commerçant repart à neuf pour le jour suivant, comme demandé ("chaque jour, les commandes s'effacent").
// Les commandes encore NOUVELLES (pas encore décidées, ex. une commande programmée plus tard ce jour-là
// ou un jour suivant) ne sont jamais concernées : il reste du travail dessus, les supprimer les perdrait.
//
// Pourquoi une suppression définitive est sans risque ici (ni technique, ni légal) : voir le commentaire
// détaillé au-dessus de PURGE_SQL dans serveur/schema.js (même raisonnement, en version manuelle/immédiate
// plutôt qu'automatique/quotidienne) — en résumé : ce site ne stocke pas de paiement (encaissement), c'est
// un outil de prise de commande ; la trace légale de chaque vente est la caisse physique du commerçant.
import { allowMethods, readJsonBody, bodyStr, ok } from '../core.js';
import { requireOwner, requireSuperCode } from '../auth.js';
import { transaction } from '../db.js';
import { serviceDay } from '../util.js';

export default async function ownerRecetteClear(c) {
  allowMethods(c, ['POST']);
  const b = await readJsonBody(c);
  await requireOwner(c);
  await requireSuperCode(c, bodyStr(b, 'code'));

  const day = serviceDay();
  const deleted = await transaction(async ({ all, exec }) => {
    const rows = await all(
      "SELECT id FROM orders WHERE service_day = ? AND status IN ('accepted', 'ready', 'refused', 'cancelled')",
      [day]
    );
    const ids = rows.map((r) => Number(r.id));
    if (ids.length === 0) return 0;
    const placeholders = ids.map(() => '?').join(',');
    // Enfants avant parents (mêmes contraintes FK ON DELETE RESTRICT que PURGE_SQL, serveur/schema.js).
    await exec(`DELETE FROM order_addendum_items WHERE addendum_id IN (SELECT id FROM order_addenda WHERE order_id IN (${placeholders}))`, ids);
    await exec(`DELETE FROM addendum_print_jobs WHERE addendum_id IN (SELECT id FROM order_addenda WHERE order_id IN (${placeholders}))`, ids);
    await exec(`DELETE FROM order_addenda WHERE order_id IN (${placeholders})`, ids);
    await exec(`DELETE FROM print_jobs WHERE order_id IN (${placeholders})`, ids);
    await exec(`DELETE FROM order_items WHERE order_id IN (${placeholders})`, ids);
    return exec(`DELETE FROM orders WHERE id IN (${placeholders})`, ids);
  });

  return ok({ deleted });
}
