import express from "express";
import db from "../db.js";
import auth from "../middlewares/auth.js";

const router = express.Router();
router.use(auth);

/* ==============================================
   1️⃣ جلب قائمة الطلبات اليدوية (المسار المصحح)
============================================== */
router.get("/manual-list", async (req, res) => {
  try {
    // ملاحظة: تأكد أن الأسماء (customer_name, agent_name) تطابق ما تستخدمه في واجهة React
    const [rows] = await db.query(`
      SELECT 
        w.id,
        w.customer_id,
        w.agent_id,
        w.captain_id,
        w.total_amount,
        w.delivery_fee,
        w.payment_method,
        w.status,
        w.created_at,
        w.notes,
        IFNULL(c.name, 'عميل غير معروف') AS customer_name,
        cap.name AS captain_name,
        a.name_ar AS agent_name,
        u.name AS user_name
      FROM wassel_orders w
      LEFT JOIN customers c ON c.id = w.customer_id
      LEFT JOIN captains cap ON cap.id = w.captain_id
      LEFT JOIN accounts a ON a.id = w.agent_id
      LEFT JOIN users u ON u.id = w.user_id
      -- استخدام الشرطين لضمان جلب كافة الطلبات اليدوية
      WHERE w.is_manual = 1 OR w.display_type = 'manual'
      ORDER BY w.id DESC
    `);
    
    res.json({ success: true, orders: rows });
  } catch (err) {
    console.error("SQL Error in manual-list:", err); // سيظهر لك الخطأ بالتفصيل في شاشة السيرفر
    res.status(500).json({ success: false, message: "حدث خطأ في قاعدة البيانات", error: err.message });
  }
});

/* ==============================================
   2️⃣ حفظ طلب يدوي جديد
============================================== */
router.post("/", async (req, res) => {
  const conn = await db.getConnection();
  try {
    const { 
      customer_id, agent_id, to_address, delivery_fee, 
      notes, payment_method, items, total_amount 
    } = req.body;

    await conn.beginTransaction();

    // إدراج الطلب الرئيسي (تأكد من وجود عمود display_type)
    const [orderResult] = await conn.query(`
      INSERT INTO wassel_orders (
        customer_id, agent_id, to_address, delivery_fee, 
        total_amount, payment_method, notes, is_manual, display_type, status, user_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'manual', 'pending', ?, NOW())
    `, [customer_id, agent_id || null, to_address, delivery_fee, total_amount, payment_method, notes, req.user.id]);

    const orderId = orderResult.insertId;

    // إدراج تفاصيل المنتجات (تأكد من وجود جدول wassel_order_items)
    if (items && items.length > 0) {
        for (const item of items) {
          await conn.query(`
            INSERT INTO wassel_order_items (order_id, product_name, qty, price, total)
            VALUES (?, ?, ?, ?, ?)
          `, [orderId, item.name, item.qty, item.price, (item.qty * item.price)]);
        }
    }

    await conn.commit();
    res.json({ success: true, order_id: orderId });

  } catch (err) {
    await conn.rollback();
    console.error("Error saving manual order:", err);
    res.status(500).json({ success: false, message: "فشل في حفظ الطلب", error: err.message });
  } finally {
    conn.release();
  }
});

export default router;
