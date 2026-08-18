import express from "express";
import db from "../db.js";
import auth from "../middlewares/auth.js";
import { emitCatalogUpdate } from "../utils/catalogEvents.js";
import { ensureNeighborhoodsI18nSchema } from "../utils/catalogI18n.js";

const router = express.Router();

let neighborhoodsGeoSchemaReady = false;

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

async function ensureNeighborhoodsGeoSchema() {
  if (neighborhoodsGeoSchemaReady) return;

  try {
    await db.query(
      "ALTER TABLE neighborhoods ADD COLUMN boundary_points LONGTEXT NULL"
    );
  } catch (error) {
    if (error?.code !== "ER_DUP_FIELDNAME") {
      throw error;
    }
  }

  neighborhoodsGeoSchemaReady = true;
}


/* =========================
   GET /neighborhoods/by-branch/:branchId  (عام للتطبيق)
========================= */

router.get("/by-branch/:branchId", async (req, res) => {
  try {
    await ensureNeighborhoodsGeoSchema();
    await ensureNeighborhoodsI18nSchema();
    const { branchId } = req.params;

    const [rows] = await db.query(
      `
      SELECT id, name, name_en, boundary_points
      FROM neighborhoods
      WHERE branch_id = ?
      ORDER BY name ASC
      `,
      [branchId]
    );

    res.json({
      success: true,
      neighborhoods: (rows || []).map((item) => ({
        ...item,
        boundary_points: parseBoundaryPoints(item.boundary_points),
      })),
    });
  } catch (err) {
    console.error("GET NEIGHBORHOODS BY BRANCH ERROR:", err?.message || err);
    res.status(500).json({ success: false });
  }
});

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
    await ensureNeighborhoodsGeoSchema();
    await ensureNeighborhoodsI18nSchema();
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
            n.name_en,
            n.delivery_fee,
            n.branch_id,
            n.boundary_points,
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
            n.name_en,
            n.delivery_fee,
            n.branch_id,
            n.boundary_points,
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
          n.name_en,
          n.delivery_fee,
          n.branch_id,
          n.boundary_points,
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

    res.json({
      success: true,
      neighborhoods: (rows || []).map((item) => ({
        ...item,
        boundary_points: parseBoundaryPoints(item.boundary_points),
      })),
    });
  } catch (err) {
    console.error("GET NEIGHBORHOODS ERROR:", err?.message || err);
    res.status(500).json({ success: false });
  }
});

/* =========================
   POST /neighborhoods
========================= */
router.post("/", async (req, res) => {
  try {
    await ensureNeighborhoodsGeoSchema();
    await ensureNeighborhoodsI18nSchema();
    const { name, name_en, delivery_fee, boundary_points } = req.body;
    const trimmedNameEn = String(name_en || "").trim() || null;
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

    const normalizedPoints = normalizeBoundaryPoints(boundary_points);

    await db.query(
      `
      INSERT INTO neighborhoods (branch_id, name, name_en, delivery_fee, boundary_points)
      VALUES (?, ?, ?, ?, ?)
      `,
      [
        finalBranchId,
        name,
        trimmedNameEn,
        delivery_fee || 0,
        normalizedPoints.length ? JSON.stringify(normalizedPoints) : null,
      ]
    );

    res.json({ success: true });
    emitCatalogUpdate(req.app, {
      entity: "neighborhoods",
      action: "create",
      branch_id: finalBranchId,
    });
  } catch (err) {
    console.error("ADD NEIGHBORHOOD ERROR:", err?.message || err);
    res.status(500).json({ success: false });
  }
});

/* =========================
   PUT /neighborhoods/:id
========================= */
router.put("/:id", async (req, res) => {
  const { name, name_en, delivery_fee, boundary_points } = req.body;
  const trimmedNameEn = String(name_en || "").trim() || null;
  const { is_admin_branch, branch_id } = req.user;
  const selectedBranch = req.headers["x-branch-id"];

  try {
    await ensureNeighborhoodsGeoSchema();
    await ensureNeighborhoodsI18nSchema();
    let finalBranchId = branch_id;
    const normalizedPoints = normalizeBoundaryPoints(boundary_points);

    if (is_admin_branch && selectedBranch) {
      finalBranchId = selectedBranch;
    }

    await db.query(
      `
      UPDATE neighborhoods
      SET name = ?, name_en = ?, delivery_fee = ?, branch_id = ?, boundary_points = ?
      WHERE id = ?
      `,
      [
        name,
        trimmedNameEn,
        delivery_fee || 0,
        finalBranchId,
        normalizedPoints.length ? JSON.stringify(normalizedPoints) : null,
        req.params.id,
      ]
    );

    res.json({ success: true });
    emitCatalogUpdate(req.app, {
      entity: "neighborhoods",
      action: "update",
      branch_id: finalBranchId,
    });
  } catch (err) {
    console.error("UPDATE NEIGHBORHOOD ERROR:", err?.message || err);
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
    emitCatalogUpdate(req.app, { entity: "neighborhoods", action: "delete" });
  } catch (err) {
    console.error("DELETE NEIGHBORHOOD ERROR:", err?.message || err);
    res.status(500).json({ success: false });
  }
});



export default router;
