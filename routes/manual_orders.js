import express from "express";
import db from "../db.js";
import auth from "../middlewares/auth.js";

const router = express.Router();
router.use(auth);

/* ==============================================
   1️⃣ جلب قائمة الطلبات اليدوية (نسخة معدلة)
============================================== */
router.get("/manual-list", async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT 
        w.*, 
        IFNULL(c.name, 'عميل يدوي') AS customer_name, -- لضمان عدم بقاء الخانة فارغة
        cap.name AS captain_name,
        a.name_ar AS agent_name,
        u.name AS user_name
      FROM wassel_orders w
      LEFT JOIN customers c ON c.id = w.customer_id
      LEFT JOIN captains cap ON cap.id = w.captain_id
      LEFT JOIN accounts a ON a.id = w.agent_id
      LEFT JOIN users u ON u.id = w.user_id
      -- تعديل الشرط ليشمل الرقم 1 أو النص 'manual' حسب ما يظهر في صور قاعدة البيانات
      WHERE w.is_manual = 1 OR w.display_type = 'manual' 
      ORDER BY w.id DESC
    `);
    res.json({ success: true, orders: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});
/* ==============================================
   2️⃣ حفظ طلب يدوي جديد مع القيود المحاسبية
============================================== */
router.post("/", async (req, res) => {
  const conn = await db.getConnection();
  try {
    const { 
      customer_id, agent_id, to_address, delivery_fee, 
      notes, payment_method, items, total_amount 
    } = req.body;

    await conn.beginTransaction();

    // 1. إدراج الطلب الرئيسي
    const [orderResult] = await conn.query(`
      INSERT INTO wassel_orders (
        customer_id, agent_id, to_address, delivery_fee, 
        total_amount, payment_method, notes, is_manual, status, user_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'pending', ?, NOW())
    `, [customer_id, agent_id || null, to_address, delivery_fee, total_amount, payment_method, notes, req.user.id]);

    const orderId = orderResult.insertId;

    // 2. إدراج تفاصيل المنتجات
    for (const item of items) {
      await conn.query(`
        INSERT INTO wassel_order_items (order_id, product_name, qty, price, total)
        VALUES (?, ?, ?, ?, ?)
      `, [orderId, item.name, item.qty, item.price, (item.qty * item.price)]);
    }

    // 3. المعالجة المحاسبية (القيود)
    const [[settings]] = await conn.query("SELECT * FROM settings LIMIT 1");
    const [[custAcc]] = await conn.query("SELECT id FROM customer_guarantees WHERE customer_id = ?", [customer_id]);
    
    const itemsTotal = total_amount - delivery_fee;
    const noteStr = `طلب يدوي #${orderId} - العميل: ${customer_id}`;

    // أ- قيد مديونية العميل (إجمالي الفاتورة)
    // إذا كان الدفع محفظة، القيد من حساب وسيط التأمين أو حساب العميل المباشر
    const debitAcc = payment_method === 'wallet' ? settings.customer_guarantee_account : settings.cash_account;
    
    await insertEntry(conn, debitAcc, total_amount, 0, noteStr, orderId, req);

    // ب- قيد دائنية الوكيل/المحل (إذا وجد)
    if (agent_id) {
       await insertEntry(conn, agent_id, 0, itemsTotal, `توريد منتجات ${noteStr}`, orderId, req);
    }

    // ج- قيد رسوم التوصيل (لصالح الشركة أو الكابتن)
    await insertEntry(conn, settings.courier_commission_account, 0, delivery_fee, `رسوم توصيل ${noteStr}`, orderId, req);

    await conn.commit();
    res.json({ success: true, order_id: orderId });

  } catch (err) {
    await conn.rollback();
    res.status(500).json({ success: false, message: err.message });
  } finally {
    conn.release();
  }
});

/* دالة مساعدة لإدراج القيود */
async function insertEntry(conn, acc, deb, cre, notes, ref, req) {
  return conn.query(`
    INSERT INTO journal_entries (
      journal_type_id, account_id, debit, credit, notes, reference_type, 
      reference_id, journal_date, currency_id, created_by, branch_id
    ) VALUES (1, ?, ?, ?, ?, 'manual_order', ?, CURDATE(), 1, ?, ?)
  `, [acc, deb || 0, cre || 0, notes, ref, req.user.id, req.user.branch_id]);
}

export default router;
