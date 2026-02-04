import express from "express";
import db from "../db.js";
import auth from "../middlewares/auth.js";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

const router = express.Router();

/* توليد كلمة مرور عشوائية */
const generatePassword = (length = 8) => {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let pass = "";
  for (let i = 0; i < length; i++) {
    pass += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return pass;
};

/* =========================
   GET /agents
   جلب الوكلاء
========================= */
router.get("/", auth, async (req, res) => {
   console.log("REQ USER =>", req.user);
  try {
    const { is_admin_branch, is_admin, branch_id } = req.user;
    const selectedBranch = req.headers["x-branch-id"];

    let rows;

    if (is_admin_branch || is_admin) {
      // مستخدم من الإدارة العامة

      if (selectedBranch && Number(selectedBranch) !== Number(branch_id)) {
        [rows] = await db.query(
          `
          SELECT a.*, b.name AS branch_name
          FROM agents a
          LEFT JOIN branches b ON b.id = a.branch_id
          WHERE a.branch_id = ?
          ORDER BY a.id DESC
          `,
          [selectedBranch]
        );
      } else {
        // الإدارة العامة → كل الوكلاء من كل الفروع
        [rows] = await db.query(`
          SELECT a.*, b.name AS branch_name
          FROM agents a
          LEFT JOIN branches b ON b.id = a.branch_id
          ORDER BY a.id DESC
        `);
      }
    } else {
      // مستخدم فرع عادي → يرى فرعه فقط
      [rows] = await db.query(
        `
        SELECT a.*, b.name AS branch_name
        FROM agents a
        LEFT JOIN branches b ON b.id = a.branch_id
        WHERE a.branch_id = ?
        ORDER BY a.id DESC
        `,
        [branch_id]
      );
    }

    res.json({ success: true, agents: rows });
  } catch (err) {
    console.error("GET AGENTS ERROR:", err);
    res.status(500).json({ success: false });
  }
});


/* =========================
   POST /agents
   إضافة وكيل
========================= */
router.post("/", auth, async (req, res) => {
  try {
    const user = req.user;
    const { name, email, phone, address, branch_id, image_url } = req.body;

    // تحقق من الاسم
    if (!name) {
      return res
        .status(400)
        .json({ success: false, message: "الاسم مطلوب" });
    }

    // تحديد الفرع
    const finalBranch =
      user.is_admin === 1 ? branch_id : user.branch_id;

    if (!finalBranch) {
      return res
        .status(400)
        .json({ success: false, message: "الفرع مطلوب" });
    }

    /* =====================
       التحقق من التكرار
    ===================== */

    // تحقق من الهاتف
    if (phone) {
      const [phoneRows] = await db.query(
        "SELECT id FROM agents WHERE phone = ? LIMIT 1",
        [phone]
      );

      if (phoneRows.length > 0) {
        return res.status(409).json({
          success: false,
          message: "رقم الهاتف مستخدم مسبقًا",
        });
      }
    }

    // تحقق من البريد
    if (email) {
      const [emailRows] = await db.query(
        "SELECT id FROM agents WHERE email = ? LIMIT 1",
        [email]
      );

      if (emailRows.length > 0) {
        return res.status(409).json({
          success: false,
          message: "البريد الإلكتروني مستخدم مسبقًا",
        });
      }
    }

    /* =====================
       إنشاء كلمة المرور
    ===================== */

    const plainPassword = generatePassword(8);
    const hash = await bcrypt.hash(plainPassword, 10);

    /* =====================
       الإدخال
    ===================== */

    await db.query(
      `
      INSERT INTO agents
        (name, email, phone, address, password, branch_id, is_active, image_url)
      VALUES (?, ?, ?, ?, ?, ?, 1, ?)
      `,
      [
        name,
        email || null,
        phone || null,
        address || null,
        hash,
        finalBranch,
        image_url || null,
      ]
    );

    res.json({
      success: true,
      password: plainPassword,
    });

  } catch (err) {
    console.error("ADD AGENT ERROR:", err);

    res.status(500).json({
      success: false,
      message: "حدث خطأ في السيرفر، حاول لاحقًا",
    });
  }
});

/* =========================
   PUT /agents/:id
   تعديل وكيل
========================= */
router.put("/:id", auth, async (req, res) => {
  try {
const { name, email, phone, address, branch_id, image_url } = req.body;

    const user = req.user;

    const fields = [];
    const values = [];

    if (name !== undefined) {
      fields.push("name = ?");
      values.push(name);
    }
    if (email !== undefined) {
      fields.push("email = ?");
      values.push(email || null);
    }
    if (phone !== undefined) {
      fields.push("phone = ?");
      values.push(phone || null);
    }
    if (address !== undefined) {
      fields.push("address = ?");
      values.push(address || null);
    }

     if (image_url !== undefined) {
  fields.push("image_url = ?");
  values.push(image_url || null);
}

    
    if (user.is_admin === 1 && branch_id) {
      fields.push("branch_id = ?");
      values.push(branch_id);
    }

    if (!fields.length) {
      return res.json({ success: true });
    }

    await db.query(
      `UPDATE agents SET ${fields.join(", ")} WHERE id = ?`,
      [...values, req.params.id]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("UPDATE AGENT ERROR:", err);
    res.status(500).json({ success: false });
  }
});

/* =========================
   PATCH /agents/:id/toggle
   تفعيل / تعطيل
========================= */
router.patch("/:id/toggle", auth, async (req, res) => {
  try {
    const { is_active } = req.body;

    await db.query(
      `UPDATE agents SET is_active = ? WHERE id = ?`,
      [is_active ? 1 : 0, req.params.id]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("TOGGLE AGENT ERROR:", err);
    res.status(500).json({ success: false });
  }
});

/* =========================
   DELETE /agents/:id
========================= */
router.delete("/:id", auth, async (req, res) => {
  try {
    await db.query(`DELETE FROM agents WHERE id = ?`, [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error("DELETE AGENT ERROR:", err);
    res.status(500).json({ success: false });
  }
});

/* =====================================================
   POST /agents/login
   تسجيل دخول تطبيق الوكلاء
===================================================== */
router.post("/login", async (req, res) => {
  try {
    const { phone, password } = req.body;

    const [rows] = await db.query(
      `SELECT * FROM agents WHERE phone = ? LIMIT 1`,
      [phone]
    );

    const agent = rows[0];
    if (!agent) {
      return res
        .status(401)
        .json({ success: false, message: "بيانات غير صحيحة" });
    }

    if (!agent.is_active) {
      return res
        .status(403)
        .json({ success: false, message: "الحساب معطل" });
    }

    const ok = await bcrypt.compare(password, agent.password);
    if (!ok) {
      return res
        .status(401)
        .json({ success: false, message: "بيانات غير صحيحة" });
    }

    const token = jwt.sign(
      {
        id: agent.id,
        name: agent.name,
        branch_id: agent.branch_id,
        role: "agent",
      },
      process.env.JWT_SECRET || "secret",
      { expiresIn: "7d" }
    );

res.json({
  success: true,
  token,
  agent: {
    id: agent.id,
    name: agent.name,
    phone: agent.phone,
    branch_id: agent.branch_id,
    image_url: agent.image_url, // 🆕 شعار الوكيل
  },
});

  } catch (err) {
    console.error("AGENT LOGIN ERROR:", err);
    res.status(500).json({ success: false });
  }
});
/* =========================
   POST /agents/:id/reset-password
   إعادة تعيين كلمة المرور
========================= */
router.post("/:id/reset-password", auth, async (req, res) => {
  try {
    // توليد كلمة مرور عشوائية 8 حروف/أرقام
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let newPassword = "";
    for (let i = 0; i < 8; i++) {
      newPassword += chars.charAt(Math.floor(Math.random() * chars.length));
    }

    const hash = await bcrypt.hash(newPassword, 10);

    await db.query(
      `UPDATE agents SET password = ? WHERE id = ?`,
      [hash, req.params.id]
    );

    // نرجع كلمة المرور الجديدة مرة واحدة فقط
    res.json({ success: true, password: newPassword });
  } catch (err) {
    console.error("RESET PASSWORD ERROR:", err);
    res.status(500).json({ success: false });
  }
});

export default router;
