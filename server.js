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
app.post("/login", (req, res) => {
  console.log("BODY:", req.body);

  res.json({
    success: true,
    body: req.body
  });
});


/* =========================
   Server Start
========================= */
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
