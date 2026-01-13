
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
      if (selectedBranch) {
        // الإدارة العامة + فرع مختار
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
        // الإدارة العامة بدون اختيار فرع → الكل
        [rows] = await pool.query(`
          SELECT u.*, b.name AS branch_name
          FROM users u
          LEFT JOIN branches b ON b.id = u.branch_id
          ORDER BY u.id DESC
        `);
      }
    } else {
      // فرع عادي
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
router.put("/:id", upload.single("image"), async (req, res) => {
  try {
    const authUser = req.user;
    let { name, role, permissions, branch_id } = req.body;

    // مستخدم فرع لا يغير الفرع
    if (!(authUser.role === "admin" && authUser.is_admin_branch === true)) {
      branch_id = authUser.branch_id;
    }

    const image_url = req.file
      ? `/uploads/users/${req.file.filename}`
      : null;

    if (image_url) {
      await pool.query(
        `
        UPDATE users
        SET name=?, role=?, permissions=?, image_url=?, branch_id=?
        WHERE id=?
        `,
        [name, role, permissions || "{}", image_url, branch_id || null, req.params.id]
      );
    } else {
      await pool.query(
        `
        UPDATE users
        SET name=?, role=?, permissions=?, branch_id=?
        WHERE id=?
        `,
        [name, role, permissions || "{}", branch_id || null, req.params.id]
      );
    }

    res.json({ success: true });
  } catch (err) {
    console.error("UPDATE USER ERROR:", err);
    res.status(500).json({ success: false });
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
