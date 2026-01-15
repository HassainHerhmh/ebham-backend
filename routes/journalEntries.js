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
    const params = [];

    if (is_admin_branch) {
      if (headerBranch) {
        where += " AND je.branch_id = ? ";
        params.push(headerBranch);
      }
    } else {
      where += " AND je.branch_id = ? ";
      params.push(branch_id);
    }

    const [rows] = await db.query(
      `
      SELECT
        je.*,
        a.name_ar  AS account_name,
        c.name_ar  AS currency_name,
        u.name     AS user_name,
        br.name    AS branch_name
      FROM journal_entries je
      LEFT JOIN accounts  a  ON a.id  = je.account_id
      LEFT JOIN currencies c ON c.id  = je.currency_id
      LEFT JOIN users     u  ON u.id  = je.created_by
      LEFT JOIN branches  br ON br.id = je.branch_id
      ${where}
      ORDER BY je.id DESC
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

export default router;
