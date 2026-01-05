import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import pool from "./db.js";
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
    credentials: true,
  })
);

/* =========================
   Login (حقيقي)
========================= */
app.post("/login", async (req, res) => {
  const { identifier, password } = req.body;

  if (!identifier || !password) {
    return res.status(400).json({
      success: false,
      message: "البيانات ناقصة",
    });
  }

  try {
    const { rows } = await pool.query(
      `SELECT * FROM users 
       WHERE email = $1 OR phone = $1
       LIMIT 1`,
      [identifier]
    );

    if (!rows.length) {
      return res.status(400).json({
        success: false,
        message: "المستخدم غير موجود",
      });
    }

    const user = rows[0];

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({
        success: false,
        message: "كلمة المرور غير صحيحة",
      });
    }

    const token = jwt.sign(
      { id: user.id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({
      success: true,
      user: {
        id: user.id,
        name: user.name,
        role: user.role,
        permissions: user.permissions,
        token,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false });
  }
});

/* =========================
   Users Routes
========================= */

app.use("/users", usersRoutes);

/* =========================
   Start Server
========================= */
const PORT = process.env.PORT || 8080;
app.listen(PORT, () =>
  console.log(`🚀 Server running on ${PORT}`)
);
