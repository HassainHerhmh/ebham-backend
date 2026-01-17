import express from "express";
import db from "../db.js";
import upload from "../middlewares/upload.js";
import auth from "../middlewares/auth.js";

const router = express.Router();

/* =========================
   حماية كل المسارات
========================= */
router.use(auth);


/* ======================================================
   🟢 جلب جميع المنتجات (مع دعم الإدارة العامة والفروع)
====================================================== */
router.get("/", async (req, res) => {
  const search = req.query.search || "";
  const user = req.user || {};
  const { is_admin_branch, branch_id } = user;

  let selectedBranch = req.headers["x-branch-id"];

  // لو القيمة "all" نعتبره غير موجود
  if (selectedBranch === "all") {
    selectedBranch = null;
  }

  // 👇 لو إدارة عامة والفرع المختار هو نفس فرع الحساب
  // نعتبره غير محدد (عرض الكل)
  if (is_admin_branch && selectedBranch && Number(selectedBranch) === Number(branch_id)) {
    selectedBranch = null;
  }

  try {
    let rows;
    let where = `WHERE p.name LIKE ?`;
    let params = [`%${search}%`];

    if (is_admin_branch) {
      if (selectedBranch) {
        where += ` AND r.branch_id = ?`;
        params.push(selectedBranch);
      }
      // غير ذلك: الإدارة العامة ترى كل المنتجات
    } else {
      where += ` AND r.branch_id = ?`;
      params.push(branch_id);
    }

   [rows] = await db.query(
  `
  SELECT 
    p.id,
    p.name,
    p.price,
    p.image_url,
    p.notes,
    GROUP_CONCAT(c.id) AS category_ids,
    GROUP_CONCAT(c.name SEPARATOR ', ') AS categories,
    u.id AS unit_id,
    u.name AS unit_name,
    r.id AS restaurant_id,
    r.name AS restaurant_name,
    r.branch_id,
    b.name AS branch_name
  FROM products p
  LEFT JOIN product_categories pc ON p.id = pc.product_id
  LEFT JOIN categories c ON pc.category_id = c.id
  LEFT JOIN units u ON p.unit_id = u.id
  LEFT JOIN restaurants r ON p.restaurant_id = r.id
  LEFT JOIN branches b ON b.id = r.branch_id
  ${where}
  GROUP BY p.id
  ORDER BY p.id DESC
  `,
  params
);


    res.json({ success: true, products: rows });
  } catch (err) {
    console.error("GET PRODUCTS ERROR:", err);
    res.status(500).json({ success: false });
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
      unit_id,
      restaurant_id,
      status,
      category_ids = [],
    } = req.body;

    if (!name || !price || !restaurant_id) {
      return res.status(400).json({
        success: false,
        message: "❌ الاسم والسعر والمطعم مطلوبة",
      });
    }

    const image_url = req.file ? `/uploads/${req.file.filename}` : null;

    const [result] = await db.query(
      `INSERT INTO products
       (name, price, image_url, notes, unit_id, restaurant_id, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        name,
        price,
        image_url,
        notes || "",
        unit_id || null,
        restaurant_id,
        status || "active",
      ]
    );

    const productId = result.insertId;

    let cats = [];
    try {
      cats = typeof category_ids === "string"
        ? JSON.parse(category_ids)
        : category_ids;
    } catch {}

    for (const cid of cats) {
      await db.query(
        "INSERT INTO product_categories (product_id, category_id) VALUES (?, ?)",
        [productId, cid]
      );
    }

    res.json({ success: true, message: "✅ تم إضافة المنتج" });
  } catch (err) {
    console.error("CREATE PRODUCT ERROR:", err);
    res.status(500).json({ success: false });
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
      unit_id,
      restaurant_id,
      status,
      category_ids,
    } = req.body;

    const updates = [];
    const params = [];

    if (name !== undefined) { updates.push("name=?"); params.push(name); }
    if (price !== undefined) { updates.push("price=?"); params.push(price); }
    if (notes !== undefined) { updates.push("notes=?"); params.push(notes); }
    if (unit_id !== undefined) { updates.push("unit_id=?"); params.push(unit_id || null); }
    if (restaurant_id !== undefined) { updates.push("restaurant_id=?"); params.push(restaurant_id); }
    if (status !== undefined) { updates.push("status=?"); params.push(status); }

    if (req.file) {
      const image_url = `/uploads/${req.file.filename}`;
      updates.push("image_url=?");
      params.push(image_url);
    }

    if (updates.length) {
      params.push(req.params.id);
      await db.query(
        `UPDATE products SET ${updates.join(", ")} WHERE id=?`,
        params
      );
    }

    if (category_ids !== undefined) {
      await db.query("DELETE FROM product_categories WHERE product_id=?", [req.params.id]);

      let cats = [];
      try {
        cats = typeof category_ids === "string"
          ? JSON.parse(category_ids)
          : category_ids;
      } catch {}

      for (const cid of cats) {
        await db.query(
          "INSERT INTO product_categories (product_id, category_id) VALUES (?, ?)",
          [req.params.id, cid]
        );
      }
    }

    res.json({ success: true, message: "✅ تم تعديل المنتج" });
  } catch (err) {
    console.error("UPDATE PRODUCT ERROR:", err);
    res.status(500).json({ success: false });
  }
});

/* ======================================================
   🗑️ حذف منتج
====================================================== */
router.delete("/:id", async (req, res) => {
  try {
    await db.query("DELETE FROM product_categories WHERE product_id=?", [req.params.id]);
    await db.query("DELETE FROM products WHERE id=?", [req.params.id]);
    res.json({ success: true, message: "🗑️ تم حذف المنتج" });
  } catch (err) {
    console.error("DELETE PRODUCT ERROR:", err);
    res.status(500).json({ success: false });
  }
});

export default router;
