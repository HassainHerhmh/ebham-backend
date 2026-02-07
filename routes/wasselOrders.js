import express from "express";
import db from "../db.js"; 
import auth from "../middlewares/auth.js";

const router = express.Router();
router.use(auth);

/* ==============================================
   1. جلب رصيد العميل (حل مشكلة 404 الموضحة في الصور) ✅
============================================== */
router.get("/:customerId/balance", async (req, res) => {
  try {
    const { customerId } = req.params;
    // استعلام لجلب الرصيد من جدول الحركات + السقف الائتماني
    const [[row]] = await db.query(`
      SELECT 
        cg.credit_limit,
        IFNULL((SELECT SUM(m.amount_base) FROM customer_guarantee_moves m WHERE m.guarantee_id = cg.id), 0) AS balance
      FROM customer_guarantees cg
      WHERE cg.customer_id = ? 
      LIMIT 1`, [customerId]);
    
    if (!row) {
      return res.json({ success: true, balance: 0, credit_limit: 0, exists: false });
    }

    res.json({ 
      success: true, 
      balance: Number(row.balance), 
      credit_limit: Number(row.credit_limit || 0),
      exists: true 
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/* ==============================================
   2. جلب قائمة البنوك (النشطة والمخصصة للفرع)
============================================== */
router.get("/banks", async (req, res) => {
  try {
    const branchId = req.headers["x-branch-id"] || req.user.branch_id;
    const [banks] = await db.query(`
      SELECT pm.id, pm.company AS name 
      FROM payment_methods pm
      LEFT JOIN branch_payment_accounts bpa ON bpa.payment_method_id = pm.id AND bpa.branch_id = ?
      WHERE pm.is_active = 1 AND (pm.branch_id IS NULL OR pm.branch_id = ?)
    `, [branchId, branchId]);
    res.json({ success: true, banks });
  } catch (err) { res.status(500).json({ success: false }); }
});

/* ==============================================
   3. جلب جميع الطلبات
============================================== */
router.get("/", async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT w.*, c.name AS customer_name, cap.name AS captain_name, u1.name AS creator_name, u2.name AS updater_name  
      FROM wassel_orders w
      LEFT JOIN customers c ON c.id = w.customer_id
      LEFT JOIN captains cap ON cap.id = w.captain_id
      LEFT JOIN users u1 ON u1.id = w.user_id
      LEFT JOIN users u2 ON u2.id = w.updated_by
      ORDER BY w.id DESC
    `);
    res.json({ success: true, orders: rows });
  } catch (err) { res.status(500).json({ success: false }); }
});

/* ==============================================
   4. إضافة طلب (مع فحص دقيق للرصيد والسقف)
============================================== */
router.post("/", async (req, res) => {
  try {
    const { customer_id, order_type, from_address, to_address, delivery_fee, extra_fee, notes, payment_method, bank_id } = req.body;
    const totalAmount = Number(delivery_fee || 0) + Number(extra_fee || 0);

    if (payment_method === 'wallet' && customer_id) {
      const [[wallet]] = await db.query(`
        SELECT 
          cg.credit_limit,
          IFNULL((SELECT SUM(m.amount_base) FROM customer_guarantee_moves m WHERE m.guarantee_id = cg.id), 0) AS balance
        FROM customer_guarantees cg 
        WHERE cg.customer_id = ?`, [customer_id]);
      
      const availableFunds = wallet ? (Number(wallet.balance) + Number(wallet.credit_limit)) : 0;
      
      if (availableFunds < totalAmount) {
        return res.status(400).json({ success: false, message: "الرصيد والسقف الائتماني غير كافٍ" });
      }
    }

    const [result] = await db.query(
      `INSERT INTO wassel_orders (customer_id, order_type, from_address, to_address, delivery_fee, extra_fee, notes, status, payment_method, bank_id, user_id, created_at) 
       VALUES (?,?,?,?,?,?,?, 'pending', ?, ?, ?, NOW())`,
      [customer_id || null, order_type, from_address, to_address, delivery_fee || 0, extra_fee || 0, notes || "", payment_method, bank_id || null, req.user.id]
    );
    res.json({ success: true, order_id: result.insertId });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

/* ==============================================
   5. تحديث الحالة وتوليد القيود المحاسبية الصحيحة
============================================== */
router.put("/status/:id", async (req, res) => {
  const conn = await db.getConnection();
  try {
    const { status } = req.body;
    const orderId = req.params.id;
    await conn.beginTransaction();
    
    await conn.query("UPDATE wassel_orders SET status=?, updated_by=? WHERE id=?", [status, req.user.id, orderId]);

    if (status === "delivering") {
      const [[settings]] = await conn.query("SELECT * FROM settings LIMIT 1");
      const [orderRows] = await conn.query(`
        SELECT w.*, cap.account_id AS cap_acc_id, pm.account_id AS bank_acc, 
               comm.commission_value, comm.commission_type
        FROM wassel_orders w
        LEFT JOIN captains cap ON cap.id = w.captain_id
        LEFT JOIN payment_methods pm ON pm.id = w.bank_id
        LEFT JOIN commissions comm ON (comm.account_id = cap.id AND comm.account_type = 'captain' AND comm.is_active = 1)
        WHERE w.id = ?`, [orderId]);

      const o = orderRows[0];
      if (!o || !o.cap_acc_id) throw new Error("الكابتن غير مرتبط بحساب محاسبي");

      const totalCharge = Number(o.delivery_fee) + Number(o.extra_fee);
      const commission = o.commission_type === 'percent' ? (totalCharge * o.commission_value / 100) : (o.commission_value || 0);
      const detailNote = `طلب #${orderId}${o.extra_fee > 0 ? ` (شامل إضافي: ${o.extra_fee})` : ''}`;

      if (o.payment_method === 'cod') {
        await insertEntry(conn, o.cap_acc_id, commission, 0, `خصم عمولة ${detailNote}`, orderId, req);
        await insertEntry(conn, settings.courier_commission_account, 0, commission, `إيراد عمولة توصيل ${detailNote}`, orderId, req);
      } else {
        const sourceAcc = o.payment_method === 'bank' ? o.bank_acc : settings.transfer_guarantee_account;
        await insertEntry(conn, sourceAcc, totalCharge, 0, `سداد رسوم ${detailNote}`, orderId, req);
        // ✅ الكابتن دائن (له - بالأخضر) - تصحيح الخلل المحاسبي
        await insertEntry(conn, o.cap_acc_id, 0, totalCharge, `إيداع رسوم ${detailNote} لحساب الكابتن`, orderId, req);
        await insertEntry(conn, o.cap_acc_id, commission, 0, `خصم عمولة ${detailNote}`, orderId, req);
        await insertEntry(conn, settings.courier_commission_account, 0, commission, `إيراد عمولة توصيل ${detailNote}`, orderId, req);
      }
    }
    await conn.commit();
    res.json({ success: true });
  } catch (err) { 
    await conn.rollback(); 
    res.status(500).json({ success: false, message: err.message }); 
  } finally { conn.release(); }
});

/* ==============================================
   6. إسناد كابتن
============================================== */
router.post("/assign", async (req, res) => {
  try {
    const { orderId, captainId } = req.body;
    await db.query("UPDATE wassel_orders SET captain_id = ?, updated_by = ? WHERE id = ?", [captainId, req.user.id, orderId]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false }); }
});

/* دالة إدراج القيد الموحدة */
async function insertEntry(conn, acc, deb, cre, n, ref, req) {
  return conn.query(
    `INSERT INTO journal_entries (journal_type_id, account_id, debit, credit, notes, reference_type, reference_id, journal_date, currency_id, created_by, branch_id) 
     VALUES (1, ?, ?, ?, ?, 'wassel_order', ?, CURDATE(), 1, ?, ?)`,
    [acc, deb || 0, cre || 0, n, ref, req.user.id, req.user.branch_id]
  );
}

export default router;
