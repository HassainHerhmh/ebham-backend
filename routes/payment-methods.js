import express from "express";
import db from "../db.js";
import PDFDocument from "pdfkit";

const router = express.Router();

/* ========================
   جلب جميع طرق الدفع (للإدارة)
======================== */
router.get("/", async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT 
        id,
        company,
        account_number,
        owner_name,
        address,
        account_id,
        CAST(is_active AS UNSIGNED) AS is_active,
        sort_order
      FROM payment_methods
      ORDER BY sort_order ASC
    `);

    res.json({ success: true, methods: rows });
  } catch (err) {
    console.error("Get payment methods error:", err);
    res.status(500).json({ success: false });
  }
});

/* ========================
   جلب الطرق المفعّلة فقط - نسخة محسنة
======================== */
router.get("/active", async (req, res) => {
  try {
    // التأكد من جلب الحقول التي نحتاجها في الـ Frontend (شركة، رقم حساب، اسم المالك)
    const [rows] = await db.query(`
      SELECT 
        id, 
        company, 
        account_number, 
        owner_name, 
        address
      FROM payment_methods 
      WHERE is_active = 1
      ORDER BY sort_order ASC
    `);

    console.log("✅ البنوك النشطة المستخرجة:", rows.length); // للفحص في السيرفر
    res.json({ success: true, methods: rows });
  } catch (err) {
    console.error("❌ خطأ في جلب البنوك:", err);
    res.status(500).json({ success: false, message: "Internal Server Error" });
  }
});
/* ========================
   إضافة طريقة دفع
======================== */
router.post("/", async (req, res) => {
  try {
    const { company, account_number, owner_name, address, account_id } = req.body;

    if (!account_id) {
      return res.json({ success: false, message: "يجب اختيار حساب فرعي" });
    }

    // التحقق أن الحساب فرعي
    const [[acc]] = await db.query(
      "SELECT id FROM accounts WHERE id=? AND parent_id IS NOT NULL",
      [account_id]
    );

    if (!acc) {
      return res.json({ success: false, message: "الحساب المختار ليس فرعيًا" });
    }

    await db.query(
      `INSERT INTO payment_methods
       (company, account_number, owner_name, address, account_id, sort_order, is_active)
       VALUES (?, ?, ?, ?, ?, 9999, 1)`,
      [company, account_number, owner_name, address, account_id]
    );

    res.json({ success: true, message: "✅ تم إضافة طريقة الدفع" });
  } catch (err) {
    console.error("Add payment method error:", err);
    res.status(500).json({ success: false });
  }
});

/* ========================
   تعديل طريقة دفع
======================== */
router.put("/:id", async (req, res) => {
  try {
    const { company, account_number, owner_name, address, account_id } = req.body;

    if (!account_id) {
      return res.json({ success: false, message: "يجب اختيار حساب فرعي" });
    }

    const [[acc]] = await db.query(
      "SELECT id FROM accounts WHERE id=? AND parent_id IS NOT NULL",
      [account_id]
    );

    if (!acc) {
      return res.json({ success: false, message: "الحساب المختار ليس فرعيًا" });
    }

    await db.query(
      `UPDATE payment_methods
       SET company=?, account_number=?, owner_name=?, address=?, account_id=?
       WHERE id=?`,
      [company, account_number, owner_name, address, account_id, req.params.id]
    );

    res.json({ success: true, message: "✅ تم التعديل" });
  } catch (err) {
    console.error("Update payment method error:", err);
    res.status(500).json({ success: false });
  }
});

/* ========================
   حذف طريقة دفع
======================== */
router.delete("/:id", async (req, res) => {
  try {
    await db.query("DELETE FROM payment_methods WHERE id=?", [req.params.id]);
    res.json({ success: true, message: "🗑️ تم الحذف" });
  } catch (err) {
    console.error("Delete payment method error:", err);
    res.status(500).json({ success: false });
  }
});

/* ========================
   تفعيل / تعطيل + سجل تغييرات
======================== */
router.patch("/:id/toggle", async (req, res) => {
  const { id } = req.params;
  const { is_active } = req.body;

  const status = is_active === true || is_active === 1 ? 1 : 0;
  const userId = req.user && req.user.id ? req.user.id : null;

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    await conn.query(
      "UPDATE payment_methods SET is_active=? WHERE id=?",
      [status, id]
    );

    await conn.query(
      `INSERT INTO payment_method_logs
       (payment_method_id, action, changed_by)
       VALUES (?, ?, ?)`,
      [id, status === 1 ? "activate" : "deactivate", userId]
    );

    await conn.commit();
    res.json({ success: true, message: "تم تحديث الحالة" });
  } catch (err) {
    await conn.rollback();
    console.error("Toggle payment method error:", err);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    conn.release();
  }
});

/* ========================
   ترتيب بالسحب
======================== */
router.post("/reorder", async (req, res) => {
  const { orders } = req.body;
  const conn = await db.getConnection();

  try {
    await conn.beginTransaction();

    for (const o of orders) {
      await conn.query(
        "UPDATE payment_methods SET sort_order=? WHERE id=?",
        [o.sort_order, o.id]
      );
    }

    await conn.commit();
    res.json({ success: true });
  } catch (err) {
    await conn.rollback();
    console.error("Reorder payment methods error:", err);
    res.status(500).json({ success: false });
  } finally {
    conn.release();
  }
});

/* ========================
   سجل التغييرات
======================== */
router.get("/:id/logs", async (req, res) => {
  try {
    const { id } = req.params;
    const { days } = req.query;

    const filter = days ? `AND l.created_at >= NOW() - INTERVAL ? DAY` : "";
    const params = days ? [id, Number(days)] : [id];

    const [rows] = await db.query(
      `
      SELECT 
        l.action,
        l.created_at,
        u.name AS user_name
      FROM payment_method_logs l
      LEFT JOIN users u ON u.id = l.changed_by
      WHERE l.payment_method_id = ?
      ${filter}
      ORDER BY l.created_at DESC
    `,
      params
    );

    res.json({ success: true, logs: rows });
  } catch (err) {
    console.error("Get payment method logs error:", err);
    res.status(500).json({ success: false });
  }
});

/* ========================
   تصدير PDF
======================== */
router.get("/:id/logs/pdf", async (req, res) => {
  try {
    const { id } = req.params;

    const [logs] = await db.query(
      `
      SELECT 
        l.action,
        l.created_at,
        u.name AS user_name
      FROM payment_method_logs l
      LEFT JOIN users u ON u.id = l.changed_by
      WHERE l.payment_method_id=?
      ORDER BY l.created_at DESC
    `,
      [id]
    );

    const doc = new PDFDocument({ margin: 40 });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      "attachment; filename=payment-method-logs.pdf"
    );

    doc.pipe(res);

    doc.fontSize(16).text("سجل تغييرات طرق الدفع", { align: "center" });
    doc.moveDown();

    logs.forEach((l) => {
      doc.fontSize(12).text(
        `${l.action === "activate" ? "تفعيل" : "تعطيل"} | ${
          l.user_name ?? "النظام"
        } | ${l.created_at}`
      );
    });

    doc.end();
  } catch (err) {
    console.error("Export payment logs PDF error:", err);
    res.status(500).json({ success: false });
  }
});

export default router;
