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

    /* =========================
       عدد الطلبات
    ========================= */
    const [ordersRows] = await db.query(
      "SELECT COUNT(*) AS total FROM orders WHERE customer_id = ?",
      [userId]
    );

    /* =========================
       الرصيد
    ========================= */
    const [balanceRows] = await db.query(
      "SELECT balance FROM customers WHERE id = ?",
      [userId]
    );

    /* =========================
       النقاط
    ========================= */
    const [pointsRows] = await db.query(
      "SELECT points FROM loyalty WHERE user_id = ?",
      [userId]
    );

    return res.json({
      success: true,
      orders: ordersRows[0]?.total || 0,
      balance: balanceRows[0]?.balance || 0,
      points: pointsRows[0]?.points || 0,
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
