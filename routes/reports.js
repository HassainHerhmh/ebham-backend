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

/////////////////////////////
router.get("/commissions", auth, async (req, res) => {
  try {
    const { from, to, type } = req.query; 
    // type = day | month | range

    const { branch_id, is_admin_branch } = req.user;

    let where = "1=1";
    const params = [];

    // فلترة بالتاريخ
    if (from && to) {
      where += " AND o.created_at BETWEEN ? AND ?";
      params.push(from, to);
    }

    // فلترة الفرع
    if (!is_admin_branch) {
      where += " AND o.branch_id = ?";
      params.push(branch_id);
    }

    const [rows] = await db.query(`
      SELECT

        DATE(o.created_at) AS order_date,

        -- الكابتن
        cap.name AS captain_name,

        -- المطعم
        r.name AS restaurant_name,

        -- الطلب
        o.id AS order_id,

        -- إجمالي الطلب
        o.total_amount,

        -- عمولة المطعم
        SUM(
          CASE 
            WHEN rc.commission_type = 'percent'
            THEN (oi.price * oi.quantity * rc.commission_value / 100)
            ELSE rc.commission_value
          END
        ) AS restaurant_commission,

        -- عمولة الكابتن
        CASE
          WHEN cc.commission_type = 'percent'
          THEN (o.delivery_fee * cc.commission_value / 100)
          ELSE cc.commission_value
        END AS captain_commission


      FROM orders o

      LEFT JOIN captains cap ON cap.id = o.captain_id

      LEFT JOIN order_items oi ON oi.order_id = o.id
      LEFT JOIN restaurants r ON r.id = oi.restaurant_id

      -- عمولة المطعم
      LEFT JOIN commissions rc
        ON rc.account_type = 'agent'
        AND rc.account_id = r.agent_id
        AND rc.is_active = 1

      -- عمولة الكابتن
      LEFT JOIN commissions cc
        ON cc.account_type = 'captain'
        AND cc.account_id = o.captain_id
        AND cc.is_active = 1


      WHERE ${where}

      GROUP BY o.id, r.id

      ORDER BY o.created_at DESC
    `, params);

    res.json({
      success: true,
      list: rows,
    });

  } catch (err) {
    console.error("COMMISSIONS REPORT ERROR:", err);
    res.status(500).json({ success: false });
  }
});
/* =========================================
   📊 احصائيات الكابتن + كشف حساب الشركة
========================================= */
router.get("/captain-stats", auth, async (req, res) => {

  try {

    const { period } = req.query;
    const captain_id = req.user.id;

    let dateFilter = "";

    if(period === "daily"){
      dateFilter = "DATE(o.created_at) = CURDATE()";
    }
    else if(period === "weekly"){
      dateFilter = "YEARWEEK(o.created_at,1)=YEARWEEK(CURDATE(),1)";
    }
    else if(period === "monthly"){
      dateFilter =
      "YEAR(o.created_at)=YEAR(CURDATE()) AND MONTH(o.created_at)=MONTH(CURDATE())";
    }
    else{
      dateFilter = "1=1";
    }

    const [rows] = await db.query(`

      SELECT

        COUNT(o.id) AS total_orders,

        IFNULL(SUM(o.total_amount),0)
        AS company_sales_total,

        IFNULL(SUM(o.delivery_fee),0)
        AS delivery_fees_total,

        IFNULL(SUM(
          CASE
            WHEN cc.commission_type='percent'
            THEN (o.delivery_fee*cc.commission_value/100)
            ELSE cc.commission_value
          END
        ),0)
        AS company_commission_total,

        IFNULL(SUM(
          o.delivery_fee -
          CASE
            WHEN cc.commission_type='percent'
            THEN (o.delivery_fee*cc.commission_value/100)
            ELSE cc.commission_value
          END
        ),0)
        AS captain_profit_total

      FROM orders o

      LEFT JOIN commissions cc
      ON cc.account_type='captain'
      AND cc.account_id=o.captain_id
      AND cc.is_active=1

      WHERE o.captain_id=?
      AND o.status='completed'
      AND ${dateFilter}

    `,[captain_id]);

    const s = rows[0];

    res.json({

      success:true,

      stats:{

        /* ======================
           الكابتن
        ====================== */

        total_orders:
          Number(s.total_orders),

        delivery_fees_total:
          Number(s.delivery_fees_total),

        company_commission_total:
          Number(s.company_commission_total),

        captain_profit_total:
          Number(s.captain_profit_total),

        /* ======================
           الشركة
        ====================== */

        company_sales_total:
          Number(s.company_sales_total),

        company_due_total:
          Number(
            s.company_sales_total +
            s.company_commission_total
          )

      }

    });

  }
  catch(err){

    console.error(err);

    res.status(500).json({
      success:false
    });

  }

});
/* =========================================
   📄 كشف حساب الكابتن (مخصص ونظيف)
========================================= */
router.get("/captain-statement", auth, async (req, res) => {

  try {

    const captain_id = req.user.id;

    const { from_date, to_date } = req.query;

    /* =====================================
       1. الحصول على account_id الخاص بالكابتن
    ===================================== */
    const [[captain]] = await db.query(`
      SELECT account_id
      FROM captains
      WHERE id = ?
    `, [captain_id]);

    if(!captain || !captain.account_id){

      return res.json({
        success:true,
        list:[]
      });

    }

    const captain_account_id = captain.account_id;

    /* =====================================
       2. بناء شرط الفلترة
    ===================================== */
    let where = `
      je.account_id = ?
      AND je.reference_type = 'order'
    `;

    const params = [captain_account_id];

    if(from_date){
      where += " AND je.journal_date >= ?";
      params.push(from_date);
    }

    if(to_date){
      where += " AND je.journal_date <= ?";
      params.push(to_date);
    }

    /* =====================================
       3. جلب القيود الخاصة بالكابتن فقط
    ===================================== */
    const [rows] = await db.query(`

      SELECT

        je.id,

        je.journal_date AS date,

        je.reference_id AS order_id,

        'طلب توصيل' AS document,

        a.name_ar AS account_name,

        ROUND(je.debit,2) AS debit,

        ROUND(je.credit,2) AS credit,

        je.notes

      FROM journal_entries je

      JOIN accounts a
        ON a.id = je.account_id

      WHERE ${where}

      ORDER BY je.journal_date ASC, je.id ASC

    `, params);

    /* =====================================
       4. حساب الرصيد التراكمي
    ===================================== */
    let balance = 0;

    const result = rows.map(row=>{

      const debit = Number(row.debit || 0);
      const credit = Number(row.credit || 0);

      balance += debit - credit;

      return {

        date: row.date,

        document: row.document,

        reference: row.order_id,

        account: row.account_name,

        debit: debit,

        credit: credit,

        balance: Number(balance.toFixed(2)),

        status:
          balance > 0
          ? "عليه"
          : "له",

        notes: row.notes

      };

    });

    /* =====================================
       5. ارسال النتيجة
    ===================================== */
    res.json({
      success:true,
      list: result
    });

  }
  catch(err){

    console.error("CAPTAIN STATEMENT ERROR:", err);

    res.status(500).json({
      success:false
    });

  }

});
export default router;
