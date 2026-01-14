import express from "express";
import db from "../db.js";
import auth from "../middlewares/auth.js";

const router = express.Router();

// حماية كل المسارات
router.use(auth);

/* =========================
   Account Groups
========================= */

// GET /account-groups
router.get("/", async (req, res) => {
  try {
    const search = req.query.search || "";
    const { is_admin_branch, branch_id } = req.user;

    let sql = `
      SELECT 
        ag.id,
        ag.code,
        ag.name_ar,
        ag.name_en,
        ag.created_at,
        u.name AS user_name,
        b.name AS branch
      FROM account_groups ag
      LEFT JOIN users u ON u.id = ag.created_by
      LEFT JOIN branches b ON b.id = ag.branch_id
      WHERE 1=1
    `;

    const params = [];

    // لو المستخدم ليس إدارة عامة → نشوف فقط مجموعات فرعه
    if (!is_admin_branch) {
      sql += ` AND ag.branch_id = ? `;
      params.push(branch_id);
    }

    if (search.trim()) {
      sql += `
        AND (
          ag.name_ar LIKE ?
          OR ag.name_en LIKE ?
          OR ag.code LIKE ?
        )
      `;
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    sql += " ORDER BY ag.code ASC";

    const [rows] = await db.query(sql, params);

    res.json({
      success: true,
      groups: rows,
    });
  } catch (err) {
    console.error("Get account groups error:", err);
    res.status(500).json({
      success: false,
      message: "خطأ في جلب مجموعات الحسابات",
    });
  }
});

// POST /account-groups
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
      INSERT INTO account_groups
      (code, name_ar, name_en, branch_id, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, NOW())
      `,
      [code, name_ar, name_en || null, branch_id, user_id]
    );

    res.json({
      success: true,
      message: "تمت الإضافة بنجاح",
    });
  } catch (err) {
    console.error("Add account group error:", err);

    if (err.code === "ER_DUP_ENTRY") {
      return res.status(400).json({
        success: false,
        message: "رقم المجموعة مستخدم مسبقاً",
      });
    }

    res.status(500).json({
      success: false,
      message: "خطأ في إضافة مجموعة الحساب",
    });
  }
});

export default router;
