import express from "express";
import db from "../db.js"; 
import auth from "../middlewares/auth.js";

const router = express.Router();

router.use(auth);

/* ==============================================
   1. جلب الطلبات مع أسماء الأطراف
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
   2. إضافة طلب جديد
============================================== */
router.post("/", async (req, res) => {
  try {
    const {
      customer_id, order_type, from_address, to_address, 
      delivery_fee, extra_fee, notes, payment_method
    } = req.body;

    const [result] = await db.query(
      `INSERT INTO wassel_orders (
        customer_id, order_type, from_address, to_address, delivery_fee, extra_fee, notes,
        status, payment_method, user_id, created_at
      ) VALUES (?,?,?,?,?,?,?, 'pending', ?, ?, NOW())`,
      [
        customer_id || null, order_type, from_address, to_address, 
        delivery_fee || 0, extra_fee || 0, notes || "", 
        payment_method || 'cod', req.user.id
      ]
    );

    res.json({ success: true, order_id: result.insertId });
  } catch (err) {
    res.status(500).json({ success: false, message: "فشل الإضافة" });
  }
});

/* ==============================================
   3. تعديل طلب (إصلاح خطأ 404)
============================================== */
router.put("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const {
      customer_id, order_type, from_address, to_address,
      delivery_fee, extra_fee, notes, status, captain_id, payment_method
    } = req.body;

    await db.query(
      `UPDATE wassel_orders SET 
        customer_id=?, order_type=?, from_address=?, to_address=?, 
        delivery_fee=?, extra_fee=?, notes=?, status=?, captain_id=?, payment_method=?, updated_by=?
      WHERE id=?`,
      [
        customer_id, order_type, from_address, to_address, 
        delivery_fee || 0, extra_fee || 0, notes || "", 
        status || "pending", captain_id || null, payment_method || 'cod', req.user.id, id
      ]
    );

    res.json({ success: true, message: "تم التحديث بنجاح" });
  } catch (err) {
    console.error("UPDATE ERROR:", err);
    res.status(500).json({ success: false });
  }
});

/* ==============================================
   4. تحديث الحالة وتوليد القيود (إصلاح المحاسبة)
============================================== */
router.put("/status/:id", async (req, res) => {
  const conn = await db.getConnection();
  try {
    const { status } = req.body;
    const orderId = req.params.id;
    const updated_by = req.user.id;

    await conn.beginTransaction();
    await conn.query("UPDATE wassel_orders SET status=?, updated_by=? WHERE id=?", [status, updated_by, orderId]);

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

      // جمع الرسوم الأساسية والإضافية في مبلغ واحد
      const totalDeliveryCharge = Number(order.delivery_fee) + Number(order.extra_fee);
      const hasExtra = Number(order.extra_fee) > 0;
      
      // تجهيز البيان التفصيلي
      const detailNote = hasExtra 
          ? `رسوم توصيل #${orderId} (شاملة رسوم إضافية: ${order.extra_fee})` 
          : `رسوم توصيل طلب #${orderId}`;

      let commission = order.commission_type === 'percent' ? (totalDeliveryCharge * order.commission_value / 100) : (order.commission_value || 0);

      const baseParams = { ref_id: orderId, cur: baseCur.id, user: updated_by, branch: req.user.branch_id };

      if (order.payment_method === 'cod') {
        // الكابتن مدين (عليه) بقيمة العمولة
        await insertEntry(conn, order.cap_acc_id, commission, 0, `خصم عمولة ${detailNote} - دفع عند الاستلام`, baseParams);
        await insertEntry(conn, settings.courier_commission_account, 0, commission, `إيراد عمولة توصيل طلب #${orderId}`, baseParams);

      } else if (order.payment_method === 'wallet') {
        // من التأمينات للكابتن (كامل المبلغ)
        await insertEntry(conn, settings.transfer_guarantee_account, 0, totalDeliveryCharge, `سداد ${detailNote} من الرصيد`, baseParams);
        await insertEntry(conn, order.cap_acc_id, totalDeliveryCharge, 0, `إيداع ${detailNote} لحساب الكابتن`, baseParams);
        
        // خصم العمولة (عليه)
        await insertEntry(conn, order.cap_acc_id, commission, 0, `خصم عمولة طلب وصل لي #${orderId}`, baseParams);
        await insertEntry(conn, settings.courier_commission_account, 0, commission, `إيراد عمولة توصيل طلب #${orderId}`, baseParams);

      } else if (order.payment_method === 'bank' || order.payment_method === 'online') {
        const bankAcc = (order.payment_method === 'bank') ? settings.bank_account : settings.online_payment_account;
        
        // من البنك للكابتن (كامل المبلغ بقيد واحد)
        await insertEntry(conn, bankAcc, 0, totalDeliveryCharge, `تحويل ${detailNote} عبر البنك`, baseParams);
        await insertEntry(conn, order.cap_acc_id, totalDeliveryCharge, 0, `إيداع ${detailNote} لحساب الكابتن`, baseParams);

        // خصم العمولة (عليه)
        await insertEntry(conn, order.cap_acc_id, commission, 0, `خصم عمولة طلب وصل لي #${orderId}`, baseParams);
        await insertEntry(conn, settings.courier_commission_account, 0, commission, `إيراد عمولة توصيل طلب #${orderId}`, baseParams);
      }
    }

    await conn.commit();
    res.json({ success: true });
  } catch (err) {
    if (conn) await conn.rollback();
    res.status(500).json({ success: false, message: err.message });
  } finally {
    if (conn) conn.release();
  }
});

/* ==============================================
   دالة مساعدة لإدراج القيد (حل مشكلة journal_type_id)
============================================== */
async function insertEntry(conn, accId, debit, credit, note, p) {
  if (!accId) throw new Error("أحد الحسابات المحاسبية غير معرف في الإعدادات");

  return conn.query(
    `INSERT INTO journal_entries 
     (journal_type_id, account_id, debit, credit, notes, reference_type, reference_id, journal_date, currency_id, created_by, branch_id) 
     VALUES (1, ?, ?, ?, ?, 'wassel_order', ?, CURDATE(), ?, ?, ?)`,
    [accId, debit || 0, credit || 0, note, p.ref_id, p.cur, p.user, p.branch]
  );
}

/* ==============================================
   5. إسناد كابتن
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
