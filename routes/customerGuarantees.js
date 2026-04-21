import express from "express";
import db from "../db.js";
import auth from "../middlewares/auth.js";

const router = express.Router();

let cashBoxAccountColumnChecked = false;

async function ensureCashBoxAccountColumn() {
  if (cashBoxAccountColumnChecked) return;

  try {
    await db.query(
      "ALTER TABLE cash_boxes ADD COLUMN account_id INT NULL AFTER parent_account_id"
    );
  } catch (err) {
    if (err?.code !== "ER_DUP_FIELDNAME") {
      throw err;
    }
  }

  cashBoxAccountColumnChecked = true;
}

/* ==============================================
   🟢 GET /customer-guarantees/:customerId/balance
   جلب رصيد عميل واحد (يستخدم في صفحة إضافة طلب)
   المنطق المحاسبي: (الدائن - المدين) ليظهر الرصيد موجباً إذا كان "له"
============================================== */
router.get("/:customerId/balance", async (req, res) => {
  try {
    const { customerId } = req.params;

    const [[row]] = await db.query(`
      SELECT 
        cg.id,
        cg.type,
        cg.account_id,
        cg.credit_limit,
        CASE 
          WHEN cg.type = 'account' THEN
            IFNULL((
              SELECT SUM(je.credit) - SUM(je.debit) -- ✅ منطق الدائن - المدين
              FROM journal_entries je
              WHERE je.account_id = cg.account_id
            ), 0)
          ELSE
            IFNULL((
              SELECT SUM(m.amount_base)
              FROM customer_guarantee_moves m
              WHERE m.guarantee_id = cg.id
            ), 0)
        END AS balance
      FROM customer_guarantees cg
      WHERE cg.customer_id = ?
      LIMIT 1
    `, [customerId]);

    if (!row) {
      return res.json({
        success: true,
        balance: 0,
        credit_limit: 0,
        remaining: 0,
        exists: false
      });
    }

    const currentBalance = Number(row.balance || 0);
    const limit = Number(row.credit_limit || 0);
    // المتاح الكلي = الرصيد الحالي (الدائن) + سقف الائتمان المسموح به
    const available = currentBalance + limit;

    res.json({
      success: true,
      balance: currentBalance, 
      credit_limit: limit,
      remaining: available,
      exists: true
    });

  } catch (e) {
    res.status(500).json({
      success: false,
      message: e.message
    });
  }
});

///////////////////////////////
router.use(auth);

/* ==============================================
    🟢 GET /customer-guarantees
    جلب المحافظ مع الرصيد المباشر (لجدول محفظة التأمينات)
============================================== */
router.get("/", async (req, res) => {
  try {
    const { is_admin_branch, branch_id: userBranchId } = req.user;
    const headerBranch = req.headers["x-branch-id"];

    let whereClause = "WHERE 1=1 ";
    const params = [];

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
              SELECT SUM(je.credit) - SUM(je.debit) -- ✅ منطق الدائن - المدين
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
    إنشاء محفظة أو إضافة مبلغ
============================================== */
router.post("/", async (req, res) => {
  const {
    customer_id,
    type,            
    account_id,      
    source_id,       
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
    const branchId = req.user.branch_id;

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
      await conn.query(
        `UPDATE customer_guarantees SET type=?, account_id=? WHERE id=?`,
        [type, type === "account" ? account_id : null, guaranteeId]
      );
    }

    if (type === "account" || !amount) {
      await conn.commit();
      return res.json({ success: true });
    }

    if (!source_id || !currency_id) throw new Error("بيانات الإضافة المالية ناقصة");

    const [[settings]] = await conn.query(`SELECT customer_guarantee_account FROM settings LIMIT 1`);
    if (!settings?.customer_guarantee_account) throw new Error("حساب وسيط التأمين غير معرف في الإعدادات");

    const baseAmount = Number(amount) * Number(rate || 1);
    const [[baseCur]] = await conn.query(`SELECT id FROM currencies WHERE is_local=1 LIMIT 1`);

    let sourceAccountId = null;
    const table = type === "cash" ? "cash_boxes" : "banks";

    if (type === "cash") {
      await ensureCashBoxAccountColumn();
      const [[row]] = await conn.query(
        "SELECT COALESCE(account_id, parent_account_id) AS account_id FROM cash_boxes WHERE id=?",
        [source_id]
      );
      sourceAccountId = row?.account_id;
    } else {
      const [[row]] = await conn.query(`SELECT parent_account_id FROM ${table} WHERE id=?`, [source_id]);
      sourceAccountId = row?.parent_account_id;
    }

    if (!sourceAccountId) throw new Error("الحساب المصدر غير موجود أو غير مرتبط بشجرة الحسابات");

    await conn.query(
      `INSERT INTO journal_entries
       (journal_type_id, journal_date, currency_id, account_id, debit, notes, created_by, branch_id)
       VALUES (5, NOW(), ?, ?, ?, ?, ?, ?)`,
      [baseCur.id, sourceAccountId, baseAmount, `تأمين عميل #${customer_id}`, userId, branchId]
    );

    await conn.query(
      `INSERT INTO journal_entries
       (journal_type_id, journal_date, currency_id, account_id, credit, notes, created_by, branch_id)
       VALUES (5, NOW(), ?, ?, ?, ?, ?, ?)`,
      [baseCur.id, settings.customer_guarantee_account, baseAmount, `تأمين عميل #${customer_id}`, userId, branchId]
    );

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

/////////////////////
router.get("/wallet/:customerId", async (req, res) => {
  try {
    const { customerId } = req.params;

    // 1. جلب المحفظة
    const [[g]] = await db.query(
      "SELECT * FROM customer_guarantees WHERE customer_id=? LIMIT 1",
      [customerId]
    );

    if (!g) {
      return res.json({ success: true, balance: 0, logs: [] });
    }

    // 2. الرصيد
    const [[balanceRow]] = await db.query(`
      SELECT 
        IFNULL(SUM(amount_base), 0) as balance
      FROM customer_guarantee_moves
      WHERE guarantee_id=?
    `, [g.id]);

    // 3. العمليات
    const [logs] = await db.query(`
      SELECT 
        m.amount_base as amount,
        m.created_at,
        'credit' as type,
        CONCAT('عملية تحويل من نقاط الولاء إلى المحفظة') as description
      FROM customer_guarantee_moves m
      WHERE m.guarantee_id=?
      ORDER BY m.id DESC
    `, [g.id]);

    res.json({
      success: true,
      balance: balanceRow.balance || 0,
      logs
    });

  } catch (err) {
    console.error(err);
    res.json({ success: false });
  }
});
export default router;
