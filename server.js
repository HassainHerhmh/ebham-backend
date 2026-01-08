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
     "https://ebham-dashboard2.vercel.app", // لوحة التحكم
      "https://ebham-apk.vercel.app",        // صفحة العملاء ✅
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
 عرض مجلد uploads
========================= */



app.use("/uploads", express.static("uploads"));

/* =========================
   Login (حقيقي)
========================= */
import authRoutes from "./routes/auth.js";

app.use("/api/auth", authRoutes);





/* =========================
   Users Routes
========================= */
import usersRoutes from "./routes/users.js";
app.use("/users", usersRoutes);

/* =========================
  العملاء
========================= */
import customersRoutes from "./routes/customers.js";

app.use("/customers", customersRoutes);


/* =========================
مدن+احياء
========================= */
import citiesRoutes from "./routes/cities.js";
import neighborhoodsRoutes from "./routes/neighborhoods.js";

app.use("/cities", citiesRoutes);
app.use("/neighborhoods", neighborhoodsRoutes);


import customerAddresses from "./routes/customerAddresses.js";

app.use("/customer-addresses", customerAddresses);


/* =========================
   Start Server
========================= */
const PORT = process.env.PORT || 8080;
app.listen(PORT, () =>
  console.log(`🚀 Server running on ${PORT}`)
);
