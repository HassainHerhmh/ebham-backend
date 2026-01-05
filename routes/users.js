import express from "express";
import pool from "../db.js";
import bcrypt from "bcrypt";

const router = express.Router();

/* =========================
   GET /users
========================= */
router.get("/", async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT 
        id,
        name,
        email,
        phone,
        role,
        is_active AS status
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
   POST /users
========================= */
router.post("/", upload.single("image"), async (req, res) => {
  try {
    const { name, email, password, role, permissions } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ message: "بيانات ناقصة" });
    }

    const hashed = await bcrypt.hash(password, 10);

    const imageUrl = req.file
      ? `/uploads/${req.file.filename}`
      : null;

    await pool.query(
      `
      INSERT INTO users
      (name, email, password, role, permissions, image_url, status)
      VALUES (?,?,?,?,?,?, 'active')
      `,
      [
        name,
        email,
        hashed,
        role,
        permissions || "{}",
        imageUrl
      ]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("ADD USER ERROR:", err);
    res.status(500).json({ success: false });
  }
});


/* =========================
   PUT /users/:id
========================= */
router.put("/:id", async (req, res) => {
  try {
    const { name, role } = req.body;

    await pool.query(
      `
      UPDATE users
      SET name = ?, role = ?
      WHERE id = ?
      `,
      [name, role, req.params.id]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("UPDATE USER ERROR:", err);
    res.status(500).json({ success: false });
  }
});

/* =========================
   DELETE /users/:id
========================= */
router.delete("/:id", async (req, res) => {
  try {
    await pool.query("DELETE FROM users WHERE id = ?", [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error("DELETE USER ERROR:", err);
    res.status(500).json({ success: false });
  }
});

/* =========================
   PUT /users/:id/disable
========================= */
router.put("/:id/disable", async (req, res) => {
  try {
    await pool.query(
      "UPDATE users SET is_active = 0 WHERE id = ?",
      [req.params.id]
    );
    res.json({ success: true });
  } catch (err) {
    console.error("DISABLE USER ERROR:", err);
    res.status(500).json({ success: false });
  }
});

export default router;
