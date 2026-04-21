import express from "express";
import db from "../db.js";
import auth from "../middlewares/auth.js";
import admin from "firebase-admin";
import { ensureOrderNumberSchema, getNextOrderNumber } from "../utils/orderNumbers.js";
const router = express.Router();




function haversineKm(lat1, lng1, lat2, lng2) {
  const toRad = (v) => (v * Math.PI) / 180;
  const R = 6371;

  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}


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
router.use(async (req, res, next) => {
  try {
    await ensureOrderNumberSchema();
    next();
  } catch (err) {
    next(err);
  }
});

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
   2.5️⃣ أنواع طلبات وصل لي
============================================== */

// جلب الأنواع
router.get("/types", async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT id, name
      FROM wassel_order_types
      ORDER BY id DESC
    `);

    res.json({
      success: true,
      types: rows
    });
  } catch (err) {
    console.error("Get Wassel Types Error:", err);
    res.status(500).json({
      success: false,
      message: "فشل جلب الأنواع"
    });
  }
});

// إضافة نوع
router.post("/types", async (req, res) => {
  try {
    const { name } = req.body;
    const cleanName = String(name || "").trim();

    if (!cleanName) {
      return res.status(400).json({
        success: false,
        message: "اسم النوع مطلوب"
      });
    }

    const [[exists]] = await db.query(
      `SELECT id FROM wassel_order_types WHERE name = ? LIMIT 1`,
      [cleanName]
    );

    if (exists) {
      return res.status(400).json({
        success: false,
        message: "النوع موجود مسبقًا"
      });
    }

    const [result] = await db.query(
      `INSERT INTO wassel_order_types (name, created_at) VALUES (?, NOW())`,
      [cleanName]
    );

    res.json({
      success: true,
      message: "تمت إضافة النوع",
      id: result.insertId
    });
  } catch (err) {
    console.error("Create Wassel Type Error:", err);
    res.status(500).json({
      success: false,
      message: "فشل إضافة النوع"
    });
  }
});

// تعديل نوع
router.put("/types/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { name } = req.body;
    const cleanName = String(name || "").trim();

    if (!cleanName) {
      return res.status(400).json({
        success: false,
        message: "اسم النوع مطلوب"
      });
    }

    const [[exists]] = await db.query(
      `SELECT id FROM wassel_order_types WHERE name = ? AND id <> ? LIMIT 1`,
      [cleanName, id]
    );

    if (exists) {
      return res.status(400).json({
        success: false,
        message: "يوجد نوع آخر بنفس الاسم"
      });
    }

    await db.query(
      `UPDATE wassel_order_types SET name = ? WHERE id = ?`,
      [cleanName, id]
    );

    res.json({
      success: true,
      message: "تم تعديل النوع"
    });
  } catch (err) {
    console.error("Update Wassel Type Error:", err);
    res.status(500).json({
      success: false,
      message: "فشل تعديل النوع"
    });
  }
});

// حذف نوع
router.delete("/types/:id", async (req, res) => {
  try {
    const { id } = req.params;

    await db.query(
      `DELETE FROM wassel_order_types WHERE id = ?`,
      [id]
    );

    res.json({
      success: true,
      message: "تم حذف النوع"
    });
  } catch (err) {
    console.error("Delete Wassel Type Error:", err);
    res.status(500).json({
      success: false,
      message: "فشل حذف النوع"
    });
  }
});

/* ==============================================
   2.6️⃣ وسائل النقل
============================================== */

// جلب وسائل النقل
router.get("/transport-methods", async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT id, name, base_fee, price_per_km, included_km
      FROM wassel_transport_methods
      WHERE is_active = 1
      ORDER BY id DESC
    `);

    res.json({
      success: true,
      methods: rows
    });
  } catch (err) {
    console.error("Get Transport Methods Error:", err);
    res.status(500).json({
      success: false,
      message: "فشل جلب وسائل النقل"
    });
  }
});

