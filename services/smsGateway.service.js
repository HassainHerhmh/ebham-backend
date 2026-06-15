import db from "../db.js";

const GATEWAY_ONLINE_SECONDS = 90;
let tablesReady = false;

export function normalizeRecipientPhone(raw) {
  let digits = String(raw || "").replace(/\D/g, "");
  if (digits.startsWith("00967")) digits = digits.slice(2);
  if (digits.startsWith("967") && digits.length >= 12) return digits;
  if (digits.startsWith("0")) digits = digits.slice(1);
  if (digits.length === 9) return `967${digits}`;
  return digits;
}

export async function ensureSmsTables() {
  if (tablesReady) return;

  await db.query(`
    CREATE TABLE IF NOT EXISTS sms_gateway_heartbeat (
      id TINYINT PRIMARY KEY DEFAULT 1,
      last_seen_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS sms_queue (
      id INT AUTO_INCREMENT PRIMARY KEY,
      recipient_phone VARCHAR(20) NOT NULL,
      message TEXT NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'pending',
      sms_type VARCHAR(32) DEFAULT 'otp',
      error_message VARCHAR(500),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      sent_at TIMESTAMP NULL,
      INDEX idx_sms_queue_status (status)
    )
  `);

  tablesReady = true;
}

export async function touchGatewayHeartbeat() {
  await ensureSmsTables();
  await db.query(
    `INSERT INTO sms_gateway_heartbeat (id, last_seen_at) VALUES (1, NOW())
     ON DUPLICATE KEY UPDATE last_seen_at = NOW()`
  );
}

export async function isSmsGatewayOnline() {
  if (!process.env.SMS_GATEWAY_TOKEN) return false;
  await ensureSmsTables();
  const [rows] = await db.query(
    "SELECT last_seen_at AS lastSeenAt FROM sms_gateway_heartbeat WHERE id = 1"
  );
  if (!rows[0]?.lastSeenAt) return false;
  const ageMs = Date.now() - new Date(rows[0].lastSeenAt).getTime();
  return ageMs <= GATEWAY_ONLINE_SECONDS * 1000;
}

export async function getSmsServiceStatus() {
  const configured = Boolean(process.env.SMS_GATEWAY_TOKEN);
  const online = configured ? await isSmsGatewayOnline() : false;
  return { configured, online, available: online };
}

export function buildOtpMessage(code) {
  return `رمز التحقق لتطبيق جو: ${code}\nصالح لمدة 5 دقائق`;
}

export async function queueSms({ recipientPhone, message, smsType = "otp" }) {
  await ensureSmsTables();
  const phone = normalizeRecipientPhone(recipientPhone);
  if (phone.length < 11) {
    throw new Error("رقم الهاتف غير صالح");
  }

  const [result] = await db.query(
    `INSERT INTO sms_queue (recipient_phone, message, status, sms_type)
     VALUES (?, ?, 'pending', ?)`,
    [phone, message, smsType]
  );

  return {
    smsQueueId: result.insertId,
    recipientPhone: phone,
    smsStatus: "pending",
  };
}

export async function getPendingSms(limit = 10) {
  await ensureSmsTables();
  const safeLimit = Math.min(Math.max(Number(limit) || 10, 1), 50);
  const [rows] = await db.query(
    `SELECT id, recipient_phone AS recipientPhone, message,
            sms_type AS smsType, created_at AS createdAt
     FROM sms_queue
     WHERE status = 'pending'
     ORDER BY id ASC
     LIMIT ${safeLimit}`
  );
  return rows;
}

export async function markSmsSent(id) {
  await ensureSmsTables();
  await db.query(
    `UPDATE sms_queue
     SET status = 'sent', sent_at = NOW(), error_message = NULL
     WHERE id = ? AND status = 'pending'`,
    [id]
  );
  const [rows] = await db.query(
    "SELECT id, status, sent_at AS sentAt FROM sms_queue WHERE id = ?",
    [id]
  );
  return rows[0] || null;
}

export async function markSmsFailed(id, errorMessage) {
  await ensureSmsTables();
  await db.query(
    `UPDATE sms_queue
     SET status = 'failed', error_message = ?
     WHERE id = ? AND status = 'pending'`,
    [String(errorMessage || "فشل الإرسال").slice(0, 500), id]
  );
  const [rows] = await db.query(
    "SELECT id, status FROM sms_queue WHERE id = ?",
    [id]
  );
  return rows[0] || null;
}

export async function getGatewayStats() {
  await ensureSmsTables();
  const [rows] = await db.query(
    `SELECT
       SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
       SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) AS sent,
       SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
     FROM sms_queue`
  );
  const stats = rows[0] || {};
  return {
    pending: Number(stats.pending) || 0,
    sent: Number(stats.sent) || 0,
    failed: Number(stats.failed) || 0,
  };
}
