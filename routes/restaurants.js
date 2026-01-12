import express from "express";
import db from "../db.js";
import upload, { uploadToCloudinary } from "../middlewares/upload.js";


const router = express.Router();

/* ======================================================
   🟢 جلب جميع المطاعم مع الفئات + التوقيت + الترتيب
====================================================== */
router.get("/", async (_, res) => {
  try {
    const [rows] = await db.query(`
      SELECT 
        r.id, r.name, r.address, r.phone, r.image_url,
        r.latitude, r.longitude, r.created_at, r.sort_order,
        GROUP_CONCAT(DISTINCT c.name SEPARATOR ', ') AS categories,
        GROUP_CONCAT(DISTINCT c.id SEPARATOR ',') AS category_ids
      FROM restaurants r
      LEFT JOIN restaurant_categories rc ON r.id = rc.restaurant_id
      LEFT JOIN categories c ON rc.category_id = c.id
      GROUP BY r.id
      ORDER BY r.sort_order ASC
    `);

    for (const r of rows) {
      const [schedule] = await db.query(
        "SELECT day, start_time, end_time, closed FROM restaurant_schedule WHERE restaurant_id=?",
        [r.id]
      );
      r.schedule = schedule;
    }

    res.json({ success: true, restaurants: rows });
  } catch (err) {
    console.error("❌ خطأ في جلب المطاعم:", err);
    res.status(500).json({ success: false });
  }
});

