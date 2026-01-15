import express from "express";
import db from "../db.js";
import auth from "../middlewares/auth.js";

const router = express.Router();
router.use(auth);

/* =========================
   GET /receipt-types
========================= */
router.get("/", async (req, res) => {
  try {
    const { is_admin_branch, branch_id } = req.user;
    const headerBranch = req.headers["x-branch-id"];

    let where = "WHERE 1=1 ";
    const params = [];

    if (is_admin_branch) {
      if (headerBranch) {
        where += " AND pv.branch_id = ? ";
        params.push(headerBranch);
      }
    } else {
      where += " AND pv.branch_id = ? ";
      params.push(branch_id);
    }

    const [rows] = await db.query(
      `
      SELECT
        pv.id,
        pv.voucher_no,
        pv.voucher_date,
        pv.payment_type,
        pv.cash_box_account_id,
        pv.bank_account_id,
        pv.transfer_no,
        pv.currency_id,
        pv.amount,
        pv.account_id,
        pv.analytic_account_id,
        pv.cost_center_id,
        pv.notes,
        pv.handling,
        pv.created_at,

        c.name_ar  AS currency_name,
        a.name_ar  AS account_name,
        cb.name_ar AS cash_box_name,
        bk.name_ar AS bank_name,
        u.name     AS user_name,
        br.name_ar AS branch_name
      FROM payment_vouchers pv
      LEFT JOIN currencies  c  ON c.id  = pv.currency_id
      LEFT JOIN accounts    a  ON a.id  = pv.account_id
      LEFT JOIN cash_boxes  cb ON cb.id = pv.cash_box_account_id
      LEFT JOIN banks       bk ON bk.id = pv.bank_account_id
      LEFT JOIN users       u  ON u.id  = pv.created_by
      LEFT JOIN branches    br ON br.id = pv.branch_id
      ${where}
      ORDER BY pv.id DESC
      `,
      params
    );

    res.json({ success: true, list: rows });
  } catch (err) {
    console.error("GET PAYMENT VOUCHERS ERROR:", err);
    res.status(500).json({ success: false });
  }
});

/* =========================
   POST /receipt-types
========================= */
router.post("/", async (req, res) => {
  try {
    const { code, name_ar, name_en, sort_order } = req.body;
    const { id: user_id, branch_id } = req.user;

    if (!code || !name_ar || !sort_order) {
      return res.status(400).json({
        success: false,
        message: "الرقم والاسم والترتيب مطلوبة",
      });
    }

    await db.query(
      `
      INSERT INTO receipt_types
      (code, name_ar, name_en, sort_order, branch_id, created_by)
      VALUES (?, ?, ?, ?, ?, ?)
      `,
      [code, name_ar, name_en || null, sort_order, branch_id, user_id]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("ADD RECEIPT TYPE ERROR:", err);
    res.status(500).json({
      success: false,
      message: "خطأ في الإضافة",
    });
  }
});

/* =========================
   PUT /receipt-types/:id
========================= */
router.put("/:id", async (req, res) => {
  try {
    const { name_ar, name_en, sort_order } = req.body;

    if (!name_ar || !sort_order) {
      return res.status(400).json({
        success: false,
        message: "الاسم والترتيب مطلوبان",
      });
    }

    await db.query(
      `
      UPDATE receipt_types
      SET name_ar = ?, name_en = ?, sort_order = ?
      WHERE id = ?
      `,
      [name_ar, name_en || null, sort_order, req.params.id]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("UPDATE RECEIPT TYPE ERROR:", err);
    res.status(500).json({ success: false });
  }
});

/* =========================
   DELETE /receipt-types/:id
========================= */
router.delete("/:id", async (req, res) => {
  try {
    await db.query("DELETE FROM receipt_types WHERE id = ?", [
      req.params.id,
    ]);
    res.json({ success: true });
  } catch (err) {
    console.error("DELETE RECEIPT TYPE ERROR:", err);
    res.status(500).json({ success: false });
  }
});

export default router;
