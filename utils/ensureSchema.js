import db from "../db.js";

const COLUMNS = [
  ["users", "language", "VARCHAR(10) NULL DEFAULT 'ar'"],
  ["customers", "language", "VARCHAR(10) NULL DEFAULT 'ar'"],
  ["customers", "neighborhood_id", "INT NULL"],
  ["customers", "fcm_token", "VARCHAR(500) NULL"],
  ["accounts", "code", "VARCHAR(50) NULL"],
  ["accounts", "financial_statement_id", "INT NULL"],
  ["orders", "processing_at", "DATETIME NULL"],
  ["orders", "ready_at", "DATETIME NULL"],
  ["orders", "delivering_at", "DATETIME NULL"],
  ["orders", "completed_at", "DATETIME NULL"],
  ["orders", "cancelled_at", "DATETIME NULL"],
  ["wassel_orders", "is_manual", "TINYINT(1) NOT NULL DEFAULT 0"],
  ["wassel_orders", "from_address", "VARCHAR(500) NULL"],
  ["wassel_orders", "to_address", "VARCHAR(500) NULL"],
  ["wassel_orders", "from_lat", "DECIMAL(10,7) NULL"],
  ["wassel_orders", "from_lng", "DECIMAL(10,7) NULL"],
  ["wassel_orders", "to_lat", "DECIMAL(10,7) NULL"],
  ["wassel_orders", "to_lng", "DECIMAL(10,7) NULL"],
  ["wassel_orders", "bank_id", "INT NULL"],
  ["wassel_orders", "scheduled_at", "DATETIME NULL"],
  ["wassel_orders", "processing_at", "DATETIME NULL"],
  ["wassel_orders", "ready_at", "DATETIME NULL"],
  ["wassel_orders", "delivering_at", "DATETIME NULL"],
  ["wassel_orders", "completed_at", "DATETIME NULL"],
  ["wassel_orders", "cancelled_at", "DATETIME NULL"],
  ["support_chats", "customer_name", "VARCHAR(255) NULL"],
  ["support_chats", "customer_phone", "VARCHAR(50) NULL"],
  ["support_chats", "branch_id", "INT NULL"],
  ["support_chats", "order_id", "INT NULL"],
  ["support_chats", "last_message_at", "DATETIME NULL"],
  ["support_chats", "updated_at", "DATETIME NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP"],
  ["support_chat_messages", "sender_id", "INT NULL"],
  ["support_chat_messages", "is_read", "TINYINT(1) NOT NULL DEFAULT 0"],
  ["commissions", "commission_type", "VARCHAR(50) NULL"],
  ["commissions", "commission_value", "DECIMAL(12,2) NULL DEFAULT 0"],
  ["commissions", "branch_id", "INT NULL"],
  ["commissions", "contract_start", "DATE NULL"],
  ["commissions", "contract_end", "DATE NULL"],
];

async function columnExists(table, column) {
  const [rows] = await db.query(
    `
    SELECT COUNT(*) AS count
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = ?
      AND COLUMN_NAME = ?
    `,
    [table, column]
  );
  return Number(rows?.[0]?.count || 0) > 0;
}

async function addColumn(table, column, definition) {
  if (await columnExists(table, column)) return false;
  await db.query(
    `ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`
  );
  console.log(`✅ Schema added ${table}.${column}`);
  return true;
}

export async function ensureSchema() {
  let added = 0;
  for (const [table, column, definition] of COLUMNS) {
    try {
      if (await addColumn(table, column, definition)) added += 1;
    } catch (err) {
      console.error(
        `❌ Schema ${table}.${column}:`,
        err?.message || err
      );
    }
  }
  console.log(`✅ Schema check complete (${added} columns added)`);
}
