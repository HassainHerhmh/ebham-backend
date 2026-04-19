import express from "express";
import db from "../db.js";

const router = express.Router();

/* ======================================================
   🟢 جلب جميع الوحدات + البحث + فلترة المتجر
   مثال:
   GET /api/units?q=كيلو
   GET /api/units?restaurant_id=3
   GET /api/units?q=كيلو&restaurant_id=3
====================================================== */
router.get("/", async (req, res) => {
  try {
    const { q = "", restaurant_id = "" } = req.query;

    let sql = `
      SELECT 
        u.id,
        u.name,
        u.restaurant_id,
        r.name AS restaurant_name
      FROM units u
      LEFT JOIN restaurants r ON r.id = u.restaurant_id
      WHERE 1=1
    `;

    const params = [];

    if (q) {
      sql += ` AND (u.name LIKE ? OR r.name LIKE ?) `;
      params.push(`%${q}%`, `%${q}%`);
    }

    if (restaurant_id) {
      sql += ` AND u.restaurant_id = ? `;
      params.push(restaurant_id);
    }

    sql += ` ORDER BY u.id DESC `;

    const [rows] = await db.query(sql, params);

    res.json({ success: true, units: rows });
  } catch (err) {
    console.error("❌ خطأ في جلب الوحدات:", err);
    res.status(500).json({ success: false, message: "❌ خطأ في السيرفر" });
  }
});

/* ======================================================
   ✅ إضافة وحدة جديدة مع تحديد المتجر
====================================================== */
router.post("/", async (req, res) => {
  try {
    const { name, restaurant_id } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({
        success: false,
        message: "❌ اسم الوحدة مطلوب",
      });
    }

    if (!restaurant_id) {
      return res.status(400).json({
        success: false,
        message: "❌ المتجر مطلوب",
      });
    }

    const [restaurantRows] = await db.query(
      "SELECT id, name FROM restaurants WHERE id = ? LIMIT 1",
      [restaurant_id]
    );

    if (!restaurantRows.length) {
      return res.status(404).json({
        success: false,
        message: "❌ المتجر غير موجود",
      });
    }

    const unitName = name.trim();

    const [duplicate] = await db.query(
      `
      SELECT id 
      FROM units 
      WHERE name = ? AND restaurant_id = ?
      LIMIT 1
      `,
      [unitName, restaurant_id]
    );

    if (duplicate.length) {
      return res.status(400).json({
        success: false,
        message: "❌ هذه الوحدة موجودة مسبقاً لهذا المتجر",
      });
    }

    await db.query(
      "INSERT INTO units (name, restaurant_id) VALUES (?, ?)",
      [unitName, restaurant_id]
    );

    res.json({
      success: true,
      message: "✅ تم إضافة الوحدة بنجاح",
    });
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
    const { name, restaurant_id } = req.body;
    const { id } = req.params;

    if (!name || !name.trim()) {
      return res.status(400).json({
        success: false,
        message: "❌ اسم الوحدة مطلوب",
      });
    }

    if (!restaurant_id) {
      return res.status(400).json({
        success: false,
        message: "❌ المتجر مطلوب",
      });
    }

    const [exists] = await db.query(
      "SELECT id FROM units WHERE id = ? LIMIT 1",
      [id]
    );

    if (!exists.length) {
      return res.status(404).json({
        success: false,
        message: "❌ الوحدة غير موجودة",
      });
    }

    const [restaurantRows] = await db.query(
      "SELECT id FROM restaurants WHERE id = ? LIMIT 1",
      [restaurant_id]
    );

    if (!restaurantRows.length) {
      return res.status(404).json({
        success: false,
        message: "❌ المتجر غير موجود",
      });
    }

    const unitName = name.trim();

    const [duplicate] = await db.query(
      `
      SELECT id
      FROM units
      WHERE name = ? AND restaurant_id = ? AND id != ?
      LIMIT 1
      `,
      [unitName, restaurant_id, id]
    );

    if (duplicate.length) {
      return res.status(400).json({
        success: false,
        message: "❌ هذه الوحدة موجودة مسبقاً لهذا المتجر",
      });
    }

    await db.query(
      "UPDATE units SET name = ?, restaurant_id = ? WHERE id = ?",
      [unitName, restaurant_id, id]
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
      "SELECT id FROM units WHERE id = ? LIMIT 1",
      [req.params.id]
    );

    if (!exists.length) {
      return res.status(404).json({
        success: false,
        message: "❌ الوحدة غير موجودة",
      });
    }

    await db.query("DELETE FROM units WHERE id = ?", [req.params.id]);

    res.json({ success: true, message: "🗑️ تم حذف الوحدة" });
  } catch (err) {
    console.error("❌ خطأ في حذف الوحدة:", err);
    res.status(500).json({ success: false, message: "❌ خطأ في السيرفر" });
  }
});

export default router;
