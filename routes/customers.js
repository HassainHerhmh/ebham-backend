import express from "express";
import db from "../db.js";
import bcrypt from "bcrypt";

const router = express.Router();

/* =========================
   GET /customers
========================= */
router.get("/", async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT id, name, phone, email, created_at
      FROM customers
      ORDER BY id DESC
    `);

    res.json({ success: true, customers: rows });
  } catch (err) {
    console.error("GET CUSTOMERS ERROR:", err);
    res.status(500).json({ success: false });
  }
});

/* =========================
   POST /customers
========================= */
router.put("/:id", async (req, res) => {
  const { name, phone, email, is_profile_complete } = req.body;

  try {
    await db.query(
      `
      UPDATE customers
      SET name = ?, phone = ?, email = ?, is_profile_complete = ?
      WHERE id = ?
      `,
      [
        name,
        phone,
        email || null,
        is_profile_complete ?? 0,
        req.params.id,
      ]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("UPDATE CUSTOMER ERROR:", err);
    res.status(500).json({ success: false });
  }
});

/* =========================
   PUT /customers/:id
========================= */
router.put("/:id", async (req, res) => {
  const { name, phone, email } = req.body;

  try {
    await db.query(
      `
      UPDATE customers
      SET name=?, phone=?, email=?
      WHERE id=?
      `,
      [name, phone, email || null, req.params.id]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("UPDATE CUSTOMER ERROR:", err);
    res.status(500).json({ success: false });
  }
});

/* =========================
   DELETE /customers/:id
========================= */
router.delete("/:id", async (req, res) => {
  try {
    await db.query("DELETE FROM customers WHERE id=?", [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error("DELETE CUSTOMER ERROR:", err);
    res.status(500).json({ success: false });
  }
});

/* =========================
   PUT /customers/:id/reset-password
========================= */
router.put("/:id/reset-password", async (req, res) => {
  try {
    const newPass = Math.random().toString(36).slice(-8);
    const hashed = await bcrypt.hash(newPass, 10);

    await db.query(
      "UPDATE customers SET password=? WHERE id=?",
      [hashed, req.params.id]
    );

    res.json({ success: true, new_password: newPass });
  } catch (err) {
    console.error("RESET PASSWORD ERROR:", err);
    res.status(500).json({ success: false });
  }
});

export default router;
