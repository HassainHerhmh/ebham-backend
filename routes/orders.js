import express from "express";
import db from "../db.js";
import auth from "../middlewares/auth.js";

const router = express.Router();
router.use(auth);

/* =========================
   GET /orders
========================= */
router.get("/", async (req, res) => {
  try {
    const user = req.user;
    let rows = [];

    if (user.is_admin_branch) {
      const [result] = await db.query(`
        SELECT 
          o.id,
          c.name AS customer_name,
          c.phone AS customer_phone,
          o.status,
          o.total_amount,
          o.delivery_fee,
          o.stores_count,
          o.created_at
        FROM orders o
        JOIN customers c ON c.id = o.customer_id
        ORDER BY o.id DESC
        LIMIT 50
      `);
      rows = result;
    } else {
      const [result] = await db.query(
        `
        SELECT 
          o.id,
          c.name AS customer_name,
          c.phone AS customer_phone,
          o.status,
          o.total_amount,
          o.delivery_fee,
          o.stores_count,
          o.created_at
        FROM orders o
        JOIN customers c ON c.id = o.customer_id
        WHERE o.branch_id = ?
        ORDER BY o.id DESC
        LIMIT 50
        `,
        [user.branch_id]
      );
      rows = result;
    }

    res.json({ success: true, orders: rows || [] });
  } catch (err) {
    console.error("GET ORDERS ERROR:", err);
    res.status(500).json({ success: false, orders: [] });
  }
});

