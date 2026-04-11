import express from "express";
import db from "../db.js";
import auth from "../middlewares/auth.js";

const router = express.Router();

/* =========================
   حماية المسارات
========================= */
router.use(auth);

/* =========================
   التحقق من أن المستخدم أدمن
========================= */
function ensureAdmin(req, res, next) {
  const role =
    typeof req.user?.role === "string"
      ? req.user.role
      : req.user?.role?.name || "";

  const normalizedRole = String(role).toLowerCase();

  if (normalizedRole !== "admin" && normalizedRole !== "owner") {
    return res.status(403).json({
      success: false,
      message: "غير مصرح لك بإدارة صلاحيات المستخدمين",
    });
  }

  next();
}

router.use(ensureAdmin);

/* =========================
   الصلاحيات الافتراضية
========================= */
const permissionSections = [
  "dashboard",
  "users",
  "roles",
  "restaurants",
  "products",
  "categories",
  "branches",
  "orders",
  "manual_orders",
  "wassel_orders",
  "captains",
  "customers",
  "coupons",
  "ads",
  "wallets",
  "loyalty",
  "reports",
  "settings",
];

const permissionActions = ["view", "create", "edit", "delete"];

function createEmptyPermissions() {
  const result = {};
  for (const section of permissionSections) {
    result[section] = {};
    for (const action of permissionActions) {
      result[section][action] = false;
    }
  }
  return result;
}

function normalizeRole(role) {
  if (!role) return "employee";

  if (typeof role === "object") {
    return String(role.name || "employee").toLowerCase();
  }

  return String(role).toLowerCase();
}

function normalizePermissions(value) {
  const empty = createEmptyPermissions();

  if (!value) return empty;

  let parsed = value;

  try {
    if (typeof value === "string") {
      parsed = JSON.parse(value);
    }
  } catch {
    return empty;
  }

  for (const section of permissionSections) {
    for (const action of permissionActions) {
      empty[section][action] = Boolean(parsed?.[section]?.[action]);
    }
  }

  return empty;
}

/* =========================
   GET /api/users
   جلب المستخدمين
========================= */
router.get("/", async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT
        id,
        name,
        email,
        phone,
        role,
        permissions,
        created_at
      FROM users
      ORDER BY id DESC
    `);

    const users = rows.map((user) => ({
      ...user,
      role: normalizeRole(user.role),
      permissions: normalizePermissions(user.permissions),
    }));

    res.json({
      success: true,
      users,
    });
  } catch (err) {
    console.error("Get Users Error:", err);
    res.status(500).json({
      success: false,
      message: "فشل جلب المستخدمين",
    });
  }
});

/* =========================
   GET /api/users/:id/permissions
   جلب صلاحيات مستخدم محدد
========================= */
router.get("/:id/permissions", async (req, res) => {
  try {
    const { id } = req.params;

    const [[user]] = await db.query(
      `
      SELECT id, name, role, permissions
      FROM users
      WHERE id = ?
      LIMIT 1
      `,
      [id]
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "المستخدم غير موجود",
      });
    }

    res.json({
      success: true,
      user_id: user.id,
      role: normalizeRole(user.role),
      permissions: normalizePermissions(user.permissions),
    });
  } catch (err) {
    console.error("Get User Permissions Error:", err);
    res.status(500).json({
      success: false,
      message: "فشل جلب الصلاحيات",
    });
  }
});

/* =========================
   PUT /api/users/:id
   تحديث بيانات المستخدم الأساسية
========================= */
router.put("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const name = String(req.body.name || "").trim();
    const email = req.body.email ? String(req.body.email).trim() : null;
    const phone = req.body.phone ? String(req.body.phone).trim() : null;
    const role = normalizeRole(req.body.role);

    if (!name) {
      return res.status(400).json({
        success: false,
        message: "الاسم مطلوب",
      });
    }

    const [[existing]] = await db.query(
      `SELECT id FROM users WHERE id = ? LIMIT 1`,
      [id]
    );

    if (!existing) {
      return res.status(404).json({
        success: false,
        message: "المستخدم غير موجود",
      });
    }

    if (email) {
      const [[emailExists]] = await db.query(
        `SELECT id FROM users WHERE email = ? AND id <> ? LIMIT 1`,
        [email, id]
      );

      if (emailExists) {
        return res.status(400).json({
          success: false,
          message: "البريد الإلكتروني مستخدم مسبقًا",
        });
      }
    }

    if (phone) {
      const [[phoneExists]] = await db.query(
        `SELECT id FROM users WHERE phone = ? AND id <> ? LIMIT 1`,
        [phone, id]
      );

      if (phoneExists) {
        return res.status(400).json({
          success: false,
          message: "رقم الهاتف مستخدم مسبقًا",
        });
      }
    }

    await db.query(
      `
      UPDATE users
      SET
        name = ?,
        email = ?,
        phone = ?,
        role = ?
      WHERE id = ?
      `,
      [name, email, phone, role, id]
    );

    res.json({
      success: true,
      message: "تم تحديث بيانات المستخدم",
    });
  } catch (err) {
    console.error("Update User Error:", err);
    res.status(500).json({
      success: false,
      message: "فشل تحديث المستخدم",
    });
  }
});

/* =========================
   PUT /api/users/:id/permissions
   تحديث دور وصلاحيات المستخدم
========================= */
router.put("/:id/permissions", async (req, res) => {
  try {
    const { id } = req.params;
    const role = normalizeRole(req.body.role);
    const permissions = normalizePermissions(req.body.permissions);

    const [[existing]] = await db.query(
      `SELECT id FROM users WHERE id = ? LIMIT 1`,
      [id]
    );

    if (!existing) {
      return res.status(404).json({
        success: false,
        message: "المستخدم غير موجود",
      });
    }

    await db.query(
      `
      UPDATE users
      SET
        role = ?,
        permissions = ?
      WHERE id = ?
      `,
      [role, JSON.stringify(permissions), id]
    );

    res.json({
      success: true,
      message: "تم تحديث الصلاحيات",
      role,
      permissions,
    });
  } catch (err) {
    console.error("Update Permissions Error:", err);
    res.status(500).json({
      success: false,
      message: "فشل تحديث الصلاحيات",
    });
  }
});

export default router;
