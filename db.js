import pkg from "pg";
const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },

  // 👇 هذا هو الحل
  family: 4, // Force IPv4
});

pool.query("select 1")
  .then(() => console.log("✅ DB CONNECTED"))
  .catch(err => console.error("❌ DB ERROR", err.message));


export default pool;
