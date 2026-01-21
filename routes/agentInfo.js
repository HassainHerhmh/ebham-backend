import express from "express";
import db from "../db.js";
import auth from "../middlewares/auth.js";

const router = express.Router();
router.use(auth);

/* GET /agent-info */
router.get("/", async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT 
        c.id,
        c.account_type,
        c.commission_type,
        c.commission_value,
        c.contract_start,
        c.contract_end,
        c.is_active,

        a.name AS agent_name,
        k.name AS captain_name,
        g.name AS group_name
      FROM commissions c
      LEFT JOIN agents a ON c.account_type='agent' AND a.id = c.account_id
      LEFT JOIN captains k ON c.account_type='captain' AND k.id = c.account_id
      LEFT JOIN agent_groups g ON g.id = c.group_id
      ORDER BY c.id DESC
    `);

    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false });
  }
});

/* POST /agent-info */
router.post("/", async (req, res) => {
  const {
    account_type,
    account_id,
    group_id,
    commission_type,
    commission_value,
    contract_start,
    contract_end,
  } = req.body;

  if (!account_type || !account_id) {
    return res.json({ success: false, message: "بيانات ناقصة" });
  }

  await db.query(
    `
    INSERT INTO commissions
    (account_type, account_id, group_id, commission_type, commission_value, contract_start, contract_end)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
    [
      account_type,
      account_id,
      group_id || null,
      commission_type,
      commission_value,
      contract_start,
      contract_end,
    ]
  );

  res.json({ success: true });
});

export default router;
