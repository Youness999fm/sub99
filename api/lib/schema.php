<?php
// Description unique des tables, et production du DDL par pilote (MySQL ou SQLite).
declare(strict_types=1);

/**
 * Types logiques : pk, int, str:N (VARCHAR), char:N, text.
 * Chaque colonne : [nom, type, nullable].
 */
function schema_tables(): array
{
    $ts = 'char:20'; // 2026-11-19T18:03:12Z
    return [
        'owners' => [
            'columns' => [
                ['id', 'pk', false], ['email', 'str:190', false], ['password_hash', 'str:255', false],
                ['created_at', $ts, false], ['updated_at', $ts, false],
            ],
            'unique' => ['uq_owners_email' => ['email']],
            'index' => [],
            'fk' => [],
        ],
        'customers' => [
            'columns' => [
                ['id', 'pk', false], ['email', 'str:190', false], ['password_hash', 'str:255', false],
                ['first_name', 'str:60', false], ['last_name', 'str:60', false], ['phone', 'str:20', false],
                ['street', 'str:150', true], ['city', 'str:60', true],
                ['created_at', $ts, false], ['updated_at', $ts, false], ['last_login_at', $ts, true],
            ],
            'unique' => ['uq_customers_email' => ['email']],
            'index' => ['ix_customers_name' => ['last_name', 'first_name']],
            'fk' => [],
        ],
        'sessions' => [
            'columns' => [
                ['id', 'pk', false], ['token_hash', 'char:64', false], ['user_type', 'str:10', false],
                ['user_id', 'int', false], ['remember', 'int', false],
                ['created_at', $ts, false], ['last_seen_at', $ts, false], ['expires_at', $ts, false],
                ['revoked_at', $ts, true], ['device', 'str:120', false],
            ],
            'unique' => ['uq_sessions_token' => ['token_hash']],
            'index' => ['ix_sessions_user' => ['user_type', 'user_id']],
            'fk' => [],
        ],
        'orders' => [
            'columns' => [
                ['id', 'pk', false], ['customer_id', 'int', false], ['idempotency_key', 'str:64', false],
                ['payload_hash', 'char:64', false], ['status', 'str:10', false], ['mode', 'str:10', false],
                ['customer_first_name', 'str:60', false], ['customer_last_name', 'str:60', false],
                ['customer_phone', 'str:20', false], ['customer_email', 'str:190', false],
                ['delivery_street', 'str:150', true], ['delivery_city', 'str:60', true],
                ['payment_methods', 'text', false], ['cash_change_for', 'int', true],
                ['products_cents', 'int', false], ['promo_cents', 'int', false],
                ['delivery_fee_cents', 'int', false], ['total_cents', 'int', false],
                ['delay_minutes', 'int', true],
                ['created_at', $ts, false], ['accepted_at', $ts, true], ['refused_at', $ts, true],
                ['service_day', 'char:10', false],
            ],
            'unique' => ['uq_orders_idem' => ['customer_id', 'idempotency_key']],
            'index' => [
                'ix_orders_day' => ['service_day'],
                'ix_orders_status' => ['status'],
                'ix_orders_customer' => ['customer_id', 'created_at'],
            ],
            'fk' => [['customer_id', 'customers', 'id']],
        ],
        'order_items' => [
            'columns' => [
                ['id', 'pk', false], ['order_id', 'int', false], ['position', 'int', false],
                ['name', 'str:160', false], ['variant', 'str:20', false], ['qty', 'int', false],
                ['unit_price_cents', 'int', false], ['line_total_cents', 'int', false],
                ['removed_json', 'text', false], ['extras_json', 'text', false], ['half_json', 'text', true],
                ['note', 'str:300', false],
            ],
            'unique' => [],
            'index' => ['ix_items_order' => ['order_id']],
            'fk' => [['order_id', 'orders', 'id']],
        ],
        'availability' => [
            'columns' => [
                ['id', 'pk', false], ['kind', 'str:20', false], ['name', 'str:190', false],
                ['status', 'str:20', false], ['service_day', 'char:10', true], ['updated_at', $ts, false],
            ],
            'unique' => ['uq_availability' => ['kind', 'name']],
            'index' => [],
            'fk' => [],
        ],
        'settings' => [
            'columns' => [['skey', 'str:64', false], ['svalue', 'str:255', false]],
            'primary' => 'skey',
            'unique' => [],
            'index' => [],
            'fk' => [],
        ],
        'throttle' => [
            'columns' => [
                ['id', 'pk', false], ['bucket', 'str:190', false], ['attempts', 'int', false],
                ['window_start', 'int', false], ['locked_until', 'int', true],
            ],
            'unique' => ['uq_throttle_bucket' => ['bucket']],
            'index' => [],
            'fk' => [],
        ],
    ];
}

