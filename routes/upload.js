import express from "express";
import upload, { uploadToCloudinary } from "../middlewares/upload.js";
import path from "path";

const router = express.Router();

// مسار رفع صورة عام (يدعم cloudinary أو local uploads)
router.post("/", upload.single("image"), async (req, res) => {
  try {
    // إذا كنت تستخدم cloudinary
    if (process.env.CLOUDINARY_NAME) {
      if (!req.file) {
        return res.status(400).json({ success: false, message: "لم يتم رفع أي صورة" });
      }
      const result = await uploadToCloudinary(req.file.buffer, "types");
      return res.json({ success: true, url: result.secure_url });
    }
    // رفع محلي
    if (!req.file) {
      return res.status(400).json({ success: false, message: "لم يتم رفع أي صورة" });
    }
    // رابط الصورة المحلية
    const imageUrl = `/uploads/${req.file.filename}`;
    return res.json({ success: true, url: imageUrl });
  } catch (err) {
    console.error("❌ خطأ في رفع الصورة:", err);
    res.status(500).json({ success: false, message: "❌ خطأ في السيرفر" });
  }
});

export default router;
