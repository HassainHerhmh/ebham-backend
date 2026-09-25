import express from "express";
import db from "../db.js";
import auth from "../middlewares/auth.js";
import { emitCatalogUpdate } from "../utils/catalogEvents.js";
import { resolveScopedBranchId } from "../utils/adminRealtime.js";

import { body, validationResult } from "express-validator";
import rateLimit from "express-rate-limit";

const router = express.Router();

/* =====================================
   Rate Limit (منع السبام)
===================================== */
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: "طلبات كثيرة، حاول لاحقاً",
});

/* =====================================
   Validation قوي
===================================== */
const validateAd = [
  body("name")
    .isLength({ min: 3, max: 100 })
    .withMessage("اسم الإعلان غير صالح"),

  body("type")
    .isIn(["discount", "offer", "banner"])
    .withMessage("نوع الإعلان غير صحيح"),

  body("discount_percent")
    .optional()
    .isFloat({ min: 0, max: 100 })
    .withMessage("نسبة الخصم غير صحيحة"),

  body("image_url")
    .optional()
    .isURL()
    .withMessage("رابط الصورة غير صحيح"),

  body("start_date")
    .optional()
    .isISO8601()
    .withMessage("تاريخ البداية غير صحيح"),

  body("end_date")
    .optional()
    .isISO8601()
    .withMessage("تاريخ النهاية غير صحيح"),
];

const checkValidation = (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      errors: errors.array(),
    });
  }
};

/* تنظيف البيانات */
const clean = (text) => {
  if (!text) return text;
  return text.replace(/[<>$;]/g, "").trim();
};

function canManageAds(user) {
  if (!user) return false;
  const role = String(user.role || "").toLowerCase();
  return role !== "customer" && role !== "captain";
}

function adsBranchSql(alias = "ads") {
  return `(
    ${alias}.branch_id = ?
    OR (
      ${alias}.branch_id IS NULL
      AND restaurants.branch_id = ?
    )
  )`;
}

async function assertAdInBranch(id, branchId) {
  if (!branchId) return null;
  const [[row]] = await db.query(
    `
      SELECT ads.*
      FROM ads
      LEFT JOIN restaurants ON restaurants.id = ads.restaurant_id
      WHERE ads.id = ?
        AND ${adsBranchSql()}
      LIMIT 1
    `,
    [id, branchId, branchId]
  );
  return row || null;
}

/* =====================================
   جلب الإعلانات (مفتوح)
===================================== */
router.get("/", async (req, res) => {
  try {
    const branchId = resolveScopedBranchId(req);
    if (!branchId) {
      return res.json([]);
    }

    const [rows] = await db.query(
      `
      SELECT 
        ads.*,
        restaurants.name AS restaurant_name
      FROM ads
      LEFT JOIN restaurants
        ON ads.restaurant_id = restaurants.id
      WHERE ads.status = 'active'
        AND (ads.start_date IS NULL OR ads.start_date <= NOW())
        AND (ads.end_date IS NULL OR ads.end_date >= NOW())
        AND ${adsBranchSql()}
      ORDER BY ads.id DESC
    `,
      [branchId, branchId]
    );

    res.json(rows);
  } catch (err) {
    console.error("GET ADS ERROR:", err?.message || err);
    res.json([]);
  }
});

/* =====================================
   جلب admin (محمي)
===================================== */
router.get("/admin", auth, async (req, res) => {
  try {
    if (!canManageAds(req.user)) {
      return res.status(403).json({ error: "غير مصرح" });
    }

    const branchId = resolveScopedBranchId(req);
    if (!branchId) {
      return res.json([]);
    }

    const [rows] = await db.query(
      `
      SELECT ads.*, restaurants.name AS restaurant_name
      FROM ads
      LEFT JOIN restaurants
      ON ads.restaurant_id = restaurants.id
      WHERE ${adsBranchSql()}
      ORDER BY ads.id DESC
    `,
      [branchId, branchId]
    );

    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "فشل تحميل الإعلانات" });
  }
});

/* =====================================
   إنشاء إعلان (محمي + validation)
===================================== */
router.post("/", limiter, auth, validateAd, async (req, res) => {
  try {
    if (!canManageAds(req.user)) {
      return res.status(403).json({ error: "غير مصرح" });
    }

    const validationError = checkValidation(req, res);
    if (validationError) return;

    let {
      name,
      description,
      type,
      image_url,
      restaurant_id,
      category_id,
      product_ids,
      discount_percent,
      start_date,
      end_date
    } = req.body;

    const branchId = resolveScopedBranchId(req);
    if (!branchId) {
      return res.status(400).json({ error: "حدد الفرع أولاً" });
    }

    if (restaurant_id) {
      const [[store]] = await db.query(
        "SELECT id, branch_id FROM restaurants WHERE id = ? LIMIT 1",
        [restaurant_id]
      );
      if (!store || Number(store.branch_id) !== Number(branchId)) {
        return res.status(400).json({ error: "المحل لا يتبع هذا الفرع" });
      }
    }

    // تنظيف
    name = clean(name);
    description = clean(description);

    // منع spam (أرقام فقط)
    if (/^\d+$/.test(name)) {
      return res.status(400).json({
        error: "اسم الإعلان غير منطقي",
      });
    }

    // تحقق التواريخ
    if (start_date && end_date && new Date(start_date) > new Date(end_date)) {
      return res.status(400).json({
        error: "تاريخ البداية أكبر من النهاية",
      });
    }

    const [result] = await db.query(`
      INSERT INTO ads
      (name,description,type,image_url,restaurant_id,category_id,discount_percent,start_date,end_date,status,branch_id)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)
    `,[
      name,
      description || null,
      type,
      image_url || null,
      restaurant_id || null,
      category_id || null,
      discount_percent || null,
      start_date || null,
      end_date || null,
      "active",
      branchId
    ]);

const adId = result.insertId;

req.app.get("io")?.emit("notification", {
  type: "ad",
  id: adId,
  title: "إعلان جديد",
  message: discount_percent
    ? `${name} - خصم ${discount_percent}%`
    : name,
  image_url: image_url || null,
  restaurant_id: restaurant_id || null,
});
emitCatalogUpdate(req.app, { entity: "ads", action: "create" });

if(product_ids?.length){
  for(const p of product_ids){
    await db.query(
      "INSERT INTO ad_products (ad_id,product_id) VALUES (?,?)",
      [adId,p]
    );
  }
}


    res.json({ success:true, id:adId });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "فشل إنشاء الإعلان" });
  }
});

