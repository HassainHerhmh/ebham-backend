const MAX_FAILED_ATTEMPTS = 5;
const BASE_BAN_MINUTES = 30;

let tableReady = false;

function normalizePhone(phone) {
  return String(phone || "").replace(/\s+/g, "").trim();
}

function formatBanLabel(totalSeconds) {
  const safe = Math.max(0, Math.ceil(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.ceil((safe % 3600) / 60);

  if (hours > 0 && minutes > 0) {
    return `${hours} ساعة و ${minutes} دقيقة`;
  }
  if (hours > 0) {
    return hours === 1 ? "ساعة واحدة" : `${hours} ساعة`;
  }
  if (minutes <= 1) return "دقيقة واحدة";
  return `${minutes} دقيقة`;
}

export async function ensureOtpSecurityTable(db) {
  if (tableReady) return;

  await db.query(`
    CREATE TABLE IF NOT EXISTS otp_security (
      phone VARCHAR(20) PRIMARY KEY,
      failed_attempts INT NOT NULL DEFAULT 0,
      ban_strike INT NOT NULL DEFAULT 0,
      ban_until TIMESTAMP NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);

  tableReady = true;
}

async function getSecurityRow(db, phone) {
  await ensureOtpSecurityTable(db);
  const normalizedPhone = normalizePhone(phone);
  const [rows] = await db.query(
    `SELECT phone, failed_attempts AS failedAttempts, ban_strike AS banStrike,
            ban_until AS banUntil
     FROM otp_security
     WHERE phone = ?
     LIMIT 1`,
    [normalizedPhone]
  );
  return rows[0] || null;
}

function buildBanPayload(row) {
  if (!row?.banUntil) return null;

  const banUntilMs = new Date(row.banUntil).getTime();
  const remainingSeconds = Math.ceil((banUntilMs - Date.now()) / 1000);

  if (remainingSeconds <= 0) return null;

  return {
    banned: true,
    banUntil: new Date(row.banUntil).toISOString(),
    remainingSeconds,
    remainingLabel: formatBanLabel(remainingSeconds),
    banStrike: Number(row.banStrike) || 1,
    message: `تم حظرك مؤقتاً لمدة ${formatBanLabel(remainingSeconds)}`,
  };
}

export async function getOtpBanStatus(db, phone) {
  const row = await getSecurityRow(db, phone);
  return buildBanPayload(row);
}

export async function assertOtpNotBanned(db, phone) {
  const ban = await getOtpBanStatus(db, phone);
  if (ban) {
    const err = new Error(ban.message);
    err.code = "OTP_BANNED";
    err.ban = ban;
    throw err;
  }
}

export async function recordOtpFailure(db, phone) {
  await ensureOtpSecurityTable(db);
  const normalizedPhone = normalizePhone(phone);
  const row = await getSecurityRow(db, normalizedPhone);

  const currentAttempts = Number(row?.failedAttempts) || 0;
  const nextAttempts = currentAttempts + 1;

  if (nextAttempts < MAX_FAILED_ATTEMPTS) {
    await db.query(
      `INSERT INTO otp_security (phone, failed_attempts, ban_strike)
       VALUES (?, ?, 0)
       ON DUPLICATE KEY UPDATE failed_attempts = VALUES(failed_attempts)`,
      [normalizedPhone, nextAttempts]
    );
    return { banned: false, attemptsLeft: MAX_FAILED_ATTEMPTS - nextAttempts };
  }

  const nextStrike = (Number(row?.banStrike) || 0) + 1;
  const banMinutes = BASE_BAN_MINUTES * nextStrike;

  await db.query(
    `INSERT INTO otp_security (phone, failed_attempts, ban_strike, ban_until)
     VALUES (?, 0, ?, DATE_ADD(NOW(), INTERVAL ? MINUTE))
     ON DUPLICATE KEY UPDATE
       failed_attempts = 0,
       ban_strike = VALUES(ban_strike),
       ban_until = VALUES(ban_until)`,
    [normalizedPhone, nextStrike, banMinutes]
  );

  const ban = await getOtpBanStatus(db, normalizedPhone);
  return { banned: true, ban };
}

export async function resetOtpSecurity(db, phone) {
  await ensureOtpSecurityTable(db);
  const normalizedPhone = normalizePhone(phone);
  await db.query(
    `UPDATE otp_security
     SET failed_attempts = 0, ban_until = NULL
     WHERE phone = ?`,
    [normalizedPhone]
  );
}

export function respondOtpBanned(res, ban) {
  return res.status(429).json({
    success: false,
    banned: true,
    banUntil: ban.banUntil,
    remainingSeconds: ban.remainingSeconds,
    remainingLabel: ban.remainingLabel,
    message: ban.message,
  });
}
