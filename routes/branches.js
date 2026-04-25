import express from "express";
import pool from "../db.js";
import auth from "../middlewares/auth.js";

const router = express.Router();

let branchGeoSchemaReady = false;

const normalizeBoundaryPoints = (points) => {
  if (!Array.isArray(points)) return [];

  return points
    .map((point) => ({
      lat: Number(point?.lat),
      lng: Number(point?.lng),
    }))
    .filter(
      (point) =>
        Number.isFinite(point.lat) &&
        Number.isFinite(point.lng) &&
        Math.abs(point.lat) <= 90 &&
        Math.abs(point.lng) <= 180
    );
};

const parseBoundaryPoints = (value) => {
  if (!value) return [];

  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return normalizeBoundaryPoints(parsed);
  } catch {
    return [];
  }
};

async function ensureBranchGeoSchema() {
  if (branchGeoSchemaReady) return;

  try {
    await pool.query(
      "ALTER TABLE branches ADD COLUMN boundary_points LONGTEXT NULL"
    );
  } catch (error) {
    if (error?.code !== "ER_DUP_FIELDNAME") {
      throw error;
    }
  }

  branchGeoSchemaReady = true;
}

/* =========================
   GET /branches/public
========================= */
router.get("/public", async (req, res) => {
  try {
    await ensureBranchGeoSchema();

    const [rows] = await pool.query(`
      SELECT 
        b.id,
        b.name,
        b.name AS branch_name,
        b.address,
        b.phone,
        b.boundary_points
      FROM branches b
      WHERE b.is_admin = 0
      ORDER BY b.id ASC
    `);

    const branches = (rows || []).map((branch) => ({
      ...branch,
      boundary_points: parseBoundaryPoints(branch.boundary_points),
    }));

    res.json({ success: true, branches });
  } catch (err) {
    console.error("GET BRANCHES PUBLIC ERROR:", err);
    res.status(500).json({ success: false });
  }
});

router.use(auth);

/* =========================
   GET /branches
========================= */
router.get("/", async (req, res) => {
  try {
    await ensureBranchGeoSchema();

    const user = req.user || {};
    const jsDay = new Date().getDay();
    const today = (jsDay + 6) % 7;

    let rows;

    if (user.is_admin_branch) {
      [rows] = await pool.query(
        `
        SELECT b.id, b.name, b.address, b.phone, b.boundary_points,
               w.open_time AS today_from,
               w.close_time AS today_to,
               w.is_closed AS today_closed
        FROM branches b
        LEFT JOIN branch_work_times w
          ON w.branch_id = b.id
         AND w.day_of_week = ?
        ORDER BY b.id ASC
        `,
        [today]
      );
    } else {
      if (!user.branch_id) {
        return res.json({ success: true, branches: [] });
      }

      [rows] = await pool.query(
        `
        SELECT b.id, b.name, b.address, b.phone, b.boundary_points,
               w.open_time AS today_from,
               w.close_time AS today_to,
               w.is_closed AS today_closed
        FROM branches b
        LEFT JOIN branch_work_times w
          ON w.branch_id = b.id
         AND w.day_of_week = ?
        WHERE b.id = ?
        `,
        [today, user.branch_id]
      );
    }

    const branches = (rows || []).map((branch) => ({
      ...branch,
      boundary_points: parseBoundaryPoints(branch.boundary_points),
    }));

    res.json({ success: true, branches });
  } catch (err) {
    console.error("GET BRANCHES ERROR:", err);
    res.status(500).json({ success: false });
  }
});

/* =========================
   POST /branches
========================= */
router.post("/", async (req, res) => {
  try {
    await ensureBranchGeoSchema();

    const { name, address, phone, is_admin, boundary_points } = req.body;

    if (!name) {
      return res
        .status(400)
        .json({ success: false, message: "اسم الفرع مطلوب" });
    }

    const normalizedPoints = normalizeBoundaryPoints(boundary_points);

    const [result] = await pool.query(
      `
      INSERT INTO branches (name, address, phone, is_admin, boundary_points)
      VALUES (?, ?, ?, ?, ?)
      `,
      [
        name,
        address || null,
        phone || null,
        is_admin ? 1 : 0,
        normalizedPoints.length ? JSON.stringify(normalizedPoints) : null,
      ]
    );

    res.json({
      success: true,
      message: "تم إضافة الفرع",
      id: result.insertId,
    });
  } catch (err) {
    console.error("ADD BRANCH ERROR:", err);
    res.status(500).json({ success: false });
  }
});

/* =========================
   PUT /branches/:id
========================= */
router.put("/:id", async (req, res) => {
  try {
    await ensureBranchGeoSchema();

    const branchId = Number(req.params.id);
    const user = req.user || {};

    if (!Number.isFinite(branchId)) {
      return res
        .status(400)
        .json({ success: false, message: "معرف الفرع غير صالح" });
    }

    if (!user.is_admin_branch && Number(user.branch_id) !== branchId) {
      return res
        .status(403)
        .json({ success: false, message: "غير مصرح لك بتعديل هذا الفرع" });
    }

    const { name, address, phone, boundary_points } = req.body;

    if (!name) {
      return res
        .status(400)
        .json({ success: false, message: "اسم الفرع مطلوب" });
    }

    const normalizedPoints = normalizeBoundaryPoints(boundary_points);

    const [result] = await pool.query(
      `
      UPDATE branches
      SET name = ?, address = ?, phone = ?, boundary_points = ?
      WHERE id = ?
      `,
      [
        name,
        address || null,
        phone || null,
        normalizedPoints.length ? JSON.stringify(normalizedPoints) : null,
        branchId,
      ]
    );

    if (!result.affectedRows) {
      return res
        .status(404)
        .json({ success: false, message: "الفرع غير موجود" });
    }

    res.json({ success: true, message: "تم تحديث الفرع" });
  } catch (err) {
    console.error("UPDATE BRANCH ERROR:", err);
    res.status(500).json({ success: false });
  }
});

/* =========================
   DELETE /branches/:id
========================= */
router.delete("/:id", async (req, res) => {
  try {
    const branchId = req.params.id;

    const [times] = await pool.query(
      `SELECT COUNT(*) AS c FROM branch_work_times WHERE branch_id=?`,
      [branchId]
    );

    if (times[0].c > 0) {
      return res.status(400).json({
        success: false,
        message: "لا يمكن حذف الفرع لأنه يحتوي على بيانات وقت",
      });
    }

    await pool.query(`DELETE FROM branches WHERE id=?`, [branchId]);

    res.json({ success: true, message: "تم الحذف" });
  } catch (err) {
    console.error("DELETE BRANCH ERROR:", err);
    res.status(500).json({ success: false });
  }
});

export default router;
