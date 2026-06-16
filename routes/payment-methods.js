import express from "express";
import db from "../db.js";
import PDFDocument from "pdfkit";
import auth from "../middlewares/auth.js";

const router = express.Router();


router.use(auth);

/* ==============================================
   1. جلب جميع طرق الدفع (للإدارة)
   بدون حسابات (لأنها حسب الفرع)
============================================== */
router.get("/", async (req, res) => {
  try {

    const branchId = req.user.branch_id;

    const [rows] = await db.query(`
      SELECT 
        pm.id,
        pm.company,
        pm.account_number,
        pm.owner_name,
        pm.address,
        pm.sort_order,

        CAST(pm.is_active AS UNSIGNED) AS is_active,

        bpa.branch_id,
        bpa.account_id,

        a.name_ar AS account_name,
        a.code    AS account_code

      FROM payment_methods pm

      LEFT JOIN branch_payment_accounts bpa
        ON bpa.payment_method_id = pm.id
       AND bpa.branch_id = ?

      LEFT JOIN accounts a
        ON a.id = bpa.account_id

      ORDER BY pm.sort_order ASC
    `, [branchId]);

    res.json({ success: true, methods: rows });

  } catch (err) {

    console.error("Get payment methods error:", err?.message || err);

    res.status(500).json({ success: false });
  }
});




/* ==============================================
   2. جلب الطرق المفعّلة حسب الفرع
============================================== */
router.get("/active", async (req, res) => {
  try {

    const branchId =
      req.headers["x-branch-id"] || req.user?.branch_id;

    if (!branchId) {
      return res.status(400).json({
        success: false,
        message: "رقم الفرع غير محدد"
      });
    }

    const [rows] = await db.query(`
      SELECT 
        pm.id,
        pm.company,
        pm.account_number,
        pm.owner_name,
        pm.address,
        bpa.account_id
      FROM payment_methods pm
      LEFT JOIN branch_payment_accounts bpa
        ON bpa.payment_method_id = pm.id
       AND bpa.branch_id = ?
      WHERE pm.is_active = 1
      ORDER BY pm.sort_order ASC
    `, [branchId]);

    res.json({ success: true, methods: rows });

  } catch (err) {

    console.error("Active methods error:", err?.message || err);

    res.status(500).json({ success: false });
  }
});


/* ==============================================
   3. ربط بنك بحساب فرع (الأساس)
============================================== */
router.post("/assign-branch-account", async (req, res) => {
  try {

    const {
      payment_method_id,
      branch_id,
      account_id
    } = req.body;

    if (!payment_method_id || !branch_id || !account_id) {
      return res.status(400).json({
        success: false,
        message: "بيانات الربط غير مكتملة"
      });
    }

    await db.query(`
      INSERT INTO branch_payment_accounts
      (payment_method_id, branch_id, account_id)
      VALUES (?, ?, ?)
      ON DUPLICATE KEY UPDATE
        account_id = VALUES(account_id)
    `, [
      payment_method_id,
      branch_id,
      account_id
    ]);

    res.json({
      success: true,
      message: "✅ تم حفظ ربط الحساب للفرع"
    });

  } catch (err) {

    console.error("Assign error:", err?.message || err);

    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});


/* ==============================================
   4. إضافة بنك جديد (تعريف فقط)
============================================== */
router.post("/", async (req, res) => {
  try {

    const {
      company,
      account_number,
      owner_name,
      address
    } = req.body;

    const [result] = await db.query(`
      INSERT INTO payment_methods
      (company, account_number, owner_name, address, sort_order, is_active)
      VALUES (?, ?, ?, ?, 9999, 1)
    `, [
      company,
      account_number,
      owner_name,
      address
    ]);

    res.json({
      success: true,
      message: "✅ تم إضافة البنك",
      id: result.insertId
    });

  } catch (err) {

    console.error("Add payment method error:", err?.message || err);

    res.status(500).json({ success: false });
  }
});


/* ==============================================
   5. تعديل بيانات البنك
============================================== */
router.put("/:id", async (req, res) => {
  try {

    const {
      company,
      account_number,
      owner_name,
      address
    } = req.body;

    await db.query(`
      UPDATE payment_methods
      SET
        company = ?,
        account_number = ?,
        owner_name = ?,
        address = ?
      WHERE id = ?
    `, [
      company,
      account_number,
      owner_name,
      address,
      req.params.id
    ]);

    res.json({
      success: true,
      message: "✅ تم التعديل"
    });

  } catch (err) {

    console.error("Update error:", err?.message || err);

    res.status(500).json({ success: false });
  }
});


/* ==============================================
   6. حذف بنك
============================================== */
router.delete("/:id", async (req, res) => {
  try {

    await db.query(
      "DELETE FROM branch_payment_accounts WHERE payment_method_id=?",
      [req.params.id]
    );

    await db.query(
      "DELETE FROM payment_methods WHERE id=?",
      [req.params.id]
    );

    res.json({
      success: true,
      message: "🗑️ تم الحذف"
    });

  } catch (err) {

    console.error("Delete error:", err?.message || err);

    res.status(500).json({ success: false });
  }
});


/* ==============================================
   7. تفعيل / تعطيل
============================================== */
router.put("/:id/toggle", async (req, res) => {

  const { id } = req.params;
  const { is_active } = req.body;

  const status = is_active ? 1 : 0;
  const userId = req.user?.id || null;

  const conn = await db.getConnection();

  try {

    await conn.beginTransaction();

    await conn.query(
      "UPDATE payment_methods SET is_active=? WHERE id=?",
      [status, id]
    );

    await conn.query(`
      INSERT INTO payment_method_logs
      (payment_method_id, action, changed_by)
      VALUES (?, ?, ?)
    `, [
      id,
      status === 1 ? "activate" : "deactivate",
      userId
    ]);

    await conn.commit();

    res.json({ success: true });

  } catch (err) {

    await conn.rollback();

    res.status(500).json({ success: false });

  } finally {

    conn.release();
  }
});


/* ==============================================
   8. ترتيب
============================================== */
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

    res.status(500).json({ success: false });

  } finally {

    conn.release();
  }
});

export default router;
