import express from "express";
import bcrypt from "bcrypt";

const router = express.Router();

// 🔹 تخزين مؤقت (لاحقًا DB)
let users = [
  {
    id: 1,
    name: "Admin",
    username: "admin@ebham.com",
    password: bcrypt.hashSync("123456", 10),
    role: "admin",
    status: "active",
    permissions: {},
  },
];

// =======================
// ✅ جلب المستخدمين
// =======================
router.get("/", (req, res) => {
  const safeUsers = users.map(({ password, ...u }) => u);
  res.json(safeUsers);
});

// =======================
// ✅ إضافة مستخدم
// =======================
router.post("/", async (req, res) => {
  const { name, username, password, role, permissions } = req.body;

  const hashed = await bcrypt.hash(password, 10);

  const newUser = {
    id: Date.now(),
    name,
    username,
    password: hashed,
    role,
    status: "active",
    permissions: permissions || {},
  };

  users.push(newUser);
  res.json({ success: true });
});

// =======================
// ✅ تعديل مستخدم
// =======================
router.put("/:id", (req, res) => {
  const id = Number(req.params.id);
  const user = users.find(u => u.id === id);
  if (!user) return res.status(404).json({ success: false });

  Object.assign(user, req.body);
  res.json({ success: true });
});

// =======================
// ✅ حذف مستخدم
// =======================
router.delete("/:id", (req, res) => {
  users = users.filter(u => u.id !== Number(req.params.id));
  res.json({ success: true });
});

// =======================
// ✅ تعطيل مستخدم
// =======================
router.post("/:id/disable", (req, res) => {
  const user = users.find(u => u.id === Number(req.params.id));
  if (user) user.status = "disabled";
  res.json({ success: true });
});

// =======================
// ✅ إعادة تعيين كلمة المرور
// =======================
router.post("/:id/reset-password", async (req, res) => {
  const user = users.find(u => u.id === Number(req.params.id));
  if (!user) return res.json({ success: false });

  const newPass = Math.random().toString(36).slice(-8);
  user.password = await bcrypt.hash(newPass, 10);

  res.json({ success: true, new_password: newPass });
});

export default router;
