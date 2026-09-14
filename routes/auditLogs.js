import express from "express";
import db from "../db.js";
import auth from "../middlewares/auth.js";

const router = express.Router();
router.use(auth);

router.get("/", async (req, res) => {
  try {
    const search = String(req.query.search || "").trim();
    const entityType = String(req.query.entity_type || "").trim();
    const params = [];
    let where = "1=1";

    if (!req.user?.is_admin_branch && req.user?.branch_id) {
      where += " AND (branch_id = ? OR branch_id IS NULL)";
      params.push(req.user.branch_id);
    }

    if (entityType) {
      where += " AND entity_type = ?";
      params.push(entityType);
    }

    if (search) {
      where += ` AND (
        actor_name LIKE ? OR action LIKE ? OR details LIKE ? OR entity_id LIKE ?
      )`;
      const q = `%${search}%`;
      params.push(q, q, q, q);
    }

    const [rows] = await db.query(
      `SELECT *
       FROM audit_logs
       WHERE ${where}
       ORDER BY id DESC
       LIMIT 300`,
      params
    );

    res.json({ success: true, list: rows });
  } catch (err) {
    console.error("AUDIT LIST ERROR:", err?.message || err);
    res.json({ success: true, list: [] });
  }
});

export default router;
