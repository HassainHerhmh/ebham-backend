import express from "express";
import db from "../db.js";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";

const router = express.Router();

/* ======================
   Captain Login
====================== */
router.post("/login", async (req, res) => {
  const { phone, password } = req.body;

  if (!phone || !password) {
    return res.json({
      success: false,
      message: "رقم الجوال وكلمة المرور مطلوبة",
    });
  }

  try {
    const [rows] = await db.query(
      "SELECT * FROM captains WHERE phone=? LIMIT 1",
      [phone]
    );

    if (!rows.length) {
      return res.json({
        success: false,
        message: "الحساب غير موجود",
      });
    }

    const captain = rows[0];

    // لو مخزن بدون تشفير (حالياً)
    if (password !== captain.password) {
      return res.json({
        success: false,
        message: "كلمة المرور غير صحيحة",
      });
    }

    // Token
    const token = jwt.sign(
      {
        id: captain.id,
        role: "captain",
        branch_id: captain.branch_id,
      },
      process.env.JWT_SECRET,
      { expiresIn: "30d" }
    );

    res.json({
      success: true,
      token,
      captain: {
        id: captain.id,
        name: captain.name,
        phone: captain.phone,
        status: captain.status,
      },
    });

  } catch (err) {
    console.error("CAPTAIN LOGIN ERROR:", err);
    res.status(500).json({
      success: false,
      message: "فشل تسجيل الدخول",
    });
  }
});

export default router;
