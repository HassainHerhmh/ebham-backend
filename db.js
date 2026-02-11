import mysql from "mysql2/promise";

const pool = mysql.createPool({
  uri: process.env.MYSQL_PUBLIC_URL,
  waitForConnections: true,
  connectionLimit: 10,
  
  // ⭐ إضافات مهمة لحل مشكلة انقطاع الاتصال
  enableKeepAlive: true,           // إبقاء الاتصال حيًا
  keepAliveInitialDelay: 10000,    // فحص كل 10 ثواني
  connectTimeout: 60000,           // وقت الاتصال: 60 ثانية
  acquireTimeout: 60000,           // وقت الحصول على اتصال
  idleTimeout: 60000,              // وقت الخمول قبل الإغلاق
  maxIdle: 10,                     // أقصى اتصالات خاملة
  queueLimit: 0,                   // بدون حد للانتظار
});

// معالجة أخطاء الـ Pool
pool.on('connection', (connection) => {
  console.log('📗 New connection established');
  
  connection.on('error', (err) => {
    console.error('❌ Connection error:', err.message);
    if (err.code === 'PROTOCOL_CONNECTION_LOST') {
      console.log('🔄 Reconnecting...');
    }
  });
});

// فحص الاتصال
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

// فحص دوري للحفاظ على الاتصال
setInterval(async () => {
  try {
    await pool.query("SELECT 1");
  } catch (err) {
    console.error("❌ Keep-alive query failed:", err.message);
  }
}, 30000); // كل 30 ثانية

export default pool;
