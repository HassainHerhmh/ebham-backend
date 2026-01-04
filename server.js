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
   🌐 CORS
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

app.options("*", cors());
app.use(express.json());

/* ======================================================
   🔐 تأكد من المتغيرات
====================================================== */
if (!process.env.DATABASE_URL) {
  console.error("❌ DATABASE_URL is missing");
  process.exit(1);
}

if (!process.env.JWT_SECRET) {
  console.error("❌ JWT_SECRET is missing");
  process.exit(1);
}

/* ======================================================
   🗄️ Database
====================================================== */
const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

/* ======================================================
   🩺 Health Check
====================================================== */
app.get("/", (req, res) => {
  res.json({ success: true, message: "API WORKING 🚀" });
});

/* ======================================================
   🔐 Login (POST فقط)
====================================================== */
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
      `SELECT id, name, email, phone, password_hash, role, permissions
       FROM users
       WHERE email = $1 OR phone = $1
       LIMIT 1`,
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

/* ======================================================
   🚀 Run Server
====================================================== */
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log("🚀 Server running on port", PORT);
});
