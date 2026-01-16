import express from "express";
import db from "../db.js";
import auth from "../middlewares/auth.js";

const router = express.Router();

/* =========================
   حماية كل المسارات
========================= */
router.use(auth);

/* =========================
   GET /customers
========================= */
router.get("/", async (req, res) => {
  try {
    const { is_admin_branch, branch_id } = req.user;
    let selectedBranch = req.headers["x-branch-id"];

    if (selectedBranch === "all") selectedBranch = null;

    let rows;

    if (is_admin_branch) {
      if (selectedBranch) {
        [rows] = await db.query(
          `
          SELECT c.*, b.name AS branch_name
          FROM customers c
          LEFT JOIN branches b ON b.id = c.branch_id
          WHERE c.branch_id = ?
          ORDER BY c.id DESC
          `,
          [selectedBranch]
        );
      } else {
        [rows] = await db.query(
          `
          SELECT c.*, b.name AS branch_name
          FROM customers c
          LEFT JOIN branches b ON b.id = c.branch_id
          ORDER BY c.id DESC
          `
        );
      }
    } else {
      [rows] = await db.query(
        `
        SELECT c.*, b.name AS branch_name
        FROM customers c
        LEFT JOIN branches b ON b.id = c.branch_id
        WHERE c.branch_id = ?
        ORDER BY c.id DESC
        `,
        [branch_id]
      );
    }

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
    const { name, phone, phone_alt, email, password } = req.body;
    if (!name || !phone) {
      return res.json({ success: false, message: "الاسم والجوال مطلوبان" });
    }

    const { is_admin_branch, branch_id } = req.user;
    let selectedBranch = req.headers["x-branch-id"];

    let finalBranchId = branch_id;

    if (is_admin_branch && selectedBranch && selectedBranch !== "all") {
      finalBranchId = Number(selectedBranch);
    }

    await db.query(
      `
      INSERT INTO customers (name, phone, phone_alt, email, password, branch_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, NOW())
      `,
      [name, phone, phone_alt || null, email || null, password || null, finalBranchId]
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
  const { name, phone, phone_alt, email, is_active } = req.body;

  const fields = [];
  const values = [];

  if (name !== undefined) {
    fields.push("name=?");
    values.push(name);
  }
  if (phone !== undefined) {
    fields.push("phone=?");
    values.push(phone);
  }
  if (phone_alt !== undefined) {
    fields.push("phone_alt=?");
    values.push(phone_alt);
  }
  if (email !== undefined) {
    fields.push("email=?");
    values.push(email);
  }
  if (is_active !== undefined) {
    fields.push("is_active=?");
    values.push(is_active);
  }

  if (!fields.length) {
    return res.json({ success: false, message: "لا توجد بيانات للتحديث" });
  }

  try {
    await db.query(
      `
      UPDATE customers
      SET ${fields.join(", ")}
      WHERE id=?
      `,
      [...values, req.params.id]
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
   POST /customers/:id/toggle
========================= */
router.post("/:id/toggle", async (req, res) => {
  try {
    const [rows] = await db.query(
      "SELECT is_active FROM customers WHERE id=?",
      [req.params.id]
    );

    if (!rows.length) {
      return res.json({ success: false, message: "العميل غير موجود" });
    }

    const newStatus = rows[0].is_active ? 0 : 1;

    await db.query(
      "UPDATE customers SET is_active=? WHERE id=?",
      [newStatus, req.params.id]
    );

    res.json({ success: true, is_active: newStatus });
  } catch (err) {
    console.error("TOGGLE CUSTOMER ERROR:", err);
    res.status(500).json({ success: false });
  }
});

/* =========================
   POST /customers/:id/reset-password
========================= */
router.post("/:id/reset-password", async (req, res) => {
  try {
    const generatePassword = (length = 8) => {
      const chars =
        "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
      let pass = "";
      for (let i = 0; i < length; i++) {
        pass += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      return pass;
    };

    const newPassword = generatePassword(8);

    await db.query(
      "UPDATE customers SET password=? WHERE id=?",
      [newPassword, req.params.id]
    );

    res.json({
      success: true,
      password: newPassword,
    });
  } catch (err) {
    console.error("RESET PASSWORD ERROR:", err);
    res.status(500).json({ success: false });
  }
});

export default router;
