// Génère supabase/001_schema.sql (à coller dans Supabase > SQL Editor) à partir de serveur/schema.js.
// Usage : node serveur/outils/schema-sql.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { schemaSql, PURGE_SQL } from '../schema.js';

const entete = `-- Subito Pizza : tables de l'API (Supabase / Postgres).
-- GÉNÉRÉ par serveur/outils/schema-sql.mjs : ne pas modifier à la main (modifier serveur/schema.js puis régénérer).
--
-- À exécuter UNE fois : Supabase > SQL Editor > New query > coller tout > Run. Sans danger si relancé.
-- Row Level Security est activée sur chaque table, sans aucune politique : seul le serveur
-- (connexion DATABASE_URL) peut lire ou écrire. L'API publique de Supabase n'y a pas accès.
-- La table public.commandes du premier schéma n'est pas utilisée par l'API : laissez-la telle quelle.
`;

const purge = `
-- Purge quotidienne (pg_cron, déjà actif sur le projet) : chaque heure, à la minute 15, supprime les
-- commandes d'avant aujourd'hui (fuseau Europe/Paris) et leurs lignes, ainsi que les sessions expirées.
-- Les comptes clients ne sont pas touchés. La tâche existante « purge-commandes-hors-jour » (table commandes)
-- n'est pas modifiée.
select cron.schedule(
  'purge-orders-hors-jour',
  '15 * * * *',
  $cron$
${PURGE_SQL.map((s) => '  ' + s + ';').join('\n')}
  $cron$
);
`;

const corps = schemaSql().map((s) => s + ';').join('\n\n');
mkdirSync(new URL('../../supabase/', import.meta.url), { recursive: true });
writeFileSync(new URL('../../supabase/001_schema.sql', import.meta.url), entete + '\n' + corps + '\n' + purge);
console.log('supabase/001_schema.sql écrit.');
