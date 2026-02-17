import express from "express";
import db from "../db.js";
import auth from "../middlewares/auth.js";
import admin from "firebase-admin";

const router = express.Router();


/* =========================
   POST /orders/calc-fees
========================= */
router.post("/calc-fees", async (req, res) => {
  try {
     
    const { address_id, restaurants } = req.body;
    const user = req.user || {};

    if (!restaurants || !restaurants.length) {
      return res.json({ success: false });
    }

    const storeIds = restaurants.map(r => r.restaurant_id);
    const storesCount = new Set(storeIds).size;

    let branchId = user.branch_id;

    if (!branchId && address_id) {
      const [addr] = await db.query(
        "SELECT branch_id FROM customer_addresses WHERE id=?",
        [address_id]
      );

      if (addr.length) {
        branchId = addr[0].branch_id;
      }
    }

    let deliveryFee = 0;
    let extraStoreFee = 0;

    if (branchId) {
      const [settingsRows] = await db.query(
        "SELECT * FROM branch_delivery_settings WHERE branch_id=? LIMIT 1",
        [branchId]
      );

      if (settingsRows.length) {
        const settings = settingsRows[0];

        /* ===== حسب الحي ===== */
        if (settings.method === "neighborhood" && address_id) {
          const [addr] = await db.query(
            "SELECT district FROM customer_addresses WHERE id=?",
            [address_id]
          );

          if (addr.length) {
            const [n] = await db.query(
              "SELECT delivery_fee, extra_store_fee FROM neighborhoods WHERE id=?",
              [addr[0].district]
            );

            if (n.length) {
              deliveryFee = Number(n[0].delivery_fee) || 0;

              if (storesCount > 1) {
                extraStoreFee =
                  (storesCount - 1) *
                  (Number(n[0].extra_store_fee) || 0);
              }
            }
          }
        }

        /* ===== حسب المسافة ===== */
        if (settings.method === "distance") {
          deliveryFee = Number(settings.km_price_single) || 0;

          if (storesCount > 1) {
            extraStoreFee =
              (storesCount - 1) *
              (Number(settings.km_price_multi) || 0);
          }
        }
      }
    }

    res.json({
      success: true,
      delivery_fee: deliveryFee,
      extra_store_fee: extraStoreFee,
    });

  } catch (err) {
    console.error("CALC FEES ERROR:", err);
    res.status(500).json({ success: false });
  }
});

  
/*==========================
حماية المسار
==================== */
router.use(auth);


/*====================
للتطبيق
========================*/
router.get("/app", async (req, res) => {

   console.log("APP ORDERS USER:", req.user);

  try {
    const user = req.user;

    if (!user.customer_id) {
      return res.status(403).json({
        success: false,
        message: "حساب ليس عميل",
      });
    }

    if (!user.branch_id) {
      return res.status(400).json({
        success: false,
        message: "لم يتم تحديد فرع",
      });
    }

  const [orders] = await db.query(
  `
SELECT 
  o.id,
  o.status,
  o.total_amount,
  o.created_at,
  b.name AS branch_name,

  GROUP_CONCAT(DISTINCT r.id)   AS restaurant_ids,
  GROUP_CONCAT(DISTINCT r.name) AS restaurant_names,
  GROUP_CONCAT(DISTINCT r.image_url) AS restaurant_images

FROM orders o

JOIN order_items oi
  ON oi.order_id = o.id

JOIN restaurants r
  ON r.id = oi.restaurant_id

JOIN branches b
  ON b.id = o.branch_id

WHERE 
  o.customer_id = ?
  AND o.branch_id = ?

GROUP BY o.id

ORDER BY o.id DESC
  `,
  [
    user.customer_id,
    user.branch_id,
  ]
);

    res.json({
      success: true,
      orders,
    });

  } catch (err) {
    console.error("APP ORDERS ERROR:", err);

    res.status(500).json({
      success: false,
      orders: [],
    });
  }
});


