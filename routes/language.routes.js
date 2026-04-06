import express from "express";
import db from "../db.js";
import auth from "../middlewares/auth.js";

const router = express.Router();

router.get("/my-language", auth, async (req, res) => {
  try {
    const userId = req.user.id;

    const [rows] = await db.query(
      "SELECT language FROM customers WHERE id = ? LIMIT 1",
      [userId]
    );

    if (!rows.length) {
      return res.status(404).json({
        success: false,
        message: "المستخدم غير موجود",
      });
    }

    const language = rows[0].language || "ar";

    return res.json({
      success: true,
      language,
      direction: language === "ar" ? "rtl" : "ltr",
    });
  } catch (error) {
    console.error("GET language error:", error);
    return res.status(500).json({
      success: false,
      message: "حدث خطأ أثناء جلب اللغة",
    });
  }
});

router.put("/my-language", auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { language } = req.body;

    if (!language || !["ar", "en"].includes(language)) {
      return res.status(400).json({
        success: false,
        message: "اللغة غير مدعومة",
      });
    }

    await db.query(
      "UPDATE customers SET language = ? WHERE id = ?",
      [language, userId]
    );

    return res.json({
      success: true,
      message: "تم تحديث اللغة بنجاح",
      language,
      direction: language === "ar" ? "rtl" : "ltr",
    });
  } catch (error) {
    console.error("PUT language error:", error);
    return res.status(500).json({
      success: false,
      message: "حدث خطأ أثناء تحديث اللغة",
    });
  }
});

export default router;
