import db from "../db.js";

let ready = false;

async function ensureAuditTable() {
  if (ready) return;
  await db.query(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id INT NOT NULL AUTO_INCREMENT,
      actor_type VARCHAR(30) NULL,
      actor_id INT NULL,
      actor_name VARCHAR(255) NULL,
      action VARCHAR(120) NOT NULL,
      entity_type VARCHAR(50) NULL,
      entity_id VARCHAR(50) NULL,
      details TEXT NULL,
      branch_id INT NULL,
      created_at DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_audit_created (created_at),
      KEY idx_audit_entity (entity_type, entity_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  ready = true;
}

export async function logAudit(req, payload = {}) {
  try {
    await ensureAuditTable();
    const user = req?.user || {};
    const details =
      typeof payload.details === "string"
        ? payload.details
        : payload.details
          ? JSON.stringify(payload.details)
          : null;

    await db.query(
      `INSERT INTO audit_logs
        (actor_type, actor_id, actor_name, action, entity_type, entity_id, details, branch_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        user.role || payload.actorType || "system",
        user.id || payload.actorId || null,
        user.name || payload.actorName || "غير معروف",
        payload.action || "إجراء",
        payload.entityType || null,
        payload.entityId != null ? String(payload.entityId) : null,
        details,
        user.branch_id || payload.branchId || null,
      ]
    );
  } catch (err) {
    console.error("AUDIT LOG ERROR:", err?.message || err);
  }
}
