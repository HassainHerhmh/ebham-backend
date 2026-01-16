import express from "express";
import pool from "../db.js";
import auth from "../middlewares/auth.js";

const router = express.Router();

// حماية كل المسارات
router.use(auth);

/*
  نفترض أن:
  req.user = { id, role, branch_id, is_admin_branch }
*/

/* =========================
   GET /delivery-settings
   جلب إعدادات رسوم التوصيل للفرع الحالي
========================= */
router.get("/", async (req, res) => {
  try {
    const { branch_id } = req.user;

    if (!branch_id) {
      return res.json({});
    }

    const [rows] = await pool.query(
      `
      SELECT method, km_price_single, km_price_multi
      FROM branch_delivery_settings
      WHERE branch_id = ?
      LIMIT 1
      `,
      [branch_id]
    );

    res.json(rows[0] || {});
  } catch (err) {
    console.error("GET DELIVERY SETTINGS ERROR:", err);
    res.status(500).json({ success: false });
  }
});

/* =========================
   POST /delivery-settings
   حفظ الإعدادات للفرع الحالي
========================= */
router.post("/", async (req, res) => {
  try {
    const { branch_id } = req.user;
    const { method, km_price_single, km_price_multi } = req.body;

    if (!branch_id) {
      return res.status(400).json({ success: false });
    }

    await pool.query(
      `
      INSERT INTO branch_delivery_settings
        (branch_id, method, km_price_single, km_price_multi)
      VALUES (?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        method = VALUES(method),
        km_price_single = VALUES(km_price_single),
        km_price_multi = VALUES(km_price_multi)
      `,
      [
        branch_id,
        method,
        km_price_single || null,
        km_price_multi || null,
      ]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("SAVE DELIVERY SETTINGS ERROR:", err);
    res.status(500).json({ success: false });
  }
});

export default router;
