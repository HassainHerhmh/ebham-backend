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
          `SELECT * FROM customers WHERE branch_id = ? ORDER BY id DESC`,
          [selectedBranch]
        );
      } else {
        [rows] = await db.query(
          `SELECT * FROM customers ORDER BY id DESC`
        );
      }
    } else {
      [rows] = await db.query(
        `SELECT * FROM customers WHERE branch_id = ? ORDER BY id DESC`,
        [branch_id]
      );
    }

    res.json({ success: true, customers: rows });
  } catch (err) {
    console.error("GET CUSTOMERS ERROR:", err);
    res.status(500).json({ success: false });
  }
});

router.post("/", async (req, res) => {
  try {
    const { name, phone, email, password, branch_id } = req.body;
    const { is_admin_branch, branch_id: userBranch } = req.user;

    if (!name || !phone || !password) {
      return res.json({ success: false, message: "بيانات ناقصة" });
    }

    let finalBranchId = userBranch;

    if (is_admin_branch && branch_id) {
      finalBranchId = branch_id;
    }

    await db.query(
      `
      INSERT INTO customers (name, phone, email, password, branch_id)
      VALUES (?, ?, ?, ?, ?)
      `,
      [name, phone, email || null, password, finalBranchId]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("ADD CUSTOMER ERROR:", err);
    res.status(500).json({ success: false });
  }
});

/* =========================
   POST /customers
========================= */
router.post("/", async (req, res) => {
  try {
    const { name, phone, email, password } = req.body;
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
      INSERT INTO customers (name, phone, email, password, branch_id, created_at)
      VALUES (?, ?, ?, ?, ?, NOW())
      `,
      [name, phone, email || null, password || null, finalBranchId]
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
  const { name, phone, email, is_active } = req.body;

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

export default router;
