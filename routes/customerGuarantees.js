import express from "express";
import db from "../db.js";
import auth from "../middlewares/auth.js";

const router = express.Router();
router.use(auth);
/* ==============================================
   🟢 GET /customer-guarantees/:customerId/balance
   جلب رصيد عميل واحد
============================================== */
router.get("/:customerId/balance", async (req, res) => {
  try {
    const { customerId } = req.params;

    const [[row]] = await db.query(`
      SELECT 
        cg.credit_limit,
        IFNULL((
          SELECT SUM(m.amount_base)
          FROM customer_guarantee_moves m
          WHERE m.guarantee_id = cg.id
        ), 0) AS balance
      FROM customer_guarantees cg
      WHERE cg.customer_id = ?
      LIMIT 1
    `, [customerId]);

    if (!row) {
      return res.json({
        success: true,
        balance: 0,
        credit_limit: 0,
        exists: false
      });
    }

    res.json({
      success: true,
      balance: Number(row.balance),
      credit_limit: Number(row.credit_limit || 0),
      exists: true
    });

  } catch (e) {
    console.error("BALANCE ERROR:", e);

    res.status(500).json({
      success: false,
      message: e.message
    });
  }
});

/* ==============================================
    🟢 GET /customer-guarantees
    جلب المحافظ مع الرصيد (مفلترة حسب الفرع)
============================================== */
router.get("/", async (req, res) => {
  try {
    const { is_admin_branch, branch_id: userBranchId } = req.user;
    const headerBranch = req.headers["x-branch-id"];

    let whereClause = "WHERE 1=1 ";
    const params = [];

    // نظام عزل الفروع: الإدارة ترى الكل، الموظف يرى فرعه فقط
    if (is_admin_branch) {
      if (headerBranch) {
        whereClause += " AND cg.branch_id = ? ";
        params.push(headerBranch);
      }
    } else {
      whereClause += " AND cg.branch_id = ? ";
      params.push(userBranchId);
    }

    const [rows] = await db.query(`
      SELECT
        cg.id,
        cg.customer_id,
        c.name AS customer_name,
        cg.type,
        a.name_ar AS account_name,
        CASE 
          WHEN cg.type = 'account' THEN
            IFNULL((
              SELECT SUM(je.debit) - SUM(je.credit)
              FROM journal_entries je
              WHERE je.account_id = cg.account_id
            ), 0)
          ELSE IFNULL((
              SELECT SUM(m.amount_base) 
              FROM customer_guarantee_moves m 
              WHERE m.guarantee_id = cg.id
          ), 0)
        END AS balance,
        u.name AS created_by_name,
        b.name AS branch_name
      FROM customer_guarantees cg
      LEFT JOIN customers c ON c.id = cg.customer_id
      LEFT JOIN accounts a ON a.id = cg.account_id
      LEFT JOIN users u ON u.id = cg.created_by
      LEFT JOIN branches b ON b.id = cg.branch_id
      ${whereClause}
      GROUP BY cg.id
      ORDER BY cg.id DESC
    `, params);

    res.json({ success: true, list: rows });
  } catch (e) {
    console.error("GET GUARANTEES ERROR:", e);
    res.status(500).json({ success: false });
  }
});

/* ==============================================
    ➕ POST /customer-guarantees
    إنشاء محفظة أو إضافة مبلغ مع ربطها بالفرع
============================================== */
router.post("/", async (req, res) => {
  const {
    customer_id,
    type,            // cash | bank | account
    account_id,      // عند type=account
    source_id,       // صندوق أو بنك
    currency_id,
    rate,
    amount,
  } = req.body;

  if (!customer_id || !type) {
    return res.status(400).json({ success: false, message: "بيانات ناقصة" });
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const userId = req.user.id;
    const branchId = req.user.branch_id; // ✅ التثبيت التلقائي لفرع الموظف

    // فحص وجود محفظة سابقة
    const [[existing]] = await conn.query(
      `SELECT id FROM customer_guarantees WHERE customer_id=? LIMIT 1`,
      [customer_id]
    );

    let guaranteeId;
    if (!existing) {
      const [r] = await conn.query(
        `INSERT INTO customer_guarantees
         (customer_id, type, account_id, branch_id, created_by)
         VALUES (?, ?, ?, ?, ?)`,
        [customer_id, type, type === "account" ? account_id : null, branchId, userId]
      );
      guaranteeId = r.insertId;
    } else {
      guaranteeId = existing.id;
    }

    if (type === "account" || !amount) {
      await conn.commit();
      return res.json({ success: true });
    }

    // منطق الإضافة المالية (نقدي/بنكي)
    if (!source_id || !currency_id) throw new Error("بيانات الإضافة المالية ناقصة");

    const [[settings]] = await conn.query(`SELECT customer_guarantee_account FROM settings LIMIT 1`);
    if (!settings?.customer_guarantee_account) throw new Error("حساب وسيط التأمين غير معرف في الإعدادات");

    const baseAmount = Number(amount) * Number(rate || 1);
    const [[baseCur]] = await conn.query(`SELECT id FROM currencies WHERE is_local=1 LIMIT 1`);

    // جلب حساب الصندوق أو البنك التابع للفرع
    let sourceAccountId = null;
    const table = type === "cash" ? "cash_boxes" : "banks";
    const [[row]] = await conn.query(`SELECT parent_account_id FROM ${table} WHERE id=?`, [source_id]);
    sourceAccountId = row?.parent_account_id;

    if (!sourceAccountId) throw new Error("الحساب المصدر غير موجود أو غير مرتبط بشجرة الحسابات");

    // القيد الأول: مدين (الصندوق/البنك)
    await conn.query(
      `INSERT INTO journal_entries
       (journal_type_id, journal_date, currency_id, account_id, debit, notes, created_by, branch_id)
       VALUES (5, NOW(), ?, ?, ?, ?, ?, ?)`,
      [baseCur.id, sourceAccountId, baseAmount, `تأمين عميل #${customer_id}`, userId, branchId]
    );

    // القيد الثاني: دائن (حساب وسيط التأمين)
    await conn.query(
      `INSERT INTO journal_entries
       (journal_type_id, journal_date, currency_id, account_id, credit, notes, created_by, branch_id)
       VALUES (5, NOW(), ?, ?, ?, ?, ?, ?)`,
      [baseCur.id, settings.customer_guarantee_account, baseAmount, `تأمين عميل #${customer_id}`, userId, branchId]
    );

    // تسجيل الحركة في كشف حساب المحفظة
    await conn.query(
      `INSERT INTO customer_guarantee_moves
       (guarantee_id, currency_id, rate, amount, amount_base)
       VALUES (?, ?, ?, ?, ?)`,
      [guaranteeId, currency_id, rate || 1, amount, baseAmount]
    );

    await conn.commit();
    res.json({ success: true });
  } catch (e) {
    await conn.rollback();
    res.status(400).json({ success: false, message: e.message });
  } finally {
    conn.release();
  }
});

export default router;
