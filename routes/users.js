import express from "express";
import bcrypt from "bcrypt";
import multer from "multer";
import pkg from "pg";

const { Pool } = pkg;
const router = express.Router();

/* =========================
   Database
========================= */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

/* =========================
   Multer (رفع الصور)
========================= */
const storage = multer.memoryStorage();
const upload = multer({ storage });

/* =========================
   Helpers
========================= */
const isEmail = (v) => v && v.includes("@");

/* =========================
   GET /users
========================= */
router.get("/", async (req, res) => {
  try {
    const { rows } = await pool.query(`
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

    res.json(rows);
  } catch (err) {
    console.error("GET USERS ERROR:", err);
    res.status(500).json({ success: false });
  }
});

/* =========================
   POST /users  (إضافة مستخدم)
========================= */
router.post("/", upload.single("image"), async (req, res) => {
  try {
    const { name, email, phone, password, role, permissions } = req.body;

    if (!name || !password || (!email && !phone)) {
      return res.status(400).json({
        success: false,
        message: "البيانات ناقصة",
      });
    }

    const hashed = await bcrypt.hash(password, 10);

    const { rows } = await pool.query(
      `
      INSERT INTO users
        (name, email, phone, password, role, permissions, status)
      VALUES
        ($1, $2, $3, $4, $5, $6, 'active')
      RETURNING id
      `,
      [
        name,
        email || null,
        phone || null,
        hashed,
        role || "section",
        permissions ? JSON.parse(permissions) : {},
      ]
    );

    res.json({ success: true, id: rows[0].id });
  } catch (err) {
    console.error("ADD USER ERROR:", err);
    res.status(500).json({ success: false });
  }
});

/* =========================
   PUT /users/:id  (تعديل)
========================= */
router.put("/:id", upload.single("image"), async (req, res) => {
  try {
    const { id } = req.params;
    const { name, email, phone, password, role, permissions } = req.body;

    const fields = [];
    const values = [];
    let i = 1;

    if (name) {
      fields.push(`name=$${i++}`);
      values.push(name);
    }
    if (email !== undefined) {
      fields.push(`email=$${i++}`);
      values.push(email || null);
    }
    if (phone !== undefined) {
      fields.push(`phone=$${i++}`);
      values.push(phone || null);
    }
    if (role) {
      fields.push(`role=$${i++}`);
      values.push(role);
    }
    if (permissions) {
      fields.push(`permissions=$${i++}`);
      values.push(JSON.parse(permissions));
    }
    if (password) {
      const hashed = await bcrypt.hash(password, 10);
      fields.push(`password=$${i++}`);
      values.push(hashed);
    }

    if (!fields.length) {
      return res.json({ success: true });
    }

    await pool.query(
      `UPDATE users SET ${fields.join(", ")} WHERE id=$${i}`,
      [...values, id]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("UPDATE USER ERROR:", err);
    res.status(500).json({ success: false });
  }
});

/* =========================
   PUT /users/:id/disable
========================= */
router.put("/:id/disable", async (req, res) => {
  try {
    await pool.query(
      `UPDATE users SET status='disabled' WHERE id=$1`,
      [req.params.id]
    );
    res.json({ success: true });
  } catch (err) {
    console.error("DISABLE USER ERROR:", err);
    res.status(500).json({ success: false });
  }
});

/* =========================
   DELETE /users/:id
========================= */
router.delete("/:id", async (req, res) => {
  try {
    await pool.query(`DELETE FROM users WHERE id=$1`, [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error("DELETE USER ERROR:", err);
    res.status(500).json({ success: false });
  }
});

/* =========================
   POST /users/:id/reset-password
========================= */
router.post("/:id/reset-password", async (req, res) => {
  try {
    const newPass = Math.random().toString(36).slice(-8);
    const hashed = await bcrypt.hash(newPass, 10);

    await pool.query(
      `UPDATE users SET password=$1 WHERE id=$2`,
      [hashed, req.params.id]
    );

    res.json({
      success: true,
      new_password: newPass,
    });
  } catch (err) {
    console.error("RESET PASSWORD ERROR:", err);
    res.status(500).json({ success: false });
  }
});

export default router;
