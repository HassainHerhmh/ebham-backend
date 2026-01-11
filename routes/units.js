import express from "express";
import db from "../db.js";

const router = express.Router();

/* ======================================================
   🟢 جلب جميع الوحدات
====================================================== */
router.get("/", async (_, res) => {
  try {
    const [rows] = await db.query(`
      SELECT id, name
      FROM units
      ORDER BY id DESC
    `);

    res.json({ success: true, units: rows });
  } catch (err) {
    console.error("❌ خطأ في جلب الوحدات:", err);
    res.status(500).json({ success: false, message: "❌ خطأ في السيرفر" });
  }
});

/* ======================================================
   ✅ إضافة وحدة جديدة
====================================================== */
router.post("/", async (req, res) => {
  try {
    const { name } = req.body;

    if (!name) {
      return res.status(400).json({
        success: false,
        message: "❌ اسم الوحدة مطلوب",
      });
    }

    await db.query(
      "INSERT INTO units (name) VALUES (?)",
      [name.trim()]
    );

    res.json({ success: true, message: "✅ تم إضافة الوحدة بنجاح" });
  } catch (err) {
    console.error("❌ خطأ في إضافة الوحدة:", err);
    res.status(500).json({ success: false, message: "❌ خطأ في السيرفر" });
  }
});

/* ======================================================
   ✏️ تعديل وحدة
====================================================== */
router.put("/:id", async (req, res) => {
  try {
    const { name } = req.body;

    if (!name) {
      return res.status(400).json({
        success: false,
        message: "❌ اسم الوحدة مطلوب",
      });
    }

    const [exists] = await db.query(
      "SELECT id FROM units WHERE id=?",
      [req.params.id]
    );

    if (!exists.length) {
      return res.status(404).json({
        success: false,
        message: "❌ الوحدة غير موجودة",
      });
    }

    await db.query(
      "UPDATE units SET name=? WHERE id=?",
      [name.trim(), req.params.id]
    );

    res.json({ success: true, message: "✅ تم تعديل الوحدة" });
  } catch (err) {
    console.error("❌ خطأ في تعديل الوحدة:", err);
    res.status(500).json({ success: false, message: "❌ خطأ في السيرفر" });
  }
});

/* ======================================================
   🗑️ حذف وحدة
====================================================== */
router.delete("/:id", async (req, res) => {
  try {
    const [exists] = await db.query(
      "SELECT id FROM units WHERE id=?",
      [req.params.id]
    );

    if (!exists.length) {
      return res.status(404).json({
        success: false,
        message: "❌ الوحدة غير موجودة",
      });
    }

    await db.query("DELETE FROM units WHERE id=?", [req.params.id]);

    res.json({ success: true, message: "🗑️ تم حذف الوحدة" });
  } catch (err) {
    console.error("❌ خطأ في حذف الوحدة:", err);
    res.status(500).json({ success: false, message: "❌ خطأ في السيرفر" });
  }
});

export default router;
