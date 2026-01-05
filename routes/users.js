import express from "express";
import bcrypt from "bcrypt";
import pool from "../db.js";

const router = express.Router();

/* جلب المستخدمين */
router.get("/", async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, name, email, phone, role, status, permissions
     FROM users
     ORDER BY id DESC`
  );
  res.json(rows);
});

/* إضافة مستخدم */
router.post("/", async (req, res) => {
  const { name, username, password, role, permissions } = req.body;

  const hashed = await bcrypt.hash(password, 10);

  await pool.query(
    `INSERT INTO users (name, email, password, role, permissions)
     VALUES ($1,$2,$3,$4,$5)`,
    [name, username, hashed, role, permissions]
  );

  res.json({ success: true });
});

/* حذف مستخدم */
router.delete("/:id", async (req, res) => {
  await pool.query(`DELETE FROM users WHERE id=$1`, [req.params.id]);
  res.json({ success: true });
});

export default router;
