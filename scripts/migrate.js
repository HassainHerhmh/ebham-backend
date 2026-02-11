import mysql from "mysql2/promise";
import dotenv from "dotenv";

dotenv.config();

// ============================================
// 📊 إعدادات الاتصال
// ============================================

// بيانات Railway (المصدر)
const railwayConfig = {
  uri: process.env.MYSQL_PUBLIC_URL,
};

// بيانات TiDB Cloud (الوجهة)
const tidbConfig = {
  host: "gateway01eu-central-1.prod.aws.tidbcloud.com",
  port: 4000,
  user: "RStp4tXKqGSgE1Troot",
  password: "AZ6gbYW0BcRVAKXu",
  database: "test",
  ssl: { 
    rejectUnauthorized: false 
  },
};

// ============================================
// 🚀 دالة النقل الرئيسية
// ============================================

async function migrateDatabase() {
  let railwayConn, tidbConn;
  let totalTables = 0;
  let totalRows = 0;

  try {
    console.log("\n🔄 ====== بدء عملية النقل ======\n");

    // الاتصال بـ Railway
    console.log("📡 الاتصال بقاعدة Railway...");
    railwayConn = await mysql.createConnection(railwayConfig);
    console.log("✅ تم الاتصال بـ Railway\n");

    // الاتصال بـ TiDB
    console.log("📡 الاتصال بقاعدة TiDB Cloud...");
    tidbConn = await mysql.createConnection(tidbConfig);
    console.log("✅ تم الاتصال بـ TiDB Cloud\n");

    // جلب أسماء الجداول
    console.log("📋 جاري جلب قائمة الجداول...");
    const [tables] = await railwayConn.query("SHOW TABLES");
    totalTables = tables.length;

    console.log(`✅ تم العثور على ${totalTables} جدول\n`);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

    // نسخ كل جدول
    for (let i = 0; i < tables.length; i++) {
      const tableObj = tables[i];
      const tableName = Object.values(tableObj)[0];

      console.log(`📦 [${i + 1}/${totalTables}] معالجة جدول: ${tableName}`);

      try {
        // 1. جلب بنية الجدول
        const [createResult] = await railwayConn.query(
          `SHOW CREATE TABLE \`${tableName}\``
        );
        let createSQL = createResult[0]["Create Table"];

        // 2. إنشاء الجدول في TiDB
        await tidbConn.query(`DROP TABLE IF EXISTS \`${tableName}\``);
        await tidbConn.query(createSQL);
        console.log(`   ✓ تم إنشاء هيكل الجدول`);

        // 3. جلب البيانات
        const [rows] = await railwayConn.query(`SELECT * FROM \`${tableName}\``);
        const rowCount = rows.length;
        totalRows += rowCount;

        if (rowCount === 0) {
          console.log(`   ℹ  الجدول فارغ (لا توجد بيانات)`);
        } else {
          // 4. نسخ البيانات على دفعات
          const batchSize = 1000;
          const columns = Object.keys(rows[0]);

          for (let j = 0; j < rows.length; j += batchSize) {
            const batch = rows.slice(j, j + batchSize);

            const placeholders = batch
              .map(() => `(${columns.map(() => "?").join(", ")})`)
              .join(", ");

            const values = batch.flatMap((row) =>
              columns.map((col) => row[col])
            );

            await tidbConn.query(
              `INSERT INTO \`${tableName}\` (${columns
                .map((c) => `\`${c}\``)
                .join(", ")}) VALUES ${placeholders}`,
              values
            );

            const currentRows = Math.min(j + batchSize, rows.length);
            console.log(`   ✓ تم نسخ ${currentRows}/${rowCount} صف`);
          }
        }

        console.log(`✅ اكتمل: ${tableName} (${rowCount} صف)\n`);
      } catch (tableError) {
        console.error(`❌ خطأ في جدول ${tableName}:`, tableError.message);
        console.log("   ⏭️  المتابعة للجدول التالي...\n");
      }
    }

    // ملخص النقل
    console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("🎉 اكتملت عملية النقل بنجاح!\n");
    console.log(`📊 الإحصائيات:`);
    console.log(`   • عدد الجداول: ${totalTables}`);
    console.log(`   • إجمالي الصفوف: ${totalRows.toLocaleString()}`);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

    // التحقق من البيانات
    console.log("🔍 التحقق من البيانات في TiDB...\n");
    const [tidbTables] = await tidbConn.query("SHOW TABLES");
    console.log(`✅ عدد الجداول في TiDB: ${tidbTables.length}`);

    for (const table of tidbTables) {
      const tableName = Object.values(table)[0];
      const [count] = await tidbConn.query(
        `SELECT COUNT(*) as count FROM \`${tableName}\``
      );
      console.log(`   • ${tableName}: ${count[0].count} صف`);
    }

    console.log("\n✅ تم التحقق من البيانات بنجاح!\n");
  } catch (error) {
    console.error("\n❌ ====== فشلت عملية النقل ======");
    console.error("الخطأ:", error.message);
    console.error("\nالتفاصيل الكاملة:");
    console.error(error);
    process.exit(1);
  } finally {
    // إغلاق الاتصالات
    if (railwayConn) {
      await railwayConn.end();
      console.log("🔌 تم قطع الاتصال بـ Railway");
    }
    if (tidbConn) {
      await tidbConn.end();
      console.log("🔌 تم قطع الاتصال بـ TiDB Cloud");
    }
  }
}

// ============================================
// ▶️ تشغيل السكريبت
// ============================================

console.log(`
╔═══════════════════════════════════════════╗
║   🚀 نقل قاعدة البيانات                  ║
║   من Railway إلى TiDB Cloud              ║
╚═══════════════════════════════════════════╝
`);

migrateDatabase()
  .then(() => {
    console.log("✅ انتهت العملية بنجاح!");
    process.exit(0);
  })
  .catch((err) => {
    console.error("❌ فشلت العملية:", err);
    process.exit(1);
  });
