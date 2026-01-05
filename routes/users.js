import express from "express";
import pool from "../db.js";
import bcrypt from "bcrypt";
import multer from "multer";
import path from "path";
import fs from "fs";

const router = express.Router();

/* ======================================================
   📸 Multer Config
====================================================== */

// إنشاء مجلد uploads لو مش موجود
const uploadDir = "uploads/users";
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
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
    const [rows] = await pool.query(`
      SELECT
        id,
        name,
        email,
        phone,
        role,
        permissions,
        status,
        image_url
      FROM users
      ORDER BY id DESC
    `);

    // تحويل permissions من string إلى JSON
    const users = rows.map((u) => ({
      ...u,
      permissions:
        typeof u.permissions === "string" && u.permissions
          ? JSON.parse(u.permissions)
          : {},
    }));

    res.json(users);
  } catch (err) {
    console.error("GET USERS ERROR:", err);
    res.status(500).json({ success: false });
  }
});

/* ======================================================
   POST /users (Add User)
====================================================== */
router.post("/", upload.single("image"), async (req, res) => {
  try {
    const { name, email, password, role, permissions } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ message: "بيانات ناقصة" });
    }

    const hashed = await bcrypt.hash(password, 10);

    const image_url = req.file
      ? `/uploads/users/${req.file.filename}`
      : null;

    await pool.query(
      `
      INSERT INTO users
        (name, email, password, role, permissions, status, image_url)
      VALUES
        (?, ?, ?, ?, ?, 'active', ?)
      `,
      [
        name,
        email,
        hashed,
        role || "section",
        permissions ? permissions : "{}",
        image_url,
      ]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("ADD USER ERROR:", err);
    res.status(500).json({ success: false });
  }
});

/* ======================================================
   PUT /users/:id (Update User)
====================================================== */
router.put("/:id", upload.single("image"), async (req, res) => {
  try {
    const { name, role, permissions } = req.body;

    const image_url = req.file
      ? `/uploads/users/${req.file.filename}`
      : null;

    if (image_url) {
      await pool.query(
        `
        UPDATE users
        SET name=?, role=?, permissions=?, image_url=?
        WHERE id=?
        `,
        [name, role, permissions || "{}", image_url, req.params.id]
      );
    } else {
      await pool.query(
        `
        UPDATE users
        SET name=?, role=?, permissions=?
        WHERE id=?
        `,
        [name, role, permissions || "{}", req.params.id]
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
