// routes/auth.js
import express from "express";
import pool from "../db.js";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

const router = express.Router();

/* =========================
   POST /login
========================= */
router.post("/login", async (req, res) => {
  try {
    const { identifier, password } = req.body;

    if (!identifier || !password) {
      return res.status(400).json({ message: "بيانات ناقصة" });
    }

    const { rows } = await pool.query(
      `
      SELECT id, name, email, phone, password, role, permissions, status
      FROM users
      WHERE email=$1 OR phone=$1
      `,
      [identifier]
    );

    if (!rows.length) {
      return res.status(401).json({ message: "المستخدم غير موجود" });
    }

    const user = rows[0];

    if (user.status !== "active") {
      return res.status(403).json({ message: "الحساب معطل" });
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return res.status(401).json({ message: "كلمة المرور غير صحيحة" });
    }

    const token = jwt.sign(
      {
        id: user.id,
        role: user.role,
        permissions: user.permissions,
      },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    delete user.password;

    res.json({
      success: true,
      user: { ...user, token },
    });
  } catch (err) {
    console.error("LOGIN ERROR:", err);
    res.status(500).json({ message: "خطأ في السيرفر" });
  }
});

export default router;
