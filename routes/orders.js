import express from "express";
import db from "../db.js";
import auth from "../middlewares/auth.js";

const router = express.Router();
router.use(auth);

/* =========================
   GET /orders
========================= */
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


/* =========================
   POST /orders
========================= */
router.post("/", async (req, res) => {
  try {
    console.log("📥 BODY FROM CLIENT:", JSON.stringify(req.body, null, 2));

    const { customer_id, address_id, gps_link, restaurants } = req.body;

    if (!restaurants || !restaurants.length) {
      console.log("❌ لا توجد مطاعم في الطلب");
      return res.json({ success: false, message: "لا توجد مطاعم" });
    }

    const products = [];
    for (const r of restaurants) {
      for (const p of r.products || []) {
        products.push({
          restaurant_id: r.restaurant_id,
          product_id: p.product_id,
          quantity: p.quantity,
        });
      }
    }

    console.log("📦 PRODUCTS FLATTENED:", products);

    if (!products.length) {
      console.log("❌ لا توجد منتجات بعد التحويل");
      return res.json({ success: false, message: "لا توجد منتجات" });
    }

    const storeIds = [...new Set(products.map(p => p.restaurant_id))];
    const storesCount = storeIds.length;
    const mainRestaurantId = storeIds[0];

    console.log("🏪 STORES:", storeIds);

    const [result] = await db.query(
      `
      INSERT INTO orders (customer_id, address_id, restaurant_id, gps_link, stores_count)
      VALUES (?, ?, ?, ?, ?)
      `,
      [customer_id, address_id, mainRestaurantId, gps_link || null, storesCount]
    );

    const orderId = result.insertId;
    console.log("🆕 ORDER CREATED:", orderId);

    let total = 0;

    for (const p of products) {
      const [[prod]] = await db.query(
        "SELECT name, price FROM products WHERE id=?",
        [p.product_id]
      );

      if (!prod) {
        console.log("⚠️ PRODUCT NOT FOUND:", p.product_id);
        continue;
      }

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

      console.log("➕ ITEM ADDED:", p.product_id, "x", p.quantity);
    }

    await db.query(
      "UPDATE orders SET total_amount=? WHERE id=?",
      [total, orderId]
    );

    console.log("💰 TOTAL SET:", total);

    res.json({
      success: true,
      order_id: orderId,
      stores_count: storesCount,
      items_count: products.length,
      total,
    });
  } catch (err) {
    console.error("🔥 ADD ORDER ERROR:", err);
    res.status(500).json({ success: false, error: err.message });
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
        r.latitude,
        r.longitude
      FROM order_items oi
      JOIN restaurants r ON r.id = oi.restaurant_id
      WHERE oi.order_id=?
      ORDER BY oi.restaurant_id
      `,
      [orderId]
    );

    // تجميع المنتجات حسب المطعم
    const restaurants = [];
    const map = {};

    for (const it of items) {
      if (!map[it.restaurant_id]) {
        map[it.restaurant_id] = {
          id: it.restaurant_id,
          name: it.restaurant_name,
          phone: it.restaurant_phone,
          latitude: it.latitude,
          longitude: it.longitude,
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

export default router;
