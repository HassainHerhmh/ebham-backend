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
        status,
        permissions,
        image_url
      FROM users
      ORDER BY id DESC
    `);

    const users = rows.map(u => ({
      ...u,
      permissions: u.permissions ? JSON.parse(u.permissions) : {}
    }));

    res.json(users);
  } catch (err) {
    console.error("GET USERS ERROR:", err);
    res.status(500).json([]);
  }
});

/* =========================
   POST /users
========================= */
router.post("/", async (req, res) => {
  try {
    const { name, email, password, role, permissions } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ message: "بيانات ناقصة" });
    }

    const hashed = await bcrypt.hash(password, 10);

    await pool.query(
      `
      INSERT INTO users (name, email, password, role, permissions, status)
      VALUES (?,?,?,?,?, 'active')
      `,
      [name, email, hashed, role, permissions || "{}"]
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
    const { name, role, permissions } = req.body;

    await pool.query(
      `
      UPDATE users
      SET name=?, role=?, permissions=?
      WHERE id=?
      `,
      [name, role, permissions || "{}", req.params.id]
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
    await pool.query("DELETE FROM users WHERE id=?", [req.params.id]);
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
      "UPDATE users SET status='disabled' WHERE id=?",
      [req.params.id]
    );
    res.json({ success: true });
  } catch (err) {
    console.error("DISABLE USER ERROR:", err);
    res.status(500).json({ success: false });
  }
});

export default router;
