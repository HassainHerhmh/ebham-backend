import express from "express";
import db from "../db.js";
import auth from "../middlewares/auth.js";

const router = express.Router();
router.use(auth);

/* =========================
   GET /receipt-vouchers
========================= */
router.get("/", async (req, res) => {
  try {
    const { is_admin_branch, branch_id } = req.user;
    const headerBranch = req.headers["x-branch-id"];

    let where = "WHERE 1=1 ";
    const params = [];

    if (is_admin_branch) {
      if (headerBranch) {
        where += " AND rv.branch_id = ? ";
        params.push(headerBranch);
      }
    } else {
      where += " AND rv.branch_id = ? ";
      params.push(branch_id);
    }

    const [rows] = await db.query(
      `
      SELECT
        rv.*,
        c.name_ar  AS currency_name,
        a.name_ar  AS account_name,
        cb.name_ar AS cash_box_name,
        b.name_ar  AS bank_name,
        u.name     AS user_name,
        br.name    AS branch_name
      FROM receipt_vouchers rv
      LEFT JOIN currencies  c  ON c.id  = rv.currency_id
      LEFT JOIN accounts    a  ON a.id  = rv.account_id
      LEFT JOIN cash_boxes  cb ON cb.id = rv.cash_box_account_id
      LEFT JOIN banks       b  ON b.id  = rv.bank_account_id
      LEFT JOIN users       u  ON u.id  = rv.created_by
      LEFT JOIN branches    br ON br.id = rv.branch_id
      ${where}
      ORDER BY rv.id DESC
      `,
      params
    );

    res.json({ success: true, list: rows });
  } catch (err) {
    console.error("GET RECEIPT VOUCHERS ERROR:", err);
    res.status(500).json({ success: false });
  }
});




/* =========================
   POST /receipt-vouchers
========================= */
router.post("/", async (req, res) => {
  const conn = await db.getConnection();
  try {
    const {
      voucher_date,
      receipt_type,
      cash_box_account_id,
      bank_account_id,
      transfer_no,
      currency_id,
      amount,
      account_id,
      analytic_account_id,
      cost_center_id,
      journal_type_id,
      notes,
      handling,
    } = req.body;

    const { id: user_id, branch_id } = req.user;

    await conn.beginTransaction();

// 0) توليد رقم سند تسلسلي موحّد باستخدام voucher_sequence
const [[row]] = await conn.query(
  "SELECT last_no FROM voucher_sequence WHERE id = 1 FOR UPDATE"
);

const voucher_no = row.last_no + 1;

// تحديث العداد
await conn.query(
  "UPDATE voucher_sequence SET last_no = ? WHERE id = 1",
  [voucher_no]
);

    // حفظ السند
    const [r] = await conn.query(
      `
      INSERT INTO receipt_vouchers
      (voucher_no, voucher_date, receipt_type, cash_box_account_id, bank_account_id,
       transfer_no, currency_id, amount, account_id, analytic_account_id,
       cost_center_id, journal_type_id, notes, handling, created_by, branch_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        voucher_no,
        voucher_date,
        receipt_type,
        cash_box_account_id || null,
        bank_account_id || null,
        transfer_no || null,
        currency_id,
        amount,
        account_id,
        analytic_account_id || null,
        cost_center_id || null,
        journal_type_id || 1,
        notes || null,
        handling || null,
        user_id,
        branch_id,
      ]
    );

    const refId = r.insertId;
    const boxAccount = cash_box_account_id || bank_account_id;

    // مدين: الصندوق / البنك
    await conn.query(
      `
      INSERT INTO journal_entries
      (journal_type_id, reference_type, reference_id, journal_date,
       currency_id, account_id, debit, credit, notes, created_by, branch_id)
      VALUES (?, 'receipt', ?, ?, ?, ?, ?, 0, ?, ?, ?)
      `,
      [
        journal_type_id || 1,
        refId,
        voucher_date,
        currency_id,
        boxAccount,
        amount,
        notes || "سند قبض",
        user_id,
        branch_id,
      ]
    );

    // دائن: الحساب المقابل
    await conn.query(
      `
      INSERT INTO journal_entries
      (journal_type_id, reference_type, reference_id, journal_date,
       currency_id, account_id, debit, credit, notes, created_by, branch_id)
      VALUES (?, 'receipt', ?, ?, ?, ?, 0, ?, ?, ?, ?)
      `,
      [
        journal_type_id || 1,
        refId,
        voucher_date,
        currency_id,
        account_id,
        amount,
        notes || "سند قبض",
        user_id,
        branch_id,
      ]
    );

    await conn.commit();
    res.json({ success: true, voucher_no });
  } catch (err) {
    await conn.rollback();
    console.error("ADD RECEIPT VOUCHER ERROR:", err);
    res.status(500).json({ success: false });
  } finally {
    conn.release();
  }
});



/* =========================
   PUT /receipt-vouchers/:id
========================= */
router.put("/:id", async (req, res) => {
  try {
    const {
      voucher_date,
      receipt_type,
      cash_box_account_id,
      bank_account_id,
      transfer_no,
      currency_id,
      amount,
      account_id,
      analytic_account_id,
      cost_center_id,
      notes,
      handling,
    } = req.body;

    await db.query(
      `
      UPDATE receipt_vouchers
      SET
        voucher_date = ?,
        receipt_type = ?,
        cash_box_account_id = ?,
        bank_account_id = ?,
        transfer_no = ?,
        currency_id = ?,
        amount = ?,
        account_id = ?,
        analytic_account_id = ?,
        cost_center_id = ?,
        notes = ?,
        handling = ?
      WHERE id = ?
      `,
      [
        voucher_date,
        receipt_type,
        cash_box_account_id || null,
        bank_account_id || null,
        transfer_no || null,
        currency_id,
        amount,
        account_id,
        analytic_account_id || null,
        cost_center_id || null,
        notes || null,
        handling || 0,
        req.params.id,
      ]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("UPDATE RECEIPT VOUCHER ERROR:", err);
    res.status(500).json({ success: false });
  }
});

/* =========================
   DELETE /receipt-vouchers/:id
========================= */
router.delete("/:id", async (req, res) => {
  try {
    await db.query(`DELETE FROM receipt_vouchers WHERE id = ?`, [
      req.params.id,
    ]);
    res.json({ success: true });
  } catch (err) {
    console.error("DELETE RECEIPT VOUCHER ERROR:", err);
    res.status(500).json({ success: false });
  }
});

export default router;
