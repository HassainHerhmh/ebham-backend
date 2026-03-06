import express from "express";
import db from "../db.js";

const router = express.Router();

/* =====================================
   جلب الإعلانات
===================================== */

router.get("/", async (req, res) => {

  try {

    const [rows] = await db.query(`
      SELECT *
      FROM ads
      WHERE status = 'active'
      AND (start_date IS NULL OR start_date <= NOW())
      AND (end_date IS NULL OR end_date >= NOW())
      ORDER BY id DESC
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
      type,
      image_url,
      restaurant_id,
      category_id,
      product_id,
      discount_percent,
      start_date,
      end_date
    } = req.body;

    const [result] = await db.query(`
      INSERT INTO ads
      (
        name,
        type,
        image_url,
        restaurant_id,
        category_id,
        product_id,
        discount_percent,
        start_date,
        end_date,
        status
      )
      VALUES (?,?,?,?,?,?,?,?,?,?)
    `, [
      name,
      type,
      image_url || null,
      restaurant_id || null,
      category_id || null,
      product_id || null,
      discount_percent || null,
      start_date || null,
      end_date || null,
      "active"
    ]);

    res.json({
      success: true,
      id: result.insertId
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
      type,
      image_url,
      restaurant_id,
      category_id,
      product_id,
      discount_percent,
      start_date,
      end_date,
      status
    } = req.body;

    await db.query(`
      UPDATE ads SET
      name=?,
      type=?,
      image_url=?,
      restaurant_id=?,
      category_id=?,
      product_id=?,
      discount_percent=?,
      start_date=?,
      end_date=?,
      status=?
      WHERE id=?
    `, [
      name,
      type,
      image_url,
      restaurant_id,
      category_id,
      product_id,
      discount_percent,
      start_date,
      end_date,
      status,
      id
    ]);

    res.json({ success: true });

  } catch (err) {

    console.error(err);
    res.status(500).json({ error: "فشل تعديل الإعلان" });

  }

});


/* =====================================
   حذف إعلان
===================================== */

router.delete("/:id", async (req, res) => {

  try {

    const { id } = req.params;

    await db.query(
      "DELETE FROM ads WHERE id=?",
      [id]
    );

    res.json({ success: true });

  } catch (err) {

    console.error(err);
    res.status(500).json({ error: "فشل حذف الإعلان" });

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
    `, [id]);

    res.json({ success: true });

  } catch (err) {

    console.error(err);
    res.status(500).json({ error: "فشل تسجيل المشاهدة" });

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
    `, [id]);

    res.json({ success: true });

  } catch (err) {

    console.error(err);
    res.status(500).json({ error: "فشل تسجيل النقرة" });

  }

});

router.patch("/:id/status", async (req,res)=>{

  try{

    const { id } = req.params
    const { status } = req.body

    await pool.query(
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
