import express from "express";
import db from "../db.js";
import auth from "../middlewares/auth.js";
import multer from "multer";
import path from "path";
import fs from "fs";

/* =========================
   إعداد تخزين الصور
========================= */

const uploadPublicDir = "/uploads/captains";
const uploadDir = path.join(process.cwd(), "uploads", "captains");

// إنشاء المجلد لو غير موجود
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const fileName = "captain_" + Date.now() + ext;
    cb(null, fileName);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) {
      cb(new Error("يسمح فقط بالصور"));
    }
    cb(null, true);
  }
});

let imageColumnChecked = false;

async function ensureImageColumn() {
  if (imageColumnChecked) return;

  try {
    await db.query(
      "ALTER TABLE captains ADD COLUMN image_url VARCHAR(500) NULL"
    );
  } catch (err) {
    if (err?.code !== "ER_DUP_FIELDNAME") {
      throw err;
    }
  }

  imageColumnChecked = true;
}

function removeCaptainImage(imagePath) {
  if (!imagePath) return;

  const normalized = String(imagePath).replace(/^\/+/, "");
  const fullPath = path.join(process.cwd(), normalized);
  const uploadsRoot = path.join(process.cwd(), "uploads");

  if (fullPath.startsWith(uploadsRoot) && fs.existsSync(fullPath)) {
    fs.unlinkSync(fullPath);
  }
}

const router = express.Router();

/* =========================
   حماية كل المسارات
========================= */
router.use(auth);

