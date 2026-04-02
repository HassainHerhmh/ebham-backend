import express from "express";
import auth from "../middlewares/auth.js";
import db from "../db.js";

const router = express.Router();

/* =========================
   📊 احصائيات المستخدم
========================= */
router.get("/profile", auth, async (req, res) => {
  try {
    const userId = req.user.id;

    /* ======================
       الرصيد
    ====================== */
    const [walletRows] = await db.query(
      "SELECT balance FROM customer_guarantees WHERE user_id = ?",
      [userId]
    );

    /* ======================
       النقاط
    ====================== */
    const [pointsRows] = await db.query(
      "SELECT points FROM loyalty WHERE user_id = ?",
      [userId]
    );

    /* ======================
       عدد الطلبات
    ====================== */
    const [ordersRows] = await db.query(
      "SELECT COUNT(*) AS total FROM orders WHERE customer_id = ?",
      [userId]
    );

    return res.json({
      success: true,
      balance: walletRows[0]?.balance || 0,
      points: pointsRows[0]?.points || 0,
      orders: ordersRows[0]?.total || 0,
    });

  } catch (err) {
    console.error("PROFILE API ERROR:", err);
    res.status(500).json({
      success: false,
      message: "خطأ في السيرفر",
    });
  }
});

export default router;
