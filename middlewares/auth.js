import jwt from "jsonwebtoken";
import db from "../db.js";

export default async function auth(req, res, next) {
  const header = req.headers.authorization;

  if (!header) {
    return res.status(401).json({ success: false, message: "غير مصرح" });
  }

  const token = header.split(" ")[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // جلب حالة الفرع من قاعدة البيانات
    const [rows] = await db.query(
      `
      SELECT b.is_admin
      FROM users u
      JOIN branches b ON b.id = u.branch_id
      WHERE u.id = ?
      `,
      [decoded.id]
    );


const isAdminBranch = rows.length ? rows[0].is_admin === 1 : false;


// ✅ جلب customer_id
const [cust] = await db.query(
  "SELECT id FROM customers WHERE user_id = ?",
  [decoded.id]
);


req.user = {
  id: decoded.id,
  role: decoded.role,

  customer_id: cust.length ? cust[0].id : null, // ✅ هذا المهم

  branch_id: decoded.branch_id || null,
  is_admin_branch: isAdminBranch,
};
    // 🔹 دعم تغيير الفرع من الهيدر (للإدارة فقط)
   // 🔹 دعم الفرع من الهيدر (للإدارة + التطبيق)
const headerBranch = req.headers["x-branch-id"];

if (headerBranch) {
  req.user.branch_id = Number(headerBranch);
}


    next();
  } catch (e) {
    return res.status(401).json({ success: false, message: "توكن غير صالح" });
  }
}
