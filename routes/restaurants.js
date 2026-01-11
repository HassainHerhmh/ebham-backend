import express from "express";
import db from "../db.js";
import upload from "../middlewares/upload.js";

const router = express.Router();

/* ======================================================
   🟢 جلب جميع المطاعم
====================================================== */
router.get("/", async (_, res) => {
  try {
    const [rows] = await db.query(`
      SELECT 
        r.id, r.name, r.address, r.phone, r.image_url,
        r.latitude, r.longitude, r.created_at,
        GROUP_CONCAT(c.name SEPARATOR ', ') AS categories
      FROM restaurants r
      LEFT JOIN restaurant_categories rc ON r.id = rc.restaurant_id
      LEFT JOIN categories c ON rc.category_id = c.id
      GROUP BY r.id
      ORDER BY r.id DESC
    `);

    res.json({ success: true, restaurants: rows });
  } catch (err) {
    console.error("❌ خطأ في جلب المطاعم:", err);
    res.status(500).json({ success: false, message: "❌ خطأ في السيرفر" });
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
    } = req.body;

    if (!name) {
      return res.status(400).json({ success: false, message: "❌ اسم المطعم مطلوب" });
    }

    const image_url = req.file ? `/uploads/${req.file.filename}` : null;

    const [result] = await db.query(
      `INSERT INTO restaurants
       (name, address, phone, image_url, latitude, longitude, created_at)
       VALUES (?, ?, ?, ?, ?, ?, NOW())`,
      [name, address, phone, image_url, latitude || null, longitude || null]
    );

    const restaurantId = result.insertId;

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
    } = req.body;

    const updates = [];
    const params = [];

    if (name !== undefined) {
      updates.push("name=?");
      params.push(name);
    }
    if (address !== undefined) {
      updates.push("address=?");
      params.push(address);
    }
    if (phone !== undefined) {
      updates.push("phone=?");
      params.push(phone);
    }
    if (latitude !== undefined) {
      updates.push("latitude=?");
      params.push(latitude || null);
    }
    if (longitude !== undefined) {
      updates.push("longitude=?");
      params.push(longitude || null);
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
      `UPDATE restaurants SET ${updates.join(", ")} WHERE id=?`,
      params
    );

    if (category_ids !== undefined) {
      await db.query(
        "DELETE FROM restaurant_categories WHERE restaurant_id=?",
        [req.params.id]
      );

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

    res.json({ success: true, message: "✅ تم تعديل المطعم" });
  } catch (err) {
    console.error("❌ خطأ في تعديل المطعم:", err);
    res.status(500).json({ success: false, message: "❌ خطأ في السيرفر" });
  }
});

/* ======================================================
   🗑️ حذف مطعم
====================================================== */
router.delete("/:id", async (req, res) => {
  try {
    await db.query(
      "DELETE FROM restaurant_categories WHERE restaurant_id=?",
      [req.params.id]
    );
    await db.query("DELETE FROM restaurants WHERE id=?", [req.params.id]);

    res.json({ success: true, message: "🗑️ تم حذف المطعم" });
  } catch (err) {
    console.error("❌ خطأ في حذف المطعم:", err);
    res.status(500).json({ success: false, message: "❌ خطأ في السيرفر" });
  }
});

export default router;
