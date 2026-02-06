import express from "express";
import db from "../db.js";
import auth from "../middlewares/auth.js";

const router = express.Router();

/* حماية */
router.use(auth);

/* =========================
   جلب كل طلبات وصل لي
========================= */
router.get("/", async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT 
        w.*,
        c.name AS customer_name
      FROM wassel_orders w
      LEFT JOIN customers c ON c.id = w.customer_id
      ORDER BY w.id DESC
    `);

    res.json({ orders: rows });

  } catch (err) {
    console.error("Get Wassel Orders:", err);
    res.status(500).json({ message: "Server error" });
  }
});

/* =========================
   إضافة طلب جديد
========================= */
router.post("/", async (req, res) => {
  try {
   const {
  customer_id,
  order_type,

  from_address_id,
  from_address,
  from_lat,
  from_lng,

  to_address_id,
  to_address,
  to_lat,
  to_lng,

  delivery_fee,
  extra_fee,
  notes,
} = req.body;


    if (!order_type || !from_address || !to_address) {
      return res.status(400).json({
        message: "بيانات ناقصة",
      });
    }

    await db.query(
      `
     INSERT INTO wassel_orders
(
  customer_id,
  order_type,

  from_address_id,
  from_address,
  from_lat,
  from_lng,

  to_address_id,
  to_address,
  to_lat,
  to_lng,

  delivery_fee,
  extra_fee,
  notes,
  status,
  created_at
)
VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,NOW())

    `,
   [
  customer_id,
  order_type,

  from_address_id || null,
  from_address,
  from_lat,
  from_lng,

  to_address_id || null,
  to_address,
  to_lat,
  to_lng,

  delivery_fee || 0,
  extra_fee || 0,
  notes || "",

  "pending",
]

    );

    res.json({ success: true });

  } catch (err) {
    console.error("Add Wassel Order:", err);
    res.status(500).json({ message: "Server error" });
  }

});

/* =========================
   تعديل طلب
========================= */
router.put("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const {
      customer_id,
      order_type,

      from_address,
      from_lat,
      from_lng,

      to_address,
      to_lat,
      to_lng,
      from_address_id,
to_address_id,

      delivery_fee,
      extra_fee,
      notes,
      status,
    } = req.body;

    await db.query(
      `
 UPDATE wassel_orders
SET
  customer_id = ?,
  order_type = ?,

  from_address_id = ?,
  from_address = ?,
  from_lat = ?,
  from_lng = ?,

  to_address_id = ?,
  to_address = ?,
  to_lat = ?,
  to_lng = ?,

  delivery_fee = ?,
  extra_fee = ?,
  notes = ?,
  status = ?

WHERE id = ?

    `,
 [
  customer_id,
  order_type,

  from_address_id || null,
  from_address,
  from_lat,
  from_lng,

  to_address_id || null,
  to_address,
  to_lat,
  to_lng,

  delivery_fee || 0,
  extra_fee || 0,
  notes || "",
  status || "pending",

  id,
]

    );

    res.json({ success: true });

  } catch (err) {
    console.error("Update Wassel Order:", err);
    res.status(500).json({ message: "Server error" });
  }
});

/* =========================
   تغيير الحالة فقط
========================= */
router.put("/status/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    await db.query(
      `UPDATE wassel_orders SET status=? WHERE id=?`,
      [status, id]
    );

    res.json({ success: true });

  } catch (err) {
    console.error("Update Status:", err);
    res.status(500).json({ message: "Server error" });
  }
});

/* =========================
   حذف طلب (اختياري)
========================= */
router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    await db.query(
      `DELETE FROM wassel_orders WHERE id=?`,
      [id]
    );

    res.json({ success: true });

  } catch (err) {
    console.error("Delete Wassel:", err);
    res.status(500).json({ message: "Server error" });
  }
});

export default router;
