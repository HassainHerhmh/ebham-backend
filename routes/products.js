import express from "express";
import db from "../db.js";
import upload from "../middlewares/upload.js";

const router = express.Router();

/* ======================================================
   🟢 جلب جميع المنتجات
====================================================== */
router.get("/", async (_, res) => {
  try {
  const [rows] = await db.query(`
  SELECT 
    p.id, p.name, p.price, p.image_url, p.notes, p.created_at, p.status,
    GROUP_CONCAT(c.id) AS category_ids,
    GROUP_CONCAT(c.name SEPARATOR ', ') AS category_names,
    u.name AS unit_name,
    r.name AS restaurant_name
  FROM products p
  LEFT JOIN product_categories pc ON p.id = pc.product_id
  LEFT JOIN categories c ON pc.category_id = c.id
  LEFT JOIN units u ON p.unit_id = u.id
  LEFT JOIN restaurants r ON p.restaurant_id = r.id
  GROUP BY p.id
  ORDER BY p.id DESC
`);


    res.json({ success: true, products: rows });
  } catch (err) {
    console.error("❌ خطأ في جلب المنتجات:", err);
    res.status(500).json({ success: false, message: "❌ خطأ في السيرفر" });
  }
});

/* ======================================================
   ✅ إضافة منتج جديد
====================================================== */
router.post("/", upload.single("image"), async (req, res) => {
  try {
    const {
      name,
      price,
      notes,
      category_id,
      unit_id,
      restaurant_id,
      status,
    } = req.body;

    if (!name || !price) {
      return res.status(400).json({
        success: false,
        message: "❌ اسم المنتج والسعر مطلوبان",
      });
    }

    const image_url = req.file ? `/uploads/${req.file.filename}` : null;

    await db.query(
      `INSERT INTO products
       (name, price, image_url, notes, category_id, unit_id, restaurant_id, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        name,
        price,
        image_url,
        notes || "",
        category_id || null,
        unit_id || null,
        restaurant_id || null,
        status || "active",
      ]
    );

    res.json({ success: true, message: "✅ تم إضافة المنتج بنجاح" });
  } catch (err) {
    console.error("❌ خطأ في إضافة المنتج:", err);
    res.status(500).json({ success: false, message: "❌ خطأ في السيرفر" });
  }
});

/* ======================================================
   ✏️ تعديل منتج
====================================================== */
router.put("/:id", upload.single("image"), async (req, res) => {
  try {
    const {
      name,
      price,
      notes,
      category_id,
      unit_id,
      restaurant_id,
      status,
    } = req.body;

    const updates = [];
    const params = [];

    if (name !== undefined) {
      updates.push("name=?");
      params.push(name);
    }
    if (price !== undefined) {
      updates.push("price=?");
      params.push(price);
    }
    if (notes !== undefined) {
      updates.push("notes=?");
      params.push(notes);
    }
    if (category_id !== undefined) {
      updates.push("category_id=?");
      params.push(category_id || null);
    }
    if (unit_id !== undefined) {
      updates.push("unit_id=?");
      params.push(unit_id || null);
    }
    if (restaurant_id !== undefined) {
      updates.push("restaurant_id=?");
      params.push(restaurant_id || null);
    }
    if (status !== undefined) {
      updates.push("status=?");
      params.push(status);
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
      `UPDATE products SET ${updates.join(", ")} WHERE id=?`,
      params
    );

    res.json({ success: true, message: "✅ تم تعديل المنتج" });
  } catch (err) {
    console.error("❌ خطأ في تعديل المنتج:", err);
    res.status(500).json({ success: false, message: "❌ خطأ في السيرفر" });
  }
});

/* ======================================================
   🗑️ حذف منتج
====================================================== */
router.delete("/:id", async (req, res) => {
  try {
    const [exists] = await db.query(
      "SELECT id FROM products WHERE id=?",
      [req.params.id]
    );

    if (!exists.length) {
      return res.status(404).json({
        success: false,
        message: "❌ المنتج غير موجود",
      });
    }

    await db.query("DELETE FROM products WHERE id=?", [req.params.id]);

    res.json({ success: true, message: "🗑️ تم حذف المنتج" });
  } catch (err) {
    console.error("❌ خطأ في حذف المنتج:", err);
    res.status(500).json({ success: false, message: "❌ خطأ في السيرفر" });
  }
});

export default router;
