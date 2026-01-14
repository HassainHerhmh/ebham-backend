import express from "express";
import db from "../db.js";
import auth from "../middlewares/auth.js";

const router = express.Router();

// حماية كل المسارات
router.use(auth);

/* =========================
   🏦 Bank Groups (مجموعات البنوك)
========================= */

// 🟢 جلب مجموعات البنوك مع دعم الفروع
router.get("/", async (req, res) => {
  try {
    const search = req.query.search || "";
    const authUser = req.user;
    const headerBranch = req.headers["x-branch-id"];

    let where = "WHERE 1=1";
    const params = [];

    if (authUser.is_admin_branch) {
      // إدارة عامة
      if (headerBranch) {
        where += " AND bg.branch_id = ?";
        params.push(headerBranch);
      }
    } else {
      // مستخدم فرع
      where += " AND bg.branch_id = ?";
      params.push(authUser.branch_id);
    }

    if (search.trim()) {
      where += `
        AND (
          bg.name_ar LIKE ?
          OR bg.name_en LIKE ?
          OR bg.code LIKE ?
        )
      `;
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    const [rows] = await db.query(
      `
      SELECT 
        bg.id,
        bg.code,
        bg.name_ar,
        bg.name_en,
        bg.created_at,
        u.name AS user_name,
        b.name AS branch_name
      FROM bank_groups bg
      LEFT JOIN users u ON u.id = bg.created_by
      LEFT JOIN branches b ON b.id = bg.branch_id
      ${where}
      ORDER BY bg.code ASC
      `,
      params
    );

    res.json({ success: true, groups: rows });
  } catch (err) {
    console.error("❌ Get bank groups error:", err);
    res.status(500).json({
      success: false,
      message: "خطأ في جلب مجموعات البنوك",
    });
  }
});

// ➕ إضافة مجموعة بنك (تُربط بالفرع الحالي)
router.post("/", async (req, res) => {
  try {
    const { name_ar, name_en, code } = req.body;
    const { id: user_id, branch_id } = req.user;

    if (!name_ar || !code) {
      return res.status(400).json({
        success: false,
        message: "الاسم والرقم مطلوبان",
      });
    }

    await db.query(
      `
      INSERT INTO bank_groups
      (code, name_ar, name_en, branch_id, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, NOW())
      `,
      [code, name_ar, name_en || null, branch_id, user_id]
    );

    res.json({
      success: true,
      message: "تمت إضافة مجموعة البنك",
    });
  } catch (err) {
    console.error("❌ Add bank group error:", err);

    if (err.code === "ER_DUP_ENTRY") {
      return res.status(400).json({
        success: false,
        message: "رقم المجموعة مستخدم مسبقًا",
      });
    }

    res.status(500).json({
      success: false,
      message: "خطأ في إضافة مجموعة البنك",
    });
  }
});

// ✏️ تعديل مجموعة بنك
router.put("/:id", async (req, res) => {
  try {
    const { name_ar, name_en, code } = req.body;

    if (!name_ar || !code) {
      return res.status(400).json({
        success: false,
        message: "الاسم والرقم مطلوبان",
      });
    }

    await db.query(
      `
      UPDATE bank_groups
      SET
        name_ar = ?,
        name_en = ?,
        code = ?
      WHERE id = ?
      `,
      [name_ar, name_en || null, code, req.params.id]
    );

    res.json({
      success: true,
      message: "تم تعديل مجموعة البنك",
    });
  } catch (err) {
    console.error("❌ Update bank group error:", err);

    if (err.code === "ER_DUP_ENTRY") {
      return res.status(400).json({
        success: false,
        message: "رقم المجموعة مستخدم مسبقًا",
      });
    }

    res.status(500).json({
      success: false,
      message: "خطأ في تعديل مجموعة البنك",
    });
  }
});

// 🗑️ حذف مجموعة بنك
router.delete("/:id", async (req, res) => {
  try {
    await db.query("DELETE FROM bank_groups WHERE id = ?", [
      req.params.id,
    ]);

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
