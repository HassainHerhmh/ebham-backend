import express from "express";
import db from "../db.js";
import auth from "../middlewares/auth.js";

const router = express.Router();
router.use(auth);

router.get("/", async (req, res) => {
  try {
    const [raw] = await db.query(`SELECT * FROM customer_guarantees`);
    console.log("RAW customer_guarantees:", raw);

    const [rows] = await db.query(`
      SELECT
        cg.id,
        cg.customer_id,
        c.name AS customer_name,
        cg.type,
        a.name_ar AS account_name,
        IFNULL(SUM(m.amount_base), 0) AS balance
      FROM customer_guarantees cg
      LEFT JOIN customers c ON c.id = cg.customer_id
      LEFT JOIN accounts a ON a.id = cg.account_id
      LEFT JOIN customer_guarantee_moves m ON m.guarantee_id = cg.id
      GROUP BY cg.id
      ORDER BY cg.id DESC
    `);

    console.log("JOIN RESULT:", rows);
    res.json({ success: true, list: rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false });
  }
});


/* =========================
   POST /customer-guarantees
   إنشاء حساب تأمين
========================= */
router.post("/", async (req, res) => {
     console.log("REQ USER =>", req.user);
   
  const { customer_id, type, account_id } = req.body;

  if (!customer_id || !type) {
    return res.status(400).json({ success: false, message: "بيانات ناقصة" });
  }

  await db.query(
    `INSERT INTO customer_guarantees (customer_id, type, account_id)
     VALUES (?, ?, ?)`,
    [customer_id, type, account_id || null]
  );

  res.json({ success: true });
});

/* =========================
   POST /customer-guarantees/add-amount
   إضافة تأمين (نقدي / بنكي)
========================= */
router.post("/add-amount", async (req, res) => {
  const {
    customer_id,
    type,            // cash | bank
    source_id,       // صندوق أو بنك
    currency_id,
    rate,
    amount,
  } = req.body;

  if (!customer_id || !type || !source_id || !currency_id || !amount) {
    return res.status(400).json({ success: false, message: "بيانات ناقصة" });
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // جلب حساب وسيط التأمين من الإعدادات
    const [[s]] = await conn.query(
      `SELECT customer_guarantee_account FROM settings WHERE id=1 LIMIT 1`
    );

    if (!s?.customer_guarantee_account) {
      throw new Error("لم يتم تحديد حساب وسيط التأمين");
    }

    const guaranteeAccountId = s.customer_guarantee_account;

    // جلب محفظة العميل
    const [[g]] = await conn.query(
      `SELECT id FROM customer_guarantees WHERE customer_id=? LIMIT 1`,
      [customer_id]
    );

    if (!g) {
      throw new Error("لا يوجد حساب تأمين للعميل");
    }

    const baseAmount = Number(amount) * Number(rate || 1);

    // إنشاء قيد محاسبي
    const [je] = await conn.query(
      `INSERT INTO journal_entries (date, notes)
       VALUES (NOW(), ?)`,
      [`إضافة تأمين للعميل #${customer_id}`]
    );

    const journalId = je.insertId;

    // طرف المصدر (صندوق أو بنك)
    const sourceAccountId =
      type === "cash"
        ? (await conn.query(`SELECT account_id FROM cash_boxes WHERE id=?`, [source_id]))[0][0].account_id
        : (await conn.query(`SELECT account_id FROM banks WHERE id=?`, [source_id]))[0][0].account_id;

    // دائن: المصدر
    await conn.query(
      `INSERT INTO journal_items (journal_id, account_id, credit)
       VALUES (?, ?, ?)`,
      [journalId, sourceAccountId, baseAmount]
    );

    // مدين: حساب وسيط التأمين
    await conn.query(
      `INSERT INTO journal_items (journal_id, account_id, debit)
       VALUES (?, ?, ?)`,
      [journalId, guaranteeAccountId, baseAmount]
    );

    // تسجيل الحركة في محفظة العميل
    await conn.query(
      `INSERT INTO customer_guarantee_moves
       (guarantee_id, currency_id, rate, amount, amount_base)
       VALUES (?, ?, ?, ?, ?)`,
      [g.id, currency_id, rate || 1, amount, baseAmount]
    );

    await conn.commit();
    res.json({ success: true });
  } catch (e) {
    await conn.rollback();
    console.error(e);
    res.status(500).json({ success: false, message: e.message });
  } finally {
    conn.release();
  }
});

export default router;
