import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import pkg from "pg";

dotenv.config();
const { Pool } = pkg;

const app = express();

/* =========================
   🔥 CORS (حل جذري)
========================= */
app.use(cors({
  origin: [
    "http://localhost:5173",
    "https://ebham-dashboard2.vercel.app"
  ],
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true
}));

// ⚠️ هذا السطر هو الأهم
app.options("*", cors());

/* =========================
   Middlewares
========================= */
app.use(express.json());

/* =========================
   Database
========================= */
const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

/* =========================
   Health Check
========================= */
app.get("/", (req, res) => {
  res.json({ success: true, message: "API WORKING 🚀" });
});

/* =========================
   Login (POST فقط)
========================= */
app.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: "بيانات ناقصة" });
    }

    const result = await db.query(
      "SELECT * FROM users WHERE email=$1 LIMIT 1",
      [email]
    );

    if (!result.rows.length) {
      return res.status(401).json({ success: false, message: "مستخدم غير موجود" });
    }

    const user = result.rows[0];
    const match = await bcrypt.compare(password, user.password);

    if (!match) {
      return res.status(401).json({ success: false, message: "كلمة المرور خطأ" });
    }

    const token = jwt.sign(
      { id: user.id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        name: user.name,
        role: user.role
      }
    });

  } catch (err) {
    console.error("LOGIN ERROR:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

/* =========================
   Server Start
========================= */
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
