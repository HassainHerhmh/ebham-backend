import mysql from "mysql2/promise";

const pool = mysql.createPool({
  uri: process.env.MYSQL_PUBLIC_URL,
  waitForConnections: true,
  connectionLimit: 10,
});

(async () => {
  try {
    const conn = await pool.getConnection();
    await conn.query("SELECT 1");
    conn.release();
    console.log("✅ MySQL CONNECTED SUCCESSFULLY");
  } catch (err) {
    console.error("❌ MYSQL CONNECTION ERROR:", err.message);
  }
})();

export default pool;