// إضافة وسيلة نقل
// إضافة وسيلة نقل
router.post("/transport-methods", async (req, res) => {
  try {
    const { name, base_fee, price_per_km, included_km } = req.body;

    const cleanName = String(name || "").trim();
    const baseFee = Number(base_fee || 0);
    const pricePerKm = Number(price_per_km || 0);
    const includedKm = Number(included_km || 0);

    if (!cleanName) {
      return res.status(400).json({
        success: false,
        message: "اسم وسيلة النقل مطلوب"
      });
    }

    if ([baseFee, pricePerKm, includedKm].some(v => Number.isNaN(v) || v < 0)) {
      return res.status(400).json({
        success: false,
        message: "بيانات التسعير غير صحيحة"
      });
    }

    const [[exists]] = await db.query(
      `SELECT id FROM wassel_transport_methods WHERE name = ? LIMIT 1`,
      [cleanName]
    );

    if (exists) {
      return res.status(400).json({
        success: false,
        message: "وسيلة النقل موجودة مسبقًا"
      });
    }

    const [result] = await db.query(
      `
      INSERT INTO wassel_transport_methods
      (name, base_fee, price_per_km, included_km, is_active, created_at)
      VALUES (?, ?, ?, ?, 1, NOW())
      `,
      [cleanName, baseFee, pricePerKm, includedKm]
    );

    res.json({
      success: true,
      message: "تمت إضافة وسيلة النقل",
      id: result.insertId
    });
  } catch (err) {
    console.error("Create Transport Method Error:", err);
    res.status(500).json({
      success: false,
      message: "فشل إضافة وسيلة النقل"
    });
  }
});
// تعديل وسيلة نقل
// تعديل وسيلة نقل
router.put("/transport-methods/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { name, base_fee, price_per_km, included_km } = req.body;

    const cleanName = String(name || "").trim();
    const baseFee = Number(base_fee || 0);
    const pricePerKm = Number(price_per_km || 0);
    const includedKm = Number(included_km || 0);

    if (!cleanName) {
      return res.status(400).json({
        success: false,
        message: "اسم وسيلة النقل مطلوب"
      });
    }

    if ([baseFee, pricePerKm, includedKm].some(v => Number.isNaN(v) || v < 0)) {
      return res.status(400).json({
        success: false,
        message: "بيانات التسعير غير صحيحة"
      });
    }

    const [[exists]] = await db.query(
      `SELECT id FROM wassel_transport_methods WHERE name = ? AND id <> ? LIMIT 1`,
      [cleanName, id]
    );

    if (exists) {
      return res.status(400).json({
        success: false,
        message: "يوجد وسيلة نقل أخرى بنفس الاسم"
      });
    }

    await db.query(
      `
      UPDATE wassel_transport_methods
      SET name = ?, base_fee = ?, price_per_km = ?, included_km = ?
      WHERE id = ?
      `,
      [cleanName, baseFee, pricePerKm, includedKm, id]
    );

    res.json({
      success: true,
      message: "تم تعديل وسيلة النقل"
    });
  } catch (err) {
    console.error("Update Transport Method Error:", err);
    res.status(500).json({
      success: false,
      message: "فشل تعديل وسيلة النقل"
    });
  }
});

