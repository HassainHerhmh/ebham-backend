import express from "express";
import db from "../db.js";
import auth from "../middlewares/auth.js";

const router = express.Router();
router.use(auth);

function clampRating(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(5, Math.max(1, Math.round(n)));
}

router.get("/pending", async (req, res) => {
  try {
    if (req.user?.role !== "customer") {
      return res.json({ success: true, rating: null });
    }

    const customerId = req.user.id;

    const [delivery] = await db.query(
      `
      SELECT
        o.id AS order_id,
        'order' AS order_kind,
        COALESCE(o.order_number, o.id) AS order_number,
        o.captain_id,
        cap.name AS captain_name,
        (
          SELECT oi.restaurant_id
          FROM order_items oi
          WHERE oi.order_id = o.id
          LIMIT 1
        ) AS restaurant_id,
        (
          SELECT r.name
          FROM order_items oi
          JOIN restaurants r ON r.id = oi.restaurant_id
          WHERE oi.order_id = o.id
          LIMIT 1
        ) AS restaurant_name
      FROM orders o
      LEFT JOIN captains cap ON cap.id = o.captain_id
      LEFT JOIN order_ratings rt
        ON rt.order_id = o.id AND rt.order_kind = 'order'
      WHERE o.customer_id = ?
        AND o.status = 'completed'
        AND rt.id IS NULL
      ORDER BY o.completed_at DESC, o.id DESC
      LIMIT 1
      `,
      [customerId]
    );

    const [wassel] = await db.query(
      `
      SELECT
        w.id AS order_id,
        'wassel' AS order_kind,
        COALESCE(w.order_number, w.id) AS order_number,
        w.captain_id,
        cap.name AS captain_name,
        w.restaurant_id,
        r.name AS restaurant_name
      FROM wassel_orders w
      LEFT JOIN captains cap ON cap.id = w.captain_id
      LEFT JOIN restaurants r ON r.id = w.restaurant_id
      LEFT JOIN order_ratings rt
        ON rt.order_id = w.id AND rt.order_kind = 'wassel'
      WHERE w.customer_id = ?
        AND w.status = 'completed'
        AND rt.id IS NULL
      ORDER BY w.completed_at DESC, w.id DESC
      LIMIT 1
      `,
      [customerId]
    );

    const row = delivery[0] || wassel[0] || null;
    if (!row) {
      return res.json({ success: true, rating: null });
    }

    res.json({
      success: true,
      rating: {
        order_id: row.order_id,
        order_kind: row.order_kind,
        order_number: row.order_number,
        has_captain: Boolean(row.captain_id),
        captain_id: row.captain_id || null,
        captain_name: row.captain_name || "الكابتن",
        has_restaurant: Boolean(row.restaurant_id),
        restaurant_id: row.restaurant_id || null,
        restaurant_name: row.restaurant_name || "المحل",
      },
    });
  } catch (err) {
    console.error("PENDING RATING ERROR:", err?.message || err);
    res.json({ success: true, rating: null });
  }
});