/*============================
   POST /orders
=============================*/
router.post("/", async (req, res) => {
     console.log("REQ USER =>", req.user);
  try {
    const { customer_id, address_id, gps_link, restaurants } = req.body;
    const user = req.user;

    console.log("REQ BODY:", { customer_id, address_id, gps_link });
    console.log("USER:", user);

    if (!restaurants || !restaurants.length) {
      return res.json({ success: false, message: "لا توجد مطاعم" });
    }

    const products = restaurants.flatMap((r) =>
      (r.products || []).map((p) => ({
        restaurant_id: r.restaurant_id,
        product_id: p.product_id,
        quantity: p.quantity,
      }))
    );

    if (!products.length) {
      return res.json({ success: false, message: "لا توجد منتجات" });
    }

    const storeIds = [...new Set(products.map((p) => p.restaurant_id))];
    const storesCount = storeIds.length;
    const mainRestaurantId = storeIds[0];

    // تحديد الفرع الحقيقي
    const headerBranch = req.headers["x-branch-id"];
    let branchId = headerBranch ? Number(headerBranch) : user.branch_id || null;

    if (!branchId && address_id) {
      const [addrBranch] = await db.query(
        "SELECT branch_id FROM customer_addresses WHERE id=?",
        [address_id]
      );
      if (addrBranch.length && addrBranch[0].branch_id) {
        branchId = addrBranch[0].branch_id;
      }
    }

    console.log("BRANCH ID:", branchId);

    
    // ===============================
    // 🧭 حساب الرسوم
    // ===============================
    let deliveryFee = 0;
    let extraStoreFee = 0;

    if (branchId) {
      const [settingsRows] = await db.query(
        "SELECT * FROM branch_delivery_settings WHERE branch_id=? LIMIT 1",
        [branchId]
      );

      if (settingsRows.length) {
        const settings = settingsRows[0];

        // 🔹 حسب الحي
        if (settings.method === "neighborhood" && address_id) {
          const [addr] = await db.query(
            "SELECT district FROM customer_addresses WHERE id=?",
            [address_id]
          );

          if (addr.length && addr[0].district) {
            const [n] = await db.query(
              "SELECT delivery_fee, extra_store_fee FROM neighborhoods WHERE name=?",
              [addr[0].district]
            );

            if (n.length) {
              deliveryFee = Number(n[0].delivery_fee) || 0;

              if (storesCount > 1) {
                extraStoreFee =
                  (storesCount - 1) * (Number(n[0].extra_store_fee) || 0);
              }
            }
          }
        }

        // 🔹 حسب الكيلومتر
        if (settings.method === "distance") {
          deliveryFee = Number(settings.km_price_single) || 0;

          if (storesCount > 1) {
            extraStoreFee =
              (storesCount - 1) * (Number(settings.km_price_multi) || 0);
            // إذا اسم العمود مختلف عندك عدله هنا
          }
        }
      }
    }

    const [result] = await db.query(
      `
      INSERT INTO orders 
        (customer_id, address_id, restaurant_id, gps_link, stores_count, branch_id, delivery_fee, extra_store_fee)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        customer_id,
        address_id,
        mainRestaurantId,
        gps_link || null,
        storesCount,
        branchId,
        deliveryFee,
        extraStoreFee,
      ]
    );

    const orderId = result.insertId;

    let total = 0;

    for (const p of products) {
      const [[prod]] = await db.query(
        "SELECT name, price FROM products WHERE id=?",
        [p.product_id]
      );

      const subtotal = prod.price * p.quantity;
      total += subtotal;

      await db.query(
        `
        INSERT INTO order_items
          (order_id, product_id, restaurant_id, name, price, quantity)
        VALUES (?, ?, ?, ?, ?, ?)
        `,
        [
          orderId,
          p.product_id,
          p.restaurant_id,
          prod.name,
          prod.price,
          p.quantity,
        ]
      );
    }

    const grandTotal = total + deliveryFee + extraStoreFee;

    await db.query(
      "UPDATE orders SET total_amount=? WHERE id=?",
      [grandTotal, orderId]
    );

    res.json({
      success: true,
      order_id: orderId,
      stores_count: storesCount,
      delivery_fee: deliveryFee,
      extra_store_fee: extraStoreFee,
      total: grandTotal,
    });
  } catch (err) {
    console.error("ADD ORDER ERROR:", err);
    res.status(500).json({ success: false });
  }
});

/* =========================
   GET /orders/:id
========================= */
router.get("/:id", async (req, res) => {
  try {
    const orderId = req.params.id;

    const [[order]] = await db.query(
      `
      SELECT 
        o.id,
        c.name AS customer_name,
        c.phone AS customer_phone,
        a.district AS neighborhood_name,
        a.address AS customer_address,
        a.latitude,
        a.longitude,
        o.delivery_fee,
        o.extra_store_fee,
        o.total_amount
      FROM orders o
      JOIN customers c ON c.id = o.customer_id
      JOIN customer_addresses a ON a.id = o.address_id
      WHERE o.id=?
      `,
      [orderId]
    );

    const [items] = await db.query(
      `
      SELECT 
        oi.id,
        oi.name,
        oi.price,
        oi.quantity,
        oi.restaurant_id,
        r.name AS restaurant_name,
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
          phone: it.restaurant_phone,
          map_url: it.map_url, // ⬅️ بدل latitude / longitude
          items: [],
          total: 0,
        };
        restaurants.push(map[it.restaurant_id]);
      }

      const subtotal = it.price * it.quantity;
      map[it.restaurant_id].total += subtotal;

      map[it.restaurant_id].items.push({
        id: it.id,
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


/* =========================
   PUT /orders/:id/status
========================= */
router.put("/:id/status", async (req, res) => {
  try {
    const { status } = req.body;
    await db.query("UPDATE orders SET status=? WHERE id=?", [
      status,
      req.params.id,
    ]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

/* =========================
   POST /orders/:id/assign
========================= */
router.post("/:id/assign", async (req, res) => {
  try {
    const { captain_id } = req.body;
    await db.query("UPDATE orders SET captain_id=? WHERE id=?", [
      captain_id,
      req.params.id,
    ]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});
/* =========================================
   GET /orders?status=pending
   جلب الطلبات حسب الحالة
========================================= */
router.get("/", async (req, res) => {
  try {
    const { status } = req.query;

    let where = "";
    const params = [];

    if (status) {
      if (status === "processing") {
        // قيد المعالجة = confirmed + preparing
        where = `WHERE o.status IN ('confirmed', 'preparing')`;
      } else {
        where = `WHERE o.status = $1`;
        params.push(status);
      }
    }

    const result = await db.query(
      `
      SELECT
        o.id,
        o.status,
        o.total_amount,
        o.delivery_fee,
        o.extra_store_fee,
        o.created_at,
        c.name AS customer_name,
        c.phone AS customer_phone,
        COUNT(DISTINCT orr.restaurant_id) AS stores_count,
        cap.name AS captain_name
      FROM orders o
      JOIN customers c ON c.id = o.customer_id
      LEFT JOIN captains cap ON cap.id = o.captain_id
      LEFT JOIN order_restaurants orr ON orr.order_id = o.id
      ${where}
      GROUP BY o.id, c.name, c.phone, cap.name
      ORDER BY o.id DESC
      `,
      params
    );

    res.json({
      success: true,
      orders: result.rows,
    });
  } catch (err) {
    console.error("❌ خطأ في جلب الطلبات:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

/* =========================================
   PUT /orders/:id/status
   تحديث حالة الطلب
========================================= */
router.put("/:id/status", async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    await db.query(
      `UPDATE orders SET status = $1 WHERE id = $2`,
      [status, id]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("❌ خطأ في تحديث الحالة:", err);
    res.status(500).json({ success: false });
  }
});

/* =========================================
   POST /orders/:id/assign-captain
   تعيين كابتن
========================================= */
router.post("/:id/assign-captain", async (req, res) => {
  try {
    const { id } = req.params;
    const { captain_id } = req.body;

    await db.query(
      `UPDATE orders SET captain_id = $1, status = 'delivering' WHERE id = $2`,
      [captain_id, id]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("❌ خطأ في تعيين الكابتن:", err);
    res.status(500).json({ success: false });
  }
});
export default router;