// حذف وسيلة نقل
router.delete("/transport-methods/:id", async (req, res) => {
  try {
    const { id } = req.params;

    await db.query(
      `DELETE FROM wassel_transport_methods WHERE id = ?`,
      [id]
    );

    res.json({
      success: true,
      message: "تم حذف وسيلة النقل"
    });
  } catch (err) {
    console.error("Delete Transport Method Error:", err);
    res.status(500).json({
      success: false,
      message: "فشل حذف وسيلة النقل"
    });
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
        COALESCE(w.order_number, w.id) AS order_number,
        COALESCE(wt.name, CAST(w.order_type AS CHAR)) AS order_type_name,
        tm.name AS transport_method_name,
        c.name AS customer_name,
        cap.name AS captain_name,
        u1.name AS creator_name,
        u2.name AS updater_name
      FROM wassel_orders w
      LEFT JOIN wassel_order_types wt ON wt.id = w.order_type
      LEFT JOIN wassel_transport_methods tm ON tm.id = w.transport_method_id
      LEFT JOIN customers c ON c.id = w.customer_id
      LEFT JOIN captains cap ON cap.id = w.captain_id
      LEFT JOIN users u1 ON u1.id = w.user_id
      LEFT JOIN users u2 ON u2.id = w.updated_by
      WHERE w.is_manual = 0
    `;

    let params = [];

    if (req.user.role === "captain") {
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
      transport_method_id,

      from_address,
      to_address,

      from_address_id,
      to_address_id,

      from_lat,
      from_lng,
      to_lat,
      to_lng,

      distance_km,
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
    let finalToLat = to_lat;
    let finalToLng = to_lng;

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
    const orderNumber = await getNextOrderNumber();

    const [result] = await db.query(`
      INSERT INTO wassel_orders (
        order_number,
        customer_id,
        order_type,
        transport_method_id,

        from_address_id,
        to_address_id,

        from_address,
        from_lat,
        from_lng,

        to_address,
        to_lat,
        to_lng,

        distance_km,
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

      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,NOW())
    `, [
      orderNumber,
      customer_id || null,
      order_type || null,
      transport_method_id || null,

      from_address_id || null,
      to_address_id || null,

      from_address,
      finalFromLat,
      finalFromLng,

      to_address,
      finalToLat,
      finalToLng,

      Number(distance_km || 0),
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

    /* ======================
       بيانات الإشعار
    ====================== */
    const [[customer]] = await db.query(
      `SELECT name FROM customers WHERE id = ? LIMIT 1`,
      [customer_id]
    );

    const customerName = customer?.name || "عميل غير معروف";
    const actorName = req.user?.name || "مستخدم";

    let adminMessage = "";

    if (req.user?.role === "customer") {
      adminMessage = `🧾 العميل ${customerName} أضاف طلب وصل لي رقم #${orderNumber}`;
    } else {
      adminMessage = `🧾 المستخدم ${actorName} أضاف طلب وصل لي للعميل ${customerName} رقم #${orderNumber}`;
    }

    /* ======================
       إشعار لوحة التحكم فقط
    ====================== */
    io.emit("admin_notification", {
      type: "wassel_order_created",
      order_id: orderId,
      order_number: orderNumber,
      actor_name: actorName,
      customer_name: customerName,
      message: adminMessage
    });

    res.json({
      success: true,
      order_id: orderId,
      order_number: orderNumber
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

    const [[captain]] = await db.query(
      "SELECT name, fcm_token FROM captains WHERE id = ?",
      [captainId]
    );


    const [[order]] = await db.query(`
      SELECT
        w.id,
        w.order_number,
        c.name AS customer_name
      FROM wassel_orders w
      LEFT JOIN customers c ON c.id = w.customer_id
      WHERE w.id = ?
      LIMIT 1
    `, [orderId]);

    const captainName = captain?.name || "كابتن";
    const customerName = order?.customer_name || "عميل غير معروف";
    const orderNumber = order?.order_number || orderId;

    /* realtime للكابتن المحدد فقط */
    io.to("captain_" + captainId).emit(
      "new_wassel_order_assigned",
      {
        order_id: orderId,
        order_number: orderNumber,
        message: `🚚 تم إسناد طلب وصل لي رقم #${orderNumber} للعميل ${customerName}`
      }
    );

    /* push للكابتن المحدد فقط */
    if (captain?.fcm_token) {
      await sendFCMNotification(
        captain.fcm_token,
        "🚚 طلب وصل لي جديد",
        `تم إسناد طلب رقم #${orderNumber} للعميل ${customerName}`,
        {
          orderId: String(orderId),
          orderNumber: String(orderNumber),
          type: "wassel_order_assigned"
        }
      );
    }

    /* إشعار لوحة التحكم */
    io.emit("admin_notification", {
      type: "wassel_assigned",
      order_id: orderId,
      order_number: orderNumber,
      captain_name: captainName,
      customer_name: customerName,
      message: `👨‍✈️ تم إسناد طلب وصل لي #${orderNumber} إلى ${captainName} للعميل ${customerName}`
    });

    res.json({ success: true });

  } catch (err) {
    console.error(err);

    res.status(500).json({ success: false });
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
  transport_method_id,

  from_address,
  to_address,

  from_address_id,
  to_address_id,

  from_lat,
  from_lng,
  to_lat,
  to_lng,

  distance_km,
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

    customer_id        = ?,
    order_type         = ?,
    transport_method_id = ?,

    from_address_id    = ?,
    to_address_id      = ?,

    from_address       = ?,
    from_lat           = ?,
    from_lng           = ?,

    to_address         = ?,
    to_lat             = ?,
    to_lng             = ?,

    distance_km        = ?,
    delivery_fee       = ?,
    extra_fee          = ?,
    notes              = ?,

    payment_method     = ?,
    bank_id            = ?,

    scheduled_at       = ?,
    status             = ?,

    updated_by         = ?

  WHERE id = ?
`, [

  customer_id || null,
  order_type,
  transport_method_id || null,

  from_address_id || null,
  to_address_id || null,

  from_address,
  finalFromLat,
  finalFromLng,

  to_address,
  finalToLat,
  finalToLng,

  Number(distance_km || 0),
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
    COALESCE(w.order_number, w.id) AS order_number,
    w.order_type,
    COALESCE(wt.name, w.order_type) AS order_type_name,
    w.transport_method_id,
    tm.name AS transport_method_name,
    w.distance_km,
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
  LEFT JOIN customers c ON c.id = w.customer_id
  LEFT JOIN wassel_transport_methods tm ON tm.id = w.transport_method_id
  LEFT JOIN wassel_order_types wt ON wt.id = w.order_type
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
  try {
    const { id } = req.params;
    const { status } = req.body;

    /* ======================
       التحقق من الطلب
    ====================== */
    const [[currentOrder]] = await db.query(`
      SELECT
        w.id,
        COALESCE(w.order_number, w.id) AS order_number,
        w.status,
        w.captain_id,
        c.name AS customer_name,
        cap.name AS captain_name,
        u.name AS user_name
      FROM wassel_orders w
      LEFT JOIN customers c ON c.id = w.customer_id
      LEFT JOIN captains cap ON cap.id = ?
      LEFT JOIN users u ON u.id = ?
      WHERE w.id = ?
      LIMIT 1
    `, [req.user.id, req.user.id, id]);

    if (!currentOrder) {
      return res.status(404).json({
        success: false,
        message: "الطلب غير موجود"
      });
    }

    /* ======================
       منع التوصيل بدون كابتن
    ====================== */
    if (status === "delivering" && !currentOrder.captain_id) {
      return res.status(400).json({
        success: false,
        message: "لم يتم إسناد كبتن"
      });
    }

    /* ======================
       تحديد وقت الحركة
    ====================== */
    let timeField = null;

    if (status === "confirmed") timeField = "processing_at";
    if (status === "delivering") timeField = "delivering_at";
    if (status === "completed") timeField = "completed_at";
    if (status === "cancelled") timeField = "cancelled_at";

    if (timeField) {
      await db.query(`
        UPDATE wassel_orders
        SET status = ?, ${timeField} = NOW(), updated_by = ?
        WHERE id = ?
      `, [status, req.user.id, id]);
    } else {
      await db.query(`
        UPDATE wassel_orders
        SET status = ?, updated_by = ?
        WHERE id = ?
      `, [status, req.user.id, id]);
    }

    /* ======================
       جلب بيانات الطلب بعد التحديث
    ====================== */
    const [[order]] = await db.query(`
      SELECT
        w.id,
        COALESCE(w.order_number, w.id) AS order_number,
        w.status,
        c.name AS customer_name,
        cap.name AS captain_name,
        u.name AS user_name
      FROM wassel_orders w
      LEFT JOIN customers c ON c.id = w.customer_id
      LEFT JOIN captains cap ON cap.id = ?
      LEFT JOIN users u ON u.id = ?
      WHERE w.id = ?
      LIMIT 1
    `, [req.user.id, req.user.id, id]);

    /* ======================
       تحديد من قام بالتحديث
    ====================== */
    let actorName = "النظام";
    let actorIcon = "⚙️";

    if (order?.captain_name) {
      actorName = order.captain_name;
      actorIcon = "👨‍✈️";
    } else if (order?.user_name) {
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
      order_number: order?.order_number || id,
      actor_name: actorName,
      customer_name: order.customer_name,
      status: status,
      message: `${actorIcon} ${actorName} حدّث حالة طلب العميل ${order.customer_name} رقم #${id} إلى ${statusText}`
    });

    res.json({
      success: true,
      message: "تم تحديث الحالة"
    });

  } catch (err) {
    console.error(err);

    res.status(500).json({
      success: false,
      message: err.message || "Server error"
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

await db.query(
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

router.post("/calculate-fee", async (req, res) => {
  try {
    const {
      transport_method_id,
      from_lat,
      from_lng,
      to_lat,
      to_lng
    } = req.body;

    if (!transport_method_id || !from_lat || !from_lng || !to_lat || !to_lng) {
      return res.status(400).json({
        success: false,
        message: "بيانات الحساب ناقصة"
      });
    }

    const [[method]] = await db.query(`
      SELECT id, name, base_fee, price_per_km, included_km
      FROM wassel_transport_methods
      WHERE id = ?
      LIMIT 1
    `, [transport_method_id]);

    if (!method) {
      return res.status(404).json({
        success: false,
        message: "وسيلة النقل غير موجودة"
      });
    }

    const distanceKm = haversineKm(
      Number(from_lat),
      Number(from_lng),
      Number(to_lat),
      Number(to_lng)
    );

    const includedKm = Number(method.included_km || 0);
    const baseFee = Number(method.base_fee || 0);
    const pricePerKm = Number(method.price_per_km || 0);

    const chargeableKm = Math.max(distanceKm - includedKm, 0);
    const deliveryFee = baseFee + (chargeableKm * pricePerKm);
    const extraFee = 0;

    res.json({
      success: true,
      transport_method: {
        id: method.id,
        name: method.name
      },
      distance_km: Number(distanceKm.toFixed(2)),
      delivery_fee: Number(deliveryFee.toFixed(2)),
      extra_fee: Number(extraFee.toFixed(2)),
      total_fee: Number((deliveryFee + extraFee).toFixed(2))
    });
  } catch (err) {
    console.error("Calculate Wassel Fee Error:", err);
    res.status(500).json({
      success: false,
      message: "فشل حساب الرسوم"
    });
  }
});

export default router;
