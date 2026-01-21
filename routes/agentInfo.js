
export default router;
import express from "express";
import db from "../db.js";
import auth from "../middlewares/auth.js";

const router = express.Router();
router.use(auth);

/* =========================
   GET /agent-info
========================= */
router.get("/", async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT ai.id,
             a.name AS agent_name,
             g.name AS group_name,
             acc1.name_ar AS agent_account_name,
             acc2.name_ar AS commission_account_name,
             ai.commission
      FROM agent_info ai
      JOIN agents a ON a.id = ai.agent_id
      JOIN agent_groups g ON g.id = ai.group_id
      JOIN accounts acc1 ON acc1.id = ai.agent_account_id
      JOIN accounts acc2 ON acc2.id = ai.commission_account_id
      ORDER BY ai.id DESC
    `);

    res.json(rows);
  } catch (err) {
    console.error("AGENT INFO GET ERROR:", err);
    res.status(500).json({ success: false });
  }
});

/* =========================
   POST /agent-info
========================= */
router.post("/", async (req, res) => {
  try {
    const {
      agent_id,
      group_id,
      agent_account_id,
      commission_account_id,
      commission,
    } = req.body;

    if (!agent_id || !group_id || !agent_account_id || !commission_account_id) {
      return res.status(400).json({ success: false, message: "بيانات ناقصة" });
    }

    await db.query(
      `
      INSERT INTO agent_info
      (agent_id, group_id, agent_account_id, commission_account_id, commission)
      VALUES (?, ?, ?, ?, ?)
      `,
      [
        agent_id,
        group_id,
        agent_account_id,
        commission || 0,
      ]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("AGENT INFO ADD ERROR:", err);
    res.status(500).json({ success: false });
  }
});

export default router;
