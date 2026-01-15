import express from "express";
import db from "../db.js";
import auth from "../middlewares/auth.js";

const router = express.Router();
router.use(auth);

/* =========================
   GET /journal-types
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
        where += " AND jt.branch_id = ? ";
        params.push(headerBranch);
      }
    } else {
      where += " AND jt.branch_id = ? ";
      params.push(branch_id);
    }

    if (search.trim()) {
      where += `
        AND (
          jt.name_ar LIKE ?
          OR jt.name_en LIKE ?
          OR jt.code LIKE ?
        )
      `;
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    const [rows] = await db.query(
      `
      SELECT
        jt.id,
        jt.code,
        jt.name_ar,
        jt.name_en,
        jt.sort_order,
        br.name AS branch_name
      FROM journal_types jt
      LEFT JOIN branches br ON br.id = jt.branch_id
      ${where}
      ORDER BY jt.sort_order ASC, jt.id DESC
      `,
      params
    );

    res.json({ success: true, list: rows });
  } catch (err) {
    console.error("GET JOURNAL TYPES ERROR:", err);
    res.status(500).json({ success: false });
  }
});

/* =========================
   POST /journal-types
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
      INSERT INTO journal_types
      (code, name_ar, name_en, sort_order, branch_id, created_by)
      VALUES (?, ?, ?, ?, ?, ?)
      `,
      [code, name_ar, name_en || null, sort_order, branch_id, user_id]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("ADD JOURNAL TYPE ERROR:", err);
    res.status(500).json({
      success: false,
      message: "خطأ في الإضافة",
    });
  }
});

/* =========================
   PUT /journal-types/:id
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
      UPDATE journal_types
      SET name_ar = ?, name_en = ?, sort_order = ?
      WHERE id = ?
      `,
      [name_ar, name_en || null, sort_order, req.params.id]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("UPDATE JOURNAL TYPE ERROR:", err);
    res.status(500).json({ success: false });
  }
});

/* =========================
   DELETE /journal-types/:id
========================= */
router.delete("/:id", async (req, res) => {
  try {
    await db.query("DELETE FROM journal_types WHERE id = ?", [
      req.params.id,
    ]);
    res.json({ success: true });
  } catch (err) {
    console.error("DELETE JOURNAL TYPE ERROR:", err);
    res.status(500).json({ success: false });
  }
});

export default router;
import express from "express";
import db from "../db.js";
import auth from "../middlewares/auth.js";

const router = express.Router();
router.use(auth);

/* =========================
   GET /journal-types
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
        where += " AND jt.branch_id = ? ";
        params.push(headerBranch);
      }
    } else {
      where += " AND jt.branch_id = ? ";
      params.push(branch_id);
    }

    if (search.trim()) {
      where += `
        AND (
          jt.name_ar LIKE ?
          OR jt.name_en LIKE ?
          OR jt.code LIKE ?
        )
      `;
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    const [rows] = await db.query(
      `
      SELECT
        jt.id,
        jt.code,
        jt.name_ar,
        jt.name_en,
        jt.sort_order,
        br.name AS branch_name
      FROM journal_types jt
      LEFT JOIN branches br ON br.id = jt.branch_id
      ${where}
      ORDER BY jt.sort_order ASC, jt.id DESC
      `,
      params
    );

    res.json({ success: true, list: rows });
  } catch (err) {
    console.error("GET JOURNAL TYPES ERROR:", err);
    res.status(500).json({ success: false });
  }
});

/* =========================
   POST /journal-types
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
      INSERT INTO journal_types
      (code, name_ar, name_en, sort_order, branch_id, created_by)
      VALUES (?, ?, ?, ?, ?, ?)
      `,
      [code, name_ar, name_en || null, sort_order, branch_id, user_id]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("ADD JOURNAL TYPE ERROR:", err);
    res.status(500).json({
      success: false,
      message: "خطأ في الإضافة",
    });
  }
});

/* =========================
   PUT /journal-types/:id
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
      UPDATE journal_types
      SET name_ar = ?, name_en = ?, sort_order = ?
      WHERE id = ?
      `,
      [name_ar, name_en || null, sort_order, req.params.id]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("UPDATE JOURNAL TYPE ERROR:", err);
    res.status(500).json({ success: false });
  }
});

/* =========================
   DELETE /journal-types/:id
========================= */
router.delete("/:id", async (req, res) => {
  try {
    await db.query("DELETE FROM journal_types WHERE id = ?", [
      req.params.id,
    ]);
    res.json({ success: true });
  } catch (err) {
    console.error("DELETE JOURNAL TYPE ERROR:", err);
    res.status(500).json({ success: false });
  }
});

export default router;
