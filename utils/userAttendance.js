import db from "../db.js";

let attendanceTableEnsured = false;

export async function ensureUserAttendanceTable() {
  if (attendanceTableEnsured) return;

  await db.query(`
    CREATE TABLE IF NOT EXISTS user_attendance_sessions (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      branch_id INT NULL,
      login_time DATETIME NOT NULL,
      logout_time DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_user_attendance_user_id (user_id),
      INDEX idx_user_attendance_branch_id (branch_id),
      INDEX idx_user_attendance_login_time (login_time),
      INDEX idx_user_attendance_logout_time (logout_time)
    )
  `);

  attendanceTableEnsured = true;
}

export async function getOpenUserAttendanceSession(userId) {
  await ensureUserAttendanceTable();

  const [[session]] = await db.query(
    `
    SELECT id, user_id, branch_id, login_time, logout_time
    FROM user_attendance_sessions
    WHERE user_id = ? AND logout_time IS NULL
    ORDER BY login_time DESC
    LIMIT 1
    `,
    [userId]
  );

  return session || null;
}

export async function checkInUserAttendance(userId, branchId = null) {
  await ensureUserAttendanceTable();

  const existing = await getOpenUserAttendanceSession(userId);
  if (existing) {
    return existing;
  }

  const [result] = await db.query(
    `
    INSERT INTO user_attendance_sessions (user_id, branch_id, login_time)
    VALUES (?, ?, NOW())
    `,
    [userId, branchId || null]
  );

  return getOpenUserAttendanceSession(result.insertId ? userId : userId);
}

export async function checkOutUserAttendance(userId) {
  await ensureUserAttendanceTable();

  const existing = await getOpenUserAttendanceSession(userId);
  if (!existing) {
    return null;
  }

  await db.query(
    `
    UPDATE user_attendance_sessions
    SET logout_time = NOW()
    WHERE id = ?
    `,
    [existing.id]
  );

  const [[session]] = await db.query(
    `
    SELECT id, user_id, branch_id, login_time, logout_time
    FROM user_attendance_sessions
    WHERE id = ?
    LIMIT 1
    `,
    [existing.id]
  );

  return session || null;
}
