
import express from "express";
import pool from "../db.js";
import bcrypt from "bcrypt";
import multer from "multer";
import path from "path";
import fs from "fs";
import auth from "../middlewares/auth.js";

const router = express.Router();

/* ======================================================
   حماية كل المسارات
====================================================== */
router.use(auth);

/* ======================================================
   📸 Multer Config
====================================================== */
const uploadDir = "uploads/users";
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, Date.now() + ext);
  },
});

const upload = multer({ storage });

/* ======================================================
   GET /users
====================================================== */
router.get("/", async (req, res) => {
  try {
    const { is_admin_branch, branch_id, role, id: authUserId, agent_id: authAgentId } = req.user;
    const selectedBranch = req.headers["x-branch-id"];

    let rows;

    if (role === "agent") {
      [rows] = await pool.query(
        `
        SELECT u.*, b.name AS branch_name, a.name AS agent_name
        FROM users u
        LEFT JOIN branches b ON b.id = u.branch_id
        LEFT JOIN agents a ON a.id = u.agent_id
        WHERE u.agent_id = ?
        ORDER BY u.id DESC
        `,
        [authUserId]
      );
    } else if (authAgentId) {
      [rows] = await pool.query(
        `
        SELECT u.*, b.name AS branch_name, a.name AS agent_name
        FROM users u
        LEFT JOIN branches b ON b.id = u.branch_id
        LEFT JOIN agents a ON a.id = u.agent_id
        WHERE u.agent_id = ?
        ORDER BY u.id DESC
        `,
        [authAgentId]
      );
    } else if (is_admin_branch) {
      if (selectedBranch && selectedBranch !== "all") {
        // الإدارة العامة + فرع محدد
        [rows] = await pool.query(
          `
          SELECT u.*, b.name AS branch_name, a.name AS agent_name
          FROM users u
          LEFT JOIN branches b ON b.id = u.branch_id
          LEFT JOIN agents a ON a.id = u.agent_id
          WHERE u.branch_id = ?
          ORDER BY u.id DESC
          `,
          [selectedBranch]
        );
      } else {
        // الإدارة العامة بدون فلترة (كل المستخدمين)
        [rows] = await pool.query(`
          SELECT u.*, b.name AS branch_name, a.name AS agent_name
          FROM users u
          LEFT JOIN branches b ON b.id = u.branch_id
          LEFT JOIN agents a ON a.id = u.agent_id
          ORDER BY u.id DESC
        `);
      }
    } else {
      // مستخدم فرع عادي
      [rows] = await pool.query(
        `
        SELECT u.*, b.name AS branch_name, a.name AS agent_name
        FROM users u
        LEFT JOIN branches b ON b.id = u.branch_id
        LEFT JOIN agents a ON a.id = u.agent_id
        WHERE u.branch_id = ?
        ORDER BY u.id DESC
        `,
        [branch_id]
      );
    }

    res.json({ success: true, users: rows });
  } catch (err) {
    console.error("GET USERS ERROR:", err);
    res.status(500).json({ success: false });
  }
});



