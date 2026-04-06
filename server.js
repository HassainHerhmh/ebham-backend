import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import admin from "firebase-admin";

import pool from "./db.js";
import auth from "./middlewares/auth.js";

/* =========================
   Load ENV أولاً (مهم جداً)
========================= */

dotenv.config();

/* =========================
   اختبار وجود Firebase Service Account
========================= */

console.log(
  "SERVICE ACCOUNT EXISTS:",
  !!process.env.FIREBASE_SERVICE_ACCOUNT
);

console.log(
  "SERVICE ACCOUNT LENGTH:",
  process.env.FIREBASE_SERVICE_ACCOUNT
    ? process.env.FIREBASE_SERVICE_ACCOUNT.length
    : 0
);

/* =========================
   تحقق من وجود المتغير
========================= */

if (!process.env.FIREBASE_SERVICE_ACCOUNT) {

  console.error("❌ FIREBASE_SERVICE_ACCOUNT is missing from ENV");

  process.exit(1);

}

/* =========================
   Parse Service Account بأمان + إصلاح private_key
========================= */

let serviceAccount;

try {

  serviceAccount = JSON.parse(
    process.env.FIREBASE_SERVICE_ACCOUNT
  );

  // ✅ إصلاح private_key (الأهم)
  serviceAccount.private_key =
    serviceAccount.private_key.replace(/\\n/g, "\n");

  console.log("✅ Firebase Service Account parsed successfully");

}
catch (err) {

  console.error("❌ Failed to parse FIREBASE_SERVICE_ACCOUNT");

  console.error(err.message);

  process.exit(1);

}

/* =========================
   Firebase Admin Init
========================= */

try {

  admin.initializeApp({

    credential: admin.credential.cert(serviceAccount)

  });

  console.log("🔥 Firebase Admin initialized successfully");

}
catch (err) {

  console.error("❌ Firebase initialization failed");

  console.error(err.message);

  process.exit(1);

}

/* =========================
   Express App Init
========================= */

const app = express();

/* =========================
   Professional CORS Setup
========================= */

const allowedOrigins = [
  "https://ebham-dashboard2.vercel.app",
  "http://localhost:5173",
  "http://localhost",
  "https://localhost",
    "http://localhost:63342",
];


// دالة التحقق من origin
function isAllowedOrigin(origin) {

  // ✅ Android WebView
  if (!origin || origin === "null" || origin.startsWith("file://")) {
    return true;
  }

  // ✅ iOS WebView
  if (
    origin.startsWith("capacitor://") ||
    origin.startsWith("ionic://")
  ) {
    return true;
  }

  // ✅ localhost
  if (
    origin.startsWith("http://localhost") ||
    origin.startsWith("https://localhost") ||
    origin.startsWith("http://127.0.0.1")
  ) {
    return true;
  }

  // ✅ allowed domains
  if (allowedOrigins.includes(origin)) {
    return true;
  }

  return false;
}

// إعداد cors في متغير
const corsOptions = {

  origin: (origin, callback) => {

    if (isAllowedOrigin(origin)) {
      callback(null, true);
    } else {
      console.log("❌ Blocked by CORS:", origin);
      callback(new Error("Not allowed by CORS"));
    }

  },


  credentials: true,

  methods: [
    "GET",
    "POST",
    "PUT",
    "PATCH",
    "DELETE",
    "OPTIONS"
  ],

  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "x-branch-id"
  ]
};

// استخدام cors
app.use(cors(corsOptions));

// دعم preflight requests
app.options("*", cors(corsOptions));


/* =========================
   Body Parsers
========================= */

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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

import captainAuth from "./routes/captainAuth.js";

app.use("/api/captain-auth", captainAuth);

/* =========================
   مجموعة الكباتن
========================= */
import captainGroups from "./routes/captainGroups.js";
app.use("/api/captain-groups", captainGroups);


/* =========================
   طرق الدفع
========================= */
import paymentMethodsRoutes from "./routes/payment-methods.js";

app.use("/api/payment-methods", paymentMethodsRoutes);

/* =========================
 الفروع
========================= */

