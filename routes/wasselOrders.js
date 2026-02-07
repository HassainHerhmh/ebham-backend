import express from "express";
import db from "../db.js"; 
import auth from "../middlewares/auth.js";

const router = express.Router();

router.use(auth);

/* ==============================================
   1. جلب قائمة البنوك (للمودال)
============================================== */
router.get("/banks", async (req, res) => {
  try {
    const [banks] = await db.query(
      "SELECT id, company AS name, account_number FROM payment_methods WHERE is_active = 1"
    );
    res.json({ success: true, banks });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

/* ==============================================
   2. جلب الطلبات مع أسماء الأطراف
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
   3. إضافة طلب جديد (مع فحص الرصيد والسقف)
============================================== */
router.post("/", async (req, res) => {
  try {
    const {
      customer_id, order_type, from_address, to_address, 
      delivery_fee, extra_fee, notes, payment_method, bank_id
    } = req.body;

    const totalAmount = Number(delivery_fee || 0) + Number(extra_fee || 0);

    // ✅ فحص الرصيد والسقف عند الدفع من المحفظة
    if (payment_method === 'wallet' && customer_id) {
      const [[walletInfo]] = await db.query(`
        SELECT 
          IFNULL((SELECT SUM(amount_base) FROM customer_guarantee_moves WHERE guarantee_id = cg.id), 0) AS balance,
          cg.credit_limit
        FROM customer_guarantees cg
        WHERE cg.customer_id = ?
      `, [customer_id]);

      if (walletInfo) {
        const available = Number(walletInfo.balance) + Number(walletInfo.credit_limit);
        if (totalAmount > available) {
          return res.status(400).json({ 
            success: false, 
            message: `الرصيد غير كافٍ. المتاح مع السقف: ${available}` 
          });
        }
      }
    }

    const [result] = await db.query(
      `INSERT INTO wassel_orders (
        customer_id, order_type, from_address, to_address, delivery_fee, extra_fee, notes,
        status, payment_method, bank_id, user_id, created_at
      ) VALUES (?,?,?,?,?,?,?, 'pending', ?, ?, ?, NOW())`,
      [
        customer_id || null, order_type, from_address, to_address, 
        delivery_fee || 0, extra_fee || 0, notes || "", 
        payment_method || 'cod', bank_id || null, req.user.id
      ]
    );

    res.json({ success: true, order_id: result.insertId });
  } catch (err) {
    console.error("ADD ERROR:", err);
    res.status(500).json({ success: false, message: "فشل الإضافة" });
  }
});

/* ==============================================
   4. تعديل طلب (إصلاح خطأ 404 ودعم البنك)
============================================== */
router.put("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const {
      customer_id, order_type, from_address, to_address,
      delivery_fee, extra_fee, notes, status, captain_id, payment_method, bank_id
    } = req.body;

    await db.query(
      `UPDATE wassel_orders SET 
        customer_id=?, order_type=?, from_address=?, to_address=?, 
        delivery_fee=?, extra_fee=?, notes=?, status=?, captain_id=?, payment_method=?, bank_id=?, updated_by=?
      WHERE id=?`,
      [
        customer_id, order_type, from_address, to_address, 
        delivery_fee || 0, extra_fee || 0, notes || "", 
        status || "pending", captain_id || null, payment_method || 'cod', bank_id || null, req.user.id, id
      ]
    );

    res.json({ success: true, message: "تم التحديث بنجاح" });
  } catch (err) {
    console.error("UPDATE ERROR:", err);
    res.status(500).json({ success: false });
  }
});

/* ==============================================
   5. تحديث الحالة وتوليد القيود المحاسبية (النسخة النهائية المصححة)
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
                comm.commission_value, comm.commission_type,
                pm.account_id AS selected_bank_acc
        FROM wassel_orders w
        LEFT JOIN captains cap ON w.captain_id = cap.id
        LEFT JOIN payment_methods pm ON w.bank_id = pm.id
        LEFT JOIN commissions comm ON (comm.account_id = cap.id AND comm.account_type = 'captain' AND comm.is_active = 1)
        WHERE w.id = ?`, [orderId]);

      const order = orderRows[0];
      if (!order || !order.cap_acc_id) throw new Error("الكابتن غير مرتبط بحساب أو لم يتم إسناد كابتن");

      // جمع الرسوم الأساسية والإضافية في مبلغ واحد
      const totalDeliveryCharge = Number(order.delivery_fee) + Number(order.extra_fee);
      const hasExtra = Number(order.extra_fee) > 0;
      
      const detailNote = hasExtra 
          ? `رسوم توصيل #${orderId} (شاملة إضافي: ${order.extra_fee})` 
          : `رسوم توصيل طلب #${orderId}`;

      let commission = order.commission_type === 'percent' ? (totalDeliveryCharge * order.commission_value / 100) : (order.commission_value || 0);
      const baseParams = { ref_id: orderId, cur: baseCur.id, user: updated_by, branch: req.user.branch_id };

      if (order.payment_method === 'cod') {
        // ✅ الكابتن مدين (عليه) بقيمة العمولة فقط لأن الكاش معه
        await insertEntry(conn, order.cap_acc_id, commission, 0, `خصم عمولة ${detailNote} - دفع عند الاستلام`, baseParams);
        await insertEntry(conn, settings.courier_commission_account, 0, commission, `إيراد عمولة توصيل طلب #${orderId}`, baseParams);

      } else {
        // ✅ حالات البنك أو المحفظة: (من البنك/التأمينات إلى الكابتن)
        const debitSourceAcc = order.payment_method === 'bank' ? order.selected_bank_acc : settings.transfer_guarantee_account;
        
        // 1. سداد الرسوم من المصدر (مدين: المصدر)
        await insertEntry(conn, debitSourceAcc, 0, totalDeliveryCharge, `سداد ${detailNote}`, baseParams);
        
        // 2. ✅ إيداع الرسوم في حساب الكابتن (دائن: له / بالأخضر) لتصحيح الخطأ في الصورة
        await insertEntry(conn, order.cap_acc_id, 0, totalDeliveryCharge, `إيداع ${detailNote} لحساب الكابتن`, baseParams);

        // 3. خصم العمولة من الكابتن (مدين: عليه)
        await insertEntry(conn, order.cap_acc_id, commission, 0, `خصم عمولة طلب وصل لي #${orderId}`, baseParams);
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
   دالة مساعدة لإدراج القيد (تثبيت نوع القيد 1)
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
   6. إسناد كابتن
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
