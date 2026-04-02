import express from "express";
import db from "../db.js";
import authMiddleware from "../middlewares/auth.js";

const router = express.Router();

/**
 * 📊 GET /api/profile/stats
 * إحصائيات المستخدم (محمي بالتوكن)
 */
router.get("/stats", authMiddleware, async (req, res) => {
  try {
    // ✅ نجيب ID من التوكن فقط (مهم جداً)
    const userId = req.user.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    // ✅ تأكد المستخدم موجود (حماية إضافية)
    const [userCheck] = await db.query(
      "SELECT id FROM users WHERE id = ? LIMIT 1",
      [userId]
    );

    if (!userCheck.length) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // ===============================
    // 📦 عدد الطلبات
    // ===============================
    const [orders] = await db.query(
      "SELECT COUNT(*) AS total FROM orders WHERE user_id = ?",
      [userId]
    );

    // ===============================
    // 💰 الرصيد (اختياري)
    // ===============================
    const [wallet] = await db.query(
      "SELECT balance FROM wallets WHERE user_id = ? LIMIT 1",
      [userId]
    );

    // ===============================
    // ⭐ النقاط (اختياري)
    // ===============================
    const [points] = await db.query(
      "SELECT points FROM loyalty WHERE user_id = ? LIMIT 1",
      [userId]
    );

    // ===============================
    // ✅ الرد النهائي
    // ===============================
    res.json({
      success: true,
      orders: orders[0]?.total || 0,
      balance: wallet[0]?.balance || 0,
      points: points[0]?.points || 0,
    });

  } catch (error) {
    console.error("Profile Stats Error:", error);

    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});

/**
 * 👤 GET /api/profile/me
 * بيانات المستخدم الأساسية
 */
router.get("/me", authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;

    const [rows] = await db.query(
      "SELECT id, name, phone, email, created_at FROM users WHERE id = ? LIMIT 1",
      [userId]
    );

    if (!rows.length) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    res.json({
      success: true,
      user: rows[0],
    });

  } catch (error) {
    console.error("Profile Me Error:", error);

    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});

export default router;
