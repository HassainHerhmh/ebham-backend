import express from "express";
import db from "../db.js";
import auth from "../middlewares/auth.js";

const router = express.Router();


router.get("/customer/:customerId", async (req, res) => {
  try {
    const { customerId } = req.params;
      const branch = req.headers["x-branch-id"];

    console.log("🔎 CUSTOMER ADDRESSES HEADERS:", req.headers);
    console.log("🏷️ x-branch-id =", branch);

    const where = (branch && branch !== "null")
      ? "AND ca.branch_id = ?"
      : "";

    const params = (branch && branch !== "null")
      ? [customerId, branch]
      : [customerId];

    const [rows] = await db.query(
      `
      SELECT ca.id, 
             ca.district, 
             ca.address, 
             ca.gps_link, 
             ca.latitude, 
             ca.longitude,
             ca.branch_id,
             COALESCE(n.name, ca.district) AS neighborhood_name
      FROM customer_addresses ca
      LEFT JOIN neighborhoods n ON ca.district = n.id
      WHERE ca.customer_id = ?
      ${where}
      ORDER BY ca.id DESC
      `,
      params
    );

    res.json({ success: true, addresses: rows });
  } catch (err) {
    console.error("GET CUSTOMER ADDRESSES ERROR:", err);
    res.status(500).json({ success: false });
  }
});

/* ============================================================
   2. POST / (إضافة عنوان جديد) - نسخة مصححة نهائياً
============================================================ */
router.post("/", auth, async (req, res) => {
  try {
    const {
      customer_id,
      district,
      location_type,
      address,
      gps_link,
      latitude,
      longitude,
      branch_id: bodyBranchId 
    } = req.body;

    console.log("📥 Incoming Request Data:", { customer_id, bodyBranchId });

    const finalCustomerId = customer_id || req.user.id;
    const { is_admin_branch, branch_id: userBranchId } = req.user;
    const headerBranchId = req.headers["x-branch-id"];

    let selectedBranch = bodyBranchId || headerBranchId;
    let finalBranchId = userBranchId;

    if (selectedBranch && selectedBranch !== "all" && selectedBranch !== "null") {
      finalBranchId = Number(selectedBranch);
    }

    if (!finalBranchId) {
      return res.json({ success: false, message: "الفرع غير محدد" });
    }

    // ✅ التعديل هنا: استخدام db بدلاً من pool ليتوافق مع الـ import في أعلى ملفك
    const [result] = await db.query( 
      `
      INSERT INTO customer_addresses
      (customer_id, district, location_type, address, gps_link, latitude, longitude, branch_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        finalCustomerId,
        district,
        location_type || null,
        address || null,
        gps_link || null,
        latitude || null,
        longitude || null,
        finalBranchId,
      ]
    );

    return res.json({
      success: true,
      id: result.insertId,
      message: "تم حفظ العنوان بنجاح"
    });

  } catch (err) {
    console.error("🔥 ADD ADDRESS CRITICAL ERROR:", err.message);
    return res.status(500).json({ 
      success: false, 
      message: "حدث خطأ في السيرفر أثناء الحفظ" 
    });
  }
});
/* =========================
   حماية كل المسارات
========================= */
router.use(auth);
/* =========================
   تعديل مسار GET /
========================= */
router.get("/", async (req, res) => {
  try {
    const user = req.user;

    // الاستعلام المحدث باستخدام جدول neighborhoods والرمز الصحيح n.name
    const queryStr = `
        SELECT ca.*, 
               c.name AS customer_name, 
               b.name AS branch_name,
                n.name AS district_name -- جلب اسم الحي من الجدول الصحيح
        FROM customer_addresses ca
        LEFT JOIN customers c ON ca.customer_id = c.id
        LEFT JOIN branches b ON ca.branch_id = b.id
        LEFT JOIN neighborhoods n ON ca.district = n.id -- الربط مع الجدول الصحيح neighborhoods
    `;

    if (user.is_admin_branch === 1 || user.is_admin_branch === true) {
      const [rows] = await db.query(`${queryStr} ORDER BY ca.id DESC`);
      return res.json({ success: true, mode: "admin", addresses: rows });
    }

    if (!user.branch_id) {
      return res.json({ success: true, addresses: [] });
    }

    const [rows] = await db.query(`${queryStr} WHERE ca.branch_id = ? ORDER BY ca.id DESC`, [user.branch_id]);
    return res.json({ success: true, mode: "branch", addresses: rows });

  } catch (err) {
    console.error("GET ADDRESSES ERROR:", err);
    res.status(500).json({ success: false, message: "حدث خطأ في جلب البيانات" });
  }
});

/* =========================
   PUT /customer-addresses/:id
========================= */
router.put("/:id", async (req, res) => {
  const {
    district,
    location_type,
    address,
    gps_link,
    latitude,
    longitude,
  } = req.body;

  try {

    let finalGpsLink = gps_link;

if (!finalGpsLink && latitude && longitude) {
  finalGpsLink = `https://www.google.com/maps?q=${latitude},${longitude}`;
}

    await db.query(
      `
      UPDATE customer_addresses
      SET
        district = ?,
        location_type = ?,
        address = ?,
        gps_link = ?,
        latitude = ?,
        longitude = ?
      WHERE id = ?
      `,
      [
        district || null,
        location_type || null,
        address || null,
finalGpsLink || null,
        latitude || null,
        longitude || null,
        req.params.id,
      ]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("UPDATE CUSTOMER ADDRESS ERROR:", err);
    res.status(500).json({ success: false });
  }
});

/* =========================
   DELETE /customer-addresses/:id
========================= */
router.delete("/:id", async (req, res) => {
  try {
    await db.query("DELETE FROM customer_addresses WHERE id = ?", [
      req.params.id,
    ]);

    res.json({ success: true });
  } catch (err) {
    console.error("DELETE CUSTOMER ADDRESS ERROR:", err);
    res.status(500).json({ success: false });
  }
});





export default router;