function schema_column_sql(string $driver, array $col, ?string $primary): string
{
    [$name, $type, $nullable] = $col;
    if ($type === 'pk') {
        return $driver === 'mysql'
            ? "`$name` INT NOT NULL AUTO_INCREMENT PRIMARY KEY"
            : "\"$name\" INTEGER PRIMARY KEY AUTOINCREMENT";
    }
    $q = $driver === 'mysql' ? "`$name`" : "\"$name\"";
    if ($type === 'int') {
        $sql = $driver === 'mysql' ? 'INT' : 'INTEGER';
    } elseif ($type === 'text') {
        $sql = 'TEXT';
    } elseif (strpos($type, 'str:') === 0) {
        $sql = 'VARCHAR(' . (int) substr($type, 4) . ')';
    } elseif (strpos($type, 'char:') === 0) {
        $sql = 'CHAR(' . (int) substr($type, 5) . ')';
    } else {
        throw new LogicException('Type inconnu');
    }
    $sql = $q . ' ' . $sql . ($nullable ? ' NULL' : ' NOT NULL');
    if ($primary === $name) {
        $sql .= ' PRIMARY KEY';
    }
    return $sql;
}

/** @return string[] liste d'ordres SQL (idempotents) */
function schema_sql(string $driver): array
{
    if ($driver !== 'mysql' && $driver !== 'sqlite') {
        throw new LogicException('Pilote non pris en charge');
    }
    $quote = function (string $n) use ($driver): string {
        return $driver === 'mysql' ? "`$n`" : "\"$n\"";
    };
    $out = [];
    foreach (schema_tables() as $table => $def) {
        $lines = [];
        foreach ($def['columns'] as $col) {
            $lines[] = schema_column_sql($driver, $col, $def['primary'] ?? null);
        }
        foreach ($def['unique'] as $iname => $cols) {
            $lines[] = 'CONSTRAINT ' . $quote($iname) . ' UNIQUE (' . implode(', ', array_map($quote, $cols)) . ')';
        }
        foreach ($def['fk'] as [$col, $refTable, $refCol]) {
            $lines[] = 'FOREIGN KEY (' . $quote($col) . ') REFERENCES ' . $quote($refTable) . ' (' . $quote($refCol) . ') ON DELETE RESTRICT ON UPDATE RESTRICT';
        }
        if ($driver === 'mysql') {
            foreach ($def['index'] as $iname => $cols) {
                $lines[] = 'KEY ' . $quote($iname) . ' (' . implode(', ', array_map($quote, $cols)) . ')';
            }
        }
        $sql = 'CREATE TABLE IF NOT EXISTS ' . $quote($table) . " (\n  " . implode(",\n  ", $lines) . "\n)";
        if ($driver === 'mysql') {
            $sql .= ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC';
        }
        $out[] = $sql;
        if ($driver === 'sqlite') {
            foreach ($def['index'] as $iname => $cols) {
                $out[] = 'CREATE INDEX IF NOT EXISTS ' . $quote($iname) . ' ON ' . $quote($table) . ' (' . implode(', ', array_map($quote, $cols)) . ')';
            }
        }
    }
    return $out;
}
