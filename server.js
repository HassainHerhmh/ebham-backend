import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import bcrypt from "bcrypt";
import pkg from "pg";

dotenv.config();

const { Pool } = pkg;
const app = express();

/* ======================================================
   🧠 Middlewares (مهم الترتيب)
====================================================== */
app.use(express.json());

/* ======================================================
   🌐 CORS (حل نهائي)
====================================================== */
const allowedOrigins = [
  "http://localhost:5173",
  "https://ebham-dashboard-gcpu.vercel.app",
  "https://ebham-dashboard2.vercel.app",
];

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin) return callback(null, true); // postman / server-to-server
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error("Not allowed by CORS"));
    },
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })
);

/* 🔥 لازم هذا السطر تحديدًا */
app.options("*", cors());

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
   🔐 Login
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
      "SELECT * FROM users WHERE email=$1 OR phone=$1 LIMIT 1",
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

    res.json({
      success: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        permissions: user.permissions,
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
app.listen(PORT, () =>
  console.log("🚀 Server running on port", PORT)
);
