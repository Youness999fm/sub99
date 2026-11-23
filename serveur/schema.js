// Description des tables (port de api/lib/schema.php) et production du DDL Postgres.
// Le commerçant n'a plus de table owners : il se connecte avec un code patron (OWNER_CODE_HASH).
// Dates : texte UTC « 2026-11-19T18:03:12Z », comme avant (comparaison lexicographique valide).

const TS = 'char:20';

export const TABLES = {
  customers: {
    columns: [
      ['id', 'pk', false], ['email', 'str:190', false], ['password_hash', 'str:255', false],
      ['first_name', 'str:60', false], ['last_name', 'str:60', false], ['phone', 'str:20', false],
      ['street', 'str:150', true], ['city', 'str:60', true], ['housing_type', 'str:20', true],
      ['created_at', TS, false], ['updated_at', TS, false], ['last_login_at', TS, true]
    ],
    unique: { uq_customers_email: ['email'] },
    index: { ix_customers_name: ['last_name', 'first_name'] },
    fk: []
  },
  sessions: {
    columns: [
      ['id', 'pk', false], ['token_hash', 'char:64', false], ['user_type', 'str:10', false],
      ['user_id', 'int', false], ['remember', 'int', false],
      ['created_at', TS, false], ['last_seen_at', TS, false], ['expires_at', TS, false],
      ['revoked_at', TS, true], ['device', 'str:120', false]
    ],
    unique: { uq_sessions_token: ['token_hash'] },
    index: { ix_sessions_user: ['user_type', 'user_id'] },
    fk: []
  },
  orders: {
    columns: [
      ['id', 'pk', false], ['customer_id', 'int', false], ['idempotency_key', 'str:64', false],
      ['payload_hash', 'char:64', false], ['status', 'str:10', false], ['mode', 'str:10', false],
      ['customer_first_name', 'str:60', false], ['customer_last_name', 'str:60', false],
      ['customer_phone', 'str:20', false], ['customer_email', 'str:190', false],
      ['delivery_street', 'str:150', true], ['delivery_city', 'str:60', true], ['delivery_housing_type', 'str:20', true],
      ['payment_methods', 'text', false], ['cash_change_for', 'int', true],
      // Sauce piquante (livraison uniquement) : NULL pour un retrait, 0/1 sinon (SBT-009).
      ['hot_sauce', 'int', true],
      ['products_cents', 'int', false], ['promo_cents', 'int', false],
      ['delivery_fee_cents', 'int', false], ['total_cents', 'int', false],
      ['delay_minutes', 'int', true],
      ['created_at', TS, false], ['accepted_at', TS, true], ['refused_at', TS, true],
      ['prepared_at', TS, true],
      ['service_day', 'char:10', false],
      // Commande planifiée (type Uber Eats) : heure voulue par le client, NULL = dès que possible.
      ['scheduled_for', TS, true],
      // Annulation client (fenêtre 4 min depuis created_at, voir order_cancel.js) : directe depuis le
      // 23/11/2026 (revient sur la décision du 22/11/2026, qui faisait attendre une validation du
      // commerçant sans garantie qu'elle arrive). cancel_requested_at n'est plus écrit ; colonne gardée
      // (inoffensive, nullable) plutôt qu'une migration de suppression.
      ['cancel_requested_at', TS, true],
      ['cancelled_at', TS, true], ['cancel_reason', 'str:200', true],
      // Suppression côté commerçant (corbeille, voir owner_order_delete.js) : jamais un vrai DELETE SQL —
      // la commande reste en base (preuve/recette), seulement cachée de la file tant que non restaurée.
      ['deleted_at', TS, true]
    ],
    unique: { uq_orders_idem: ['customer_id', 'idempotency_key'] },
    index: {
      ix_orders_day: ['service_day'], ix_orders_status: ['status'], ix_orders_customer: ['customer_id', 'created_at'],
      ix_orders_scheduled: ['scheduled_for']
    },
    fk: [['customer_id', 'customers', 'id']]
  },
  order_items: {
    columns: [
      ['id', 'pk', false], ['order_id', 'int', false], ['position', 'int', false],
      ['name', 'str:160', false], ['variant', 'str:20', false], ['qty', 'int', false],
      ['unit_price_cents', 'int', false], ['line_total_cents', 'int', false],
      ['removed_json', 'text', false], ['extras_json', 'text', false], ['half_json', 'text', true],
      ['note', 'str:300', false],
      // Catégorie du catalogue au moment de la commande (pizzas, tex-mex, desserts, boissons…) : sert
      // uniquement à organiser le ticket (SBT-006/008) — jamais au calcul des prix ni des promotions.
      ['category', 'str:20', true]
    ],
    unique: {},
    index: { ix_items_order: ['order_id'] },
    fk: [['order_id', 'orders', 'id']]
  },
  availability: {
    columns: [
      ['id', 'pk', false], ['kind', 'str:20', false], ['name', 'str:190', false],
      ['status', 'str:20', false], ['service_day', 'char:10', true], ['updated_at', TS, false]
    ],
    unique: { uq_availability: ['kind', 'name'] },
    index: {},
    fk: []
  },
  settings: {
    columns: [['skey', 'str:64', false], ['svalue', 'str:255', false]],
    primary: 'skey',
    unique: {},
    index: {},
    fk: []
  },
  throttle: {
    columns: [
      ['id', 'pk', false], ['bucket', 'str:190', false], ['attempts', 'int', false],
      ['window_start', 'bigint', false], ['locked_until', 'bigint', true]
    ],
    unique: { uq_throttle_bucket: ['bucket'] },
    index: {},
    fk: []
  },
  // Impression de préparation H-45 des commandes planifiées (SBT-005) : une ligne par commande acceptée avec
  // scheduled_for. print_due_at = scheduled_for - 45 min. status : pending (en attente de l'heure) ->
  // claimed (un appareil l'a prise, impression en cours) -> dispatched (octets remis avec succès à l'appli
  // Android — jamais une preuve d'impression physique, voir I12) | failed (abandon après plusieurs essais) |
  // unknown (résultat jamais revenu, ex. appareil éteint en plein envoi). claimed trop ancien -> reclassé
  // pending par le serveur (voir impression.js), jamais bloqué indéfiniment.
  print_jobs: {
    columns: [
      ['id', 'pk', false], ['order_id', 'int', false],
      ['print_due_at', TS, false], ['status', 'str:10', false],
      ['claimed_at', TS, true], ['claimed_by', 'str:120', true],
      ['dispatched_at', TS, true], ['attempts', 'int', false],
      ['last_error', 'str:300', true],
      ['created_at', TS, false], ['updated_at', TS, false]
    ],
    unique: { uq_print_jobs_order: ['order_id'] },
    index: { ix_print_jobs_due: ['status', 'print_due_at'] },
    fk: [['order_id', 'orders', 'id']]
  },
  // Ajout, modification ou annulation rattaché à une commande existante (jamais une nouvelle commande
  // indépendante). order_items reste immuable : l'état « après modification » d'un article se recalcule
  // en repliant l'article d'origine (ou l'article déjà ajouté par un addenda précédent) + le dernier
  // order_addenda kind='modify' qui le cible, par ordre de seq (voir effectiveOrderLines(), orders.js).
  // kind : 'add' (nouveaux articles, aucune cible) | 'modify' (cible target_item_id OU
  // target_addendum_item_id, jamais les deux) | 'cancel' (annulation tardive, aucune cible, voir
  // order_cancel.js). target_addendum_item_id n'est PAS une clé étrangère déclarée : order_addendum_items
  // référence déjà order_addenda (addendum_id) et une référence circulaire entre les deux tables n'est pas
  // prise en charge par schemaSql() (CREATE TABLE unique, sans ALTER différé) — vérifié en application.
  order_addenda: {
    columns: [
      ['id', 'pk', false], ['order_id', 'int', false], ['seq', 'int', false],
      ['kind', 'str:20', false], ['idempotency_key', 'str:64', false], ['payload_hash', 'char:64', false],
      ['target_item_id', 'int', true], ['target_addendum_item_id', 'int', true], ['delta_cents', 'int', false],
      ['customer_first_name', 'str:60', false], ['created_at', TS, false]
    ],
    unique: { uq_order_addenda_idem: ['order_id', 'idempotency_key'], uq_order_addenda_seq: ['order_id', 'seq'] },
    index: { ix_order_addenda_order: ['order_id', 'seq'] },
    fk: [['order_id', 'orders', 'id'], ['target_item_id', 'order_items', 'id']]
  },
  // Contenu d'un order_addenda : pour kind='add', un article neuf par ligne ; pour kind='modify', l'état
  // COMPLET après modification de l'article ciblé (jamais seulement un delta — le delta à imprimer sur le
  // ticket se calcule par différence avec l'état précédent au moment du rendu, voir impression.js/tâche 6).
  order_addendum_items: {
    columns: [
      ['id', 'pk', false], ['addendum_id', 'int', false], ['position', 'int', false],
      ['name', 'str:160', false], ['variant', 'str:20', false], ['qty', 'int', false],
      ['unit_price_cents', 'int', false], ['line_total_cents', 'int', false],
      ['removed_json', 'text', false], ['extras_json', 'text', false], ['half_json', 'text', true],
      ['note', 'str:300', false], ['category', 'str:20', true]
    ],
    unique: {},
    index: { ix_addendum_items_addendum: ['addendum_id'] },
    fk: [['addendum_id', 'order_addenda', 'id']]
  },
  // Queue d'impression du ticket complémentaire : même cycle de vie que print_jobs (pending -> claimed ->
  // dispatched | failed | unknown), mais clé unique sur addendum_id (une commande peut avoir plusieurs
  // ajouts) et sans print_due_at : un ticket d'ajout est dû immédiatement, jamais un délai H-45.
  addendum_print_jobs: {
    columns: [
      ['id', 'pk', false], ['addendum_id', 'int', false],
      ['status', 'str:10', false],
      ['claimed_at', TS, true], ['claimed_by', 'str:120', true],
      ['dispatched_at', TS, true], ['attempts', 'int', false],
      ['last_error', 'str:300', true],
      ['created_at', TS, false], ['updated_at', TS, false]
    ],
    unique: { uq_addendum_print_jobs_addendum: ['addendum_id'] },
    index: { ix_addendum_print_jobs_status: ['status'] },
    fk: [['addendum_id', 'order_addenda', 'id']]
  }
};

