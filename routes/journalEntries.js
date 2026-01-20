import express from "express";
import db from "../db.js";
import auth from "../middlewares/auth.js";

const router = express.Router();
router.use(auth);

/* =========================
   GET Journal Entries (Manual Only)
========================= */
router.get("/", async (req, res) => {
  try {
    const { is_admin_branch, branch_id } = req.user;
    const headerBranch = req.headers["x-branch-id"];

    let where = "WHERE j1.reference_type = 'manual' ";
    const params = [];

    if (is_admin_branch) {
      if (headerBranch) {
        where += " AND j1.branch_id = ? ";
        params.push(headerBranch);
      }
    } else {
      where += " AND j1.branch_id = ? ";
      params.push(branch_id);
    }

    const [rows] = await db.query(
      `
      SELECT
        j1.reference_id                       AS voucher_no,
        MIN(j1.journal_date)                 AS journal_date,
        MAX(CASE WHEN j1.debit  > 0 THEN a1.name_ar END) AS from_account,
        MAX(CASE WHEN j1.credit > 0 THEN a1.name_ar END) AS to_account,
        SUM(j1.debit)                        AS amount,
        MAX(c.name_ar)                       AS currency_name,
        MAX(j1.notes)                       AS notes,
        MAX(u.name)                         AS user_name,
        MAX(br.name)                        AS branch_name,
        MIN(j1.id)                          AS id
      FROM journal_entries j1
      LEFT JOIN accounts a1  ON a1.id = j1.account_id
      LEFT JOIN currencies c ON c.id = j1.currency_id
      LEFT JOIN users u      ON u.id = j1.created_by
      LEFT JOIN branches br  ON br.id = j1.branch_id
      ${where}
      GROUP BY j1.reference_id
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
   POST Journal Entry
========================= */
router.post("/", async (req, res) => {
  try {
    const {
      journal_type_id,
      reference_type,
      reference_id,
      journal_date,
      currency_id,
      account_id,
      debit,
      credit,
      notes,
      cost_center_id,
    } = req.body;

    const { id: user_id, branch_id } = req.user;

    await db.query(
      `
      INSERT INTO journal_entries
      (journal_type_id, reference_type, reference_id, journal_date,
       currency_id, account_id, debit, credit, notes, cost_center_id,
       created_by, branch_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        journal_type_id,
        reference_type,
        reference_id,
        journal_date,
        currency_id,
        account_id,
        debit,
        credit,
        notes,
        cost_center_id,
        user_id,
        branch_id,
      ]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("CREATE JOURNAL ENTRY ERROR:", err);
    res.status(500).json({ success: false, message: "فشل حفظ القيد" });
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

// حذف قيد كامل بواسطة reference_id
router.delete("/by-ref/:ref", async (req, res) => {
  try {
    const { ref } = req.params;

    const [result] = await db.query(
      `DELETE FROM journal_entries WHERE reference_id = ?`,
      [ref]
    );

    res.json({
      success: true,
      deleted: result.affectedRows,
    });
  } catch (err) {
    console.error("DELETE BY REF ERROR:", err);
    res.status(500).json({ success: false });
  }
});

export default router;
