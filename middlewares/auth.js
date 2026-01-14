import jwt from "jsonwebtoken";

export default function auth(req, res, next) {
  const header = req.headers.authorization;

  if (!header) {
    return res.status(401).json({ success: false, message: "غير مصرح" });
  }

  const token = header.split(" ")[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    req.user = {
      id: decoded.id,
      role: decoded.role,
      branch_id: decoded.branch_id || null,
      is_admin_branch: decoded.is_admin_branch || 0,
    };

    // 🔹 دعم تغيير الفرع من الهيدر للإدارة العامة فقط
    const headerBranch = req.headers["x-branch-id"];
    if (headerBranch && req.user.is_admin_branch) {
      req.user.branch_id = Number(headerBranch);
    }

    next();
  } catch (e) {
    return res.status(401).json({ success: false, message: "توكن غير صالح" });
  }
}
