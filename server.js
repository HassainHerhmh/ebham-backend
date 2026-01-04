import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import bcrypt from "bcrypt";
import pkg from "pg";
import jwt from "jsonwebtoken";

dotenv.config();

const { Pool } = pkg;
const app = express();

/* ======================================================
   🌐 CORS (Vercel ↔ Railway)
====================================================== */
app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "https://ebham-dashboard-gcpu.vercel.app",
      "https://ebham-dashboard2.vercel.app",
    ],
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })
);

// مهم للـ preflight
app.options("*", cors());

/* =========================
   Middlewares
========================= */
app.use(express.json());

/* =========================
   Database (Supabase + Railway)
========================= */
if (!process.env.DATABASE_URL) {
  console.error("❌ DATABASE_URL is missing");
  process.exit(1);
}

const db = new Pool({
  connectionString: process.env.DATABASE_URL + "?sslmode=require",
});

/* =========================
   Health Check
========================= */
app.get("/", (req, res) => {
  res.json({ success: true, message: "API WORKING 🚀" });
});

/* =========================
   DB Test (اختياري)
========================= */
app.get("/db-test", async (req, res) => {
  try {
    await db.query("SELECT 1");
    res.json({ success: true, db: "connected" });
  } catch (err) {
    console.error("DB TEST ERROR:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/* =========================
   Login
========================= */
app.post("/login", async (req, res) => {
  try {
    const { identifier, password } = req.body;

    if (!identifier || !password) {
      return res.status(400).json({
        success: false,
        message: "البيانات غير مكتملة",
      });
    }

    const result = await db.query(
      "SELECT * FROM users WHERE email = $1 OR phone = $1 LIMIT 1",
      [identifier]
    );

    if (!result.rows.length) {
      return res.status(404).json({
        success: false,
        message: "المستخدم غير موجود",
      });
    }

    const user = result.rows[0];

    if (!user.is_active) {
      return res.status(403).json({
        success: false,
        message: "الحساب موقوف",
      });
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);

    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: "كلمة المرور غير صحيحة",
      });
    }

    if (!process.env.JWT_SECRET) {
      throw new Error("JWT_SECRET is missing");
    }

    const token = jwt.sign(
      {
        id: user.id,
        role: user.role,
      },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({
      success: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        permissions: user.permissions,
        token,
      },
    });
  } catch (err) {
    console.error("LOGIN ERROR:", err);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});

/* =========================
   Run Server
========================= */
const PORT = process.env.PORT || 8080;
app.listen(PORT, () =>
  console.log(`🚀 Server running on port ${PORT}`)
);