function colonne([nom, type, nullable], primary) {
  const q = '"' + nom + '"';
  if (type === 'pk') return q + ' INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY';
  let sql;
  if (type === 'int') sql = 'INTEGER';
  else if (type === 'bigint') sql = 'BIGINT';
  else if (type === 'text') sql = 'TEXT';
  else if (type.startsWith('str:')) sql = 'VARCHAR(' + Number(type.slice(4)) + ')';
  else if (type.startsWith('char:')) sql = 'CHAR(' + Number(type.slice(5)) + ')';
  else throw new Error('Type inconnu : ' + type);
  sql = q + ' ' + sql + (nullable ? ' NULL' : ' NOT NULL');
  if (primary === nom) sql += ' PRIMARY KEY';
  return sql;
}

const quote = (n) => '"' + n + '"';

/** Minuit parisien du jour courant, au format texte UTC des colonnes (2026-11-19T23:00:00Z). */
export const COUPURE_JOUR_SQL = `to_char((date_trunc('day', now() at time zone 'Europe/Paris') at time zone 'Europe/Paris') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`;

/**
 * Purge quotidienne : commandes (et leurs lignes) d'avant aujourd'hui (fuseau Europe/Paris) et sessions expirées.
 * Planifiée par pg_cron (supabase/001_schema.sql) ; les clients et leurs comptes ne sont pas touchés.
 */
