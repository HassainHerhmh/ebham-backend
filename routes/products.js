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
   🟢 جلب جميع المنتجات (مع فلترة حسب الفرع)
====================================================== */
router.get("/", auth, async (req, res) => {
  const user = req.user || {};
  const { is_admin_branch, branch_id } = user;

  let selectedBranch = req.headers["x-branch-id"];

  if (selectedBranch === "all") {
    selectedBranch = null;
  }

  try {
    let rows;

    if (is_admin_branch) {
      if (selectedBranch) {
        // إدارة عامة + فرع محدد
        [rows] = await db.query(`
          SELECT 
            p.id, p.name, p.price, p.image_url, p.notes,
            GROUP_CONCAT(c.id) AS category_ids,
            GROUP_CONCAT(c.name SEPARATOR ', ') AS categories,
            u.id AS unit_id, u.name AS unit_name,
            r.id AS restaurant_id, r.name AS restaurant_name
          FROM products p
          LEFT JOIN product_categories pc ON p.id = pc.product_id
          LEFT JOIN categories c ON pc.category_id = c.id
          LEFT JOIN units u ON p.unit_id = u.id
          LEFT JOIN restaurants r ON p.restaurant_id = r.id
          WHERE r.branch_id = ?
          GROUP BY p.id
          ORDER BY p.id DESC
        `, [selectedBranch]);
      } else {
        // إدارة عامة بدون تحديد فرع → كل المنتجات
        [rows] = await db.query(`
          SELECT 
            p.id, p.name, p.price, p.image_url, p.notes,
            GROUP_CONCAT(c.id) AS category_ids,
            GROUP_CONCAT(c.name SEPARATOR ', ') AS categories,
            u.id AS unit_id, u.name AS unit_name,
            r.id AS restaurant_id, r.name AS restaurant_name
          FROM products p
          LEFT JOIN product_categories pc ON p.id = pc.product_id
          LEFT JOIN categories c ON pc.category_id = c.id
          LEFT JOIN units u ON p.unit_id = u.id
          LEFT JOIN restaurants r ON p.restaurant_id = r.id
          GROUP BY p.id
          ORDER BY p.id DESC
        `);
      }
    } else {
      // مستخدم فرع
      [rows] = await db.query(`
        SELECT 
          p.id, p.name, p.price, p.image_url, p.notes,
          GROUP_CONCAT(c.id) AS category_ids,
          GROUP_CONCAT(c.name SEPARATOR ', ') AS categories,
          u.id AS unit_id, u.name AS unit_name,
          r.id AS restaurant_id, r.name AS restaurant_name
        FROM products p
        LEFT JOIN product_categories pc ON p.id = pc.product_id
        LEFT JOIN categories c ON pc.category_id = c.id
        LEFT JOIN units u ON p.unit_id = u.id
        LEFT JOIN restaurants r ON p.restaurant_id = r.id
        WHERE r.branch_id = ?
        GROUP BY p.id
        ORDER BY p.id DESC
      `, [branch_id]);
    }

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
        message: "اسم المنتج، السعر، والمطعم مطلوبة",
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

    res.json({ success: true });
  } catch (err) {
    console.error("ADD PRODUCT ERROR:", err);
    res.status(500).json({ success: false });
  }
});

export default router;
