import express from "express";
import db from "../db.js";
import auth from "../middlewares/auth.js";

const router = express.Router();

// حماية جميع المسارات
router.use(auth);

/* =========================
   Currencies API (with branches + convert_mode)
========================= */

// 🟢 جلب العملات
router.get("/", async (req, res) => {
  try {
    const { is_admin_branch, branch_id } = req.user;

    // الفرع المختار من الهيدر (للإدارة)
    let selectedBranch = req.headers["x-branch-id"];

    if (selectedBranch === "all") {
      selectedBranch = null;
    }

    let where = "WHERE is_active = 1";
    const params = [];

    if (is_admin_branch) {
      if (selectedBranch) {
        where += " AND branch_id = ?";
        params.push(Number(selectedBranch));
      }
    } else {
      where += " AND branch_id = ?";
      params.push(branch_id);
    }

    const [rows] = await db.query(
      `
      SELECT *
      FROM currencies
      ${where}
      ORDER BY is_local DESC, id ASC
      `,
      params
    );

    res.json({
  success: true,
  list: rows,        // لصفحة محفظة العملاء
  currencies: rows,   // لصفحة إدارة العملات
});

  } catch (err) {
    console.error("GET CURRENCIES ERROR:", err?.message || err);
    res.status(500).json({ success: false, message: "خطأ في جلب العملات" });
  }
});

// ➕ إضافة عملة
router.post("/", async (req, res) => {
  try {
    const {
      name_ar,
      name_en,
      code,
      symbol,
      exchange_rate,
      min_rate,
      max_rate,
      is_local,
      convert_mode, // "*" | "/"
    } = req.body;

    const { is_admin_branch, branch_id } = req.user;

    if (!name_ar || !code) {
      return res.status(400).json({
        success: false,
        message: "الحقول الأساسية مطلوبة",
      });
    }

    // تحديد الفرع
    let finalBranchId = branch_id;
    if (is_admin_branch) {
      const selected = req.headers["x-branch-id"];
      if (selected && selected !== "all") {
        finalBranchId = Number(selected);
      }
    }

    const rate = is_local ? 1 : exchange_rate;

    // الافتراضي: المحلية ضرب، غير المحلية قسمة
    const mode = convert_mode === "/" || convert_mode === "*"
      ? convert_mode
      : (is_local ? "*" : "/");

    await db.query(
      `
      INSERT INTO currencies
      (name_ar, name_en, code, symbol, exchange_rate, min_rate, max_rate, is_local, convert_mode, branch_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        name_ar,
        name_en || "",
        code.toUpperCase(),
        symbol || null,
        rate,
        min_rate || null,
        max_rate || null,
        is_local ? 1 : 0,
        mode,
        finalBranchId,
      ]
    );

    res.json({ success: true, message: "تمت إضافة العملة" });
  } catch (err) {
    console.error("ADD CURRENCY ERROR:", err?.message || err);
    res.status(500).json({ success: false, message: "خطأ في إضافة العملة" });
  }
});

// ✏️ تعديل عملة
router.put("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const {
      name_ar,
      name_en,
      symbol,
      exchange_rate,
      min_rate,
      max_rate,
      is_local,
      convert_mode, // "*" | "/"
    } = req.body;

    const rate = is_local ? 1 : exchange_rate;

    const mode = convert_mode === "/" || convert_mode === "*"
      ? convert_mode
      : (is_local ? "*" : "/");

    await db.query(
      `
      UPDATE currencies
      SET
        name_ar = ?,
        name_en = ?,
        symbol = ?,
        exchange_rate = ?,
        min_rate = ?,
        max_rate = ?,
        is_local = ?,
        convert_mode = ?
      WHERE id = ?
      `,
      [
        name_ar,
        name_en || "",
        symbol || null,
        rate,
        min_rate || null,
        max_rate || null,
        is_local ? 1 : 0,
        mode,
        id,
      ]
    );

    res.json({ success: true, message: "تم التحديث" });
  } catch (err) {
    console.error("UPDATE CURRENCY ERROR:", err?.message || err);
    res.status(500).json({ success: false, message: "خطأ في التحديث" });
  }
});

// 🗑️ تعطيل عملة
router.delete("/:id", async (req, res) => {
  try {
    await db.query(
      `UPDATE currencies SET is_active = 0 WHERE id = ?`,
      [req.params.id]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("DELETE CURRENCY ERROR:", err?.message || err);
    res.status(500).json({ success: false, message: "خطأ في الحذف" });
  }
});

export default router;
