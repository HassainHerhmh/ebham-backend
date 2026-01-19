import express from "express";
import db from "../db.js";
import auth from "../middlewares/auth.js";

const router = express.Router();
router.use(auth);

/* =========================
   GET Journal Entries
========================= */
router.get("/", async (req, res) => {
  try {
    const { is_admin_branch, branch_id } = req.user;
    const headerBranch = req.headers["x-branch-id"];

    let where = "WHERE 1=1 ";
    const params: any[] = [];

    if (is_admin_branch) {
      if (headerBranch) {
        where += " AND j.branch_id = ? ";
        params.push(headerBranch);
      }
    } else {
      where += " AND j.branch_id = ? ";
      params.push(branch_id);
    }

    const [rows] = await db.query(
      `
      SELECT
        j.reference_type,
        j.reference_id,
        j.journal_date,

        MAX(CASE WHEN j.debit  > 0 THEN a.name_ar END)  AS from_account,
        MAX(CASE WHEN j.credit > 0 THEN a.name_ar END)  AS to_account,

        SUM(j.debit)  AS debit,
        SUM(j.credit) AS credit,

        c.name_ar  AS currency_name,
        MAX(j.notes) AS notes,
        u.name      AS user_name,
        br.name     AS branch_name,

        MIN(j.id) AS id
      FROM journal_entries j
      LEFT JOIN accounts  a  ON a.id = j.account_id
      LEFT JOIN currencies c ON c.id = j.currency_id
      LEFT JOIN users u      ON u.id = j.created_by
      LEFT JOIN branches br  ON br.id = j.branch_id
      ${where}
      GROUP BY
        j.reference_type,
        j.reference_id,
        j.journal_date,
        j.currency_id,
        j.created_by,
        j.branch_id,
        c.name_ar,
        u.name,
        br.name
      ORDER BY id DESC
      `,
      params
    );

    res.json({ success: true, list: rows });
  } catch (err) {
    console.error("GET JOURNAL ENTRIES ERROR:", err);
    res.status(500).json({ success: false });
  }
});





/* =========================
   POST Journal Entry (Manual)
========================= */
router.post("/", async (req, res) => {
  const conn = await db.getConnection();
  try {
    const {
      journal_type_id,
      journal_date,
      currency_id,
      account_id,
      debit,
      credit,
      notes,
      cost_center_id,
    } = req.body;

    const { id: user_id, branch_id } = req.user;

    await conn.beginTransaction();

    // 0) توليد رقم سند تسلسلي موحّد
    const [[row]] = await conn.query(`
      SELECT MAX(v) AS last_no FROM (
        SELECT MAX(voucher_no) AS v FROM receipt_vouchers
        UNION ALL
        SELECT MAX(voucher_no) AS v FROM payment_vouchers
        UNION ALL
        SELECT MAX(reference_id) AS v FROM journal_entries
      ) t
    `);

    const refNo = (row?.last_no || 0) + 1;

    // 1) إدخال القيد اليدوي
    await conn.query(
      `
      INSERT INTO journal_entries
      (journal_type_id, reference_type, reference_id, journal_date,
       currency_id, account_id, debit, credit, notes, cost_center_id,
       created_by, branch_id)
      VALUES (?, 'manual', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        journal_type_id || 1,
        refNo,
        journal_date,
        currency_id,
        account_id,
        debit || 0,
        credit || 0,
        notes || "قيد يدوي",
        cost_center_id || null,
        user_id,
        branch_id,
      ]
    );

    await conn.commit();
    res.json({ success: true, reference_id: refNo });
  } catch (err) {
    await conn.rollback();
    console.error("CREATE JOURNAL ENTRY ERROR:", err);
    res.status(500).json({ success: false, message: "فشل حفظ القيد" });
  } finally {
    conn.release();
  }
});

/* =========================
   UPDATE Journal Entry
========================= */
router.put("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const {
      journal_date,
      currency_id,
      account_id,
      debit,
      credit,
      notes,
      cost_center_id,
    } = req.body;

    await db.query(
      `
      UPDATE journal_entries
      SET journal_date = ?,
          currency_id  = ?,
          account_id   = ?,
          debit        = ?,
          credit       = ?,
          notes        = ?,
          cost_center_id = ?
      WHERE id = ?
      `,
      [
        journal_date,
        currency_id,
        account_id,
        debit,
        credit,
        notes,
        cost_center_id,
        id,
      ]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("UPDATE JOURNAL ENTRY ERROR:", err);
    res.status(500).json({ success: false });
  }
});

/* =========================
   DELETE Journal Entry
========================= */
router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    await db.query(`DELETE FROM journal_entries WHERE id = ?`, [id]);

    res.json({ success: true });
  } catch (err) {
    console.error("DELETE JOURNAL ENTRY ERROR:", err);
    res.status(500).json({ success: false });
  }
});

export default router;
