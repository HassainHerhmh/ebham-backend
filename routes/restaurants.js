import express from "express";
import db from "../db.js";
import auth from "../middlewares/auth.js";
import upload, { uploadToCloudinary } from "../middlewares/upload.js";

const router = express.Router();


/* ======================================================
   🟢 جلب كل المحلات للتطبيق (حسب الفرع)
====================================================== */
router.get("/app", async (req, res) => {
  try {
    const branch = req.headers["x-branch-id"] || null;

    const where = (branch && branch !== "null")
      ? "WHERE r.branch_id = ?"
      : "";
    const params = (branch && branch !== "null") ? [branch] : [];

    const [rows] = await db.query(
      `
      SELECT 
        r.id,
        r.name,
        r.address,
        r.image_url,
        r.sort_order,
        r.branch_id,
        r.type_id,

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
        END AS is_open

      FROM restaurants r
      ${where}
      ORDER BY r.sort_order ASC
      `,
      params
    );

    res.json({ success: true, restaurants: rows });
  } catch (err) {
    console.error("❌ خطأ في جلب المحلات للتطبيق:", err);
    res.status(500).json({ success: false });
  }
});
;
/* =========================
   حماية كل المسارات
========================= */
router.use(auth);

/* ======================================================
   🟢 جلب جميع المطاعم مع الفئات + التوقيت + الترتيب
====================================================== */
router.get("/", async (req, res) => {
  try {
    const { is_admin_branch, branch_id } = req.user;
    const selectedBranch = req.headers["x-branch-id"];

    let where = "";
    let params = [];

    if (is_admin_branch) {
      if (selectedBranch && Number(selectedBranch) !== Number(branch_id)) {
        where = "WHERE r.branch_id = ?";
        params.push(selectedBranch);
      }
    } else {
      where = "WHERE r.branch_id = ?";
      params.push(branch_id);
    }

    const [rows] = await db.query(
      `
      SELECT 
        r.id,
        r.name,
        r.address,
        r.phone,
        r.image_url,
        r.map_url,
        r.created_at,
        r.sort_order,
        r.type_id,
        r.branch_id,
        r.agent_id,
        b.name AS branch_name,
        a.name AS agent_name,

        COALESCE(GROUP_CONCAT(DISTINCT c.name SEPARATOR ', '), '') AS categories,
        COALESCE(GROUP_CONCAT(DISTINCT c.id SEPARATOR ','), '')    AS category_ids

      FROM restaurants r
      LEFT JOIN branches b ON b.id = r.branch_id
      LEFT JOIN agents a ON a.id = r.agent_id
      LEFT JOIN restaurant_categories rc 
        ON r.id = rc.restaurant_id
      LEFT JOIN categories c 
        ON rc.category_id = c.id

      ${where}
      GROUP BY r.id
      ORDER BY r.sort_order ASC
      `,
      params
    );

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
      map_url = null,
      category_ids = [],
      schedule = "[]",
      type_id = null,
       agent_id = null, 
    } = req.body;

    if (!name) {
      return res.status(400).json({ success: false, message: "❌ اسم المطعم مطلوب" });
    }

    const { is_admin_branch, branch_id } = req.user;
    const selectedBranch = req.headers["x-branch-id"];

    let finalBranchId = branch_id;
    if (is_admin_branch && selectedBranch) {
      finalBranchId = selectedBranch;
    }

    let image_url = null;
    if (req.file) {
      const result = await uploadToCloudinary(req.file.path, "restaurants");
      image_url = result.secure_url;
    }

    const [[{ maxOrder }]] = await db.query(
      "SELECT COALESCE(MAX(sort_order), 0) AS maxOrder FROM restaurants WHERE branch_id=?",
      [finalBranchId]
    );

    const [result] = await db.query(
      `INSERT INTO restaurants
       (name, type_id, address, phone, image_url, map_url, sort_order, branch_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [name, type_id || null, address, phone, image_url, map_url, maxOrder + 1, finalBranchId, agent_id || null,]
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
      map_url,
      category_ids,
      schedule,
      type_id = null,
         agent_id = null, // 👈 جديد
    } = req.body;

    const updates = [];
    const params = [];

    if (name !== undefined) { updates.push("name=?"); params.push(name); }
    if (address !== undefined) { updates.push("address=?"); params.push(address); }
    if (phone !== undefined) { updates.push("phone=?"); params.push(phone); }
    if (map_url !== undefined) { updates.push("map_url=?"); params.push(map_url || null); }
    if (type_id !== undefined) { updates.push("type_id=?"); params.push(type_id || null); }

     if (agent_id !== undefined) {
  updates.push("agent_id=?");
  params.push(agent_id || null);
}

    if (req.file) {
      const result = await uploadToCloudinary(req.file.path, "restaurants");
      updates.push("image_url=?");
      params.push(result.secure_url);
    }

    if (updates.length) {
      params.push(req.params.id);
      await db.query(`UPDATE restaurants SET ${updates.join(", ")} WHERE id=?`, params);
    }

    // الفئات
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

    // التوقيت
    if (schedule !== undefined) {
      await db.query("DELETE FROM restaurant_schedule WHERE restaurant_id=?", [req.params.id]);

      let sch = [];
      try {
        sch = typeof schedule === "string" ? JSON.parse(schedule) : schedule;
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
   🔀 تحديث ترتيب المطاعم (حسب الفرع)
====================================================== */
router.post("/reorder", async (req, res) => {
  try {
    const { order } = req.body;

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

/* ======================================================
   🟢 جلب فئات مطعم معيّن
====================================================== */
router.get("/:id/categories", async (req, res) => {
  try {
    const restaurantId = req.params.id;

    const [rows] = await db.query(
      `
      SELECT c.id, c.name
      FROM categories c
      INNER JOIN restaurant_categories rc
        ON rc.category_id = c.id
      WHERE rc.restaurant_id = ?
      ORDER BY c.id ASC
      `,
      [restaurantId]
    );

    res.json({ success: true, categories: rows });
  } catch (err) {
    console.error("❌ خطأ في جلب فئات المطعم:", err);
    res.status(500).json({ success: false });
  }
});

/* ======================================================
   🟢 جلب منتجات مطعم معين
====================================================== */
router.get("/:id/products", async (req, res) => {
  try {
    const restaurantId = req.params.id;

    const [rows] = await db.query(
      `
      SELECT 
        p.id,
        p.name,
        p.price,
        p.notes,
        GROUP_CONCAT(pc.category_id) AS category_ids
      FROM products p
      LEFT JOIN product_categories pc
        ON pc.product_id = p.id
      WHERE p.restaurant_id = ?
      GROUP BY p.id
      ORDER BY p.id DESC
      `,
      [restaurantId]
    );

    res.json({
      success: true,
      products: rows,
    });
  } catch (err) {
    console.error("GET RESTAURANT PRODUCTS ERROR:", err);
    res.status(500).json({ success: false, products: [] });
  }
});




export default router;
