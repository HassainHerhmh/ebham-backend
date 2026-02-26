import express from "express";
import auth from "../middlewares/auth.js";
import db from "../db.js";

const router = express.Router();

router.get("/today-stats", auth, async (req, res) => {

  try {

    const captainId = req.user.id;

    const [[orders]] = await db.query(`
      SELECT
        COUNT(*) AS total_orders,
        COALESCE(SUM(delivery_fee),0) AS delivery_total,
        COALESCE(SUM(company_commission),0) AS commission_total,
        COALESCE(SUM(delivery_fee - company_commission),0) AS net_profit
      FROM orders
      WHERE captain_id = ?
      AND status = 'completed'
      AND DATE(created_at) = CURDATE()
    `, [captainId]);

    res.json({
      success: true,
      stats: {
        total_orders: orders.total_orders || 0,
        net_profit: orders.net_profit || 0
      }
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false });
  }

});

export default router;
