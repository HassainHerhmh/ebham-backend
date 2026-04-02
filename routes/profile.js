import express from "express";
import auth from "../middlewares/auth.js";
import db from "../db.js";

const router = express.Router();

/* =========================
   📊 احصائيات المستخدم
========================= */
router.get("/", auth, async (req, res) => {
  try {
    const userId = req.user.id;

    /* ===== الرصيد ===== */
    const [[g]] = await db.query(
      "SELECT id FROM customer_guarantees WHERE customer_id=? LIMIT 1",
      [userId]
    );

    let balance = 0;

    if (g) {
      const [[row]] = await db.query(`
        SELECT IFNULL(SUM(amount_base), 0) as balance
        FROM customer_guarantee_moves
        WHERE guarantee_id=?
      `, [g.id]);

      balance = row.balance || 0;
    }

    /* ===== النقاط ===== */
    const [[pointsRow]] = await db.query(
      "SELECT points FROM loyalty_points WHERE user_id = ? LIMIT 1",
      [userId]
    );

    /* ===== الطلبات ===== */
    const [[ordersRow]] = await db.query(
      "SELECT COUNT(*) AS total FROM orders WHERE customer_id = ?",
      [userId]
    );

    return res.json({
      success: true,
      balance,
      points: pointsRow?.points || 0,
      orders: ordersRow?.total || 0,
    });

  } catch (err) {
    console.error("PROFILE ERROR:", err);
    res.status(500).json({ success: false });
  }
});

export default router;
