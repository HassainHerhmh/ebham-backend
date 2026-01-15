import express from "express";
import db from "../db.js";
import auth from "../middlewares/auth.js";

const router = express.Router();
router.use(auth);

/*
POST /reports/account-statement
payload:
{
  account_id?: number,        // عند اختيار "حساب واحد"
  main_account_id?: number,   // عند اختيار "كل الحسابات"
  currency_id?: number|null,
  from_date?: string|null,
  to_date?: string|null,
  report_mode: "detailed" | "summary"
}
*/
router.post("/account-statement", async (req, res) => {
  try {
    const {
      account_id,
      main_account_id,
      currency_id,
      from_date,
      to_date,
      report_mode,
    } = req.body;

    const { branch_id } = req.user;

    // 1) تحديد الحسابات المستهدفة
    let accountIds = [];

    if (account_id) {
      // حساب واحد → اجلب الحسابات الفرعية فقط
      const [subs] = await db.query(
        `SELECT id FROM accounts WHERE parent_id = ?`,
        [account_id]
      );
      accountIds = subs.map(r => r.id);
      if (!accountIds.length) accountIds = [account_id];
    } else if (main_account_id) {
      // كل الحسابات → اجلب الحسابات الرئيسية فقط
      const [mains] = await db.query(
        `SELECT id FROM accounts WHERE parent_id IS NULL AND id = ?`,
        [main_account_id]
      );
      accountIds = mains.map(r => r.id);
    } else {
      return res.json({ success: true, opening_balance: 0, list: [] });
    }

    const where = [];
    const params = [];

    where.push(`je.branch_id = ?`);
    params.push(branch_id);

    where.push(`je.account_id IN (${accountIds.map(() => "?").join(",")})`);
    params.push(...accountIds);

    if (currency_id) {
      where.push(`je.currency_id = ?`);
      params.push(currency_id);
    }

    if (from_date) {
      where.push(`je.journal_date >= ?`);
      params.push(from_date);
    }

    if (to_date) {
      where.push(`je.journal_date <= ?`);
      params.push(to_date);
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    // 2) الرصيد الافتتاحي
    let opening = 0;
    if (from_date) {
      const [op] = await db.query(
        `
        SELECT COALESCE(SUM(debit) - SUM(credit), 0) AS bal
        FROM journal_entries
        WHERE branch_id = ?
          AND account_id IN (${accountIds.map(() => "?").join(",")})
          ${currency_id ? "AND currency_id = ?" : ""}
          AND journal_date < ?
        `,
        [
          branch_id,
          ...accountIds,
          ...(currency_id ? [currency_id] : []),
          from_date,
        ]
      );
      opening = op[0]?.bal || 0;
    }

    // 3) الجلب
    let sql;
    if (report_mode === "summary") {
      sql = `
        SELECT
          a.name_ar AS account_name,
          SUM(je.debit)  AS debit,
          SUM(je.credit) AS credit,
          SUM(je.debit) - SUM(je.credit) AS balance
        FROM journal_entries je
        JOIN accounts a ON a.id = je.account_id
        ${whereSql}
        GROUP BY je.account_id, a.name_ar
        ORDER BY a.name_ar
      `;
    } else {
      sql = `
        SELECT
          je.id,
          je.journal_date,
          a.name_ar AS account_name,
          je.debit,
          je.credit,
          je.notes,
          (@run := @run + je.debit - je.credit) AS balance
        FROM (SELECT @run := ?) r,
             journal_entries je
        JOIN accounts a ON a.id = je.account_id
        ${whereSql}
        ORDER BY je.journal_date, je.id
      `;
      params.unshift(opening);
    }

    const [rows] = await db.query(sql, params);

    res.json({
      success: true,
      opening_balance: opening,
      list: rows,
    });
  } catch (err) {
    console.error("ACCOUNT STATEMENT ERROR:", err);
    res.status(500).json({ success: false });
  }
});

export default router;
