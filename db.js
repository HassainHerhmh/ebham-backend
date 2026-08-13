import mysql from "mysql2/promise";

function env(name, fallback = "") {
  return process.env[name] || fallback;
}

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
  const message = String(err.message || "");
  return /connection lost|server closed the connection|socket hang up|pool is closed/i.test(
    message
  );
}

function normalizeHost(host) {
  const value = String(host || "").trim();
  if (!value || value === "localhost" || value === "::1") {
    return "127.0.0.1";
  }
  return value;
}

function normalizeUri(uri) {
  return String(uri).replace(/@(localhost|\[::1\]|::1)(?=[:/])/i, "@127.0.0.1");
}

function buildPoolConfig() {
  const sslDisabled = String(process.env.MYSQLSSL || "").toLowerCase() === "false";

  if (DB_URI && String(DB_URI).startsWith("mysql")) {
    const config = {
      uri: normalizeUri(DB_URI),
      family: 4,
      waitForConnections: true,
      connectionLimit: 5,
      enableKeepAlive: true,
      keepAliveInitialDelay: 10000,
      connectTimeout: 20000,
      maxIdle: 2,
      idleTimeout: 60000,
      queueLimit: 0,
    };

    if (sslDisabled) {
      config.ssl = undefined;
    } else if (
      process.env.MYSQL_PUBLIC_URL &&
      DB_URI === process.env.MYSQL_PUBLIC_URL
    ) {
      config.ssl = { rejectUnauthorized: false };
    }

    return config;
  }

  const host = normalizeHost(
    env("MYSQLHOST") || env("MYSQL_HOST") || env("DB_HOST") || "127.0.0.1"
  );
  const database =
    env("MYSQLDATABASE") || env("MYSQL_DATABASE") || env("DB_NAME");
  const user = env("MYSQLUSER") || env("MYSQL_USER") || env("DB_USER");
  const password =
    env("MYSQLPASSWORD") || env("MYSQL_PASSWORD") || env("DB_PASSWORD");

  if (!host || !database || !user) {
    console.error(
      "❌ MySQL config missing. Set DATABASE_URL or MYSQLHOST/MYSQLUSER/MYSQLPASSWORD/MYSQLDATABASE"
    );
  }

  return {
    host,
    port: Number(env("MYSQLPORT") || env("MYSQL_PORT") || env("DB_PORT") || 3306),
    user,
    password,
    database,
    family: 4,
    ssl: sslDisabled ? undefined : { rejectUnauthorized: false },
    waitForConnections: true,
    connectionLimit: 5,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000,
    connectTimeout: 20000,
    maxIdle: 2,
    idleTimeout: 60000,
    queueLimit: 0,
  };
}

function createRawPool() {
  const pool = mysql.createPool(buildPoolConfig());

  pool.on("connection", (connection) => {
    connection.on("error", (err) => {
      console.error("❌ MySQL connection error:", err.code || err.message);
    });
  });

  return pool;
}

let rawPool = createRawPool();
let recreatePromise = null;

async function recreatePoolSafe() {
  if (recreatePromise) return recreatePromise;

  recreatePromise = (async () => {
    const oldPool = rawPool;
    const newPool = createRawPool();

    try {
      await newPool.query("SELECT 1");
      rawPool = newPool;
      console.log("🔄 MySQL pool recreated successfully");

      setTimeout(async () => {
        try {
          await oldPool.end();
        } catch {
          // old pool may already be dead
        }
      }, 3000);
    } catch (err) {
      try {
        await newPool.end();
      } catch {
        // ignore
      }
      console.error("❌ MySQL pool recreate failed:", err.message);
      throw err;
    } finally {
      recreatePromise = null;
    }
  })();

  return recreatePromise;
}

async function withRetry(action, label) {
  let lastError;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      if (recreatePromise) await recreatePromise;
      return await action(rawPool);
    } catch (err) {
      lastError = err;
      if (!isRetryableError(err) || attempt === 3) break;

      console.warn(`⚠️ DB ${label} retry ${attempt}/3:`, err.message);
      await new Promise((resolve) => setTimeout(resolve, attempt * 500));

      if (attempt >= 2) {
        try {
          await recreatePoolSafe();
        } catch {
          // next retry will surface the error if still broken
        }
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

export default db;
