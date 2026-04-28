import express from "express";
import db from "../db.js";
import upload, { uploadToCloudinary } from "../middlewares/upload.js";

const router = express.Router();

/* ======================================================
   🟢 جلب جميع الأنواع
====================================================== */
router.get("/", async (_, res) => {
  try {
    const [rows] = await db.query(`
      SELECT 
        id, 
        name, 
        image_url,
        image_outline_url,
        image_color_url,
        sort_order, 
        created_at
      FROM types
      ORDER BY sort_order ASC
    `);

    res.json({ success: true, types: rows });
  } catch (err) {
    console.error("❌ خطأ في جلب الأنواع:", err);
    res.status(500).json({ success: false, message: "❌ خطأ في السيرفر" });
  }
});

/* ======================================================
   ✅ إضافة نوع جديد
====================================================== */
router.post(
  "/",
  upload.fields([
    { name: "image", maxCount: 1 },
    { name: "image_outline", maxCount: 1 },
    { name: "image_color", maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const {
        name,
        sort_order,
        image_url: bodyImageUrl,
        image_outline_url: bodyOutlineUrl,
        image_color_url: bodyColorUrl,
      } = req.body;

      if (!name) {
        return res.status(400).json({
          success: false,
          message: "❌ اسم النوع مطلوب",
        });
      }

      let image_url = bodyImageUrl || null;
      let image_outline_url = bodyOutlineUrl || null;
      let image_color_url = bodyColorUrl || null;

      if (req.files?.image?.[0]) {
        const result = await uploadToCloudinary(
          req.files.image[0].buffer,
          "types"
        );
        image_url = result.secure_url;
      }

      if (req.files?.image_outline?.[0]) {
        const result = await uploadToCloudinary(
          req.files.image_outline[0].buffer,
          "types"
        );
        image_outline_url = result.secure_url;
      }

      if (req.files?.image_color?.[0]) {
        const result = await uploadToCloudinary(
          req.files.image_color[0].buffer,
          "types"
        );
        image_color_url = result.secure_url;
      }

      await db.query(
        `
        INSERT INTO types 
          (name, image_url, image_outline_url, image_color_url, sort_order, created_at)
        VALUES (?, ?, ?, ?, ?, NOW())
        `,
        [
          name,
          image_url,
          image_outline_url,
          image_color_url,
          sort_order || 0,
        ]
      );

      res.json({
        success: true,
        message: "✅ تم إضافة النوع بنجاح",
        image_url,
        image_outline_url,
        image_color_url,
      });
    } catch (err) {
      console.error("❌ خطأ في إضافة النوع:", err);
      res.status(500).json({ success: false, message: "❌ خطأ في السيرفر" });
    }
  }
);

/* ======================================================
   ✏️ تعديل نوع
====================================================== */
router.put(
  "/:id",
  upload.fields([
    { name: "image", maxCount: 1 },
    { name: "image_outline", maxCount: 1 },
    { name: "image_color", maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const {
        name,
        sort_order,
        image_url: bodyImageUrl,
        image_outline_url: bodyOutlineUrl,
        image_color_url: bodyColorUrl,
      } = req.body;

      const updates = [];
      const params = [];

      if (name !== undefined) {
        updates.push("name=?");
        params.push(name);
      }

      if (sort_order !== undefined) {
        updates.push("sort_order=?");
        params.push(sort_order);
      }

      if (bodyImageUrl || req.files?.image?.[0]) {
        let image_url = bodyImageUrl || null;

        if (req.files?.image?.[0]) {
          const result = await uploadToCloudinary(
            req.files.image[0].buffer,
            "types"
          );
          image_url = result.secure_url;
        }

        updates.push("image_url=?");
        params.push(image_url);
      }

      if (bodyOutlineUrl || req.files?.image_outline?.[0]) {
        let image_outline_url = bodyOutlineUrl || null;

        if (req.files?.image_outline?.[0]) {
          const result = await uploadToCloudinary(
            req.files.image_outline[0].buffer,
            "types"
          );
          image_outline_url = result.secure_url;
        }

        updates.push("image_outline_url=?");
        params.push(image_outline_url);
      }

      if (bodyColorUrl || req.files?.image_color?.[0]) {
        let image_color_url = bodyColorUrl || null;

        if (req.files?.image_color?.[0]) {
          const result = await uploadToCloudinary(
            req.files.image_color[0].buffer,
            "types"
          );
          image_color_url = result.secure_url;
        }

        updates.push("image_color_url=?");
        params.push(image_color_url);
      }

      if (!updates.length) {
        return res.status(400).json({
          success: false,
          message: "❌ لا توجد بيانات لتحديثها",
        });
      }

      params.push(req.params.id);

      await db.query(
        `UPDATE types SET ${updates.join(", ")} WHERE id=?`,
        params
      );

      res.json({
        success: true,
        message: "✅ تم تعديل النوع",
      });
    } catch (err) {
      console.error("❌ خطأ في تعديل النوع:", err);
      res.status(500).json({ success: false, message: "❌ خطأ في السيرفر" });
    }
  }
);

/* ======================================================
   🗑️ حذف نوع
====================================================== */
router.delete("/:id", async (req, res) => {
  try {
    const [exists] = await db.query(
      "SELECT id FROM types WHERE id=?",
      [req.params.id]
    );

    if (!exists.length) {
      return res.status(404).json({
        success: false,
        message: "❌ النوع غير موجود",
      });
    }

    await db.query("DELETE FROM types WHERE id=?", [req.params.id]);

    res.json({ success: true, message: "🗑️ تم حذف النوع" });
  } catch (err) {
    console.error("❌ خطأ في حذف النوع:", err);
    res.status(500).json({ success: false, message: "❌ خطأ في السيرفر" });
  }
});

export default router;
