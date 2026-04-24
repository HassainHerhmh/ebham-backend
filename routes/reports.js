
import express from "express";
import db from "../db.js";
import auth from "../middlewares/auth.js";
import { generateAccountStatementPDF } from "../utils/accountStatementPdf.js";
import fs from "fs";
import os from "os";
import path from "path";

const router = express.Router();
router.use(auth);

// راوت توليد وتحميل كشف الحساب PDF
router.post("/account-statement/pdf", async (req, res) => {
  try {
    // نفس منطق جلب البيانات من راوت /account-statement
    const {
      account_id,
      currency_id,
      from_date,
      to_date,
      report_mode,
      detailed_type,
    } = req.body;

    const { branch_id, is_admin_branch } = req.user;
    // ... (نفس منطق جلب البيانات)
    // لإعادة استخدام الكود، نستدعي راوت الحساب ونأخذ list فقط
    // أو نعيد كتابة المنطق هنا (اختصارًا سنستخدم استدعاء داخلي)

    // استدعاء داخلي للراوت الحالي لجلب البيانات
    const fetch = require("node-fetch");
    const baseUrl = req.protocol + '://' + req.get('host');
    const apiRes = await fetch(baseUrl + "/api/reports/account-statement", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "cookie": req.headers.cookie || ""
      },
      body: JSON.stringify(req.body)
    });
    const json = await apiRes.json();
    if (!json.success) return res.status(400).json({ success: false, message: "فشل جلب البيانات" });
    const list = json.list || [];

    // توليد ملف PDF مؤقت
    const tmpPath = path.join(os.tmpdir(), `account-statement-${Date.now()}.pdf`);
    await new Promise((resolve) => {
      generateAccountStatementPDF(list, tmpPath, { customerName: req.body.customer_name || "" });
      // انتظر حتى يتم إنشاء الملف
      setTimeout(resolve, 700); // pdfkit يحتاج وقت بسيط
    });

    // إرسال الملف للتحميل
    res.download(tmpPath, "كشف-حساب.pdf", (err) => {
      fs.unlink(tmpPath, () => {}); // حذف الملف المؤقت بعد التحميل
    });
  } catch (err) {
    console.error("ACCOUNT STATEMENT PDF ERROR:", err);
    res.status(500).json({ success: false });
  }
});


