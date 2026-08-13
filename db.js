import mysql from "mysql2/promise";

const DB_URI =
  process.env.MYSQL_PRIVATE_URL ||
  process.env.MYSQL_URL ||
  process.env.MYSQL_PUBLIC_URL ||
  process.env.DATABASE_URL;

const RETRYABLE_CODES = new Set([
  "PROTOCOL_CONNECTION_LOST",
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EPIPE",
  "PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR",
  "PROTOCOL_ENQUEUE_AFTER_QUIT",
]);

function isRetryableError(err) {
  if (!err) return false;
  if (RETRYABLE_CODES.has(err.code)) return true;
  return /connection lost|server closed the connection|socket hang up/i.test(
    String(err.message || "")
  );
}

function createRawPool() {
  if (!DB_URI) {
    console.error(
      "❌ MySQL URI missing. Set MYSQL_PRIVATE_URL, MYSQL_URL, MYSQL_PUBLIC_URL, or DATABASE_URL"
    );
  }

  const pool = mysql.createPool({
    uri: DB_URI,
    waitForConnections: true,
    connectionLimit: 10,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
    connectTimeout: 30000,
    maxIdle: 5,
    idleTimeout: 30000,
    queueLimit: 0,
  });

  pool.on("connection", (connection) => {
    connection.on("error", (err) => {
      console.error("❌ MySQL connection error:", err.code || err.message);
    });
  });

  return pool;
}

let rawPool = createRawPool();

async function recreatePool() {
  try {
    await rawPool.end();
  } catch {
    // ignore shutdown errors on dead pool
  }
  rawPool = createRawPool();
  console.log("🔄 MySQL pool recreated");
}

async function withRetry(action, label) {
  let lastError;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await action(rawPool);
    } catch (err) {
      lastError = err;
      if (!isRetryableError(err) || attempt === 3) break;
      console.warn(`⚠️ DB ${label} retry ${attempt}/3:`, err.message);
      if (attempt === 2) {
        await recreatePool();
      } else {
        await new Promise((resolve) => setTimeout(resolve, attempt * 400));
      }
    }
  }

  throw lastError;
}

const db = {
  query(sql, params) {
    return withRetry((pool) => pool.query(sql, params), "query");
  },

  execute(sql, params) {
    return withRetry((pool) => pool.execute(sql, params), "execute");
  },

  getConnection() {
    return withRetry((pool) => pool.getConnection(), "getConnection");
  },

  end() {
    return rawPool.end();
  },
};

(async () => {
  try {
    await db.query("SELECT 1");
    console.log("✅ MySQL connected successfully");
  } catch (err) {
    console.error("❌ MySQL initial connection failed:", err.message);
  }
})();

let keepAliveFailures = 0;

setInterval(async () => {
  try {
    await db.query("SELECT 1");
    keepAliveFailures = 0;
  } catch (err) {
    keepAliveFailures += 1;
    console.error("❌ Keep-alive query failed:", err.message);
    if (keepAliveFailures >= 2) {
      keepAliveFailures = 0;
      await recreatePool();
      try {
        await db.query("SELECT 1");
        console.log("✅ MySQL reconnected after keep-alive failure");
      } catch (retryErr) {
        console.error("❌ MySQL still unavailable:", retryErr.message);
      }
    }
  }
}, 25000);

export default db;
