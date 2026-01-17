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
    const { is_admin_branch, branch_id } = req.user;
    let selectedBranch = req.headers["x-branch-id"];

    if (selectedBranch === "all") selectedBranch = null;

    const baseSelect = `
      SELECT 
        a.*,
        c.name AS customer_name,
        b.name AS branch_name,
        a.district AS neighborhood_name
      FROM customer_addresses a
      LEFT JOIN customers c ON c.id = a.customer_id
      LEFT JOIN branches b ON b.id = a.branch_id
    `;

    let rows;

    if (is_admin_branch) {
      if (selectedBranch) {
        [rows] = await db.query(
          `
          ${baseSelect}
          WHERE a.branch_id = ?
          ORDER BY a.id DESC
          `,
          [selectedBranch]
        );
      } else {
        [rows] = await db.query(`
          ${baseSelect}
          ORDER BY a.id DESC
        `);
      }
    } else {
      [rows] = await db.query(
        `
        ${baseSelect}
        WHERE a.branch_id = ?
        ORDER BY a.id DESC
        `,
        [branch_id]
      );
    }

    res.json({ success: true, addresses: rows });
  } catch (err) {
    console.error("GET CUSTOMER ADDRESSES ERROR:", err);
    res.status(500).json({ success: false, addresses: [] });
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
