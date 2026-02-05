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

    /* جلب حسابات العمولات */
    const [[settings]] = await db.query(`
      SELECT
        commission_income_account,
        courier_commission_account
      FROM settings
      LIMIT 1
    `);

    let where = "1=1";
    const params = [];

    if (from && to) {
      where += " AND je.journal_date BETWEEN ? AND ?";
      params.push(from, to);
    }

    if (!is_admin_branch) {
      where += " AND je.branch_id = ?";
      params.push(branch_id);
    }

    const [rows] = await db.query(
      `
      SELECT

        je.journal_date AS order_date,

        je.reference_id AS order_id,

        MAX(o.total_amount) AS total_amount,

        MAX(cap.name) AS captain_name,

        MAX(r.name) AS restaurant_name,

        /* عمولة المطعم */
        SUM(
          CASE
            WHEN je.account_id = ?
            THEN je.credit
            ELSE 0
          END
        ) AS restaurant_commission,

        /* عمولة الكابتن */
        SUM(
          CASE
            WHEN je.account_id = ?
            THEN je.credit
            ELSE 0
          END
        ) AS captain_commission

      FROM journal_entries je

      LEFT JOIN orders o
        ON o.id = je.reference_id

      LEFT JOIN captains cap
        ON cap.id = o.captain_id

      LEFT JOIN order_items oi
        ON oi.order_id = o.id

      LEFT JOIN restaurants r
        ON r.id = oi.restaurant_id

      WHERE ${where}

      GROUP BY je.reference_id, je.journal_date

      ORDER BY je.journal_date DESC
      `,
      [
        settings.commission_income_account,
        settings.courier_commission_account,
        ...params,
      ]
    );

    res.json({
      success: true,
      list: rows,
    });

  } catch (err) {

    console.error("COMMISSIONS REPORT ERROR:", err);

    res.status(500).json({
      success: false,
      message: "فشل تحميل التقرير",
    });
  }
});




export default router;
