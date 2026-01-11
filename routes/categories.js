import express from "express";
import db from "../db.js";
import upload from "../middlewares/upload.js";

const router = express.Router();

/* ======================================================
   🟢 جلب جميع الفئات
====================================================== */
router.get("/", async (_, res) => {
  try {
    const [rows] = await db.query(`
      SELECT id, name, description, icon_url, image_url, created_at
      FROM categories
      ORDER BY id DESC
    `);

    res.json({ success: true, categories: rows });
  } catch (err) {
    console.error("❌ خطأ في جلب الفئات:", err);
    res.status(500).json({ success: false, message: "❌ خطأ في السيرفر" });
  }
});

/* ======================================================
   ✅ إضافة فئة جديدة
====================================================== */
router.post("/", upload.single("image"), async (req, res) => {
  try {
    const { name, description, icon_url } = req.body;

    if (!name) {
      return res.status(400).json({
        success: false,
        message: "❌ اسم الفئة مطلوب",
      });
    }

    const image_url = req.file ? `/uploads/${req.file.filename}` : null;

    await db.query(
      `INSERT INTO categories
       (name, description, icon_url, image_url, created_at)
       VALUES (?, ?, ?, ?, NOW())`,
      [name, description || "", icon_url || "", image_url]
    );

    res.json({ success: true, message: "✅ تم إضافة الفئة بنجاح" });
  } catch (err) {
    console.error("❌ خطأ في إضافة الفئة:", err);
    res.status(500).json({ success: false, message: "❌ خطأ في السيرفر" });
  }
});

/* ======================================================
   ✏️ تعديل فئة
====================================================== */
router.put("/:id", upload.single("image"), async (req, res) => {
  try {
    const { name, description, icon_url } = req.body;
    const updates = [];
    const params = [];

    if (name !== undefined) {
      updates.push("name=?");
      params.push(name);
    }

    if (description !== undefined) {
      updates.push("description=?");
      params.push(description);
    }

    if (icon_url !== undefined) {
      updates.push("icon_url=?");
      params.push(icon_url);
    }

    if (req.file) {
      updates.push("image_url=?");
      params.push(`/uploads/${req.file.filename}`);
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
  } catch (err) {
    console.error("❌ خطأ في تعديل الفئة:", err);
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
  } catch (err) {
    console.error("❌ خطأ في حذف الفئة:", err);
    res.status(500).json({ success: false, message: "❌ خطأ في السيرفر" });
  }
});

export default router;
