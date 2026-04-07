import express from "express";
import db from "../db.js";
import auth from "../middlewares/auth.js";

const router = express.Router();

/* =========================================
   حماية جميع المسارات
========================================= */
router.use(auth);

/* =========================================
   GET /customer/:customerId
   - جلب عناوين عميل محدد
   - الأدمن الفرعي يقدر يحدد الفرع من الهيدر
   - العميل العادي يشوف عناوينه فقط
========================================= */
router.get("/customer/:customerId", async (req, res) => {
  try {
    const { customerId } = req.params;
    const headerBranchId = req.headers["x-branch-id"];
    const user = req.user;

    // حماية: العميل لا يقدر يطلب إلا عناوينه
    if (user.role === "customer" && Number(customerId) !== Number(user.id)) {
      return res.status(403).json({
        success: false,
        message: "غير مصرح لك بالوصول إلى هذه العناوين",
      });
    }

    let where = `WHERE ca.customer_id = ?`;
    let params = [customerId];

    // إذا كان المستخدم مربوط بفرع وليس أدمن عام
    if (user.branch_id && !user.is_admin_branch) {
      where += ` AND ca.branch_id = ?`;
      params.push(user.branch_id);
    }

    // إذا كان أدمن فرعي/إدارة وحدد فرع من الهيدر
    if (
      user.is_admin_branch &&
      headerBranchId &&
      headerBranchId !== "null" &&
      headerBranchId !== "all"
    ) {
      where += ` AND ca.branch_id = ?`;
      params.push(Number(headerBranchId));
    }

    const [rows] = await db.query(
      `
      SELECT
        ca.id,
        ca.customer_id,
        ca.district,
        ca.location_type,
        ca.address,
        ca.gps_link,
        ca.latitude,
        ca.longitude,
        ca.branch_id,
        ca.created_at,
        COALESCE(n.name, ca.district) AS neighborhood_name
      FROM customer_addresses ca
      LEFT JOIN neighborhoods n ON ca.district = n.id
      ${where}
      ORDER BY ca.id DESC
      `,
      params
    );

    return res.json({
      success: true,
      addresses: rows,
    });
  } catch (err) {
    console.error("GET CUSTOMER ADDRESSES ERROR:", err);
    return res.status(500).json({
      success: false,
      message: "حدث خطأ في جلب العناوين",
    });
  }
});

