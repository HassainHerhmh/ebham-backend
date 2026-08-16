import express from "express";
import db from "../db.js";

const router = express.Router();

function parseRestaurantIds(body = {}) {
  let ids = [];

  if (Array.isArray(body.restaurant_ids)) {
    ids = body.restaurant_ids;
  } else if (typeof body.restaurant_ids === "string" && body.restaurant_ids.trim()) {
    try {
      const parsed = JSON.parse(body.restaurant_ids);
      ids = Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      ids = String(body.restaurant_ids)
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);
    }
  } else if (body.restaurant_id) {
    ids = [body.restaurant_id];
  }

  return [...new Set(ids.map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0))];
}

async function syncUnitRestaurants(unitId, restaurantIds) {
  await db.query("DELETE FROM unit_restaurants WHERE unit_id = ?", [unitId]);
  for (const rid of restaurantIds) {
    await db.query(
      "INSERT INTO unit_restaurants (unit_id, restaurant_id) VALUES (?, ?)",
      [unitId, rid]
    );
  }
  await db.query("UPDATE units SET restaurant_id = ? WHERE id = ?", [
    restaurantIds[0] || null,
    unitId,
  ]);
}

/* ======================================================
   🟢 جلب جميع الوحدات + البحث + فلترة المتجر
====================================================== */
router.get("/", async (req, res) => {
  try {
    const { q = "", restaurant_id = "" } = req.query;

    let sql = `
      SELECT 
        u.id,
        u.name,
        u.restaurant_id,
        GROUP_CONCAT(DISTINCT ur.restaurant_id ORDER BY ur.restaurant_id) AS restaurant_ids,
        GROUP_CONCAT(DISTINCT r.name ORDER BY r.name SEPARATOR ', ') AS restaurant_names,
        MIN(r.name) AS restaurant_name
      FROM units u
      LEFT JOIN unit_restaurants ur ON ur.unit_id = u.id
      LEFT JOIN restaurants r ON r.id = COALESCE(ur.restaurant_id, u.restaurant_id)
      WHERE 1=1
    `;

    const params = [];

    if (q) {
      sql += ` AND (u.name LIKE ? OR r.name LIKE ?) `;
      params.push(`%${q}%`, `%${q}%`);
    }

    if (restaurant_id) {
      sql += `
        AND (
          ur.restaurant_id = ?
          OR (ur.restaurant_id IS NULL AND u.restaurant_id = ?)
        )
      `;
      params.push(restaurant_id, restaurant_id);
    }

    sql += ` GROUP BY u.id ORDER BY u.id DESC `;

    const [rows] = await db.query(sql, params);

    const units = (rows || []).map((row) => ({
      ...row,
      restaurant_ids: String(row.restaurant_ids || row.restaurant_id || "")
        .split(",")
        .map((x) => Number(x))
        .filter(Boolean),
      restaurant_name: row.restaurant_names || row.restaurant_name || null,
    }));

    res.json({ success: true, units });
  } catch (err) {
    console.error("❌ خطأ في جلب الوحدات:", err?.message || err);
    res.json({ success: true, units: [] });
  }
});

/* ======================================================
   ✅ إضافة وحدة جديدة مع تحديد متاجر متعددة
====================================================== */
router.post("/", async (req, res) => {
  try {
    const { name } = req.body;
    const restaurantIds = parseRestaurantIds(req.body);

    if (!name || !name.trim()) {
      return res.status(400).json({
        success: false,
        message: "❌ اسم الوحدة مطلوب",
      });
    }

    if (!restaurantIds.length) {
      return res.status(400).json({
        success: false,
        message: "❌ اختر متجراً واحداً على الأقل",
      });
    }

    const [restaurantRows] = await db.query(
      `SELECT id FROM restaurants WHERE id IN (${restaurantIds.map(() => "?").join(",")})`,
      restaurantIds
    );

    if (restaurantRows.length !== restaurantIds.length) {
      return res.status(404).json({
        success: false,
        message: "❌ أحد المتاجر غير موجود",
      });
    }

    const unitName = name.trim();

    const [duplicate] = await db.query(
      `SELECT id FROM units WHERE name = ? LIMIT 1`,
      [unitName]
    );

    if (duplicate.length) {
      return res.status(400).json({
        success: false,
        message: "❌ هذه الوحدة موجودة مسبقاً — عدّلها واربطها بالمتاجر",
      });
    }

    const [result] = await db.query(
      "INSERT INTO units (name, restaurant_id) VALUES (?, ?)",
      [unitName, restaurantIds[0]]
    );

    await syncUnitRestaurants(result.insertId, restaurantIds);

    res.json({
      success: true,
      message: "✅ تم إضافة الوحدة بنجاح",
    });
  } catch (err) {
    console.error("❌ خطأ في إضافة الوحدة:", err?.message || err);
    res.status(500).json({ success: false, message: "❌ خطأ في السيرفر" });
  }
});

/* ======================================================
   ✏️ تعديل وحدة
====================================================== */
router.put("/:id", async (req, res) => {
  try {
    const { name } = req.body;
    const { id } = req.params;
    const restaurantIds = parseRestaurantIds(req.body);

    if (!name || !name.trim()) {
      return res.status(400).json({
        success: false,
        message: "❌ اسم الوحدة مطلوب",
      });
    }

    if (!restaurantIds.length) {
      return res.status(400).json({
        success: false,
        message: "❌ اختر متجراً واحداً على الأقل",
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
      `SELECT id FROM restaurants WHERE id IN (${restaurantIds.map(() => "?").join(",")})`,
      restaurantIds
    );

    if (restaurantRows.length !== restaurantIds.length) {
      return res.status(404).json({
        success: false,
        message: "❌ أحد المتاجر غير موجود",
      });
    }

    const unitName = name.trim();

    const [duplicate] = await db.query(
      `SELECT id FROM units WHERE name = ? AND id != ? LIMIT 1`,
      [unitName, id]
    );

    if (duplicate.length) {
      return res.status(400).json({
        success: false,
        message: "❌ اسم الوحدة مستخدم لوحدة أخرى",
      });
    }

    await db.query("UPDATE units SET name = ?, restaurant_id = ? WHERE id = ?", [
      unitName,
      restaurantIds[0],
      id,
    ]);
    await syncUnitRestaurants(id, restaurantIds);

    res.json({ success: true, message: "✅ تم تعديل الوحدة" });
  } catch (err) {
    console.error("❌ خطأ في تعديل الوحدة:", err?.message || err);
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

    await db.query("DELETE FROM unit_restaurants WHERE unit_id = ?", [
      req.params.id,
    ]);
    await db.query("DELETE FROM units WHERE id = ?", [req.params.id]);

    res.json({ success: true, message: "🗑️ تم حذف الوحدة" });
  } catch (err) {
    console.error("❌ خطأ في حذف الوحدة:", err?.message || err);
    res.status(500).json({ success: false, message: "❌ خطأ في السيرفر" });
  }
});

export default router;
