import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import bcrypt from "bcrypt";
import pkg from "pg";

dotenv.config();

const { Pool } = pkg;
const app = express();

/* ======================================================
   🌐 CORS (FINAL - Vercel ↔ Railway)
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

// 🔥 مهم جدًا للـ preflight
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
  ssl: { rejectUnauthorized: false },
});

/* =========================
   Health Check
========================= */
app.get("/", (req, res) => {
  res.json({ success: true, message: "API WORKING 🚀" });
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
      `
      SELECT 
        id,
        name,
        email,
        phone,
        role,
        permissions,
        password_hash
      FROM users
      WHERE email = $1 OR phone = $1
      LIMIT 1
      `,
      [identifier]
    );

    if (!result.rows.length) {
      return res.status(404).json({
        success: false,
        message: "المستخدم غير موجود",
      });
    }

    const user = result.rows[0];

    const isMatch = await bcrypt.compare(password, user.password_hash);

    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: "كلمة المرور غير صحيحة",
      });
    }

    // لا ترسل password_hash للفرونت ❌
    delete user.password_hash;

    return res.json({
      success: true,
      user,
    });
  } catch (err) {
    console.error("LOGIN ERROR:", err);
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});


/* =========================
   Run Server
========================= */
const PORT = process.env.PORT || 5000;
app.listen(PORT, () =>
  console.log("🚀 Server running on port", PORT)
);
