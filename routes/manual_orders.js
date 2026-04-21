import express from "express";
import db from "../db.js";
import auth from "../middlewares/auth.js";
import admin from "firebase-admin";
import { ensureOrderNumberSchema, getNextOrderNumber } from "../utils/orderNumbers.js";

const router = express.Router();
router.use(auth);
router.use(async (req, res, next) => {
  try {
    await ensureOrderNumberSchema();
    next();
  } catch (err) {
    next(err);
  }
});

/* ==============================================
   جلب الطلبات اليدوية
============================================== */
router.get("/manual-list", async (req, res) => {
  try {

const [rows] = await db.query(`

SELECT 
  w.id,
  COALESCE(w.order_number, w.id) AS order_number,

  ANY_VALUE(w.customer_id) AS customer_id,
  ANY_VALUE(w.restaurant_id) AS restaurant_id,
  ANY_VALUE(w.captain_id) AS captain_id,

  ANY_VALUE(w.total_amount) AS total_amount,
  ANY_VALUE(w.delivery_fee) AS delivery_fee,
  ANY_VALUE(w.payment_method) AS payment_method,
  ANY_VALUE(w.status) AS status,
  ANY_VALUE(w.notes) AS notes,

  ANY_VALUE(w.to_address) AS to_address,

  ANY_VALUE(w.created_at) AS created_at,
  ANY_VALUE(w.scheduled_at) AS scheduled_time,

  ANY_VALUE(w.processing_at)  AS processing_at,
  ANY_VALUE(w.ready_at)       AS ready_at,
  ANY_VALUE(w.delivering_at)  AS delivering_at,
  ANY_VALUE(w.completed_at)   AS completed_at,
  ANY_VALUE(w.cancelled_at)   AS cancelled_at,

  /* العميل */
  ANY_VALUE(c.name)  AS customer_name,
  ANY_VALUE(c.phone) AS customer_phone,

  /* العنوان */
  ANY_VALUE(ca.address)   AS customer_address,
ANY_VALUE(n.name) AS neighborhood_name,
  ANY_VALUE(ca.gps_link)  AS map_url,
  ANY_VALUE(ca.latitude)  AS latitude,
  ANY_VALUE(ca.longitude) AS longitude,

  /* المطعم */
  ANY_VALUE(r.name)    AS restaurant_name,
  ANY_VALUE(r.phone)   AS restaurant_phone,
  ANY_VALUE(r.address) AS restaurant_address,

  /* الكابتن */
  ANY_VALUE(cap.name) AS captain_name,

  /* المستخدم */
  ANY_VALUE(u.name) AS user_name,

  /* الأصناف */
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
ON ca.id = (
  SELECT id
  FROM customer_addresses
  WHERE customer_id = w.customer_id
  ORDER BY id DESC
  LIMIT 1
)

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

WHERE w.is_manual = 1

GROUP BY w.id
ORDER BY w.id DESC

`);



    res.json({ success:true, orders:rows });

  } catch (err) {

    console.error(err);

    res.status(500).json({
      success:false,
      message:"فشل في جلب الطلبات"
    });
  }
});


