import express from "express";
import db from "../db.js";
import auth from "../middlewares/auth.js";

const router = express.Router();
router.use(auth);

/*
POST /reports/account-statement
payload:
{
  account_id?: number,        // عند اختيار "حساب واحد" (حساب فرعي)
  currency_id?: number|null,
  from_date?: string|null,
  to_date?: string|null,
  report_mode: "detailed" | "summary"
}
*/

router.post("/account-statement", async (req, res) => {
  try {
    const {
      account_id,     // هنا يمثل "حساب واحد" = فرعي
      currency_id,
      from_date,
      to_date,
      report_mode,
    } = req.body;

    const { branch_id, is_admin_branch } = req.user;

    const where = [];
    const params = [];

    /* =========================
       تحديد نطاق الفروع
    ========================= */
    if (!is_admin_branch) {
      // الفروع العادية ترى بيانات فرعها فقط
      where.push(`je.branch_id = ?`);
      params.push(branch_id);
    }
    // فرع الإدارة: لا نقيّد بالفرع

    /* =========================
       تحديد الحسابات
       - حساب واحد = فرعي
       - كل الحسابات = رئيسي
    ========================= */

    let accountIds = [];
    let summaryGroupByParent = false;
if (account_id) {
  // حساب واحد = حساب فرعي
  if (is_admin_branch) {
    // فرع الإدارة: كل الحسابات الفرعية (من كل الفروع)
    const [rows] = await db.query(
      `SELECT id FROM accounts WHERE parent_id IS NOT NULL`
    );
    accountIds = rows.map(r => r.id);
  } else {
    // فرع عادي: الحساب الفرعي المرتبط بفرعه فقط
    const [rows] = await db.query(
      `SELECT id FROM accounts WHERE id = ? AND branch_id = ?`,
      [account_id, branch_id]
    );
    accountIds = rows.map(r => r.id);
  }
    } else {
      // كل الحسابات = حسابات رئيسية (آباء)
      const [mains] = await db.query(
        `SELECT id FROM accounts WHERE parent_id IS NULL`
      );
      const mainIds = mains.map(r => r.id);

      if (mainIds.length) {
        // نضم الآباء + كل فروعهم للحساب
        const [all] = await db.query(
          `
          SELECT id
          FROM accounts
          WHERE id IN (${mainIds.map(() => "?").join(",")})
             OR parent_id IN (${mainIds.map(() => "?").join(",")})
          `,
          [...mainIds, ...mainIds]
        );

        accountIds = all.map(r => r.id);
        summaryGroupByParent = true;
      }
    }

    if (!accountIds.length) {
      return res.json({ success: true, opening_balance: 0, list: [] });
    }

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

    const whereSql = `WHERE ${where.join(" AND ")}`;

    /* =========================
       الرصيد الافتتاحي
    ========================= */
    let opening = 0;
    if (from_date) {
      const [op] = await db.query(
        `
        SELECT COALESCE(SUM(debit) - SUM(credit), 0) AS bal
        FROM journal_entries
        WHERE ${where
          .filter(w => !w.includes("je.journal_date >="))
          .join(" AND ")}
          AND journal_date < ?
        `,
        [...params.filter((_, i) => !where[i]?.includes("je.journal_date >=")), from_date]
      );

      opening = op[0]?.bal || 0;
    }

    /* =========================
       الجلب
    ========================= */
    let sql;
    let runParams = [...params];

    if (report_mode === "summary") {
      if (summaryGroupByParent) {
        // كل الحسابات = رئيسي (تجميع على الأب)
        sql = `
          SELECT
            p.name_ar AS account_name,
            SUM(je.debit)  AS debit,
            SUM(je.credit) AS credit,
            SUM(je.debit) - SUM(je.credit) AS balance
          FROM journal_entries je
          JOIN accounts a ON a.id = je.account_id
          JOIN accounts p ON p.id = COALESCE(a.parent_id, a.id)
          ${whereSql}
          GROUP BY p.id, p.name_ar
          ORDER BY p.name_ar
        `;
      } else {
        // حساب واحد = فرعي
        sql = `
          SELECT
            a.name_ar AS account_name,
            SUM(je.debit)  AS debit,
            SUM(je.credit) AS credit,
            SUM(je.debit) - SUM(je.credit) AS balance
          FROM journal_entries je
          JOIN accounts a ON a.id = je.account_id
          ${whereSql}
          GROUP BY a.id, a.name_ar
          ORDER BY a.name_ar
        `;
      }
    } else {
      // Detailed
      sql = `
        SELECT
          je.id,
          je.journal_date,
          p.name_ar AS parent_account,
          a.name_ar AS account_name,
          je.debit,
          je.credit,
          je.notes,
          (@run := @run + je.debit - je.credit) AS balance
        FROM (SELECT @run := ?) r,
             journal_entries je
        JOIN accounts a ON a.id = je.account_id
        JOIN accounts p ON p.id = COALESCE(a.parent_id, a.id)
        ${whereSql}
        ORDER BY p.name_ar, a.name_ar, je.journal_date, je.id
      `;
      runParams = [opening, ...params];
    }

    const [rows] = await db.query(sql, runParams);

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
