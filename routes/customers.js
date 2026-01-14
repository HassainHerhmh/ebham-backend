import express from "express";
import db from "../db.js";
import bcrypt from "bcrypt";
import auth from "../middlewares/auth.js";

const router = express.Router();

// حماية كل المسارات
router.use(auth);

/* =========================
   GET /customers
========================= */
router.get("/", async (req, res) => {
  try {
    const authUser = req.user;
    const headerBranch = req.headers["x-branch-id"];

    let where = "";
    const params = [];

    if (authUser.is_admin_branch) {
      // إدارة عامة
      if (headerBranch) {
        where = "WHERE c.branch_id = ?";
        params.push(headerBranch);
      }
      // بدون اختيار فرع → يجلب الكل
    } else {
      // مستخدم فرع → دائمًا فرعه فقط
      where = "WHERE c.branch_id = ?";
      params.push(authUser.branch_id);
    }

    const [rows] = await db.query(
      `
      SELECT 
        c.id,
        c.name,
        c.phone,
        c.email,
        c.created_at,
        c.branch_id,
        b.name AS branch_name
      FROM customers c
      LEFT JOIN branches b ON b.id = c.branch_id
      ${where}
      ORDER BY c.id DESC
      `,
      params
    );

    res.json({ success: true, customers: rows });
  } catch (err) {
    console.error("GET CUSTOMERS ERROR:", err);
    res.status(500).json({ success: false });
  }
});

/* =========================
   POST /customers
========================= */
router.post("/", async (req, res) => {
  try {
    const { name, phone, email, password } = req.body;
    const authUser = req.user;
    const headerBranch = req.headers["x-branch-id"];

    if (!name || !phone) {
      return res
        .status(400)
        .json({ success: false, message: "الاسم ورقم الهاتف مطلوبان" });
    }

    // تحديد الفرع
    let branchId;

    if (authUser.is_admin_branch) {
      // إدارة عامة
      branchId = headerBranch || authUser.branch_id;
    } else {
      // مستخدم فرع
      branchId = authUser.branch_id;
    }

    const hashed = password
      ? await bcrypt.hash(password, 10)
      : null;

    await db.query(
      `
      INSERT INTO customers (name, phone, email, password, branch_id)
      VALUES (?, ?, ?, ?, ?)
      `,
      [name, phone, email || null, hashed, branchId]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("ADD CUSTOMER ERROR:", err);
    res.status(500).json({ success: false });
  }
});

/* =========================
   PUT /customers/:id
========================= */
router.put("/:id", async (req, res) => {
  const { name, phone, email, is_profile_complete } = req.body;

  try {
    await db.query(
      `
      UPDATE customers
      SET name = ?, phone = ?, email = ?, is_profile_complete = ?
      WHERE id = ?
      `,
      [
        name,
        phone,
        email || null,
        is_profile_complete ?? 0,
        req.params.id,
      ]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("UPDATE CUSTOMER ERROR:", err);
    res.status(500).json({ success: false });
  }
});

/* =========================
   DELETE /customers/:id
========================= */
router.delete("/:id", async (req, res) => {
  try {
    await db.query("DELETE FROM customers WHERE id=?", [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error("DELETE CUSTOMER ERROR:", err);
    res.status(500).json({ success: false });
  }
});

/* =========================
   PUT /customers/:id/reset-password
========================= */
router.put("/:id/reset-password", async (req, res) => {
  try {
    const newPass = Math.random().toString(36).slice(-8);
    const hashed = await bcrypt.hash(newPass, 10);

    await db.query(
      "UPDATE customers SET password=? WHERE id=?",
      [hashed, req.params.id]
    );

    res.json({ success: true, new_password: newPass });
  } catch (err) {
    console.error("RESET PASSWORD ERROR:", err);
    res.status(500).json({ success: false });
  }
});

export default router;
