import express from "express";
import db from "../db.js";
import auth from "../middlewares/auth.js";

const router = express.Router();
router.use(auth);

router.post("/account-statement", async (req, res) => {
  try {
    const {
      account_id,
      currency_id,
      from_date,
      to_date,
      report_mode,
    } = req.body;

    const { branch_id, is_admin_branch } = req.user;

    const where = [];
    const params = [];

    /* =========================
       تحديد الحسابات
    ========================= */
    let accountIds = [];
    let summaryGroupByParent = false;

    if (account_id) {
      const [rows] = await db.query(
        `SELECT id FROM accounts WHERE id = ?`,
        [account_id]
      );
      accountIds = rows.map(r => r.id);
    } else {
      let mainsSql = `SELECT id FROM accounts WHERE parent_id IS NULL`;
      const mainsParams = [];

      if (!is_admin_branch) {
        mainsSql = `
          SELECT id FROM accounts
          WHERE parent_id IS NULL
             OR (parent_id IS NOT NULL AND branch_id = ?)
        `;
        mainsParams.push(branch_id);
      }

      const [mains] = await db.query(mainsSql, mainsParams);
      const mainIds = mains.map(r => r.id);

      if (mainIds.length) {
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
      return res.json({ success: true, currencies: [] });
    }

    where.push(`je.account_id IN (${accountIds.map(() => "?").join(",")})`);
    params.push(...accountIds);

    if (from_date) {
      where.push(`je.journal_date >= ?`);
      params.push(from_date);
    }
    if (to_date) {
      where.push(`je.journal_date <= ?`);
      params.push(to_date);
    }

    const baseWhereSql = `WHERE ${where.join(" AND ")}`;

    /* =========================
       في حالة عملة واحدة
    ========================= */
    if (currency_id) {
      const whereOne = [...where, "je.currency_id = ?"];
      const paramsOne = [...params, currency_id];
      const whereSql = `WHERE ${whereOne.join(" AND ")}`;

      let opening = 0;
      if (from_date) {
        const [op] = await db.query(
          `
          SELECT ROUND(COALESCE(SUM(je.debit) - SUM(je.credit), 0), 2) AS bal
          FROM journal_entries je
          ${whereSql}
            AND je.journal_date < ?
          `,
          [...paramsOne, from_date]
        );
        opening = op[0]?.bal || 0;
      }

      let sql;
      let runParams = [...paramsOne];

      if (report_mode === "summary") {
        sql = `
          SELECT
            a.name_ar AS account_name,
            ROUND(SUM(je.debit), 2)  AS debit,
            ROUND(SUM(je.credit), 2) AS credit,
            ROUND(SUM(je.debit) - SUM(je.credit), 2) AS balance
          FROM journal_entries je
          JOIN accounts a ON a.id = je.account_id
          ${whereSql}
          GROUP BY a.id, a.name_ar
          ORDER BY a.name_ar
        `;
      } else {
        sql = `
          SELECT
            je.id,
            je.journal_date,
            a.name_ar AS account_name,
            ROUND(je.debit, 2)  AS debit,
            ROUND(je.credit, 2) AS credit,
            je.notes,
            ROUND(@run := @run + je.debit - je.credit, 2) AS balance
          FROM (SELECT @run := ?) r,
               journal_entries je
          JOIN accounts a ON a.id = je.account_id
          ${whereSql}
          ORDER BY je.journal_date, je.id
        `;
        runParams = [opening, ...paramsOne];
      }

      const [rows] = await db.query(sql, runParams);

      return res.json({
        success: true,
        opening_balance: opening,
        list: rows,
      });
    }

    /* =========================
       حالة كل العملات
    ========================= */
    const [currs] = await db.query(
      `
      SELECT DISTINCT c.id, c.name_ar
      FROM journal_entries je
      JOIN currencies c ON c.id = je.currency_id
      ${baseWhereSql}
      ORDER BY c.name_ar
      `,
      params
    );

    const result = [];

    for (const cur of currs) {
      const whereCur = [...where, "je.currency_id = ?"];
      const paramsCur = [...params, cur.id];
      const whereSql = `WHERE ${whereCur.join(" AND ")}`;

      let opening = 0;
      if (from_date) {
        const [op] = await db.query(
          `
          SELECT ROUND(COALESCE(SUM(je.debit) - SUM(je.credit), 0), 2) AS bal
          FROM journal_entries je
          ${whereSql}
            AND je.journal_date < ?
          `,
          [...paramsCur, from_date]
        );
        opening = op[0]?.bal || 0;
      }

      let sql;
      let runParams = [...paramsCur];

      if (report_mode === "summary") {
        sql = `
          SELECT
            a.name_ar AS account_name,
            ROUND(SUM(je.debit), 2)  AS debit,
            ROUND(SUM(je.credit), 2) AS credit,
            ROUND(SUM(je.debit) - SUM(je.credit), 2) AS balance
          FROM journal_entries je
          JOIN accounts a ON a.id = je.account_id
          ${whereSql}
          GROUP BY a.id, a.name_ar
          ORDER BY a.name_ar
        `;
      } else {
        sql = `
          SELECT
            je.id,
            je.journal_date,
            a.name_ar AS account_name,
            ROUND(je.debit, 2)  AS debit,
            ROUND(je.credit, 2) AS credit,
            je.notes,
            ROUND(@run := @run + je.debit - je.credit, 2) AS balance
          FROM (SELECT @run := ?) r,
               journal_entries je
          JOIN accounts a ON a.id = je.account_id
          ${whereSql}
          ORDER BY je.journal_date, je.id
        `;
        runParams = [opening, ...paramsCur];
      }

      const [rows] = await db.query(sql, runParams);

      if (rows.length || opening !== 0) {
        result.push({
          currency_id: cur.id,
          currency_name: cur.name_ar,
          opening_balance: opening,
          rows,
        });
      }
    }

    res.json({
      success: true,
      currencies: result,
    });
  } catch (err) {
    console.error("ACCOUNT STATEMENT ERROR:", err);
    res.status(500).json({ success: false });
  }
});

export default router;
