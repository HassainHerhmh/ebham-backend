import express from "express";
import db from "../db.js";
import auth from "../middlewares/auth.js";

const router = express.Router();
router.use(auth);

let accountGroupColumnChecked = false;

async function ensureAccountGroupColumn() {
  if (accountGroupColumnChecked) return;

  try {
    await db.query(
      "ALTER TABLE accounts ADD COLUMN account_group_id INT NULL"
    );
  } catch (err) {
    if (err?.code !== "ER_DUP_FIELDNAME") {
      throw err;
    }
  }

  accountGroupColumnChecked = true;
}

function getRootFinancialStatementId(name) {
  if (["الأصول", "حقوق الملكية"].includes(name)) {
    return 1;
  }

  if (["الإيرادات", "المصروفات"].includes(name)) {
    return 2;
  }

  return null;
}

/* ======================================================
   📥 جلب الحسابات
====================================================== */
router.get("/", async (req, res) => {
  try {
    await ensureAccountGroupColumn();

    const { is_admin_branch, branch_id } = req.user;

    let where = "";

    if (is_admin_branch) {
      // الإدارة ترى كل شيء
      where = "1=1";
    } else {
      // الفرع يرى:
      // - كل الحسابات الرئيسية
      // - الحسابات الفرعية الخاصة بفرعه فقط
      where = `
        (a.account_level = 'رئيسي'
         OR (a.account_level = 'فرعي' AND a.branch_id = ?))
      `;
    }

    const params = is_admin_branch ? [] : [branch_id];

    const [rows] = await db.query(
      `
      SELECT
        a.id,
        a.code,
        a.name_ar,
        a.name_en,
        a.parent_id,
        a.account_group_id,
        a.account_level,
        a.created_at,

        b.name AS branch_name,
        p.name_ar AS parent_name,
        ag.name_ar AS group_name,
        u.name AS created_by,
        COALESCE(
          fs.name,
          parent_fs.name,
          CASE
            WHEN a.parent_id IS NULL AND a.name_ar IN ('الأصول', 'حقوق الملكية') THEN 'الميزانية العمومية'
            WHEN a.parent_id IS NULL AND a.name_ar IN ('الإيرادات', 'المصروفات') THEN 'أرباح وخسائر'
            ELSE NULL
          END
        ) AS financial_statement

      FROM accounts a
      LEFT JOIN branches b ON b.id = a.branch_id
      LEFT JOIN accounts p ON p.id = a.parent_id
      LEFT JOIN account_groups ag ON ag.id = a.account_group_id
      LEFT JOIN users u ON u.id = a.created_by
      LEFT JOIN financial_statements fs ON fs.id = a.financial_statement_id
      LEFT JOIN financial_statements parent_fs ON parent_fs.id = p.financial_statement_id
      WHERE ${where}
      ORDER BY a.code ASC
      `,
      params
    );

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
      list: rows,
      tree,
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
    await ensureAccountGroupColumn();

    const { name_ar, name_en, parent_id, account_level, account_group_id } = req.body;
    const { id: user_id, branch_id } = req.user;

    if (!name_ar) {
      return res.json({ success: false, message: "اسم الحساب مطلوب" });
    }

    let finalBranchId = null;
    let finalFinancialId = null;

    if (account_level === "فرعي" && !parent_id) {
      return res.json({
        success: false,
        message: "الحساب الفرعي يجب أن يرتبط بحساب أب",
      });
    }

    // لو له أب → يرث منه القوائم المالية والفرع إن وجد
    if (parent_id) {
      const [[parent]] = await db.query(
        "SELECT financial_statement_id, branch_id FROM accounts WHERE id=?",
        [parent_id]
      );

      if (!parent) {
        return res.json({ success: false, message: "الحساب الأب غير موجود" });
      }

      finalFinancialId = parent.financial_statement_id;
      finalBranchId = parent.branch_id || branch_id || null;
    } else {
      finalFinancialId = getRootFinancialStatementId(name_ar);
    }

    // الحسابات الجذرية فقط تتبع المنطق القديم للفرع
    if (!parent_id) {
      if (account_level === "فرعي") {
        // الفرعي الجذري يتبع فرع المستخدم
        finalBranchId = branch_id;
      } else {
        // الرئيسي الجذري يبقى عامًا
        finalBranchId = null;
      }
    }

   const [[{ maxCode }]] = await db.query(`
  SELECT COALESCE(MAX(code), 10000) AS maxCode 
  FROM accounts
  WHERE code >= 10000
`);


    const newCode = Number(maxCode) + 1;

    await db.query(
      `
      INSERT INTO accounts
      (code, name_ar, name_en, parent_id, account_group_id, account_level, branch_id, financial_statement_id, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
      `,
      [
        newCode,
        name_ar,
        name_en || null,
        parent_id || null,
        account_group_id || null,
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
    await ensureAccountGroupColumn();

    const { name_ar, name_en, parent_id, account_level, account_group_id } = req.body;

    const [[currentAccount]] = await db.query(
      "SELECT name_ar, parent_id, account_level FROM accounts WHERE id=?",
      [req.params.id]
    );

    if (!currentAccount) {
      return res.status(404).json({ success: false, message: "الحساب غير موجود" });
    }

    const nextName = name_ar !== undefined ? name_ar : currentAccount.name_ar;
    const nextParentId = parent_id !== undefined ? parent_id || null : currentAccount.parent_id;
    const nextLevel = account_level !== undefined ? account_level : currentAccount.account_level;

    if (nextLevel === "فرعي" && !nextParentId) {
      return res.json({
        success: false,
        message: "الحساب الفرعي يجب أن يرتبط بحساب أب",
      });
    }

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
    if (parent_id !== undefined) {
      updates.push("parent_id=?");
      params.push(parent_id || null);
    }
    if (account_level !== undefined) {
      updates.push("account_level=?");
      params.push(account_level);
    }
    if (account_group_id !== undefined) {
      updates.push("account_group_id=?");
      params.push(account_group_id || null);
    }

    let finalFinancialId = null;
    if (nextParentId) {
      const [[parent]] = await db.query(
        "SELECT financial_statement_id FROM accounts WHERE id=?",
        [nextParentId]
      );

      if (!parent) {
        return res.json({ success: false, message: "الحساب الأب غير موجود" });
      }

      finalFinancialId = parent.financial_statement_id || null;
    } else {
      finalFinancialId = getRootFinancialStatementId(nextName);
    }

    updates.push("financial_statement_id=?");
    params.push(finalFinancialId);

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

// جلب الحسابات الرئيسية فقط لاستخدامها في صفحة البنوك
router.get("/main-for-banks", auth, async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT 
        id,
        code,
        name_ar,
        parent_id
      FROM accounts
      WHERE account_level = 'رئيسي'
      ORDER BY code ASC
    `);

    res.json({
      success: true,
      accounts: rows,
    });
  } catch (err) {
    console.error("MAIN FOR BANKS ERROR:", err);
    res.status(500).json({
      success: false,
      message: "خطأ في جلب الحسابات الرئيسية للبنوك",
    });
  }
});

// جلب الحسابات الرئيسية فقط لاستخدامها في صفحة الصناديق
router.get("/main-for-cashboxes", auth, async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT 
        id,
        code,
        name_ar,
        parent_id
      FROM accounts
      WHERE account_level = 'رئيسي'
      ORDER BY code ASC
    `);

    res.json({
      success: true,
      accounts: rows,
    });
  } catch (err) {
    console.error("MAIN FOR CASHBOXES ERROR:", err);
    res.status(500).json({
      success: false,
      message: "خطأ في جلب الحسابات الرئيسية للصناديق",
    });
  }
});

// الحسابات الفرعية للتسقيف (حسب الفرع)
router.get("/sub-for-ceiling", auth, async (req, res) => {
  try {
    const { is_admin_branch, branch_id } = req.user;
    const headerBranch = req.headers["x-branch-id"];

    let where = "WHERE account_level = 'فرعي'";
    const params = [];

    if (is_admin_branch) {
      // فرع الإدارة
      if (headerBranch) {
        where += " AND branch_id = ?";
        params.push(headerBranch);
      }
      // بدون headerBranch = يجلب الكل
    } else {
      // مستخدم فرع عادي
      where += " AND branch_id = ?";
      params.push(branch_id);
    }

    const [rows] = await db.query(
      `
      SELECT id, code, name_ar
      FROM accounts
      ${where}
      ORDER BY code ASC
      `,
      params
    );

    res.json({ success: true, list: rows });
  } catch (err) {
    console.error("GET SUB ACCOUNTS FOR CEILING ERROR:", err);
    res.status(500).json({ success: false });
  }
});

// GET /accounts/select?type=box | account
router.get("/select", async (req, res) => {
  try {
    const { type } = req.query; // box | account
    const { branch_id, is_admin_branch } = req.user;

    let where = "WHERE is_active = 1";
    const params = [];

    // تقييد بالفرع للمستخدم غير الإداري
    if (!is_admin_branch) {
      where += " AND branch_id = ?";
      params.push(branch_id);
    }

    if (type === "box") {
      // الصناديق فقط
      where += " AND is_cash_box = 1";
    } else if (type === "account") {
      // الحسابات الفرعية فقط (ليست رئيسية)
      where += " AND parent_id IS NOT NULL";
    }

    const [rows] = await db.query(
      `
      SELECT id, name_ar
      FROM accounts
      ${where}
      ORDER BY name_ar ASC
      `,
      params
    );

    res.json({ success: true, list: rows });
  } catch (err) {
    console.error("GET SELECT ACCOUNTS ERROR:", err);
    res.status(500).json({ success: false, message: "خطأ في جلب الحسابات" });
  }
});


export default router;
