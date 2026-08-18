import express from "express";
import db from "../db.js";
import { OAuth2Client } from "google-auth-library";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import authMiddleware from "../middlewares/auth.js"; // تأكد من استيراد ميدلوير التحقق
import { checkInUserAttendance } from "../utils/userAttendance.js";
import * as smsGateway from "../services/smsGateway.service.js";
import {
  generateOtpCode,
  getOtpExpiresAt,
  hashOtpCode,
} from "../utils/otp.js";
import {
  assertOtpNotBanned,
  getOtpBanStatus,
  recordOtpFailure,
  resetOtpSecurity,
  respondOtpBanned,
} from "../services/otpBan.service.js";
import { ensureCustomersI18nSchema } from "../utils/catalogI18n.js";
import { safeError } from "../utils/safeLog.js";
import {
  isPlayReviewLogin,
  isPlayReviewPhone,
  normalizePhone,
} from "../utils/playReview.js";

const router = express.Router();

// ✅ فحص السيرفر (Health Check)
router.get("/health", (req, res) => {
  res.json({
    success: true,
    message: "Server is running 🚀",
    time: new Date(),
  });
});

const googleClient = new OAuth2Client();

/* ======================================================
   🔐 تسجيل دخول لوحة التحكم (Admins / Staff)
====================================================== */
router.post("/login", async (req, res) => {
  try {
    const { identifier, password, website } = req.body;
    const invalidLoginMessage = "بيانات الدخول غير صحيحة";

    if (website) {
      return res.json({ success: false, message: invalidLoginMessage });
    }

    const [rows] = await db.query(
      `
      SELECT 
        u.id,
        u.name,
        u.email,
        u.phone,
        u.image_url,
        u.password,
        u.role,
        u.permissions,
        u.status,
        u.branch_id,
        u.agent_id,
        a.name AS agent_name,
        b.name AS branch_name,
        b.is_admin AS is_admin_branch
      FROM users u
      LEFT JOIN branches b ON b.id = u.branch_id
      LEFT JOIN agents a ON a.id = u.agent_id
      WHERE u.email = ? OR u.phone = ?
      LIMIT 1
      `,
      [identifier, identifier]
    );

    if (!rows.length) {
      return res.json({ success: false, message: invalidLoginMessage });
    }

    const user = rows[0];

    if (user.status !== "active") {
      return res.json({ success: false, message: "الحساب معطل" });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.json({ success: false, message: invalidLoginMessage });
    }

    const token = jwt.sign(
      {
        id: user.id,
        role: user.role,
        branch_id: user.branch_id,
        is_admin_branch: user.is_admin_branch === 1,
      },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    const attendanceSession = await checkInUserAttendance(
      user.id,
      user.branch_id || null
    );

    // (اختياري) تحديث آخر دخول للموظفين أيضاً إذا كان الجدول يدعم ذلك
    // await db.query("UPDATE users SET last_login = NOW() WHERE id = ?", [user.id]);

    delete user.password;

    res.json({
      success: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        image_url: user.image_url || null,
        role: user.role,
        status: user.status,
        branch_id: user.branch_id,
        branch_name: user.branch_name,
        permissions: user.permissions || null,
        agent_id: user.agent_id,
        agent_name: user.agent_name,
        is_admin_branch: user.is_admin_branch === 1,
        current_session_start: attendanceSession?.login_time || null,
        token,
      },
    });
  } catch (err) {
    console.error("LOGIN ERROR:", err?.message || err);
    res.status(500).json({ success: false, message: "SERVER_ERROR" });
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
      audience: process.env.GOOGLE_WEB_CLIENT_ID,
    });

    const payload = ticket.getPayload();

    if (!payload || !payload.email) {
      return res.json({ success: false, message: "Invalid Google token" });
    }

    const email = payload.email;

    const [rows] = await db.query(
      `SELECT id, email, name, name_en, phone, is_profile_complete
       FROM customers WHERE email = ? LIMIT 1`,
      [email]
    );

    let customer;

    if (rows.length) {
      customer = rows[0];
      // ✅ تحديث الحالة: متصل + وقت الدخول
      await db.query(
        "UPDATE customers SET is_online = 1, last_login = NOW() WHERE id = ?",
        [customer.id]
      );
    } else {
      // ✅ إنشاء عميل جديد (متصل تلقائياً)
      const [result] = await db.query(
        `INSERT INTO customers (email, is_profile_complete, is_online, last_login, created_at)
         VALUES (?, 0, 1, NOW(), NOW())`,
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

  const jwtToken = jwt.sign(
  {
    id: customer.id,
    role: "customer",
  },
  process.env.JWT_SECRET,
  { expiresIn: "30d" }
);

return res.json({
  success: true,
  token: jwtToken,   // ✅
  customer,
  needProfile: true,
});

  } catch (err) {
    console.error("❌ GOOGLE LOGIN ERROR FULL:", err?.message || err);
    return res.json({ success: false, message: "Google auth failed" });
  }
});

