import express from "express";
import db from "../db.js";

const router = express.Router();

/* =====================================
   جلب الإعلانات
===================================== */

router.get("/", async (req, res) => {

  try {

    const [rows] = await db.query(`
      SELECT 
        ads.*,
        restaurants.name AS restaurant_name
      FROM ads
      LEFT JOIN restaurants
        ON ads.restaurant_id = restaurants.id
      WHERE ads.status = 'active'
      AND (ads.start_date IS NULL OR ads.start_date <= NOW())
      AND (ads.end_date IS NULL OR ads.end_date >= NOW())
      ORDER BY ads.id DESC
    `);

    res.json(rows);

  } catch (err) {

    console.error(err);
    res.status(500).json({ error: "فشل جلب الإعلانات" });

  }

});

/* =====================================
   جلب جميع الإعلانات للوحة التحكم
===================================== */

router.get("/admin", async (req, res) => {

  try {

    const [rows] = await db.query(`
      SELECT *
      FROM ads
      ORDER BY id DESC
    `);

    res.json(rows);

  } catch (err) {

    console.error(err);
    res.status(500).json({ error: "فشل تحميل الإعلانات" });

  }

});


/* =====================================
   إنشاء إعلان جديد
===================================== */

router.post("/", async (req, res) => {

  try {

    const {
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

    const [result] = await db.query(`
      INSERT INTO ads
      (
        name,
        description,
        type,
        image_url,
        restaurant_id,
        category_id,
        discount_percent,
        start_date,
        end_date,
        status
      )
      VALUES (?,?,?,?,?,?,?,?,?,?)
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
      "active"
    ]);

    const adId = result.insertId;

    /* حفظ المنتجات المرتبطة بالإعلان */

    if(product_ids && product_ids.length){

      for(const productId of product_ids){

        await db.query(
          "INSERT INTO ad_products (ad_id,product_id) VALUES (?,?)",
          [adId,productId]
        );

      }

    }

    res.json({
      success:true,
      id:adId
    });

  } catch (err) {

    console.error(err);
    res.status(500).json({ error: "فشل إنشاء الإعلان" });

  }

});


/* =====================================
   تعديل إعلان
===================================== */

router.put("/:id", async (req, res) => {

  try {

    const { id } = req.params;

    const {
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

    const formatDate = (date) => {
      if (!date) return null;
      return new Date(date)
        .toISOString()
        .slice(0,19)
        .replace("T"," ");
    };

    const startDate = formatDate(start_date);
    const endDate = formatDate(end_date);

    await db.query(`
      UPDATE ads SET
      name=?,
      description=?,
      type=?,
      image_url=?,
      restaurant_id=?,
      category_id=?,
      discount_percent=?,
      start_date=?,
      end_date=?,
      status=?
      WHERE id=?
    `,[
      name,
      description || null,
      type,
      image_url || null,
      restaurant_id || null,
      category_id || null,
      discount_percent || null,
      startDate,
      endDate,
      status,
      id
    ]);

    /* حذف المنتجات القديمة */

    await db.query(
      "DELETE FROM ad_products WHERE ad_id=?",
      [id]
    );

    /* حفظ المنتجات الجديدة */

    if(product_ids && product_ids.length){

      for(const productId of product_ids){

        await db.query(
          "INSERT INTO ad_products (ad_id,product_id) VALUES (?,?)",
          [id,productId]
        );

      }

    }

    res.json({ success:true });

  } catch (err) {

    console.error(err);
    res.status(500).json({ error:"فشل تعديل الإعلان" });

  }

});


/* =====================================
   حذف إعلان
===================================== */

router.delete("/:id", async (req, res) => {

  try {

    const { id } = req.params;

    await db.query(
      "DELETE FROM ad_products WHERE ad_id=?",
      [id]
    );

    await db.query(
      "DELETE FROM ads WHERE id=?",
      [id]
    );

    res.json({ success:true });

  } catch (err) {

    console.error(err);
    res.status(500).json({ error:"فشل حذف الإعلان" });

  }

});


/* =====================================
   تسجيل مشاهدة الإعلان
===================================== */

router.post("/:id/view", async (req, res) => {

  try {

    const { id } = req.params;

    await db.query(`
      UPDATE ads
      SET views = views + 1
      WHERE id=?
    `,[id]);

    res.json({ success:true });

  } catch (err) {

    console.error(err);
    res.status(500).json({ error:"فشل تسجيل المشاهدة" });

  }

});


/* =====================================
   تسجيل نقرة الإعلان
===================================== */

router.post("/:id/click", async (req, res) => {

  try {

    const { id } = req.params;

    await db.query(`
      UPDATE ads
      SET clicks = clicks + 1
      WHERE id=?
    `,[id]);

    res.json({ success:true });

  } catch (err) {

    console.error(err);
    res.status(500).json({ error:"فشل تسجيل النقرة" });

  }

});


/* =====================================
   تغيير حالة الإعلان
===================================== */

router.patch("/:id/status", async (req,res)=>{

  try{

    const { id } = req.params
    const { status } = req.body

    await db.query(
      "UPDATE ads SET status=? WHERE id=?",
      [status,id]
    )

    res.json({success:true})

  }catch(err){

    console.error(err)
    res.status(500).json({error:"update failed"})

  }

})

export default router;
