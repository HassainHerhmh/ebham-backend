import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import pool from "./db.js";

dotenv.config();
const app = express();

app.use((req, res, next) => {
  console.log("➡️ INCOMING REQUEST:", req.method, req.url);
  next();
});

/* =========================
   Middlewares
========================= */
app.use(cors({ origin: "*" }));

app.use(express.json());
app.use(express.urlencoded({ extended: true })); // ⭐⭐⭐ هذا هو الحل

// مهم جدًا للـ preflight
app.options("*", cors());

/* =========================
   📡 Ping Test (فحص الاتصال)
========================= */
app.get("/ping", (req, res) => {
  console.log("📡 PING FROM APP", {
    ip: req.ip,
    time: new Date().toISOString(),
    ua: req.headers["user-agent"],
  });

  res.json({
    success: true,
    message: "CONNECTED",
    serverTime: new Date().toISOString(),
  });
});

/* =========================
   عرض مجلد uploads
========================= */
app.use("/uploads", express.static("uploads"));

/* =========================
   Auth Routes
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
   مدن + أحياء
========================= */
import citiesRoutes from "./routes/cities.js";
import neighborhoodsRoutes from "./routes/neighborhoods.js";

app.use("/cities", citiesRoutes);
app.use("/neighborhoods", neighborhoodsRoutes);

/* =========================
   عناوين العملاء
========================= */
import customerAddresses from "./routes/customerAddresses.js";
app.use("/customer-addresses", customerAddresses);

/* =========================
   Start Server
========================= */
const PORT = process.env.PORT || 8080;
app.listen(PORT, () =>
  console.log(`🚀 Server running on ${PORT}`)
           
);جربت اعمل طلب مافي وصل للسيرفر مع انه اول عبر كود تحقق شغال بدون مشاكل يمكن الواجههة مخبوطة