/* ======================================================
   🔢 التحقق من OTP (مع تحديث الحالة)
====================================================== */
router.post("/verify-otp", async (req, res) => {
  try {
    let { phone, code } = req.body;

    if (!phone || !code) {
      return res.json({ success: false, message: "بيانات ناقصة" });
    }

    const normalizedPhone = normalizePhone(phone);
    const isReviewLogin = isPlayReviewLogin(normalizedPhone, code);

    if (!isReviewLogin) {
      const activeBan = await getOtpBanStatus(db, normalizedPhone);
      if (activeBan) {
        return respondOtpBanned(res, activeBan);
      }

      const codeHash = hashOtpCode(code, normalizedPhone);

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
        const failure = await recordOtpFailure(db, normalizedPhone);
        if (failure.banned && failure.ban) {
          return respondOtpBanned(res, failure.ban);
        }
        return res.json({
          success: false,
          message: "رمز غير صحيح أو منتهي",
        });
      }

      // حذف الرمز بعد الاستخدام
      await db.query("DELETE FROM otp_codes WHERE phone = ?", [normalizedPhone]);
      await resetOtpSecurity(db, normalizedPhone);
    }

    // البحث عن العميل
    const [customers] = await db.query(
      `
      SELECT id, name, name_en, phone, is_profile_complete
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

      // ✅ تحديث الحالة: متصل + وقت الدخول
      await db.query(
        "UPDATE customers SET is_online = 1, last_login = NOW() WHERE id = ?",
        [customer.id]
      );
    } else {
      // ✅ عميل جديد: إنشاء مع تعيينه كـ متصل
      const [result] = await db.query(
        `
        INSERT INTO customers (phone, is_profile_complete, is_online, last_login, created_at)
        VALUES (?, 0, 1, NOW(), NOW())
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

    // 🔐 إنشاء JWT للعميل
const token = jwt.sign(
  {
    id: customer.id,
    role: "customer",
  },
  process.env.JWT_SECRET,
  {
    expiresIn: "30d",
  }
);

return res.json({
  success: true,
  token,        // ✅ مهم
  customer,
  needProfile,
});

  } catch (err) {
    safeError("VERIFY_OTP", err);
    return res.status(500).json({
      success: false,
      message: "SERVER_ERROR",
    });
  }
});

/* ======================================================
   📱 حالة بوابة SMS
====================================================== */
router.get("/sms-service", async (_req, res) => {
  try {
    const status = await smsGateway.getSmsServiceStatus();
    return res.json({ smsService: { available: status.available } });
  } catch (err) {
    console.error("SMS service status error:", err?.message || err);
    return res.json({ smsService: { available: false } });
  }
});

/* ======================================================
   🔢 إرسال OTP
====================================================== */
router.post("/send-otp", async (req, res) => {
  try {
    const { phone } = req.body;

    if (!phone) {
      return res.json({ success: false, message: "رقم الهاتف مطلوب" });
    }

    const normalizedPhone = normalizePhone(phone);

    if (isPlayReviewPhone(normalizedPhone)) {
      return res.json({
        success: true,
        message: "تم إرسال رمز التحقق بنجاح",
      });
    }

    try {
      await assertOtpNotBanned(db, normalizedPhone);
    } catch (banErr) {
      if (banErr.code === "OTP_BANNED") {
        return respondOtpBanned(res, banErr.ban);
      }
      throw banErr;
    }

    const code = generateOtpCode();
    const codeHash = hashOtpCode(code, normalizedPhone);
    const expiresAt = getOtpExpiresAt();

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

    try {
      await smsGateway.queueSms({
        recipientPhone: normalizedPhone,
        message: smsGateway.buildOtpMessage(code),
        smsType: "otp",
      });
    } catch (smsErr) {
      safeError("SMS_QUEUE", smsErr);
    }

    return res.json({
      success: true,
      message: "تم إرسال رمز التحقق بنجاح",
    });
  } catch (err) {
    safeError("SEND_OTP", err);
    return res.status(500).json({
      success: false,
      message: "SERVER_ERROR",
    });
  }
});

/* ======================================================
   🚪 تسجيل الخروج (تحديث الحالة إلى Offline)
====================================================== */
router.post("/logout", authMiddleware, async (req, res) => {
  try {
    // نفترض أن authMiddleware يضيف user object إلى الـ req
    // وأن user.id هو معرف العميل (أو المستخدم)
    if (!req.user || !req.user.id) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    // ✅ تحديث الحالة إلى غير متصل
    // ملاحظة: هذا الاستعلام يعمل للعملاء. إذا كان المستخدم موظفاً، قد تحتاج لجدول users
    // ولكن بما أن طلبك يركز على "حالة العملاء"، سنحدث جدول customers
    
    // يمكننا التحقق من الدور إذا كان الـ Middleware يمرره، لكن للأمان سنحاول التحديث في customers
    await db.query("UPDATE customers SET is_online = 0 WHERE id = ?", [
      req.user.id,
    ]);

    res.json({ success: true, message: "تم تسجيل الخروج" });
  } catch (err) {
    console.error("❌ LOGOUT ERROR:", err?.message || err);
    res.status(500).json({ success: false, message: "SERVER_ERROR" });
  }
});


