import express from "express";
import fs from "fs";
import path from "path";
import upload, { uploadToCloudinary } from "../middlewares/upload.js";
import auth from "../middlewares/auth.js";

const router = express.Router();

const ensureLocalUploadDir = () => {
  const dir = path.join(process.cwd(), "uploads", "misc");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
};

const saveLocalFallback = async (file) => {
  const dir = ensureLocalUploadDir();
  const ext = path.extname(file.originalname || "") || ".jpg";
  const filename = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
  const fullPath = path.join(dir, filename);
  await fs.promises.writeFile(fullPath, file.buffer);
  return `/uploads/misc/${filename}`;
};

router.post("/", auth, upload.single("image"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "لم يتم رفع أي صورة",
      });
    }

    const folder = String(req.query.folder || req.body?.folder || "types");

    try {
      const result = await uploadToCloudinary(req.file.buffer, folder);
      return res.json({
        success: true,
        url: result.secure_url,
        path: result.secure_url,
      });
    } catch (cloudErr) {
      console.error(
        "CLOUDINARY UPLOAD FALLBACK:",
        cloudErr?.message || cloudErr
      );

      const localPath = await saveLocalFallback(req.file);
      const origin = `${req.protocol}://${req.get("host")}`;
      const absoluteUrl = `${origin}${localPath}`;

      return res.json({
        success: true,
        url: absoluteUrl,
        path: localPath,
        storage: "local",
      });
    }
  } catch (err) {
    console.error("❌ خطأ في رفع الصورة:", err?.message || err);

    return res.status(500).json({
      success: false,
      message: "فشل رفع الصورة",
    });
  }
});

export default router;