/* =========================
   GET /captains
========================= */
router.get("/", async (req, res) => {
  try {
    const { is_admin_branch, branch_id } = req.user;
    const selectedBranch = req.headers["x-branch-id"];

    let rows;

    const baseSelect = `
      SELECT 
        c.*,
        b.name AS branch_name,
        a.code AS account_code,
        a.name_ar AS account_name,

        -- حساب الطلبات المعلقة من الجدولين (أي طلب حالته ليست مكتمل أو ملغي)
        (
          SELECT COUNT(*) FROM orders o 
          WHERE o.captain_id = c.id 
          AND o.status IN ('confirmed', 'preparing', 'ready', 'delivering')
        ) + (
          SELECT COUNT(*) FROM wassel_orders w 
          WHERE w.captain_id = c.id 
          AND w.status IN ('confirmed', 'preparing', 'ready', 'delivering')
        ) AS pending_orders,

        -- حساب الطلبات المكتملة اليوم فقط من الجدولين
        (
          SELECT COUNT(*) FROM orders o 
          WHERE o.captain_id = c.id 
          AND o.status = 'completed' 
          AND DATE(o.created_at) = CURDATE()
        ) + (
          SELECT COUNT(*) FROM wassel_orders w 
          WHERE w.captain_id = c.id 
          AND w.status = 'completed' 
          AND DATE(w.created_at) = CURDATE()
        ) AS completed_today

      FROM captains c
      LEFT JOIN branches b ON b.id = c.branch_id
      LEFT JOIN accounts a ON a.id = c.account_id
    `;

    if (is_admin_branch) {
      if (selectedBranch && Number(selectedBranch) !== Number(branch_id)) {
        [rows] = await db.query(
          `
          ${baseSelect}
          WHERE c.branch_id = ?
          ORDER BY c.id DESC
          `,
          [Number(selectedBranch)]
        );
      } else {
        [rows] = await db.query(`
          ${baseSelect}
          ORDER BY c.id DESC
        `);
      }
    } else {
      [rows] = await db.query(
        `
        ${baseSelect}
        WHERE c.branch_id = ?
        ORDER BY c.id DESC
        `,
        [branch_id]
      );
    }

    const captains = (rows || []).map((captain) => ({
      ...captain,
      image: buildImageUrl(req, captain.image_url),
      image_full_url: buildImageUrl(req, captain.image_url)
    }));

    res.json({ success: true, captains });
  } catch (err) {
    console.error("GET CAPTAINS ERROR:", err);
    res.status(500).json({ success: false, message: "فشل في جلب الكباتن" });
  }
});
/* =========================
   POST /captains
========================= */
router.post("/", async (req, res) => {
  const {
    name,
    email,
    phone,
    password,
    vehicle_type,
    vehicle_number,
    status,
    account_id,
    image_url,
  } = req.body;

  if (!name || !phone || !password || !account_id) {
    return res.json({
      success: false,
      message: "الاسم، الجوال، كلمة المرور، والحساب المحاسبي مطلوبة",
    });
  }

  try {
    const { is_admin_branch, branch_id } = req.user;
    const selectedBranch = req.headers["x-branch-id"];

    let finalBranchId = branch_id;

    if (is_admin_branch && selectedBranch) {
      finalBranchId = Number(selectedBranch);
    }

    await ensureImageColumn();

    const [result] = await db.query(
      `
      INSERT INTO captains
      (name, email, phone, password, vehicle_type, vehicle_number, status, branch_id, account_id, image_url, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
      `,
      [
        name,
        email || null,
        phone,
        password,
        vehicle_type || "دراجة",
        vehicle_number || null,
        status || "available",
        finalBranchId,
        account_id,
        image_url || null,
      ]
    );

    res.json({ success: true, id: result?.insertId });
  } catch (err) {
    console.error("ADD CAPTAIN ERROR:", err);
    res.status(500).json({ success: false, message: "فشل في إضافة الكابتن" });
  }
});
/* =========================
   PUT /captains/profile-image
   رفع صورة الكابتن
========================= */
router.put(
  "/profile-image",
  upload.single("image"),
  async (req, res) => {

    try {

      console.log("REQ USER:", req.user);

      // 🔥 دعم أكثر من نوع توكن
      const captainId =
        req.user?.id ||
        req.user?.captain_id;

      if (!captainId) {
        return res.status(401).json({
          success: false,
          message: "غير مصرح"
        });
      }

      if (!req.file) {
        return res.json({
          success: false,
          message: "لم يتم رفع صورة"
        });
      }

      await ensureImageColumn();

      // جلب الصورة القديمة
      const [[captain]] = await db.query(
        "SELECT image_url FROM captains WHERE id=?",
        [captainId]
      );

      // حذف الصورة القديمة إن وجدت
      removeCaptainImage(captain?.image_url);

      const imageUrl = `${uploadPublicDir}/${req.file.filename}`;

      await db.query(
        "UPDATE captains SET image_url=? WHERE id=?",
        [imageUrl, captainId]
      );

      res.json({
        success: true,
        image_url: imageUrl
      });

    } catch (err) {

      console.error("UPLOAD CAPTAIN IMAGE ERROR:", err);

      res.status(500).json({
        success: false,
        message: "فشل رفع الصورة"
      });

    }

  }
);