router.get("/me", authMiddleware, async (req, res) => {
  try {
    await ensureCustomersI18nSchema();
    const [rows] = await db.query(
      `
      SELECT id, name, name_en, phone, email, is_profile_complete, created_at, language
      FROM customers
      WHERE id = ?
      LIMIT 1
      `,
      [req.user.id]
    );

    if (!rows.length) {
      return res.status(404).json({
        success: false,
        message: "المستخدم غير موجود",
      });
    }

    return res.json({
      success: true,
      customer: rows[0],
    });
  } catch (err) {
    console.error("GET ME ERROR:", err?.message || err);
    return res.status(500).json({
      success: false,
      message: "SERVER_ERROR",
    });
  }
});

async function safeDeleteByCustomerRef(connection, table, customerId) {
  for (const column of ["customer_id", "user_id"]) {
    try {
      await connection.query(
        `DELETE FROM \`${table}\` WHERE \`${column}\` = ?`,
        [customerId]
      );
      return;
    } catch (err) {
      if (err.code === "ER_BAD_FIELD_ERROR") continue;
      if (err.code === "ER_NO_SUCH_TABLE") return;
      throw err;
    }
  }
}

async function deleteCustomerAccountById(customerId) {
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    const [customers] = await connection.query(
      `
      SELECT id, phone, is_active
      FROM customers
      WHERE id = ?
      LIMIT 1
      FOR UPDATE
      `,
      [customerId]
    );

    if (!customers.length) {
      const error = new Error("NOT_FOUND");
      error.code = "NOT_FOUND";
      throw error;
    }

    const customer = customers[0];
    const phone = String(customer.phone || "").trim();

    if (
      Number(customer.is_active) === 0 &&
      phone.startsWith("deleted_")
    ) {
      const error = new Error("ALREADY_DELETED");
      error.code = "ALREADY_DELETED";
      throw error;
    }

    const anonymizedPhone = `deleted_${customerId}_${Date.now()}`;

    await connection.query(
      `DELETE FROM customer_addresses WHERE customer_id = ?`,
      [customerId]
    );

    if (phone) {
      await connection.query(`DELETE FROM otp_codes WHERE phone = ?`, [phone]);
    }

    await safeDeleteByCustomerRef(connection, "loyalty_points", customerId);
    await safeDeleteByCustomerRef(connection, "loyalty_logs", customerId);

    try {
      const [chats] = await connection.query(
        `SELECT id FROM support_chats WHERE customer_id = ?`,
        [customerId]
      );

      for (const chat of chats) {
        await connection.query(
          `DELETE FROM support_chat_messages WHERE chat_id = ?`,
          [chat.id]
        );
      }

      await connection.query(`DELETE FROM support_chats WHERE customer_id = ?`, [
        customerId,
      ]);
    } catch (err) {
      if (err.code !== "ER_NO_SUCH_TABLE" && err.code !== "ER_BAD_FIELD_ERROR") {
        throw err;
      }
    }

    await connection.query(
      `
      UPDATE customers
      SET
        name = ?,
        phone = ?,
        phone_alt = NULL,
        email = NULL,
        password = NULL,
        is_profile_complete = 0,
        is_online = 0,
        is_active = 0,
        neighborhood_id = NULL,
        last_active_at = NULL
      WHERE id = ?
      `,
      [`Deleted User ${customerId}`, anonymizedPhone, customerId]
    );

    await connection.commit();
    return { customerId, anonymizedPhone };
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}

/* ======================================================
   🗑️ حذف حساب العميل (داخل التطبيق)
   - يحذف البيانات الشخصية والعناوين
   - يحتفظ بسجلات الطلبات للمحاسبة/القانون
====================================================== */
async function handleAccountDeletion(req, res) {
  try {
    if (!req.user || req.user.role !== "customer") {
      return res.status(403).json({
        success: false,
        message: "غير مصرح",
      });
    }

    await deleteCustomerAccountById(req.user.id);

    return res.json({
      success: true,
      message: "تم حذف الحساب بنجاح",
    });
  } catch (err) {
    if (err.code === "NOT_FOUND") {
      return res.status(404).json({
        success: false,
        message: "المستخدم غير موجود",
      });
    }

    if (err.code === "ALREADY_DELETED") {
      return res.json({
        success: true,
        message: "تم حذف الحساب مسبقاً",
      });
    }

    console.error("ACCOUNT DELETION ERROR:", err);
    return res.status(500).json({
      success: false,
      message: "SERVER_ERROR",
    });
  }
}

router.delete("/account", authMiddleware, handleAccountDeletion);
router.post("/account-deletion/request", authMiddleware, handleAccountDeletion);

export default router;
