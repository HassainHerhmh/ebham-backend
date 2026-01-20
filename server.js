import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import pool from "./db.js";
import auth from "./middlewares/auth.js";


dotenv.config();
const app = express();

app.use((req, res, next) => {
  console.log("➡️ INCOMING REQUEST:", req.method, req.url);
  next();
});

/* =========================
   Middlewares
========================= */
app.use(cors({
  origin: [
    "https://ebham-dashboard2.vercel.app",
    "http://localhost:5173"
  ],
  credentials: true,
}));


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

app.use("/api/users", auth, usersRoutes);



/* =========================
   العملاء
========================= */
import customersRoutes from "./routes/customers.js";
app.use("/api/customers", customersRoutes);

/* =========================
   مدن + أحياء
========================= */
import citiesRoutes from "./routes/cities.js";
import neighborhoodsRoutes from "./routes/neighborhoods.js";

app.use("/api/cities", citiesRoutes);
app.use("/api/neighborhoods", neighborhoodsRoutes);
/* =========================
   عناوين العملاء
========================= */
import customerAddresses from "./routes/customerAddresses.js";
app.use("/api/customer-addresses", customerAddresses);

/* =========================
   الانواع
========================= */
import typesRoutes from "./routes/types.js";
app.use("/api/types", typesRoutes);

/* =========================
الواحدات
========================= */
import unitsRoutes from "./routes/units.js";

app.use("/api/units", unitsRoutes);

/* =========================
الفئات
========================= */
import categoriesRoutes from "./routes/categories.js";

app.use("/api/categories", categoriesRoutes);
/* =========================
المنتجات
========================= */
import productsRoutes from "./routes/products.js";

app.use("/api/products", productsRoutes);

/* =========================
المطعم
========================= */
import restaurantsRoutes from "./routes/restaurants.js";
app.use("/api/restaurants", restaurantsRoutes);

/* =========================
   الكباتن
========================= */
import captainsRoutes from "./routes/captains.js";
app.use("/api/captains", captainsRoutes);

/* =========================
   طرق الدفع
========================= */
import paymentMethodsRoutes from "./routes/payment-methods.js";

app.use("/api/payment-methods", paymentMethodsRoutes);
/* =========================
 الفروع
========================= */

import branchesRouter from "./routes/branches.js";

app.use("/api/branches", auth, branchesRouter);

/* =========================
شجرة الحسابات
========================= */

import accountsRoutes from "./routes/accounts.js";

app.use("/api/accounts", accountsRoutes);

/* =========================
مجموعة االحسابات 
========================= */
import accountGroupsRoutes from "./routes/accountGroups.js";

app.use("/api/account-groups", accountGroupsRoutes);

/* =========================
العملات
========================= */

import currenciesRoutes from "./routes/currencies.js";
app.use("/api/currencies", currenciesRoutes);

/* =========================
مجموعة البنوك
========================= */

import bankGroupsRouter from "./routes/bankGroups.js";

app.use("/api/bank-groups", bankGroupsRouter);


/* =========================
البنوك
========================= */
import banksRoutes from "./routes/banks.js";
app.use("/api/banks", banksRoutes);

/* =========================
مجموعة الصناديق
========================= */
import cashboxGroupsRoutes from "./routes/cashboxGroups.js";

app.use("/api/cashbox-groups", cashboxGroupsRoutes);

/*===========================
الصناديق
===========================*/
import cashBoxesRoutes from "./routes/cashBoxes.js";
app.use("/api/cash-boxes", cashBoxesRoutes);

/*========================
انواع الصرف
==========================*/
import paymentTypes from "./routes/paymentTypes.js";
app.use("/api/payment-types", paymentTypes);

/*========================
انواع القبض
==========================*/
import receiptTypes from "./routes/receiptTypes.js";
app.use("/api/receipt-types", receiptTypes);

/*========================
انواع القيود
==========================*/
import journalTypes from "./routes/journalTypes.js";
app.use("/api/journal-types", journalTypes);

/*========================
تسيقف الحسابات 
==========================*/
import accountCeilings from "./routes/accountCeilings.js";
app.use("/api/account-ceilings", accountCeilings);

/*========================
 سند قبض  
==========================*/
import receiptVouchers from "./routes/receiptVouchers.js";
app.use("/api/receipt-vouchers", receiptVouchers);

/*========================
 سند صرف 
 
==========================*/
import paymentVouchers from "./routes/paymentVouchers.js";
app.use("/api/payment-vouchers", paymentVouchers);

/*========================
الثيد اليومي 
 
==========================*/

import journalEntries from "./routes/journalEntries.js";
app.use("/api/journal-entries", journalEntries);

/* =========================
   التقارير
========================= */
import reports from "./routes/reports.js";
app.use("/api/reports", reports);

/* =========================
   أوقات الفروع
========================= */
import branchWorkTimes from "./routes/branchWorkTimes.js";
app.use("/api/branch-work-times", branchWorkTimes);

/* =========================
    اعدادات التوصيل
========================= */
import deliverySettings from "./routes/deliverySettings.js";

app.use("/api/delivery-settings", deliverySettings);

/* =========================
    الطلبات
========================= */
import orders from "./routes/orders.js";

app.use("/api/orders", orders);

import restaurantsExtra from "./routes/restaurants-extra.js";

app.use("/api/restaurants", restaurantsExtra);


/* =========================
    مصارفة عملة
========================= */
import currencyExchange from "./routes/currency-exchange.js";
app.use("/api/currency-exchange", currencyExchange);

/* =========================
   Start Server
========================= */
const PORT = process.env.PORT || 8080;
app.listen(PORT, () =>
  console.log(`🚀 Server running on ${PORT}`)
           
);
