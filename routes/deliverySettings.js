import express from "express";
import pool from "../db.js";
import auth from "../middlewares/auth.js";

const router = express.Router();

// حماية كل المسارات
router.use(auth);

/*
  req.user = { id, role, branch_id, is_admin_branch }
*/

/* =========================
   GET /delivery-settings
   - الفرع العادي: يرجّع إعدادات فرعه فقط
   - الإدارة العامة: يرجّع كل الفروع مع إعداداتها
========================= */
router.get("/", async (req, res) => {
  try {
    const user = req.user;

    // الإدارة العامة
    if (user.is_admin_branch === 1 || user.is_admin_branch === true) {
      const [rows] = await pool.query(`
        SELECT 
          b.id AS branch_id,
          b.name AS branch_name,
          COALESCE(s.method, 'distance') AS method,
          COALESCE(s.km_price_single, 0) AS km_price_single,
          COALESCE(s.km_price_multi, 0) AS km_price_multi,
          COALESCE(s.extra_store_fee, 0) AS extra_store_fee
        FROM branches b
        LEFT JOIN branch_delivery_settings s
          ON s.branch_id = b.id
        WHERE b.is_admin = 0
        ORDER BY b.id ASC
      `);

      return res.json({ success: true, mode: "admin", rows });
    }

    // فرع عادي
    if (!user.branch_id) {
      return res.json({ success: true, mode: "branch", data: null });
    }

    const [rows] = await pool.query(
      `
      SELECT 
        method,
        km_price_single,
        km_price_multi,
        extra_store_fee
      FROM branch_delivery_settings
      WHERE branch_id = ?
      `,
      [user.branch_id]
    );

    return res.json({
      success: true,
      mode: "branch",
      data: rows[0] || {
        method: "distance",
        km_price_single: 0,
        km_price_multi: 0,
        extra_store_fee: 0,
      },
    });
  } catch (err) {
    console.error("GET DELIVERY SETTINGS ERROR:", err);
    res.status(500).json({ success: false });
  }
});

/* =========================
   POST /delivery-settings
   حفظ إعدادات الفرع الحالي فقط
========================= */
router.post("/", async (req, res) => {
  try {
    const user = req.user;

    // الإدارة العامة لا تعدّل من هنا
    if (!user.branch_id || user.is_admin_branch === 1 || user.is_admin_branch === true) {
      return res.status(403).json({ success: false, message: "غير مسموح" });
    }

    const {
      method,
      km_price_single,
      km_price_multi,
      extra_store_fee,
    } = req.body;

    await pool.query(
      `
      INSERT INTO branch_delivery_settings
        (branch_id, method, km_price_single, km_price_multi, extra_store_fee)
      VALUES (?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        method = VALUES(method),
        km_price_single = VALUES(km_price_single),
        km_price_multi = VALUES(km_price_multi),
        extra_store_fee = VALUES(extra_store_fee)
      `,
      [
        user.branch_id,
        method,
        km_price_single || 0,
        km_price_multi || 0,
        extra_store_fee || 0,
      ]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("SAVE DELIVERY SETTINGS ERROR:", err);
    res.status(500).json({ success: false });
  }
});

export default router;
