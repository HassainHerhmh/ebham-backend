import express from "express";
import db from "../db.js";

const router = express.Router();


// =============================
// دالة حساب النقاط
// =============================
async function calculatePoints(amount) {
  const [rows] = await db.query("SELECT * FROM loyalty_settings LIMIT 1");

  const settings = rows[0] || { amount_per_point: 100 };

  return Math.floor(amount / settings.amount_per_point);
}


// =============================
// إضافة نقاط بعد اكتمال الطلب
// =============================
export async function addPointsAfterOrder(order) {

  try {

    const points = await calculatePoints(order.total_amount);

    if (points <= 0) return;

    // هل عنده حساب؟
    const [rows] = await db.query(
      "SELECT * FROM loyalty_points WHERE user_id=?",
      [order.customer_id]
    );

    if (rows.length === 0) {
      await db.query(
        "INSERT INTO loyalty_points (user_id, points, total_spent) VALUES (?, ?, ?)",
        [order.customer_id, points, order.total_amount]
      );
    } else {
      await db.query(
        "UPDATE loyalty_points SET points = points + ?, total_spent = total_spent + ? WHERE user_id=?",
        [points, order.total_amount, order.customer_id]
      );
    }

    // تسجيل الحركة
    await db.query(
      "INSERT INTO loyalty_logs (user_id, order_id, points, amount, type) VALUES (?, ?, ?, ?, 'earn')",
      [order.customer_id, order.id, points, order.total_amount]
    );

  } catch (err) {
    console.error("LOYALTY ERROR:", err);
  }

}


// =============================
// تقرير Admin (الحركات)
// =============================
router.get("/admin/loyalty-logs", async (req, res) => {
  try {

    const [rows] = await db.query(`
      SELECT 
        l.id,
        l.points,
        l.amount,
        l.type,
        l.created_at,
        u.name,
        u.phone
      FROM loyalty_logs l
      JOIN users u ON u.id = l.user_id
      ORDER BY l.id DESC
    `);

    res.json({ success: true, data: rows });

  } catch (err) {
    console.error(err);
    res.json({ success: false });
  }
});


// =============================
// رصيد المستخدم
// =============================
router.get("/loyalty/:userId", async (req, res) => {

  const [rows] = await db.query(
    "SELECT * FROM loyalty_points WHERE user_id=?",
    [req.params.userId]
  );

  res.json({
    success: true,
    data: rows[0] || { points: 0, total_spent: 0 }
  });
});


// =============================
// سجل المستخدم
// =============================
router.get("/loyalty/:userId/logs", async (req, res) => {

  const [rows] = await db.query(
    "SELECT * FROM loyalty_logs WHERE user_id=? ORDER BY id DESC",
    [req.params.userId]
  );

  res.json({ success: true, data: rows });
});


// =============================
// الإعدادات
// =============================
router.get("/admin/loyalty-settings", async (req, res) => {

  const [rows] = await db.query(
    "SELECT * FROM loyalty_settings LIMIT 1"
  );

  res.json(rows[0] || { amount_per_point: 100, point_value: 1 });
});

router.post("/admin/loyalty-settings", async (req, res) => {

  const { amount_per_point, point_value } = req.body;

  await db.query(`
    INSERT INTO loyalty_settings (id, amount_per_point, point_value)
    VALUES (1, ?, ?)
    ON DUPLICATE KEY UPDATE
    amount_per_point=?, point_value=?
  `, [amount_per_point, point_value, amount_per_point, point_value]);

  res.json({ success: true });
});

export default router;
