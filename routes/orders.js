import express from "express";
import db from "../db.js";
import auth from "../middlewares/auth.js";
import admin from "firebase-admin";
import { addPointsAfterOrder } from "./loyalty.js";

function getStatusLabel(status) {
  switch (status) {
    case "pending": return "قيد الانتظار";
    case "scheduled": return "مجدول";
    case "processing": return "قيد التحضير";
    case "confirmed": return "تم التأكيد";
    case "ready": return "جاهز";
    case "delivering": return "قيد التوصيل";
    case "completed": return "مكتمل";
    case "cancelled": return "ملغي";
    default: return status;
  }
}

const router = express.Router();


/* =========================
   دالة حساب المسافة بالكيلو
========================= */
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

/* =========================
   POST /orders/calc-fees
========================= */
router.post("/calc-fees", auth, async (req, res) => {
  try {
    const { address_id, restaurants } = req.body;
    const user = req.user || {};

    if (!address_id || !restaurants || !restaurants.length) {
      return res.status(400).json({
        success: false,
        message: "بيانات الحساب ناقصة"
      });
    }

    const storeIds = [
      ...new Set(
        restaurants
          .map(r => Number(r.restaurant_id || r.id))
          .filter(Boolean)
      )
    ];

    if (!storeIds.length) {
      return res.status(400).json({
        success: false,
        message: "لا توجد مطاعم صالحة"
      });
    }

    let branchId = user.branch_id || null;

    const [[address]] = await db.query(`
      SELECT
        id,
        branch_id,
        district,
        latitude,
        longitude
      FROM customer_addresses
      WHERE id = ?
      LIMIT 1
    `, [address_id]);

    if (!address) {
      return res.status(404).json({
        success: false,
        message: "العنوان غير موجود"
      });
    }

    if (!branchId) {
      branchId = address.branch_id || null;
    }

    if (!branchId) {
      return res.status(400).json({
        success: false,
        message: "تعذر تحديد الفرع"
      });
    }

    const [[settings]] = await db.query(`
      SELECT
        method,
        km_price_single,
        km_price_multi,
        extra_store_fee
      FROM branch_delivery_settings
      WHERE branch_id = ?
      LIMIT 1
    `, [branchId]);

    if (!settings) {
      return res.json({
        success: true,
        delivery_fee: 0,
        extra_store_fee: 0,
        stores_count: storeIds.length,
        additional_stores_count: Math.max(storeIds.length - 1, 0),
        pricing_method: "none",
        distance_km: 0
      });
    }

    let deliveryFee = 0;
    let extraStoreFee = 0;
    let totalDistanceKm = 0;

    /* ===== حسب الحي ===== */
    if (settings.method === "neighborhood") {
      const [[neighborhood]] = await db.query(`
        SELECT
          delivery_fee,
          extra_store_fee
        FROM neighborhoods
        WHERE id = ?
        LIMIT 1
      `, [address.district]);

      if (neighborhood) {
        deliveryFee = Number(neighborhood.delivery_fee || 0);

        if (storeIds.length > 1) {
          extraStoreFee =
            (storeIds.length - 1) *
            Number(neighborhood.extra_store_fee || 0);
        }
      }
    }

    /* ===== حسب المسافة ===== */
    else if (settings.method === "distance") {
      if (
        address.latitude == null ||
        address.longitude == null
      ) {
        return res.status(400).json({
          success: false,
          message: "العنوان لا يحتوي إحداثيات"
        });
      }

      const [restaurantRows] = await db.query(`
        SELECT
          id,
          name,
          latitude,
          longitude
        FROM restaurants
        WHERE id IN (?)
      `, [storeIds]);

      const restaurantMap = {};
      restaurantRows.forEach(r => {
        restaurantMap[r.id] = r;
      });

      let firstStoreDistance = 0;
      let additionalStoresDistance = 0;

      storeIds.forEach((storeId, index) => {
        const rest = restaurantMap[storeId];
        if (!rest) return;
        if (rest.latitude == null || rest.longitude == null) return;

        const distanceKm = haversineKm(
          Number(address.latitude),
          Number(address.longitude),
          Number(rest.latitude),
          Number(rest.longitude)
        );

        totalDistanceKm += distanceKm;

        if (index === 0) {
          firstStoreDistance += distanceKm;
        } else {
          additionalStoresDistance += distanceKm;
        }
      });

      deliveryFee =
        firstStoreDistance * Number(settings.km_price_single || 0);

      extraStoreFee =
        additionalStoresDistance * Number(settings.km_price_multi || 0);
    }

    res.json({
      success: true,
      delivery_fee: Number(deliveryFee.toFixed(2)),
      extra_store_fee: Number(extraStoreFee.toFixed(2)),
      stores_count: storeIds.length,
      additional_stores_count: Math.max(storeIds.length - 1, 0),
      pricing_method: settings.method,
      distance_km: Number(totalDistanceKm.toFixed(2))
    });

  } catch (err) {
    console.error("CALC FEES ERROR:", err);
    res.status(500).json({
      success: false,
      message: "فشل حساب الرسوم"
    });
  }
});


  
/*==========================
حماية المسار
==================== */
router.use(auth);