/* =====================================
   تعديل (محمي + validation)
===================================== */
router.put("/:id", limiter, auth, validateAd, async (req, res) => {
  try {
    if (!canManageAds(req.user)) {
      return res.status(403).json({ error: "غير مصرح" });
    }

    const validationError = checkValidation(req, res);
    if (validationError) return;

    const { id } = req.params;
    const branchId = resolveScopedBranchId(req);
    const existing = await assertAdInBranch(id, branchId);
    if (!existing) {
      return res.status(404).json({ error: "الإعلان غير موجود في هذا الفرع" });
    }

    let {
      name,
      description,
      type,
      image_url,
      restaurant_id,
      category_id,
      product_ids,
      discount_percent,
      start_date,
      end_date,
      status
    } = req.body;

    if (restaurant_id) {
      const [[store]] = await db.query(
        "SELECT id, branch_id FROM restaurants WHERE id = ? LIMIT 1",
        [restaurant_id]
      );
      if (!store || Number(store.branch_id) !== Number(branchId)) {
        return res.status(400).json({ error: "المحل لا يتبع هذا الفرع" });
      }
    }

    name = clean(name);
    description = clean(description);

    const formatDate = (d) =>
      d ? new Date(d).toISOString().slice(0,19).replace("T"," ") : null;

    await db.query(`
      UPDATE ads SET
      name=?,description=?,type=?,image_url=?,restaurant_id=?,category_id=?,discount_percent=?,start_date=?,end_date=?,status=COALESCE(?,status),branch_id=?
      WHERE id=?
    `,[
      name,
      description || null,
      type,
      image_url || null,
      restaurant_id || null,
      category_id || null,
      discount_percent || null,
      formatDate(start_date),
      formatDate(end_date),
      status,
      branchId,
      id
    ]);

    await db.query("DELETE FROM ad_products WHERE ad_id=?", [id]);

    if(product_ids?.length){
      for(const p of product_ids){
        await db.query(
          "INSERT INTO ad_products (ad_id,product_id) VALUES (?,?)",
          [id,p]
        );
      }
    }

    res.json({ success:true });
    emitCatalogUpdate(req.app, { entity: "ads", action: "update" });

  } catch (err) {
    res.status(500).json({ error:"فشل تعديل الإعلان" });
  }
});

/* =====================================
   حذف (محمي)
===================================== */
router.delete("/:id", auth, async (req, res) => {
  try {
    if (!canManageAds(req.user)) {
      return res.status(403).json({ error: "غير مصرح" });
    }

    const { id } = req.params;
    const branchId = resolveScopedBranchId(req);
    const existing = await assertAdInBranch(id, branchId);
    if (!existing) {
      return res.status(404).json({ error: "الإعلان غير موجود في هذا الفرع" });
    }

    await db.query("DELETE FROM ad_products WHERE ad_id=?", [id]);
    await db.query("DELETE FROM ads WHERE id=?", [id]);

    res.json({ success:true });
    emitCatalogUpdate(req.app, { entity: "ads", action: "delete" });

  } catch {
    res.status(500).json({ error:"فشل حذف الإعلان" });
  }
});

/* =====================================
   view + click (مفتوح)
===================================== */
router.post("/:id/view", async (req, res) => {
  await db.query("UPDATE ads SET views=views+1 WHERE id=?", [req.params.id]);
  res.json({ success:true });
});

router.post("/:id/click", async (req, res) => {
  await db.query("UPDATE ads SET clicks=clicks+1 WHERE id=?", [req.params.id]);
  res.json({ success:true });
});

/* =====================================
   تغيير الحالة (محمي)
===================================== */
router.patch("/:id/status", auth, async (req,res)=>{
  try{
    if (!canManageAds(req.user)) {
      return res.status(403).json({ error: "غير مصرح" });
    }

    const branchId = resolveScopedBranchId(req);
    const existing = await assertAdInBranch(req.params.id, branchId);
    if (!existing) {
      return res.status(404).json({ error: "الإعلان غير موجود في هذا الفرع" });
    }

    await db.query(
      "UPDATE ads SET status=? WHERE id=?",
      [req.body.status, req.params.id]
    );

    res.json({success:true});
    emitCatalogUpdate(req.app, { entity: "ads", action: "status" });

  }catch{
    res.status(500).json({error:"update failed"});
  }
});

export default router;
