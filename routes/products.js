import express from "express";
import db from "../db.js";
import upload, { uploadToCloudinary } from "../middlewares/upload.js";
import auth from "../middlewares/auth.js";
import { ensureProductsI18nSchema } from "../utils/catalogI18n.js";

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

function parseRestaurantIds(body = {}) {
  let ids = parseJsonArray(body.restaurant_ids, null);
  if (ids === null) {
    ids = body.restaurant_id ? [body.restaurant_id] : [];
  }
  return [
    ...new Set(
      ids.map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0)
    ),
  ];
}

function bodyHasRestaurantIds(body = {}) {
  return (
    body.restaurant_ids !== undefined ||
    (body.restaurant_id !== undefined &&
      body.restaurant_id !== null &&
      body.restaurant_id !== "")
  );
}

async function syncProductRestaurants(productId, restaurantIds) {
  await db.query("DELETE FROM product_restaurants WHERE product_id = ?", [
    productId,
  ]);
  for (const rid of restaurantIds) {
    await db.query(
      "INSERT INTO product_restaurants (product_id, restaurant_id) VALUES (?, ?)",
      [productId, rid]
    );
  }
  await db.query("UPDATE products SET restaurant_id = ? WHERE id = ?", [
    restaurantIds[0] || null,
    productId,
  ]);
}

