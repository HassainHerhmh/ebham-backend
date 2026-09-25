import express from "express";
import db from "../db.js";
import auth from "../middlewares/auth.js";
import { resolveScopedBranchId } from "../utils/adminRealtime.js";

const router = express.Router();

async function getLoyaltySettings(branchId) {
  if (branchId) {
    const [rows] = await db.query(
      "SELECT * FROM loyalty_settings WHERE branch_id=? LIMIT 1",
      [branchId]
    );
    if (rows[0]) return rows[0];
  }

  const [fallback] = await db.query(
    `SELECT * FROM loyalty_settings
     WHERE branch_id IS NULL OR id = 1
     ORDER BY CASE WHEN branch_id IS NULL THEN 0 ELSE 1 END, id ASC
     LIMIT 1`
  );

  return fallback[0] || { amount_per_point: 100, point_value: 1 };
}

async function calculatePoints(amount, branchId) {
  const settings = await getLoyaltySettings(branchId);
  const rate = Number(settings.amount_per_point) || 100;
  return Math.floor(Number(amount) / rate);
}

export async function addPointsAfterOrder(order) {
  try {
    const [[exists]] = await db.query(
      "SELECT id FROM loyalty_logs WHERE order_id=? LIMIT 1",
      [order.id]
    );

    if (exists) {
      console.log("⚠️ Loyalty already added:", order.id);
      return;
    }

    const branchId = Number(order.branch_id);
    if (!Number.isFinite(branchId) || branchId <= 0) return;

    const points = await calculatePoints(order.total_amount, branchId);
    if (points <= 0) return;

    const [rows] = await db.query(
      "SELECT * FROM loyalty_points WHERE user_id=? AND branch_id=? LIMIT 1",
      [order.customer_id, branchId]
    );

    if (rows.length === 0) {
      await db.query(
        "INSERT INTO loyalty_points (user_id, branch_id, points, total_spent) VALUES (?, ?, ?, ?)",
        [order.customer_id, branchId, points, order.total_amount]
      );
    } else {
      await db.query(
        "UPDATE loyalty_points SET points = points + ?, total_spent = total_spent + ? WHERE user_id=? AND branch_id=?",
        [points, order.total_amount, order.customer_id, branchId]
      );
    }

    await db.query(
      "INSERT INTO loyalty_logs (user_id, branch_id, order_id, points, amount, type) VALUES (?, ?, ?, ?, ?, ?)",
      [order.customer_id, branchId, order.id, points, order.total_amount, "earn"]
    );

    console.log("✅ Points added:", points, "branch:", branchId);
  } catch (err) {
    console.error("❌ LOYALTY ERROR:", err?.message || err);
  }
}

router.get("/admin/loyalty-logs", auth, async (req, res) => {
  try {
    const branchId = resolveScopedBranchId(req);
    if (!branchId) {
      return res.json({ success: true, data: [] });
    }

    const [rows] = await db.query(
      `
      SELECT 
        l.id,
        l.points,
        l.amount,
        l.type,
        l.created_at,
        l.branch_id,
        c.name,
        c.phone
      FROM loyalty_logs l
      JOIN customers c ON c.id = l.user_id
      WHERE l.branch_id = ?
      ORDER BY l.id DESC
    `,
      [branchId]
    );

    res.json({ success: true, data: rows });
  } catch (err) {
    console.error(err);
    res.json({ success: false });
  }
});

router.get("/loyalty/:userId", async (req, res) => {
  try {
    const branchId = resolveScopedBranchId(req);
    if (!branchId) {
      return res.json({
        success: true,
        data: { points: 0, total_spent: 0 },
      });
    }

    const [rows] = await db.query(
      "SELECT * FROM loyalty_points WHERE user_id=? AND branch_id=? LIMIT 1",
      [req.params.userId, branchId]
    );

    res.json({
      success: true,
      data: rows[0] || { points: 0, total_spent: 0, branch_id: branchId },
    });
  } catch (err) {
    console.error(err);
    res.json({ success: false });
  }
});

router.get("/loyalty/:userId/logs", async (req, res) => {
  try {
    const branchId = resolveScopedBranchId(req);
    if (!branchId) {
      return res.json({ success: true, data: [] });
    }

    const [rows] = await db.query(
      "SELECT * FROM loyalty_logs WHERE user_id=? AND branch_id=? ORDER BY id DESC",
      [req.params.userId, branchId]
    );

    res.json({ success: true, data: rows });
  } catch (err) {
    console.error(err);
    res.json({ success: false });
  }
});

router.get("/settings", auth, async (req, res) => {
  try {
    const branchId = resolveScopedBranchId(req);
    const settings = await getLoyaltySettings(branchId);
    res.json({
      amount_per_point: Number(settings.amount_per_point ?? 100),
      point_value: Number(settings.point_value ?? 1),
      branch_id: branchId,
    });
  } catch (err) {
    console.error(err);
    res.json({ success: false });
  }
});

