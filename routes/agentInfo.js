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
    const { branch_id, is_admin_branch } = req.user;

    let where = "1=1";
    const params = [];

    if (!is_admin_branch) {
      where = "(acc1.branch_id = ? OR acc1.branch_id IS NULL)";
      params.push(branch_id);
    }

    const [rows] = await db.query(`
      SELECT 
        c.id,
        c.account_type,
        c.account_id,
        c.group_id,
        c.commission_type,
        c.commission_value,
        c.contract_start,
        c.contract_end,
        c.agent_account_id,
        c.commission_account_id,
        c.currency_id,
        c.is_active,

        COALESCE(a.name, k.name) AS agent_name,
        g.name AS group_name,

        acc1.name_ar AS agent_account_name,
        acc2.name_ar AS commission_account_name,

        br.name AS branch_name,

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

      LEFT JOIN branches br
        ON br.id = acc1.branch_id   -- ✅ ربط آمن

      LEFT JOIN currencies cur
        ON cur.id = c.currency_id

      WHERE ${where}

      ORDER BY c.id DESC
    `, params);

    res.json({ success: true, list: rows });

  } catch (e) {
    console.error("AGENT INFO ERROR:", e);
    res.status(500).json({
      success: false,
      message: e.message
    });
  }
});


/* =========================
   POST /agent-info
========================= */
router.post("/", async (req, res) => {
  try {

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

    /* فرع المستخدم */
    const branch_id = req.user.branch_id;

    /* تحقق أساسي */
    if (
      !account_type ||
      !account_id ||
      !contract_start ||
      !contract_end ||
      !branch_id
    ) {
      return res.json({
        success: false,
        message: "بيانات ناقصة",
      });
    }

    /* تحقق من التواريخ */
    if (new Date(contract_end) < new Date(contract_start)) {
      return res.json({
        success: false,
        message: "تاريخ النهاية غير صحيح",
      });
    }

    /* منع تكرار عقد في نفس الفرع */
    const [exists] = await db.query(
      `
      SELECT id FROM commissions
      WHERE account_type = ?
        AND account_id = ?
        AND branch_id = ?
        AND CURDATE() BETWEEN contract_start AND contract_end
        AND is_active = 1
      LIMIT 1
      `,
      [account_type, account_id, branch_id]
    );

    if (exists.length) {
      return res.json({
        success: false,
        message: "يوجد عقد نشط لهذا الحساب في هذا الفرع بالفعل",
      });
    }

    /* إدخال العقد */
    await db.query(
      `
      INSERT INTO commissions
      (
        branch_id,
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
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
      `,
      [
        branch_id,
        account_type,
        Number(account_id),
        group_id ? Number(group_id) : null,
        commission_type,
        Number(commission_value || 0),
        contract_start,
        contract_end,
        agent_account_id ? Number(agent_account_id) : null,
        commission_account_id
          ? Number(commission_account_id)
          : null,
        currency_id ? Number(currency_id) : null,
      ]
    );

    res.json({
      success: true,
      message: "تم حفظ العقد بنجاح",
    });

  } catch (err) {

    console.error("ADD COMMISSION ERROR:", err);

    res.status(500).json({
      success: false,
      message: "حدث خطأ أثناء حفظ العقد",
    });
  }
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
