// routes/currency-exchange.js
import express from "express";
import db from "../db.js";
import auth from "../middlewares/auth.js";

const router = express.Router();
router.use(auth);

/*
GET /currency-exchange/form-data?type=cash|account
- يرجع العملات كاملة بسعرها وحدودها
- ويرجع العناصر حسب النوع:
  cash    => الصناديق فقط (من cash_boxes)
  account => الحسابات الفرعية فقط (من accounts)
*/
router.get("/form-data", async (req, res) => {
  try {
    const { type } = req.query; // cash | account

    // العملات
    const [currencies] = await db.query(`
      SELECT 
        id,
        name_ar,
        code,
        exchange_rate,
        min_rate,
        max_rate,
        is_local,
        convert_mode
      FROM currencies
      WHERE is_active = 1
      ORDER BY is_local DESC, id ASC
    `);

    let items = [];

    if (type === "cash") {
      // الصناديق
      const [cashBoxes] = await db.query(`
        SELECT id, name AS name_ar
        FROM cash_boxes
        WHERE is_active = 1
        ORDER BY name ASC
      `);
      items = cashBoxes;
    } else if (type === "account") {
      // الحسابات الفرعية فقط
      const [accounts] = await db.query(`
        SELECT id, name_ar
        FROM accounts
        WHERE is_active = 1
          AND parent_id IS NOT NULL
        ORDER BY name_ar ASC
      `);
      items = accounts;
    }

    res.json({
      success: true,
      currencies: currencies.map(c => ({
        id: c.id,
        name_ar: c.name_ar,
        code: c.code,
        rate: Number(c.exchange_rate),
        min_rate: c.min_rate ? Number(c.min_rate) : null,
        max_rate: c.max_rate ? Number(c.max_rate) : null,
        is_local: c.is_local,
        convert_mode: c.convert_mode,
      })),
      items,
    });
  } catch (err) {
    console.error("FORM DATA ERROR:", err);
    res.status(500).json({ success: false, message: "خطأ في جلب البيانات" });
  }
});

/*
POST /currency-exchange
- يستقبل عملية المصارفة
- ينشئ قيدين محاسبيين (مدين / دائن)
*/
router.post("/", async (req, res) => {
  const conn = await db.getConnection();
  try {
    const {
      reference,
      date,
      type,

      from_currency,
      from_amount,
      from_rate,
      from_account,

      to_currency,
      to_amount,
      to_rate,
      to_account,

      customer_name,
      customer_phone,
      notes,
    } = req.body;

    if (
      !reference || !date || !type ||
      !from_currency || !from_amount || !from_rate || !from_account ||
      !to_currency || !to_amount || !to_rate || !to_account
    ) {
      return res.status(400).json({ success: false, message: "بيانات ناقصة" });
    }

    await conn.beginTransaction();

    // سجل العملية الرئيسية
    const [exRes] = await conn.query(
      `INSERT INTO currency_exchanges
      (reference, date, type, customer_name, customer_phone, notes)
      VALUES (?, ?, ?, ?, ?, ?)`,
      [reference, date, type, customer_name || null, customer_phone || null, notes || null]
    );

    const exchangeId = exRes.insertId;

    // القيد المدين (من)
    await conn.query(
      `INSERT INTO journal_entries
      (exchange_id, account_id, currency_id, amount, rate, direction, date, reference)
      VALUES (?, ?, ?, ?, ?, 'debit', ?, ?)`,
      [
        exchangeId,
        from_account,
        from_currency,
        from_amount,
        from_rate,
        date,
        reference,
      ]
    );

    // القيد الدائن (إلى)
    await conn.query(
      `INSERT INTO journal_entries
      (exchange_id, account_id, currency_id, amount, rate, direction, date, reference)
      VALUES (?, ?, ?, ?, ?, 'credit', ?, ?)`,
      [
        exchangeId,
        to_account,
        to_currency,
        to_amount,
        to_rate,
        date,
        reference,
      ]
    );

    await conn.commit();

    res.json({ success: true, id: exchangeId });
  } catch (err) {
    await conn.rollback();
    console.error("CURRENCY EXCHANGE SAVE ERROR:", err);
    res.status(500).json({ success: false, message: "فشل حفظ العملية" });
  } finally {
    conn.release();
  }
});

export default router;