/* =========================
   GET /orders
========================= */
router.get("/", async (req, res) => {
  try {
    const user = req.user;

    const limit = Number(req.query.limit) || 100;
    const dateFilter = req.query.date || "all"; // all | today | week

    /* ======================
       فلترة التاريخ من السيرفر
    ====================== */
    let dateWhere = "";

    if (dateFilter === "today") {
      dateWhere = "AND DATE(o.created_at) = CURDATE()";
    }

    if (dateFilter === "week") {
      dateWhere = "AND o.created_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)";
    }

  /* ======================
       الاستعلام الأساسي
    ====================== */
const baseQuery = `
SELECT 
  o.id,

  -- ⏱️ أوقات الحركة
  o.scheduled_at,
  o.processing_at,
  o.ready_at,
  o.delivering_at,
  o.completed_at,
  o.cancelled_at,

  -- المطاعم (مهم جدًا ORDER BY ثابت)
  GROUP_CONCAT(r.id ORDER BY r.id SEPARATOR '||') AS restaurant_ids,
  GROUP_CONCAT(r.name ORDER BY r.id SEPARATOR '||') AS restaurant_names,
  GROUP_CONCAT(r.address ORDER BY r.id SEPARATOR '||') AS restaurant_addresses,
  GROUP_CONCAT(IFNULL(r.latitude,'') ORDER BY r.id SEPARATOR '||') AS restaurant_lats,
  GROUP_CONCAT(IFNULL(r.longitude,'') ORDER BY r.id SEPARATOR '||') AS restaurant_lngs,

  -- العميل
  c.name AS customer_name,
  c.phone AS customer_phone,
  n.name AS neighborhood_name,
  ca.address AS customer_address,
  ca.latitude,
  ca.longitude,

  -- معلومات إضافية
  u.name AS user_name,
  u1.name AS creator_name,
  u2.name AS updater_name,

  o.status,
  o.note,
  o.total_amount,
  o.delivery_fee,
  o.extra_store_fee,
  o.stores_count,
  o.created_at,

  cap.name AS captain_name,
  o.payment_method,
  b.name AS branch_name,

  CASE o.payment_method
    WHEN 'cod' THEN 'الدفع عند الاستلام'
    WHEN 'bank' THEN 'إيداع بنكي'
    WHEN 'wallet' THEN 'من الرصيد'
    WHEN 'online' THEN 'دفع إلكتروني'
    ELSE '-'
  END AS payment_method_label

FROM orders o

JOIN customers c ON c.id = o.customer_id

LEFT JOIN captains cap ON cap.id = o.captain_id
LEFT JOIN users u ON o.user_id = u.id
LEFT JOIN users u1 ON o.created_by = u1.id
LEFT JOIN users u2 ON o.updated_by = u2.id

LEFT JOIN customer_addresses ca ON o.address_id = ca.id
LEFT JOIN neighborhoods n ON ca.district = n.id
LEFT JOIN branches b ON b.id = o.branch_id

LEFT JOIN (
  SELECT order_id, restaurant_id
  FROM order_items
  GROUP BY order_id, restaurant_id
) oi ON oi.order_id = o.id

LEFT JOIN restaurants r ON r.id = oi.restaurant_id

`;


    let rows = [];

    /* ======================
       Admin Branch
    ====================== */
    if (user.is_admin_branch) {
   [rows] = await db.query(
  `
  ${baseQuery}
  WHERE 1=1
  ${dateWhere}
  GROUP BY o.id
  ORDER BY o.id DESC
  LIMIT ?
  `,
  [limit]
);


    /* ======================
       User Branch
    ====================== */
    } else {
 [rows] = await db.query(
  `
  ${baseQuery}
  WHERE o.branch_id = ?
  ${dateWhere}
  GROUP BY o.id
  ORDER BY o.id DESC
  LIMIT ?
  `,
  [user.branch_id, limit]
);

    }


     rows.forEach(order => {

  const names = order.restaurant_names?.split("||") || [];
  const addresses = order.restaurant_addresses?.split("||") || [];
  const lats = order.restaurant_lats?.split("||") || [];
  const lngs = order.restaurant_lngs?.split("||") || [];

  order.restaurants = names.map((name, i) => ({
    name,
    address: addresses[i] || "",
    latitude: lats[i] || null,
    longitude: lngs[i] || null
  }));

});

    res.json({
      success: true,
      orders: rows,
    });

  } catch (err) {
    console.error("GET ORDERS ERROR:", err);

    res.status(500).json({
      success: false,
      orders: [],
    });
  }
});