/* =========================
   PUT /captains/:id/profile-image
   رفع صورة الكابتن (للإدارة)
========================= */
router.put(
  "/:id/profile-image",
  upload.single("image"),
  async (req, res) => {
    try {
      const captainId = req.params.id;

      if (!req.file) {
        return res.json({
          success: false,
          message: "لم يتم رفع صورة"
        });
      }

      await ensureImageColumn();

      const [[captain]] = await db.query(
        "SELECT image_url FROM captains WHERE id=?",
        [captainId]
      );

      if (!captain) {
        return res.status(404).json({
          success: false,
          message: "الكابتن غير موجود"
        });
      }

      removeCaptainImage(captain?.image_url);

      const imageUrl = `${uploadPublicDir}/${req.file.filename}`;

      await db.query(
        "UPDATE captains SET image_url=? WHERE id=?",
        [imageUrl, captainId]
      );

      res.json({
        success: true,
        image_url: imageUrl
      });
    } catch (err) {
      console.error("UPLOAD CAPTAIN IMAGE (ADMIN) ERROR:", err);

      res.status(500).json({
        success: false,
        message: "فشل رفع الصورة"
      });
    }
  }
);
/* =========================
   PUT /captains/:id
========================= */
router.put("/:id", async (req, res) => {
  const {
    name,
    email,
    phone,
    password,
    vehicle_type,
    vehicle_number,
    status,
    account_id,
    image_url,
  } = req.body;

  const fields = [];
  const values = [];

  if (name !== undefined) { fields.push("name=?"); values.push(name); }
  if (email !== undefined) { fields.push("email=?"); values.push(email); }
  if (phone !== undefined) { fields.push("phone=?"); values.push(phone); }
  if (password !== undefined) { fields.push("password=?"); values.push(password); }
  if (vehicle_type !== undefined) { fields.push("vehicle_type=?"); values.push(vehicle_type); }
  if (vehicle_number !== undefined) { fields.push("vehicle_number=?"); values.push(vehicle_number); }
  if (status !== undefined) { fields.push("status=?"); values.push(status); }
  if (account_id !== undefined) { fields.push("account_id=?"); values.push(account_id); }
  if (image_url !== undefined) { fields.push("image_url=?"); values.push(image_url); }

  if (!fields.length) {
    return res.json({
      success: false,
      message: "لا توجد بيانات للتحديث",
    });
  }

  try {
    await ensureImageColumn();

    await db.query(
      `
      UPDATE captains
      SET ${fields.join(", ")}
      WHERE id=?
      `,
      [...values, req.params.id]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("UPDATE CAPTAIN ERROR:", err);
    res.status(500).json({ success: false, message: "فشل في التحديث" });
  }
});

/* =========================
   DELETE /captains/:id
========================= */
router.delete("/:id", async (req, res) => {
  try {
    await db.query("DELETE FROM captains WHERE id=?", [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error("DELETE CAPTAIN ERROR:", err);
    res.status(500).json({ success: false, message: "فشل في الحذف" });
  }
});

/* =========================
   PUT /captains/:id/status
========================= */
router.put("/:id/status", async (req, res) => {

  const { status } = req.body;
  const valid = ["available", "busy", "offline", "inactive"];

  if (!valid.includes(status)) {
    return res.json({
      success: false,
      message: "حالة غير صحيحة",
    });
  }

  try {

    const captainId = req.params.id;
    const branchId  = req.user.branch_id;

    // تحديث الحالة
    await db.query(
      "UPDATE captains SET status=? WHERE id=?",
      [status, captainId]
    );

    /* ===============================
       إذا أصبح متصل → افتح جلسة
    =============================== */
    if (status === "available") {

      // تأكد ما فيه جلسة مفتوحة
      const [[openSession]] = await db.query(`
        SELECT id FROM captain_sessions
        WHERE captain_id = ?
        AND logout_time IS NULL
        LIMIT 1
      `, [captainId]);

      if (!openSession) {
        await db.query(`
          INSERT INTO captain_sessions
          (captain_id, branch_id, login_time)
          VALUES (?, ?, NOW())
        `, [captainId, branchId]);
      }
    }

    /* ===============================
       إذا أصبح أوفلاين → أغلق الجلسة
    =============================== */
    if (status === "offline") {

      await db.query(`
        UPDATE captain_sessions
        SET logout_time = NOW()
        WHERE captain_id = ?
        AND logout_time IS NULL
      `, [captainId]);
    }

    res.json({ success: true });

  } catch (err) {
    console.error("UPDATE CAPTAIN STATUS ERROR:", err);
    res.status(500).json({ success: false });
  }

});
/* =========================
   POST /captains/fcm-token
   حفظ FCM Token للكابتن
========================= */
router.post("/fcm-token", async (req, res) => {

  try {

    const { token } = req.body;

    if (!token) {

      return res.json({
        success: false,
        message: "FCM Token مطلوب"
      });

    }

    // captain_id من auth middleware
    const captainId = req.user.id;

    await db.query(
      `
      UPDATE captains
      SET fcm_token = ?
      WHERE id = ?
      `,
      [token, captainId]
    );

    console.log("✅ FCM Token saved for captain:", captainId);

    res.json({
      success: true
    });

  }
  catch (err) {

    console.error("FCM TOKEN SAVE ERROR:", err);

    res.status(500).json({
      success: false,
      message: "فشل حفظ FCM Token"
    });

  }

});

export default router;
