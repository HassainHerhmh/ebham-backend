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
    const search = req.query.search || "";
    const { is_admin_branch, branch_id } = req.user;
    const headerBranch = req.headers["x-branch-id"];

    let where = "WHERE 1=1 ";
    const params = [];

    if (is_admin_branch) {
      if (headerBranch) {
        where += " AND rt.branch_id = ? ";
        params.push(headerBranch);
      }
    } else {
      where += " AND rt.branch_id = ? ";
      params.push(branch_id);
    }

    if (search.trim()) {
      where += `
        AND (
          rt.name_ar LIKE ?
          OR rt.name_en LIKE ?
          OR rt.code LIKE ?
        )
      `;
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    const [rows] = await db.query(
      `
      SELECT
        rt.id,
        rt.code,
        rt.name_ar,
        rt.name_en,
        rt.sort_order,
        br.name AS branch_name
      FROM receipt_types rt
      LEFT JOIN branches br ON br.id = rt.branch_id
      ${where}
      ORDER BY rt.sort_order ASC, rt.id DESC
      `,
      params
    );

    res.json({ success: true, list: rows });
  } catch (err) {
    console.error("GET RECEIPT TYPES ERROR:", err);
    res.status(500).json({ success: false });
  }
});

/* =========================
   POST /receipt-types
========================= */
router.post("/", async (req, res) => {
  try {
    const { code, name_ar, name_en, sort_order } = req.body;
    const { id: user_id, branch_id } = req.user;

    if (!code || !name_ar || !sort_order) {
      return res.status(400).json({
        success: false,
        message: "الرقم والاسم والترتيب مطلوبة",
      });
    }

    await db.query(
      `
      INSERT INTO receipt_types
      (code, name_ar, name_en, sort_order, branch_id, created_by)
      VALUES (?, ?, ?, ?, ?, ?)
      `,
      [code, name_ar, name_en || null, sort_order, branch_id, user_id]
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

    if (!name_ar || !sort_order) {
      return res.status(400).json({
        success: false,
        message: "الاسم والترتيب مطلوبان",
      });
    }

    await db.query(
      `
      UPDATE receipt_types
      SET name_ar = ?, name_en = ?, sort_order = ?
      WHERE id = ?
      `,
      [name_ar, name_en || null, sort_order, req.params.id]
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
    await db.query("DELETE FROM receipt_types WHERE id = ?", [
      req.params.id,
    ]);
    res.json({ success: true });
  } catch (err) {
    console.error("DELETE RECEIPT TYPE ERROR:", err);
    res.status(500).json({ success: false });
  }
});

export default router;