/* ===================================================
   POST /orders (المحسن لدعم تكرار الطلب ومنع الأخطاء)
===================================================== */
router.post("/", async (req, res) => {
  try {
const {
  customer_id,
  address_id,
  restaurants,
  payment_method,
  bank_id,
  note,
  gps_link,
  scheduled_at // ✅ جديد
} = req.body;


    const user = req.user || {}; 

    if (!restaurants || !restaurants.length) {
      return res.json({ success: false, message: "السلة فارغة" });
    }

    /* 1. التعديل الأول: معالجة البيانات القادمة بذكاء 
       دعم هيكلية السلة العادية (products) وهيكلية تكرار الطلب (items)
    */
    const products = [];
    restaurants.forEach(rest => {
      // جلب العناصر سواء كانت في مصفوفة products أو items
      const itemsList = rest.products || rest.items || [];
      
      itemsList.forEach(p => {
        // نأخذ product_id أو id ونضمن أنه رقم صحيح
        const pId = p.product_id || p.id;
        if (pId) {
          products.push({
            restaurant_id: rest.restaurant_id || rest.id,
            product_id: pId,
            quantity: Number(p.quantity) || 1
          });
        }
      });
    });

    if (products.length === 0) {
      return res.status(400).json({ success: false, message: "لم يتم العثور على منتجات صالحة" });
    }

    // تجهيز بيانات الفرع والرسوم
    const storeIds = [...new Set(products.map((p) => p.restaurant_id))];
    const storesCount = storeIds.length;
    const mainRestaurantId = storeIds[0];
    const userId = user.id; // تسجيل الموظف الذي أنشأ الطلب
     
    const headerBranch = req.headers["x-branch-id"];
    let branchId = headerBranch ? Number(headerBranch) : user.branch_id || null;

    if (!branchId && address_id) {
      const [addrBranch] = await db.query("SELECT branch_id FROM customer_addresses WHERE id=?", [address_id]);
      if (addrBranch.length) branchId = addrBranch[0].branch_id;
    }

    let deliveryFee = 0;
    let extraStoreFee = 0;

    // (حساب الرسوم - يبقى كما هو في كودك)
    if (branchId) {
      const [settingsRows] = await db.query("SELECT * FROM branch_delivery_settings WHERE branch_id=? LIMIT 1", [branchId]);
      if (settingsRows.length) {
        const settings = settingsRows[0];
        if (settings.method === "neighborhood" && address_id) {
          const [addr] = await db.query("SELECT district FROM customer_addresses WHERE id=?", [address_id]);
          if (addr.length && addr[0].district) {
            const [n] = await db.query("SELECT delivery_fee, extra_store_fee FROM neighborhoods WHERE id=?", [addr[0].district]);
            if (n.length) {
              deliveryFee = Number(n[0].delivery_fee) || 0;
              if (storesCount > 1) extraStoreFee = (storesCount - 1) * (Number(n[0].extra_store_fee) || 0);
            }
          }
        }
        if (settings.method === "distance") {
          deliveryFee = Number(settings.km_price_single) || 0;
          if (storesCount > 1) extraStoreFee = (storesCount - 1) * (Number(settings.km_price_multi) || 0);
        }
      }
    }
     
// ✅ تحويل وقت الجدولة لصيغة MySQL
let scheduledAtSQL = null;

if (scheduled_at) {
  const d = new Date(scheduled_at);

  const pad = n => n.toString().padStart(2, "0");

  scheduledAtSQL =
    d.getFullYear() + "-" +
    pad(d.getMonth() + 1) + "-" +
    pad(d.getDate()) + " " +
    pad(d.getHours()) + ":" +
    pad(d.getMinutes()) + ":00";
}



    // إنشاء رأس الطلب (Order Header)
    const [result] = await db.query(
  `
 INSERT INTO orders (
  customer_id,
  address_id,
  restaurant_id,
   created_by,
  updated_by,
  note,
  gps_link,
  stores_count,
  branch_id,
  user_id,
  delivery_fee,
  extra_store_fee,
  payment_method,
  bank_id,
  scheduled_at,   -- ✅
  status          -- ✅
)

VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)

  `,
[
  customer_id,
  address_id,
  mainRestaurantId,
   userId,   // created_by
  userId,   // updated_by
  note || null,
  gps_link || null,
  storesCount,
  branchId,
  userId,
  deliveryFee,
  extraStoreFee,
  payment_method || null,
  bank_id || null,

  scheduledAtSQL,                 // ✅ هنا
  scheduled_at ? "scheduled" : "pending"      // ✅
]

);


    const orderId = result.insertId;
    let total = 0;

    /* 2. التعديل الثاني: التحقق الآمن من المنتجات (السطر الذي كان يسبب الخطأ 500)
    */
    for (const p of products) {
      const [rows] = await db.query("SELECT name, price FROM products WHERE id=?", [p.product_id]);

      // فحص هل المنتج موجود فعلاً؟ (هذا يمنع الانهيار إذا كان الـ ID خطأ)
      if (!rows || rows.length === 0) {
        console.error(`❌ المنتج رقم ${p.product_id} غير موجود في الداتابيز`);
        continue; // تخطى هذا المنتج وأكمل البقية
      }

      const prod = rows[0];
      const subtotal = Number(prod.price) * Number(p.quantity);
      total += subtotal;

      await db.query(
        `INSERT INTO order_items (order_id, product_id, restaurant_id, name, price, quantity)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [orderId, p.product_id, p.restaurant_id, prod.name, prod.price, p.quantity]
      );
    }

    // تحديث إجمالي المبلغ النهائي
    const grandTotal = total + deliveryFee + extraStoreFee;
    await db.query("UPDATE orders SET total_amount=? WHERE id=?", [grandTotal, orderId]);

 /* =========================
   إشعارات إنشاء الطلب
========================= */

const io = req.app.get("io");

/* جلب اسم العميل */
const [[customer]] = await db.query(
  "SELECT name FROM customers WHERE id=?",
  [customer_id]
);

/* اسم المستخدم (الموظف) */
const creatorName = req.user?.name || "العميل";

/* لوحة التحكم */
io.emit("admin_notification", {
  type: "order_created",
  order_id: orderId,
  message:
    req.user?.role === "customer"
      ? `🧾 العميل ${customer?.name} أنشأ طلب رقم #${orderId}`
      : `👨‍💼 المستخدم ${creatorName} أنشأ طلب للعميل ${customer?.name} رقم #${orderId}`
});

    res.json({ success: true, order_id: orderId, total: grandTotal });

  } catch (err) {
    console.error("ADD ORDER ERROR:", err);
    res.status(500).json({ success: false, error: "حدث خطأ أثناء معالجة الطلب" });
  }
});
/* =========================
   GET /profile/stats
   إحصائيات البروفايل
========================= */
router.get("/profile/stats", async (req, res) => {
  try {
    const user = req.user;

    if (!user.customer_id) {
      return res.status(403).json({
        success: false,
        message: "ليس عميل",
      });
    }

    /* عدد الطلبات (كل الفروع) */
    const [[ordersRow]] = await db.query(
      `
      SELECT COUNT(*) AS total_orders
      FROM orders
      WHERE customer_id = ?
      `,
      [user.customer_id]
    );

    /* الرصيد من customer_guarantees */
    const [[walletRow]] = await db.query(
      `
      SELECT
        CASE 
          WHEN cg.type = 'account' THEN
            IFNULL((
              SELECT IFNULL(SUM(je.debit),0) - IFNULL(SUM(je.credit),0)
              FROM journal_entries je
              WHERE je.account_id = cg.account_id
            ), 0)
          ELSE IFNULL((
            SELECT SUM(m.amount_base)
            FROM customer_guarantee_moves m
            WHERE m.guarantee_id = cg.id
          ), 0)
        END AS balance
      FROM customer_guarantees cg
      WHERE cg.customer_id = ?
      LIMIT 1
      `,
      [user.customer_id]
    );

    res.json({
      success: true,
      total_orders: ordersRow?.total_orders || 0,
      balance: Number(walletRow?.balance || 0),
    });

  } catch (err) {
    console.error("PROFILE STATS ERROR:", err);

    res.status(500).json({
      success: false,
      total_orders: 0,
      balance: 0,
    });
  }
});
/* ==============================================
   8️⃣ جلب طلبات وصل لي للكابتن
============================================== */
router.get("/wassel_orders", async (req, res) => {

  try {

    const captainId = req.user.id;

    const [rows] = await db.query(`

      SELECT

        w.id,
        w.order_type,
        w.status,

        w.from_address,
        w.from_lat,
        w.from_lng,

        w.to_address,
        w.to_lat,
        w.to_lng,

        w.delivery_fee,
        w.extra_fee,

        w.payment_method,
        w.notes,              -- ✅ أضف هذا

        w.customer_id,
        c.name AS customer_name,

        w.created_at

      FROM wassel_orders w

      LEFT JOIN customers c
        ON c.id = w.customer_id

      WHERE

        w.is_manual = 0

        AND
        (
          w.captain_id IS NULL
          OR w.captain_id = ?
        )

      ORDER BY w.id DESC

    `, [captainId]);


    res.json({
      success: true,
      orders: rows
    });

  }
  catch (err) {

    console.error("Wassel Orders Error:", err);

    res.status(500).json({
      success: false,
      message: err.message
    });

  }

});
//////////////////////////
router.get("/:id", async (req, res) => {
  try {
    const orderId = req.params.id;

    const [rows] = await db.query(
      `
      SELECT 
        o.id,
          o.status,          -- ✅ أضف هذا

  o.created_at,      -- ✅ وهذا
   o.cancel_reason,    -- ✅ أضف هذا

      -- أوقات الحالة
  o.created_at,
  o.processing_at,
  o.ready_at,
  o.delivering_at,
  o.completed_at,
  o.cancelled_at,
    
    o.note,    
        c.name AS customer_name,
        c.phone AS customer_phone,
        a.district AS neighborhood_name,
        a.address AS customer_address,
        a.gps_link AS map_url, 
        a.latitude,
        a.longitude,
        o.delivery_fee,
        o.extra_store_fee,
        o.total_amount,
        o.payment_method,
        o.bank_id
      FROM orders o
      JOIN customers c ON c.id = o.customer_id
      LEFT JOIN customer_addresses a ON a.id = o.address_id
      WHERE o.id=?
      `,
      [orderId]
    );

    if (!rows.length) {
      return res.status(404).json({ success: false, message: "الطلب غير موجود" });
    }

    const order = rows[0];

    const [items] = await db.query(
      `
      SELECT 
        oi.id,
        oi.name,
            oi.product_id,  
        oi.price,
        oi.quantity,
        oi.restaurant_id,
        r.name AS restaurant_name,
            r.image_url AS restaurant_image, 
        r.phone AS restaurant_phone,
        r.map_url
      FROM order_items oi
      JOIN restaurants r ON r.id = oi.restaurant_id
      WHERE oi.order_id=?
      ORDER BY oi.restaurant_id
      `,
      [orderId]
    );

    const restaurants = [];
    const map = {};

    for (const it of items) {
      if (!map[it.restaurant_id]) {
        map[it.restaurant_id] = {
          id: it.restaurant_id,
          name: it.restaurant_name,
  restaurant_image: it.restaurant_image, // ✅ مهم
          phone: it.restaurant_phone,
          map_url: it.map_url,
          items: [],
          total: 0,
        };
        restaurants.push(map[it.restaurant_id]);
      }

      const subtotal = it.price * it.quantity;
      map[it.restaurant_id].total += subtotal;

      map[it.restaurant_id].items.push({
        id: it.id,
           product_id: it.product_id, 
        name: it.name,
        price: it.price,
        quantity: it.quantity,
        subtotal,
      });
    }

    order.restaurants = restaurants;

    res.json({ success: true, order });
  } catch (err) {
    console.error("ORDER DETAILS ERROR:", err);
    res.status(500).json({ success: false });
  }
});

