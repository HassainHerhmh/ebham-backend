import express from "express";
import db from "../db.js";
import auth from "../middlewares/auth.js";
import { ensureCustomersI18nSchema } from "../utils/catalogI18n.js";

const router = express.Router();

/* =========================
   POST /customers/public  (للتطبيق - تسجيل جديد)
========================= */
router.post("/public", async (req, res) => {
  try {
    await ensureCustomersI18nSchema();
    const { name, name_en, phone, email, password, branch_id } = req.body;

    if (!name || !phone || !branch_id) {
      return res.json({ success: false, message: "بيانات ناقصة" });
    }

    // عند التسجيل الجديد، نعتبر العميل نشطاً ومتصلاً
    const [result] = await db.query(
      `
      INSERT INTO customers (name, name_en, phone, email, password, branch_id, created_at, is_active, last_active_at, last_login)
      VALUES (?, ?, ?, ?, ?, ?, NOW(), 1, NOW(), NOW())
      `,
      [name, name_en || null, phone, email || null, password || null, branch_id]
    );

    res.json({ success: true, id: result.insertId });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      return res.json({
        success: false,
        message: "رقم الجوال مستخدم مسبقًا، الرجاء إدخال رقم آخر",
      });
    }

    console.error("ADD CUSTOMER PUBLIC ERROR:", err?.message || err);
    res.status(500).json({ success: false, message: "خطأ في السيرفر" });
  }
});

