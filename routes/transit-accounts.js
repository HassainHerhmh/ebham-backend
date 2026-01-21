import express from "express";
import db from "../db.js";
import auth from "../middlewares/auth.js";

const router = express.Router();
router.use(auth);

/*
GET /settings/transit-accounts
يرجع الإعدادات الحالية
*/
router.get("/", async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT
        commission_income_account,
        courier_commission_account,
        transfer_guarantee_account,
        currency_exchange_account
      FROM settings
      WHERE id = 1
      LIMIT 1
    `);

    res.json({
      success: true,
      data: rows[0] || {},
    });
  } catch (err) {
    console.error("GET TRANSIT SETTINGS ERROR:", err);
    res.status(500).json({ success: false });
  }
});

/*
POST /settings/transit-accounts
يحفظ الإعدادات
*/
router.post("/", async (req, res) => {
  try {
    const {
      commission_income_account,
      courier_commission_account,
      transfer_guarantee_account,
      currency_exchange_account,
    } = req.body;

    await db.query(
      `
      UPDATE settings SET
        commission_income_account = ?,
        courier_commission_account = ?,
        transfer_guarantee_account = ?,
        currency_exchange_account = ?
      WHERE id = 1
      `,
      [
        commission_income_account || null,
        courier_commission_account || null,
        transfer_guarantee_account || null,
        currency_exchange_account || null,
      ]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("SAVE TRANSIT SETTINGS ERROR:", err);
    res.status(500).json({ success: false });
  }
});

export default router;