/* ======================================================
   ✅ إضافة مطعم جديد
====================================================== */
router.post("/", upload.single("image"), async (req, res) => {
  try {
    const {
      name,
      address = "",
      phone = "",
      latitude = null,
      longitude = null,
      category_ids = [],
      schedule = "[]",
    } = req.body;

    if (!name) {
      return res.status(400).json({ success: false, message: "❌ اسم المطعم مطلوب" });
    }

    const image_url = req.file ? `/uploads/${req.file.filename}` : null;

    // نجيب أعلى ترتيب حالي
    const [[{ maxOrder }]] = await db.query(
      "SELECT COALESCE(MAX(sort_order), 0) AS maxOrder FROM restaurants"
    );

    const [result] = await db.query(
      `INSERT INTO restaurants
       (name, address, phone, image_url, latitude, longitude, sort_order, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
      [name, address, phone, image_url, latitude || null, longitude || null, maxOrder + 1]
    );

    const restaurantId = result.insertId;

    // الفئات
    let cats = [];
    try {
      cats = typeof category_ids === "string" ? JSON.parse(category_ids) : category_ids;
    } catch {}

    for (const cid of cats) {
      await db.query(
        "INSERT INTO restaurant_categories (restaurant_id, category_id) VALUES (?, ?)",
        [restaurantId, cid]
      );
    }

    // التوقيت
    let sch = [];
    try {
      sch = JSON.parse(schedule);
    } catch {}

    for (const d of sch) {
      await db.query(
        `INSERT INTO restaurant_schedule
         (restaurant_id, day, start_time, end_time, closed)
         VALUES (?, ?, ?, ?, ?)`,
        [restaurantId, d.day, d.start || null, d.end || null, d.closed ? 1 : 0]
      );
    }

    res.json({ success: true, message: "✅ تم إضافة المطعم" });
  } catch (err) {
    console.error("❌ خطأ في إضافة المطعم:", err);
    res.status(500).json({ success: false, message: "❌ خطأ في السيرفر" });
  }
});

/* ======================================================
   ✏️ تعديل مطعم
====================================================== */
router.put("/:id", upload.single("image"), async (req, res) => {
  try {
    const {
      name,
      address,
      phone,
      latitude,
      longitude,
      category_ids,
      schedule,
    } = req.body;

    const updates = [];
    const params = [];

    if (name !== undefined) { updates.push("name=?"); params.push(name); }
    if (address !== undefined) { updates.push("address=?"); params.push(address); }
    if (phone !== undefined) { updates.push("phone=?"); params.push(phone); }
    if (latitude !== undefined) { updates.push("latitude=?"); params.push(latitude || null); }
    if (longitude !== undefined) { updates.push("longitude=?"); params.push(longitude || null); }
    if (req.file) {
      updates.push("image_url=?");
      params.push(`/uploads/${req.file.filename}`);
    }

    if (updates.length) {
      params.push(req.params.id);
      await db.query(`UPDATE restaurants SET ${updates.join(", ")} WHERE id=?`, params);
    }

    if (category_ids !== undefined) {
      await db.query("DELETE FROM restaurant_categories WHERE restaurant_id=?", [req.params.id]);

      let cats = [];
      try {
        cats = typeof category_ids === "string" ? JSON.parse(category_ids) : category_ids;
      } catch {}

      for (const cid of cats) {
        await db.query(
          "INSERT INTO restaurant_categories (restaurant_id, category_id) VALUES (?, ?)",
          [req.params.id, cid]
        );
      }
    }

    if (schedule !== undefined) {
      await db.query("DELETE FROM restaurant_schedule WHERE restaurant_id=?", [req.params.id]);

      let sch = [];
      try {
        sch = JSON.parse(schedule);
      } catch {}

      for (const d of sch) {
        await db.query(
          `INSERT INTO restaurant_schedule
           (restaurant_id, day, start_time, end_time, closed)
           VALUES (?, ?, ?, ?, ?)`,
          [req.params.id, d.day, d.start || null, d.end || null, d.closed ? 1 : 0]
        );
      }
    }

    res.json({ success: true, message: "✅ تم تعديل المطعم" });
  } catch (err) {
    console.error("❌ خطأ في تعديل المطعم:", err);
    res.status(500).json({ success: false, message: "❌ خطأ في السيرفر" });
  }
});

/* ======================================================
   🔀 تحديث ترتيب المطاعم (بعد السحب)
====================================================== */
router.post("/reorder", async (req, res) => {
  try {
    const { order } = req.body;
    // order = [{ id: 5, sort_order: 1 }, { id: 2, sort_order: 2 }, ...]

    for (const item of order) {
      await db.query(
        "UPDATE restaurants SET sort_order=? WHERE id=?",
        [item.sort_order, item.id]
      );
    }

    res.json({ success: true });
  } catch (err) {
    console.error("❌ خطأ في إعادة الترتيب:", err);
    res.status(500).json({ success: false });
  }
});
/* ======================================================
   🟢 جلب المطاعم للتطبيق (خفيف – بدون هاتف)
====================================================== */
router.get("/app", async (_, res) => {
  try {
    const [rows] = await db.query(`
      SELECT 
        r.id,
        r.name,
        r.address,
        r.image_url,
        r.sort_order,
        -- هل المطعم مفتوح الآن؟
        CASE 
          WHEN EXISTS (
            SELECT 1
            FROM restaurant_schedule s
            WHERE s.restaurant_id = r.id
              AND s.day = DAYOFWEEK(NOW())
              AND s.closed = 0
              AND CURTIME() BETWEEN s.start_time AND s.end_time
          )
          THEN 1 ELSE 0
        END AS is_open,

        -- التقييم (مؤقتًا صفر – نربطه لاحقًا)
        0 AS rating,
        0 AS reviews_count

      FROM restaurants r
      ORDER BY r.sort_order ASC
    `);

    res.json({ success: true, restaurants: rows });
  } catch (err) {
    console.error("❌ خطأ في جلب المطاعم للتطبيق:", err);
    res.status(500).json({ success: false });
  }
});

/* ======================================================
   🗑️ حذف مطعم
====================================================== */
router.delete("/:id", async (req, res) => {
  try {
    await db.query("DELETE FROM restaurant_categories WHERE restaurant_id=?", [req.params.id]);
    await db.query("DELETE FROM restaurant_schedule WHERE restaurant_id=?", [req.params.id]);
    await db.query("DELETE FROM restaurants WHERE id=?", [req.params.id]);

    res.json({ success: true, message: "🗑️ تم حذف المطعم" });
  } catch (err) {
    console.error("❌ خطأ في حذف المطعم:", err);
    res.status(500).json({ success: false, message: "❌ خطأ في السيرفر" });
  }
});

export default router;
