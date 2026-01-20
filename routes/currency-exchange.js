// routes/currency-exchange.js
import express from "express";
import db from "../db.js";
import auth from "../middlewares/auth.js";

const router = express.Router();
router.use(auth);

/*
POST /currency-exchange/preview
يعطيك السعر المسموح به للعملة المختارة
*/
router.post("/preview", async (req, res) => {
  const { currency_id } = req.body;

  const [rows] = await db.query(
    `SELECT id, name_ar, rate, min_rate, max_rate
     FROM currencies
     WHERE id = ?`,
    [currency_id]
  );

  if (!rows.length) {
    return res.json({ success: false, message: "عملة غير موجودة" });
  }

  const c = rows[0];

  res.json({
    success: true,
    currency: {
      id: c.id,
      name: c.name_ar,
      rate: Number(c.rate),
      min_rate: c.min_rate ? Number(c.min_rate) : null,
      max_rate: c.max_rate ? Number(c.max_rate) : null,
    },
  });
});

/*
POST /currency-exchange
ينفذ عملية المصارفة ويولد قيود محاسبية
payload:
{
  from_currency_id,
  to_currency_id,
  amount,
  rate,
  from_account_id,
  to_account_id,
  journal_date,
  notes?
}
*/
router.post("/", async (req, res) => {
  const {
    from_currency_id,
    to_currency_id,
    amount,
    rate,
    from_account_id,
    to_account_id,
    journal_date,
    notes,
  } = req.body;

  // تحقق من الحدود
  const [rows] = await db.query(
    `SELECT id, rate, min_rate, max_rate FROM currencies WHERE id = ?`,
    [from_currency_id]
  );

  if (!rows.length) {
    return res.json({ success: false, message: "عملة غير موجودة" });
  }

  const c = rows[0];

  if (c.min_rate && rate < c.min_rate) {
    return res.json({ success: false, message: "السعر أقل من الحد الأدنى" });
  }
  if (c.max_rate && rate > c.max_rate) {
    return res.json({ success: false, message: "السعر أعلى من الحد الأعلى" });
  }

  const converted = Number(amount) * Number(rate);
  const ref = Date.now();

  const base = {
    journal_type_id: 2, // نوع مصارفة
    reference_type: "exchange",
    reference_id: ref,
    journal_date,
    notes: notes || "مصارفة عملة",
  };

  // من الحساب (العملة الأصلية)
  await db.query(
    `INSERT INTO journal_entries
     (journal_type_id, reference_type, reference_id, journal_date, currency_id, account_id, debit, credit, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      base.journal_type_id,
      base.reference_type,
      base.reference_id,
      base.journal_date,
      from_currency_id,
      from_account_id,
      0,
      amount,
      base.notes,
    ]
  );

  // إلى الحساب (العملة المحولة)
  await db.query(
    `INSERT INTO journal_entries
     (journal_type_id, reference_type, reference_id, journal_date, currency_id, account_id, debit, credit, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      base.journal_type_id,
      base.reference_type,
      base.reference_id,
      base.journal_date,
      to_currency_id,
      to_account_id,
      converted,
      0,
      base.notes,
    ]
  );

  res.json({
    success: true,
    converted,
    reference_id: ref,
  });
});

export default router;
