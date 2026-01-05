import mysql from "mysql2/promise";

/* =========================
   🛢️ MySQL Connection Pool
========================= */
const pool = mysql.createPool({
  host: process.env.MYSQLHOST  ||  mysql.railway.internal, 
  user: process.env.MYSQLUSER   ||  root,  
  password: process.env.MYSQLPASSWORD  || uJUVWhgygtvQoXDgsAQxjUfLEPWXGGHC,
  database: process.env.MYSQLDATABASE ||  railway, 
  port: process.env.MYSQLPORT || 3306,

  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

/* =========================
   🔌 Test Connection
========================= */
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