export const PURGE_SQL = [
  `DELETE FROM public.order_addendum_items WHERE addendum_id IN (SELECT id FROM public.order_addenda WHERE order_id IN (SELECT id FROM public.orders WHERE created_at < ${COUPURE_JOUR_SQL}))`,
  `DELETE FROM public.addendum_print_jobs WHERE addendum_id IN (SELECT id FROM public.order_addenda WHERE order_id IN (SELECT id FROM public.orders WHERE created_at < ${COUPURE_JOUR_SQL}))`,
  `DELETE FROM public.order_addenda WHERE order_id IN (SELECT id FROM public.orders WHERE created_at < ${COUPURE_JOUR_SQL})`,
  `DELETE FROM public.order_items WHERE order_id IN (SELECT id FROM public.orders WHERE created_at < ${COUPURE_JOUR_SQL})`,
  `DELETE FROM public.print_jobs WHERE order_id IN (SELECT id FROM public.orders WHERE created_at < ${COUPURE_JOUR_SQL})`,
  `DELETE FROM public.orders WHERE created_at < ${COUPURE_JOUR_SQL}`,
  `DELETE FROM public.sessions WHERE expires_at < to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`
];

/** Ordres SQL idempotents : tables, index, Row Level Security activée (aucune politique : seul le serveur y accède). */
export function schemaSql() {
  const sortie = [];
  for (const [table, def] of Object.entries(TABLES)) {
    const lignes = def.columns.map((col) => colonne(col, def.primary));
    for (const [nom, cols] of Object.entries(def.unique)) {
      lignes.push('CONSTRAINT ' + quote(nom) + ' UNIQUE (' + cols.map(quote).join(', ') + ')');
    }
    for (const [col, refTable, refCol] of def.fk) {
      lignes.push('FOREIGN KEY (' + quote(col) + ') REFERENCES ' + quote(refTable) + ' (' + quote(refCol) + ') ON DELETE RESTRICT ON UPDATE RESTRICT');
    }
    sortie.push('CREATE TABLE IF NOT EXISTS ' + quote(table) + ' (\n  ' + lignes.join(',\n  ') + '\n)');
    // Colonne ajoutée après coup (table déjà créée en prod) : idempotent, sans la clé primaire
    // (déjà posée à la création, jamais rejouée ici) ; no-op sur une table toute neuve qui l'a déjà.
    for (const col of def.columns) {
      if (col[1] === 'pk' || col[0] === def.primary) continue;
      sortie.push('ALTER TABLE ' + quote(table) + ' ADD COLUMN IF NOT EXISTS ' + colonne(col, undefined));
    }
    for (const [nom, cols] of Object.entries(def.index)) {
      sortie.push('CREATE INDEX IF NOT EXISTS ' + quote(nom) + ' ON ' + quote(table) + ' (' + cols.map(quote).join(', ') + ')');
    }
    sortie.push('ALTER TABLE ' + quote(table) + ' ENABLE ROW LEVEL SECURITY');
  }
  sortie.push("INSERT INTO settings (skey, svalue) VALUES ('default_delay_minutes', '30') ON CONFLICT (skey) DO NOTHING");
  return sortie;
}
