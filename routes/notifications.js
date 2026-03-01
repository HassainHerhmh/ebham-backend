import express from "express";
import db from "../db.js";
import auth from "../middlewares/auth.js";

const router = express.Router();

router.use(auth);

/* =========================
   GET /notifications
   جلب كل إشعارات الكابتن
========================= */
router.get("/", async (req, res) => {
  try {

    const captainId = req.user.id;

    const [rows] = await db.query(
      `SELECT *
       FROM notifications
       WHERE captain_id = ?
       ORDER BY id DESC
       LIMIT 50`,
      [captainId]
    );

    res.json({
      success: true,
      notifications: rows
    });

  } catch (err) {
    res.status(500).json({
      success: false,
      notifications: []
    });
  }
});

/* =========================
   GET /notifications/count
========================= */
router.get("/count", async (req, res) => {
  try {

    const captainId = req.user.id;

    const [[row]] = await db.query(
      `SELECT COUNT(*) AS total
       FROM notifications
       WHERE captain_id = ?
       AND is_read = 0`,
      [captainId]
    );

    res.json({
      success: true,
      count: row.total
    });

  } catch (err) {
    res.status(500).json({
      success: false,
      count: 0
    });
  }
});

/* =========================
   PUT /notifications/read/:id
========================= */
router.put("/read/:id", async (req, res) => {
  try {

    const id = req.params.id;
    const captainId = req.user.id;

    await db.query(
      `UPDATE notifications
       SET is_read = 1
       WHERE id = ?
       AND captain_id = ?`,
      [id, captainId]
    );

    res.json({ success: true });

  } catch (err) {
    res.status(500).json({ success: false });
  }
});
/* =========================
   PUT /notifications/read-all
========================= */
router.put("/read-all", async (req, res) => {
  try {

    const captainId = req.user.id;

    await db.query(
      `UPDATE notifications
       SET is_read = 1
       WHERE captain_id = ?
       AND is_read = 0`,
      [captainId]
    );

    res.json({ success: true });

  } catch (err) {
    console.error("Read All Error:", err);
    res.status(500).json({ success: false });
  }
});
export default router;
