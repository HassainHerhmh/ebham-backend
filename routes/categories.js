import express from "express";
import fs from "fs";
import path from "path";
import db from "../db.js";
import upload, { uploadToCloudinary } from "../middlewares/upload.js";
import { emitCatalogUpdate } from "../utils/catalogEvents.js";
import { ensureCategoriesI18nSchema } from "../utils/catalogI18n.js";

const router = express.Router();

const ensureLocalUploadDir = () => {
  const dir = path.join(process.cwd(), "uploads", "categories");
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
  return `/uploads/categories/${filename}`;
};

const resolveUploadedImageUrl = async (file, req) => {
  if (!file?.buffer) return null;

  try {
    const result = await uploadToCloudinary(file.buffer, "categories");
    return result.secure_url;
  } catch (cloudErr) {
    console.error("CATEGORY IMAGE CLOUDINARY:", cloudErr?.message || cloudErr);
    const localPath = await saveLocalFallback(file);
    const origin = `${req.protocol}://${req.get("host")}`;
    return `${origin}${localPath}`;
  }
};

/* ======================================================
   🟢 جلب جميع الفئات
====================================================== */
router.get("/", async (_, res) => {
  try {
    await ensureCategoriesI18nSchema();

    const [rows] = await db.query(`
      SELECT id, name, name_en, description, description_en, icon_url, image_url,
             COALESCE(sort_order, 0) AS sort_order, created_at
      FROM categories
      ORDER BY COALESCE(sort_order, 0) ASC, id DESC
    `);

    res.json({ success: true, categories: rows });
  } catch (err) {
    console.error("❌ خطأ في جلب الفئات:", err?.message || err);
    res.json({ success: true, categories: [] });
  }
});

/* ======================================================
   ✅ إضافة فئة جديدة
====================================================== */
router.post("/", upload.single("image"), async (req, res) => {
  try {
    await ensureCategoriesI18nSchema();

    const {
      name,
      name_en = null,
      description,
      description_en = null,
      icon_url,
      image_url: bodyImageUrl,
      sort_order,
    } = req.body;

    if (!name) {
      return res.status(400).json({
        success: false,
        message: "❌ اسم الفئة مطلوب",
      });
    }

    let image_url = bodyImageUrl || null;

    if (req.file?.buffer) {
      image_url = await resolveUploadedImageUrl(req.file, req);
    }

    await db.query(
      `INSERT INTO categories
       (name, name_en, description, description_en, icon_url, image_url, sort_order, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        name,
        name_en || null,
        description || "",
        description_en || null,
        icon_url || "",
        image_url,
        sort_order !== undefined ? Number(sort_order) || 0 : 0,
      ]
    );

    res.json({ success: true, message: "✅ تم إضافة الفئة بنجاح" });
    emitCatalogUpdate(req.app, { entity: "categories", action: "create" });
  } catch (err) {
    console.error("❌ خطأ في إضافة الفئة:", err?.message || err);
    res.status(500).json({ success: false, message: "❌ خطأ في السيرفر" });
  }
});

/* ======================================================
   ✏️ تعديل فئة
====================================================== */
router.put("/:id", upload.single("image"), async (req, res) => {
  try {
    await ensureCategoriesI18nSchema();

    const {
      name,
      name_en,
      description,
      description_en,
      icon_url,
      image_url: bodyImageUrl,
      sort_order,
    } = req.body;
    const updates = [];
    const params = [];

    if (name !== undefined) {
      updates.push("name=?");
      params.push(name);
    }

    if (name_en !== undefined) {
      updates.push("name_en=?");
      params.push(name_en || null);
    }

    if (description !== undefined) {
      updates.push("description=?");
      params.push(description);
    }

    if (description_en !== undefined) {
      updates.push("description_en=?");
      params.push(description_en || null);
    }

    if (icon_url !== undefined) {
      updates.push("icon_url=?");
      params.push(icon_url);
    }

    if (sort_order !== undefined) {
      updates.push("sort_order=?");
      params.push(Number(sort_order) || 0);
    }

    if (req.file?.buffer) {
      const uploaded = await resolveUploadedImageUrl(req.file, req);
      updates.push("image_url=?");
      params.push(uploaded);
    } else if (bodyImageUrl !== undefined && bodyImageUrl !== "") {
      updates.push("image_url=?");
      params.push(bodyImageUrl);
    }

    if (!updates.length) {
      return res.status(400).json({
        success: false,
        message: "❌ لا توجد بيانات لتحديثها",
      });
    }

    params.push(req.params.id);

    await db.query(
      `UPDATE categories SET ${updates.join(", ")} WHERE id=?`,
      params
    );

    res.json({ success: true, message: "✅ تم تعديل الفئة" });
    emitCatalogUpdate(req.app, { entity: "categories", action: "update" });
  } catch (err) {
    console.error("❌ خطأ في تعديل الفئة:", err?.message || err);
    res.status(500).json({ success: false, message: "❌ خطأ في السيرفر" });
  }
});

/* ======================================================
   🗑️ حذف فئة
====================================================== */
router.delete("/:id", async (req, res) => {
  try {
    const [exists] = await db.query(
      "SELECT id FROM categories WHERE id=?",
      [req.params.id]
    );

    if (!exists.length) {
      return res.status(404).json({
        success: false,
        message: "❌ الفئة غير موجودة",
      });
    }

    await db.query("DELETE FROM categories WHERE id=?", [req.params.id]);

    res.json({ success: true, message: "🗑️ تم حذف الفئة" });
    emitCatalogUpdate(req.app, { entity: "categories", action: "delete" });
  } catch (err) {
    console.error("❌ خطأ في حذف الفئة:", err?.message || err);
    res.status(500).json({ success: false, message: "❌ خطأ في السيرفر" });
  }
});

export default router;
