import express from "express";
import db from "../db.js";
import auth from "../middlewares/auth.js";

const router = express.Router();
router.use(auth);

/* =========================
   GET /agent-info
========================= */
router.get("/", async (req, res) => {
  console.log("REQ USER =>", req.user);

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

        COALESCE(a.name, k.name) AS agent_name,
        g.name AS group_name,

        acc1.name_ar AS agent_account_name,
        acc2.name_ar AS commission_account_name,
        cur.code AS currency_code,

        CASE 
          WHEN CURDATE() BETWEEN c.contract_start AND c.contract_end 
          THEN 1 ELSE 0 
        END AS is_valid_now

      FROM commissions c
      LEFT JOIN agents a 
        ON c.account_type = 'agent' AND a.id = c.account_id
      LEFT JOIN captains k 
        ON c.account_type = 'captain' AND k.id = c.account_id
      LEFT JOIN agent_groups g 
        ON g.id = c.group_id

      LEFT JOIN accounts acc1 
        ON acc1.id = c.agent_account_id
      LEFT JOIN accounts acc2 
        ON acc2.id = c.commission_account_id
      LEFT JOIN currencies cur
        ON cur.id = c.currency_id

      ORDER BY c.id DESC
    `);

    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, error: e.message });
  }
});

/* =========================
   POST /agent-info
========================= */
router.post("/", async (req, res) => {
     console.log("REQ USER =>", req.user);
  const {
    account_type,
    account_id,
    group_id,
    commission_type,
    commission_value,
    contract_start,
    contract_end,
    agent_account_id,
    commission_account_id,
    currency_id,
  } = req.body;

  if (!account_type || !account_id || !contract_start || !contract_end) {
    return res.json({ success: false, message: "بيانات ناقصة" });
  }

  if (new Date(contract_end) < new Date(contract_start)) {
    return res.json({ success: false, message: "تاريخ النهاية غير صحيح" });
  }

  const [exists] = await db.query(
    `
    SELECT id FROM commissions
    WHERE account_type = ?
      AND account_id = ?
      AND CURDATE() BETWEEN contract_start AND contract_end
      AND is_active = 1
    LIMIT 1
    `,
    [account_type, account_id]
  );

  if (exists.length) {
    return res.json({
      success: false,
      message: "يوجد عقد نشط لهذا الحساب بالفعل",
    });
  }

  await db.query(
    `
    INSERT INTO commissions
    (
      account_type,
      account_id,
      group_id,
      commission_type,
      commission_value,
      contract_start,
      contract_end,
      agent_account_id,
      commission_account_id,
      currency_id,
      is_active
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `,
    [
      account_type,
      Number(account_id),
      group_id ? Number(group_id) : null,
      commission_type,
      Number(commission_value || 0),
      contract_start,
      contract_end,
      agent_account_id ? Number(agent_account_id) : null,
      commission_account_id ? Number(commission_account_id) : null,
      currency_id ? Number(currency_id) : null,
    ]
  );

  res.json({ success: true });
});


/* =========================
   PUT /agent-info/:id
========================= */
router.put("/:id", async (req, res) => {
  const {
    commission_type,
    commission_value,
    contract_start,
    contract_end,
    is_active,
  } = req.body;

  await db.query(
    `
    UPDATE commissions SET
      commission_type = ?,
      commission_value = ?,
      contract_start = ?,
      contract_end = ?,
      is_active = ?
    WHERE id = ?
    `,
    [
      commission_type,
      commission_value,
      contract_start,
      contract_end,
      is_active ? 1 : 0,
      req.params.id,
    ]
  );

  res.json({ success: true });
});

export default router;
