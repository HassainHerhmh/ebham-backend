import express from "express";
import db from "../db.js";
import auth from "../middlewares/auth.js";

const router = express.Router();
router.use(auth);

/* ==============================================
   1️⃣ جلب قائمة الطلبات اليدوية (الجدول الرئيسي)
============================================== */
router.get("/manual-list", async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT 
        w.*, 
        IFNULL(c.name, 'عميل غير معروف') AS customer_name,
        IFNULL(r.name, 'شراء مباشر') AS restaurant_name,
        IFNULL(cap.name, '—') AS captain_name,
        IFNULL(u.name, 'Admin') AS user_name
      FROM wassel_orders w
      LEFT JOIN customers c   ON c.id = w.customer_id
      LEFT JOIN restaurants r ON r.id = w.restaurant_id
      LEFT JOIN captains cap  ON cap.id = w.captain_id
      LEFT JOIN users u       ON u.id = w.user_id
      WHERE w.display_type = 'manual'
      ORDER BY w.id DESC
    `);
    res.json({ success: true, orders: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: "فشل جلب القائمة", error: err.message });
  }
});

/* ==============================================
   2️⃣ جلب تفاصيل طلب محدد (لمودال الفاتورة)
============================================== */
router.get("/:id", async (req, res) => {
  try {
    const orderId = req.params.id;

    // 1. جلب بيانات الطلب الأساسية
    const [[order]] = await db.query(`
      SELECT w.*, 
             c.name AS customer_name, c.phone AS customer_phone,
             r.name AS restaurant_name, r.phone AS restaurant_phone,
             u.name AS user_name
      FROM wassel_orders w
      LEFT JOIN customers c ON c.id = w.customer_id
      LEFT JOIN restaurants r ON r.id = w.restaurant_id
      LEFT JOIN users u ON u.id = w.user_id
      WHERE w.id = ?
    `, [orderId]);

    if (!order) return res.status(404).json({ success: false, message: "الطلب غير موجود" });

    // 2. جلب المنتجات التابعة للطلب
    const [items] = await db.query(`
      SELECT id, product_name AS name, qty, price, total 
      FROM wassel_order_items 
      WHERE order_id = ?
    `, [orderId]);

    // تجهيز الهيكل المتوافق مع الفاتورة في الواجهة
    res.json({
      ...order,
      items: items,
      restaurants: [{
        name: order.restaurant_name || "شراء مباشر",
        phone: order.restaurant_phone || "—",
        total: order.total_amount - order.delivery_fee,
        items: items
      }]
    });

  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/* ==============================================
   3️⃣ حفظ طلب يدوي جديد + توليد القيود المحاسبية
============================================== */
router.post("/", async (req, res) => {
  const conn = await db.getConnection();
  try {
    const { 
      customer_id, restaurant_id, to_address, delivery_fee, 
      notes, payment_method, items, total_amount 
    } = req.body;

    await conn.beginTransaction();

    // 1. إدراج الطلب
    const [orderRes] = await conn.query(`
      INSERT INTO wassel_orders (
        customer_id, restaurant_id, to_address, delivery_fee, 
        total_amount, payment_method, notes, status, display_type, user_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 'manual', ?, NOW())
    `, [customer_id, restaurant_id || null, to_address, delivery_fee, total_amount, payment_method, notes, req.user.id]);

    const orderId = orderRes.insertId;

    // 2. إدراج المنتجات
    for (const item of items) {
      await conn.query(`
        INSERT INTO wassel_order_items (order_id, product_name, qty, price, total)
        VALUES (?, ?, ?, ?, ?)
      `, [orderId, item.name, item.qty, item.price, (item.qty * item.price)]);
    }

    // 3. 🧩 إنشاء القيود المحاسبية (Accounting Logic)
    const [[settings]] = await conn.query("SELECT * FROM settings LIMIT 1");
    if (!settings) throw new Error("إعدادات الحسابات غير مكتملة");

    const itemsTotal = total_amount - delivery_fee;
    const journalNote = `طلب يدوي رقم #${orderId}`;

    // أ. قيد مديونية العميل (مدين بإجمالي الفاتورة)
    // نحدد الحساب بناءً على وسيلة الدفع
    let customerDebitAccount = settings.cash_account; // افتراضاً كاش
    if (payment_method === 'wallet') customerDebitAccount = settings.customer_guarantee_account;

    await insertJournal(conn, customerDebitAccount, total_amount, 0, journalNote, orderId, req);

    // ب. قيد دائنية المطعم/المحل (إذا وجد)
    if (restaurant_id) {
       // نحصل على رقم حساب المطعم من جدول المطاعم
       const [[restData]] = await conn.query("SELECT account_id FROM restaurants WHERE id = ?", [restaurant_id]);
       const restAcc = restData?.account_id || settings.default_vendor_account;
       await insertJournal(conn, restAcc, 0, itemsTotal, `قيمة مشتريات - ${journalNote}`, orderId, req);
    }

    // ج. قيد إيراد التوصيل (دائن لصالح حساب عمولة الشركة)
    await insertJournal(conn, settings.courier_commission_account, 0, delivery_fee, `رسوم توصيل - ${journalNote}`, orderId, req);

    await conn.commit();
    res.json({ success: true, order_id: orderId });

  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(500).json({ success: false, message: "فشل الحفظ المحاسبي", error: err.message });
  } finally {
    conn.release();
  }
});

/* دالة مساعدة لتبسيط إدراج القيود */
async function insertJournal(conn, accId, debit, credit, notes, refId, req) {
  if (!accId) return; // تخطي إذا لم يوجد حساب
  return conn.query(`
    INSERT INTO journal_entries 
    (journal_type_id, account_id, debit, credit, notes, reference_type, reference_id, journal_date, currency_id, created_by, branch_id)
    VALUES (1, ?, ?, ?, ?, 'manual_order', ?, CURDATE(), 1, ?, ?)
  `, [accId, debit, credit, notes, refId, req.user.id, req.user.branch_id || 1]);
}

export default router;
