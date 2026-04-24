import express from "express";
import db from "../db.js";
import auth from "../middlewares/auth.js";
import {
  checkInUserAttendance,
  checkOutUserAttendance,
  ensureUserAttendanceTable,
  getOpenUserAttendanceSession,
} from "../utils/userAttendance.js";

const router = express.Router();

router.use(auth);

const ROLE_LABELS = {
  admin: "أدمن",
  accountant: "محاسب",
  employee: "موظف",
  service: "موظف خدمة",
  marketer: "مسوق",
  captain: "كابتن",
  agent: "وكيل",
};

const normalizeRole = (value) => String(value || "").trim().toLowerCase();

function buildScope(req, params) {
  const conditions = [];
  const authUser = req.user;

  if (normalizeRole(authUser.role) === "agent") {
    conditions.push("u.agent_id = ?");
    params.push(authUser.id);
    return conditions;
  }

  if (authUser.agent_id) {
    conditions.push("u.agent_id = ?");
    params.push(authUser.agent_id);
    return conditions;
  }

  if (!authUser.is_admin_branch && !authUser.is_admin && authUser.branch_id) {
    conditions.push("u.branch_id = ?");
    params.push(authUser.branch_id);
    return conditions;
  }

  if (authUser.branch_id) {
    conditions.push("u.branch_id = ?");
    params.push(authUser.branch_id);
  }

  return conditions;
}

function applyPeriodFilter(period, from, to, conditions, params) {
  if (from && to) {
    conditions.push("uas.login_time BETWEEN ? AND ?");
    params.push(`${from} 00:00:00`, `${to} 23:59:59`);
    return;
  }

  switch (period) {
    case "day":
      conditions.push("DATE(uas.login_time) = CURDATE()");
      break;
    case "week":
      conditions.push("uas.login_time >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)");
      conditions.push("uas.login_time < DATE_ADD(CURDATE(), INTERVAL 1 DAY)");
      break;
    case "month":
      conditions.push("YEAR(uas.login_time) = YEAR(CURDATE())");
      conditions.push("MONTH(uas.login_time) = MONTH(CURDATE())");
      break;
    default:
      break;
  }
}

router.get("/status", async (req, res) => {
  try {
    const openSession = await getOpenUserAttendanceSession(req.user.id);

    return res.json({
      success: true,
      has_open_session: Boolean(openSession),
      session: openSession,
    });
  } catch (error) {
    console.error("USER ATTENDANCE STATUS ERROR:", error);
    return res.status(500).json({ success: false, message: "فشل جلب حالة الدوام" });
  }
});

router.post("/check-in", async (req, res) => {
  try {
    const session = await checkInUserAttendance(req.user.id, req.user.branch_id || null);

    return res.json({
      success: true,
      message: "تم تسجيل الدخول بنجاح",
      session,
    });
  } catch (error) {
    console.error("USER ATTENDANCE CHECK-IN ERROR:", error);
    return res.status(500).json({ success: false, message: "فشل تسجيل الحضور" });
  }
});

router.post("/check-out", async (req, res) => {
  try {
    const session = await checkOutUserAttendance(req.user.id);

    return res.json({
      success: true,
      message: session ? "تم تسجيل الانصراف" : "لا توجد جلسة حضور مفتوحة",
      session,
    });
  } catch (error) {
    console.error("USER ATTENDANCE CHECK-OUT ERROR:", error);
    return res.status(500).json({ success: false, message: "فشل تسجيل الانصراف" });
  }
});

router.get("/report", async (req, res) => {
  try {
    await ensureUserAttendanceTable();

    const period = String(req.query.period || "day").toLowerCase();
    const from = req.query.from ? String(req.query.from) : "";
    const to = req.query.to ? String(req.query.to) : "";
    const userId = req.query.user_id ? Number(req.query.user_id) : null;
    const role = req.query.role ? normalizeRole(req.query.role) : "";

    const params = [];
    const conditions = [];

    applyPeriodFilter(period, from, to, conditions, params);

    if (userId) {
      conditions.push("u.id = ?");
      params.push(userId);
    }

    if (role) {
      conditions.push("LOWER(u.role) = ?");
      params.push(role);
    }

    conditions.push(...buildScope(req, params));

    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const [rows] = await db.query(
      `
      SELECT
        uas.id,
        uas.user_id,
        uas.branch_id,
        uas.login_time,
        uas.logout_time,
        u.name AS user_name,
        u.phone,
        u.email,
        u.role,
        b.name AS branch_name,
        TIMESTAMPDIFF(SECOND, uas.login_time, IFNULL(uas.logout_time, NOW())) AS duration_seconds
      FROM user_attendance_sessions uas
      INNER JOIN users u ON u.id = uas.user_id
      LEFT JOIN branches b ON b.id = uas.branch_id
      ${whereClause}
      ORDER BY uas.login_time DESC, uas.id DESC
      `,
      params
    );

    const summary = {
      total_sessions: rows.length,
      active_sessions: rows.filter((row) => !row.logout_time).length,
      unique_users: new Set(rows.map((row) => row.user_id)).size,
      total_duration_seconds: rows.reduce(
        (sum, row) => sum + Number(row.duration_seconds || 0),
        0
      ),
    };

    const normalizedRows = rows.map((row) => ({
      ...row,
      role_label: ROLE_LABELS[normalizeRole(row.role)] || row.role || "-",
    }));

    return res.json({
      success: true,
      summary,
      sessions: normalizedRows,
    });
  } catch (error) {
    console.error("USER ATTENDANCE REPORT ERROR:", error);
    return res.status(500).json({ success: false, message: "فشل تحميل تقرير الدوام" });
  }
});

export default router;
