import express from "express";
import pool from "../db.js";
import auth from "../middlewares/auth.js";

const router = express.Router();

/*
  نفترض أن auth يضيف:
  req.user = { id, role, branch_id, is_admin_branch }
*/

// حماية كل المسارات
router.use(auth);

/* =========================
   GET /branches
   جلب الفروع حسب نوع المستخدم
   مع ملخص وقت اليوم
========================= */
router.get("/", async (req, res) => {
  try {
    const user = req.user || {};

    // حساب يوم الأسبوع بنظامنا: 0 = السبت ... 6 = الجمعة
    const jsDay = new Date().getDay(); // 0 = الأحد ... 6 = السبت
    const today = (jsDay + 6) % 7;

    let rows;

    // إدارة عامة → كل الفروع
    if (user.role === "admin" || user.is_admin_branch === 1) {
      [rows] = await pool.query(
        `
        SELECT b.id, b.name, b.address, b.phone,
               w.open_time AS today_from,
               w.close_time AS today_to,
               w.is_closed AS today_closed
        FROM branches b
        LEFT JOIN branch_work_times w
          ON w.branch_id = b.id AND w.day_of_week = ?
        ORDER BY b.id ASC
        `,
        [today]
      );
    } else {
      // مستخدم عادي → فرعه فقط
      if (!user.branch_id) {
        return res.json({ success: true, branches: [] });
      }

      [rows] = await pool.query(
        `
        SELECT b.id, b.name, b.address, b.phone,
               w.open_time AS today_from,
               w.close_time AS today_to,
               w.is_closed AS today_closed
        FROM branches b
        LEFT JOIN branch_work_times w
          ON w.branch_id = b.id AND w.day_of_week = ?
        WHERE b.id = ?
        `,
        [today, user.branch_id]
      );
    }

    res.json({ success: true, branches: rows });
  } catch (err) {
    console.error("GET BRANCHES ERROR:", err);
    res.status(500).json({ success: false });
  }
});

/* =========================
   POST /branches (إضافة فرع)
========================= */
router.post("/", async (req, res) => {
  try {
    const { name, address, phone, is_admin } = req.body;

    if (!name) {
      return res
        .status(400)
        .json({ success: false, message: "اسم الفرع مطلوب" });
    }

    const [result] = await pool.query(
      `
      INSERT INTO branches (name, address, phone, is_admin)
      VALUES (?, ?, ?, ?)
      `,
      [name, address || null, phone || null, is_admin ? 1 : 0]
    );

    res.json({
      success: true,
      message: "تم إضافة الفرع",
      id: result.insertId,
    });
  } catch (err) {
    console.error("ADD BRANCH ERROR:", err);
    res.status(500).json({ success: false });
  }
});

/* =========================
   PUT /branches/:id (تعديل)
========================= */
router.put("/:id", async (req, res) => {
  try {
    const { name, address, phone } = req.body;

    await pool.query(
      `
      UPDATE branches
      SET name=?, address=?, phone=?
      WHERE id=?
      `,
      [name, address || null, phone || null, req.params.id]
    );

    res.json({ success: true, message: "تم التعديل" });
  } catch (err) {
    console.error("UPDATE BRANCH ERROR:", err);
    res.status(500).json({ success: false });
  }
});

/* =========================
   DELETE /branches/:id
========================= */
router.delete("/:id", async (req, res) => {
  try {
    await pool.query(`DELETE FROM branches WHERE id=?`, [req.params.id]);
    res.json({ success: true, message: "تم الحذف" });
  } catch (err) {
    console.error("DELETE BRANCH ERROR:", err);
    res.status(500).json({ success: false });
  }
});

export default router;
