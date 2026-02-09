import express from "express";
import db from "../db.js";
import auth from "../middlewares/auth.js";

const router = express.Router();

// حماية المسارات
router.use(auth);

/* ==============================================
   1️⃣ جلب قائمة الطلبات اليدوية (مع المحل)
============================================== */
router.get("/manual-list", async (req, res) => {
  try {

    const [rows] = await db.query(`
      SELECT 
        w.id,
        w.customer_id,
        w.restaurant_id,
        w.captain_id,

        w.total_amount,
        w.delivery_fee,
        w.payment_method,
        w.status,
        w.notes,
        w.created_at,
        w.display_type,

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

    res.json({
      success: true,
      orders: rows
    });

  } catch (err) {

    console.error("❌ Manual Orders Error:", err);

    res.status(500).json({
      success: false,
      message: "فشل في جلب الطلبات",
      error: err.message
    });
  }
});


/* ==============================================
   2️⃣ حفظ طلب يدوي جديد (مرتبط بمحل)
============================================== */
router.post("/", async (req, res) => {
  const conn = await db.getConnection();

  try {

    const {
      customer_id,
      restaurant_id,
      to_address,
      delivery_fee,
      notes,
      payment_method,
      items,
      total_amount
    } = req.body;

    // تحقق أساسي
    if (!customer_id || !items?.length) {
      return res.status(400).json({
        success: false,
        message: "يرجى إدخال العميل والمنتجات"
      });
    }

    await conn.beginTransaction();

    /* إدخال الطلب */
    const [orderResult] = await conn.query(`
      INSERT INTO wassel_orders (
        customer_id,
        restaurant_id,
        to_address,
        delivery_fee,
        total_amount,
        payment_method,
        notes,
        status,
        display_type,
        user_id,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 'manual', ?, NOW())
    `, [
      customer_id,
      restaurant_id || null,
      to_address,
      delivery_fee,
      total_amount,
      payment_method,
      notes,
      req.user.id
    ]);

    const orderId = orderResult.insertId;

    /* إدخال المنتجات */
    if (items?.length) {

      for (const item of items) {

        await conn.query(`
          INSERT INTO wassel_order_items
          (order_id, product_name, qty, price, total)
          VALUES (?, ?, ?, ?, ?)
        `, [
          orderId,
          item.name,
          item.qty,
          item.price,
          item.qty * item.price
        ]);
      }
    }

    await conn.commit();

    res.json({
      success: true,
      order_id: orderId
    });

  } catch (err) {

    await conn.rollback();

    console.error("❌ Save Manual Order Error:", err);

    res.status(500).json({
      success: false,
      message: "فشل حفظ الطلب",
      error: err.message
    });

  } finally {
    conn.release();
  }
});

export default router;
