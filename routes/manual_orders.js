import express from "express";
import db from "../db.js";
import auth from "../middlewares/auth.js";

const router = express.Router();
router.use(auth);

/* ==============================================
   1️⃣ حفظ طلب يدوي جديد (بدون قيود محاسبية)
============================================== */
router.post("/", async (req, res) => {
  const conn = await db.getConnection();
  try {
    const { 
      customer_id, restaurant_id, to_address, delivery_fee, 
      notes, payment_method, items, total_amount 
    } = req.body;

    await conn.beginTransaction();

    const [orderRes] = await conn.query(`
      INSERT INTO wassel_orders (
        customer_id, restaurant_id, to_address, delivery_fee, 
        total_amount, payment_method, notes, status, display_type, user_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 'manual', ?, NOW())
    `, [customer_id, restaurant_id || null, to_address, delivery_fee, total_amount, payment_method, notes, req.user.id]);

    const orderId = orderRes.insertId;

    for (const item of items) {
      await conn.query(`
        INSERT INTO wassel_order_items (order_id, product_name, qty, price, total)
        VALUES (?, ?, ?, ?, ?)
      `, [orderId, item.name, item.qty, item.price, (item.qty * item.price)]);
    }

    await conn.commit();
    res.json({ success: true, order_id: orderId });

  } catch (err) {
    await conn.rollback();
    res.status(500).json({ success: false, message: "فشل حفظ الطلب", error: err.message });
  } finally {
    conn.release();
  }
});

/* ==============================================
   2️⃣ تحديث الحالة + إنشاء القيود عند "قيد التوصيل"
============================================== */
// ملاحظة: هذا الكود يجب أن يوضع في ملف wasselOrders.js أو manual_orders.js حسب مسار الـ API المستخدم في الواجهة
router.put("/status/:id", async (req, res) => {
  const orderId = req.params.id;
  const { status } = req.body;
  const conn = await db.getConnection();

  try {
    await conn.beginTransaction();

    // 1. تحديث حالة الطلب
    await conn.query("UPDATE wassel_orders SET status = ? WHERE id = ?", [status, orderId]);

    // 2. إذا أصبحت الحالة "قيد التوصيل"، ننشئ القيود المحاسبية
    if (status === 'shipping') {
      const [[order]] = await conn.query("SELECT * FROM wassel_orders WHERE id = ?", [orderId]);
      const [[settings]] = await conn.query("SELECT * FROM settings LIMIT 1");

      if (order && settings) {
        const journalNote = `قيد محاسبي آلي لطلب يدوي رقم #${orderId}`;
        const itemsTotal = order.total_amount - order.delivery_fee;

        // أ. قيد مديونية العميل
        let customerAcc = order.payment_method === 'wallet' ? settings.customer_guarantee_account : settings.cash_account;
        await insertJournal(conn, customerAcc, order.total_amount, 0, journalNote, orderId, req);

        // ب. قيد دائنية المطعم (تجنب الخطأ باستخدام حساب افتراضي إذا لم يوجد account_id)
        if (order.restaurant_id) {
           // نستخدم حساب الموردين الافتراضي من الإعدادات لأن عمود account_id غير موجود في جدول restaurants كما أظهر الخطأ
           const restAcc = settings.default_vendor_account || 15; 
           await insertJournal(conn, restAcc, 0, itemsTotal, `مستحقات مطعم - طلب #${orderId}`, orderId, req);
        }

        // ج. قيد عمولة التوصيل
        await insertJournal(conn, settings.courier_commission_account, 0, order.delivery_fee, `عمولة توصيل - طلب #${orderId}`, orderId, req);
      }
    }

    await conn.commit();
    res.json({ success: true, message: "تم تحديث الحالة والقيود بنجاح" });

  } catch (err) {
    await conn.rollback();
    res.status(500).json({ success: false, error: err.message });
  } finally {
    conn.release();
  }
});

/* دالة مساعدة */
async function insertJournal(conn, accId, debit, credit, notes, refId, req) {
  if (!accId) return;
  return conn.query(`
    INSERT INTO journal_entries 
    (journal_type_id, account_id, debit, credit, notes, reference_type, reference_id, journal_date, currency_id, created_by, branch_id)
    VALUES (1, ?, ?, ?, ?, 'manual_order', ?, CURDATE(), 1, ?, ?)
  `, [accId, debit, credit, notes, refId, req.user.id, req.user.branch_id || 1]);
}

export default router;