router.post("/account-statement", async (req, res) => {
  try {
    const {
      account_id,
      currency_id,
      from_date,
      to_date,
      report_mode,
      detailed_type,
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
      const [rows] = await db.query(
        `SELECT id FROM accounts WHERE id = ?`,
        [account_id]
      );
      accountIds = rows.map((r) => r.id);
    } else {
      let mainsSql = `SELECT id FROM accounts WHERE parent_id IS NULL`;
      const mainsParams = [];

      if (!is_admin_branch) {
        mainsSql += ` OR (parent_id IS NOT NULL AND branch_id = ?)`;
        mainsParams.push(branch_id);
      }

      const [mains] = await db.query(mainsSql, mainsParams);
      const mainIds = mains.map((r) => r.id);

      if (mainIds.length) {
        const [all] = await db.query(
          `SELECT id
           FROM accounts
           WHERE id IN (${mainIds.map(() => "?").join(",")})
              OR parent_id IN (${mainIds.map(() => "?").join(",")})`,
          [...mainIds, ...mainIds]
        );

        accountIds = all.map((r) => r.id);
        summaryGroupByParent = true;
      }
    }

    if (!accountIds.length) {
      return res.json({
        success: true,
        opening_balance: currency_id ? 0 : {},
        list: [],
      });
    }

    where.push(`je.account_id IN (${accountIds.map(() => "?").join(",")})`);
    params.push(...accountIds);

    if (currency_id) {
      where.push(`je.currency_id = ?`);
      params.push(currency_id);
    }

    /* =========================
       2. حساب الرصيد السابق
       fix:
       - DATE(je.journal_date) < DATE(?)
       - توحيد مفاتيح العملات كنص
    ========================= */
    const openingBalances = {};

    if (from_date) {
      const openingSql = `
        SELECT
          CAST(je.currency_id AS CHAR) AS currency_id,
          ROUND(
            IFNULL(SUM(IFNULL(je.credit, 0) - IFNULL(je.debit, 0)), 0),
            2
          ) AS bal
        FROM journal_entries je
        WHERE je.account_id IN (${accountIds.map(() => "?").join(",")})
          ${currency_id ? "AND je.currency_id = ?" : ""}
          AND DATE(je.journal_date) < DATE(?)
        GROUP BY je.currency_id
      `;

      const openingParams = currency_id
        ? [...accountIds, currency_id, from_date]
        : [...accountIds, from_date];

      const [ops] = await db.query(openingSql, openingParams);

      ops.forEach((row) => {
        openingBalances[String(row.currency_id)] = Number(row.bal || 0);
      });
    }

    /* =========================
       3. بناء الفلترة النهائية
    ========================= */
    const finalWhere = [...where];
    const finalParams = [...params];

    if (from_date) {
      finalWhere.push(`DATE(je.journal_date) >= DATE(?)`);
      finalParams.push(from_date);
    }

    if (to_date) {
      finalWhere.push(`DATE(je.journal_date) <= DATE(?)`);
      finalParams.push(to_date);
    }

    if (report_mode !== "summary") {
      finalWhere.push(`IFNULL(je.reference_type, '') NOT IN ('opening', 'opening_balance')`);
    }

    let sql;

    if (report_mode === "summary") {
      sql = `
        SELECT
          c.id AS currency_id,
          c.name_ar AS currency_name,
          ${summaryGroupByParent ? "p.name_ar" : "a.name_ar"} AS account_name,
          ROUND(SUM(IFNULL(je.debit, 0)), 2) AS debit,
          ROUND(SUM(IFNULL(je.credit, 0)), 2) AS credit,
          ROUND(SUM(IFNULL(je.credit, 0)) - SUM(IFNULL(je.debit, 0)), 2) AS balance
        FROM journal_entries je
        JOIN accounts a ON a.id = je.account_id
        JOIN accounts p ON p.id = COALESCE(a.parent_id, a.id)
        JOIN currencies c ON c.id = je.currency_id
        WHERE ${finalWhere.join(" AND ")}
        GROUP BY c.id, ${summaryGroupByParent ? "p.id, p.name_ar" : "a.id, a.name_ar"}
        ORDER BY c.name_ar
      `;
    } else {
      sql = `
        SELECT
          je.id,
          je.journal_date,
          je.reference_type,
          je.reference_id,
          je.currency_id,
          c.name_ar AS currency_name,
          a.name_ar AS account_name,
          ROUND(IFNULL(je.debit, 0), 2) AS debit,
          ROUND(IFNULL(je.credit, 0), 2) AS credit,
          je.notes
        FROM journal_entries je
        JOIN accounts a ON a.id = je.account_id
        JOIN currencies c ON c.id = je.currency_id
        WHERE ${finalWhere.join(" AND ")}
        ORDER BY je.currency_id ASC, je.journal_date ASC, je.id ASC
      `;
    }

    const [rows] = await db.query(sql, finalParams);

    if (report_mode === "summary") {
      return res.json({
        success: true,
        opening_balance: currency_id
          ? (openingBalances[String(currency_id)] || 0)
          : openingBalances,
        list: rows,
      });
    }

    /* =========================
       4. العملات المعروضة
    ========================= */
    const displayCurrencyIds = Array.from(
      new Set([
        ...(currency_id ? [String(currency_id)] : []),
        ...Object.keys(openingBalances),
        ...rows.map((row) => String(row.currency_id)),
      ])
    );

    const currencyNames = {};

    if (displayCurrencyIds.length) {
      const [currencyRows] = await db.query(
        `SELECT id, name_ar
         FROM currencies
         WHERE id IN (${displayCurrencyIds.map(() => "?").join(",")})`,
        displayCurrencyIds
      );

      currencyRows.forEach((row) => {
        currencyNames[String(row.id)] = row.name_ar;
      });
    }

    const rowsByCurrency = new Map();

    rows.forEach((row) => {
      const curId = String(row.currency_id);

      if (!rowsByCurrency.has(curId)) {
        rowsByCurrency.set(curId, []);
      }

      rowsByCurrency.get(curId).push(row);
    });

    /* =========================
       5. تجهيز النتيجة النهائية
    ========================= */
    const finalRows = [];

    displayCurrencyIds.forEach((curId) => {
      const currencyRows = rowsByCurrency.get(curId) || [];
      let runningBalance = Number(openingBalances[curId] || 0);

      if (detailed_type !== "no_open" && runningBalance !== 0) {
        finalRows.push({
        id: `op-${curId}`,
        journal_date: from_date || "",
        reference_id: "",
        reference_type: "opening_balance",
        notes: "رصيد سابق",
        account_name: "رصيد سابق",
        currency_id: curId,
        currency_name: currencyNames[curId] || "",
        debit: runningBalance < 0 ? Math.abs(runningBalance) : 0,
        credit: runningBalance > 0 ? Math.abs(runningBalance) : 0,
        balance: Number(runningBalance.toFixed(2)),
        is_opening: true,
        });
      }

      currencyRows.forEach((row) => {
        const debit = Number(row.debit || 0);
        const credit = Number(row.credit || 0);

        runningBalance = Number((runningBalance + credit - debit).toFixed(2));

        finalRows.push({
          ...row,
          debit,
          credit,
          balance: runningBalance,
        });
      });
    });

    res.json({
      success: true,
      opening_balance: currency_id
        ? (openingBalances[String(currency_id)] || 0)
        : openingBalances,
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
   📊 احصائيات الكابتن + كشف حساب الشركة (مصحح نهائي)
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
      dateFilter =
      "YEARWEEK(o.created_at,1)=YEARWEEK(CURDATE(),1)";
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


        /* ======================
           إجمالي المبيعات الكامل
        ====================== */
        IFNULL(SUM(o.total_amount),0)
        AS company_sales_total,


        /* ======================
           إجمالي رسوم التوصيل
        ====================== */
        IFNULL(SUM(
          IFNULL(o.delivery_fee,0)
          +
          IFNULL(o.extra_store_fee,0)
        ),0)
        AS delivery_fees_total,


        /* ======================
           إجمالي الفواتير فقط (بدون رسوم التوصيل)
        ====================== */
        IFNULL(SUM(
          o.total_amount
          -
          IFNULL(o.delivery_fee,0)
          -
          IFNULL(o.extra_store_fee,0)
        ),0)
        AS invoices_total,


        /* ======================
           عمولة الشركة
        ====================== */
        IFNULL(SUM(

          CASE

            WHEN cc.commission_type='percent'
            THEN (
              (
                IFNULL(o.delivery_fee,0)
                +
                IFNULL(o.extra_store_fee,0)
              )
              *
              cc.commission_value
              /100
            )

            ELSE cc.commission_value

          END

        ),0)
        AS company_commission_total,


        /* ======================
           ربح الكابتن
        ====================== */
        IFNULL(SUM(

          (
            IFNULL(o.delivery_fee,0)
            +
            IFNULL(o.extra_store_fee,0)
          )

          -

          CASE

            WHEN cc.commission_type='percent'
            THEN (
              (
                IFNULL(o.delivery_fee,0)
                +
                IFNULL(o.extra_store_fee,0)
              )
              *
              cc.commission_value
              /100
            )

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

    const company_sales_total =
      Number(s.company_sales_total || 0);

    const invoices_total =
      Number(s.invoices_total || 0);

    const company_commission_total =
      Number(s.company_commission_total || 0);

    /* ✅ الصحيح */
    const company_due_total =
      invoices_total +
      company_commission_total;


    res.json({

      success:true,

      stats:{

        /* ======================
           الكابتن
        ====================== */

        total_orders:
          Number(s.total_orders || 0),

        delivery_fees_total:
          Number(s.delivery_fees_total || 0),

        company_commission_total:
          company_commission_total,

        captain_profit_total:
          Number(s.captain_profit_total || 0),


        /* ======================
           الشركة
        ====================== */

        company_sales_total:
          company_sales_total,

        company_due_total:
          Number(company_due_total.toFixed(2))

      }

    });

  }
  catch(err){

    console.error("CAPTAIN STATS ERROR:", err);

    res.status(500).json({
      success:false
    });

  }

});
/* =========================================
   📄 كشف حساب الكابتن (احترافي + رصيد سابق + إجماليات)
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

    if (!captain || !captain.account_id) {

      return res.json({
        success: true,
        opening_balance: 0,
        totals: {
          debit: 0,
          credit: 0,
          balance: 0
        },
        list: []
      });

    }

    const account_id = captain.account_id;

    /* =====================================
       2. حساب الرصيد السابق
    ===================================== */
    let opening_balance = 0;

    if (from_date) {

      const [[opening]] = await db.query(`
        SELECT
          ROUND(IFNULL(SUM(debit - credit),0),2) AS balance
        FROM journal_entries
        WHERE account_id = ?
        AND journal_date < ?
      `, [account_id, from_date]);

      opening_balance = Number(opening.balance || 0);

    }

    /* =====================================
       3. بناء شرط الفلترة
    ===================================== */
    let where = `
      je.account_id = ?
      AND je.reference_type = 'order'
    `;

    const params = [account_id];

    if (from_date) {
      where += " AND DATE(je.journal_date) >= ?";
      params.push(from_date);
    }

    if (to_date) {
      where += " AND DATE(je.journal_date) <= ?";
      params.push(to_date);
    }

    /* =====================================
       4. جلب القيود الخاصة بالكابتن فقط
    ===================================== */
    const [rows] = await db.query(`
      SELECT
        je.id,
        DATE(je.journal_date) AS date,
        je.reference_id AS order_id,
        ROUND(IFNULL(je.debit,0),2) AS debit,
        ROUND(IFNULL(je.credit,0),2) AS credit,
        je.notes
      FROM journal_entries je
      WHERE ${where}
      ORDER BY je.journal_date ASC, je.id ASC
    `, params);

    /* =====================================
       5. تجهيز النتائج
    ===================================== */
    let balance = opening_balance;

    let total_debit = 0;
    let total_credit = 0;

    const list = [];

    /* =====================================
       إضافة الرصيد السابق
    ===================================== */
    list.push({

      date: from_date || null,

      document: "رصيد سابق",

      reference: "",

      account: "حساب الكابتن",

      debit: opening_balance > 0 ? opening_balance : 0,

      credit: opening_balance < 0 ? Math.abs(opening_balance) : 0,

      balance: Number(balance.toFixed(2)),

      status: balance > 0 ? "عليه" : "له",

      notes: ""

    });

    /* =====================================
       إضافة القيود
    ===================================== */
    rows.forEach(row => {

      const debit = Number(row.debit);
      const credit = Number(row.credit);

      total_debit += debit;
      total_credit += credit;

      balance += debit - credit;

      list.push({

        date: row.date,

        document: "طلب توصيل",

        reference: row.order_id,

        account: "حساب الكابتن",

        debit: debit,

        credit: credit,

        balance: Number(balance.toFixed(2)),

        status: balance > 0 ? "عليه" : "له",

        notes: row.notes || ""

      });

    });

    /* =====================================
       6. الإجماليات النهائية
    ===================================== */
    const final_balance = opening_balance + total_debit - total_credit;

    /* =====================================
       7. إرسال النتيجة
    ===================================== */
    res.json({

      success: true,

      opening_balance: Number(opening_balance.toFixed(2)),

      totals: {

        debit: Number(total_debit.toFixed(2)),

        credit: Number(total_credit.toFixed(2)),

        balance: Number(final_balance.toFixed(2)),

        status: final_balance > 0 ? "عليه" : "له"

      },

      list: list

    });

  }
  catch (err) {

    console.error("CAPTAIN STATEMENT ERROR:", err);

    res.status(500).json({
      success: false
    });

  }

});
export default router;
