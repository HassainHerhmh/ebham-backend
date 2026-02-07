import express from "express";
import db from "../db.js"; 
import auth from "../middlewares/auth.js";

const router = express.Router();

router.use(auth);

/* ==============================================
   1. جلب الطلبات مع أسماء (العميل، الكابتن، المستخدمين)
============================================== */
router.get("/", async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT 
        w.*,
        c.name AS customer_name,
        cap.name AS captain_name,
        u_creator.name AS creator_name, 
        u_updater.name AS updater_name  
      FROM wassel_orders w
      LEFT JOIN customers c ON c.id = w.customer_id
      LEFT JOIN captains cap ON cap.id = w.captain_id
      LEFT JOIN users u_creator ON u_creator.id = w.user_id
      LEFT JOIN users u_updater ON u_updater.id = w.updated_by
      ORDER BY w.id DESC
    `);
    res.json({ success: true, orders: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
});

/* ==============================================
   2. إضافة طلب جديد مع طريقة الدفع
============================================== */
router.post("/", async (req, res) => {
  try {
    const {
      customer_id, order_type, from_address, from_lat, from_lng,
      to_address, to_lat, to_lng, delivery_fee, extra_fee, notes, payment_method
    } = req.body;

    const user_id = req.user.id; 

    const [result] = await db.query(
      `INSERT INTO wassel_orders (
        customer_id, order_type, from_address, from_lat, from_lng,
        to_address, to_lat, to_lng, delivery_fee, extra_fee, notes,
        status, payment_method, user_id, created_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,NOW())`,
      [
        customer_id || null, order_type, from_address, from_lat, from_lng,
        to_address, to_lat, to_lng, delivery_fee || 0, extra_fee || 0, 
        notes || "", "pending", payment_method || 'cod', user_id
      ]
    );

    res.json({ success: true, order_id: result.insertId });
  } catch (err) {
    res.status(500).json({ success: false, message: "فشل الإضافة" });
  }
});

/* ==============================================
   3. تحديث الحالة وتوليد القيود المحاسبية (النسخة المصلحة)
============================================== */
router.put("/status/:id", async (req, res) => {
  const conn = await db.getConnection();
  try {
    const { status } = req.body;
    const orderId = req.params.id;
    const updated_by = req.user.id;

    await conn.beginTransaction();

    // أ- تحديث الحالة والمحدث
    await conn.query("UPDATE wassel_orders SET status=?, updated_by=? WHERE id=?", [status, updated_by, orderId]);

    // ب- توليد القيود عند حالة "قيد التوصيل"
    if (status === "delivering") {
      const [[settings]] = await conn.query("SELECT * FROM settings LIMIT 1");
      const [[baseCur]] = await conn.query("SELECT id FROM currencies WHERE is_local=1 LIMIT 1");

      const [orderRows] = await conn.query(`
        SELECT w.*, cap.account_id AS cap_acc_id, 
                comm.commission_value, comm.commission_type
        FROM wassel_orders w
        LEFT JOIN captains cap ON w.captain_id = cap.id
        LEFT JOIN commissions comm ON (comm.account_id = cap.id AND comm.account_type = 'captain' AND comm.is_active = 1)
        WHERE w.id = ?`, [orderId]);

      const order = orderRows[0];
      if (!order || !order.cap_acc_id) throw new Error("الكابتن غير مرتبط بحساب أو لم يتم إسناد كابتن");

      const totalFee = Number(order.delivery_fee) + Number(order.extra_fee);
      
      // حساب العمولة
      let commission = 0;
      if (order.commission_value) {
        commission = order.commission_type === 'percent' ? (totalFee * order.commission_value / 100) : order.commission_value;
      }

      const baseParams = { ref_id: orderId, cur: baseCur.id, user: updated_by, branch: req.user.branch_id };

      // ج- تطبيق القيود (تصحيح المدين والدائن وتوجيه الحساب)
      if (order.payment_method === 'cod') {
        // الكابتن مدين (عليه) بقيمة العمولة لأن الكاش معه
        await insertEntry(conn, order.cap_acc_id, commission, 0, `خصم عمولة طلب وصل لي #${orderId} - دفع عند الاستلام`, baseParams);
        // حساب عمولات التوصيل (دائن - إيراد)
        await insertEntry(conn, settings.courier_commission_account, 0, commission, `إيراد عمولة توصيل طلب #${orderId}`, baseParams);

      } else if (order.payment_method === 'wallet') {
        // 1. استحقاق الكابتن لكامل المبلغ (من التأمينات إلى الكابتن)
        await insertEntry(conn, settings.transfer_guarantee_account, 0, totalFee, `سداد طلب #${orderId} من الرصيد`, baseParams);
        await insertEntry(conn, order.cap_acc_id, totalFee, 0, `إيداع رسوم طلب #${orderId} في حساب الكابتن`, baseParams);
        
        // 2. خصم العمولة من الكابتن (مدين - عليه)
        await insertEntry(conn, order.cap_acc_id, commission, 0, `خصم عمولة طلب #${orderId}`, baseParams);
        await insertEntry(conn, settings.courier_commission_account, 0, commission, `إيراد عمولة توصيل طلب #${orderId}`, baseParams);

      } else if (order.payment_method === 'bank' || order.payment_method === 'online') {
        const bankAcc = (order.payment_method === 'bank') ? settings.bank_account : settings.online_payment_account;
        
        // 1. من حساب البنك للكابتن
        await insertEntry(conn, bankAcc, 0, totalFee, `تحويل قيمة طلب #${orderId} عبر البنك/إلكتروني`, baseParams);
        await insertEntry(conn, order.cap_acc_id, totalFee, 0, `قيمة طلب #${orderId} محولة للكابتن`, baseParams);

        // 2. خصم العمولة (مدين - عليه)
        await insertEntry(conn, order.cap_acc_id, commission, 0, `خصم عمولة طلب #${orderId}`, baseParams);
        await insertEntry(conn, settings.courier_commission_account, 0, commission, `إيراد عمولة توصيل طلب #${orderId}`, baseParams);
      }
    }

    await conn.commit();
    res.json({ success: true });
  } catch (err) {
    if (conn) await conn.rollback();
    console.error("ACCOUNTING ERROR:", err.message);
    res.status(500).json({ success: false, message: err.message });
  } finally {
    if (conn) conn.release();
  }
});

/* ==============================================
   دالة مساعدة لإدراج القيد المحاسبي
============================================== */
async function insertEntry(conn, accId, debit, credit, note, p) {
  if (!accId) throw new Error("أحد الحسابات الوسيطة غير معرف في الإعدادات");

  // الرقم 1 كنوع قيد يومية عام
  const DEFAULT_JOURNAL_TYPE_ID = 1;

  return conn.query(
    `INSERT INTO journal_entries 
     (journal_type_id, account_id, debit, credit, notes, reference_type, reference_id, journal_date, currency_id, created_by, branch_id) 
     VALUES (?, ?, ?, ?, ?, 'wassel_order', ?, CURDATE(), ?, ?, ?)`,
    [DEFAULT_JOURNAL_TYPE_ID, accId, debit || 0, credit || 0, note, p.ref_id, p.cur, p.user, p.branch]
  );
}

/* ==============================================
   4. إسناد كابتن
============================================== */
router.post("/assign", async (req, res) => {
  try {
    const { orderId, captainId } = req.body;
    await db.query("UPDATE wassel_orders SET captain_id = ?, updated_by = ? WHERE id = ?", [captainId, req.user.id, orderId]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

export default router;