router.post("/", async (req, res) => {
  try {
    if (req.user?.role !== "customer") {
      return res.status(403).json({ success: false, message: "غير مصرح" });
    }

    const customerId = req.user.id;
    const orderId = Number(req.body.order_id);
    const orderKind = req.body.order_kind === "wassel" ? "wassel" : "order";
    const restaurantRating = clampRating(req.body.restaurant_rating);
    const captainRating = clampRating(req.body.captain_rating);
    const notes = String(req.body.notes || "").trim().slice(0, 1000);

    if (!orderId) {
      return res.json({ success: false, message: "رقم الطلب مطلوب" });
    }

    let order = null;
    if (orderKind === "order") {
      const [[row]] = await db.query(
        `SELECT id, customer_id, captain_id, status FROM orders WHERE id=? LIMIT 1`,
        [orderId]
      );
      order = row;
    } else {
      const [[row]] = await db.query(
        `SELECT id, customer_id, captain_id, restaurant_id, status FROM wassel_orders WHERE id=? LIMIT 1`,
        [orderId]
      );
      order = row;
    }

    if (!order || Number(order.customer_id) !== Number(customerId)) {
      return res.status(404).json({ success: false, message: "الطلب غير موجود" });
    }
    if (order.status !== "completed") {
      return res.json({ success: false, message: "التقييم بعد اكتمال الطلب فقط" });
    }

    let restaurantId = order.restaurant_id || null;
    if (orderKind === "order") {
      const [[item]] = await db.query(
        `SELECT restaurant_id FROM order_items WHERE order_id=? LIMIT 1`,
        [orderId]
      );
      restaurantId = item?.restaurant_id || null;
    }

    if (restaurantId && !restaurantRating) {
      return res.json({ success: false, message: "قيّم المحل" });
    }
    if (order.captain_id && !captainRating) {
      return res.json({ success: false, message: "قيّم الكابتن" });
    }
    if (!restaurantRating && !captainRating) {
      return res.json({ success: false, message: "اختر تقييماً" });
    }

    await db.query(
      `
      INSERT INTO order_ratings
        (order_kind, order_id, customer_id, restaurant_id, restaurant_rating, captain_id, captain_rating, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        restaurant_rating = VALUES(restaurant_rating),
        captain_rating = VALUES(captain_rating),
        notes = VALUES(notes)
      `,
      [
        orderKind,
        orderId,
        customerId,
        restaurantId,
        restaurantRating,
        order.captain_id || null,
        captainRating,
        notes || null,
      ]
    );

    if (order.captain_id && captainRating) {
      try {
        await db.query(
          `INSERT INTO captain_ratings (captain_id, order_id, rating) VALUES (?, ?, ?)`,
          [order.captain_id, orderId, captainRating]
        );
      } catch {
        // table may already have a row
      }
    }

    res.json({ success: true, message: "شكراً لتقييمك" });
  } catch (err) {
    console.error("SAVE RATING ERROR:", err?.message || err);
    res.status(500).json({ success: false, message: "فشل حفظ التقييم" });
  }
});

router.get("/", async (req, res) => {
  try {
    const search = String(req.query.search || "").trim();
    const params = [];
    let where = "1=1";

    if (search) {
      where += ` AND (
        c.name LIKE ? OR cap.name LIKE ? OR r.name LIKE ?
        OR rt.notes LIKE ? OR rt.order_id LIKE ?
      )`;
      const q = `%${search}%`;
      params.push(q, q, q, q, q);
    }

    const [rows] = await db.query(
      `
      SELECT
        rt.id,
        rt.order_kind,
        rt.order_id,
        rt.restaurant_rating,
        rt.captain_rating,
        rt.notes,
        rt.created_at,
        c.name AS customer_name,
        c.phone AS customer_phone,
        cap.name AS captain_name,
        r.name AS restaurant_name,
        COALESCE(o.order_number, w.order_number, rt.order_id) AS order_number
      FROM order_ratings rt
      LEFT JOIN customers c ON c.id = rt.customer_id
      LEFT JOIN captains cap ON cap.id = rt.captain_id
      LEFT JOIN restaurants r ON r.id = rt.restaurant_id
      LEFT JOIN orders o ON rt.order_kind = 'order' AND o.id = rt.order_id
      LEFT JOIN wassel_orders w ON rt.order_kind = 'wassel' AND w.id = rt.order_id
      WHERE ${where}
      ORDER BY rt.id DESC
      LIMIT 300
      `,
      params
    );

    const [[stats]] = await db.query(
      `SELECT
         COUNT(*) AS total,
         ROUND(AVG(restaurant_rating), 1) AS avg_restaurant,
         ROUND(AVG(captain_rating), 1) AS avg_captain
       FROM order_ratings`
    );

    res.json({
      success: true,
      list: rows,
      stats: {
        total: Number(stats?.total || 0),
        avg_restaurant: stats?.avg_restaurant || 0,
        avg_captain: stats?.avg_captain || 0,
      },
    });
  } catch (err) {
    console.error("RATINGS LIST ERROR:", err?.message || err);
    res.json({ success: true, list: [], stats: { total: 0 } });
  }
});

export default router;