/* ==============================================
   حفظ طلب يدوي
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
      payment_method_id,
      scheduled_time,
      items,
      total_amount
    } = req.body;

    if (!customer_id || !items?.length) {
      return res.status(400).json({
        success: false,
        message: "البيانات ناقصة"
      });
    }

    await conn.beginTransaction();

    let scheduledAt = null;

    if (scheduled_time) {
      const d = new Date(scheduled_time);

      scheduledAt =
        d.getFullYear() + "-" +
        String(d.getMonth() + 1).padStart(2, "0") + "-" +
        String(d.getDate()).padStart(2, "0") + " " +
        String(d.getHours()).padStart(2, "0") + ":" +
        String(d.getMinutes()).padStart(2, "0") + ":00";
    }

    const orderNumber = await getNextOrderNumber(conn);

    const [orderRes] = await conn.query(`
      INSERT INTO wassel_orders (
        order_number,
        customer_id,
        restaurant_id,
        to_address,
        delivery_fee,
        total_amount,
        payment_method,
        payment_method_id,
        scheduled_at,
        notes,
        status,
        is_manual,
        user_id,
        created_at
      )
      VALUES (?,?,?,?,?,?,?,?,?,?, 'pending', 1, ?, NOW())
    `, [
      orderNumber,
      customer_id,
      restaurant_id || null,
      to_address,
      delivery_fee,
      total_amount,
      payment_method,
      payment_method_id,
      scheduledAt,
      notes,
      req.user.id
    ]);

    const orderId = orderRes.insertId;

    for (const item of items) {
      await conn.query(`
        INSERT INTO wassel_order_items
        (order_id, product_name, qty, price, total)
        VALUES (?,?,?,?,?)
      `, [
        orderId,
        item.name,
        item.qty,
        item.price,
        item.qty * item.price
      ]);
    }

    await conn.commit();

    const io = req.app.get("io");

    const [[customer]] = await db.query(
      `SELECT name FROM customers WHERE id = ? LIMIT 1`,
      [customer_id]
    );

    const customerName = customer?.name || "عميل غير معروف";
    const actorName = req.user?.name || "مستخدم";

    let adminMessage = "";

    if (req.user?.role === "customer") {
      adminMessage = `🧾 العميل ${customerName} أضاف طلب يدوي رقم #${orderNumber}`;
    } else {
      adminMessage = `🧾 المستخدم ${actorName} أضاف طلب يدوي للعميل ${customerName} رقم #${orderNumber}`;
    }

    io.emit("admin_notification", {
      type: "manual_order_created",
      order_id: orderId,
      order_number: orderNumber,
      actor_name: actorName,
      customer_name: customerName,
      message: adminMessage
    });

    res.json({ success: true, order_id: orderId, order_number: orderNumber });

  } catch (err) {
    await conn.rollback();

    console.error(err);

    res.status(500).json({ success: false });
  } finally {
    conn.release();
  }
});

/* ==============================================
   تعديل طلب يدوي + الأصناف
============================================== */
router.put("/:id", async (req, res) => {

  const conn = await db.getConnection();

  try {

    const id = req.params.id;

    const {
      to_address,
      delivery_fee,
      notes,
      payment_method,
      total_amount,
      items
    } = req.body;

    await conn.beginTransaction();

    /* تحديث الطلب */
    await conn.query(`
      UPDATE wassel_orders
      SET
        to_address=?,
        delivery_fee=?,
        notes=?,
        payment_method=?,
        total_amount=?
      WHERE id=?
       AND is_manual = 1
    `, [
      to_address,
      delivery_fee,
      notes,
      payment_method,
      total_amount,
      id
    ]);

    /* حذف الأصناف القديمة */
    await conn.query(`
      DELETE FROM wassel_order_items
      WHERE order_id=?
    `, [id]);

    /* إدخال الأصناف الجديدة */
    if (items?.length) {

      for (const item of items) {

        await conn.query(`
          INSERT INTO wassel_order_items
          (order_id, product_name, qty, price, total)
          VALUES (?,?,?,?,?)
        `, [
          id,
          item.name,
          item.qty,
          item.price,
          item.qty * item.price
        ]);
      }
    }

    await conn.commit();

    res.json({ success: true });

  } catch (err) {

    await conn.rollback();

    console.error("❌ UPDATE MANUAL ERROR:", err);

    res.status(500).json({
      success: false,
      message: "فشل التعديل"
    });

  } finally {
    conn.release();
  }
});


