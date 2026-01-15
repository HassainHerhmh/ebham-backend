import express from "express";
import db from "../db.js";
import auth from "../middlewares/auth.js";

const router = express.Router();
router.use(auth);

/* =========================
   GET /banks
========================= */
router.get("/", auth, async (req, res) => {
  try {
    const search = req.query.search || "";
    const { is_admin_branch, branch_id } = req.user;
    const headerBranch = req.headers["x-branch-id"];

    let where = "WHERE 1=1";
    const params = [];

    if (!is_admin_branch) {
      where += " AND b.branch_id = ?";
      params.push(branch_id);
    } else if (headerBranch) {
      where += " AND b.branch_id = ?";
      params.push(headerBranch);
    }

    if (search.trim()) {
      where += `
        AND (
          b.name_ar LIKE ?
          OR b.name_en LIKE ?
          OR b.code LIKE ?
        )
      `;
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    const [rows] = await db.query(
      `
      SELECT 
        b.id,
        b.name_ar,
        b.name_en,
        b.code,
        bg.name_ar AS bank_group_name,
        a.name_ar AS account_name,
        u.name AS user_name,
        br.name AS branch_name
      FROM banks b
      LEFT JOIN bank_groups bg ON bg.id = b.bank_group_id
      LEFT JOIN accounts a ON a.id = b.parent_account_id
      LEFT JOIN users u ON u.id = b.created_by
      LEFT JOIN branches br ON br.id = b.branch_id
      ${where}
      ORDER BY b.id DESC
      `,
      params
    );

    res.json({ success: true, banks: rows });
  } catch (err) {
    console.error("GET BANKS ERROR:", err);
    res.status(500).json({ success: false });
  }
});


/* =========================
   POST /banks
========================= */
router.post("/", async (req, res) => {
  try {
    const {
      name_ar,
      name_en,
      code,
      bank_group_id,
      parent_account_id,
    } = req.body;

    const { id: user_id, branch_id } = req.user;

    if (!name_ar || !code || !bank_group_id || !parent_account_id) {
      return res.status(400).json({
        success: false,
        message: "جميع الحقول مطلوبة",
      });
    }

    await db.query(
      `
      INSERT INTO banks
      (name_ar, name_en, code, bank_group_id, parent_account_id, branch_id, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      [
        name_ar,
        name_en || null,
        code,
        bank_group_id,
        parent_account_id,
        branch_id,
        user_id,
      ]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("ADD BANK ERROR:", err);
    res.status(500).json({ success: false });
  }
});

/* =========================
   DELETE /banks/:id
========================= */
router.delete("/:id", async (req, res) => {
  try {
    await db.query("DELETE FROM banks WHERE id = ?", [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error("DELETE BANK ERROR:", err);
    res.status(500).json({ success: false });
  }
});


export default router;
