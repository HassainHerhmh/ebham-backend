import express from "express";
import db from "../db.js";
import upload, { uploadToCloudinary } from "../middlewares/upload.js";
import auth from "../middlewares/auth.js";

const router = express.Router();

function parseJsonArray(value, fallback = []) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === "") return fallback;

  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function isUnsafeImageUrl(value) {
  if (!value || typeof value !== "string") return false;
  const trimmed = value.trim().toLowerCase();
  return trimmed.startsWith("blob:") || trimmed.startsWith("data:");
}

/* ======================================================
   Router
====================================================== */
const routerInstance = express.Router();

/* ======================================================
   🟢 (APP/Public) جلب أبناء منتج معين (للخيارات)
====================================================== */
routerInstance.get("/:id/children", async (req, res) => {
  try {
    const [rows] = await db.query(
      `
      SELECT 
        p.id,
        p.name,
        p.price,
        p.image_url,
        p.notes,
        p.is_available,
        r.name AS restaurant_name,
        GROUP_CONCAT(c.name SEPARATOR ', ') AS categories
      FROM product_children pc
      JOIN products p ON p.id = pc.child_id
      LEFT JOIN product_categories pc2 ON p.id = pc2.product_id
      LEFT JOIN categories c ON pc2.category_id = c.id
      LEFT JOIN restaurants r ON p.restaurant_id = r.id
      WHERE pc.parent_id = ?
      GROUP BY p.id
      `,
      [req.params.id]
    );

    res.json({ success: true, children: rows });
  } catch (err) {
    console.error("GET CHILDREN ERROR:", err);
    res.status(500).json({ success: false, children: [] });
  }
});

/* ======================================================
   🟢 (Public) جلب منتجات فئة معينة للخصومات
====================================================== */
routerInstance.get("/by-category/:categoryId", async (req, res) => {
  try {
    const categoryId = req.params.categoryId;

    const [rows] = await db.query(
      `
      SELECT 
        p.id,
        p.name,
        p.price,
        IFNULL(
          ROUND(p.price - (p.price * ads.discount_percent / 100)),
          p.price
        ) AS final_price,
        ads.discount_percent
      FROM products p
      INNER JOIN product_categories pc
        ON pc.product_id = p.id
      LEFT JOIN ad_products ap
        ON ap.product_id = p.id
      LEFT JOIN ads
        ON ads.id = ap.ad_id
        AND ads.status='active'
        AND (ads.start_date IS NULL OR ads.start_date <= NOW())
        AND (ads.end_date IS NULL OR ads.end_date >= NOW())
      WHERE pc.category_id = ?
      ORDER BY p.name ASC
      `,
      [categoryId]
    );

    res.json(rows);
  } catch (err) {
    console.error("GET PRODUCTS BY CATEGORY ERROR:", err);
    res.status(500).json([]);
  }
});

/* =========================
   🔐 حماية المسارات التالية
========================= */
routerInstance.use(auth);

