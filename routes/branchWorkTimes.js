// routes/branchWorkTimes.js
import express from "express";
import pool from "../db.js";

const router = express.Router();

/* =========================
   GET /api/branch-work-times/:branchId
========================= */
router.get("/:branchId", async (req, res) => {
  try {
    const branchId = req.params.branchId;

    const [rows] = await pool.query(
      `
      SELECT day_of_week AS day,
             open_time AS \`from\`,
             close_time AS \`to\`,
             is_closed AS closed,
             notes
      FROM branch_work_times
      WHERE branch_id = ?
      ORDER BY day_of_week ASC
      `,
      [branchId]
    );

    res.json({
      success: true,
      days: rows,
      notes: rows.find(r => r.notes)?.notes || ""
    });
  } catch (err) {
    console.error("GET WORK TIMES ERROR:", err);
    res.status(500).json({ success: false });
  }
});

/* =========================
   POST /api/branch-work-times/:branchId
========================= */
router.post("/:branchId", async (req, res) => {
  try {
    const branchId = req.params.branchId;
    const { days, notes } = req.body;

    if (!Array.isArray(days)) {
      return res.status(400).json({ success: false });
    }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      for (const d of days) {
        await conn.query(
          `
          INSERT INTO branch_work_times
            (branch_id, day_of_week, open_time, close_time, is_closed, notes)
          VALUES (?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            open_time = VALUES(open_time),
            close_time = VALUES(close_time),
            is_closed = VALUES(is_closed),
            notes = VALUES(notes)
          `,
          [
            branchId,
            d.day,
            d.from || null,
            d.to || null,
            d.closed ? 1 : 0,
            d.closed ? notes || null : null,
          ]
        );
      }

      await conn.commit();
      res.json({ success: true, message: "تم حفظ الوقت" });
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  } catch (err) {
    console.error("SAVE WORK TIMES ERROR:", err);
    res.status(500).json({ success: false });
  }
});

export default router;
