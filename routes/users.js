import express from "express";
import pool from "../db.js";
import bcrypt from "bcrypt";

const router = express.Router();

/* =========================
   GET /users
========================= */
router.get("/", async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT id, name, email, phone, role, status FROM users ORDER BY id DESC"
    );

    res.json(rows);
  } catch (err) {
    console.error("GET USERS ERROR:", err);
    res.status(500).json({ success: false });
  }
});

/* =========================
   POST /users
========================= */
router.post("/", async (req, res) => {
  try {
    const { name, username, password, role, permissions } = req.body;

    if (!name || !username || !password) {
      return res.status(400).json({ message: "بيانات ناقصة" });
    }

    const hashed = await bcrypt.hash(password, 10);

    await pool.query(
      `
      INSERT INTO users (name, email, password, role, permissions, status)
      VALUES ($1,$2,$3,$4,$5,'active')
      `,
      [name, username, hashed, role, permissions || "{}"]
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
      SET name=$1, role=$2, permissions=$3
      WHERE id=$4
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
    await pool.query("DELETE FROM users WHERE id=$1", [req.params.id]);
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
      "UPDATE users SET status='disabled' WHERE id=$1",
      [req.params.id]
    );
    res.json({ success: true });
  } catch (err) {
    console.error("DISABLE USER ERROR:", err);
    res.status(500).json({ success: false });
  }
});

export default router;
