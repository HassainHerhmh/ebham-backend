import express from "express";
import db from "../db.js";

const router = express.Router();


// =============================
// دالة حساب النقاط
// =============================
async function calculatePoints(amount) {
  const [rows] = await db.query("SELECT * FROM loyalty_settings LIMIT 1");

  const settings = rows[0] || { amount_per_point: 100 };

  const rate = Number(settings.amount_per_point) || 100;

  return Math.floor(Number(amount) / rate);
}


// =============================
// إضافة نقاط بعد اكتمال الطلب
// =============================
export async function addPointsAfterOrder(order) {

  try {

    // 🚫 منع التكرار (مهم جدًا)
    const [[exists]] = await db.query(
      "SELECT id FROM loyalty_logs WHERE order_id=? LIMIT 1",
      [order.id]
    );

    if (exists) {
      console.log("⚠️ Loyalty already added:", order.id);
      return;
    }

    const points = await calculatePoints(order.total_amount);

    if (points <= 0) return;

    // هل عنده حساب؟
    const [rows] = await db.query(
      "SELECT * FROM loyalty_points WHERE user_id=?",
      [order.customer_id]
    );

    if (rows.length === 0) {
      await db.query(
        "INSERT INTO loyalty_points (user_id, points, total_spent) VALUES (?, ?, ?)",
        [order.customer_id, points, order.total_amount]
      );
    } else {
      await db.query(
        "UPDATE loyalty_points SET points = points + ?, total_spent = total_spent + ? WHERE user_id=?",
        [points, order.total_amount, order.customer_id]
      );
    }

    // تسجيل الحركة
    await db.query(
      "INSERT INTO loyalty_logs (user_id, order_id, points, amount, type) VALUES (?, ?, ?, ?, ?)",
      [order.customer_id, order.id, points, order.total_amount, "earn"]
    );

    console.log("✅ Points added:", points);

  } catch (err) {
    console.error("❌ LOYALTY ERROR:", err);
  }

}


// =============================
// تقرير Admin (الحركات)
// =============================
router.get("/admin/loyalty-logs", async (req, res) => {
  try {

    const [rows] = await db.query(`
      SELECT 
        l.id,
        l.points,
        l.amount,
        l.type,
        l.created_at,
        c.name,
        c.phone
      FROM loyalty_logs l
      JOIN customers c ON c.id = l.user_id
      ORDER BY l.id DESC
    `);

    res.json({ success: true, data: rows });

  } catch (err) {
    console.error(err);
    res.json({ success: false });
  }
});


// =============================
// رصيد المستخدم
// =============================
router.get("/loyalty/:userId", async (req, res) => {

  try {

    const [rows] = await db.query(
      "SELECT * FROM loyalty_points WHERE user_id=?",
      [req.params.userId]
    );

    res.json({
      success: true,
      data: rows[0] || { points: 0, total_spent: 0 }
    });

  } catch (err) {
    console.error(err);
    res.json({ success: false });
  }

});


// =============================
// سجل المستخدم
// =============================
router.get("/loyalty/:userId/logs", async (req, res) => {

  try {

    const [rows] = await db.query(
      "SELECT * FROM loyalty_logs WHERE user_id=? ORDER BY id DESC",
      [req.params.userId]
    );

    res.json({ success: true, data: rows });

  } catch (err) {
    console.error(err);
    res.json({ success: false });
  }

});


// =============================
// الإعدادات
// =============================

// جلب
router.get("/settings", async (req, res) => {
  try {
    const [rows] = await db.query(
      "SELECT * FROM loyalty_settings LIMIT 1"
    );

    res.json(rows[0] || { amount_per_point: 100, point_value: 1 });

  } catch (err) {
    console.error(err);
    res.json({ success: false });
  }
});

// تعديل
router.put("/settings", async (req, res) => {
  try {

    let { amount_per_point, point_value } = req.body;

    amount_per_point = Number(amount_per_point);
    point_value = Number(point_value);

    // 🚫 حماية
    if (!amount_per_point || amount_per_point <= 0) {
      return res.json({
        success: false,
        message: "amount_per_point لازم يكون أكبر من صفر"
      });
    }

    await db.query(`
      INSERT INTO loyalty_settings (id, amount_per_point, point_value)
      VALUES (1, ?, ?)
      ON DUPLICATE KEY UPDATE
      amount_per_point=?, point_value=?
    `, [amount_per_point, point_value, amount_per_point, point_value]);

    res.json({ success: true });

  } catch (err) {
    console.error(err);
    res.json({ success: false });
  }
});

