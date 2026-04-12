import express from "express";
import db from "../db.js";
import auth from "../middlewares/auth.js";

const router = express.Router();

const ALLOWED_LANGUAGES = ["ar", "en"];

const normalizeLanguage = (value) =>
  String(value || "")
    .trim()
    .toLowerCase();

const isPositiveInt = (value) =>
  Number.isInteger(Number(value)) && Number(value) > 0;

const isAdminLike = (user) => {
  const role = String(user?.role || "").toLowerCase();
  return Boolean(
    user?.is_admin ||
      user?.is_admin_branch ||
      ["admin", "super_admin", "manager", "owner"].includes(role)
  );
};

const tableByRole = (role, targetType) => {
  if (targetType === "customer") return "customers";
  if (targetType === "user") return "users";
  return String(role || "").toLowerCase() === "customer" ? "customers" : "users";
};

const ensureLanguageValue = (dbValue) => {
  const lang = normalizeLanguage(dbValue);
  return ALLOWED_LANGUAGES.includes(lang) ? lang : "ar";
};

/* =========================================
   راوت عام: اللغات المتاحة
========================================= */
router.get("/available", async (_req, res) => {
  return res.json({
    success: true,
    data: [
      { code: "ar", name: "العربية" },
      { code: "en", name: "English" },
    ],
  });
});

/* =========================================
   جلب لغة المستخدم الحالي
   يعتمد على التوكن
========================================= */
router.get("/my-language", auth, async (req, res) => {
  try {
    const userId = req.user?.id;
    const role = req.user?.role;

    if (!isPositiveInt(userId)) {
      return res.status(401).json({
        success: false,
        message: "غير مصرح",
      });
    }

    const table = tableByRole(role);
    const [rows] = await db.query(
      `SELECT language FROM ${table} WHERE id=? LIMIT 1`,
      [Number(userId)]
    );

    if (!rows?.length) {
      return res.status(404).json({
        success: false,
        message: table === "customers" ? "العميل غير موجود" : "المستخدم غير موجود",
      });
    }

    return res.json({
      success: true,
      language: ensureLanguageValue(rows[0]?.language),
    });
  } catch (err) {
    console.error("GET /language/my-language ERROR:", err);
    return res.status(500).json({
      success: false,
      message: "فشل في جلب لغة المستخدم",
    });
  }
});

/* =========================================
   تحديث لغة المستخدم الحالي
   body: { language: "ar" | "en" }
========================================= */
router.put("/my-language", auth, async (req, res) => {
  try {
    const userId = req.user?.id;
    const role = req.user?.role;
    const language = normalizeLanguage(req.body?.language);

    if (!isPositiveInt(userId)) {
      return res.status(401).json({
        success: false,
        message: "غير مصرح",
      });
    }

    if (!ALLOWED_LANGUAGES.includes(language)) {
      return res.status(400).json({
        success: false,
        message: "اللغة غير مدعومة",
      });
    }

    const table = tableByRole(role);
    const [result] = await db.query(`UPDATE ${table} SET language=? WHERE id=?`, [
      language,
      Number(userId),
    ]);

    if (!result?.affectedRows) {
      return res.status(404).json({
        success: false,
        message: table === "customers" ? "العميل غير موجود" : "المستخدم غير موجود",
      });
    }

    return res.json({
      success: true,
      message: "تم تحديث اللغة بنجاح",
      language,
    });
  } catch (err) {
    console.error("PUT /language/my-language ERROR:", err);
    return res.status(500).json({
      success: false,
      message: "فشل في تحديث اللغة",
    });
  }
});

/* =========================================
   تحديث لغة مستخدم عبر user_id (محمي)
   body: { user_id, language, target_type?: "customer" | "user" }
   - admin: يقدر يغير لأي مستخدم
   - non-admin: يقدر يغير فقط لنفسه
========================================= */
router.post("/set-language", auth, async (req, res) => {
  try {
    const requesterId = req.user?.id;
    const requesterRole = req.user?.role;

    const userId = Number(req.body?.user_id);
    const language = normalizeLanguage(req.body?.language);
    const targetType = String(req.body?.target_type || "").trim().toLowerCase();

    if (!isPositiveInt(requesterId)) {
      return res.status(401).json({
        success: false,
        message: "غير مصرح",
      });
    }

    if (!isPositiveInt(userId)) {
      return res.status(400).json({
        success: false,
        message: "user_id مطلوب ويجب أن يكون رقمًا صحيحًا",
      });
    }

    if (!ALLOWED_LANGUAGES.includes(language)) {
      return res.status(400).json({
        success: false,
        message: "اللغة غير مدعومة",
      });
    }

    if (targetType && !["customer", "user"].includes(targetType)) {
      return res.status(400).json({
        success: false,
        message: "target_type يجب أن يكون customer أو user",
      });
    }

    const requesterIsAdmin = isAdminLike(req.user);
    if (!requesterIsAdmin && Number(requesterId) !== Number(userId)) {
      return res.status(403).json({
        success: false,
        message: "ليس لديك صلاحية تعديل لغة مستخدم آخر",
      });
    }

    const table = tableByRole(requesterRole, targetType || undefined);
    const [result] = await db.query(`UPDATE ${table} SET language=? WHERE id=?`, [
      language,
      Number(userId),
    ]);

    if (!result?.affectedRows) {
      return res.status(404).json({
        success: false,
        message: table === "customers" ? "العميل غير موجود" : "المستخدم غير موجود",
      });
    }

    return res.json({
      success: true,
      message: "تم تحديث اللغة بنجاح",
      language,
    });
  } catch (err) {
    console.error("POST /language/set-language ERROR:", err);
    return res.status(500).json({
      success: false,
      message: "فشل في تحديث اللغة",
    });
  }
});

export default router;