/* =====================================================
   PUT /orders/:id/status
   تحديث حالة الطلب وتوليد القيود المحاسبية + إشعارات FCM و Socket.io
===================================================== */
router.put("/:id/status", async (req, res) => {
  const conn = await db.getConnection();
  try {
    const { status } = req.body; 
    const orderId = req.params.id;
    const updated_by = req.user.id;

    if (!status) return res.status(400).json({ success: false, message: "الحالة غير محددة" });

    await conn.beginTransaction();

    // منع اعتماد الطلب المجدول قبل وقته
    if (status === "confirmed" || status === "processing") {
      const [[row]] = await conn.query(
        "SELECT scheduled_at FROM orders WHERE id=?",
        [orderId]
      );

      if (row?.scheduled_at) {
        const now = new Date();
        const sch = new Date(row.scheduled_at);

        if (now < sch) {
          return res.status(400).json({
            success: false,
            message: "⏰ لا يمكن اعتماد الطلب قبل وقت الجدولة"
          });
        }
      }
    }

    // 1. تحديث حالة الطلب
    let timeField = null;
    if (status === "confirmed" || status === "preparing") timeField = "processing_at";
    if (status === "ready") timeField = "ready_at";
    if (status === "delivering") timeField = "delivering_at";
    if (status === "completed") timeField = "completed_at";
    if (status === "cancelled") timeField = "cancelled_at";

    if (timeField) {
      await conn.query(
        `UPDATE orders 
         SET status=?,
             ${timeField}=NOW(),
             scheduled_at=NULL,
             updated_by=?
         WHERE id=?`,
        [status, req.user.id, orderId]
      );
    } else {
      await conn.query(
        `UPDATE orders 
         SET status=?, updated_by=?
         WHERE id=?`,
        [status, req.user.id, orderId]
      );
    }

    // 2. توليد القيود عند الانتقال لحالة "قيد التوصيل"
    if (status === "delivering") {
      const [[settings]] = await conn.query("SELECT * FROM settings LIMIT 1");
      const [[baseCur]] = await conn.query("SELECT id FROM currencies WHERE is_local=1 LIMIT 1");
      const journalTypeId = 5; 

      const [orderRows] = await conn.query(`
        SELECT 
          o.*,
          pm.account_id AS bank_account_id,
          cap.name AS captain_name,
          cg.type AS guarantee_type, cg.account_id AS direct_acc_id,
          c_comm.agent_account_id AS cap_acc_id, 
          c_comm.commission_type AS cap_comm_type, 
          c_comm.commission_value AS cap_comm_val
        FROM orders o
        LEFT JOIN customer_guarantees cg ON cg.customer_id = o.customer_id
        LEFT JOIN payment_methods pm ON o.bank_id = pm.id
        LEFT JOIN captains cap ON cap.id = o.captain_id
        LEFT JOIN commissions c_comm ON (c_comm.account_id = o.captain_id AND c_comm.account_type = 'captain' AND c_comm.is_active = 1)
        WHERE o.id = ?
      `, [orderId]);

      const order = orderRows[0];
      if (!order) throw new Error("الطلب غير موجود");

      let mainDebitAccount = null;
      if (order.guarantee_type === 'account' && order.direct_acc_id) {
        mainDebitAccount = order.direct_acc_id;
      } else {
        const pMethod = String(order.payment_method).toLowerCase();
        if (pMethod === "cod") mainDebitAccount = order.cap_acc_id;
        else if (pMethod === "bank") mainDebitAccount = order.bank_account_id || 10;
        else mainDebitAccount = settings.customer_guarantee_account || 51;
      }

      const [restaurantItems] = await conn.query(`
        SELECT 
          oi.restaurant_id, 
          MAX(r.name) AS restaurant_name,
          MAX(r_comm.agent_account_id) AS res_acc_id, 
          MAX(r_comm.commission_type) AS res_comm_type, 
          MAX(r_comm.commission_value) AS res_comm_val,
          SUM(oi.price * oi.quantity) AS net_amount
        FROM order_items oi
        JOIN restaurants r ON oi.restaurant_id = r.id
        LEFT JOIN commissions r_comm 
          ON (r_comm.account_id = r.agent_id 
              AND r_comm.account_type = 'agent' 
              AND r_comm.is_active = 1)
        WHERE oi.order_id = ?
        GROUP BY oi.restaurant_id
      `, [orderId]);

      for (const res of restaurantItems) {
        if (res.res_acc_id && res.net_amount > 0) {
          await insertJournalEntry(conn, journalTypeId, orderId, baseCur.id, mainDebitAccount, res.net_amount, 0, `قيمة وجبات من ${res.restaurant_name} طلب #${orderId}`, req);
          await insertJournalEntry(conn, journalTypeId, orderId, baseCur.id, res.res_acc_id, 0, res.net_amount, `صافي مبيعات طلب #${orderId}`, req);

          if (settings.commission_income_account && res.res_comm_val > 0) {
            let resComm = (res.res_comm_type === 'percent') ? (res.net_amount * Number(res.res_comm_val)) / 100 : Number(res.res_comm_val);
            await insertJournalEntry(conn, journalTypeId, orderId, baseCur.id, res.res_acc_id, resComm, 0, `خصم عمولة ${res.restaurant_name} طلب #${orderId}`, req);
            await insertJournalEntry(conn, journalTypeId, orderId, baseCur.id, settings.commission_income_account, 0, resComm, `إيراد عمولة مطعم #${orderId}`, req);
          }
        }
      }

      const deliveryTotal = Number(order.delivery_fee || 0) + Number(order.extra_store_fee || 0);
      if (deliveryTotal > 0 && order.cap_acc_id) {
        await insertJournalEntry(conn, journalTypeId, orderId, baseCur.id, mainDebitAccount, deliveryTotal, 0, `إجمالي رسوم توصيل طلب #${orderId}`, req);
        await insertJournalEntry(conn, journalTypeId, orderId, baseCur.id, order.cap_acc_id, 0, deliveryTotal, `إيراد توصيل كابتن طلب #${orderId}`, req);

        if (settings.courier_commission_account && order.cap_comm_val > 0) {
          let capComm = (order.cap_comm_type === 'percent') ? (deliveryTotal * Number(order.cap_comm_val)) / 100 : Number(order.cap_comm_val);
          await insertJournalEntry(conn, journalTypeId, orderId, baseCur.id, order.cap_acc_id, capComm, 0, `خصم عمولة شركة من الكابتن طلب #${orderId}`, req);
          await insertJournalEntry(conn, journalTypeId, orderId, baseCur.id, settings.courier_commission_account, 0, capComm, `إيراد عمولة كابتن #${orderId}`, req);
        }
      }
    }

    await conn.commit();

    /* =========================
       إشعارات FCM (للعميل والكابتن)
    ========================= */
    try {
      const [[orderContacts]] = await conn.query(`
        SELECT 
          o.id, 
          c.fcm_token AS customer_token, 
          cap.fcm_token AS captain_token,
          c.name AS customer_name,
          u.name AS user_name
        FROM orders o
        LEFT JOIN customers c ON o.customer_id = c.id
        LEFT JOIN captains cap ON o.captain_id = cap.id
        LEFT JOIN users u ON u.id = ?
        WHERE o.id = ?
      `, [updated_by, orderId]);

      if (orderContacts) {
        let title = "تحديث في طلبك 📦";
        let body = "";

        if (status === "processing") body = `بدأ المطعم في تحضير طلبك رقم #${orderId} 👨‍🍳`;
        else if (status === "ready") body = `أبشر! طلبك رقم #${orderId} جاهز للاستلام 🥯`;
        else if (status === "delivering") body = `الكابتن استلم طلبك رقم #${orderId} وهو في الطريق إليك 🏍️`;
        else if (status === "completed") body = `تم توصيل الطلب رقم #${orderId} بنجاح، بالعافية! ❤️`;
        else if (status === "cancelled") body = `نعتذر منك، تم إلغاء طلبك رقم #${orderId} ❌`;

        // إرسال للعميل
        if (body && orderContacts.customer_token) {
          await sendFCMNotification(orderContacts.customer_token, title, body, { orderId: String(orderId), status });
        }

        // إرسال للكابتن (تنبيه بالاستلام عند الجاهزية)
        if (status === "ready" && orderContacts.captain_token) {
          await sendFCMNotification(
            orderContacts.captain_token, 
            "📦 طلب جاهز", 
            `الطلب رقم #${orderId} للعميل ${orderContacts.customer_name} جاهز في المطعم.`,
            { orderId: String(orderId), type: "order_ready" }
          );
        }

        /* =========================
           إشعار لوحة التحكم (Socket.io)
        ========================= */
        const io = req.app.get("io");
        io.emit("admin_notification", {
          type: "order_status_updated",
          order_id: orderId,
          message: `📦 المستخدم ${orderContacts.user_name || "غير معروف"} حدث طلب #${orderId} للعميل ${orderContacts.customer_name} إلى (${status})`
        });
      }
    } catch (fcmErr) {
      console.error("FCM NOTIFICATION ERROR:", fcmErr.message);
      // لا نوقف العملية إذا فشل الإشعار
    }

    res.json({ success: true });
  } catch (err) {
    if (conn) await conn.rollback();
    console.error("FINALIZE ORDER ERROR:", err.message);
    res.status(500).json({ success: false, message: err.message });
  } finally {
    if (conn) conn.release();
  }
});
/* =====================================================
   دالة مساعدة لإدراج القيود (insertJournalEntry)
===================================================== */
async function insertJournalEntry(conn, type, refId, cur, acc, debit, credit, notes, req) {
  return conn.query(
    `INSERT INTO journal_entries 
     (journal_type_id, reference_type, reference_id, journal_date, currency_id, account_id, debit, credit, notes, created_by, branch_id)
     VALUES (?, 'order', ?, CURDATE(), ?, ?, ?, ?, ?, ?, ?)`,
    [type, refId, cur, acc, debit || 0, credit || 0, notes, req.user.id, req.user.branch_id]
  );
}
/* =========================
   POST /orders/:id/assign
   تعيين كابتن + إشعارات كاملة
========================= */
router.post("/:id/assign", async (req, res) => {

  try {

    const { captain_id } = req.body;
    const orderId = req.params.id;

    if (!captain_id) {
      return res.status(400).json({
        success: false,
        message: "captain_id مطلوب"
      });
    }

    /* =========================
       تحديث الطلب
    ========================= */
    await db.query(
      "UPDATE orders SET captain_id=? WHERE id=?",
      [captain_id, orderId]
    );

    const io = req.app.get("io");

    /* =========================
       جلب بيانات الكابتن
    ========================= */
    const [[captain]] = await db.query(
      "SELECT id, name, fcm_token FROM captains WHERE id=?",
      [captain_id]
    );

    /* =========================
       جلب بيانات الطلب والعميل
    ========================= */
    const [[order]] = await db.query(`
      SELECT 
        o.id,
        c.name AS customer_name
      FROM orders o
      LEFT JOIN customers c ON c.id = o.customer_id
      WHERE o.id=?
    `, [orderId]);

    const customerName = order?.customer_name || "غير معروف";

    /* =========================
       realtime للكابتن
    ========================= */
    io.to("captain_" + captain_id).emit("new_order_assigned", {

      type: "new_order",

      order_id: orderId,

      message:
        `🚀 وصلك طلب رقم #${orderId} للعميل ${customerName} — عجل عليه يا وحش`

    });

    console.log("📡 realtime sent to captain:", captain_id);

    /* =========================
       Push Notification للكابتن
    ========================= */
    if (captain?.fcm_token) {

      await admin.messaging().send({

        token: captain.fcm_token,

        notification: {

          title: "🚀 طلب جديد",

          body:
            `طلب رقم #${orderId} للعميل ${customerName}`

        },

        data: {

          orderId: String(orderId),

          customerName: customerName,

          type: "new_order"

        }

      });

      console.log("📲 FCM sent to captain:", captain.name);

    }

    /* =========================
       إشعار لوحة التحكم
    ========================= */
    io.emit("admin_notification", {

      type: "captain_assigned",

      order_id: orderId,

      captain_id: captain_id,

      message:
        `👨‍✈️ تم تعيين الكابتن ${captain?.name} للطلب رقم #${orderId} الخاص بالعميل ${customerName}`

    });

    console.log("📡 admin notification sent");

    /* =========================
       الرد
    ========================= */
    res.json({
      success: true,
      message: "تم تعيين الكابتن بنجاح"
    });

  }
  catch (err) {

    console.error("ASSIGN CAPTAIN ERROR:", err);

    res.status(500).json({
      success: false,
      message: "فشل تعيين الكابتن"
    });

  }

});



