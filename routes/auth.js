console.log("GOOGLE_CLIENT_ID =", process.env.GOOGLE_CLIENT_ID);

import express from "express";
import db from "../db.js";
import { OAuth2Client } from "google-auth-library";

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

    // 🔐 Verify Google token
    const ticket = await googleClient.verifyIdToken({
      idToken: token,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    const email = payload?.email || null;
    const name = payload?.name || null;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email not provided by Google",
      });
    }

    // 🔍 Search customer
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
      // 🆕 New Google customer
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
        backup_phone: null,
        city_id: null,
        neighborhood_id: null,
        is_profile_complete: 0,
      };

      needProfile = true;
    }

    return res.json({
      success: true,
      customer,
      needProfile,
    });
  } catch (err) {
    console.error("GOOGLE LOGIN ERROR:", err);
    return res.status(401).json({
      success: false,
      message: "Google authentication failed",
    });
  }
});

/* ======================================================
   📱 تسجيل الدخول برقم الهاتف (OTP – Customers)
   ⚠️ التحقق من OTP يتم في Firebase (Frontend)
====================================================== */
router.post("/phone-login", async (req, res) => {
  try {
    const { phone } = req.body;

    if (!phone) {
      return res.status(400).json({
        success: false,
        message: "رقم الهاتف مطلوب",
      });
    }

    const [rows] = await db.query(
      `
      SELECT
        id,
        name,
        phone,
        email,
        backup_phone,
        city_id,
        neighborhood_id,
        is_profile_complete
      FROM customers
      WHERE phone = ?
      LIMIT 1
      `,
      [phone]
    );

    let customer;
    let needProfile = false;

    if (rows.length) {
      customer = rows[0];
      needProfile = customer.is_profile_complete === 0;
    } else {
      // 🆕 New phone customer
      const [result] = await db.query(
        `
        INSERT INTO customers (phone, is_profile_complete)
        VALUES (?, 0)
        `,
        [phone]
      );

      customer = {
        id: result.insertId,
        name: null,
        phone,
        email: null,
        backup_phone: null,
        city_id: null,
        neighborhood_id: null,
        is_profile_complete: 0,
      };

      needProfile = true;
    }

    res.json({
      success: true,
      customer,
      needProfile,
    });
  } catch (err) {
    console.error("PHONE LOGIN ERROR:", err);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});

export default router;
