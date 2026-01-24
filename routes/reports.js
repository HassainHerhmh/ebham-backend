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
        1. تحديد الحسابات
    ========================= */
    let accountIds = [];
    let summaryGroupByParent = false;

    if (account_id) {
      const [rows] = await db.query(`SELECT id FROM accounts WHERE id = ?`, [account_id]);
      accountIds = rows.map(r => r.id);
    } else {
      let mainsSql = `SELECT id FROM accounts WHERE parent_id IS NULL`;
      const mainsParams = [];
      if (!is_admin_branch) {
        mainsSql += ` OR (parent_id IS NOT NULL AND branch_id = ?)`;
        mainsParams.push(branch_id);
      }
      const [mains] = await db.query(mainsSql, mainsParams);
      const mainIds = mains.map(r => r.id);
      if (mainIds.length) {
        const [all] = await db.query(
          `SELECT id FROM accounts WHERE id IN (${mainIds.map(() => "?").join(",")}) OR parent_id IN (${mainIds.map(() => "?").join(",")})`,
          [...mainIds, ...mainIds]
        );
        accountIds = all.map(r => r.id);
        summaryGroupByParent = true;
      }
    }

    if (!accountIds.length) {
      return res.json({ success: true, opening_balance: 0, list: [] });
    }

    // إضافة شروط الحساب والعملة الأساسية
    where.push(`je.account_id IN (${accountIds.map(() => "?").join(",")})`);
    params.push(...accountIds);

    if (currency_id) {
      where.push(`je.currency_id = ?`);
      params.push(currency_id);
    }

    /* =========================
        2. الرصيد الافتتاحي (Opening Balance) لكل عملة
    ========================= */
    let openingBalances = {}; 
    if (from_date) {
      const [ops] = await db.query(
        `SELECT currency_id, ROUND(SUM(debit - credit), 2) AS bal
         FROM journal_entries je
         WHERE je.account_id IN (${accountIds.map(() => "?").join(",")})
         AND je.journal_date < ?
         GROUP BY currency_id`,
        [...accountIds, from_date]
      );
      
      ops.forEach(row => {
        openingBalances[row.currency_id] = parseFloat(row.bal || 0);
      });
    }

    /* =========================
        3. إضافة شروط التاريخ للجلب النهائي للقائمة
    ========================= */
    const finalWhere = [...where];
    const finalParams = [...params];

    if (from_date) { 
      finalWhere.push(`je.journal_date >= ?`); 
      finalParams.push(from_date); 
    }
    if (to_date) { 
      finalWhere.push(`je.journal_date <= ?`); 
      finalParams.push(to_date); 
    }

    const whereSql = `WHERE ${finalWhere.join(" AND ")}`;

    /* =========================
        4. الجلب النهائي
    ========================= */
    let sql;
    if (report_mode === "summary") {
      sql = `SELECT c.id AS currency_id, c.name_ar AS currency_name, 
             ${summaryGroupByParent ? 'p.name_ar' : 'a.name_ar'} AS account_name, 
             ROUND(SUM(je.debit), 2) AS debit, ROUND(SUM(je.credit), 2) AS credit, 
             ROUND(SUM(je.debit) - SUM(je.credit), 2) AS balance 
             FROM journal_entries je 
             JOIN accounts a ON a.id = je.account_id 
             JOIN accounts p ON p.id = COALESCE(a.parent_id, a.id)
             JOIN currencies c ON c.id = je.currency_id ${whereSql} 
             GROUP BY c.id, ${summaryGroupByParent ? 'p.id, p.name_ar' : 'a.id, a.name_ar'} 
             ORDER BY c.name_ar`;
    } else {
      sql = `
        SELECT
          je.id, je.journal_date, je.reference_type, je.reference_id, je.currency_id,
          c.name_ar AS currency_name, a.name_ar AS account_name,
          ROUND(je.debit, 2) AS debit, ROUND(je.credit, 2) AS credit, je.notes
        FROM journal_entries je
        JOIN accounts a ON a.id = je.account_id
        JOIN currencies c ON c.id = je.currency_id
        ${whereSql}
        ORDER BY je.currency_id, je.journal_date ASC, je.id ASC
      `;
    }

    const [rows] = await db.query(sql, finalParams);

    // ✅ حساب الرصيد التراكمي في JavaScript لضمان دقة تعدد العملات
    let runningBalances = { ...openingBalances };
    const listWithBalance = rows.map(row => {
      const curId = row.currency_id;
      if (runningBalances[curId] === undefined) runningBalances[curId] = 0;
      
      runningBalances[curId] = parseFloat((runningBalances[curId] + row.debit - row.credit).toFixed(2));
      
      return {
        ...row,
        balance: runningBalances[curId]
      };
    });

    res.json({
      success: true,
      opening_balance: currency_id ? (openingBalances[currency_id] || 0) : openingBalances,
      list: listWithBalance,
    });

  } catch (err) {
    console.error("ACCOUNT STATEMENT ERROR:", err);
    res.status(500).json({ success: false });
  }
});

export default router;
