import express from "express";
import db from "../db.js";
import auth from "../middlewares/auth.js";
import upload, { uploadToCloudinary } from "../middlewares/upload.js";
function extractLatLng(url) {
  if (!url) return null;

  const match = url.match(/@([-0-9.]+),([-0-9.]+)/);
  if (match) {
    return {
      lat: parseFloat(match[1]),
      lng: parseFloat(match[2])
    };
  }

  const qMatch = url.match(/q=([-0-9.]+),([-0-9.]+)/);
  if (qMatch) {
    return {
      lat: parseFloat(qMatch[1]),
      lng: parseFloat(qMatch[2])
    };
  }

  return null;
}

const router = express.Router();

/* ======================================================
   🟢 (APP) جلب فئات مطعم معيّن للتطبيق
====================================================== */
router.get("/app/:id/categories", async (req, res) => {
  try {
    const restaurantId = req.params.id;


    const [rows] = await db.query(
      `
      SELECT 
        c.id,
        c.name,
        c.image_url
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
    console.error("APP GET RESTAURANT CATEGORIES ERROR:", err);
    res.status(500).json({ success: false, categories: [] });
  }
});

router.get("/app/:id/products", async (req, res) => {
  try {

    const restaurantId = req.params.id;

    const [rows] = await db.query(`
SELECT 

p.id,
p.name,
p.price,
p.notes,
p.image_url,
p.restaurant_id,
(p.is_parent + 0) AS is_parent,
GROUP_CONCAT(pc.category_id) AS category_ids,

COALESCE(ads.discount_percent,0) AS discount_percent,

CASE
  WHEN ads.discount_percent IS NOT NULL
  THEN ROUND(p.price - (p.price * ads.discount_percent / 100))
  ELSE p.price
END AS final_price

FROM products p

LEFT JOIN product_categories pc
  ON pc.product_id = p.id

LEFT JOIN ads
  ON ads.restaurant_id = p.restaurant_id
  AND ads.status='active'
  AND (ads.start_date IS NULL OR ads.start_date <= NOW())
  AND (ads.end_date IS NULL OR ads.end_date >= NOW())

WHERE p.restaurant_id = ?

GROUP BY p.id
ORDER BY p.id DESC
`,[restaurantId]);

    res.json({
      success:true,
      products:rows
    });

  } catch(err){

    console.error("APP GET RESTAURANT PRODUCTS ERROR:",err);

    res.status(500).json({
      success:false,
      products:[]
    });

  }
});
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
    r.display_type,
    r.delivery_time,

    CASE 
      WHEN EXISTS (
        SELECT 1
        FROM restaurant_schedule s
        WHERE s.restaurant_id = r.id
          AND s.closed = 0
          AND s.day = 
            CASE DAYOFWEEK(NOW())
              WHEN 1 THEN 'الأحد'
              WHEN 2 THEN 'الإثنين'
              WHEN 3 THEN 'الثلاثاء'
              WHEN 4 THEN 'الأربعاء'
              WHEN 5 THEN 'الخميس'
              WHEN 6 THEN 'الجمعة'
              WHEN 7 THEN 'السبت'
            END
          AND (
            (s.start_time IS NULL AND s.end_time IS NULL)
            OR (CURTIME() BETWEEN s.start_time AND s.end_time)
          )
      )
      THEN 1 ELSE 0
    END AS is_open

  FROM restaurants r
  ${where}
  ORDER BY r.sort_order ASC
  `,
  params
);

    console.log("APP RESTAURANTS:", rows); // 👈 أضف هذا السطر

    res.json({ success: true, restaurants: rows });
  } catch (err) {
    console.error("❌ خطأ في جلب المحلات للتطبيق:", err);
    res.status(500).json({ success: false });
  }
});
/* ======================================================
   🟢 جلب مطاعم الفرع فقط (للتسويق)
====================================================== */

router.get("/list", async (req, res) => {
  try {

    const branchId = req.headers["x-branch-id"];

    if(!branchId){
      return res.json([]);
    }

    const [rows] = await db.query(`
      SELECT id, name
      FROM restaurants
      WHERE branch_id = ?
      ORDER BY name ASC
    `,[branchId]);

    res.json(rows);

  } catch (err) {

    console.error("LIST RESTAURANTS ERROR:", err);
    res.status(500).json([]);

  }
});
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
            r.display_type,   -- ✅ أضف هذا

        r.address,
        r.phone,
        r.image_url,
        r.map_url,
