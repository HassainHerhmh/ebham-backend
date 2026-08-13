import db from "../db.js";

const TABLES = [
  `CREATE TABLE IF NOT EXISTS \`financial_statements\` (
    \`id\` INT NOT NULL AUTO_INCREMENT,
    \`name\` VARCHAR(255) NOT NULL,
    PRIMARY KEY (\`id\`)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
];

const COLUMNS = [
  ["users", "language", "VARCHAR(10) NULL DEFAULT 'ar'"],
  ["customers", "language", "VARCHAR(10) NULL DEFAULT 'ar'"],
  ["customers", "neighborhood_id", "INT NULL"],
  ["customers", "fcm_token", "VARCHAR(500) NULL"],
  ["customer_addresses", "gps_link", "VARCHAR(500) NULL"],
  ["accounts", "code", "VARCHAR(50) NULL"],
  ["accounts", "financial_statement_id", "INT NULL"],
  ["accounts", "branch_id", "INT NULL"],
  ["accounts", "created_by", "INT NULL"],
  ["accounts", "created_at", "DATETIME NULL DEFAULT CURRENT_TIMESTAMP"],
  ["accounts", "is_active", "TINYINT(1) NOT NULL DEFAULT 1"],
  ["account_groups", "branch_id", "INT NULL"],
  ["account_groups", "created_by", "INT NULL"],
  ["account_groups", "created_at", "DATETIME NULL DEFAULT CURRENT_TIMESTAMP"],
  ["currencies", "name_en", "VARCHAR(255) NULL"],
  ["currencies", "is_active", "TINYINT(1) NOT NULL DEFAULT 1"],
  ["currencies", "branch_id", "INT NULL"],
  ["currencies", "convert_mode", "VARCHAR(10) NULL DEFAULT '*'"],
  ["journal_types", "code", "VARCHAR(50) NULL"],
  ["journal_types", "branch_id", "INT NULL"],
  ["receipt_types", "code", "VARCHAR(50) NULL"],
  ["receipt_types", "branch_id", "INT NULL"],
  ["payment_types", "code", "VARCHAR(50) NULL"],
  ["payment_types", "branch_id", "INT NULL"],
  ["banks", "name_ar", "VARCHAR(255) NULL"],
  ["banks", "parent_account_id", "INT NULL"],
  ["receipt_vouchers", "voucher_no", "BIGINT NULL"],
  ["receipt_vouchers", "voucher_date", "DATE NULL"],
  ["receipt_vouchers", "receipt_type", "INT NULL"],
  ["receipt_vouchers", "cash_box_account_id", "INT NULL"],
  ["receipt_vouchers", "bank_account_id", "INT NULL"],
  ["receipt_vouchers", "transfer_no", "VARCHAR(100) NULL"],
  ["receipt_vouchers", "currency_id", "INT NULL"],
  ["receipt_vouchers", "amount", "DECIMAL(18,2) NULL DEFAULT 0"],
  ["receipt_vouchers", "account_id", "INT NULL"],
  ["receipt_vouchers", "analytic_account_id", "INT NULL"],
  ["receipt_vouchers", "cost_center_id", "INT NULL"],
  ["receipt_vouchers", "journal_type_id", "INT NULL"],
  ["receipt_vouchers", "notes", "TEXT NULL"],
  ["receipt_vouchers", "handling", "VARCHAR(50) NULL"],
  ["receipt_vouchers", "created_by", "INT NULL"],
  ["receipt_vouchers", "branch_id", "INT NULL"],
  ["payment_vouchers", "voucher_no", "BIGINT NULL"],
  ["payment_vouchers", "voucher_date", "DATE NULL"],
  ["payment_vouchers", "branch_id", "INT NULL"],
  ["orders", "processing_at", "DATETIME NULL"],
  ["orders", "ready_at", "DATETIME NULL"],
  ["orders", "delivering_at", "DATETIME NULL"],
  ["orders", "completed_at", "DATETIME NULL"],
  ["orders", "cancelled_at", "DATETIME NULL"],
  ["wassel_orders", "is_manual", "TINYINT(1) NOT NULL DEFAULT 0"],
  ["wassel_orders", "restaurant_id", "INT NULL"],
  ["wassel_orders", "total_amount", "DECIMAL(12,2) NULL DEFAULT 0"],
  ["wassel_orders", "notes", "TEXT NULL"],
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
  for (const sql of TABLES) {
    try {
      await db.query(sql);
    } catch (err) {
      console.error("❌ Schema table:", err?.message || err);
    }
  }

  try {
    await db.query(`
      INSERT IGNORE INTO financial_statements (id, name)
      VALUES (1, 'الميزانية العمومية'), (2, 'أرباح وخسائر')
    `);
  } catch (err) {
    console.error("❌ Schema financial_statements seed:", err?.message || err);
  }

  try {
    await db.query(`
      UPDATE currencies
      SET is_active = 1, branch_id = COALESCE(branch_id, 1)
      WHERE is_active IS NULL OR is_active = 0 OR branch_id IS NULL
    `);
  } catch {
    // column may not exist yet; added below then ignored next boot
  }

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

  try {
    await db.query(`
      UPDATE currencies
      SET is_active = 1, branch_id = COALESCE(branch_id, 1)
      WHERE branch_id IS NULL OR is_active = 0
    `);
  } catch {
    // ignore
  }

  console.log(`✅ Schema check complete (${added} columns added)`);
}
