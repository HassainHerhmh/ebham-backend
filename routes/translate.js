import express from "express";
import auth from "../middlewares/auth.js";

const router = express.Router();

router.use(auth);

router.post("/", async (req, res) => {
  try {
    const text = String(req.body?.text || "").trim();

    if (!text) {
      return res.status(400).json({
        success: false,
        message: "النص العربي مطلوب للترجمة",
      });
    }

    if (text.length > 500) {
      return res.status(400).json({
        success: false,
        message: "النص طويل جداً (الحد 500 حرف)",
      });
    }

    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=ar|en`;
    const response = await fetch(url);

    if (!response.ok) {
      return res.status(502).json({
        success: false,
        message: "خدمة الترجمة غير متاحة حالياً",
      });
    }

    const data = await response.json();
    const translated = String(data?.responseData?.translatedText || "").trim();

    if (!translated) {
      return res.status(502).json({
        success: false,
        message: "لم تُرجع خدمة الترجمة نتيجة",
      });
    }

    return res.json({
      success: true,
      text: translated,
    });
  } catch (err) {
    console.error("TRANSLATE ERROR:", err?.message || err);
    return res.status(500).json({
      success: false,
      message: "حدث خطأ أثناء الترجمة",
    });
  }
});

export default router;
