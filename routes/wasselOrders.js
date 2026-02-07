import express from "express";
import db from "../db.js"; // تأكد من مسار ملف قاعدة البيانات لديك
import auth from "../middlewares/auth.js";

const router = express.Router();

/* حماية جميع المسارات */
router.use(auth);

/* =========================
   جلب طلبات وصل لي مع أسماء المستخدمين
========================= */
router.get("/", async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT 
        w.*,
        c.name AS customer_name,
        cap.name AS captain_name,
        u_creator.name AS creator_name, -- المستخدم الذي أضاف الطلب
        u_updater.name AS updater_name  -- المستخدم الذي حدث الحالة
      FROM wassel_orders w
      LEFT JOIN customers c ON c.id = w.customer_id
      LEFT JOIN captains cap ON cap.id = w.captain_id
      LEFT JOIN users u_creator ON u_creator.id = w.user_id     -- ربط المنشئ
      LEFT JOIN users u_updater ON u_updater.id = w.updated_by -- ربط المحدث
      ORDER BY w.id DESC
    `);
    res.json({ success: true, orders: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
});
/* ==============================================
   2. إضافة طلب جديد
============================================== */
router.post("/", async (req, res) => {
  try {
    const {
      customer_id, order_type, from_address_id, from_address, 
      from_lat, from_lng, to_address_id, to_address, 
      to_lat, to_lng, delivery_fee, extra_fee, notes
    } = req.body;

    if (!order_type || !from_address || !to_address) {
      return res.status(400).json({ success: false, message: "بيانات ناقصة" });
    }

    await db.query(
      `INSERT INTO wassel_orders (
        customer_id, order_type, from_address_id, from_address, from_lat, from_lng,
        to_address_id, to_address, to_lat, to_lng, delivery_fee, extra_fee, notes,
        status, created_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,NOW())`,
      [
        customer_id || null, order_type, from_address_id || null, from_address, from_lat, from_lng,
        to_address_id || null, to_address, to_lat, to_lng, delivery_fee || 0, extra_fee || 0, 
        notes || "", "pending"
      ]
    );

    res.json({ success: true, message: "تم إضافة الطلب بنجاح" });
  } catch (err) {
    console.error("ADD WASSEL ORDER ERROR:", err);
    res.status(500).json({ success: false, message: "فشل في الإضافة" });
  }
});

/* ==============================================
   3. تعديل طلب (يشمل تحديث الكابتن أو البيانات)
============================================== */
router.put("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const {
      customer_id, order_type, from_address, from_lat, from_lng,
      to_address, to_lat, to_lng, from_address_id, to_address_id,
      delivery_fee, extra_fee, notes, status, captain_id
    } = req.body;

    await db.query(
      `UPDATE wassel_orders SET 
        customer_id=?, order_type=?, from_address_id=?, from_address=?, from_lat=?, from_lng=?,
        to_address_id=?, to_address=?, to_lat=?, to_lng=?, delivery_fee=?, extra_fee=?, 
        notes=?, status=?, captain_id=?
      WHERE id=?`,
      [
        customer_id, order_type, from_address_id || null, from_address, from_lat, from_lng,
        to_address_id || null, to_address, to_lat, to_lng, delivery_fee || 0, extra_fee || 0,
        notes || "", status || "pending", captain_id || null, id
      ]
    );

    res.json({ success: true, message: "تم تحديث الطلب" });
  } catch (err) {
    console.error("UPDATE WASSEL ERROR:", err);
    res.status(500).json({ success: false, message: "خطأ في التعديل" });
  }
});

/* ==============================================
   4. إسناد كابتن لطلب (الراوت المخصص)
============================================== */
router.post("/assign", async (req, res) => {
  const { orderId, captainId } = req.body;

  if (!orderId || !captainId) {
    return res.status(400).json({ success: false, message: "بيانات ناقصة" });
  }

  try {
    // تحديث العمود في قاعدة البيانات
    await db.query(
      `UPDATE wassel_orders SET captain_id = ? WHERE id = ?`,
      [captainId, orderId]
    );

    res.json({ success: true, message: "تم إسناد الكابتن بنجاح" });
  } catch (err) {
    console.error("ASSIGN CAPTAIN ERROR:", err);
    res.status(500).json({ success: false, message: "فشل في تحديث قاعدة البيانات" });
  }
});

/* ==============================================
   5. تحديث الحالة فقط
============================================== */
router.put("/status/:id", async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  const updated_by = req.user.id; // مأخوذ من التوكن (auth middleware)

  await db.query(
    `UPDATE wassel_orders SET status=?, updated_by=? WHERE id=?`, 
    [status, updated_by, id]
  );
  res.json({ success: true });
});

/* ==============================================
   6. حذف طلب
============================================== */
router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    await db.query(`DELETE FROM wassel_orders WHERE id=?`, [id]);
    res.json({ success: true });
  } catch (err) {
    console.error("DELETE ERROR:", err);
    res.status(500).json({ success: false, message: "خطأ في الحذف" });
  }
});

export default router;
