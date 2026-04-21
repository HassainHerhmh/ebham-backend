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
          *
        FROM captains
        WHERE id=? LIMIT 1
        `,
        [decoded.id]
      );

      userRecord = rows[0]
        ? { ...rows[0], role: "captain" }
        : null;
    }


      else if (decoded.role === "agent") {
  const [rows] = await db.query(
    `
    SELECT
      id,
      name,
      phone,
      branch_id,
      is_active,
      'agent' AS role
    FROM agents
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
          u.id,
          u.name,
          u.phone,
          u.role,
          u.branch_id,
          u.agent_id,
          u.status,
          COALESCE(u.is_admin, 0) AS is_admin,
          COALESCE(b.is_admin, 0) AS is_admin_branch
        FROM users u
        LEFT JOIN branches b ON b.id = u.branch_id
        WHERE u.id=? LIMIT 1
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

    if (userRecord.status !== undefined && userRecord.status !== null && userRecord.status !== "active") {
      return res.status(403).json({
        success: false,
        message: "الحساب معطل",
      });
    }

    // 4. تجهيز req.user
 req.user = {
  id: userRecord.id,
  name: userRecord.name,
  phone: userRecord.phone,
  role: userRecord.role,
  branch_id: userRecord.branch_id || decoded.branch_id || null,
    agent_id: userRecord.agent_id || null,
  status: userRecord.status || null,
  is_admin: userRecord.is_admin || 0,
  is_admin_branch: userRecord.is_admin_branch || 0,
  is_active: userRecord.is_active ?? null,
};

    // 5. السماح بتغيير الفرع (اختياري)
    const headerBranch = req.headers["x-branch-id"];

    if (
      headerBranch &&
      req.user.role !== "captain" &&
      (req.user.is_admin_branch || req.user.is_admin)
    ) {
      req.user.branch_id = Number(headerBranch);
    } else if (headerBranch && req.user.role !== "captain") {
      return res.status(403).json({
        success: false,
        message: "غير مصرح بتغيير الفرع",
      });
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
