import express from "express";
import db from "../db.js";
import PDFDocument from "pdfkit";

const router = express.Router();

/* ========================
   1. جلب جميع طرق الدفع (للإدارة)
   عرض البنوك مع الحسابات الافتراضية
======================== */
router.get("/", async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT 
        pm.*,
        b.name AS branch_name,
        a.name_ar AS account_name,
        CAST(pm.is_active AS UNSIGNED) AS is_active
      FROM payment_methods pm
      LEFT JOIN branches b ON b.id = pm.branch_id
      LEFT JOIN accounts a ON a.id = pm.account_id
      ORDER BY pm.sort_order ASC
    `);

    res.json({ success: true, methods: rows });
  } catch (err) {
    console.error("Get payment methods error:", err);
    res.status(500).json({ success: false });
  }
});

/* ========================
   2. جلب الطرق المفعّلة (مخصص لكل فرع) ✅
   هذا المسار يضمن أن كل فرع يحصل على الحساب المحاسبي الخاص به
======================== */
router.get("/active", async (req, res) => {
  try {
    const branchId = req.headers["x-branch-id"] || req.user?.branch_id;

    if (!branchId) {
      return res.status(400).json({ success: false, message: "رقم الفرع مطلوب" });
    }

    // جلب البنك مع الحساب المخصص للفرع من الجدول الوسيط
    // إذا لم يوجد ربط في branch_payment_accounts، يتم استخدام الحساب الافتراضي من جدول البنوك
    const [rows] = await db.query(`
      SELECT 
        pm.id, 
        pm.company, 
        pm.account_number, 
        pm.owner_name, 
        pm.address,
        IFNULL(bpa.account_id, pm.account_id) AS account_id
      FROM payment_methods pm
      LEFT JOIN branch_payment_accounts bpa ON bpa.payment_method_id = pm.id AND bpa.branch_id = ?
      WHERE pm.is_active = 1 
      AND (pm.branch_id IS NULL OR pm.branch_id = ?)
      ORDER BY pm.sort_order ASC
    `, [branchId, branchId]);

    res.json({ success: true, methods: rows });
  } catch (err) {
    console.error("❌ خطأ في جلب البنوك النشطة:", err);
    res.status(500).json({ success: false });
  }
});

/* ========================
   3. ربط بنك بحساب محاسبي لفرع معين ✅
   (جديد: لإدارة استقلال حسابات الفروع)
======================== */
router.post("/assign-branch-account", async (req, res) => {
  try {
    const { payment_method_id, branch_id, account_id } = req.body;

    await db.query(`
      INSERT INTO branch_payment_accounts (payment_method_id, branch_id, account_id)
      VALUES (?, ?, ?)
      ON DUPLICATE KEY UPDATE account_id = VALUES(account_id)
    `, [payment_method_id, branch_id, account_id]);

    res.json({ success: true, message: "تم ربط الحساب بالفرع بنجاح" });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/* ========================
   4. إضافة طريقة دفع جديدة
======================== */
router.post("/", async (req, res) => {
  try {
    const { company, account_number, owner_name, address, account_id, branch_id } = req.body;

    if (!account_id) {
      return res.json({ success: false, message: "يجب اختيار حساب فرعي افتراضي" });
    }

    await db.query(
      `INSERT INTO payment_methods
        (company, account_number, owner_name, address, account_id, branch_id, sort_order, is_active)
        VALUES (?, ?, ?, ?, ?, ?, 9999, 1)`,
      [company, account_number, owner_name, address, account_id, branch_id || null]
    );

    res.json({ success: true, message: "✅ تم إضافة طريقة الدفع" });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

/* ========================
   5. تعديل طريقة دفع
======================== */
router.put("/:id", async (req, res) => {
  try {
    const { company, account_number, owner_name, address, account_id, branch_id } = req.body;

    await db.query(
      `UPDATE payment_methods
        SET company=?, account_number=?, owner_name=?, address=?, account_id=?, branch_id=?
        WHERE id=?`,
      [company, account_number, owner_name, address, account_id, branch_id || null, req.params.id]
    );

    res.json({ success: true, message: "✅ تم التعديل" });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

/* ========================
   6. حذف طريقة دفع
======================== */
router.delete("/:id", async (req, res) => {
  try {
    await db.query("DELETE FROM payment_methods WHERE id=?", [req.params.id]);
    res.json({ success: true, message: "🗑️ تم الحذف" });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

/* ========================
   7. تفعيل / تعطيل (عبر PUT لحل مشاكل CORS)
======================== */
router.put("/:id/toggle", async (req, res) => {
  const { id } = req.params;
  const { is_active } = req.body;
  const status = is_active ? 1 : 0;
  const userId = req.user?.id || null;

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query("UPDATE payment_methods SET is_active=? WHERE id=?", [status, id]);
    await conn.query(
      "INSERT INTO payment_method_logs (payment_method_id, action, changed_by) VALUES (?, ?, ?)",
      [id, status === 1 ? "activate" : "deactivate", userId]
    );
    await conn.commit();
    res.json({ success: true, message: "تم تحديث الحالة بنجاح" });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ success: false });
  } finally {
    conn.release();
  }
});

/* ========================
   8. ترتيب بالسحب
======================== */
router.post("/reorder", async (req, res) => {
  const { orders } = req.body;
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    for (const o of orders) {
      await conn.query("UPDATE payment_methods SET sort_order=? WHERE id=?", [o.sort_order, o.id]);
    }
    await conn.commit();
    res.json({ success: true });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ success: false });
  } finally {
    conn.release();
  }
});

/* ========================
   9. تصدير PDF للسجلات
======================== */
router.get("/:id/logs/pdf", async (req, res) => {
  try {
    const { id } = req.params;
    const [logs] = await db.query(`
      SELECT l.action, l.created_at, u.name AS user_name
      FROM payment_method_logs l
      LEFT JOIN users u ON u.id = l.changed_by
      WHERE l.payment_method_id=?
      ORDER BY l.created_at DESC
    `, [id]);

    const doc = new PDFDocument({ margin: 40 });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", "attachment; filename=logs.pdf");
    doc.pipe(res);
    doc.fontSize(16).text("سجل تغييرات طرق الدفع", { align: "center" });
    doc.moveDown();
    logs.forEach((l) => {
      doc.fontSize(12).text(`${l.action === "activate" ? "تفعيل" : "تعطيل"} | ${l.user_name ?? "النظام"} | ${l.created_at}`);
    });
    doc.end();
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

export default router;