/* =========================
   PUT /customers/public/:id  (للتطبيق - تحديث الملف الشخصي)
========================= */
/* تحديث المسار في السيرفر ليكون مرناً */
router.put("/public/:id", async (req, res) => {
  try {
    await ensureCustomersI18nSchema();
    const { name, name_en, email, branch_id, neighborhood_id, is_profile_complete } = req.body;

    // الشرط الوحيد الإلزامي هو الاسم (لأنه لا يمكن أن يكون فارغاً)
    if (!name) {
      return res.json({ success: false, message: "الاسم مطلوب" });
    }

    const fields = [
      "name = ?",
      "email = ?",
      "branch_id = IFNULL(?, branch_id)",
      "neighborhood_id = IFNULL(?, neighborhood_id)",
      "is_profile_complete = ?",
    ];
    const values = [
      name,
      email || null,
      branch_id || null,
      neighborhood_id || null,
      is_profile_complete ? 1 : 0,
    ];

    if (name_en !== undefined) {
      fields.splice(1, 0, "name_en = ?");
      values.splice(1, 0, name_en || null);
    }

    await db.query(
      `
      UPDATE customers
      SET ${fields.join(", ")}
      WHERE id = ?
      `,
      [...values, req.params.id]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("UPDATE ERROR:", err?.message || err);
    res.status(500).json({ success: false, message: "خطأ في السيرفر" });
  }
});

/* =========================
   🛡️ حماية كل المسارات التالية
========================= */
router.use(auth);

/* =========================
   💓 POST /customers/heartbeat
   (يستدعيه التطبيق كل دقيقة لتحديث آخر ظهور)
========================= */
router.post("/heartbeat", async (req, res) => {
  try {
    // نفترض أن العميل مسجل دخول والتوكن سليم
    const userId = req.user.id;
    
    // تحديث وقت آخر نشاط فقط
    await db.query("UPDATE customers SET last_active_at = NOW() WHERE id = ?", [userId]);
    
    res.json({ success: true });
  } catch (err) {
    // لا نرجع خطأ 500 هنا لتجنب إزعاج التطبيق، فقط false
    res.json({ success: false });
  }
});

/* =========================
   📋 GET /customers
   (حساب الحالة online/offline بناءً على الوقت)
========================= */
/* =========================
   📋 GET /customers
========================= */
router.get("/", async (req, res) => {
  try {

    const user = req.user;

    const selectQuery = `
      SELECT
        c.*,
        b.name AS branch_name,

        DATE_FORMAT(c.last_login, '%Y-%m-%d %H:%i:%s') AS last_login,

        DATE_FORMAT(c.created_at, '%Y-%m-%d') AS register_date,

        COUNT(o.id) AS orders_count,

        MAX(o.created_at) AS last_order_date,

        CASE
          WHEN c.last_active_at >= NOW() - INTERVAL 2 MINUTE
          THEN 1
          ELSE 0
        END AS is_online_calculated

      FROM customers c

      LEFT JOIN branches b
        ON b.id = c.branch_id

      LEFT JOIN orders o
        ON o.customer_id = c.id
    `;

    const orderBy = "ORDER BY c.last_active_at DESC, c.id DESC";

    /* ===== إدارة عامة ===== */
    if (user.is_admin_branch === 1 || user.is_admin_branch === true) {

      const [rows] = await db.query(`
        ${selectQuery}
        GROUP BY c.id
        ${orderBy}
      `);

      return res.json({
        success: true,
        mode: "admin",
        customers: rows,
      });
    }

    /* ===== فرع عادي ===== */
    if (!user.branch_id) {
      return res.json({ success: true, customers: [] });
    }

    const [rows] = await db.query(
      `
      ${selectQuery}
      WHERE c.branch_id = ?
      GROUP BY c.id
      ${orderBy}
      `,
      [user.branch_id]
    );

    return res.json({
      success: true,
      mode: "branch",
      customers: rows,
    });

  } catch (err) {

    console.error("GET CUSTOMERS ERROR:", err?.message || err);

    res.status(500).json({
      success: false,
      message: "فشل تحميل العملاء",
    });
  }
});

/* =========================
   ➕ POST /customers (إضافة عميل من لوحة التحكم)
========================= */
router.post("/", async (req, res) => {
  try {
    const { name, phone, phone_alt, email, password } = req.body;
    if (!name || !phone) {
      return res.json({ success: false, message: "الاسم والجوال مطلوبان" });
    }

    const { is_admin_branch, branch_id } = req.user;
    let selectedBranch = req.headers["x-branch-id"];
    let finalBranchId = branch_id;

    if (is_admin_branch && selectedBranch && selectedBranch !== "all") {
      finalBranchId = Number(selectedBranch);
    }

    // افتراضياً العميل المضاف يدوياً يكون نشطاً ولكن ليس متصلاً (last_active_at = NULL)
    await db.query(
      `
      INSERT INTO customers (name, phone, phone_alt, email, password, branch_id, created_at, is_active)
      VALUES (?, ?, ?, ?, ?, ?, NOW(), 1)
      `,
      [
        name,
        phone,
        phone_alt || null,
        email || null,
        password || null,
        finalBranchId,
      ]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("ADD CUSTOMER ERROR:", err?.message || err);
    res.status(500).json({ success: false });
  }
});

/* =========================
   ✏️ PUT /customers/:id
========================= */
router.put("/:id", async (req, res) => {
  await ensureCustomersI18nSchema();
  const { name, name_en, phone, phone_alt, email, is_active } = req.body;

  const fields = [];
  const values = [];

  if (name !== undefined) {
    fields.push("name=?");
    values.push(name);
  }
  if (name_en !== undefined) {
    fields.push("name_en=?");
    values.push(name_en || null);
  }
  if (phone !== undefined) {
    fields.push("phone=?");
    values.push(phone);
  }
  if (phone_alt !== undefined) {
    fields.push("phone_alt=?");
    values.push(phone_alt);
  }
  if (email !== undefined) {
    fields.push("email=?");
    values.push(email);
  }
  if (is_active !== undefined) {
    fields.push("is_active=?");
    values.push(is_active);
  }

  if (!fields.length) {
    return res.json({ success: false, message: "لا توجد بيانات للتحديث" });
  }

  try {
    await db.query(
      `
      UPDATE customers
      SET ${fields.join(", ")}
      WHERE id=?
      `,
      [...values, req.params.id]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("UPDATE CUSTOMER ERROR:", err?.message || err);
    res.status(500).json({ success: false });
  }
});

/* =========================
   🗑️ DELETE /customers/:id
========================= */
router.delete("/:id", async (req, res) => {
  try {
    await db.query("DELETE FROM customers WHERE id=?", [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error("DELETE CUSTOMER ERROR:", err?.message || err);
    res.status(500).json({ success: false });
  }
});

/* =========================
   🔄 POST /customers/:id/toggle (تعطيل/تفعيل الحساب)
========================= */
router.post("/:id/toggle", async (req, res) => {
  try {
    const [rows] = await db.query(
      "SELECT is_active FROM customers WHERE id=?",
      [req.params.id]
    );

    if (!rows.length) {
      return res.json({ success: false, message: "العميل غير موجود" });
    }

    const newStatus = rows[0].is_active ? 0 : 1;

    await db.query(
      "UPDATE customers SET is_active=? WHERE id=?",
      [newStatus, req.params.id]
    );

    res.json({ success: true, is_active: newStatus });
  } catch (err) {
    console.error("TOGGLE CUSTOMER ERROR:", err?.message || err);
    res.status(500).json({ success: false });
  }
});

/* =========================
   🔑 POST /customers/:id/reset-password
========================= */
router.post("/:id/reset-password", async (req, res) => {
  try {
    const generatePassword = (length = 8) => {
      const chars =
        "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
      let pass = "";
      for (let i = 0; i < length; i++) {
        pass += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      return pass;
    };

    const newPassword = generatePassword(8);

    await db.query(
      "UPDATE customers SET password=? WHERE id=?",
      [newPassword, req.params.id]
    );

    res.json({
      success: true,
      password: newPassword,
    });
  } catch (err) {
    console.error("RESET PASSWORD ERROR:", err?.message || err);
    res.status(500).json({ success: false });
  }
});

/* =========================
   👋 POST /customers/logout
========================= */
router.post("/logout", auth, async (req, res) => {
  try {
    const customerId = req.user.id; 

    // عند تسجيل الخروج يدوياً، نصفر وقت آخر نشاط ليظهر كغير متصل فوراً
    // ملاحظة: يمكن أيضاً استخدام حقل is_online القديم إذا أردت، لكن الاعتماد على الوقت أدق
    // هنا سنقوم بتحديث last_active_at إلى وقت قديم جداً ليصبح offline فوراً
    await db.query(
      "UPDATE customers SET last_active_at = NULL WHERE id = ?",
      [customerId]
    );

    res.json({ success: true, message: "تم تسجيل الخروج" });
  } catch (err) {
    console.error("LOGOUT ERROR:", err?.message || err);
    res.status(500).json({ success: false });
  }
});

export default router;
