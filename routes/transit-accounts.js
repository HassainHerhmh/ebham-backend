// routes/settings-transit.js
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

    // إذا ما فيه صف، نرجع قيم فاضية
    res.json({
      success: true,
      data: rows[0] || {
        commission_income_account: null,
        courier_commission_account: null,
        transfer_guarantee_account: null,
        currency_exchange_account: null,
      },
    });
  } catch (err) {
    console.error("GET TRANSIT SETTINGS ERROR:", err);
    res.status(500).json({ success: false });
  }
});

/*
POST /settings/transit-accounts
يحفظ الإعدادات (مع إنشاء السجل إن لم يكن موجودًا)
*/
router.post("/", async (req, res) => {
  try {
    const {
      commission_income_account,
      courier_commission_account,
      transfer_guarantee_account,
      currency_exchange_account,
    } = req.body;

    // نتأكد هل السجل موجود
    const [exists] = await db.query(
      `SELECT id FROM settings WHERE id = 1 LIMIT 1`
    );

    if (exists.length === 0) {
      // إنشاء السجل لأول مرة
      await db.query(
        `
        INSERT INTO settings
        (id, commission_income_account, courier_commission_account, transfer_guarantee_account, currency_exchange_account)
        VALUES (1, ?, ?, ?, ?)
        `,
        [
          commission_income_account || null,
          courier_commission_account || null,
          transfer_guarantee_account || null,
          currency_exchange_account || null,
        ]
      );
    } else {
      // تحديث السجل الموجود
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
    }

    res.json({ success: true });
  } catch (err) {
    console.error("SAVE TRANSIT SETTINGS ERROR:", err);
    res.status(500).json({ success: false });
  }
});

export default router;
