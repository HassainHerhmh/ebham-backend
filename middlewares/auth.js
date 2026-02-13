import jwt from "jsonwebtoken";
import db from "../db.js";

export default async function auth(req, res, next) {
  const header = req.headers.authorization;

  // 1. التحقق من وجود التوكن
  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({
      success: false,
      message: "غير مصرح - التوكن مفقود",
    });
  }

  const token = header.split(" ")[1];

  try {
    // 2. فك التوكن
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    let userRecord = null;

    /* ==========================
       CUSTOMER
    ========================== */
    if (decoded.role === "customer") {
      const [rows] = await db.query(
        "SELECT id, name, phone, 'customer' AS role FROM customers WHERE id=? LIMIT 1",
        [decoded.id]
      );

      userRecord = rows[0];
    }

    /* ==========================
       CAPTAIN
    ========================== */
    else if (decoded.role === "captain") {
      const [rows] = await db.query(
        `
        SELECT 
          id,
          name,
          phone,
          branch_id,
          'captain' AS role,
          status
        FROM captains
        WHERE id=? LIMIT 1
        `,
        [decoded.id]
      );

      userRecord = rows[0];
    }

    /* ==========================
       ADMIN / STAFF
    ========================== */
    else {
      const [rows] = await db.query(
        `
        SELECT 
          id,
          name,
          phone,
          role,
          branch_id
        FROM users
        WHERE id=? LIMIT 1
        `,
        [decoded.id]
      );

      userRecord = rows[0];
    }

    // 3. التأكد من وجود المستخدم
    if (!userRecord) {
      console.error("❌ User not found:", decoded);

      return res.status(401).json({
        success: false,
        message: "المستخدم غير موجود",
      });
    }

    // 4. تجهيز req.user
    req.user = {
      id: userRecord.id,
      name: userRecord.name,
      phone: userRecord.phone,
      role: userRecord.role,
      branch_id: userRecord.branch_id || null,
      status: userRecord.status || null,
    };

    // 5. السماح بتغيير الفرع (اختياري)
    const headerBranch = req.headers["x-branch-id"];

    if (headerBranch) {
      req.user.branch_id = Number(headerBranch);
    }

    console.log("✅ AUTH OK:", req.user);

    next();

  } catch (err) {
    console.error("AUTH ERROR:", err.message);

    return res.status(401).json({
      success: false,
      message: "توكن غير صالح أو منتهي",
    });
  }
}
