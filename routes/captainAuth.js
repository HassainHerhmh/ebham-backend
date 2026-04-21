import express from "express";
import db from "../db.js";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";

const router = express.Router();

function getBaseUrl(req) {
  const envUrl =
    process.env.PUBLIC_BASE_URL ||
    process.env.APP_URL ||
    process.env.BASE_URL;

  if (envUrl) {
    return envUrl.replace(/\/+$/, "");
  }

  const forwardedProto =
    String(req.headers["x-forwarded-proto"] || "")
      .split(",")[0]
      .trim();

  const protocol = forwardedProto || req.protocol || "https";
  const host = req.get("host");

  return `${protocol}://${host}`;
}

function buildImageUrl(req, imagePath) {
  if (!imagePath) return null;
  if (/^https?:\/\//i.test(imagePath)) return imagePath;
  return `${getBaseUrl(req)}/${String(imagePath).replace(/^\/+/, "")}`;
}

/* ======================
   Captain Login
====================== */
router.post("/login", async (req, res) => {

  // 1️⃣ كشف البيانات الواصلة (مهم جداً للتتبع)
  console.log("📥 Login Request Received:");
  console.log("👉 Phone:", req.body.phone);
  console.log("👉 FCM Token Received:", req.body.fcm_token); 

  const { phone, password, fcm_token } = req.body;

  if (!phone || !password) {
    return res.status(400).json({
      success: false,
      message: "رقم الجوال وكلمة المرور مطلوبة",
    });
  }

  try {
    /* ======================
       1. جلب الكابتن
    ====================== */
    const [rows] = await db.query(
      "SELECT * FROM captains WHERE phone=? LIMIT 1",
      [phone]
    );

    if (!rows.length) {
      return res.status(401).json({
        success: false,
        message: "الحساب غير موجود",
      });
    }

    const captain = rows[0];

    /* ======================
       2. التحقق من كلمة المرور
    ====================== */
    let passwordValid = false;
    if (captain.password.length < 40) {
      passwordValid = password === captain.password;
    } else {
      passwordValid = await bcrypt.compare(password, captain.password);
    }

    if (!passwordValid) {
      return res.status(401).json({
        success: false,
        message: "كلمة المرور غير صحيحة",
      });
    }

    /* ======================
       3. حفظ FCM Token
    ====================== */
    // هنا المشكلة: إذا كان التوكن null لن يدخل هنا
    if (fcm_token && fcm_token.length > 10) { 
      try {
          await db.query(
            "UPDATE captains SET fcm_token=? WHERE id=?",
            [fcm_token, captain.id]
          );
          console.log(`✅ Database Updated for Captain ${captain.id} with token: ${fcm_token.substring(0, 15)}...`);
      } catch (dbError) {
          console.error("❌ Database Update Error:", dbError.message);
      }
    } else {
        console.log("⚠️ No valid FCM token provided in request body.");
    }

    /* ======================
       4. إنشاء JWT والرد
    ====================== */
    const token = jwt.sign(
      {
        id: captain.id,
        role: "captain",
        branch_id: captain.branch_id,
      },
      process.env.JWT_SECRET,
      { expiresIn: "30d" }
    );

    res.json({
      success: true,
      token,
      captain: {
        id: captain.id,
        name: captain.name,
        phone: captain.phone,
        role: "captain",
        status: captain.status,
        branch_id: captain.branch_id,
        image_url: captain.image_url || null,
        image: buildImageUrl(req, captain.image_url),
        image_full_url: buildImageUrl(req, captain.image_url),
      },
    });

  } catch (err) {
    console.error("CAPTAIN LOGIN ERROR:", err);
    res.status(500).json({
      success: false,
      message: "فشل تسجيل الدخول",
    });
  }
});

export default router;
