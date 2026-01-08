console.log("GOOGLE_CLIENT_ID =", process.env.GOOGLE_CLIENT_ID);

import express from "express";
import db from "../db.js";
import { OAuth2Client } from "google-auth-library";
import crypto from "crypto";

const router = express.Router();
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

/* ======================================================
   🔐 تسجيل دخول لوحة التحكم (Admins / Staff)
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
    res.json({ success: true, user });
  } catch (err) {
    console.error("LOGIN ERROR:", err);
    res.status(500).json({ success: false });
  }
});

/* ======================================================
   🔵 تسجيل الدخول عبر Google (Customers)
====================================================== */
router.post("/google", async (req, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.json({ success: false, message: "Google token missing" });
    }

    const ticket = await googleClient.verifyIdToken({
      idToken: token,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    const email = payload?.email;
    const name = payload?.name;

    if (!email) {
      return res.json({ success: false, message: "Email not provided" });
    }

    const [rows] = await db.query(
      `
      SELECT id, name, email, phone, is_profile_complete
      FROM customers
      WHERE email = ?
      LIMIT 1
      `,
      [email]
    );

    let customer;
    let needProfile = false;

    if (rows.length) {
      customer = rows[0];
      needProfile = customer.is_profile_complete === 0;
    } else {
      const [result] = await db.query(
        `
        INSERT INTO customers (name, email, is_profile_complete)
        VALUES (?, ?, 0)
        `,
        [name, email]
      );

      customer = {
        id: result.insertId,
        name,
        email,
        phone: null,
        is_profile_complete: 0,
      };
      needProfile = true;
    }

    res.json({ success: true, customer, needProfile });
  } catch (err) {
    console.error("GOOGLE LOGIN ERROR:", err);
    res.json({ success: false, message: "Google auth failed" });
  }
});

/* ======================================================
   📱 OTP HELPERS
====================================================== */
function generateOtp() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function hashOtp(code) {
  return crypto.createHash("sha256").update(code).digest("hex");
}

/* ======================================================
   🔢 التحقق من OTP
====================================================== */
router.post("/verify-otp", async (req, res) => {
  try {
    let { phone, code } = req.body;

    if (!phone || !code) {
      return res.json({ success: false, message: "بيانات ناقصة" });
    }

    const normalizedPhone = phone.replace(/\s+/g, "").trim();
    const codeHash = hashOtp(code);

    /* =========================
       تحقق من الرمز
    ========================= */
    const [otpRows] = await db.query(
      `
      SELECT *
      FROM otp_codes
      WHERE phone = ?
        AND code_hash = ?
        AND expires_at > NOW()
      `,
      [normalizedPhone, codeHash]
    );

    if (!otpRows.length) {
      return res.json({
        success: false,
        message: "رمز غير صحيح أو منتهي",
      });
    }

    // 🧹 حذف الرمز
    await db.query(
      "DELETE FROM otp_codes WHERE phone = ?",
      [normalizedPhone]
    );

    /* =========================
       جلب أو إنشاء العميل
    ========================= */
    const [customers] = await db.query(
      `
      SELECT id, name, phone, is_profile_complete
      FROM customers
      WHERE phone = ?
      LIMIT 1
      `,
      [normalizedPhone]
    );

    let customer;
    let needProfile = false;

    if (customers.length) {
      customer = customers[0];
      needProfile = customer.is_profile_complete === 0;
    } else {
      const [result] = await db.query(
        `
        INSERT INTO customers (phone, is_profile_complete)
        VALUES (?, 0)
        `,
        [normalizedPhone]
      );

      customer = {
        id: result.insertId,
        phone: normalizedPhone,
        name: null,
        is_profile_complete: 0,
      };

      needProfile = true;
    }

    /* =========================
       الرد النهائي
    ========================= */
    res.json({
      success: true,
      customer,
      needProfile,
    });
  } catch (err) {
    console.error("VERIFY OTP ERROR:", err);
    res.status(500).json({ success: false });
  }
});


export default router;
