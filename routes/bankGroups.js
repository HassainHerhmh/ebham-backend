import express from "express";
import db from "../db.js";
import auth from "../middlewares/auth.js";

const router = express.Router();

// حماية كل المسارات
router.use(auth);

/* =====================================================
   🏦 Bank Groups (مجموعات البنوك)
===================================================== */

/* =========================
   🟢 جلب مجموعات البنوك
   - الإدارة العامة: ترى الكل
   - الفرع: يرى مجموعاته فقط
========================= */
router.get("/", async (req, res) => {
  try {
    const search = req.query.search || "";
    const { is_admin_branch, branch_id } = req.user;

    let sql = `
      SELECT 
        bg.id,
        bg.code,
        bg.name_ar,
        bg.name_en,
        bg.created_at,
        u.name AS user_name,
        b.name AS branch
      FROM bank_groups bg
      LEFT JOIN users u ON u.id = bg.created_by
      LEFT JOIN branches b ON b.id = bg.branch_id
      WHERE 1=1
    `;

    const params = [];

    // لو المستخدم ليس إدارة عامة → نشوف فقط مجموعات فرعه
    if (!is_admin_branch) {
      sql += ` AND bg.branch_id = ? `;
      params.push(branch_id);
    }

    if (search.trim()) {
      sql += `
        AND (
          bg.name_ar LIKE ?
          OR bg.name_en LIKE ?
          OR bg.code LIKE ?
        )
      `;
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    sql += " ORDER BY bg.code ASC";

    const [rows] = await db.query(sql, params);

    res.json({
      success: true,
      groups: rows,
    });
  } catch (err) {
    console.error("❌ Get bank groups error:", err);
    res.status(500).json({
      success: false,
      message: "خطأ في جلب مجموعات البنوك",
    });
  }
});
/* =========================
   🔢 جلب الرقم التالي للمجموعة
========================= */
router.get("/next-code", async (req, res) => {
  try {
    const { branch_id } = req.user;

    const [[row]] = await db.query(
      `
      SELECT IFNULL(MAX(code), 0) + 1 AS nextCode
      FROM bank_groups
      WHERE branch_id = ?
      `,
      [branch_id]
    );

    res.json({
      success: true,
      nextCode: row.nextCode,
    });

  } catch (err) {
    console.error("Next code error:", err);

    res.status(500).json({
      success: false,
      message: "فشل توليد الرقم",
    });
  }
});


/* =========================
   ➕ إضافة مجموعة بنك (ترقيم تلقائي لكل فرع)
========================= */
router.post("/", async (req, res) => {
  const conn = await db.getConnection();

  try {
    const { name_ar, name_en } = req.body;
    const { id: user_id, branch_id } = req.user;

    if (!name_ar) {
      return res.status(400).json({
        success: false,
        message: "اسم المجموعة مطلوب",
      });
    }

    await conn.beginTransaction();

    // ✅ جلب آخر رقم في نفس الفرع (مع قفل)
    const [[last]] = await conn.query(
      `
      SELECT MAX(code) AS maxCode
      FROM bank_groups
      WHERE branch_id = ?
      FOR UPDATE
      `,
      [branch_id]
    );

    const newCode = (last?.maxCode || 0) + 1;

    // ✅ إدخال مع الرقم الجديد
    await conn.query(
      `
      INSERT INTO bank_groups
      (code, name_ar, name_en, branch_id, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, NOW())
      `,
      [newCode, name_ar, name_en || null, branch_id, user_id]
    );

    await conn.commit();

    res.json({
      success: true,
      message: "تمت إضافة مجموعة البنك",
      code: newCode, // مفيد للواجهة
    });

  } catch (err) {
    await conn.rollback();

    console.error("❌ Add bank group error:", err);

    res.status(500).json({
      success: false,
      message: "خطأ في إضافة مجموعة البنك",
    });

  } finally {
    conn.release();
  }
});

/* =========================
   ✏️ تعديل مجموعة بنك
========================= */
router.put("/:id", async (req, res) => {
  try {
    const { name_ar, name_en } = req.body;

    // تحقق من البيانات
    if (!name_ar) {
      return res.status(400).json({
        success: false,
        message: "اسم المجموعة مطلوب",
      });
    }

    // تحديث بدون تعديل الرقم
    const [result] = await db.query(
      `
      UPDATE bank_groups
      SET
        name_ar = ?,
        name_en = ?
      WHERE id = ?
      `,
      [name_ar, name_en || null, req.params.id]
    );

    // لو ما تم تعديل أي صف
    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: "المجموعة غير موجودة",
      });
    }

    res.json({
      success: true,
      message: "تم تعديل مجموعة البنك بنجاح",
    });

  } catch (err) {

    console.error("❌ Update bank group error:", err);

    res.status(500).json({
      success: false,
      message: "خطأ في تعديل مجموعة البنك",
    });

  }
});


/* =========================
   🗑️ حذف مجموعة بنك
========================= */
router.delete("/:id", async (req, res) => {
  try {
    await db.query("DELETE FROM bank_groups WHERE id = ?", [req.params.id]);

    res.json({
      success: true,
      message: "تم حذف مجموعة البنك",
    });
  } catch (err) {
    console.error("❌ Delete bank group error:", err);
    res.status(500).json({
      success: false,
      message: "خطأ في حذف مجموعة البنك",
    });
  }
});

export default router;
