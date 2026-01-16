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

    let rows;

    if (user.is_admin_branch) {
      [rows] = await db.query(`
        SELECT 
          o.id,
          c.name AS customer_name,
          c.phone AS customer_phone,
          r.name AS restaurant_name,
          r.phone AS restaurant_phone,
          cap.name AS captain_name,
          o.status,
          o.total_amount,
          o.delivery_fee,
          o.created_at
        FROM orders o
        JOIN customers c ON c.id = o.customer_id
        JOIN restaurants r ON r.id = o.restaurant_id
        LEFT JOIN captains cap ON cap.id = o.captain_id
        ORDER BY o.id DESC
        LIMIT 50
      `);
    } else {
      [rows] = await db.query(
        `
        SELECT 
          o.id,
          c.name AS customer_name,
          c.phone AS customer_phone,
          r.name AS restaurant_name,
          r.phone AS restaurant_phone,
          cap.name AS captain_name,
          o.status,
          o.total_amount,
          o.delivery_fee,
          o.created_at
        FROM orders o
        JOIN customers c ON c.id = o.customer_id
        JOIN restaurants r ON r.id = o.restaurant_id
        LEFT JOIN captains cap ON cap.id = o.captain_id
        WHERE r.branch_id = ?
        ORDER BY o.id DESC
        LIMIT 50
        `,
        [user.branch_id]
      );
    }

    res.json({ success: true, orders: rows });
  } catch (err) {
    console.error("GET ORDERS ERROR:", err);
    res.status(500).json({ success: false });
  }
});

/* =========================
   POST /orders
========================= */
router.post("/", async (req, res) => {
  try {
    const { customer_id, address_id, gps_link, restaurant_id, products } = req.body;

    const [result] = await db.query(
      `
      INSERT INTO orders (customer_id, address_id, restaurant_id, gps_link)
      VALUES (?, ?, ?, ?)
      `,
      [customer_id, address_id, restaurant_id, gps_link || null]
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
        INSERT INTO order_items (order_id, product_id, name, price, quantity)
        VALUES (?, ?, ?, ?, ?)
        `,
        [orderId, p.product_id, prod.name, prod.price, p.quantity]
      );
    }

    await db.query(
      "UPDATE orders SET total_amount=? WHERE id=?",
      [total, orderId]
    );

    res.json({ success: true, order_id: orderId });
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
    const [items] = await db.query(
      `
      SELECT * FROM order_items WHERE order_id=?
      `,
      [req.params.id]
    );

    const [[order]] = await db.query(
      `
      SELECT 
        o.id,
        c.name AS customer_name,
        c.phone AS customer_phone,
        a.address AS customer_address,
        a.latitude,
        a.longitude,
        r.name AS restaurant_name,
        r.phone AS restaurant_phone,
        o.delivery_fee
      FROM orders o
      JOIN customers c ON c.id = o.customer_id
      JOIN customer_addresses a ON a.id = o.address_id
      JOIN restaurants r ON r.id = o.restaurant_id
      WHERE o.id=?
      `,
      [req.params.id]
    );

    order.products = items;

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
