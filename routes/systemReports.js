import express from "express";
import db from "../db.js";
import auth from "../middlewares/auth.js";

const router = express.Router();
router.use(auth);

/* =========================
   تقرير العمولات العام
========================= */
router.get("/commissions", async (req, res) => {
  try {
    const { from, to } = req.query;
    const { branch_id, is_admin_branch } = req.user;

    let where = "1=1";
    const params = [];

    /* ===== فلترة التاريخ ===== */
    if (from && to) {
      where += " AND o.created_at BETWEEN ? AND ?";
      params.push(from, to);
    }

    /* ===== فلترة الفرع ===== */
    if (!is_admin_branch) {
      where += " AND o.branch_id = ?";
      params.push(branch_id);
    }

 const [rows] = await db.query(
`
SELECT

  DATE(o.created_at) AS order_date,

  cap.name AS captain_name,

  r.name AS restaurant_name,

  o.id AS order_id,

  const [rows] = await db.query(
`
SELECT

  DATE(o.created_at) AS order_date,

  cap.name AS captain_name,

  r.name AS restaurant_name,

  o.id AS order_id,

  o.total_amount,

  /* عمولة المطعم */
  SUM(
    CASE 
      WHEN rc.commission_type = 'percent'
      THEN (oi.price * oi.quantity * rc.commission_value / 100)
      ELSE IFNULL(rc.commission_value,0)
    END
  ) AS restaurant_commission,

  /* عمولة الكابتن */
  SUM(
    CASE
      WHEN cc.commission_type = 'percent'
      THEN ((o.delivery_fee + o.extra_store_fee) * cc.commission_value / 100)
      ELSE IFNULL(cc.commission_value,0)
    END
  ) AS captain_commission

FROM orders o

LEFT JOIN captains cap 
  ON cap.id = o.captain_id

LEFT JOIN order_items oi 
  ON oi.order_id = o.id

LEFT JOIN restaurants r 
  ON r.id = oi.restaurant_id

/* عمولة المطعم حسب الفرع */
LEFT JOIN commissions rc
  ON rc.account_type = 'agent'
  AND rc.account_id = r.agent_id
  AND rc.branch_id = o.branch_id
  AND rc.is_active = 1

/* عمولة الكابتن حسب الفرع */
LEFT JOIN commissions cc
  ON cc.account_type = 'captain'
  AND cc.account_id = o.captain_id
  AND cc.branch_id = o.branch_id
  AND cc.is_active = 1

WHERE ${where}

GROUP BY
  o.id,
  DATE(o.created_at),
  cap.name,
  r.name,
  o.total_amount

ORDER BY o.created_at DESC
`,
params
);



    res.json({
      success: true,
      list: rows,
    });

  } catch (err) {
    console.error("SYSTEM COMMISSIONS ERROR:", err);
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

export default router;
