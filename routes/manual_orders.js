import express from "express";
import db from "../db.js";
import auth from "../middlewares/auth.js";

const router = express.Router();
router.use(auth);

/* ==============================================
   0️⃣ جلب الطلبات اليدوية + المنتجات + العنوان
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

  w.to_address,
  w.area,
  w.latitude,
  w.longitude,

  w.created_at,

  /* العميل */
  IFNULL(c.name, 'عميل غير معروف') AS customer_name,
  c.phone AS customer_phone,

  /* الحي */
  w.area AS neighborhood_name,

  /* المحل */
  IFNULL(r.name, 'شراء مباشر') AS restaurant_name,
  r.phone AS restaurant_phone,
  r.address AS restaurant_address,
  r.map_url AS restaurant_map,

  /* الكابتن + المستخدم */
  IFNULL(cap.name, '—') AS captain_name,
  IFNULL(u.name, 'Admin') AS user_name,

  /* المنتجات */
  JSON_ARRAYAGG(
    JSON_OBJECT(
      'name', i.product_name,
      'qty', i.qty,
      'price', i.price,
      'total', i.total
    )
  ) AS items

FROM wassel_orders w

LEFT JOIN customers c ON c.id = w.customer_id
LEFT JOIN restaurants r ON r.id = w.restaurant_id
LEFT JOIN captains cap ON cap.id = w.captain_id
LEFT JOIN users u ON u.id = w.user_id
LEFT JOIN wassel_order_items i ON i.order_id = w.id

WHERE w.display_type = 'manual'

GROUP BY w.id
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
   1️⃣ حفظ طلب يدوي جديد + الموقع
============================================== */
router.post("/", async (req, res) => {

  const conn = await db.getConnection();

  try {

    const { 
      customer_id,
      restaurant_id,

      to_address,
      area,
      latitude,
      longitude,

      delivery_fee,
      notes,
      payment_method,
      items,
      total_amount 
    } = req.body;

    if (!customer_id || !items?.length) {
      return res.status(400).json({
        success: false,
        message: "بيانات الطلب غير مكتملة"
      });
    }

    await conn.beginTransaction();

    /* حفظ الطلب */
    const [orderRes] = await conn.query(`
      INSERT INTO wassel_orders (
        customer_id,
        restaurant_id,

        to_address,
        area,
        latitude,
        longitude,

        delivery_fee,
        total_amount,
        payment_method,
        notes,

        status,
        display_type,
        user_id,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'manual', ?, NOW())
    `, [

      customer_id,
      restaurant_id || null,

      to_address,
      area || null,
      latitude || null,
      longitude || null,

      delivery_fee,
      total_amount,
      payment_method,
      notes,

      req.user.id
    ]);

    const orderId = orderRes.insertId;

    /* حفظ المنتجات */
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

/* ==============================================
   2️⃣ تحديث الحالة + القيود المحاسبية
============================================== */
router.put("/status/:id", async (req, res) => {

  const orderId = req.params.id;
  const { status } = req.body;

  const conn = await db.getConnection();

  try {

    await conn.beginTransaction();

    /* تحديث الحالة */
    await conn.query(
      "UPDATE wassel_orders SET status = ? WHERE id = ?",
      [status, orderId]
    );

    /* عند قيد التوصيل */
    if (status === "shipping") {

      const [[order]] = await conn.query(
        "SELECT * FROM wassel_orders WHERE id = ?",
        [orderId]
      );

      const [[settings]] = await conn.query(
        "SELECT * FROM settings LIMIT 1"
      );

      if (order && settings) {

        const journalNote =
          `قيد محاسبي آلي لطلب يدوي رقم #${orderId}`;

        const itemsTotal =
          order.total_amount - order.delivery_fee;

        /* حساب العميل */
        let customerAcc =
          order.payment_method === "wallet"
            ? settings.customer_guarantee_account
            : settings.cash_account;

        await insertJournal(
          conn,
          customerAcc,
          order.total_amount,
          0,
          journalNote,
          orderId,
          req
        );

        /* حساب المطعم */
        if (order.restaurant_id) {

          const restAcc =
            settings.default_vendor_account || 15;

          await insertJournal(
            conn,
            restAcc,
            0,
            itemsTotal,
            `مستحقات مطعم - طلب #${orderId}`,
            orderId,
            req
          );
        }

        /* عمولة التوصيل */
        await insertJournal(
          conn,
          settings.courier_commission_account,
          0,
          order.delivery_fee,
          `عمولة توصيل - طلب #${orderId}`,
          orderId,
          req
        );
      }
    }

    await conn.commit();

    res.json({
      success: true,
      message: "تم تحديث الحالة والقيود بنجاح"
    });

  } catch (err) {

    await conn.rollback();

    console.error("❌ Status Update Error:", err);

    res.status(500).json({
      success: false,
      error: err.message
    });

  } finally {
    conn.release();
  }
});

/* ==============================================
   دالة إدخال القيد
============================================== */
async function insertJournal(
  conn,
  accId,
  debit,
  credit,
  notes,
  refId,
  req
) {

  if (!accId) return;

  return conn.query(`
    INSERT INTO journal_entries 
    (
      journal_type_id,
      account_id,
      debit,
      credit,
      notes,
      reference_type,
      reference_id,
      journal_date,
      currency_id,
      created_by,
      branch_id
    )
    VALUES
    (
      1,
      ?, ?, ?, ?,
      'manual_order',
      ?,
      CURDATE(),
      1,
      ?,
      ?
    )
  `, [

    accId,
    debit,
    credit,
    notes,
    refId,
    req.user.id,
    req.user.branch_id || 1

  ]);
}

export default router;