/* =====================================================
   GET /orders/agent-summary
   طلبات الوكيل أو مطعمه فقط بدون بيانات العميل
===================================================== */
router.get("/agent-summary", async (req, res) => {
  try {
    const user = req.user || {};
    const restaurantId = req.query.restaurant_id || null;
    const limit = Number(req.query.limit) || 100;

    let where = [];
    let params = [];

    if (user.role === "agent") {
      if (restaurantId) {
        where.push("r.agent_id = ?");
        params.push(user.id);

        where.push("r.id = ?");
        params.push(restaurantId);
      } else {
        where.push("r.agent_id = ?");
        params.push(user.id);
      }
    } else {
      if (!restaurantId) {
        return res.status(400).json({
          success: false,
          message: "restaurant_id مطلوب لهذا النوع من المستخدمين"
        });
      }

      where.push("r.id = ?");
      params.push(restaurantId);

      if (user.branch_id) {
        where.push("o.branch_id = ?");
        params.push(user.branch_id);
      }
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const [rows] = await db.query(
      `
      SELECT
        o.id,
        o.status,
        o.created_at,
        r.id AS restaurant_id,
        r.name AS restaurant_name,
        oi.product_id,
        oi.name AS product_name,
        oi.quantity,
        oi.price
      FROM orders o
      JOIN order_items oi ON oi.order_id = o.id
      JOIN restaurants r ON r.id = oi.restaurant_id
      ${whereSql}
      ORDER BY o.id DESC, oi.id ASC
      LIMIT ${limit}
      `,
      params
    );

    const orderMap = {};

    for (const row of rows) {
      if (!orderMap[row.id]) {
        orderMap[row.id] = {
          id: row.id,
          status: row.status,
          created_at: row.created_at,
          restaurant: {
            id: row.restaurant_id,
            name: row.restaurant_name
          },
          products: []
        };
      }

      orderMap[row.id].products.push({
        product_id: row.product_id,
        name: row.product_name,
        quantity: Number(row.quantity),
        price: Number(row.price),
        subtotal: Number(row.price) * Number(row.quantity)
      });
    }

    res.json({
      success: true,
      orders: Object.values(orderMap)
    });
  } catch (err) {
    console.error("AGENT SUMMARY ORDERS ERROR:", err);
    res.status(500).json({
      success: false,
      orders: []
    });
  }
});
/*====================
للتطبيق
========================*/
router.get("/app", async (req, res) => {

  console.log("APP ORDERS USER:", req.user);

  try {

    const user = req.user;

    if (user.role !== "customer") {
      return res.status(403).json({
        success: false,
        message: "ليس حساب عميل"
      });
    }

    const customerId = user.id;
    const branchId = user.branch_id;

    if (!branchId) {
      return res.status(400).json({
        success:false,
        message:"لم يتم تحديد الفرع"
      });
    }

    /* =========================
       جلب الطلبات
    ========================= */

    const [orders] = await db.query(`
      SELECT
        id,
        restaurant_id,
        status,
        total_amount,
        created_at
      FROM orders
      WHERE customer_id = ?
      AND branch_id = ?
      ORDER BY id DESC
      LIMIT 100
    `,[customerId, branchId]);

    if (!orders.length) {
      return res.json({
        success:true,
        orders:[]
      });
    }

    const orderIds = orders.map(o => o.id);

    /* =========================
       جلب المطاعم من order_items
    ========================= */

    const [restaurants] = await db.query(`
      SELECT
        oi.order_id,
        r.id,
        r.name,
        r.image_url
      FROM order_items oi
      JOIN restaurants r ON r.id = oi.restaurant_id
      WHERE oi.order_id IN (?)
      GROUP BY oi.order_id, r.id
    `,[orderIds]);

    const map = {};

    restaurants.forEach(r => {

      if (!map[r.order_id]) {
        map[r.order_id] = [];
      }

      map[r.order_id].push({
        id: r.id,
        name: r.name,
        image: r.image_url,
        restaurant_image: r.image_url
      });

    });

    /* =========================
       دعم الطلبات اليدوية
    ========================= */

    const restaurantIds = [
      ...new Set(
        orders
          .map(o => o.restaurant_id)
          .filter(Boolean)
      )
    ];

    if (restaurantIds.length) {

      const [manualRestaurants] = await db.query(`
        SELECT
          id,
          name,
          image_url
        FROM restaurants
        WHERE id IN (?)
      `,[restaurantIds]);

      const manualMap = {};

      manualRestaurants.forEach(r => {
        manualMap[r.id] = r;
      });

      orders.forEach(o => {

        if (!map[o.id] && manualMap[o.restaurant_id]) {

          const r = manualMap[o.restaurant_id];

          map[o.id] = [{
            id: r.id,
            name: r.name,
            image: r.image_url,
            restaurant_image: r.image_url
          }];

        }

      });

    }

    /* =========================
       تركيب المطاعم داخل الطلب
    ========================= */

    orders.forEach(o => {
      o.restaurants = map[o.id] || [];
    });

    res.json({
      success:true,
      orders
    });

  }
  catch(err){

    console.error("APP ORDERS ERROR:", err);

    res.status(500).json({
      success:false,
      orders:[]
    });

  }

});
/* =========================
   GET /orders (تم الإصلاح)
========================= */
router.get("/", async (req, res) => {
  try {
    const user = req.user || {};
    const limit = Number(req.query.limit) || 100;
    const dateFilter = req.query.date || "all"; 

    // ✅ إصلاح 1: قراءة الفرع من التوكن أو من الهيدر (لأن تطبيق الكابتن يرسله في الهيدر)
    let branchId = user.branch_id;
    if (!branchId && req.headers["x-branch-id"]) {
        branchId = Number(req.headers["x-branch-id"]);
    }

    /* ======================
       فلترة التاريخ
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
        o.scheduled_at, o.processing_at, o.ready_at, o.delivering_at, o.completed_at, o.cancelled_at,
        GROUP_CONCAT(r.id ORDER BY r.id SEPARATOR '||') AS restaurant_ids,
        GROUP_CONCAT(r.name ORDER BY r.id SEPARATOR '||') AS restaurant_names,
        GROUP_CONCAT(r.address ORDER BY r.id SEPARATOR '||') AS restaurant_addresses,
        GROUP_CONCAT(IFNULL(r.latitude,'') ORDER BY r.id SEPARATOR '||') AS restaurant_lats,
        GROUP_CONCAT(IFNULL(r.longitude,'') ORDER BY r.id SEPARATOR '||') AS restaurant_lngs,
        c.name AS customer_name,
        c.phone AS customer_phone,
        n.name AS neighborhood_name,
        ca.address AS customer_address,
        ca.latitude,
        ca.longitude,
        u.name AS user_name,
        u1.name AS creator_name,
        u2.name AS updater_name,
        o.status, o.note, o.total_amount, o.discount_amount,o.coupon_code,o.delivery_fee, o.extra_store_fee, o.stores_count, o.created_at,
        cap.name AS captain_name, o.captain_id, -- ✅ مهم للكابتن
        o.payment_method, b.name AS branch_name,
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
        SELECT order_id, restaurant_id FROM order_items GROUP BY order_id, restaurant_id
      ) oi ON oi.order_id = o.id
      LEFT JOIN restaurants r ON r.id = oi.restaurant_id
    `;

    let rows = [];

    // الحالة 1: أدمن الفرع الرئيسي (يرى كل شيء)
    if (user.is_admin_branch) {
       [rows] = await db.query(`
         ${baseQuery}
         WHERE 1=1 ${dateWhere}
         GROUP BY o.id
         ORDER BY o.id DESC
         LIMIT ?
       `, [limit]);

    } 
    // الحالة 2: الكابتن (Role Check) - يرى طلباته + الطلبات الجاهزة في الفرع
    // ✅ إصلاح 2: إضافة شرط خاص للكابتن
    else if (user.role === 'captain' || (!user.is_admin_branch && !branchId)) {
        // إذا كان كابتن، نُظهر له:
        // 1. الطلبات المسندة إليه (captain_id = user.id)
        // 2. أو الطلبات الجاهزة (status = 'ready') التي ليس لها كابتن (لأخذها)
        // 3. أو الطلبات قيد التوصيل الخاصة به
        
        [rows] = await db.query(`
          ${baseQuery}
          WHERE 
            (o.captain_id = ? OR (o.status IN ('ready', 'processing') AND o.captain_id IS NULL))
            ${dateWhere}
          GROUP BY o.id
          ORDER BY o.id DESC
          LIMIT ?
        `, [user.id, limit]);
    }
    // الحالة 3: مستخدم عادي أو مدير فرع (فلترة حسب Branch ID)
    else {
        // إذا لم يتم العثور على Branch ID نعيد مصفوفة فارغة لتجنب الخطأ
        if (!branchId) {
             return res.json({ success: true, orders: [] });
        }

        [rows] = await db.query(`
          ${baseQuery}
          WHERE o.branch_id = ?
          ${dateWhere}
          GROUP BY o.id
          ORDER BY o.id DESC
          LIMIT ?
        `, [branchId, limit]);
    }

    // تنسيق بيانات المطاعم (نفس كودك القديم)
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
scheduled_at,
coupon_code
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
const userId = user.role === "customer" ? null : (user.id || null);

    const headerBranch = req.headers["x-branch-id"];
    let branchId = headerBranch ? Number(headerBranch) : user.branch_id || null;

    if (!branchId && address_id) {
      const [addrBranch] = await db.query("SELECT branch_id FROM customer_addresses WHERE id=?", [address_id]);
      if (addrBranch.length) branchId = addrBranch[0].branch_id;
    }

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

let deliveryFee = 0;
let extraStoreFee = 0;

if (branchId) {
  const [[settings]] = await db.query(
    `
    SELECT
      method,
      km_price_single,
      km_price_multi,
      extra_store_fee
    FROM branch_delivery_settings
    WHERE branch_id = ?
    LIMIT 1
    `,
    [branchId]
  );

  if (settings) {
    if (settings.method === "neighborhood" && address_id) {
      const [[addr]] = await db.query(
        `
        SELECT district
        FROM customer_addresses
        WHERE id = ?
        LIMIT 1
        `,
        [address_id]
      );

      if (addr?.district) {
        const [[n]] = await db.query(
          `
          SELECT delivery_fee, extra_store_fee
          FROM neighborhoods
          WHERE id = ?
          LIMIT 1
          `,
          [addr.district]
        );

        if (n) {
          deliveryFee = Number(n.delivery_fee || 0);

          if (storesCount > 1) {
            extraStoreFee =
              (storesCount - 1) *
              Number(n.extra_store_fee || 0);
          }
        }
      }
    }

    if (settings.method === "distance" && address_id) {
      const [[addr]] = await db.query(
        `
        SELECT latitude, longitude
        FROM customer_addresses
        WHERE id = ?
        LIMIT 1
        `,
        [address_id]
      );

      if (addr?.latitude != null && addr?.longitude != null) {
        const [restaurantRows] = await db.query(
          `
          SELECT id, latitude, longitude
          FROM restaurants
          WHERE id IN (?)
          `,
          [storeIds]
        );

        const restaurantMap = {};
        restaurantRows.forEach((r) => {
          restaurantMap[r.id] = r;
        });

        let firstStoreDistance = 0;
        let additionalStoresDistance = 0;

        storeIds.forEach((storeId, index) => {
          const rest = restaurantMap[storeId];
          if (!rest) return;
          if (rest.latitude == null || rest.longitude == null) return;

          const distanceKm = haversineKm(
            Number(addr.latitude),
            Number(addr.longitude),
            Number(rest.latitude),
            Number(rest.longitude)
          );

          if (index === 0) {
            firstStoreDistance += distanceKm;
          } else {
            additionalStoresDistance += distanceKm;
          }
        });

        deliveryFee =
          firstStoreDistance * Number(settings.km_price_single || 0);

        extraStoreFee =
          additionalStoresDistance * Number(settings.km_price_multi || 0);
      }
    }
  }
}

deliveryFee = Number(deliveryFee.toFixed(2));
extraStoreFee = Number(extraStoreFee.toFixed(2));

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
discount_amount,
coupon_code,
payment_method,
bank_id,
scheduled_at,
status
)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
 `,
[
  customer_id,
  address_id,
  mainRestaurantId,
  user.id || null,   // created_by
  user.id || null,   // updated_by
  note || null,
  gps_link || null,
  storesCount,
  branchId,
  userId,            // user_id
  deliveryFee,
  extraStoreFee,
0,
coupon_code || null,
  payment_method || null,
  bank_id || null,

  scheduledAtSQL,                 // ✅ هنا
  scheduled_at ? "scheduled" : "pending"      // ✅
]

);


const orderId = result.insertId;
/* =========================
   حساب المنتجات مرة واحدة
========================= */

let total = 0;

const productIds = products.map(p => p.product_id);

const [dbProducts] = await db.query(
`
SELECT 

p.id,
p.name,
p.price,

MAX(ads.discount_percent) AS discount_percent,

ROUND(
p.price - (p.price * MAX(ads.discount_percent) / 100)
) AS final_price

FROM products p

LEFT JOIN ads
ON ads.restaurant_id = p.restaurant_id
AND ads.type='discount'
AND ads.status='active'
AND (ads.start_date IS NULL OR ads.start_date <= NOW())
AND (ads.end_date IS NULL OR ads.end_date >= NOW())

WHERE p.id IN (?)

GROUP BY p.id
`,
[productIds]
);

const productMap = {};
dbProducts.forEach(p=>{
productMap[p.id] = p;
});


/* =========================
   إضافة المنتجات للطلب
========================= */

for (const p of products) {

const prod = productMap[p.product_id];

if (!prod) {
console.error(`❌ المنتج رقم ${p.product_id} غير موجود`);
continue;
}

const price = Number(prod.final_price || prod.price);

const subtotal = price * Number(p.quantity);
total += subtotal;

await db.query(
`INSERT INTO order_items 
(order_id, product_id, restaurant_id, name, price, quantity)
VALUES (?, ?, ?, ?, ?, ?)`,
[
orderId,
p.product_id,
p.restaurant_id,
prod.name,
price,
p.quantity
]
);

}


/* =========================
   حساب الكوبون من السيرفر
========================= */

let discount = 0;

console.log("COUPON FROM APP:", coupon_code);


if (coupon_code) {

const [[coupon]] = await db.query(
`SELECT *
FROM coupon_codes
WHERE TRIM(LOWER(code)) = TRIM(LOWER(?))
AND status='active'
AND (start_date IS NULL OR start_date <= NOW())
AND (end_date IS NULL OR end_date >= NOW())
LIMIT 1`,
[coupon_code]
);

console.log("COUPON FROM DB:", coupon);

 if (coupon) {

  if (coupon.max_uses && coupon.used_count >= coupon.max_uses) {
    return res.json({
      success:false,
      message:"تم استهلاك الكوبون"
    });
  }

  /* خصم على الطلب */
if (coupon.apply_on === "order" || coupon.apply_on === "total") {

  const orderTotal =
    Number(total) +
    Number(deliveryFee) +
    Number(extraStoreFee);

  if (Number(coupon.discount_percent) > 0) {
    discount =
      (orderTotal * Number(coupon.discount_percent)) / 100;
  }

  if (Number(coupon.discount_amount) > 0) {
    discount = Number(coupon.discount_amount);
  }

}

  /* خصم على التوصيل */
  if (coupon.apply_on === "delivery") {

    if (Number(coupon.discount_percent) > 0) {
      discount = (Number(deliveryFee) * Number(coupon.discount_percent)) / 100;
    }

    if (Number(coupon.discount_amount) > 0) {
      discount = Number(coupon.discount_amount);
    }

  }

}
}



/* =========================
   حساب الإجمالي النهائي
========================= */

const grandTotal =
total +
deliveryFee +
extraStoreFee -
discount;


/* =========================
   DEBUG الكوبون
========================= */

console.log("ORDER TOTAL:", total);
console.log("DELIVERY FEE:", deliveryFee);
console.log("EXTRA STORE FEE:", extraStoreFee);
console.log("DISCOUNT:", discount);
console.log("FINAL TOTAL:", grandTotal);
console.log("COUPON:", coupon_code);

/* =========================
   تحديث إجمالي الطلب
========================= */

await db.query(
"UPDATE orders SET total_amount=?, discount_amount=?, coupon_code=? WHERE id=?",
[
grandTotal,
discount || 0,
coupon_code || null,
orderId
]
);

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

/* =========================
   1️⃣ البحث في الطلبات العادية
========================= */

const [rows] = await db.query(`
SELECT 
  o.id,
  o.status,
  o.created_at,
  o.processing_at,
  o.ready_at,
  o.delivering_at,
  o.completed_at,
  o.cancelled_at,

  o.note,

  c.name AS customer_name,
  c.phone AS customer_phone,

  a.address AS customer_address,
  n.name AS neighborhood_name,

  a.gps_link AS map_url,
  a.latitude,
  a.longitude,

  o.delivery_fee,
  o.extra_store_fee,
  o.total_amount,
  o.discount_amount,
  o.coupon_code,
  o.payment_method

FROM orders o

JOIN customers c ON c.id = o.customer_id

LEFT JOIN customer_addresses a 
ON a.id = o.address_id

LEFT JOIN neighborhoods n
ON n.id = a.district

WHERE o.id=?
`,[orderId]);


/* =========================
   إذا وجد الطلب العادي
========================= */

if(rows.length){

  const order = rows[0];

  const [items] = await db.query(`
    SELECT 
      oi.id,
      oi.name,
      oi.price,
      oi.quantity,
      oi.restaurant_id,
      r.name AS restaurant_name,
      r.image_url AS restaurant_image
    FROM order_items oi
    JOIN restaurants r ON r.id = oi.restaurant_id
    WHERE oi.order_id=?
  `,[orderId]);

  const restaurants = [];
  const map = {};

  for (const it of items){

    if(!map[it.restaurant_id]){
      map[it.restaurant_id] = {
        id: it.restaurant_id,
        name: it.restaurant_name,
        restaurant_image: it.restaurant_image,
        items:[],
        total:0
      };

      restaurants.push(map[it.restaurant_id]);
    }

    const subtotal = it.price * it.quantity;

    map[it.restaurant_id].total += subtotal;

    map[it.restaurant_id].items.push({
      name: it.name,
      price: it.price,
      quantity: it.quantity,
      subtotal
    });
  }

  order.restaurants = restaurants;

  return res.json({ success:true, order });
}


/* =========================
   2️⃣ البحث في الطلبات اليدوية
========================= */

const [[manual]] = await db.query(`
SELECT
  w.*,

  w.to_address AS customer_address,
  NULL AS neighborhood_name,

  w.to_lat AS latitude,
  w.to_lng AS longitude,

  r.name AS restaurant_name,
  r.image_url AS restaurant_image

FROM wassel_orders w

LEFT JOIN restaurants r 
ON r.id = w.restaurant_id

WHERE w.id=?
`,[orderId]);


if(!manual){
  return res.status(404).json({
    success:false,
    message:"الطلب غير موجود"
  });
}

const [items] = await db.query(`
SELECT
  product_name AS name,
  qty,
  price,
  total
FROM wassel_order_items
WHERE order_id=?
`,[orderId]);


manual.restaurants = [{
  id: manual.restaurant_id,
  name: manual.restaurant_name,
  restaurant_image: manual.restaurant_image,
  items: items.map(i => ({
    name: i.name,
    quantity: i.qty,
    subtotal: i.total
  })),
  total: items.reduce((s,i)=>s + Number(i.total),0)
}];

res.json({
  success:true,
  order:manual
});

} catch(err){

  console.error("ORDER DETAILS ERROR:", err);

  res.status(500).json({
    success:false
  });

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

    } 
    
    else {
      await conn.query(
        `UPDATE orders 
         SET status=?, updated_by=?
         WHERE id=?`,
        [status, req.user.id, orderId]
      );
    }

// ============================
// ⭐ 2. نقاط الولاء
// ============================
if (status === "completed") {

  try {

    const [[orderData]] = await conn.query(
      `SELECT id, customer_id, total_amount 
       FROM orders 
       WHERE id=?`,
      [orderId]
    );

    if (orderData && orderData.total_amount > 0) {

      await addPointsAfterOrder(orderData);

      console.log("⭐ Loyalty Added:", {
        order: orderId,
        customer: orderData.customer_id,
        amount: orderData.total_amount
      });

    }

  } catch (err) {
    console.error("❌ LOYALTY ERROR:", err.message);
  }

}

    // 2. توليد القيود عند الانتقال لحالة "قيد التوصيل"
    if (status === "delivering") {
      // منع تكرار القيود لنفس الطلب
const [[existsEntry]] = await conn.query(
`SELECT id FROM journal_entries 
 WHERE reference_type='order' 
 AND reference_id=? 
 LIMIT 1`,
[orderId]
);

if (existsEntry) {
  console.log("⚠️ القيود موجودة مسبقاً للطلب:", orderId);
  await conn.commit();
  return res.json({ success:true, message:"تم تنفيذ القيود مسبقاً" });
}
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

       /* =========================
   قيد خصم الكوبون
========================= */

if (order.discount_amount > 0 && settings.coupon_discount_account) {

const discount = Number(order.discount_amount);

await insertJournalEntry(
  conn,
  journalTypeId,
  orderId,
  baseCur.id,
  settings.coupon_discount_account,
  discount,
  0,
  `دعم كوبون طلب #${orderId}`,
  req
);

await insertJournalEntry(
  conn,
  journalTypeId,
  orderId,
  baseCur.id,
  order.cap_acc_id,
  0,
  discount,
  `تعويض خصم الكوبون للكابتن #${orderId}`,
  req
);

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

    /* حساب نسبة الخصم */
    let discountText = "";

    const [original] = await conn.query(
    `
    SELECT 
    SUM(p.price * oi.quantity) AS original_total
    FROM order_items oi
    JOIN products p ON p.id = oi.product_id
    WHERE oi.order_id=? AND oi.restaurant_id=?
    `,
    [orderId, res.restaurant_id]
    );

    const originalTotal = Number(original[0]?.original_total || 0);

    if (originalTotal > res.net_amount) {

      const diff = originalTotal - res.net_amount;

      const percent =
      Math.round((diff / originalTotal) * 100);

      discountText = ` عرض خصم ${percent}%`;

    }

    const foodNote =
      `قيمة وجبات من ${res.restaurant_name} طلب #${orderId}${discountText}`;

    const salesNote =
      `صافي مبيعات طلب #${orderId}${discountText}`;


    /* قيد المبيعات */

    await insertJournalEntry(
      conn,
      journalTypeId,
      orderId,
      baseCur.id,
      mainDebitAccount,
      res.net_amount,
      0,
      foodNote,
      req
    );

    await insertJournalEntry(
      conn,
      journalTypeId,
      orderId,
      baseCur.id,
      res.res_acc_id,
      0,
      res.net_amount,
      salesNote,
      req
    );


    /* عمولة المطعم */

    if (settings.commission_income_account && res.res_comm_val > 0) {

      let resComm =
        (res.res_comm_type === 'percent')
          ? (res.net_amount * Number(res.res_comm_val)) / 100
          : Number(res.res_comm_val);

      await insertJournalEntry(
        conn,
        journalTypeId,
        orderId,
        baseCur.id,
        res.res_acc_id,
        resComm,
        0,
        `خصم عمولة ${res.restaurant_name} طلب #${orderId}`,
        req
      );

      await insertJournalEntry(
        conn,
        journalTypeId,
        orderId,
        baseCur.id,
        settings.commission_income_account,
        0,
        resComm,
        `إيراد عمولة مطعم #${orderId}`,
        req
      );

    }

  }

}


/* =========================
   قيد التوصيل
========================= */

const deliveryTotal =
Number(order.delivery_fee || 0) +
Number(order.extra_store_fee || 0);

if (deliveryTotal > 0) {

  await insertJournalEntry(
    conn,
    journalTypeId,
    orderId,
    baseCur.id,
    mainDebitAccount,
    deliveryTotal,
    0,
    `رسوم توصيل طلب #${orderId}`,
    req
  );

  await insertJournalEntry(
    conn,
    journalTypeId,
    orderId,
    baseCur.id,
    order.cap_acc_id,
    0,
    deliveryTotal,
    `إيراد توصيل للكابتن طلب #${orderId}`,
    req
  );

}


/* =========================
   عمولة الكابتن
========================= */

if (deliveryTotal > 0 && order.cap_comm_val > 0) {

  let captainCommission =
  (order.cap_comm_type === "percent")
  ? (deliveryTotal * Number(order.cap_comm_val)) / 100
  : Number(order.cap_comm_val);

  await insertJournalEntry(
    conn,
    journalTypeId,
    orderId,
    baseCur.id,
    order.cap_acc_id,
    captainCommission,
    0,
    `خصم عمولة الكابتن طلب #${orderId}`,
    req
  );

  await insertJournalEntry(
    conn,
    journalTypeId,
    orderId,
    baseCur.id,
    settings.courier_commission_account,
    0,
    captainCommission,
    `وسيط عمولات الكباتن طلب #${orderId}`,
    req
  );

}


await conn.commit();
}

    /* =========================
       إشعارات FCM (للعميل والكابتن)
    ========================= */
    try {
      const [[orderContacts]] = await conn.query(`
        SELECT 
          o.id, 
            o.captain_id,   -- ✅ أضف هذا السطر
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
          await sendFCMNotification(orderContacts.customer_token, title, body,
          { 
  orderId: String(orderId), 
  status,
  status_label: getStatusLabel(status)});
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

/* إشعار لوحة التحكم */
io.emit("admin_notification", {
  type: "order_status_updated",
  order_id: orderId,
message: `📦 المستخدم ${orderContacts.user_name || "غير معروف"} حدّث طلب #${orderId} للعميل ${orderContacts.customer_name} إلى (${getStatusLabel(status)})`
});

/* 🔔 إشعار مباشر للكابتن */
if (orderContacts.captain_id) {

  // 🔔 حفظ الإشعار في الداتابيز
  await db.query(
    `INSERT INTO notifications
     (captain_id, title, message, type, reference_id)
     VALUES (?,?,?,?,?)`,
    [
      orderContacts.captain_id,
      "تحديث حالة الطلب",
      `📦 تحديث الطلب #${orderId} إلى (${getStatusLabel(status)})`,
      "order_status",
      orderId
    ]
  );

  // 🚀 realtime
  io.to("captain_" + orderContacts.captain_id).emit("new_notification", {
    message: `📦 تحديث الطلب #${orderId} إلى (${getStatusLabel(status)})`,
    createdAt: new Date()
  });
}
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
   🔔 حفظ الإشعار في الداتابيز
========================= */
await db.query(
  `INSERT INTO notifications
   (captain_id, title, message, type, reference_id)
   VALUES (?,?,?,?,?)`,
  [
    captain_id,
    "طلب جديد",
    `🚀 وصلك طلب رقم #${orderId} للعميل ${customerName}`,
    "new_order",
    orderId
  ]
);

/* =========================
   realtime للكابتن
========================= */
io.to("captain_" + captain_id).emit("new_order_assigned", {

  type: "new_order",

  order_id: orderId,

  message:
    `🚀 وصلك طلب رقم #${orderId} للعميل ${customerName} — عجل عليه يا وحش`

});

io.to("captain_" + captain_id).emit("new_notification", {
  message: `🚀 وصلك طلب رقم #${orderId} للعميل ${customerName}`,
  createdAt: new Date()
});

console.log("📡 realtime + DB notification saved for captain:", captain_id);
    

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
   🔔 حفظ إشعار إلغاء للكابتن
========================= */

const [[orderData]] = await db.query(
  "SELECT captain_id FROM orders WHERE id=?",
  [orderId]
);

if (orderData?.captain_id) {

  await db.query(
    `INSERT INTO notifications
     (captain_id, title, message, type, reference_id)
     VALUES (?,?,?,?,?)`,
    [
      orderData.captain_id,
      "تم إلغاء الطلب",
      `❌ تم إلغاء الطلب رقم #${orderId}`,
      "cancel_order",
      orderId
    ]
  );

  const io = req.app.get("io");

  io.to("captain_" + orderData.captain_id).emit("new_notification", {
    message: `❌ تم إلغاء الطلب رقم #${orderId}`,
    createdAt: new Date()
  });
}
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
