import jwt from "jsonwebtoken";
import db from "../db.js";

export default async function auth(req, res, next) {
  const header = req.headers.authorization;

  if (!header) {
    return res.status(401).json({
      success: false,
      message: "غير مصرح",
    });
  }

  const token = header.split(" ")[1];

  try {
    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET
    );

    /* جلب المستخدم */
    const [[user]] = await db.query(
      "SELECT * FROM users WHERE id = ? LIMIT 1",
      [decoded.id]
    );

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "مستخدم غير موجود",
      });
    }

    /* جلب العميل لو موجود */
    const [[customer]] = await db.query(
      "SELECT id FROM customers WHERE phone = ? LIMIT 1",
      [user.phone]
    );

    /* جلب حالة الفرع */
    const [[branch]] = await db.query(
      `
      SELECT is_admin 
      FROM branches 
      WHERE id = ?
      `,
      [user.branch_id]
    );

    const isAdminBranch =
      branch?.is_admin === 1;

    req.user = {
      id: user.id,
      role: user.role,

      customer_id: customer?.id || null,

      branch_id: user.branch_id || null,

      is_admin_branch: isAdminBranch,
    };

    /* السماح بتغيير الفرع */
    const headerBranch =
      req.headers["x-branch-id"];

    if (headerBranch) {
      req.user.branch_id = Number(headerBranch);
    }

    console.log("USER AUTH:", req.user);

    next();
  } catch (err) {
    console.error("AUTH ERROR:", err);

    return res.status(401).json({
      success: false,
      message: "توكن غير صالح",
    });
  }
}