/* ==============================================
   تحديث الحالة + القيود + الإشعارات
============================================== */
router.put("/status/:id", async (req, res) => {
  const orderId = req.params.id;
  const { status } = req.body;

  const conn = await db.getConnection();

  try {
    await conn.beginTransaction();

    let field = null;

    if (status === "processing") field = "processing_at";
    if (status === "ready") field = "ready_at";
    if (status === "delivering") field = "delivering_at";
    if (status === "completed") field = "completed_at";
    if (status === "cancelled") field = "cancelled_at";

    if (field) {
      await conn.query(
        `UPDATE wassel_orders 
         SET status=?, ${field}=NOW() 
         WHERE id=?`,
        [status, orderId]
      );
    } else {
      await conn.query(
        "UPDATE wassel_orders SET status=? WHERE id=?",
        [status, orderId]
      );
    }


    if (status === "delivering") {
      const [[old]] = await conn.query(`
        SELECT id FROM journal_entries
        WHERE reference_type='manual_order'
        AND reference_id=?
        LIMIT 1
      `, [orderId]);

      if (old) throw new Error("تم الترحيل سابقاً");

      const [[settings]] = await conn.query(`
        SELECT * FROM settings LIMIT 1
      `);

      const [[o]] = await conn.query(`
        SELECT 
          w.*,
          c.name AS customer_name,
          c.fcm_token AS customer_fcm_token,

          cap.account_id AS cap_acc_id,

          cg.id AS guarantee_id,
          cg.type AS guarantee_type,
          cg.account_id AS customer_acc_id,

          comA.agent_account_id AS restaurant_acc_id,

          comA.commission_type AS agent_comm_type,
          comA.commission_value AS agent_comm_value,

          comm.commission_type,
          comm.commission_value

        FROM wassel_orders w

        LEFT JOIN customers c ON c.id = w.customer_id
        LEFT JOIN captains cap ON cap.id = w.captain_id
        LEFT JOIN customer_guarantees cg ON cg.customer_id = w.customer_id

        LEFT JOIN restaurants r ON r.id = w.restaurant_id
        LEFT JOIN agents ag ON ag.id = r.agent_id

        LEFT JOIN commissions comA
          ON comA.account_type='agent'
         AND comA.account_id=ag.id
         AND comA.is_active=1

        LEFT JOIN commissions comm
          ON comm.account_type='captain'
         AND comm.account_id=cap.id
         AND comm.is_active=1

        WHERE w.id=?
      `, [orderId]);

      if (!o) throw new Error("الطلب غير موجود");
      if (!o.cap_acc_id) throw new Error("الكابتن بلا حساب");
      if (!o.restaurant_acc_id) throw new Error("المورد بلا حساب");

      const itemsAmount = Number(o.total_amount) - Number(o.delivery_fee);
      const deliveryFee = Number(o.delivery_fee);
      const totalAmount = Number(o.total_amount);

      const captainCommission =
        o.commission_type === "percent"
          ? (deliveryFee * o.commission_value) / 100
          : Number(o.commission_value || 0);

      const agentCommission =
        o.agent_comm_type === "percent"
          ? (itemsAmount * o.agent_comm_value) / 100
          : Number(o.agent_comm_value || 0);

      const note = `طلب يدوي #${orderId} - ${o.customer_name}`;

      if (o.payment_method === "cod") {
        await insertJournal(
          conn,
          o.cap_acc_id,
          itemsAmount,
          0,
          `توريد نقدي للمورد - ${note}`,
          orderId,
          req
        );

        await insertJournal(
          conn,
          o.restaurant_acc_id,
          0,
          itemsAmount,
          `استلام نقدي من كابتن - ${note}`,
          orderId,
          req
        );
      } else if (o.payment_method === "wallet") {
        let payFrom = null;

        if (o.guarantee_type === "account" && o.customer_acc_id) {
          payFrom = o.customer_acc_id;
        } else {
          payFrom = settings.customer_guarantee_account;
        }

        if (!payFrom) {
          throw new Error("حساب محفظة العميل غير معرف");
        }

        await insertJournal(
          conn,
          payFrom,
          totalAmount,
          0,
          `سداد من الرصيد - ${note}`,
          orderId,
          req
        );

        await insertJournal(
          conn,
          o.cap_acc_id,
          0,
          totalAmount,
          `استلام من الرصيد - ${note}`,
          orderId,
          req
        );

        await insertJournal(
          conn,
          o.cap_acc_id,
          itemsAmount,
          0,
          `توريد للمورد - ${note}`,
          orderId,
          req
        );

        await insertJournal(
          conn,
          o.restaurant_acc_id,
          0,
          itemsAmount,
          `استلام من كابتن - ${note}`,
          orderId,
          req
        );

        if (o.guarantee_type !== "account" && o.guarantee_id) {
          await conn.query(`
            INSERT INTO customer_guarantee_moves
            (guarantee_id,currency_id,rate,amount,amount_base)
            VALUES (?,1,1,?,?)
          `, [
            o.guarantee_id,
            -totalAmount,
            -totalAmount
          ]);
        }
      } else if (o.payment_method === "bank") {
        const [[bankRow]] = await conn.query(`
          SELECT 
            COALESCE(bpa.account_id, pm.account_id) AS bank_account_id
          FROM payment_methods pm
          LEFT JOIN branch_payment_accounts bpa
            ON bpa.payment_method_id = pm.id
            AND bpa.branch_id = ?
          WHERE pm.id = ?
          LIMIT 1
        `, [
          req.user.branch_id,
          o.payment_method_id
        ]);

        if (!bankRow?.bank_account_id) {
          throw new Error("حساب البنك غير مربوط لهذا الفرع");
        }

        const bankAccountId = bankRow.bank_account_id;

        await insertJournal(
          conn,
          bankAccountId,
          totalAmount,
          0,
          `تحويل بنكي - ${note}`,
          orderId,
          req
        );

        await insertJournal(
          conn,
          o.cap_acc_id,
          0,
          totalAmount,
          `استلام بنكي - ${note}`,
          orderId,
          req
        );

        await insertJournal(
          conn,
          o.cap_acc_id,
          itemsAmount,
          0,
          `توريد للمورد - ${note}`,
          orderId,
          req
        );

        await insertJournal(
          conn,
          o.restaurant_acc_id,
          0,
          itemsAmount,
          `استلام من كابتن - ${note}`,
          orderId,
          req
        );
      }

      if (captainCommission > 0) {
        await insertJournal(
          conn,
          o.cap_acc_id,
          captainCommission,
          0,
          `خصم عمولة كابتن - ${note}`,
          orderId,
          req
        );

        await insertJournal(
          conn,
          settings.courier_commission_account,
          0,
          captainCommission,
          `إيراد عمولة كابتن - ${note}`,
          orderId,
          req
        );
      }

      if (agentCommission > 0) {
        await insertJournal(
          conn,
          o.restaurant_acc_id,
          agentCommission,
          0,
          `خصم عمولة وكيل - ${note}`,
          orderId,
          req
        );

        await insertJournal(
          conn,
          settings.commission_income_account,
          0,
          agentCommission,
          `إيراد عمولة وكيل - ${note}`,
          orderId,
          req
        );
      }
    }

    await conn.commit();

    const io = req.app.get("io");

    const [[orderInfo]] = await db.query(`
      SELECT
        w.id,
        w.status,
        c.id AS customer_id,
        c.name AS customer_name,
        c.fcm_token AS customer_fcm_token,
        cap.name AS captain_name,
        u.name AS user_name
      FROM wassel_orders w
      LEFT JOIN customers c ON c.id = w.customer_id
      LEFT JOIN captains cap ON cap.id = ?
      LEFT JOIN users u ON u.id = ?
      WHERE w.id = ?
      LIMIT 1
    `, [req.user.id, req.user.id, orderId]);

    let actorName = "النظام";
    let actorIcon = "⚙️";

    if (orderInfo?.captain_name) {
      actorName = orderInfo.captain_name;
      actorIcon = "👨‍✈️";
    } else if (orderInfo?.user_name) {
      actorName = orderInfo.user_name;
      actorIcon = "🧑‍💼";
    }

     const statusMap = {
        pending: "قيد الانتظار",
        processing: "قيد المعالجة",
        ready: "جاهز",
        delivering: "قيد التوصيل",
        completed: "مكتمل",
        cancelled: "ملغي",
        scheduled: "مجدول"
      };

    const statusText = statusMap[status] || status;

    io.emit("admin_notification", {
      type: "manual_order_status",
      order_id: orderId,
      actor_name: actorName,
      customer_name: orderInfo?.customer_name,
      status,
      message: `${actorIcon} ${actorName} حدّث حالة الطلب اليدوي للعميل ${orderInfo?.customer_name} رقم #${orderId} إلى ${statusText}`
    });

    if (orderInfo?.customer_fcm_token) {
      await sendFCMNotification(
        orderInfo.customer_fcm_token,
        "تحديث حالة الطلب",
        `تم تحديث طلبك اليدوي رقم #${orderId} إلى ${statusText}`,
        {
          orderId: String(orderId),
          type: "manual_order_status"
        }
      );
    }

    res.json({ success: true });

  } catch (err) {
    await conn.rollback();

    console.error("❌ MANUAL STATUS ERROR:", err);

    res.status(500).json({
      success: false,
      error: err.message
    });

  } finally {
    conn.release();
  }
});