/* =========================================
   POST /
   - إضافة عنوان جديد
   - التطبيق ولوحة التحكم كلاهما بالتوكن
========================================= */
router.post("/", async (req, res) => {
  try {
    const {
      customer_id,
      district,
      location_type,
      address,
      gps_link,
      latitude,
      longitude,
      branch_id: bodyBranchId,
    } = req.body;

    const user = req.user;
    const headerBranchId = req.headers["x-branch-id"];

    // العميل العادي: يضيف لنفسه فقط
    // الإدارة/الموظف: يقدر يحدد customer_id
    let finalCustomerId =
      user.role === "customer" ? user.id : customer_id || null;

    if (!finalCustomerId) {
      return res.status(400).json({
        success: false,
        message: "العميل غير محدد",
      });
    }

    let finalBranchId = user.branch_id || null;

    if (
      bodyBranchId &&
      bodyBranchId !== "null" &&
      bodyBranchId !== "all"
    ) {
      finalBranchId = Number(bodyBranchId);
    } else if (
      headerBranchId &&
      headerBranchId !== "null" &&
      headerBranchId !== "all"
    ) {
      finalBranchId = Number(headerBranchId);
    }

    if (!district) {
      return res.status(400).json({
        success: false,
        message: "الحي مطلوب",
      });
    }

    if (!finalBranchId) {
      return res.status(400).json({
        success: false,
        message: "الفرع غير محدد",
      });
    }

    let finalGpsLink = gps_link;
    if (!finalGpsLink && latitude && longitude) {
      finalGpsLink = `https://www.google.com/maps?q=${latitude},${longitude}`;
    }

    const [result] = await db.query(
      `
      INSERT INTO customer_addresses
      (
        customer_id,
        district,
        location_type,
        address,
        gps_link,
        latitude,
        longitude,
        branch_id
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        finalCustomerId,
        district,
        location_type || null,
        address || null,
        finalGpsLink || null,
        latitude || null,
        longitude || null,
        finalBranchId,
      ]
    );

    return res.json({
      success: true,
      id: result.insertId,
      message: "تم حفظ العنوان بنجاح",
    });
  } catch (err) {
    console.error("ADD CUSTOMER ADDRESS ERROR:", err);
    return res.status(500).json({
      success: false,
      message: "حدث خطأ في السيرفر أثناء الحفظ",
      error: err.message,
    });
  }
});

/* =========================================
   GET /
   - جلب كل العناوين للإدارة
   - أو عناوين الفرع فقط للموظف المرتبط بفرع
========================================= */
router.get("/", async (req, res) => {
  try {
    const user = req.user;
    const headerBranchId = req.headers["x-branch-id"];

    const baseQuery = `
      SELECT
        ca.*,
        c.name AS customer_name,
        c.phone AS customer_phone,
        b.name AS branch_name,
        n.name AS district_name
      FROM customer_addresses ca
      LEFT JOIN customers c ON ca.customer_id = c.id
      LEFT JOIN branches b ON ca.branch_id = b.id
      LEFT JOIN neighborhoods n ON ca.district = n.id
    `;

    // إدارة عامة أو أدمن فرعي
    if (user.is_admin_branch === 1 || user.is_admin_branch === true) {
      if (
        headerBranchId &&
        headerBranchId !== "null" &&
        headerBranchId !== "all"
      ) {
        const [rows] = await db.query(
          `${baseQuery} WHERE ca.branch_id = ? ORDER BY ca.id DESC`,
          [Number(headerBranchId)]
        );

        return res.json({
          success: true,
          mode: "admin-filtered",
          addresses: rows,
        });
      }

      const [rows] = await db.query(`${baseQuery} ORDER BY ca.id DESC`);
      return res.json({
        success: true,
        mode: "admin",
        addresses: rows,
      });
    }

    // موظف/مستخدم مربوط بفرع
    if (!user.branch_id) {
      return res.json({
        success: true,
        mode: "empty",
        addresses: [],
      });
    }

    const [rows] = await db.query(
      `${baseQuery} WHERE ca.branch_id = ? ORDER BY ca.id DESC`,
      [user.branch_id]
    );

    return res.json({
      success: true,
      mode: "branch",
      addresses: rows,
    });
  } catch (err) {
    console.error("GET ADDRESSES ERROR:", err);
    return res.status(500).json({
      success: false,
      message: "حدث خطأ في جلب البيانات",
    });
  }
});

/* =========================================
   PUT /:id
   - تعديل عنوان
========================================= */
router.put("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const {
      district,
      location_type,
      address,
      gps_link,
      latitude,
      longitude,
      branch_id,
    } = req.body;

    const user = req.user;

    const [existingRows] = await db.query(
      `SELECT * FROM customer_addresses WHERE id = ? LIMIT 1`,
      [id]
    );

    const existing = existingRows[0];

    if (!existing) {
      return res.status(404).json({
        success: false,
        message: "العنوان غير موجود",
      });
    }

    // العميل يعدل عنوانه فقط
    if (user.role === "customer" && Number(existing.customer_id) !== Number(user.id)) {
      return res.status(403).json({
        success: false,
        message: "غير مصرح لك بتعديل هذا العنوان",
      });
    }

    // المستخدم المرتبط بفرع لا يعدل خارج فرعه
    if (!user.is_admin_branch && user.branch_id && Number(existing.branch_id) !== Number(user.branch_id)) {
      return res.status(403).json({
        success: false,
        message: "غير مصرح لك بتعديل عنوان خارج فرعك",
      });
    }

    let finalGpsLink = gps_link;
    if (!finalGpsLink && latitude && longitude) {
      finalGpsLink = `https://www.google.com/maps?q=${latitude},${longitude}`;
    }

    let finalBranchId = existing.branch_id;
    if (
      (user.is_admin_branch === 1 || user.is_admin_branch === true) &&
      branch_id &&
      branch_id !== "null" &&
      branch_id !== "all"
    ) {
      finalBranchId = Number(branch_id);
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
        longitude = ?,
        branch_id = ?
      WHERE id = ?
      `,
      [
        district || existing.district || null,
        location_type || null,
        address || null,
        finalGpsLink || null,
        latitude || null,
        longitude || null,
        finalBranchId,
        id,
      ]
    );

    return res.json({
      success: true,
      message: "تم تحديث العنوان بنجاح",
    });
  } catch (err) {
    console.error("UPDATE CUSTOMER ADDRESS ERROR:", err);
    return res.status(500).json({
      success: false,
      message: "حدث خطأ أثناء التحديث",
      error: err.message,
    });
  }
});

/* =========================================
   DELETE /:id
   - حذف عنوان
========================================= */
router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const user = req.user;

    const [existingRows] = await db.query(
      `SELECT * FROM customer_addresses WHERE id = ? LIMIT 1`,
      [id]
    );

    const existing = existingRows[0];

    if (!existing) {
      return res.status(404).json({
        success: false,
        message: "العنوان غير موجود",
      });
    }

    // العميل يحذف عنوانه فقط
    if (user.role === "customer" && Number(existing.customer_id) !== Number(user.id)) {
      return res.status(403).json({
        success: false,
        message: "غير مصرح لك بحذف هذا العنوان",
      });
    }

    // المستخدم المرتبط بفرع لا يحذف خارج فرعه
    if (!user.is_admin_branch && user.branch_id && Number(existing.branch_id) !== Number(user.branch_id)) {
      return res.status(403).json({
        success: false,
        message: "غير مصرح لك بحذف عنوان خارج فرعك",
      });
    }

    await db.query(`DELETE FROM customer_addresses WHERE id = ?`, [id]);

    return res.json({
      success: true,
      message: "تم حذف العنوان بنجاح",
    });
  } catch (err) {
    console.error("DELETE CUSTOMER ADDRESS ERROR:", err);
    return res.status(500).json({
      success: false,
      message: "حدث خطأ أثناء الحذف",
      error: err.message,
    });
  }
});

export default router;
