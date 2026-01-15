import express from "express";
import db from "../db.js";
import auth from "../middlewares/auth.js";

const router = express.Router();

// حماية كل المسارات
router.use(auth);

/* =====================================================
   🟢 GET /cash-boxes
   جلب الصناديق حسب الفرع
===================================================== */
router.get("/", async (req, res) => {
  try {
    const search = req.query.search || "";
    const { is_admin_branch, branch_id } = req.user;
    const headerBranch = req.headers["x-branch-id"];

    let where = "WHERE 1=1 ";
    const params = [];

    if (is_admin_branch) {
      // إدارة عامة
      if (headerBranch) {
        where += " AND cb.branch_id = ? ";
        params.push(headerBranch);
      }
    } else {
      // مستخدم فرع
      where += " AND cb.branch_id = ? ";
      params.push(branch_id);
    }

    if (search.trim()) {
      where += `
        AND (
          cb.name_ar LIKE ?
          OR cb.name_en LIKE ?
          OR cb.code LIKE ?
        )
      `;
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    const [rows] = await db.query(
      `
      SELECT
        cb.id,
        cb.code,
        cb.name_ar,
        cb.name_en,
        cg.name_ar AS cashbox_group_name,
        a.name_ar AS account_name,
        u.name AS user_name,
        b.name AS branch_name
      FROM cash_boxes cb
      LEFT JOIN cashbox_groups cg ON cg.id = cb.cashbox_group_id
      LEFT JOIN accounts a ON a.id = cb.parent_account_id
      LEFT JOIN users u ON u.id = cb.created_by
      LEFT JOIN branches b ON b.id = cb.branch_id
      ${where}
      ORDER BY cb.id DESC
      `,
      params
    );

    res.json({ success: true, cashBoxes: rows });
  } catch (err) {
    console.error("GET CASH BOXES ERROR:", err);
    res.status(500).json({ success: false });
  }
});

/* =====================================================
   ➕ POST /cash-boxes
   إضافة صندوق (يرتبط بفرع المستخدم)
===================================================== */
router.post("/", auth, async (req, res) => {
  try {
    const {
      name_ar,
      name_en,
      code,
      cash_box_group_id,
      parent_account_id,
    } = req.body;

    const { id: user_id, branch_id } = req.user;

    if (!name_ar || !code || !cash_box_group_id || !parent_account_id) {
      return res.status(400).json({
        success: false,
        message: "جميع الحقول مطلوبة",
      });
    }

    // 1️⃣ إنشاء حساب فرعي تحت الحساب الأب
    const [accResult] = await db.query(
      `
      INSERT INTO accounts
      (code, name_ar, name_en, parent_id, account_level, branch_id, created_by)
      VALUES (?, ?, ?, ?, 'فرعي', ?, ?)
      `,
      [
        code,
        name_ar,
        name_en || null,
        parent_account_id,
        branch_id,
        user_id,
      ]
    );

    const newAccountId = accResult.insertId;

    // 2️⃣ إنشاء الصندوق وربطه بالحساب الجديد
    await db.query(
      `
      INSERT INTO cash_boxes
      (name_ar, name_en, code, cash_box_group_id, account_id, branch_id, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      [
        name_ar,
        name_en || null,
        code,
        cash_box_group_id,
        newAccountId,
        branch_id,
        user_id,
      ]
    );

    res.json({
      success: true,
      message: "تم إضافة الصندوق وربطه بالحساب المحاسبي",
    });
  } catch (err) {
    console.error("ADD CASH BOX ERROR:", err);
    res.status(500).json({
      success: false,
      message: "خطأ في إضافة الصندوق",
    });
  }
});


/* =====================================================
   ✏️ PUT /cash-boxes/:id
===================================================== */
router.put("/:id", async (req, res) => {
  try {
    const { name_ar, name_en, cash_box_group_id } = req.body;

    if (!name_ar || !cash_box_group_id) {
      return res.status(400).json({
        success: false,
        message: "الاسم ومجموعة الصناديق مطلوبان",
      });
    }

    await db.query(
      `
      UPDATE cash_boxes
      SET name_ar = ?, name_en = ?, cashbox_group_id = ?
      WHERE id = ?
      `,
      [name_ar, name_en || null, cash_box_group_id, req.params.id]
    );

    res.json({ success: true, message: "تم التعديل" });
  } catch (err) {
    console.error("UPDATE CASH BOX ERROR:", err);
    res.status(500).json({ success: false });
  }
});

/* =====================================================
   🗑️ DELETE /cash-boxes/:id
===================================================== */
router.delete("/:id", async (req, res) => {
  try {
    await db.query(`DELETE FROM cash_boxes WHERE id = ?`, [
      req.params.id,
    ]);

    res.json({ success: true });
  } catch (err) {
    console.error("DELETE CASH BOX ERROR:", err);
    res.status(500).json({ success: false });
  }
});

export default router;
