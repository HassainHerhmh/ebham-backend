import express from "express";
import db from "../db.js";
import auth from "../middlewares/auth.js";

const router = express.Router();

/* =========================
   حماية كل المسارات
========================= */
router.use(auth);

/* =========================
   GET Neighborhoods
========================= */
router.get("/", async (req, res) => {
  const search = req.query.search || "";
  const { is_admin_branch, branch_id } = req.user;
  const selectedBranch = req.headers["x-branch-id"];

  try {
    let rows;

    if (is_admin_branch) {
      // إدارة عامة
      if (selectedBranch) {
        [rows] = await db.query(
          `
          SELECT 
            n.id,
            n.name,
            n.delivery_fee,
            b.name AS branch_name,
            n.branch_id
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
            b.name AS branch_name,
            n.branch_id
          FROM neighborhoods n
          LEFT JOIN branches b ON b.id = n.branch_id
          WHERE n.name LIKE ?
          ORDER BY n.id DESC
          `,
          [`%${search}%`]
        );
      }
    } else {
      // مستخدم فرع → يرى أحياء فرعه فقط
      [rows] = await db.query(
        `
        SELECT 
          n.id,
          n.name,
          n.delivery_fee,
          b.name AS branch_name,
          n.branch_id
        FROM neighborhoods n
        LEFT JOIN branches b ON b.id = n.branch_id
        WHERE n.branch_id = ?
          AND n.name LIKE ?
        ORDER BY n.id DESC
        `,
        [branch_id, `%${search}%`]
      );
    }

    res.json({
      success: true,
      neighborhoods: rows,
    });
  } catch (err) {
    console.error("GET NEIGHBORHOODS ERROR:", err);
    res.status(500).json({ success: false });
  }
});

/* =========================
   ADD Neighborhood
========================= */
router.post("/", async (req, res) => {
  try {
    const { branch_id, name, delivery_fee } = req.body;

    if (!branch_id || !name) {
      return res.json({ success: false, message: "البيانات ناقصة" });
    }

    await db.query(
      `
      INSERT INTO neighborhoods (branch_id, name, delivery_fee)
      VALUES (?, ?, ?)
      `,
      [branch_id, name, delivery_fee || 0]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("ADD NEIGHBORHOOD ERROR:", err);
    res.status(500).json({ success: false });
  }
});

/* =========================
   UPDATE Neighborhood
========================= */
router.put("/:id", async (req, res) => {
  const { branch_id, name, delivery_fee } = req.body;

  if (!branch_id || !name) {
    return res.status(400).json({
      success: false,
      message: "بيانات ناقصة",
    });
  }

  try {
    await db.query(
      `
      UPDATE neighborhoods
      SET branch_id = ?, name = ?, delivery_fee = ?
      WHERE id = ?
      `,
      [branch_id, name, delivery_fee || 0, req.params.id]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("UPDATE NEIGHBORHOOD ERROR:", err);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

/* =========================
   DELETE Neighborhood
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

/* =========================
   GET /neighborhoods/by-branch/:branchId
========================= */
router.get("/by-branch/:branchId", async (req, res) => {
  try {
    const [rows] = await db.query(
      `
      SELECT id, name, delivery_fee, branch_id
      FROM neighborhoods
      WHERE branch_id = ?
      ORDER BY id DESC
      `,
      [req.params.branchId]
    );

    res.json({ success: true, neighborhoods: rows });
  } catch (err) {
    console.error("GET NEIGHBORHOODS BY BRANCH ERROR:", err);
    res.status(500).json({ success: false });
  }
});

export default router;
