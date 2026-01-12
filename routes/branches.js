import express from "express";
import db from "../db.js"; // نفس ملف الاتصال المستخدم عندك

const router = express.Router();

/* =========================
   GET ALL BRANCHES
========================= */
router.get("/", async (req, res) => {
  try {
    const [rows] = await db.query(
      "SELECT id, name, created_at FROM branches ORDER BY id ASC"
    );
    res.json({ branches: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "فشل جلب الفروع" });
  }
});

/* =========================
   ADD BRANCH
========================= */
router.post("/", async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ message: "اسم الفرع مطلوب" });

  try {
    const [result] = await db.query(
      "INSERT INTO branches (name) VALUES (?)",
      [name]
    );
    res.json({
      message: "تم إضافة الفرع",
      id: result.insertId,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "فشل إضافة الفرع" });
  }
});

/* =========================
   UPDATE BRANCH
========================= */
router.put("/:id", async (req, res) => {
  const { name } = req.body;
  const { id } = req.params;

  try {
    await db.query("UPDATE branches SET name = ? WHERE id = ?", [name, id]);
    res.json({ message: "تم تعديل الفرع" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "فشل تعديل الفرع" });
  }
});

/* =========================
   DELETE BRANCH
========================= */
router.delete("/:id", async (req, res) => {
  const { id } = req.params;

  try {
    await db.query("DELETE FROM branches WHERE id = ?", [id]);
    res.json({ message: "تم حذف الفرع" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "فشل حذف الفرع" });
  }
});

export default router;
