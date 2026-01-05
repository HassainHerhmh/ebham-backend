import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";
import usersRoutes from "./routes/users.js";

dotenv.config();

const app = express();

/* =========================
   Middlewares
========================= */
app.use(express.json());

app.use(
  cors({
    origin: [
      "https://ebham-dashboard2.vercel.app",
      "http://localhost:5173",
    ],
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

/* =========================
   ENV Check
========================= */
if (!process.env.JWT_SECRET) {
  console.error("❌ JWT_SECRET is missing");
  process.exit(1);
}

/* =========================
   Health Check
========================= */
app.get("/", (req, res) => {
  res.json({ success: true, message: "API WORKING 🚀" });
});

/* =========================
   Login
========================= */
app.post("/login", (req, res) => {
  const { identifier, password } = req.body;

  if (!identifier || !password) {
    return res.status(400).json({
      success: false,
      message: "البيانات ناقصة",
    });
  }

  // 🔴 تسجيل دخول تجريبي (ثابت)
  if (identifier !== "admin@ebham.com" || password !== "123456") {
    return res.status(400).json({
      success: false,
      message: "بيانات الدخول غير صحيحة",
    });
  }

  const user = {
    id: 1,
    name: "Admin",
    role: "admin",
  };

  const token = jwt.sign(user, process.env.JWT_SECRET, {
    expiresIn: "7d",
  });

  res.json({
    success: true,
    user: {
      ...user,
      token,
    },
  });
});
/* =========================
المستخدمين 
========================= */

app.use("/users", usersRoutes);

/* =========================
   Start Server
========================= */
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