/* ==============================================
   إدخال قيد
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

  if (!accId) {
    throw new Error("❌ حساب غير مرتبط: " + notes);
  }

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
    debit || 0,
    credit || 0,
    notes,
    refId,
    req.user.id,
    req.user.branch_id || 1

  ]);
}
/* ==============================================
   جلب أوقات التوصيل المتاحة
============================================== */
router.get("/available-slots", async (req, res) => {
  try {

    const branchId =
      req.headers["x-branch-id"] ||
      req.user?.branch_id;

    console.log("🟡 Branch ID:", branchId);

    if (!branchId || branchId === "null") {
      return res.status(400).json({
        success: false,
        message: "الفرع غير محدد"
      });
    }

    const [rows] = await db.query(`
      SELECT *
      FROM branch_work_times
      WHERE branch_id=?
      AND is_closed=0
    `,[branchId]);

    console.log("🟢 Work Times:", rows);

    if (!rows.length){
      return res.json({ success:true, slots:[] });
    }

    const now = new Date();
    const today = new Date();
    today.setHours(0,0,0,0);

    const slots = [];

  for (const r of rows){

  if (!r.open_time || !r.close_time){
    continue;
  }

  // نبحث 7 أيام للأمام
  for (let d = 0; d < 7; d++){

    const day = new Date(today);
    day.setDate(today.getDate() + d);

    // تحويل نظام JS → نظامك (السبت = 0)
    const jsDay = day.getDay();
    const dbDay = (jsDay + 6) % 7;

    if (dbDay !== r.day_of_week) continue;

    let start = new Date(day);
    const [sh, sm] = r.open_time.split(":");
    start.setHours(sh, sm, 0, 0);

    let end = new Date(day);
    const [eh, em] = r.close_time.split(":");
    end.setHours(eh, em, 0, 0);

    // معالجة دوام بعد منتصف الليل
    if (end <= start) {
      end.setDate(end.getDate() + 1);
    }

while (start < end){

  const slotStart = new Date(start);
  const slotEnd   = new Date(start);
  slotEnd.setMinutes(slotEnd.getMinutes() + 30);

  // اليوم فقط: بعد الوقت الحالي
  if (d === 0 && slotStart < now) {
    start.setMinutes(start.getMinutes() + 30);
    continue;
  }

  slots.push({
    start: slotStart.toISOString(),
    end: slotEnd.toISOString()
  });

  start.setMinutes(start.getMinutes() + 30);
}

  }
}


    console.log("🟢 Slots:", slots.length);

    res.json({
      success:true,
      slots
    });

  } catch(err){

    console.error("❌ SLOTS ERROR:", {
      message: err.message,
      stack: err.stack,
      sql: err.sql
    });

    res.status(500).json({
      success:false,
      error: err.message,
      stack: err.stack
    });
  }
});

