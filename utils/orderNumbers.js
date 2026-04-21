import db from "../db.js";

let schemaReady = false;

async function addOrderNumberColumn(tableName) {
  try {
    await db.query(`ALTER TABLE ${tableName} ADD COLUMN order_number BIGINT NULL`);
  } catch (err) {
    if (err?.code !== "ER_DUP_FIELDNAME") {
      throw err;
    }
  }
}

export async function ensureOrderNumberSchema() {
  if (schemaReady) return;

  await db.query(`
    CREATE TABLE IF NOT EXISTS order_number_sequence (
      id TINYINT PRIMARY KEY,
      next_number BIGINT NOT NULL
    )
  `);

  await addOrderNumberColumn("orders");
  await addOrderNumberColumn("wassel_orders");

  const [[row]] = await db.query(`
    SELECT GREATEST(
      COALESCE((SELECT MAX(order_number) FROM orders), 0),
      COALESCE((SELECT MAX(id) FROM orders), 0),
      COALESCE((SELECT MAX(order_number) FROM wassel_orders), 0),
      COALESCE((SELECT MAX(id) FROM wassel_orders), 0)
    ) AS max_number
  `);

  await db.query(
    `
    INSERT IGNORE INTO order_number_sequence (id, next_number)
    VALUES (1, ?)
    `,
    [Number(row?.max_number || 0) + 1]
  );

  schemaReady = true;
}

export async function getNextOrderNumber(conn = db) {
  await ensureOrderNumberSchema();

  await conn.query(`
    UPDATE order_number_sequence
    SET next_number = LAST_INSERT_ID(next_number + 1)
    WHERE id = 1
  `);

  const [[row]] = await conn.query("SELECT LAST_INSERT_ID() AS next_number");
  return Number(row.next_number) - 1;
}

