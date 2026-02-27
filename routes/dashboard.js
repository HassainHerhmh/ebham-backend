import express from "express";
import auth from "../middlewares/auth.js";
import db from "../db.js";

const router = express.Router();

router.get("/today-stats", auth, async (req, res) => {

  try {

    const captainId = req.user.id;
    const branchId  = req.user.branch_id;

    /* =========================
       1️⃣ عقد العمولة
    ========================== */
    const [[contract]] = await db.query(`
      SELECT commission_type, commission_value
      FROM commissions
      WHERE account_type = 'captain'
      AND account_id = ?
      AND branch_id = ?
      AND is_active = 1
      AND CURDATE() BETWEEN contract_start AND contract_end
      LIMIT 1
    `, [captainId, branchId]);

    const commissionType  = contract?.commission_type || "percentage";
    const commissionValue = Number(contract?.commission_value || 0);

    /* =========================
       2️⃣ طلبات اليوم
    ========================== */
    const [[orders]] = await db.query(`
      SELECT
        COUNT(*) AS total_orders,
        COALESCE(SUM(delivery_fee),0) AS delivery_total
      FROM orders
      WHERE captain_id = ?
      AND status = 'completed'
      AND DATE(created_at) = CURDATE()
    `, [captainId]);

    const totalOrders   = Number(orders.total_orders || 0);
    const deliveryTotal = Number(orders.delivery_total || 0);

    /* =========================
       3️⃣ حساب العمولة
    ========================== */
    let commissionTotal = 0;

    if (commissionType === "percentage") {
      commissionTotal = deliveryTotal * (commissionValue / 100);
    } else {
      commissionTotal = commissionValue * totalOrders;
    }

    const netProfit = deliveryTotal - commissionTotal;

    /* =========================
       4️⃣ نشاط اليوم بالثواني
    ========================== */
    const [[sessions]] = await db.query(`
      SELECT 
        COALESCE(
          SUM(
            TIMESTAMPDIFF(
              SECOND,
              GREATEST(login_time, CURDATE()),
              LEAST(
                IFNULL(logout_time, NOW()),
                DATE_ADD(CURDATE(), INTERVAL 1 DAY)
              )
            )
          ),
        0) AS total_seconds
      FROM captain_sessions
      WHERE captain_id = ?
      AND (
        login_time < DATE_ADD(CURDATE(), INTERVAL 1 DAY)
        AND IFNULL(logout_time, NOW()) > CURDATE()
      )
    `, [captainId]);

    const totalSeconds = Number(sessions.total_seconds || 0);

    /* جلسة مفتوحة حالياً */
    const [[openSession]] = await db.query(`
      SELECT login_time
      FROM captain_sessions
      WHERE captain_id = ?
      AND logout_time IS NULL
      LIMIT 1
    `, [captainId]);

    /* =========================
       5️⃣ متوسط التقييم
    ========================== */
    const [[rating]] = await db.query(`
      SELECT COALESCE(AVG(rating),0) AS avg_rating
      FROM captain_ratings
      WHERE captain_id = ?
    `, [captainId]);

    const avgRating = Number(rating.avg_rating || 0);

    /* =========================
       RESPONSE النهائي
    ========================== */
    res.json({
      success: true,
      stats: {
        total_orders: totalOrders,
        delivery_total: deliveryTotal,
        commission_total: commissionTotal,
        net_profit: netProfit,
        total_seconds: totalSeconds,
        is_online: !!openSession,
        current_session_start: openSession?.login_time || null,
        avg_rating: Number(avgRating.toFixed(1))
      }
    });

  } catch (err) {

    console.error("TODAY STATS ERROR:", err);

    res.status(500).json({
      success: false,
      message: "Server Error"
    });

  }

});

export default router;
