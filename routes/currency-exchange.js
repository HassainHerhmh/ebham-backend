// routes/currency-exchange.js
import express from "express";
import db from "../db.js";
import auth from "../middlewares/auth.js";

const router = express.Router();
router.use(auth);

/*
GET /currency-exchange/form-data?type=cash|account
- يرجع العملات كاملة بسعرها وحدودها
- ويرجع الحسابات حسب النوع:
  cash    => الصناديق فقط
  account => الحسابات الفرعية فقط
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

    // الحسابات حسب النوع
    let accountsSql = `
      SELECT id, name_ar
      FROM accounts
      WHERE is_active = 1
    `;

    if (type === "cash") {
      // الصناديق فقط
      accountsSql += ` AND type = 'cash'`;
    } else if (type === "account") {
      // الحسابات الفرعية فقط (غير الرئيسية)
      accountsSql += ` AND parent_id IS NOT NULL`;
    }

    accountsSql += ` ORDER BY name_ar ASC`;

    const [accounts] = await db.query(accountsSql);

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
        convert_mode: c.convert_mode, // multiply | divide
      })),
      accounts,
    });
  } catch (err) {
    console.error("FORM DATA ERROR:", err);
    res.status(500).json({ success: false, message: "خطأ في جلب البيانات" });
  }
});

export default router;