router.get("/my-points", async (req, res) => {
  try {
    const userId = req.query.user_id;

    console.log("📥 API CALLED /my-points");
    console.log("👉 user_id from request:", userId);

    // فحص النقاط
    const [pointsRows] = await db.query(
      "SELECT * FROM loyalty_points WHERE user_id=?",
      [userId]
    );

    console.log("💰 loyalty_points result:", pointsRows);

    // فحص السجل
 const [logs] = await db.query(`
  SELECT 
    *,
    CASE 
      WHEN type = 'earn' THEN 
        CONCAT('لكم ', points, ' نقطة مقابل إنشاء طلب. نقاطك الحالية هي ', 
          (SELECT points FROM loyalty_points WHERE user_id=?)
        )
      ELSE 
          CONCAT(
        'تم تحويل ', points, ' نقطة إلى رصيد (', amount, '). نقاطك الحالية هي ', balance_after
      )
    END as description
  FROM loyalty_logs
  WHERE user_id=?
  ORDER BY id DESC
`, [userId, userId, userId]);

    console.log("📊 loyalty_logs result:", logs);

    // فحص شامل (بدون فلترة)
    const [allLogs] = await db.query(
      "SELECT user_id, points FROM loyalty_logs ORDER BY id DESC LIMIT 5"
    );

    console.log("🧨 ALL LOGS SAMPLE:", allLogs);

    res.json({
      success: true,
      points: pointsRows[0]?.points || 0,
      logs
    });

  } catch (err) {
    console.error("❌ ERROR:", err);
    res.json({ success: false });
  }
});



router.post("/convert", async (req, res) => {
  const { user_id } = req.body;

  const conn = await db.getConnection();

  try {
    await conn.beginTransaction();

    // 1. جلب النقاط
    const [[lp]] = await conn.query(
      "SELECT * FROM loyalty_points WHERE user_id=?",
      [user_id]
    );

    if (!lp || lp.points <= 0) {
      throw new Error("لا توجد نقاط للتحويل");
    }

    // 2. جلب الإعدادات
    const [[settings]] = await conn.query(
      "SELECT amount_per_point, point_value FROM loyalty_settings LIMIT 1"
    );

    const pointValue = Number(settings?.point_value || 1);

    const amount = lp.points * pointValue;

    // 3. جلب حسابات النظام
    const [[sys]] = await conn.query(`
      SELECT 
        customer_guarantee_account,
        coupon_discount_account
      FROM settings
      LIMIT 1
    `);

    const guaranteeAccount = sys.customer_guarantee_account; // 58
    const promoAccount = sys.coupon_discount_account; // 67

    if (!guaranteeAccount || !promoAccount) {
      throw new Error("الحسابات الوسيطة غير معرفة");
    }

    // 4. جلب محفظة العميل
    const [[guarantee]] = await conn.query(
      "SELECT * FROM customer_guarantees WHERE customer_id=? LIMIT 1",
      [user_id]
    );

    if (!guarantee) {
      throw new Error("العميل ما عنده محفظة");
    }

    const baseAmount = amount;

    // 5. القيد المحاسبي
    // من وسيط العروض → إلى وسيط التأمين

    await conn.query(`
      INSERT INTO journal_entries
      (journal_type_id, journal_date, currency_id, account_id, debit, notes, created_by, branch_id)
      VALUES (5, NOW(), 1, ?, ?, ?, ?, ?)
    `, [
      promoAccount,
      baseAmount,
      `تحويل نقاط إلى رصيد عميل #${user_id}`,
      req.user?.id || 1,
      req.user?.branch_id || 1
    ]);

    await conn.query(`
      INSERT INTO journal_entries
      (journal_type_id, journal_date, currency_id, account_id, credit, notes, created_by, branch_id)
      VALUES (5, NOW(), 1, ?, ?, ?, ?, ?)
    `, [
      guaranteeAccount,
      baseAmount,
      `تحويل نقاط إلى رصيد عميل #${user_id}`,
      req.user?.id || 1,
      req.user?.branch_id || 1
    ]);

    // 6. إضافة رصيد للمحفظة (إذا cash/bank)
    if (guarantee.type !== "account") {
      await conn.query(`
        INSERT INTO customer_guarantee_moves
        (guarantee_id, currency_id, rate, amount, amount_base)
        VALUES (?, 1, 1, ?, ?)
      `, [guarantee.id, amount, amount]);
    }

    // 7. تصفير النقاط
    await conn.query(
      "UPDATE loyalty_points SET points = 0 WHERE user_id=?",
      [user_id]
    );

    // 8. تسجيل العملية
    await conn.query(`
      INSERT INTO loyalty_logs
      (user_id, points, amount, type)
      VALUES (?, ?, ?, 'redeem')
    `, [user_id, lp.points, amount]);

    await conn.commit();

    res.json({
      success: true,
      amount
    });

  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.json({ success: false, message: err.message });
  } finally {
    conn.release();
  }
});
export default router;
