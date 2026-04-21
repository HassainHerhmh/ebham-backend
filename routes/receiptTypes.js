import express from "express";
import db from "../db.js";
import auth from "../middlewares/auth.js";

const router = express.Router();
router.use(auth);

/* =========================
   GET /receipt-types
========================= */
router.get("/", async (req, res) => {
  try {
    const { is_admin_branch, branch_id } = req.user;
    const { search } = req.query; // استقبلنا متغير البحث

    let where = "WHERE 1=1 ";
    const params = [];

    // 1. تصفية حسب الفرع
    if (!is_admin_branch) {
      where += " AND branch_id = ? ";
      params.push(branch_id);
    }

    // 2. منطق البحث (لأن الرابط في الصورة يحتوي على ?search=)
    if (search) {
      where += " AND (name_ar LIKE ? OR code LIKE ?) ";
      params.push(`%${search}%`, `%${search}%`);
    }

    // 3. الاستعلام الصحيح من جدول receipt_types
    const [rows] = await db.query(
      `
      SELECT * FROM receipt_types
      ${where}
      ORDER BY sort_order ASC, id DESC
      `,
      params
    );

    res.json({ success: true, list: rows });
  } catch (err) {
    console.error("GET RECEIPT TYPES ERROR:", err);
    res.status(500).json({ success: false, message: "خطأ في الخادم" });
  }
});

/* =========================
   POST /receipt-types
========================= */
router.post("/", async (req, res) => {
  try {
    const { name_ar, name_en, sort_order } = req.body;
    const { id: user_id, branch_id } = req.user;

    if (!name_ar) {
      return res.status(400).json({
        success: false,
        message: "الاسم مطلوب",
      });
    }

    const [[codesRow]] = await db.query(
      "SELECT COALESCE(MAX(code), 0) AS maxCode FROM receipt_types"
    );

    const [[sortRow]] = await db.query(
      "SELECT COALESCE(MAX(sort_order), 0) AS maxSortOrder FROM receipt_types WHERE branch_id = ?",
      [branch_id]
    );

    const nextCode = Number(codesRow?.maxCode || 0) + 1;
    const nextSortOrder = sort_order ? Number(sort_order) : Number(sortRow?.maxSortOrder || 0) + 1;

    await db.query(
      `
      INSERT INTO receipt_types
      (code, name_ar, name_en, sort_order, branch_id, created_by)
      VALUES (?, ?, ?, ?, ?, ?)
      `,
      [nextCode, name_ar, name_en || null, nextSortOrder, branch_id, user_id]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("ADD RECEIPT TYPE ERROR:", err);
    res.status(500).json({
      success: false,
      message: "خطأ في الإضافة",
    });
  }
});

/* =========================
   PUT /receipt-types/:id
========================= */
router.put("/:id", async (req, res) => {
  try {
    const { name_ar, name_en, sort_order } = req.body;

    if (!name_ar) {
      return res.status(400).json({
        success: false,
        message: "الاسم مطلوب",
      });
    }

    const fields = ["name_ar = ?", "name_en = ?"];
    const params = [name_ar, name_en || null];

    if (sort_order !== undefined && sort_order !== null && sort_order !== "") {
      fields.push("sort_order = ?");
      params.push(sort_order);
    }

    params.push(req.params.id);

    await db.query(
      `
      UPDATE receipt_types
      SET ${fields.join(", ")}
      WHERE id = ?
      `,
      params
    );

    res.json({ success: true });
  } catch (err) {
    console.error("UPDATE RECEIPT TYPE ERROR:", err);
    res.status(500).json({ success: false });
  }
});

/* =========================
   DELETE /receipt-types/:id
========================= */
router.delete("/:id", async (req, res) => {
  try {
    await db.query("DELETE FROM receipt_types WHERE id = ?", [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error("DELETE RECEIPT TYPE ERROR:", err);
    res.status(500).json({ success: false });
  }
});

export default router;