r.latitude,
r.longitude,
r.delivery_time,

        r.is_active,
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
       display_type = "product",
      agent_id = null,
      delivery_time = null,
      is_active = 1,
            image_url: bodyImageUrl,
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

         let image_url = bodyImageUrl || null; // خذ الرابط من الفورم إن وجد

if (req.file) {
  const result = await uploadToCloudinary(req.file.path, "restaurants");
  image_url = result.secure_url; // الملف يغلب على الرابط
}


    const [[{ maxOrder }]] = await db.query(
      "SELECT COALESCE(MAX(sort_order), 0) AS maxOrder FROM restaurants WHERE branch_id=?",
      [finalBranchId]
    );
const location = extractLatLng(map_url);
const latitude = location?.lat || null;
const longitude = location?.lng || null;

const [result] = await db.query(
  `INSERT INTO restaurants
   (name, type_id, display_type, address, phone, image_url, map_url, latitude, longitude, delivery_time, is_active, sort_order, branch_id, agent_id, created_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
  [
    name,
    type_id || null,
    display_type,
    address,
    phone,
    image_url,
    map_url,
    latitude,
    longitude,
    delivery_time || null,
    is_active ? 1 : 0,
    maxOrder + 1,
    finalBranchId,
    agent_id || null,
  ]
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
       display_type, // 👈 استقبال القيمة هنا
      agent_id = null,
      delivery_time,
      is_active,
          image_url: bodyImageUrl,
    } = req.body;

    const updates = [];
    const params = [];

    if (name !== undefined) { updates.push("name=?"); params.push(name); }
     if (display_type !== undefined) { updates.push("display_type=?"); params.push(display_type); } // 👈 تحديث القيمة
    if (address !== undefined) { updates.push("address=?"); params.push(address); }
    if (phone !== undefined) { updates.push("phone=?"); params.push(phone); }
if (map_url !== undefined) {
  updates.push("map_url=?");
  params.push(map_url || null);

  const location = extractLatLng(map_url);
  updates.push("latitude=?");
  params.push(location?.lat || null);

  updates.push("longitude=?");
  params.push(location?.lng || null);
}
    if (type_id !== undefined) { updates.push("type_id=?"); params.push(type_id || null); }

    if (agent_id !== undefined) {
      updates.push("agent_id=?");
      params.push(agent_id || null);
    }

    if (delivery_time !== undefined) {
      updates.push("delivery_time=?");
      params.push(delivery_time || null);
    }

 if (is_active !== undefined) {
  updates.push("is_active=?");
  params.push(Number(is_active));
}

  if (bodyImageUrl !== undefined) {
      updates.push("image_url=?");
      params.push(bodyImageUrl || null);
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
  const conn = await db.getConnection();
  try {
    const { order } = req.body;
    const { branch_id, is_admin_branch } = req.user;

    await conn.beginTransaction();

    for (const item of order) {
      if (is_admin_branch) {
        // الأدمن العام يستطيع تعديل أي فرع
        await conn.query(
          "UPDATE restaurants SET sort_order=? WHERE id=?",
          [item.sort_order, item.id]
        );
      } else {
        // مستخدم الفرع يعدّل فقط مطاعمه
        await conn.query(
          "UPDATE restaurants SET sort_order=? WHERE id=? AND branch_id=?",
          [item.sort_order, item.id, branch_id]
        );
      }
    }

    await conn.commit();
    res.json({ success: true });
  } catch (err) {
    await conn.rollback();
    console.error("❌ خطأ في إعادة الترتيب:", err);
    res.status(500).json({ success: false });
  } finally {
    conn.release();
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

    const [rows] = await db.query(`
SELECT 

p.id,
p.name,
p.price,
p.notes,
GROUP_CONCAT(pc.category_id) AS category_ids,

COALESCE(ads.discount_percent,0) AS discount_percent,

CASE
  WHEN ads.discount_percent IS NOT NULL
  THEN ROUND(p.price - (p.price * ads.discount_percent / 100))
  ELSE p.price
END AS final_price

FROM products p

LEFT JOIN product_categories pc
  ON pc.product_id = p.id

LEFT JOIN ads
  ON ads.restaurant_id = p.restaurant_id
  AND ads.status='active'
  AND (ads.start_date IS NULL OR ads.start_date <= NOW())
  AND (ads.end_date IS NULL OR ads.end_date >= NOW())

WHERE p.restaurant_id = ?

GROUP BY p.id
ORDER BY p.id DESC
`, [restaurantId]);

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