import branchesRouter from "./routes/branches.js";

app.use("/api/branches",branchesRouter);

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
    الحسابات الوسيطة
========================= */
import transitAccounts from "./routes/transit-accounts.js";

app.use("/api/settings/transit-accounts", transitAccounts);

/* =========================
     الوكلاء
========================= */

import agents from "./routes/agents.js";

app.use("/api/agents", agents);

/* =========================
    مجموعة الوكلاء
========================= */

import agentgroups from "./routes/agent-groups.js";

app.use("/api/agent-groups", agentgroups);
/* =========================
   الحملات التسويقية
========================= */
import campaignsRoutes from "./routes/campaigns.js";

app.use("/api/campaigns", campaignsRoutes);

import adsRoutes from "./routes/ads.js";

app.use("/api/ads", adsRoutes);

import couponsRouter from "./routes/coupons.js"

app.use("/api/coupons", couponsRouter)

/* =========================
    معلومات  الوكلاء
========================= */

import agentInfoRouter from "./routes/agentInfo.js";

app.use("/api/agent-info", agentInfoRouter);

/* =========================
صفحة التامين
========================= */
import customerGuarantees from "./routes/customerGuarantees.js";

app.use("/api/customer-guarantees", customerGuarantees);


import { createServer } from "http";
import { Server } from "socket.io";

/*=====================
مسار تقارير العامه 
====================*/
import systemReports from "./routes/systemReports.js";

app.use("/api/system-reports", systemReports);
/*======================
وصل لي 
====================*/

import wasselOrders from "./routes/wasselOrders.js";

app.use("/api/wassel-orders", wasselOrders);

/*======================
الطلبات اليدوية
====================*/

import manualOrdersRouter from "./routes/manual_orders.js";
// ...
app.use("/api/manual-orders", manualOrdersRouter);

/*==================
داش بورد

=================*/
import dashboardRoutes from "./routes/dashboard.js";

app.use("/api/dashboard", dashboardRoutes);


/* =========================
   الإشعارات
========================= */
import notificationsRoutes from "./routes/notifications.js";

app.use("/api/notifications", auth, notificationsRoutes);

/*======================
نقاط الولاء
========================*/
   import loyaltyRoutes from "./routes/loyalty.js";

app.use("/api/loyalty", loyaltyRoutes);

/*======================
بروفايل تطبيق العملاء 
========================*/
import profileRoutes from "./routes/profile.js";

app.use("/api/profile", profileRoutes);


/*===================
اللغة
=====================*/
import languageRoutes from "./routes/language.routes.js";

app.use("/api/language", languageRoutes);
/* =========================
   Start Server + Socket.IO
========================= */
const PORT = process.env.PORT || 8080;

const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: [
      "https://ebham-dashboard2.vercel.app",
      "http://localhost:5173",
      "http://localhost:63342",
      "http://127.0.0.1:63342"
    ],
    credentials: true,
  },
});

app.set("io", io);

io.on("connection", (socket) => {

  console.log("🔌 Client connected:", socket.id);

  // 1. انضمام الكابتن لغرفة خاصة به (موجود مسبقاً)
  socket.on("join_captain", (captainId) => {
    socket.join("captain_" + captainId);
    console.log("✅ Captain joined room:", captainId);
  });

  // =================================================
  // 🚀 2. (جديد) استقبال موقع الكابتن وإرساله للوحة التحكم
  // =================================================
  socket.on("update_captain_location", (data) => {
    // data = { captainId, lat, lng }
    
    if(!data || !data.captainId) return;

    // طباعة للتأكد في السيرفر
    // console.log(`📍 Captain ${data.captainId} location:`, data.lat, data.lng);

    // إرسال الإحداثيات فوراً إلى لوحة التحكم (Dashboard)
    // اسم الحدث يجب أن يطابق ما كتبناه في Orders.tsx
    io.emit(`captain_location_${data.captainId}`, {
      lat: data.lat,
      lng: data.lng
    });
  });

});

httpServer.listen(PORT, () => {
  console.log(`🚀 Server running with Socket.IO on ${PORT}`);
});
