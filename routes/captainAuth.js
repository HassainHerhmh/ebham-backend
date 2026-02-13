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
    return res.status(400).json({
      success: false,
      message: "رقم الجوال وكلمة المرور مطلوبة",
    });
  }

  try {
    // 1. جلب الكابتن
    const [rows] = await db.query(
      "SELECT * FROM captains WHERE phone=? LIMIT 1",
      [phone]
    );

    if (!rows.length) {
      return res.status(401).json({
        success: false,
        message: "الحساب غير موجود",
      });
    }

    const captain = rows[0];

    // 2. التحقق من كلمة المرور
    let passwordValid = false;

    // لو قديم (بدون تشفير)
    if (captain.password.length < 40) {
      passwordValid = password === captain.password;
    }
    // لو مشفر
    else {
      passwordValid = await bcrypt.compare(password, captain.password);
    }

    if (!passwordValid) {
      return res.status(401).json({
        success: false,
        message: "كلمة المرور غير صحيحة",
      });
    }

    // 3. إنشاء التوكن
    const token = jwt.sign(
      {
        id: captain.id,
        role: "captain",
        branch_id: captain.branch_id,
      },
      process.env.JWT_SECRET,
      {
        expiresIn: "30d",
      }
    );

    // 4. الرد
    res.json({
      success: true,
      token,

      captain: {
        id: captain.id,
        name: captain.name,
        phone: captain.phone,
        status: captain.status,
        branch_id: captain.branch_id,
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
