import express from "express";
import upload, { uploadToCloudinary } from "../middlewares/upload.js";

const router = express.Router();

router.post("/", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "لم يتم رفع أي صورة",
      });
    }

    const result = await uploadToCloudinary(
      req.file.buffer,
      "types"
    );

    return res.json({
      success: true,
      url: result.secure_url,
    });

  } catch (err) {
    console.error("❌ خطأ في رفع الصورة:", err);

    return res.status(500).json({
      success: false,
      message: "فشل رفع الصورة",
    });
  }
});

export default router;
