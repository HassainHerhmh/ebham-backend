import express from "express";
import db from "../db.js";
import auth from "../middlewares/auth.js";

const router = express.Router();
router.use(auth);

/* =========================
   GET /cashbox-groups
========================= */
router.get("/", async (req, res) => {
  try {
    const search = req.query.search || "";
    const { is_admin_branch, branch_id } = req.user;
    const headerBranch = req.headers["x-branch-id"];

    let where = "WHERE 1=1";
    const params = [];

    if (!is_admin_branch) {
      where += " AND cg.branch_id = ?";
      params.push(branch_id);
    } else if (headerBranch) {
      where += " AND cg.branch_id = ?";
      params.push(headerBranch);
    }

    if (search.trim()) {
      where += ` AND (cg.name_ar LIKE ? OR cg.name_en LIKE ? OR cg.code LIKE ?)`;
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    const [rows] = await db.query(
      `
      SELECT
        cg.id,
        cg.name_ar,
        cg.name_en,
        cg.code,
        u.name AS user_name,
        b.name AS branch_name
      FROM cashbox_groups cg
      LEFT JOIN users u ON u.id = cg.created_by
      LEFT JOIN branches b ON b.id = cg.branch_id
      ${where}
      ORDER BY cg.code ASC
      `,
      params
    );

    res.json({ success: true, groups: rows });
  } catch (err) {
    console.error("GET CASHBOX GROUPS ERROR:", err);
    res.status(500).json({ success: false });
  }
});

/* =========================
   POST /cashbox-groups
========================= */
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
      INSERT INTO cashbox_groups
      (name_ar, name_en, code, branch_id, created_by)
      VALUES (?, ?, ?, ?, ?)
      `,
      [name_ar, name_en || null, code, branch_id, user_id]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("ADD CASHBOX GROUP ERROR:", err);
    res.status(500).json({ success: false });
  }
});

/* =========================
   PUT /cashbox-groups/:id
========================= */
router.put("/:id", async (req, res) => {
  try {
    const { name_ar, name_en } = req.body;

    await db.query(
      `
      UPDATE cashbox_groups
      SET name_ar = ?, name_en = ?
      WHERE id = ?
      `,
      [name_ar, name_en || null, req.params.id]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("UPDATE CASHBOX GROUP ERROR:", err);
    res.status(500).json({ success: false });
  }
});

/* =========================
   DELETE /cashbox-groups/:id
========================= */
router.delete("/:id", async (req, res) => {
  try {
    await db.query("DELETE FROM cashbox_groups WHERE id = ?", [
      req.params.id,
    ]);
    res.json({ success: true });
  } catch (err) {
    console.error("DELETE CASHBOX GROUP ERROR:", err);
    res.status(500).json({ success: false });
  }
});

export default router;