async function assertRestaurantsAllowed(restaurantIds, user) {
  const { role, id: userId, branch_id, is_admin_branch, agent_id: authAgentId } =
    user || {};

  for (const restaurant_id of restaurantIds) {
    let restaurantSql = `SELECT id FROM restaurants WHERE id = ?`;
    const restaurantParams = [restaurant_id];

    if (role === "agent") {
      restaurantSql += ` AND agent_id = ?`;
      restaurantParams.push(userId);
    } else if (authAgentId) {
      restaurantSql += ` AND agent_id = ?`;
      restaurantParams.push(authAgentId);
    } else if (!is_admin_branch) {
      restaurantSql += ` AND branch_id = ?`;
      restaurantParams.push(branch_id);
    }

    const [[allowedRestaurant]] = await db.query(
      restaurantSql,
      restaurantParams
    );
    if (!allowedRestaurant) {
      return false;
    }
  }

  return true;
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
    console.error("GET CHILDREN ERROR:", err?.message || err);
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
    console.error("GET PRODUCTS BY CATEGORY ERROR:", err?.message || err);
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
  const { role, id: userId, is_admin_branch, branch_id, agent_id: authAgentId } = user;

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
    await ensureProductsI18nSchema();
    let rows;
    let where = `WHERE p.name LIKE ?`;
    const params = [`%${search}%`];

    if (role === "agent") {
      where += ` AND r.agent_id = ?`;
      params.push(userId);
    } else if (authAgentId) {
      where += ` AND r.agent_id = ?`;
      params.push(authAgentId);
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
        p.name_en,
        p.price,
        p.image_url,
        p.notes,
        p.notes_en,
        p.is_available,
        p.is_parent,
        GROUP_CONCAT(DISTINCT c.id) AS category_ids,
        GROUP_CONCAT(DISTINCT c.name SEPARATOR ', ') AS categories,
        u.id AS unit_id,
        u.name AS unit_name,
        COALESCE(MIN(pr.restaurant_id), p.restaurant_id) AS restaurant_id,
        GROUP_CONCAT(DISTINCT COALESCE(pr.restaurant_id, p.restaurant_id) ORDER BY COALESCE(pr.restaurant_id, p.restaurant_id)) AS restaurant_ids,
        GROUP_CONCAT(DISTINCT r.name ORDER BY r.name SEPARATOR ', ') AS restaurant_names,
        MIN(r.name) AS restaurant_name,
        MIN(r.branch_id) AS branch_id,
        MIN(b.name) AS branch_name,
        COUNT(DISTINCT pc2.child_id) AS children_count
      FROM products p
      LEFT JOIN product_categories pc ON p.id = pc.product_id
      LEFT JOIN categories c ON pc.category_id = c.id
      LEFT JOIN units u ON p.unit_id = u.id
      LEFT JOIN product_restaurants pr ON pr.product_id = p.id
      LEFT JOIN restaurants r ON r.id = COALESCE(pr.restaurant_id, p.restaurant_id)
      LEFT JOIN branches b ON b.id = r.branch_id
      LEFT JOIN product_children pc2 ON pc2.parent_id = p.id
      ${where}
      GROUP BY p.id
      ORDER BY p.id DESC
      `,
      params
    );

    const products = (rows || []).map((row) => ({
      ...row,
      restaurant_ids: String(row.restaurant_ids || row.restaurant_id || "")
        .split(",")
        .map((x) => Number(x))
        .filter(Boolean),
      restaurant_name: row.restaurant_names || row.restaurant_name || null,
    }));

    res.json({ success: true, products });
  } catch (err) {
    console.error("GET PRODUCTS ERROR:", err?.message || err);
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
    await ensureProductsI18nSchema();
    const user = req.user || {};
    const { role, id: userId, branch_id, is_admin_branch, agent_id: authAgentId } = user;

    const {
      name,
      name_en = null,
      price,
      notes,
      notes_en = null,
      unit_id,
      restaurant_id,
      category_ids = [],
      is_available = "1",
      is_parent = "0",
      children = [],
      image_url: bodyImageUrl,
    } = req.body;

    const restaurantIds = parseRestaurantIds(req.body);

    if (!name || !String(name).trim()) {
      return res.status(400).json({
        success: false,
        message: "اسم المنتج مطلوب",
      });
    }

    if (!restaurantIds.length) {
      return res.status(400).json({
        success: false,
        message: "اختر مطعماً واحداً على الأقل",
      });
    }

    const allowed = await assertRestaurantsAllowed(restaurantIds, user);
    if (!allowed) {
      return res.status(403).json({
        success: false,
        message: "غير مصرح باستخدام أحد المطاعم المحددة",
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

      try {
        const uploaded = await uploadToCloudinary(req.file.buffer, "products");
        image_url = uploaded.secure_url;
      } catch (cloudErr) {
        console.error("PRODUCT IMAGE CLOUDINARY:", cloudErr?.message || cloudErr);
      }
    }

    const [result] = await db.query(
      `
      INSERT INTO products
        (name, name_en, price, image_url, notes, notes_en, unit_id, restaurant_id, is_available, is_parent, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
      `,
      [
        String(name).trim(),
        name_en || null,
        isParentVal ? null : (price || null),
        image_url,
        notes || "",
        notes_en || null,
        unit_id || null,
        restaurantIds[0],
        isAvailableVal,
        isParentVal,
      ]
    );

    const productId = result.insertId;
    await syncProductRestaurants(productId, restaurantIds);

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
    console.error("CREATE PRODUCT ERROR RAW:", err?.message || err);
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
    await ensureProductsI18nSchema();
    const user = req.user || {};
    const { role, id: userId, branch_id, is_admin_branch, agent_id: authAgentId } = user;

    const {
      name,
      name_en,
      price,
      notes,
      notes_en,
      unit_id,
      restaurant_id,
      category_ids,
      is_available,
      is_parent,
      children,
      image_url: bodyImageUrl,
    } = req.body;

    const restaurantIds = parseRestaurantIds(req.body);
    const hasRestaurantIds =
      restaurantIds.length > 0 ||
      bodyHasRestaurantIds(req.body);

    let productScopeSql = `
      SELECT p.id
      FROM products p
      LEFT JOIN product_restaurants pr ON pr.product_id = p.id
      LEFT JOIN restaurants r ON r.id = COALESCE(pr.restaurant_id, p.restaurant_id)
      WHERE p.id = ?
    `;
    const productScopeParams = [req.params.id];

    if (role === "agent") {
      productScopeSql += ` AND r.agent_id = ?`;
      productScopeParams.push(userId);
    } else if (authAgentId) {
      productScopeSql += ` AND r.agent_id = ?`;
      productScopeParams.push(authAgentId);
    } else if (!is_admin_branch) {
      productScopeSql += ` AND r.branch_id = ?`;
      productScopeParams.push(branch_id);
    }

    productScopeSql += ` GROUP BY p.id`;

    const [[scopedProduct]] = await db.query(productScopeSql, productScopeParams);
    if (!scopedProduct) {
      return res.status(403).json({
        success: false,
        message: "غير مصرح بتعديل هذا المنتج",
      });
    }

    if (hasRestaurantIds) {
      if (!restaurantIds.length) {
        return res.status(400).json({
          success: false,
          message: "اختر مطعماً واحداً على الأقل",
        });
      }

      const allowed = await assertRestaurantsAllowed(restaurantIds, user);
      if (!allowed) {
        return res.status(403).json({
          success: false,
          message: "غير مصرح بنقل المنتج إلى أحد المطاعم المحددة",
        });
      }
    }

    const updates = [];
    const params = [];

    if (name !== undefined) {
      updates.push("name=?");
      params.push(String(name).trim());
    }

    if (name_en !== undefined) {
      updates.push("name_en=?");
      params.push(name_en || null);
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

    if (notes_en !== undefined) {
      updates.push("notes_en=?");
      params.push(notes_en || null);
    }

    if (unit_id !== undefined) {
      updates.push("unit_id=?");
      params.push(unit_id || null);
    }

    if (hasRestaurantIds) {
      updates.push("restaurant_id=?");
      params.push(restaurantIds[0] || null);
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

      const uploaded = await uploadToCloudinary(req.file.buffer, "products");

      updates.push("image_url=?");
      params.push(uploaded.secure_url);
    }

    if (updates.length) {
      params.push(req.params.id);
      await db.query(
        `UPDATE products SET ${updates.join(", ")} WHERE id=?`,
        params
      );
    }

    if (hasRestaurantIds) {
      await syncProductRestaurants(req.params.id, restaurantIds);
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
    console.error("UPDATE PRODUCT ERROR RAW:", err?.message || err);
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
    const user = req.user || {};
    const { role, id: userId, branch_id, is_admin_branch, agent_id: authAgentId } = user;

    let productScopeSql = `
      SELECT p.id
      FROM products p
      LEFT JOIN restaurants r ON r.id = p.restaurant_id
      WHERE p.id = ?
    `;
    const productScopeParams = [req.params.id];

    if (role === "agent") {
      productScopeSql += ` AND r.agent_id = ?`;
      productScopeParams.push(userId);
    } else if (authAgentId) {
      productScopeSql += ` AND r.agent_id = ?`;
      productScopeParams.push(authAgentId);
    } else if (!is_admin_branch) {
      productScopeSql += ` AND r.branch_id = ?`;
      productScopeParams.push(branch_id);
    }

    const [[scopedProduct]] = await db.query(productScopeSql, productScopeParams);
    if (!scopedProduct) {
      return res.status(403).json({
        success: false,
        message: "غير مصرح بحذف هذا المنتج",
      });
    }

    await db.query("DELETE FROM product_categories WHERE product_id=?", [req.params.id]);
    await db.query("DELETE FROM product_restaurants WHERE product_id=?", [
      req.params.id,
    ]);
    await db.query("DELETE FROM products WHERE id=?", [req.params.id]);

    res.json({ success: true, message: "🗑️ تم حذف المنتج" });
  } catch (err) {
    console.error("DELETE PRODUCT ERROR:", err?.message || err);
    res.status(500).json({
      success: false,
      message: err.message || "خطأ في السيرفر",
    });
  }
});

export default routerInstance;
