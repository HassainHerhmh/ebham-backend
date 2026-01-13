console.log("GOOGLE_WEB_CLIENT_ID =", process.env.GOOGLE_WEB_CLIENT_ID);

console.log("GOOGLE_CLIENT_ID =", process.env.GOOGLE_CLIENT_ID);

import express from "express";
import db from "../db.js";
import { OAuth2Client } from "google-auth-library";
import crypto from "crypto";

const router = express.Router();
const googleClient = new OAuth2Client();


/* ======================================================
   🔐 تسجيل دخول لوحة التحكم (Admins / Staff)
====================================================== */
router.post("/login", async (req, res) => {
  const { identifier, password } = req.body;

  try {
    const [rows] = await db.query(
      `
      SELECT 
        u.id,
        u.name,
        u.email,
        u.phone,
        u.password,
        u.role,
        u.status,
        u.branch_id,
        b.is_admin AS is_admin_branch,
        b.name AS branch_name
      FROM users u
      LEFT JOIN branches b ON u.branch_id = b.id
      WHERE u.email = ? OR u.phone = ?
      LIMIT 1
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

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) {
      return res.json({ success: false, message: "كلمة المرور غير صحيحة" });
    }

    delete user.password;

    res.json({
      success: true,
      user: {
        ...user,
        is_admin_branch: Number(user.is_admin_branch || 0),
      },
    });
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
      audience: process.env.GOOGLE_WEB_CLIENT_ID, // فقط Web Client ID
    });


    const payload = ticket.getPayload();

    if (!payload || !payload.email) {
      return res.json({ success: false, message: "Invalid Google token" });
    }

    const email = payload.email;

    const [rows] = await db.query(
      `SELECT id, email, name, phone, is_profile_complete
       FROM customers WHERE email = ? LIMIT 1`,
      [email]
    );

    let customer;

    if (rows.length) {
      customer = rows[0];
    } else {
      const [result] = await db.query(
        `INSERT INTO customers (email, is_profile_complete)
         VALUES (?, 0)`,
        [email]
      );

      customer = {
        id: result.insertId,
        email,
        name: null,
        phone: null,
        is_profile_complete: 0,
      };
    }

    return res.json({
      success: true,
      customer,
      needProfile: true,
    });

 } catch (err) {
  console.error("❌ GOOGLE LOGIN ERROR FULL:", err?.message || err);
  return res.json({ success: false, message: "Google auth failed" });
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
   🔢 التحقق من OTP (نسخة مستقرة)
====================================================== */
router.post("/verify-otp", async (req, res) => {
  try {
    let { phone, code } = req.body;

    if (!phone || !code) {
      return res.json({
        success: false,
        message: "بيانات ناقصة",
      });
    }

    const normalizedPhone = phone.replace(/\s+/g, "").trim();
    const codeHash = hashOtp(code);

    const [otpRows] = await db.query(
      `
      SELECT id
      FROM otp_codes
      WHERE phone = ?
        AND code_hash = ?
        AND expires_at > NOW()
      LIMIT 1
      `,
      [normalizedPhone, codeHash]
    );

    if (!otpRows.length) {
      return res.json({
        success: false,
        message: "رمز غير صحيح أو منتهي",
      });
    }

    await db.query("DELETE FROM otp_codes WHERE phone = ?", [normalizedPhone]);

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

    return res.json({
      success: true,
      customer,
      needProfile,
    });
  } catch (err) {
    console.error("❌ VERIFY OTP ERROR:", err);
    return res.status(500).json({
      success: false,
      message: "SERVER_ERROR",
    });
  }
}); // ← هنا نغلق verify-otp بالكامل ✅


/* ======================================================
   🔢 إرسال OTP (نسخة متوافقة مع التطبيق)
====================================================== */
router.post("/send-otp", async (req, res) => {
  try {
    const { phone } = req.body;

    if (!phone) {
      return res.json({
        success: false,
        message: "رقم الهاتف مطلوب",
      });
    }

    const normalizedPhone = phone.replace(/\s+/g, "").trim();
    const code = generateOtp();
    const codeHash = hashOtp(code);
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    await db.query(
      `
      INSERT INTO otp_codes (phone, code_hash, expires_at)
      VALUES (?, ?, ?)
      ON DUPLICATE KEY UPDATE 
        code_hash = VALUES(code_hash),
        expires_at = VALUES(expires_at)
      `,
      [normalizedPhone, codeHash, expiresAt]
    );

    console.log(`📲 OTP for ${normalizedPhone}: ${code}`);

    return res.json({
      success: true,
      message: "تم إرسال رمز التحقق بنجاح",
    });
  } catch (err) {
    console.error("❌ SEND OTP ERROR:", err);
    return res.status(500).json({
      success: false,
      message: "SERVER_ERROR",
    });
  }
});


export default router;
