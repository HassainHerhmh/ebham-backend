import express from "express";
import db from "../db.js";
import auth from "../middlewares/auth.js";

const router = express.Router();
router.use(auth);

/* =========================
   GET /account-ceilings
========================= */
router.get("/", async (req, res) => {
  try {
    const { is_admin_branch, branch_id } = req.user;
    const headerBranch = req.headers["x-branch-id"];

    let where = "WHERE 1=1 ";
    const params = [];

    if (is_admin_branch) {
      if (headerBranch) {
        where += " AND ac.branch_id = ? ";
        params.push(headerBranch);
      }
    } else {
      where += " AND ac.branch_id = ? ";
      params.push(branch_id);
    }

    const [rows] = await db.query(
      `
      SELECT
        ac.id,
        ac.scope,
        ac.account_id,
        ac.account_group_id,
        a.name_ar AS account_name,
        ag.name_ar AS group_name,
        c.id AS currency_id,
        c.name_ar AS currency_name,
        ac.ceiling_amount,
        ac.account_nature AS account_type,
        ac.exceed_action AS limit_action,
        br.name AS branch_name
      FROM account_ceilings ac
      LEFT JOIN accounts a ON a.id = ac.account_id
      LEFT JOIN account_groups ag ON ag.id = ac.account_group_id
      LEFT JOIN currencies c ON c.id = ac.currency_id
      LEFT JOIN branches br ON br.id = ac.branch_id
      ${where}
      ORDER BY ac.id DESC
      `,
      params
    );

    res.json({ success: true, list: rows });
  } catch (err) {
    console.error("GET ACCOUNT CEILINGS ERROR:", err);
    res.status(500).json({ success: false });
  }
});

/* =========================
   POST /account-ceilings
========================= */
router.post("/", async (req, res) => {
  try {
    const {
      scope,
      account_id,
      account_group_id,
      currency_id,
      ceiling_amount,
      account_nature,
      exceed_action,
    } = req.body;

    const { id: user_id, branch_id } = req.user;

    if (!currency_id || !ceiling_amount) {
      return res.status(400).json({
        success: false,
        message: "العملة ومبلغ السقف مطلوبان",
      });
    }

    await db.query(
      `
      INSERT INTO account_ceilings
      (scope, account_id, account_group_id, currency_id, ceiling_amount, account_nature, exceed_action, branch_id, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        scope,
        account_id || null,
        account_group_id || null,
        currency_id,
        ceiling_amount,
        account_nature,
        exceed_action,
        branch_id,
        user_id,
      ]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("ADD ACCOUNT CEILING ERROR:", err);
    res.status(500).json({
      success: false,
      message: "خطأ في الإضافة",
    });
  }
});

/* =========================
   PUT /account-ceilings/:id
========================= */
router.put("/:id", async (req, res) => {
  try {
    const { currency_id, ceiling_amount, account_nature, exceed_action } =
      req.body;

    await db.query(
      `
      UPDATE account_ceilings
      SET currency_id = ?, ceiling_amount = ?, account_nature = ?, exceed_action = ?
      WHERE id = ?
      `,
      [
        currency_id,
        ceiling_amount,
        account_nature,
        exceed_action,
        req.params.id,
      ]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("UPDATE ACCOUNT CEILING ERROR:", err);
    res.status(500).json({ success: false });
  }
});

/* =========================
   DELETE /account-ceilings/:id
========================= */
router.delete("/:id", async (req, res) => {
  try {
    await db.query("DELETE FROM account_ceilings WHERE id = ?", [
      req.params.id,
    ]);
    res.json({ success: true });
  } catch (err) {
    console.error("DELETE ACCOUNT CEILING ERROR:", err);
    res.status(500).json({ success: false });
  }
});

export default router;
