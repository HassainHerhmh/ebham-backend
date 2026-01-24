import express from "express";
import db from "../db.js";
import auth from "../middlewares/auth.js";

const router = express.Router();

/* =========================
   حماية كل المسارات
========================= */
router.use(auth);
/* =========================
   GET /customer-addresses
   - الإدارة: كل العناوين أو حسب الفرع المختار
   - الفرع العادي: عناوين فرعه فقط
========================= */
router.get("/", async (req, res) => {
  try {
    const user = req.user;

    // 1. إذا كان المستخدم أدمن (إدارة عامة) -> جلب كل العناوين من كل الفروع
    if (user.is_admin_branch === 1 || user.is_admin_branch === true) {
      const [rows] = await db.query(`
        SELECT ca.*, c.name AS customer_name, b.name AS branch_name, n.name AS neighborhood_name
        FROM customer_addresses ca
        LEFT JOIN customers c ON ca.customer_id = c.id
        LEFT JOIN branches b ON c.branch_id = b.id
        LEFT JOIN neighborhoods n ON ca.district = n.name
        ORDER BY ca.id DESC
      `);
      return res.json({ success: true, mode: "admin", addresses: rows });
    }

    // 2. إذا كان فرع عادي -> جلب عناوين العملاء التابعين لهذا الفرع فقط
    if (!user.branch_id) {
      return res.json({ success: true, addresses: [] });
    }

    const [rows] = await db.query(`
      SELECT ca.*, c.name AS customer_name, b.name AS branch_name, n.name AS neighborhood_name
      FROM customer_addresses ca
      INNER JOIN customers c ON ca.customer_id = c.id
      LEFT JOIN branches b ON c.branch_id = b.id
      LEFT JOIN neighborhoods n ON ca.district = n.name
      WHERE c.branch_id = ?
      ORDER BY ca.id DESC
    `, [user.branch_id]);

    return res.json({ success: true, mode: "branch", addresses: rows });

  } catch (err) {
    console.error("GET ADDRESSES ERROR:", err);
    res.status(500).json({ success: false });
  }
});
/* =========================
   POST /customer-addresses
   - district يُحفظ كنص (اسم الحي)
   - الفرع العادي: يُحفظ على فرعه تلقائيًا
   - الإدارة: يمكن تحديد الفرع من الهيدر
========================= */
router.post("/", async (req, res) => {
  try {
    const {
      customer_id,
      district,        // اسم الحي كنص
      location_type,
      address,
      gps_link,
      latitude,
      longitude,
    } = req.body;

    if (!customer_id || !district) {
      return res.json({ success: false, message: "العميل والحي مطلوبان" });
    }

    const { is_admin_branch, branch_id } = req.user;
    const selectedBranch = req.headers["x-branch-id"];

    let finalBranchId = branch_id;

    if (is_admin_branch && selectedBranch && selectedBranch !== "all") {
      finalBranchId = Number(selectedBranch);
    }

    if (!finalBranchId) {
      return res.json({ success: false, message: "الفرع غير محدد" });
    }

    await db.query(
      `
      INSERT INTO customer_addresses
      (customer_id, district, location_type, address, gps_link, latitude, longitude, branch_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        customer_id,
        district,                // اسم الحي
        location_type || null,
        address || null,
        gps_link || null,
        latitude || null,
        longitude || null,
        finalBranchId,
      ]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("ADD CUSTOMER ADDRESS ERROR:", err);
    res.status(500).json({ success: false });
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
        gps_link || null,
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
