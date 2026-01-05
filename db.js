import pkg from "pg";
const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

pool.query("select 1")
  .then(() => console.log("✅ DB CONNECTED (Railway PostgreSQL)"))
  .catch(err => console.error("❌ DB ERROR:", err.message));

export default pool;
