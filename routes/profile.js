import express from "express";
import auth from "../middlewares/auth.js";
import db from "../db.js";

const router = express.Router();

/* =========================
   📊 احصائيات المستخدم
========================= */
router.get("/stats", auth, async (req, res) => {
  try {
    const userId = req.user.id;

    const [rows] = await db.query(`
      SELECT 
        (SELECT COUNT(*) FROM orders WHERE customer_id = ?) AS orders,
        (SELECT balance FROM wallets WHERE user_id = ?) AS balance,
        (SELECT points FROM loyalty WHERE user_id = ?) AS points
    `, [userId, userId, userId]);

    return res.json({
      success: true,
      orders: rows[0]?.orders || 0,
      balance: rows[0]?.balance || 0,
      points: rows[0]?.points || 0,
    });

  } catch (err) {
    console.error("PROFILE STATS ERROR:", err);

    return res.status(500).json({
      success: false,
      message: "خطأ في السيرفر",
    });
  }
});

export default router;
