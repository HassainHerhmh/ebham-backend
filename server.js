import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import pool from "./db.js";


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
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Requested-With",
    ],
  })
);

// مهم جدًا
app.options("*", cors());

/* =========================
   Login (حقيقي)
========================= */
import authRoutes from "./routes/auth.js";

app.use(authRoutes);

/* =========================
   Users Routes
========================= */
import usersRoutes from "./routes/users.js";
app.use("/users", usersRoutes);

/* =========================
   Start Server
========================= */
const PORT = process.env.PORT || 8080;
app.listen(PORT, () =>
  console.log(`🚀 Server running on ${PORT}`)
);
