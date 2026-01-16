import express from "express";
import db from "../db.js";
import auth from "../middlewares/auth.js";

const router = express.Router();

/* =========================
   حماية كل المسارات
========================= */
router.use(auth);

/* =========================
   GET /neighborhoods
========================= */
router.get("/", async (req, res) => {
  const search = req.query.search || "";
  const { is_admin_branch, branch_id } = req.user;
  let selectedBranch = req.headers["x-branch-id"];

  if (selectedBranch === "all") selectedBranch = null;

  try {
    let rows;

    if (is_admin_branch) {
      // الإدارة العامة

      if (selectedBranch && Number(selectedBranch) !== Number(branch_id)) {
        // تم اختيار فرع معين
        [rows] = await db.query(
          `
          SELECT 
            n.id,
            n.name,
            n.delivery_fee,
            n.branch_id,
            b.name AS branch_name
          FROM neighborhoods n
          LEFT JOIN branches b ON b.id = n.branch_id
          WHERE n.branch_id = ?
            AND n.name LIKE ?
          ORDER BY n.id DESC
          `,
          [selectedBranch, `%${search}%`]
        );
      } else {
        // بدون اختيار فرع → كل الأحياء
        [rows] = await db.query(
          `
          SELECT 
            n.id,
            n.name,
            n.delivery_fee,
            n.branch_id,
            b.name AS branch_name
          FROM neighborhoods n
          LEFT JOIN branches b ON b.id = n.branch_id
          WHERE n.name LIKE ?
          ORDER BY n.id DESC
          `,
          [`%${search}%`]
        );
      }
    } else {
      // مستخدم فرع عادي
      [rows] = await db.query(
        `
        SELECT 
          n.id,
          n.name,
          n.delivery_fee,
          n.branch_id,
          b.name AS branch_name
        FROM neighborhoods n
        LEFT JOIN branches b ON b.id = n.branch_id
        WHERE n.branch_id = ?
          AND n.name LIKE ?
        ORDER BY n.id DESC
        `,
        [branch_id, `%${search}%`]
      );
    }

    res.json({ success: true, neighborhoods: rows });
  } catch (err) {
    console.error("GET NEIGHBORHOODS ERROR:", err);
    res.status(500).json({ success: false });
  }
});

/* =========================
   POST /neighborhoods
========================= */
router.post("/", async (req, res) => {
  try {
    const { name, delivery_fee } = req.body;
    const { is_admin_branch, branch_id } = req.user;
    const selectedBranch = req.headers["x-branch-id"];

    if (!name) {
      return res.json({ success: false, message: "اسم الحي مطلوب" });
    }

    let finalBranchId = branch_id;

    if (is_admin_branch && selectedBranch) {
      finalBranchId = selectedBranch;
    }

    if (!finalBranchId) {
      return res.json({ success: false, message: "الفرع غير محدد" });
    }

    await db.query(
      `
      INSERT INTO neighborhoods (branch_id, name, delivery_fee)
      VALUES (?, ?, ?)
      `,
      [finalBranchId, name, delivery_fee || 0]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("ADD NEIGHBORHOOD ERROR:", err);
    res.status(500).json({ success: false });
  }
});

/* =========================
   PUT /neighborhoods/:id
========================= */
router.put("/:id", async (req, res) => {
  const { name, delivery_fee } = req.body;
  const { is_admin_branch, branch_id } = req.user;
  const selectedBranch = req.headers["x-branch-id"];

  try {
    let finalBranchId = branch_id;

    if (is_admin_branch && selectedBranch) {
      finalBranchId = selectedBranch;
    }

    await db.query(
      `
      UPDATE neighborhoods
      SET name = ?, delivery_fee = ?, branch_id = ?
      WHERE id = ?
      `,
      [name, delivery_fee || 0, finalBranchId, req.params.id]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("UPDATE NEIGHBORHOOD ERROR:", err);
    res.status(500).json({ success: false });
  }
});

/* =========================
   DELETE /neighborhoods/:id
========================= */
router.delete("/:id", async (req, res) => {
  try {
    await db.query("DELETE FROM neighborhoods WHERE id = ?", [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error("DELETE NEIGHBORHOOD ERROR:", err);
    res.status(500).json({ success: false });
  }
});

export default router;
