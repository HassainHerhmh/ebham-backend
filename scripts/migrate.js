import mysql from "mysql2/promise";
import dotenv from "dotenv";

dotenv.config();

// بيانات Railway
const railwayConfig = {
  uri: process.env.MYSQL_PUBLIC_URL, // من Railway
};

// بيانات TiDB Cloud
const tidbConfig = {
  host: "gateway01eu-central-1.prod.aws.tidbcloud.com",
  port: 4000,
  user: "RStp4tXKqGSgE1Troot",
  password: "AZ6gbYW0BcRVAKXu",
  database: "test",
  ssl: { rejectUnauthorized: false },
};

async function migrate() {
  let railwayConn, tidbConn;

  try {
    console.log("📡 Connecting to Railway MySQL...");
    railwayConn = await mysql.createConnection(railwayConfig);

    console.log("📡 Connecting to TiDB Cloud...");
    tidbConn = await mysql.createConnection(tidbConfig);

    // جلب أسماء الجداول
    console.log("📋 Fetching tables...");
    const [tables] = await railwayConn.query("SHOW TABLES");

    for (const tableObj of tables) {
      const tableName = Object.values(tableObj)[0];
      console.log(`\n📦 Migrating: ${tableName}`);

      // 1. جلب بنية الجدول
      const [createResult] = await railwayConn.query(`SHOW CREATE TABLE \`${tableName}\``);
      let createSQL = createResult[0]["Create Table"];

      // 2. إنشاء الجدول في TiDB
      await tidbConn.query(`DROP TABLE IF EXISTS \`${tableName}\``);
      await tidbConn.query(createSQL);
      console.log(`  ✓ Table structure created`);

      // 3. نسخ البيانات
      const [rows] = await railwayConn.query(`SELECT * FROM \`${tableName}\``);

      if (rows.length > 0) {
        // نسخ على دفعات (1000 صف في المرة)
        const batchSize = 1000;
        for (let i = 0; i < rows.length; i += batchSize) {
          const batch = rows.slice(i, i + batchSize);
          
          const columns = Object.keys(batch[0]);
          const placeholders = batch.map(() => 
            `(${columns.map(() => '?').join(', ')})`
          ).join(', ');
          
          const values = batch.flatMap(row => Object.values(row));
          
          await tidbConn.query(
            `INSERT INTO \`${tableName}\` (${columns.map(c => `\`${c}\``).join(', ')}) VALUES ${placeholders}`,
            values
          );
          
          console.log(`  ✓ Inserted ${Math.min(i + batchSize, rows.length)}/${rows.length} rows`);
        }
      } else {
        console.log(`  ℹ No data to migrate`);
      }

      console.log(`✅ ${tableName} completed (${rows.length} rows)`);
    }

    console.log("\n🎉 Migration completed successfully!");
  } catch (error) {
    console.error("\n❌ Migration failed:", error);
    throw error;
  } finally {
    if (railwayConn) await railwayConn.end();
    if (tidbConn) await tidbConn.end();
  }
}

migrate();
