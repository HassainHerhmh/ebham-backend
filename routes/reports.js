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

    where.push(`je.account_id IN (${accountIds.map(() => "?").join(",")})`);
    params.push(...accountIds);

    if (currency_id) {
      where.push(`je.currency_id = ?`);
      params.push(currency_id);
    }

    /* =========================
        2. حساب الأرصدة الافتتاحية بدقة
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
        // التأكد من تحويل القيمة لرقم لمنع التضخم النصي
        openingBalances[row.currency_id] = Number(row.bal || 0);
      });
    }

    /* =========================
        3. الجلب النهائي للقائمة
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

    let sql;
    if (report_mode === "summary") {
      sql = `SELECT c.id AS currency_id, c.name_ar AS currency_name, 
             ${summaryGroupByParent ? 'p.name_ar' : 'a.name_ar'} AS account_name, 
             ROUND(SUM(je.debit), 2) AS debit, ROUND(SUM(je.credit), 2) AS credit, 
             ROUND(SUM(je.debit) - SUM(je.credit), 2) AS balance 
             FROM journal_entries je 
             JOIN accounts a ON a.id = je.account_id 
             JOIN accounts p ON p.id = COALESCE(a.parent_id, a.id)
             JOIN currencies c ON c.id = je.currency_id 
             WHERE ${finalWhere.join(" AND ")}
             GROUP BY c.id, ${summaryGroupByParent ? 'p.id, p.name_ar' : 'a.id, a.name_ar'} 
             ORDER BY c.name_ar`;
    } else {
      sql = `
        SELECT
          je.id, je.journal_date, je.reference_type, je.reference_id, je.currency_id,
          c.name_ar AS currency_name, a.name_ar AS account_name,
          je.debit, je.credit, je.notes
        FROM journal_entries je
        JOIN accounts a ON a.id = je.account_id
        JOIN currencies c ON c.id = je.currency_id
        WHERE ${finalWhere.join(" AND ")}
        ORDER BY je.currency_id, je.journal_date ASC, je.id ASC
      `;
    }

    const [rows] = await db.query(sql, finalParams);

  /* =========================
        4. المعالجة الحسابية ومنع التكرار
    ========================= */
    let finalRows = [];
    let runningBalances = { ...openingBalances };
    let processedCurrencies = new Set();

    rows.forEach(row => {
      const curId = row.currency_id;
      const debit = Number(row.debit || 0);
      const credit = Number(row.credit || 0);

      // إضافة سطر الرصيد السابق لمرة واحدة فقط لكل عملة وبشرط ألا يكون صفراً
      if (!processedCurrencies.has(curId)) {
        const startBal = Number(openingBalances[curId] || 0);
        if (startBal !== 0) {
          finalRows.push({
            id: 'op-' + curId,
            journal_date: from_date || row.journal_date,
            notes: 'رصيد سابق',
            account_name: 'رصيد سابق',
            currency_name: row.currency_name,
            debit: 0,
            credit: 0,
            balance: startBal,
            is_opening: true
          });
        }
        processedCurrencies.add(curId);
      }

      // الحساب التراكمي الدقيق (منع تضخم الأرقام)
      if (runningBalances[curId] === undefined) runningBalances[curId] = 0;
      
      const currentBalance = Number(runningBalances[curId]) + debit - credit;
      runningBalances[curId] = Number(currentBalance.toFixed(2));
      
      finalRows.push({
        ...row,
        debit: debit,
        credit: credit,
        balance: runningBalances[curId]
      });
    });

    res.json({
      success: true,
      opening_balance: currency_id ? (openingBalances[currency_id] || 0) : openingBalances,
      list: finalRows,
    });

  } catch (err) {
    console.error("ACCOUNT STATEMENT ERROR:", err);
    res.status(500).json({ success: false });
  }
});

export default router;
