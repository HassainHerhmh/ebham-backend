import express from "express";
import db from "../db.js";
import auth from "../middlewares/auth.js";

const router = express.Router();

/* =========================
   حماية كل المسارات
========================= */
router.use(auth);

router.get("/", async (req, res) => {
  try {
    const { is_admin_branch, branch_id } = req.user;

    let where = "";
    let params = [];

    if (!is_admin_branch) {
      // الفرع يرى:
      // - كل الحسابات الرئيسية (parent_id IS NULL)
      // - حساباته الفرعية فقط
      where = `
        WHERE 
          a.parent_id IS NULL
          OR a.branch_id = ?
      `;
      params.push(branch_id);
    }

const [rows] = await db.query(`
  SELECT 
    a.id,
    a.code,
    a.name_ar,
    a.name_en,
    a.parent_id,
    a.branch_id,
    a.account_level,
    a.created_at,

    b.name AS branch_name,
    p.name_ar AS parent_name,
    u.name AS created_by,
    fs.name AS financial_statement

  FROM accounts a
  LEFT JOIN branches b ON b.id = a.branch_id
  LEFT JOIN accounts p ON p.id = a.parent_id
  LEFT JOIN users u ON u.id = a.created_by
  LEFT JOIN financial_statements fs ON fs.id = a.financial_statement_id
  ${where}
  ORDER BY a.code ASC
`, params);


    // بناء الشجرة
    const map = {};
    rows.forEach((r) => (map[r.id] = { ...r, children: [] }));

    const tree = [];
    rows.forEach((r) => {
      if (r.parent_id && map[r.parent_id]) {
        map[r.parent_id].children.push(map[r.id]);
      } else {
        tree.push(map[r.id]);
      }
    });

    res.json({
      success: true,
      tree,
      list: rows,
    });
  } catch (err) {
    console.error("GET ACCOUNTS ERROR:", err);
    res.status(500).json({ success: false });
  }
});

/* ======================================================
   ✅ إضافة حساب
====================================================== */
router.post("/", async (req, res) => {
  try {
    const { name_ar, name_en, parent_id, account_level } = req.body;
    const { id: user_id, is_admin_branch, branch_id } = req.user;

    if (!name_ar) {
      return res.json({ success: false, message: "اسم الحساب مطلوب" });
    }

    let finalBranchId = null;
    let finalFinancialId = null;

    // لو له أب → يرث منه الفرع والحساب الختامي
    if (parent_id) {
      const [[parent]] = await db.query(
        "SELECT branch_id, financial_statement_id FROM accounts WHERE id=?",
        [parent_id]
      );

      if (!parent) {
        return res.json({ success: false, message: "الحساب الأب غير موجود" });
      }

      finalBranchId = parent.branch_id; // قد تكون NULL أو رقم فرع
      finalFinancialId = parent.financial_statement_id;
    } else {
      // حساب جذري
      if (account_level === "رئيسي") {
        // الرئيسي دائمًا عام
        finalBranchId = null;
      } else {
        // فرعي
        if (is_admin_branch) {
          // من الإدارة → يُربط بفرع الإدارة فقط
          finalBranchId = branch_id;
        } else {
          // من فرع → يُربط بذلك الفرع
          finalBranchId = branch_id;
        }
      }

      // تحديد الحساب الختامي للجذور
      if (["الأصول", "حقوق الملكية"].includes(name_ar)) {
        finalFinancialId = 1; // الميزانية العمومية
      } else if (["الإيرادات", "المصروفات"].includes(name_ar)) {
        finalFinancialId = 2; // أرباح وخسائر
      }
    }

    // توليد كود متسلسل
    const [[{ maxCode }]] = await db.query(
      "SELECT COALESCE(MAX(code), 0) AS maxCode FROM accounts"
    );
    const newCode = Number(maxCode) + 1;

    await db.query(
      `
      INSERT INTO accounts
      (code, name_ar, name_en, parent_id, account_level, branch_id, financial_statement_id, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())
      `,
      [
        newCode,
        name_ar,
        name_en || null,
        parent_id || null,
        account_level || "رئيسي",
        finalBranchId,
        finalFinancialId,
        user_id,
      ]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("ADD ACCOUNT ERROR:", err);
    res.status(500).json({ success: false });
  }
});


/* ======================================================
   ✏️ تعديل حساب
====================================================== */
router.put("/:id", async (req, res) => {
  try {
    const { name_ar, name_en } = req.body;

    const updates = [];
    const params = [];

    if (name_ar !== undefined) {
      updates.push("name_ar=?");
      params.push(name_ar);
    }
    if (name_en !== undefined) {
      updates.push("name_en=?");
      params.push(name_en);
    }

    if (!updates.length) {
      return res.json({ success: false, message: "لا توجد بيانات للتحديث" });
    }

    params.push(req.params.id);

    await db.query(
      `UPDATE accounts SET ${updates.join(", ")} WHERE id=?`,
      params
    );

    res.json({ success: true });
  } catch (err) {
    console.error("UPDATE ACCOUNT ERROR:", err);
    res.status(500).json({ success: false });
  }
});


/* ======================================================
   🗑️ حذف حساب
====================================================== */
router.delete("/:id", async (req, res) => {
  try {
    await db.query("DELETE FROM accounts WHERE id=?", [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error("DELETE ACCOUNT ERROR:", err);
    res.status(500).json({ success: false });
  }
});

export default router;