/* ======================================================
   🟢 جلب جميع المنتجات
====================================================== */
routerInstance.get("/", async (req, res) => {
  const search = req.query.search || "";
  const user = req.user || {};
  const { role, id: userId, is_admin_branch, branch_id } = user;

  let selectedBranch = req.headers["x-branch-id"];

  if (selectedBranch === "all") {
    selectedBranch = null;
  }

  if (
    is_admin_branch &&
    selectedBranch &&
    Number(selectedBranch) === Number(branch_id)
  ) {
    selectedBranch = null;
  }

  try {
    let rows;
    let where = `WHERE p.name LIKE ?`;
    const params = [`%${search}%`];

    if (role === "agent") {
      where += ` AND r.agent_id = ?`;
      params.push(userId);
    } else if (is_admin_branch) {
      if (selectedBranch) {
        where += ` AND r.branch_id = ?`;
        params.push(selectedBranch);
      }
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
        p.is_available,
        p.is_parent,
        GROUP_CONCAT(DISTINCT c.id) AS category_ids,
        GROUP_CONCAT(DISTINCT c.name SEPARATOR ', ') AS categories,
        u.id AS unit_id,
        u.name AS unit_name,
        r.id AS restaurant_id,
        r.name AS restaurant_name,
        r.branch_id,
        b.name AS branch_name,
        COUNT(DISTINCT pc2.child_id) AS children_count
      FROM products p
      LEFT JOIN product_categories pc ON p.id = pc.product_id
      LEFT JOIN categories c ON pc.category_id = c.id
      LEFT JOIN units u ON p.unit_id = u.id
      LEFT JOIN restaurants r ON p.restaurant_id = r.id
      LEFT JOIN branches b ON b.id = r.branch_id
      LEFT JOIN product_children pc2 ON pc2.parent_id = p.id
      ${where}
      GROUP BY p.id
      ORDER BY p.id DESC
      `,
      params
    );

    res.json({ success: true, products: rows });
  } catch (err) {
    console.error("GET PRODUCTS ERROR:", err);
    res.status(500).json({
      success: false,
      message: err.message || "خطأ في السيرفر",
    });
  }
});

/* ======================================================
   ✅ إضافة منتج جديد
====================================================== */
routerInstance.post("/", upload.single("image"), async (req, res) => {
  try {
    const {
      name,
      price,
      notes,
      unit_id,
      restaurant_id,
      category_ids = [],
      is_available = "1",
      is_parent = "0",
      children = [],
      image_url: bodyImageUrl,
    } = req.body;

    if (!name || !String(name).trim()) {
      return res.status(400).json({
        success: false,
        message: "اسم المنتج مطلوب",
      });
    }

    if (!restaurant_id) {
      return res.status(400).json({
        success: false,
        message: "المطعم مطلوب",
      });
    }

    if (Number(is_parent) !== 1 && (price === undefined || price === null || price === "")) {
      return res.status(400).json({
        success: false,
        message: "السعر مطلوب",
      });
    }

    const isAvailableVal = Number(is_available) === 1 ? 1 : 0;
    const isParentVal = Number(is_parent) === 1 ? 1 : 0;

    let image_url = bodyImageUrl || null;

    if (isUnsafeImageUrl(image_url)) {
      image_url = null;
    }

    if (req.file) {
      if (!req.file.buffer) {
        return res.status(400).json({
          success: false,
          message: "ملف الصورة غير صالح",
        });
      }

      console.log("CREATE PRODUCT IMAGE UPLOAD START", {
        hasFile: true,
        mimeType: req.file.mimetype,
        size: req.file.size,
      });

      const uploaded = await uploadToCloudinary(req.file.buffer, "products");
      image_url = uploaded.secure_url;

      console.log("CREATE PRODUCT IMAGE UPLOAD OK", {
        secure_url: uploaded.secure_url,
      });
    }

    const [result] = await db.query(
      `
      INSERT INTO products
        (name, price, image_url, notes, unit_id, restaurant_id, is_available, is_parent, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())
      `,
      [
        String(name).trim(),
        isParentVal ? null : (price || null),
        image_url,
        notes || "",
        unit_id || null,
        restaurant_id,
        isAvailableVal,
        isParentVal,
      ]
    );

    const productId = result.insertId;

    const cats = parseJsonArray(category_ids, []);
    for (const cid of cats) {
      await db.query(
        "INSERT INTO product_categories (product_id, category_id) VALUES (?, ?)",
        [productId, cid]
      );
    }

    const kids = parseJsonArray(children, []);
    for (const childId of kids) {
      await db.query(
        "INSERT INTO product_children (parent_id, child_id) VALUES (?, ?)",
        [productId, childId]
      );
    }

    res.json({
      success: true,
      message: "✅ تم إضافة المنتج",
      image_url,
      product_id: productId,
    });
  } catch (err) {
    console.error("CREATE PRODUCT ERROR RAW:", err);
    console.error("CREATE PRODUCT ERROR JSON:", JSON.stringify(err, null, 2));

    res.status(500).json({
      success: false,
      message: err.message || "خطأ في السيرفر",
    });
  }
});

/* ======================================================
   ✏️ تعديل منتج
====================================================== */
routerInstance.put("/:id", upload.single("image"), async (req, res) => {
  try {
    const {
      name,
      price,
      notes,
      unit_id,
      restaurant_id,
      category_ids,
      is_available,
      is_parent,
      children,
      image_url: bodyImageUrl,
    } = req.body;

    const updates = [];
    const params = [];

    if (name !== undefined) {
      updates.push("name=?");
      params.push(String(name).trim());
    }

    if (price !== undefined) {
      if (price === "") {
        updates.push("price=NULL");
      } else {
        updates.push("price=?");
        params.push(price);
      }
    }

    if (notes !== undefined) {
      updates.push("notes=?");
      params.push(notes);
    }

    if (unit_id !== undefined) {
      updates.push("unit_id=?");
      params.push(unit_id || null);
    }

    if (restaurant_id !== undefined) {
      updates.push("restaurant_id=?");
      params.push(restaurant_id || null);
    }

    if (is_available !== undefined) {
      updates.push("is_available=?");
      params.push(Number(is_available) === 1 ? 1 : 0);
    }

    if (is_parent !== undefined) {
      updates.push("is_parent=?");
      params.push(Number(is_parent) === 1 ? 1 : 0);
    }

    if (bodyImageUrl !== undefined) {
      const safeBodyImageUrl = isUnsafeImageUrl(bodyImageUrl) ? null : (bodyImageUrl || null);
      updates.push("image_url=?");
      params.push(safeBodyImageUrl);
    }

    if (req.file) {
      if (!req.file.buffer) {
        return res.status(400).json({
          success: false,
          message: "ملف الصورة غير صالح",
        });
      }

      console.log("UPDATE PRODUCT IMAGE UPLOAD START", {
        productId: req.params.id,
        hasFile: true,
        mimeType: req.file.mimetype,
        size: req.file.size,
      });

      const uploaded = await uploadToCloudinary(req.file.buffer, "products");

      updates.push("image_url=?");
      params.push(uploaded.secure_url);

      console.log("UPDATE PRODUCT IMAGE UPLOAD OK", {
        productId: req.params.id,
        secure_url: uploaded.secure_url,
      });
    }

    if (updates.length) {
      params.push(req.params.id);
      await db.query(
        `UPDATE products SET ${updates.join(", ")} WHERE id=?`,
        params
      );
    }

    if (category_ids !== undefined) {
      await db.query(
        "DELETE FROM product_categories WHERE product_id=?",
        [req.params.id]
      );

      const cats = parseJsonArray(category_ids, []);
      for (const cid of cats) {
        await db.query(
          "INSERT INTO product_categories (product_id, category_id) VALUES (?, ?)",
          [req.params.id, cid]
        );
      }
    }

    if (children !== undefined) {
      await db.query(
        "DELETE FROM product_children WHERE parent_id=?",
        [req.params.id]
      );

      const kids = parseJsonArray(children, []);
      for (const childId of kids) {
        await db.query(
          "INSERT INTO product_children (parent_id, child_id) VALUES (?, ?)",
          [req.params.id, childId]
        );
      }
    }

    res.json({
      success: true,
      message: "✅ تم تعديل المنتج",
    });
  } catch (err) {
    console.error("UPDATE PRODUCT ERROR RAW:", err);
    console.error("UPDATE PRODUCT ERROR JSON:", JSON.stringify(err, null, 2));

    res.status(500).json({
      success: false,
      message: err.message || "خطأ في السيرفر",
    });
  }
});

/* ======================================================
   🗑️ حذف منتج
====================================================== */
routerInstance.delete("/:id", async (req, res) => {
  try {
    await db.query("DELETE FROM product_categories WHERE product_id=?", [req.params.id]);
    await db.query("DELETE FROM products WHERE id=?", [req.params.id]);

    res.json({ success: true, message: "🗑️ تم حذف المنتج" });
  } catch (err) {
    console.error("DELETE PRODUCT ERROR:", err);
    res.status(500).json({
      success: false,
      message: err.message || "خطأ في السيرفر",
    });
  }
});

export default routerInstance;
