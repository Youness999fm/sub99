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
-- Une éventuelle table public.commandes d'un schéma précédent n'est pas utilisée par l'API : laissez-la telle quelle.
`;

export const MARQUEUR_CRON = '-- ==== PLANIFICATION (pg_cron) ====';

const purge = `
${MARQUEUR_CRON}
-- Purge quotidienne : chaque heure, à la minute 15, supprime les commandes d'avant aujourd'hui (fuseau Europe/Paris)
-- et leurs lignes, ainsi que les sessions expirées. Les comptes clients ne sont pas touchés.
-- L'extension pg_cron est activée ici si elle ne l'est pas déjà (sinon : Database > Extensions > pg_cron).
create extension if not exists pg_cron with schema pg_catalog;

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