router.get("/customer-orders", async (req, res) => {

  try {

    const customerId = req.user.id;

    const [rows] = await db.query(`
   SELECT
  w.id,
  COALESCE(w.order_number, w.id) AS order_number,
  w.status,
  w.total_amount,
  w.delivery_fee,
  w.payment_method,
  w.notes,
  w.created_at,
  w.processing_at,
  w.ready_at,
  w.delivering_at,
  w.completed_at,
  w.cancelled_at,

  r.name AS restaurant_name,
  r.image_url AS restaurant_image,   -- هذا السطر الجديد

  cap.name AS captain_name

      FROM wassel_orders w

      LEFT JOIN restaurants r
        ON r.id = w.restaurant_id

      LEFT JOIN captains cap
        ON cap.id = w.captain_id

      WHERE w.customer_id = ?
      AND w.is_manual = 1

      ORDER BY w.id DESC
    `,[customerId]);


    res.json({

      success:true,

      orders:rows

    });

  }
  catch(err){

    console.error(err);

    res.status(500).json({

      success:false

    });

  }

});

//////////////////////
async function sendFCMNotification(token, title, body, data = {}) {
  if (!token) return;

  try {
    await admin.messaging().send({
      token,
      notification: {
        title,
        body
      },
      data: {
        ...data,
        click_action: "FLUTTER_NOTIFICATION_CLICK"
      },
      android: {
        priority: "high",
        notification: {
          sound: "default",
          channelId: "orders_channel"
        }
      }
    });
  } catch (err) {
    console.error("Manual Order FCM Error:", err.message);
  }
}

export default router;