router.get("/:id/details", async (req, res) => {

  try {

    const orderId = req.params.id;

    const [rows] = await db.query(`
      SELECT 

        r.id AS restaurant_id,
        r.name AS restaurant_name,

        oi.product_id,
        oi.quantity,
        oi.price,

        p.name AS product_name

      FROM order_items oi

      JOIN restaurants r ON r.id = oi.restaurant_id
      JOIN products p ON p.id = oi.product_id

      WHERE oi.order_id = ?

      ORDER BY r.id

    `, [orderId]);


    res.json({
      success: true,
      items: rows
    });

  } catch (err) {

    console.error(err);

    res.json({
      success: false,
      items: []
    });

  }

});
/* =========================
   DELETE /orders/item/:id
========================= */
router.delete("/item/:id", async (req, res) => {

  const conn = await db.getConnection();

  try {

    const itemId = req.params.id;

    await conn.beginTransaction();

    // جلب بيانات المنتج قبل الحذف
    const [[item]] = await conn.query(
      `
      SELECT order_id, price, quantity
      FROM order_items
      WHERE id=?
      `,
      [itemId]
    );

    if (!item) {
      return res.json({ success:false });
    }

    const subtotal =
      Number(item.price) * Number(item.quantity);

    // حذف المنتج
    await conn.query(
      `DELETE FROM order_items WHERE id=?`,
      [itemId]
    );

    // تحديث إجمالي الطلب
    await conn.query(
      `
      UPDATE orders
      SET total_amount = total_amount - ?
      WHERE id=?
      `,
      [subtotal, item.order_id]
    );

    await conn.commit();

    res.json({ success:true });

  } catch(err){

    await conn.rollback();

    console.error(err);

    res.status(500).json({ success:false });

  } finally {

    conn.release();

  }

});
/* =========================
   PUT /orders/item/:id
========================= */
router.put("/item/:id", async (req, res) => {

  const conn = await db.getConnection();

  try {

    const itemId = req.params.id;
    const { quantity } = req.body;

    if (!quantity || quantity < 1) {
      return res.json({ success:false });
    }

    await conn.beginTransaction();

    const [[item]] = await conn.query(
      `
      SELECT order_id, price, quantity
      FROM order_items
      WHERE id=?
      `,
      [itemId]
    );

    if (!item) {
      return res.json({ success:false });
    }

    const oldTotal =
      Number(item.price) * Number(item.quantity);

    const newTotal =
      Number(item.price) * Number(quantity);

    const diff = newTotal - oldTotal;

    // تحديث الكمية
    await conn.query(
      `
      UPDATE order_items
      SET quantity=?
      WHERE id=?
      `,
      [quantity, itemId]
    );

    // تحديث إجمالي الطلب
    await conn.query(
      `
      UPDATE orders
      SET total_amount = total_amount + ?
      WHERE id=?
      `,
      [diff, item.order_id]
    );

    await conn.commit();

    res.json({ success:true });

  } catch(err){

    await conn.rollback();

    console.error(err);

    res.status(500).json({ success:false });

  } finally {

    conn.release();

  }

});
/* =========================
   POST /orders/:id/item
========================= */
router.post("/:id/item", async (req, res) => {

  const conn = await db.getConnection();

  try {

    const orderId = req.params.id;

    const {
      product_id,
      quantity,
      restaurant_id
    } = req.body;

    await conn.beginTransaction();

    const [[product]] = await conn.query(
      `
      SELECT name, price
      FROM products
      WHERE id=?
      `,
      [product_id]
    );

    if (!product) {
      return res.json({ success:false });
    }

    const subtotal =
      Number(product.price) * Number(quantity);

    await conn.query(
      `
      INSERT INTO order_items
      (
        order_id,
        product_id,
        restaurant_id,
        name,
        price,
        quantity
      )
      VALUES (?,?,?,?,?,?)
      `,
      [
        orderId,
        product_id,
        restaurant_id,
        product.name,
        product.price,
        quantity
      ]
    );

    await conn.query(
      `
      UPDATE orders
      SET total_amount =
      total_amount + ?
      WHERE id=?
      `,
      [subtotal, orderId]
    );

    await conn.commit();

    res.json({ success:true });

  } catch(err){

    await conn.rollback();

    console.error(err);

    res.status(500).json({ success:false });

  } finally {

    conn.release();

  }

});

