console.log("GOOGLE_CLIENT_ID =", process.env.GOOGLE_CLIENT_ID);

import express from "express";
import db from "../db.js";
import { OAuth2Client } from "google-auth-library";



const router = express.Router();

const googleClient = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID
);

/* ======================================================
   🔐 تسجيل دخول لوحة التحكم (موجود – لم نلمسه)
====================================================== */
router.post("/login", async (req, res) => {
  const { identifier, password } = req.body;

  try {
    const [rows] = await db.query(
      `
      SELECT id, name, email, phone, password, role, status
      FROM users
      WHERE email = ? OR phone = ?
      `,
      [identifier, identifier]
    );

    if (!rows.length) {
      return res.json({ success: false, message: "المستخدم غير موجود" });
    }

    const user = rows[0];

    if (user.status !== "active") {
      return res.json({ success: false, message: "الحساب معطل" });
    }

    if (user.password !== password) {
      return res.json({ success: false, message: "كلمة المرور غير صحيحة" });
    }

    delete user.password;

    res.json({
      success: true,
      user,
    });
  } catch (err) {
    console.error("LOGIN ERROR:", err);
    res.status(500).json({ success: false });
  }
});

/* ======================================================
   🔵 تسجيل الدخول عبر Google (Customers فقط)
====================================================== */
router.post("/google", async (req, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({
        success: false,
        message: "Google token missing",
      });
    }

    // التحقق من Google
    const ticket = await googleClient.verifyIdToken({
      idToken: token,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    const email = payload.email;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email not provided by Google",
      });
    }

    // 🔍 البحث في جدول customers فقط
    const [rows] = await db.query(
      `
      SELECT
        id,
        name,
        email,
        phone,
        backup_phone,
        city_id,
        neighborhood_id,
        is_profile_complete
      FROM customers
      WHERE email = ?
      `,
      [email]
    );

    let customer;

    if (rows.length) {
      // ✅ مستخدم موجود
      customer = rows[0];
    } else {
      // 🆕 مستخدم جديد (Google)
      const [result] = await db.query(
        `
        INSERT INTO customers (email, is_profile_complete)
        VALUES (?, 0)
        `,
        [email]
      );

      customer = {
        id: result.insertId,
        email,
        name: null,
        phone: null,
        backup_phone: null,
        city_id: null,
        neighborhood_id: null,
        is_profile_complete: 0,
      };
    }

    res.json({
      success: true,
      customer,
      needProfile: customer.is_profile_complete === 0,
    });

  } catch (err) {
    console.error("GOOGLE LOGIN ERROR:", err);
    res.status(401).json({
      success: false,
      message: "Google authentication failed",
    });
  }
});


export default router;
