import express from "express";
import db from "../db.js";
import auth from "../middlewares/auth.js";

const router = express.Router();
router.use(auth);

/* =========================
   GET /customer-guarantees
   جلب المحافظ مع الرصيد
========================= */
router.get("/", async (req, res) => {
  try {
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
          SELECT IFNULL(SUM(je.debit),0) - IFNULL(SUM(je.credit),0)
          FROM journal_entries je
          WHERE je.account_id = cg.account_id
        ), 0)
      ELSE IFNULL(SUM(m.amount_base), 0)
    END AS balance,

    u.name AS created_by_name,
    b.name AS branch_name

  FROM customer_guarantees cg
  LEFT JOIN customers c ON c.id = cg.customer_id
  LEFT JOIN accounts a ON a.id = cg.account_id
  LEFT JOIN customer_guarantee_moves m ON m.guarantee_id = cg.id
  LEFT JOIN users u ON u.id = cg.created_by
  LEFT JOIN branches b ON b.id = cg.branch_id

  GROUP BY cg.id
  ORDER BY cg.id DESC
`);

    res.json({ success: true, list: rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false });
  }
});

/* =========================
   POST /customer-guarantees
   إنشاء حساب تأمين (مرة واحدة) + إضافة مبلغ عند الحاجة
========================= */
router.post("/", async (req, res) => {
  const {
    customer_id,
    type,            // cash | bank | account
    account_id,      // فقط عند type=account
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
    const branchId = req.user.branch_id;

    // هل لدى العميل محفظة مسبقًا؟
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
        [
          customer_id,
          type,
          type === "account" ? account_id : null,
          branchId,
          userId,
        ]
      );
      guaranteeId = r.insertId;
    } else {
      guaranteeId = existing.id;
    }

    // لو حساب مباشر → لا قيود ولا حركات
    if (type === "account") {
      await conn.commit();
      return res.json({ success: true });
    }

    // لو لا يوجد مبلغ → نكتفي بإنشاء المحفظة
    if (!amount) {
      await conn.commit();
      return res.json({ success: true });
    }

    if (!source_id || !currency_id) {
      throw new Error("بيانات الإضافة ناقصة");
    }

    const [[s]] = await conn.query(
      `SELECT customer_guarantee_account FROM settings WHERE id=1 LIMIT 1`
    );
    if (!s?.customer_guarantee_account) {
      throw new Error("لم يتم تحديد حساب وسيط التأمين");
    }

    const baseAmount = Number(amount) * Number(rate || 1);

    const [[baseCur]] = await conn.query(
      `SELECT id FROM currencies WHERE is_local=1 LIMIT 1`
    );

    let sourceAccountId = null;

    if (type === "cash") {
      const [[row]] = await conn.query(
        `SELECT parent_account_id FROM cash_boxes WHERE id=?`,
        [source_id]
      );
      sourceAccountId = row?.parent_account_id;
    } else if (type === "bank") {
      const [[row]] = await conn.query(
        `SELECT parent_account_id FROM banks WHERE id=?`,
        [source_id]
      );
      sourceAccountId = row?.parent_account_id;
    } else {
      throw new Error("نوع التأمين غير مدعوم");
    }

    if (!sourceAccountId) {
      throw new Error("لم يتم العثور على الحساب المصدر");
    }

    // مدين: المصدر
    await conn.query(
      `INSERT INTO journal_entries
       (journal_type_id, journal_date, currency_id, account_id, debit, notes, created_by, branch_id)
       VALUES (?, NOW(), ?, ?, ?, ?, ?, ?)`,
      [
        5,
        baseCur.id,
        sourceAccountId,
        baseAmount,
        `إضافة تأمين للعميل #${customer_id}`,
        userId,
        branchId,
      ]
    );

    // دائن: حساب وسيط التأمين
    await conn.query(
      `INSERT INTO journal_entries
       (journal_type_id, journal_date, currency_id, account_id, credit, notes, created_by, branch_id)
       VALUES (?, NOW(), ?, ?, ?, ?, ?, ?)`,
      [
        5,
        baseCur.id,
        s.customer_guarantee_account,
        baseAmount,
        `إضافة تأمين للعميل #${customer_id}`,
        userId,
        branchId,
      ]
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
    console.error(e);
    res.status(400).json({ success: false, message: e.message });
  } finally {
    conn.release();
  }
});

export default router;
