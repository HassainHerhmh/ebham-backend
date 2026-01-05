import pkg from "pg";
const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },

  // 👇 هذا هو الحل
  family: 4, // Force IPv4
});




export default pool;