//////اضاف منتج تطبيق الكباتن
router.get("/restaurants/:id/products", async (req, res) => {

  try {

    const restaurantId = req.params.id;

    const [rows] = await db.query(`
      SELECT 
        id,
        name,
        price
      FROM products
      WHERE restaurant_id = ?
      AND is_available = 1
      ORDER BY name
    `,[restaurantId]);

    res.json({
      success:true,
      products:rows
    });

  } catch(err){

    console.error(err);

    res.json({
      success:false,
      products:[]
    });

  }

});

/* =========================
   PUT /orders/:id/cancel
   إلغاء الطلب مع حفظ السبب
========================= */
router.put("/:id/cancel", async (req, res) => {

  const conn = await db.getConnection();

  try {

    const orderId = req.params.id;
    const { reason } = req.body;

    if (!reason) {
      return res.status(400).json({
        success: false,
        message: "سبب الإلغاء مطلوب"
      });
    }

    await conn.beginTransaction();

    await conn.query(
      `
      UPDATE orders
      SET
        status = 'cancelled',
        cancel_reason = ?,
        cancelled_at = NOW(),
        updated_by = ?
      WHERE id = ?
      `,
      [reason, req.user.id, orderId]
    );

await conn.commit();

    /* =========================
       🚀 إرسال إشعار الإلغاء
    ========================= */
    try {
      const [[cancelContacts]] = await conn.query(`
        SELECT c.fcm_token AS customer_token, cap.fcm_token AS captain_token 
        FROM orders o
        LEFT JOIN customers c ON o.customer_id = c.id
        LEFT JOIN captains cap ON o.captain_id = cap.id
        WHERE o.id = ?
      `, [orderId]);

      // إشعار للعميل
      if (cancelContacts?.customer_token) {
        await sendFCMNotification(cancelContacts.customer_token, "❌ تم إلغاء الطلب", `تم إلغاء طلبك رقم #${orderId}. السبب: ${reason}`);
      }
      
      // إشعار للكابتن (لينتبه ولا يذهب للمطعم)
      if (cancelContacts?.captain_token) {
        await sendFCMNotification(cancelContacts.captain_token, "⚠️ تم إلغاء الطلب", `انتبه! تم إلغاء الطلب رقم #${orderId}`);
      }
    } catch (e) {
      console.error("FCM Cancel Error:", e.message);
    }
    res.json({
      success: true
    });

  } catch (err) {

    await conn.rollback();

    console.error("CANCEL ORDER ERROR:", err);

    res.status(500).json({
      success: false
    });

  } finally {

    conn.release();

  }

});

/* =========================
   دالة مساعدة لإرسال إشعارات FCM (محدثة)
========================= */
async function sendFCMNotification(token, title, body, data = {}) {
  if (!token) return;
  try {
    await admin.messaging().send({
      token: token,
      notification: { title, body },
      data: { ...data, click_action: "FLUTTER_NOTIFICATION_CLICK" },
      android: {
        priority: "high",
        notification: {
          sound: "default",
          channelId: "orders_channel", // تأكد أن هذا الاسم مطابق لما في كود الأندرويد
        }
      }
    });
    console.log("📲 FCM Sent to:", token.substring(0, 10) + "...");
  } catch (err) {
    console.error("❌ FCM Error:", err.message);
  }
}
export default router;
