
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
    const { is_admin_branch, branch_id } = req.user;
    const selectedBranch = req.headers["x-branch-id"];

    let rows;

    if (is_admin_branch) {
      if (selectedBranch && selectedBranch !== "all") {
        // الإدارة العامة + فرع محدد
        [rows] = await pool.query(
          `
          SELECT u.*, b.name AS branch_name
          FROM users u
          LEFT JOIN branches b ON b.id = u.branch_id
          WHERE u.branch_id = ?
          ORDER BY u.id DESC
          `,
          [selectedBranch]
        );
      } else {
        // الإدارة العامة بدون فلترة (كل المستخدمين)
        [rows] = await pool.query(`
          SELECT u.*, b.name AS branch_name
          FROM users u
          LEFT JOIN branches b ON b.id = u.branch_id
          ORDER BY u.id DESC
        `);
      }
    } else {
      // مستخدم فرع عادي
      [rows] = await pool.query(
        `
        SELECT u.*, b.name AS branch_name
        FROM users u
        LEFT JOIN branches b ON b.id = u.branch_id
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
    let { name, email, phone, password, role, permissions, branch_id } = req.body;

    // لو المستخدم ليس من الإدارة العامة
    // نربطه تلقائيًا بفرعه ولا نسمح بتغيير الفرع
    if (!(authUser.role === "admin" && authUser.is_admin_branch === true)) {
      branch_id = authUser.branch_id;
    }

    const hashed = await bcrypt.hash(password, 10);

    const image_url = req.file
      ? `/uploads/users/${req.file.filename}`
      : null;

    await pool.query(
      `
      INSERT INTO users (name, email, phone, password, role, permissions, branch_id, image_url, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active')
      `,
      [
        name,
        email,
        phone,
        hashed,
        role,
        permissions || "{}",
        branch_id || null,
        image_url,
      ]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("ADD USER ERROR:", err);
    res.status(500).json({ success: false });
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
      `SELECT id, name, role, permissions FROM users WHERE id = ? LIMIT 1`,
      [req.params.id]
    );

    if (!user) {
      return res.status(404).json({ success: false, message: "المستخدم غير موجود" });
    }

    res.json({
      success: true,
      user_id: user.id,
      role: normalizeRole(user.role),
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
    const { name, email, phone, role, branch_id } = req.body;
    const image_url = req.file ? `/uploads/users/${req.file.filename}` : null;

    const fields = ["name = ?", "email = ?", "phone = ?", "role = ?"];
    const values = [name, email || null, phone || null, normalizeRole(role)];

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
    res.status(500).json({ success: false, message: "فشل تحديث المستخدم" });
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
