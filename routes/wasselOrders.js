import express from "express";
import db from "../db.js";
import auth from "../middlewares/auth.js";
import admin from "firebase-admin";
const router = express.Router();

/* ==============================================
    1️⃣ جلب رصيد العميل (يدعم المحفظة والحساب المحاسبي)
============================================== */
router.get("/:customerId/balance", async (req, res) => {
  try {
    const { customerId } = req.params;

    const [[row]] = await db.query(`
      SELECT 
        cg.id,
        cg.type,
        cg.credit_limit,
        CASE 
          WHEN cg.type = 'account' THEN
            IFNULL((
              SELECT SUM(je.debit) - SUM(je.credit)
              FROM journal_entries je
              WHERE je.account_id = cg.account_id
            ), 0)
          ELSE
            IFNULL((
              SELECT SUM(m.amount_base)
              FROM customer_guarantee_moves m
              WHERE m.guarantee_id = cg.id
            ), 0)
        END AS balance
      FROM customer_guarantees cg
      WHERE cg.customer_id = ?
      LIMIT 1
    `, [customerId]);

    if (!row) {
      return res.json({
        success: true,
        balance: 0,
        credit_limit: 0,
        exists: false
      });
    }

    res.json({
      success: true,
      balance: Number(row.balance),
      credit_limit: Number(row.credit_limit || 0),
      exists: true
    });

  } catch (err) {
    console.error("Balance Error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

/* =========================
    حماية باقي المسارات
========================= */
router.use(auth);

/* ==============================================
    2️⃣ جلب قائمة البنوك
============================================== */
router.get("/banks", async (req, res) => {
  try {
    const branchId = req.headers["x-branch-id"] || req.user.branch_id;
    const [banks] = await db.query(`
      SELECT pm.id, pm.company AS name
      FROM payment_methods pm
      LEFT JOIN branch_payment_accounts bpa ON bpa.payment_method_id = pm.id AND bpa.branch_id = ?
      WHERE pm.is_active = 1 AND (pm.branch_id IS NULL OR pm.branch_id = ?)
    `, [branchId, branchId]);
    res.json({ success: true, banks });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

/* ==============================================
    3️⃣ جلب جميع الطلبات
============================================== */
router.get("/", async (req, res) => {
  try {

    let query = `
      SELECT 
        w.*, 
        c.name AS customer_name, 
        cap.name AS captain_name, 
        u1.name AS creator_name, 
        u2.name AS updater_name
      FROM wassel_orders w
      LEFT JOIN customers c ON c.id = w.customer_id
      LEFT JOIN captains cap ON cap.id = w.captain_id
      LEFT JOIN users u1 ON u1.id = w.user_id
      LEFT JOIN users u2 ON u2.id = w.updated_by
      WHERE w.is_manual = 0
    `;

    let params = [];

    // إذا كان المستخدم كابتن → عرض طلباته فقط
    if(req.user.role === "captain"){

      query += ` AND w.captain_id = ?`;
      params.push(req.user.id);

    }

    query += ` ORDER BY w.id DESC`;

    const [rows] = await db.query(query, params);

    res.json({
      success: true,
      orders: rows
    });

  } catch (err) {

    console.error(err);

    res.status(500).json({
      success: false
    });

  }
});
/* ==============================================
    4️⃣ إضافة طلب جديد (مع الإحداثيات)
============================================== */
router.post("/", async (req, res) => {
  try {

    const {
      customer_id,
      order_type,

      from_address,
      to_address,

      from_address_id,
      to_address_id,

      from_lat,
      from_lng,
      to_lat,
      to_lng,

      delivery_fee,
      extra_fee,
      notes,

      payment_method,
      bank_id,
      scheduled_time
    } = req.body;

    /* ======================
       فحص الرصيد
    ====================== */

    const totalAmount =
      Number(delivery_fee || 0) + Number(extra_fee || 0);

    if (payment_method === "wallet" && customer_id) {

      const [[wallet]] = await db.query(`
        SELECT cg.type, cg.credit_limit,
          CASE 
            WHEN cg.type = 'account'
            THEN IFNULL(
              (SELECT SUM(debit - credit)
               FROM journal_entries
               WHERE account_id = cg.account_id), 0)
            ELSE IFNULL(
              (SELECT SUM(amount_base)
               FROM customer_guarantee_moves
               WHERE guarantee_id = cg.id), 0)
          END AS balance
        FROM customer_guarantees cg
        WHERE cg.customer_id = ?
      `, [customer_id]);

      const available =
        wallet
          ? Number(wallet.balance) + Number(wallet.credit_limit)
          : 0;

      if (available < totalAmount) {
        return res.status(400).json({
          success: false,
          message: "الرصيد غير كافٍ"
        });
      }
    }

    /* ======================
       معالجة الإحداثيات
    ====================== */

    let finalFromLat = from_lat;
    let finalFromLng = from_lng;

    let finalToLat   = to_lat;
    let finalToLng   = to_lng;

    // لو من العناوين المحفوظة
    if (from_address_id) {

      const [[addr]] = await db.query(
        "SELECT latitude, longitude FROM customer_addresses WHERE id = ?",
        [from_address_id]
      );

      if (addr) {
        finalFromLat = addr.latitude;
        finalFromLng = addr.longitude;
      }
    }

    if (to_address_id) {

      const [[addr]] = await db.query(
        "SELECT latitude, longitude FROM customer_addresses WHERE id = ?",
        [to_address_id]
      );

      if (addr) {
        finalToLat = addr.latitude;
        finalToLng = addr.longitude;
      }
    }

    /* ======================
       معالجة الجدولة
    ====================== */

    let scheduledAt = null;
    let status = "pending";

    if (scheduled_time) {

      const d = new Date(scheduled_time);

      scheduledAt = d
        .toISOString()
        .slice(0, 19)
        .replace("T", " ");

      status = "scheduled";
    }

    /* ======================
       الإدخال
    ====================== */

    const [result] = await db.query(`
      INSERT INTO wassel_orders (

        customer_id,
        order_type,

        from_address_id,
        to_address_id,

        from_address,
        from_lat,
        from_lng,

        to_address,
        to_lat,
        to_lng,

        delivery_fee,
        extra_fee,
        notes,

        status,
        payment_method,
        bank_id,

        user_id,
        scheduled_at,
        is_manual,
        created_at

      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,NOW())
    `, [

      customer_id || null,
      order_type,

      from_address_id || null,
      to_address_id || null,

      from_address,
      finalFromLat,
      finalFromLng,

      to_address,
      finalToLat,
      finalToLng,

      delivery_fee || 0,
      extra_fee || 0,
      notes || "",

      status,
      payment_method,
      bank_id || null,

      req.user.id,
      scheduledAt
    ]);

   const orderId = result.insertId;

const io = req.app.get("io");

/* إشعار لوحة التحكم */

io.emit("admin_notification", {

  type: "wassel_order_created",

  order_id: orderId,

  message: `🚚 تم إنشاء طلب وصل لي رقم #${orderId}`

});

/* إرسال للكباتن المتصلين realtime */

io.emit("new_wassel_order", {

  order_id: orderId,

  type: "wassel_order",

  message: `🚚 طلب وصل لي جديد رقم #${orderId}`

});

/* إرسال Push Notification لجميع الكباتن */

const [captains] = await db.query(

  "SELECT id, fcm_token FROM captains WHERE fcm_token IS NOT NULL"

);

for(const captain of captains){

  await sendFCMNotification(

    captain.fcm_token,

    "🚚 طلب وصل لي جديد",

    `طلب رقم #${orderId}`,

    {

      orderId: String(orderId),

      type: "wassel_order"

    }

  );

}

res.json({

  success: true,

  order_id: orderId

});

  } catch (err) {

    console.error("Create Order Error:", err);

    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});


/* ==============================================
    5️⃣ تحديث حالة الطلب وتوليد القيود (المنطق المدمج)
============================================== */
router.put("/status/:id", async (req, res) => {
  const conn = await db.getConnection();
  try {
    const { status } = req.body;
    const orderId = req.params.id;
    await conn.beginTransaction();

let timeField = null;

// عند الاعتماد → مؤكد = يبدأ المعالجة
if (status === "confirmed")  timeField = "processing_at";

// عند التوصيل
if (status === "delivering") timeField = "delivering_at";

// عند الاكتمال
if (status === "completed")  timeField = "completed_at";

// عند الإلغاء
if (status === "cancelled")  timeField = "cancelled_at";

if (timeField) {
  await conn.query(
    `UPDATE wassel_orders 
     SET status = ?, ${timeField} = NOW(), updated_by = ?
     WHERE id = ?`,
    [status, req.user.id, orderId]
  );
} else {
  await conn.query(
    `UPDATE wassel_orders 
     SET status = ?, updated_by = ?
     WHERE id = ?`,
    [status, req.user.id, orderId]
  );
}


    if (status === "delivering") {
      const [[settings]] = await conn.query("SELECT * FROM settings LIMIT 1");
      const [orderRows] = await conn.query(`
        SELECT w.*, cg.id AS guarantee_id, cg.type AS guarantee_type, cg.account_id AS customer_acc_id,
               c.name AS customer_name, cap.account_id AS cap_acc_id, comm.commission_value, comm.commission_type
        FROM wassel_orders w
        LEFT JOIN customer_guarantees cg ON cg.customer_id = w.customer_id
        LEFT JOIN customers c ON c.id = w.customer_id
        LEFT JOIN captains cap ON cap.id = w.captain_id
        LEFT JOIN commissions comm ON comm.account_id = cap.id AND comm.account_type = 'captain' AND comm.is_active = 1
        WHERE w.id = ?
      `, [orderId]);

      const o = orderRows[0];
      if (!o) throw new Error("الطلب غير موجود");
      if (!o.cap_acc_id) throw new Error("الكابتن غير مرتبط بحساب محاسبي");

      const totalCharge = Number(o.delivery_fee) + Number(o.extra_fee);
      const commission = o.commission_type === "percent" ? (totalCharge * o.commission_value) / 100 : Number(o.commission_value || 0);
      const note = `طلب #${orderId} - ${o.customer_name}`;

      // 1. معالجة الدفع (حسب وسيلة الدفع ونوع الحساب)
      if (o.payment_method === "cod") {
        // دفع عند الاستلام: لا قيود سداد، فقط عمولة
      } else {
        // دفع من المحفظة أو الحساب
        if (!o.guarantee_id && o.payment_method === "wallet") throw new Error("العميل لا يملك محفظة تأمين");

        // الفكرة: إذا كان الحساب مرتبط بشجرة الحسابات (type = 'account')، القيد من حساب العميل مباشرة
        // وإذا لم يكن مرتبطاً، القيد من الحساب الوسيط (المنطق القديم)
        const debitAccount = (o.guarantee_type === 'account' && o.customer_acc_id) 
                             ? o.customer_acc_id 
                             : settings.customer_guarantee_account;

        if (!debitAccount) throw new Error("حساب السداد/الوسيط غير معرف");

        // القيد من (العميل أو الوسيط) إلى الكابتن
        await insertEntry(conn, debitAccount, totalCharge, 0, `سداد من تأمين العميل - ${note}`, orderId, req);
        await insertEntry(conn, o.cap_acc_id, 0, totalCharge, `استلام من تأمين العميل - ${note}`, orderId, req);

        // إذا كان المنطق قديم (محفظة نقدية)، سجل الحركة فيmoves
        if (o.guarantee_type !== 'account') {
          await conn.query(`INSERT INTO customer_guarantee_moves (guarantee_id, currency_id, rate, amount, amount_base) VALUES (?, 1, 1, ?, ?)`,
            [o.guarantee_id, -totalCharge, -totalCharge]);
        }
      }

      // 2. معالجة العمولة (تتم في كل الحالات)
      await insertEntry(conn, o.cap_acc_id, commission, 0, `خصم عمولة ${note}`, orderId, req);
      await insertEntry(conn, settings.courier_commission_account, 0, commission, `إيراد عمولة ${note}`, orderId, req);
    }

    await conn.commit();
    res.json({ success: true });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ success: false, message: err.message });
  } finally {
    conn.release();
  }
});

/* ==============================================
    6️⃣ إسناد كابتن
============================================== */
router.post("/assign", async (req, res) => {

  try {

    const { orderId, captainId } = req.body;

    await db.query(

      `UPDATE wassel_orders SET captain_id = ?, updated_by = ? WHERE id = ?`,

      [captainId, req.user.id, orderId]

    );

    const io = req.app.get("io");

    /* realtime */

    io.to("captain_" + captainId).emit(

      "new_wassel_order_assigned",

      {

        order_id: orderId,

        message: `🚚 تم إسناد طلب وصل لي رقم #${orderId}`

      }

    );

    /* push */

    const [[captain]] = await db.query(

      "SELECT fcm_token FROM captains WHERE id=?",

      [captainId]

    );

    if(captain?.fcm_token){

      await sendFCMNotification(

        captain.fcm_token,

        "🚚 طلب وصل لي جديد",

        `تم إسناد طلب رقم #${orderId}`,

        {

          orderId: String(orderId),

          type: "wassel_order_assigned"

        }

      );

    }

    /* admin */

    io.emit("admin_notification", {

      type: "wassel_assigned",

      order_id: orderId,

      message: `👨‍✈️ تم إسناد طلب وصل لي #${orderId}`

    });

    res.json({ success: true });

  }
  catch(err){

    console.error(err);

    res.status(500).json({ success:false });

  }

});

/* ==============================================
    دالة إدراج قيد محاسبي (ثابتة)
============================================== */
async function insertEntry(conn, acc, deb, cre, notes, ref, req) {
  return conn.query(`
    INSERT INTO journal_entries (journal_type_id, account_id, debit, credit, notes, reference_type, reference_id, journal_date, currency_id, created_by, branch_id)
    VALUES (1, ?, ?, ?, ?, 'wassel_order', ?, CURDATE(), 1, ?, ?)
  `, [acc, deb || 0, cre || 0, notes, ref, req.user.id, req.user.branch_id]);
}

/* ==============================================
    7️⃣ تعديل طلب (مع معالجة الإحداثيات)
============================================== */
router.put("/:id", async (req, res) => {
  try {

    const orderId = req.params.id;

    const {
      customer_id,
      order_type,

      from_address,
      to_address,

      from_address_id,
      to_address_id,

      from_lat,
      from_lng,
      to_lat,
      to_lng,

      delivery_fee,
      extra_fee,
      notes,

      payment_method,
      bank_id,
      scheduled_time
    } = req.body;

    /* ======================
       معالجة وقت الجدولة
    ====================== */
    let scheduledAt = null;
    let status = "pending";

    if (scheduled_time) {
      const d = new Date(scheduled_time);

      scheduledAt = d
        .toISOString()
        .slice(0, 19)
        .replace("T", " ");

      status = "scheduled";
    }

    /* ======================
       معالجة الإحداثيات
    ====================== */

    let finalFromLat = from_lat;
    let finalFromLng = from_lng;

    let finalToLat   = to_lat;
    let finalToLng   = to_lng;

    // لو العنوان من المحفوظ → جيب الإحداثيات من قاعدة البيانات
    if (from_address_id) {
      const [[addr]] = await db.query(
        "SELECT latitude, longitude FROM customer_addresses WHERE id = ?",
        [from_address_id]
      );

      if (addr) {
        finalFromLat = addr.latitude;
        finalFromLng = addr.longitude;
      }
    }

    if (to_address_id) {
      const [[addr]] = await db.query(
        "SELECT latitude, longitude FROM customer_addresses WHERE id = ?",
        [to_address_id]
      );

      if (addr) {
        finalToLat = addr.latitude;
        finalToLng = addr.longitude;
      }
    }

    /* ======================
       التحديث
    ====================== */

    await db.query(`
      UPDATE wassel_orders SET

        customer_id     = ?,
        order_type      = ?,

        from_address_id = ?,
        to_address_id   = ?,

        from_address    = ?,
        from_lat        = ?,
        from_lng        = ?,

        to_address      = ?,
        to_lat          = ?,
        to_lng          = ?,

        delivery_fee    = ?,
        extra_fee       = ?,
        notes           = ?,

        payment_method  = ?,
        bank_id         = ?,

        scheduled_at    = ?,
        status          = ?,

        updated_by      = ?

      WHERE id = ?
    `, [

      customer_id || null,
      order_type,

      from_address_id || null,
      to_address_id || null,

      from_address,
      finalFromLat,   // ✅ مضمون
      finalFromLng,   // ✅ مضمون

      to_address,
      finalToLat,     // ✅ مضمون
      finalToLng,     // ✅ مضمون

      delivery_fee || 0,
      extra_fee || 0,
      notes || "",

      payment_method,
      bank_id || null,

      scheduledAt,
      status,

      req.user.id,

      orderId
    ]);

    res.json({ success: true });

  } catch (err) {
    console.error("Update Order Error:", err);
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});


/* ==============================================
   8️⃣ جلب تفاصيل طلب وصل لي
============================================== */
router.get("/:id", async (req, res) => {

  try {

    const orderId = req.params.id;

    /* =========================
       جلب الطلب
    ========================= */

    const [[order]] = await db.query(`
      SELECT

        w.id,
        w.order_type,
        w.is_manual,
        w.status,

        w.from_address,
        w.from_lat,
        w.from_lng,

        w.to_address,
        w.to_lat,
        w.to_lng,

        w.delivery_fee,
        w.extra_fee,

        (w.delivery_fee + w.extra_fee) AS total_fee,

        w.notes,

        w.payment_method,

        w.customer_id,
        c.name AS customer_name,

        w.created_at,
        w.processing_at,
        w.delivering_at,
        w.completed_at,
        w.cancelled_at

      FROM wassel_orders w

      LEFT JOIN customers c
        ON c.id = w.customer_id

      WHERE w.id = ?
      LIMIT 1
    `, [orderId]);

    if (!order) {

      return res.status(404).json({
        success: false,
        message: "الطلب غير موجود"
      });

    }

    /* =========================
       جلب المنتجات (هذا هو الجزء المفقود)
    ========================= */

    const [items] = await db.query(`
      SELECT
        id,
        product_name,
        qty,
        price,
        total
      FROM wassel_order_items
      WHERE order_id = ?
    `, [orderId]);

    /* =========================
       إضافة المنتجات إلى الطلب
    ========================= */

    order.items = items;

    /* =========================
       إرسال النتيجة
    ========================= */

    res.json({
      success: true,
      order
    });

  }
  catch (err) {

    console.error("Wassel Order Details Error:", err);

    res.status(500).json({
      success: false,
      message: err.message
    });

  }

});
/* =========================
   تحديث حالة طلب وصل لي
========================= */
router.put("/:id/status", auth, async (req, res) => {

  try{

    const { id } = req.params;
    const { status } = req.body;

    // تحديث الحالة
    await db.query(`
      UPDATE wassel_orders
      SET status = ?, updated_by = ?
      WHERE id = ?
    `,[status, req.user.id, id]);


    /* ======================
       جلب بيانات الطلب
    ====================== */

    const [[order]] = await db.query(`
      SELECT
        w.id,
        w.status,
        c.name AS customer_name,
        cap.name AS captain_name,
        u.name AS user_name
      FROM wassel_orders w
      LEFT JOIN customers c ON c.id = w.customer_id
      LEFT JOIN captains cap ON cap.id = ?
      LEFT JOIN users u ON u.id = ?
      WHERE w.id = ?
    `,[req.user.id, req.user.id, id]);


    /* ======================
       تحديد من قام بالتحديث
    ====================== */

    let actorName = "النظام";
    let actorIcon = "⚙️";

    if(order?.captain_name){

      actorName = order.captain_name;
      actorIcon = "👨‍✈️";

    }
    else if(order?.user_name){

      actorName = order.user_name;
      actorIcon = "🧑‍💼";

    }


    /* ======================
       تحويل الحالة للعربي
    ====================== */

    const statusMap = {

      pending: "قيد الانتظار",
      confirmed: "قيد المعالجة",
      preparing: "قيد التحضير",
      ready: "جاهز",
      delivering: "قيد التوصيل",
      completed: "مكتمل",
      cancelled: "ملغي",
      scheduled: "مجدول"

    };

    const statusText = statusMap[status] || status;


    /* ======================
       إرسال Socket Notification
    ====================== */

    const io = req.app.get("io");

    io.emit("admin_notification", {

      type: "wassel_status",

      order_id: id,

      actor_name: actorName,

      customer_name: order.customer_name,

      status: status,

      message:
        `${actorIcon} ${actorName} حدث طلب العميل ${order.customer_name} رقم #${id} إلى ${statusText}`

    });


    res.json({
      success:true,
      message:"تم تحديث الحالة"
    });

  }
  catch(err){

    console.error(err);

    res.status(500).json({
      success:false,
      message:"Server error"
    });

  }

});
///////////////////////
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

    console.log("📲 Wassel FCM sent");

  }
  catch(err){

    console.error("Wassel FCM Error:", err.message);

  }

}

// تحديث عنصر طلب يدوي
router.put("/item/:id", auth, async (req,res)=>{

  try{

    const { quantity, price } = req.body;
    const itemId = req.params.id;

    await pool.query(
      `
      UPDATE wassel_order_items
      SET
        qty = COALESCE(?, qty),
        price = COALESCE(?, price),
        total = COALESCE(?, qty) * COALESCE(?, price)
      WHERE id = ?
      `,
      [
        quantity,
        price,
        quantity,
        price,
        itemId
      ]
    );

    res.json({
      success:true
    });

  }
  catch(err){

    console.error(err);

    res.status(500).json({
      success:false
    });

  }

});
export default router;