router.put("/settings", auth, async (req, res) => {
  try {
    const branchId = resolveScopedBranchId(req);
    if (!branchId) {
      return res.json({ success: false, message: "حدد الفرع أولاً" });
    }

    let { amount_per_point, point_value } = req.body;

    amount_per_point = Number(amount_per_point);
    point_value = Number(point_value);

    if (!amount_per_point || amount_per_point <= 0) {
      return res.json({
        success: false,
        message: "amount_per_point لازم يكون أكبر من صفر",
      });
    }

    const [[existing]] = await db.query(
      "SELECT id FROM loyalty_settings WHERE branch_id=? LIMIT 1",
      [branchId]
    );

    if (existing) {
      await db.query(
        "UPDATE loyalty_settings SET amount_per_point=?, point_value=? WHERE id=?",
        [amount_per_point, point_value || 1, existing.id]
      );
    } else {
      await db.query(
        "INSERT INTO loyalty_settings (branch_id, amount_per_point, point_value) VALUES (?, ?, ?)",
        [branchId, amount_per_point, point_value || 1]
      );
    }

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.json({ success: false });
  }
});

router.get("/my-points", async (req, res) => {
  try {
    const userId = req.query.user_id;
    const branchId = resolveScopedBranchId(req);

    if (!userId || !branchId) {
      return res.json({ success: true, points: 0, logs: [] });
    }

    const [pointsRows] = await db.query(
      "SELECT * FROM loyalty_points WHERE user_id=? AND branch_id=? LIMIT 1",
      [userId, branchId]
    );

    const currentPoints = pointsRows[0]?.points || 0;

    const [logs] = await db.query(
      `
      SELECT 
        *,
        CASE 
          WHEN type = 'earn' THEN 
            CONCAT('لكم ', points, ' نقطة مقابل إنشاء طلب. نقاطك الحالية هي ', ?)
          ELSE 
            CONCAT('تم خصم ', points, ' نقطة. نقاطك الحالية هي ', ?)
        END as description
      FROM loyalty_logs
      WHERE user_id=? AND branch_id=?
      ORDER BY id DESC
    `,
      [currentPoints, currentPoints, userId, branchId]
    );

    res.json({
      success: true,
      points: currentPoints,
      logs,
    });
  } catch (err) {
    console.error("❌ ERROR:", err?.message || err);
    res.json({ success: false });
  }
});

router.post("/convert", async (req, res) => {
  const { user_id } = req.body;
  const branchId = resolveScopedBranchId(req);
  const conn = await db.getConnection();

  try {
    if (!branchId) {
      throw new Error("حدد الفرع أولاً");
    }

    await conn.beginTransaction();

    const [[lp]] = await conn.query(
      "SELECT * FROM loyalty_points WHERE user_id=? AND branch_id=? LIMIT 1 FOR UPDATE",
      [user_id, branchId]
    );

    if (!lp || lp.points <= 0) {
      throw new Error("لا توجد نقاط للتحويل في هذا الفرع");
    }

    const settings = await getLoyaltySettings(branchId);
    const pointValue = Number(settings?.point_value || 1);
    const amount = lp.points * pointValue;

    const [[sys]] = await conn.query(`
      SELECT 
        customer_guarantee_account,
        coupon_discount_account
      FROM settings
      LIMIT 1
    `);

    const guaranteeAccount = sys.customer_guarantee_account;
    const promoAccount = sys.coupon_discount_account;

    if (!guaranteeAccount || !promoAccount) {
      throw new Error("الحسابات الوسيطة غير معرفة");
    }

    const [[guarantee]] = await conn.query(
      "SELECT * FROM customer_guarantees WHERE customer_id=? LIMIT 1",
      [user_id]
    );

    if (!guarantee) {
      throw new Error("العميل ما عنده محفظة");
    }

    const baseAmount = amount;

    await conn.query(
      `
      INSERT INTO journal_entries
      (journal_type_id, journal_date, currency_id, account_id, debit, notes, created_by, branch_id)
      VALUES (5, NOW(), 1, ?, ?, ?, ?, ?)
    `,
      [
        promoAccount,
        baseAmount,
        `تحويل نقاط إلى رصيد عميل #${user_id}`,
        req.user?.id || 1,
        branchId,
      ]
    );

    await conn.query(
      `
      INSERT INTO journal_entries
      (journal_type_id, journal_date, currency_id, account_id, credit, notes, created_by, branch_id)
      VALUES (5, NOW(), 1, ?, ?, ?, ?, ?)
    `,
      [
        guaranteeAccount,
        baseAmount,
        `تحويل نقاط إلى رصيد عميل #${user_id}`,
        req.user?.id || 1,
        branchId,
      ]
    );

    if (guarantee.type !== "account") {
      await conn.query(
        `
        INSERT INTO customer_guarantee_moves
        (guarantee_id, currency_id, rate, amount, amount_base)
        VALUES (?, 1, 1, ?, ?)
      `,
        [guarantee.id, amount, amount]
      );
    }

    await conn.query(
      "UPDATE loyalty_points SET points = 0 WHERE user_id=? AND branch_id=?",
      [user_id, branchId]
    );

    await conn.query(
      `
      INSERT INTO loyalty_logs
      (user_id, branch_id, points, amount, type)
      VALUES (?, ?, ?, ?, 'redeem')
    `,
      [user_id, branchId, lp.points, amount]
    );

    await conn.commit();

    res.json({
      success: true,
      amount,
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
