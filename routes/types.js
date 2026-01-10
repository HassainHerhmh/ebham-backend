import express from "express";
import db from "../db.js";
import upload from "../middlewares/upload.js";

const router = express.Router();

/* ======================================================
   🟢 جلب جميع الأنواع
====================================================== */
router.get("/", async (_, res) => {
  try {
    const [rows] = await db.query(`
      SELECT id, name, image_url, sort_order, created_at
      FROM types
      ORDER BY sort_order ASC
    `);

    res.json({ success: true, types: rows });
  } catch (err) {
    console.error("❌ خطأ في جلب الأنواع:", err);
    res.status(500).json({ success: false, message: "❌ خطأ في السيرفر" });
  }
});

/* ======================================================
   ✅ إضافة نوع جديد
====================================================== */
router.post("/", upload.single("image"), async (req, res) => {
  try {
    const { name, sort_order } = req.body;

    if (!name) {
      return res.status(400).json({
        success: false,
        message: "❌ اسم النوع مطلوب",
      });
    }

    const image_url = req.file ? `/uploads/${req.file.filename}` : null;

    await db.query(
      "INSERT INTO types (name, image_url, sort_order, created_at) VALUES (?, ?, ?, NOW())",
      [name, image_url, sort_order || 0]
    );

    res.json({ success: true, message: "✅ تم إضافة النوع بنجاح" });
  } catch (err) {
    console.error("❌ خطأ في إضافة النوع:", err);
    res.status(500).json({ success: false, message: "❌ خطأ في السيرفر" });
  }
});

/* ======================================================
   ✏️ تعديل نوع
====================================================== */
router.put("/:id", upload.single("image"), async (req, res) => {
  try {
    const { name, sort_order } = req.body;
    const updates = [];
    const params = [];

    if (name) {
      updates.push("name=?");
      params.push(name);
    }

    if (sort_order !== undefined) {
      updates.push("sort_order=?");
      params.push(sort_order);
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
      `UPDATE types SET ${updates.join(", ")} WHERE id=?`,
      params
    );

    res.json({ success: true, message: "✅ تم تعديل النوع" });
  } catch (err) {
    console.error("❌ خطأ في تعديل النوع:", err);
    res.status(500).json({ success: false, message: "❌ خطأ في السيرفر" });
  }
});

/* ======================================================
   🗑️ حذف نوع
====================================================== */
router.delete("/:id", async (req, res) => {
  try {
    const [exists] = await db.query(
      "SELECT id FROM types WHERE id=?",
      [req.params.id]
    );

    if (!exists.length) {
      return res.status(404).json({
        success: false,
        message: "❌ النوع غير موجود",
      });
    }

    await db.query("DELETE FROM types WHERE id=?", [req.params.id]);

    res.json({ success: true, message: "🗑️ تم حذف النوع" });
  } catch (err) {
    console.error("❌ خطأ في حذف النوع:", err);
    res.status(500).json({ success: false, message: "❌ خطأ في السيرفر" });
  }
});

export default router;
