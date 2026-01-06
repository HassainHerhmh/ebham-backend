import express from "express";
import db from "../db.js";

const router = express.Router();

router.post("/login", async (req, res) => {
  const { identifier, password } = req.body;

  try {
    const [rows] = await db.query(
      `
      SELECT id, name, email, phone, password, role, status
      FROM users
      WHERE email = ? OR phone = ?
      `,
      [identifier, identifier]
    );

    if (!rows.length) {
      return res.json({ success: false, message: "المستخدم غير موجود" });
    }

    const user = rows[0];

    if (user.status !== "active") {
      return res.json({ success: false, message: "الحساب معطل" });
    }

    if (user.password !== password) {
      return res.json({ success: false, message: "كلمة المرور غير صحيحة" });
    }

    delete user.password;

    res.json({
      success: true,
      user,
    });
  } catch (err) {
    console.error("LOGIN ERROR:", err);
    res.status(500).json({ success: false });
  }
});

export default router;
