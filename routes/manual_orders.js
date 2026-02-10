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

  ANY_VALUE(w.customer_id) AS customer_id,
  ANY_VALUE(w.restaurant_id) AS restaurant_id,
  ANY_VALUE(w.captain_id) AS captain_id,

  ANY_VALUE(w.total_amount) AS total_amount,
  ANY_VALUE(w.delivery_fee) AS delivery_fee,
  ANY_VALUE(w.payment_method) AS payment_method,
  ANY_VALUE(w.status) AS status,
  ANY_VALUE(w.notes) AS notes,

  ANY_VALUE(w.to_address) AS to_address,

  /* العنوان */
  ANY_VALUE(n.name)      AS neighborhood_name,
  ANY_VALUE(ca.address) AS customer_address,
  ANY_VALUE(ca.latitude) AS latitude,
  ANY_VALUE(ca.longitude) AS longitude,
  ANY_VALUE(ca.gps_link) AS map_url,

  ANY_VALUE(w.created_at) AS created_at,

  /* العميل */
  ANY_VALUE(c.name)  AS customer_name,
  ANY_VALUE(c.phone) AS customer_phone,

  /* المحل */
  ANY_VALUE(r.name)    AS restaurant_name,
  ANY_VALUE(r.phone)   AS restaurant_phone,
  ANY_VALUE(r.address) AS restaurant_address,
  ANY_VALUE(r.map_url) AS restaurant_map,

  /* الكابتن + المستخدم */
  ANY_VALUE(cap.name) AS captain_name,
  ANY_VALUE(u.name)   AS user_name,

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

LEFT JOIN customers c 
  ON c.id = w.customer_id

LEFT JOIN customer_addresses ca 
  ON ca.customer_id = w.customer_id
 AND ca.address = w.to_address

LEFT JOIN neighborhoods n 
  ON n.id = ca.district

LEFT JOIN restaurants r 
  ON r.id = w.restaurant_id

LEFT JOIN captains cap 
  ON cap.id = w.captain_id

LEFT JOIN users u 
  ON u.id = w.user_id

LEFT JOIN wassel_order_items i 
  ON i.order_id = w.id

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
