import express from "express";
import db from "../db.js";
import PDFDocument from "pdfkit";

const router = express.Router();

/* ========================
   1. جلب جميع طرق الدفع (للإدارة)
======================== */
router.get("/", async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT 
        pm.*,
        b.name AS branch_name,
        CAST(pm.is_active AS UNSIGNED) AS is_active
      FROM payment_methods pm
      LEFT JOIN branches b ON b.id = pm.branch_id
      ORDER BY pm.sort_order ASC
    `);

    res.json({ success: true, methods: rows });
  } catch (err) {
    console.error("Get payment methods error:", err);
    res.status(500).json({ success: false });
  }
});

/* ========================
   2. جلب الطرق المفعّلة للفرع المحدد أو الموحدة
======================== */
router.get("/active", async (req, res) => {
  try {
    // جلب رقم الفرع من الهيدر (x-branch-id) أو من بيانات المستخدم
    const branchId = req.headers["x-branch-id"] || req.user?.branch_id;

    let query = `
      SELECT 
        id, company, account_number, owner_name, address, branch_id
      FROM payment_methods 
      WHERE is_active = 1
    `;
    
    let params = [];

    // عرض بنوك الفرع المحدد + البنوك العامة (NULL)
    if (branchId) {
      query += ` AND (branch_id IS NULL OR branch_id = ?) `;
      params.push(Number(branchId));
    }

    query += ` ORDER BY sort_order ASC `;

    const [rows] = await db.query(query, params);
    res.json({ success: true, methods: rows });
  } catch (err) {
    console.error("❌ خطأ في جلب البنوك:", err);
    res.status(500).json({ success: false });
  }
});

/* ========================
   3. إضافة طريقة دفع (مع دعم تحديد الفرع)
======================== */
router.post("/", async (req, res) => {
  try {
    const { company, account_number, owner_name, address, account_id, branch_id } = req.body;

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
      `INSERT INTO payment_methods
        (company, account_number, owner_name, address, account_id, branch_id, sort_order, is_active)
        VALUES (?, ?, ?, ?, ?, ?, 9999, 1)`,
      [company, account_number, owner_name, address, account_id, branch_id || null]
    );

    res.json({ success: true, message: "✅ تم إضافة طريقة الدفع" });
  } catch (err) {
    console.error("Add payment method error:", err);
    res.status(500).json({ success: false });
  }
});

/* ========================
   4. تعديل طريقة دفع
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
    console.error("Update payment method error:", err);
    res.status(500).json({ success: false });
  }
});

/* ========================
   5. حذف طريقة دفع
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
   6. تفعيل / تعطيل (تم التعديل إلى PUT لحل خطأ CORS) ✅
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
    console.error("Toggle error:", err);
    res.status(500).json({ success: false });
  } finally {
    conn.release();
  }
});

/* ========================
   7. ترتيب بالسحب
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
   8. سجل التغييرات
======================== */
router.get("/:id/logs", async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT l.action, l.created_at, u.name AS user_name
      FROM payment_method_logs l
      LEFT JOIN users u ON u.id = l.changed_by
      WHERE l.payment_method_id = ?
      ORDER BY l.created_at DESC
    `, [req.params.id]);
    res.json({ success: true, logs: rows });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

/* ========================
   9. تصدير PDF
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
