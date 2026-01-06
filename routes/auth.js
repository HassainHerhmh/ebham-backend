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
   🔵 تسجيل الدخول عبر Google (جديد)
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
  audience: [process.env.GOOGLE_CLIENT_ID],
});


    const payload = ticket.getPayload();
    const email = payload.email;
    const name = payload.name;

    // البحث عن المستخدم
    const [rows] = await db.query(
      `
      SELECT id, name, email, phone, role, status
      FROM users
      WHERE email = ?
      `,
      [email]
    );

    let user;

    if (rows.length) {
      // مستخدم موجود
      user = rows[0];

      if (user.status !== "active") {
        return res.json({
          success: false,
          message: "الحساب معطل",
        });
      }
    } else {
      // مستخدم جديد
      const [result] = await db.query(
        `
        INSERT INTO users (name, email, role, status)
        VALUES (?, ?, 'customer', 'active')
        `,
        [name, email]
      );

      user = {
        id: result.insertId,
        name,
        email,
        phone: null,
        role: "customer",
        status: "active",
      };
    }

    res.json({
      success: true,
      user,
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