/* ======================================================
   PUT /users/:id
====================================================== */
router.post("/", upload.single("image"), async (req, res) => {
  try {
    const authUser = req.user;
    let { name, email, username, phone, password, role, permissions, branch_id, agent_id } = req.body;
    const normalizedName = normalizeLoginValue(name);
    const loginValue = normalizeLoginValue(username) || normalizeLoginValue(email);
    const normalizedPhone = normalizeLoginValue(phone);
    const normalizedRole = normalizeRole(role);

    if (!normalizedName || !loginValue || !normalizedPhone || !password) {
      return res.status(400).json({ success: false, message: "أكمل جميع الحقول المطلوبة" });
    }

    // لو المستخدم ليس من الإدارة العامة
    // نربطه تلقائيًا بفرعه ولا نسمح بتغيير الفرع
    if (!(authUser.role === "admin" && authUser.is_admin_branch === true)) {
      branch_id = authUser.branch_id;
    }

    if (authUser.role === "agent") {
      agent_id = authUser.id;
    } else if (authUser.agent_id) {
      agent_id = authUser.agent_id;
    }

    if (agent_id) {
      const [[agent]] = await pool.query(
        `SELECT id, branch_id FROM agents WHERE id = ? LIMIT 1`,
        [agent_id]
      );

      if (!agent) {
        return res.status(400).json({ success: false, message: "الوكيل غير موجود" });
      }

      if (agent.branch_id) {
        branch_id = agent.branch_id;
      }
    }

    const [[existingPhoneUser]] = await pool.query(
      `SELECT id FROM users WHERE phone = ? LIMIT 1`,
      [normalizedPhone]
    );

    if (existingPhoneUser) {
      return res.status(409).json({ success: false, message: "رقم الجوال مستخدم بالفعل" });
    }

    const [[existingLoginUser]] = await pool.query(
      `SELECT id FROM users WHERE email = ? LIMIT 1`,
      [loginValue]
    );

    if (existingLoginUser) {
      return res.status(409).json({ success: false, message: "اسم المستخدم مستخدم بالفعل" });
    }

    const hashed = await bcrypt.hash(password, 10);

    const image_url = req.file
      ? `/uploads/users/${req.file.filename}`
      : null;

    await pool.query(
      `
      INSERT INTO users (name, email, phone, password, role, permissions, branch_id, agent_id, image_url, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')
      `,
      [
        normalizedName,
        loginValue,
        normalizedPhone,
        hashed,
        normalizedRole,
        permissions || "{}",
        branch_id || null,
        agent_id || null,
        image_url,
      ]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("ADD USER ERROR:", err);
    res.status(500).json({ success: false, message: getUserWriteErrorMessage(err) });
  }
});

////////////////////////////////////
const permissionSections = [
  "dashboard",
  "users",
  "customers",

  "orders",
  "wassel_orders",
  "manual_orders",

  "marketing",
  "loyalty",

  "reports",
  "commission_reports",

  "settings",
  "neighborhoods",

  "restaurants",
  "products",
  "categories",
  "units",
  "types",

  "agents",
  "agent_groups",
  "captains",
  "Captain_Groups",
  "agent_info",

  "stores",
  "payment",
  "currency",
  "branches",

  "accounts",
  "payments",
];


const permissionActions = ["view", "create", "edit", "delete", "print"];

function normalizeRole(role) {
  if (!role) return "employee";
  if (typeof role === "object") return String(role.name || "employee").toLowerCase();
  return String(role).toLowerCase();
}

function normalizeLoginValue(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized || null;
}

function getUserWriteErrorMessage(err) {
  const sqlMessage = String(err?.sqlMessage || err?.message || "");

  if (err?.code === "ER_DUP_ENTRY") {
    if (sqlMessage.includes("phone")) {
      return "رقم الجوال مستخدم بالفعل";
    }

    if (sqlMessage.includes("email")) {
      return "اسم المستخدم مستخدم بالفعل";
    }

    return "توجد بيانات مستخدم مكررة";
  }

  if (err?.code === "ER_BAD_FIELD_ERROR" && sqlMessage.includes("agent_id")) {
    return "قاعدة البيانات لم تُحدّث بعد. نفذ ملف scripts/add-users-agent-id.sql على قاعدة البيانات ثم أعد المحاولة";
  }

  if (
    err?.code === "WARN_DATA_TRUNCATED" ||
    err?.code === "ER_TRUNCATED_WRONG_VALUE_FOR_FIELD" ||
    (sqlMessage.includes("role") && sqlMessage.includes("Data truncated"))
  ) {
    return "قيمة الدور الحالية غير مدعومة في قاعدة البيانات. حدّث عمود role في جدول users ليدعم employee و accountant و cashier";
  }

  if (err?.code === "ER_NO_REFERENCED_ROW_2" && sqlMessage.includes("agent_id")) {
    return "الوكيل المرتبط غير موجود في قاعدة البيانات";
  }

  return "فشل حفظ بيانات المستخدم";
}

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

function normalizePermissions(value) {
  const empty = createEmptyPermissions();
  if (!value) return empty;

  let parsed = value;

  try {
    if (typeof value === "string") parsed = JSON.parse(value);
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

router.get("/:id/permissions", async (req, res) => {
  try {
    const [[user]] = await pool.query(
      `
      SELECT u.id, u.name, u.role, u.permissions, u.agent_id, a.name AS agent_name
      FROM users u
      LEFT JOIN agents a ON a.id = u.agent_id
      WHERE u.id = ?
      LIMIT 1
      `,
      [req.params.id]
    );

    if (!user) {
      return res.status(404).json({ success: false, message: "المستخدم غير موجود" });
    }

    res.json({
      success: true,
      user_id: user.id,
      role: normalizeRole(user.role),
      agent_id: user.agent_id || null,
      agent_name: user.agent_name || null,
      permissions: normalizePermissions(user.permissions),
    });
  } catch (err) {
    console.error("GET USER PERMISSIONS ERROR:", err);
    res.status(500).json({ success: false, message: "فشل جلب الصلاحيات" });
  }
});

router.put("/:id/permissions", async (req, res) => {
  try {
    const role = normalizeRole(req.body.role);
    const permissions = normalizePermissions(req.body.permissions);

    const [[existing]] = await pool.query(
      `SELECT id FROM users WHERE id = ? LIMIT 1`,
      [req.params.id]
    );

    if (!existing) {
      return res.status(404).json({ success: false, message: "المستخدم غير موجود" });
    }

    await pool.query(
      `UPDATE users SET role = ?, permissions = ? WHERE id = ?`,
      [role, JSON.stringify(permissions), req.params.id]
    );

    res.json({
      success: true,
      message: "تم تحديث الصلاحيات",
      role,
      permissions,
    });
  } catch (err) {
    console.error("UPDATE PERMISSIONS ERROR:", err);
    res.status(500).json({ success: false, message: "فشل تحديث الصلاحيات" });
  }
});

router.put("/:id", upload.single("image"), async (req, res) => {
  try {
    const authUser = req.user;
    let { name, email, username, phone, role, branch_id, agent_id } = req.body;
    const loginValue = normalizeLoginValue(username) || normalizeLoginValue(email);
    const normalizedPhone = normalizeLoginValue(phone);
    const image_url = req.file ? `/uploads/users/${req.file.filename}` : null;

    if (authUser.role === "agent") {
      agent_id = authUser.id;
    } else if (authUser.agent_id) {
      agent_id = authUser.agent_id;
    }

    if (loginValue) {
      const [[existingLoginUser]] = await pool.query(
        `SELECT id FROM users WHERE email = ? AND id <> ? LIMIT 1`,
        [loginValue, req.params.id]
      );

      if (existingLoginUser) {
        return res.status(409).json({ success: false, message: "اسم المستخدم مستخدم بالفعل" });
      }
    }

    if (normalizedPhone) {
      const [[existingPhoneUser]] = await pool.query(
        `SELECT id FROM users WHERE phone = ? AND id <> ? LIMIT 1`,
        [normalizedPhone, req.params.id]
      );

      if (existingPhoneUser) {
        return res.status(409).json({ success: false, message: "رقم الجوال مستخدم بالفعل" });
      }
    }

    const fields = ["name = ?", "email = ?", "phone = ?", "role = ?", "agent_id = ?"];
    const values = [name, loginValue, normalizedPhone, normalizeRole(role), agent_id || null];

    if (branch_id) {
      fields.push("branch_id = ?");
      values.push(branch_id);
    }

    if (image_url) {
      fields.push("image_url = ?");
      values.push(image_url);
    }

    values.push(req.params.id);

    await pool.query(
      `UPDATE users SET ${fields.join(", ")} WHERE id = ?`,
      values
    );

    res.json({ success: true, message: "تم تحديث المستخدم" });
  } catch (err) {
    console.error("UPDATE USER ERROR:", err);
    res.status(500).json({ success: false, message: getUserWriteErrorMessage(err) });
  }
});


/* ======================================================
   PUT /users/:id/disable
====================================================== */
router.put("/:id/disable", async (req, res) => {
  try {
    await pool.query(
      `UPDATE users SET status='disabled' WHERE id=?`,
      [req.params.id]
    );
    res.json({ success: true });
  } catch (err) {
    console.error("DISABLE USER ERROR:", err);
    res.status(500).json({ success: false });
  }
});

/* ======================================================
   DELETE /users/:id
====================================================== */
router.delete("/:id", async (req, res) => {
  try {
    await pool.query(`DELETE FROM users WHERE id=?`, [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error("DELETE USER ERROR:", err);
    res.status(500).json({ success: false });
  }
});

/* ======================================================
   POST /users/:id/reset-password
====================================================== */
router.post("/:id/reset-password", async (req, res) => {
  try {
    const newPassword = Math.random().toString(36).slice(-8);
    const hashed = await bcrypt.hash(newPassword, 10);

    await pool.query(
      `UPDATE users SET password=? WHERE id=?`,
      [hashed, req.params.id]
    );

    res.json({ success: true, new_password: newPassword });
  } catch (err) {
    console.error("RESET PASSWORD ERROR:", err);
    res.status(500).json({ success: false });
  }
});

export default router;
