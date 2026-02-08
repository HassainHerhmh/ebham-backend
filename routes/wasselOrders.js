import express from "express";
import db from "../db.js";
import auth from "../middlewares/auth.js";

const router = express.Router();

/* ==============================================
   1️⃣ جلب رصيد العميل (بدون Auth)
============================================== */
router.get("/:customerId/balance", async (req, res) => {
  try {
    const { customerId } = req.params;

    const [[row]] = await db.query(`
      SELECT 
        cg.credit_limit,
        IFNULL((
          SELECT SUM(m.amount_base)
          FROM customer_guarantee_moves m
          WHERE m.guarantee_id = cg.id
        ), 0) AS balance
      FROM customer_guarantees cg
      WHERE cg.customer_id = ?
      LIMIT 1
    `, [customerId]);

    if (!row) {
      return res.json({
        success: true,
        balance: 0,
        credit_limit: 0,
        exists: false
      });
    }

    res.json({
      success: true,
      balance: Number(row.balance),
      credit_limit: Number(row.credit_limit || 0),
      exists: true
    });

  } catch (err) {
    console.error("Balance Error:", err);

    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});


/* =========================
   حماية باقي المسارات
========================= */
router.use(auth);


/* ==============================================
   2️⃣ جلب قائمة البنوك
============================================== */
router.get("/banks", async (req, res) => {
  try {
    const branchId =
      req.headers["x-branch-id"] || req.user.branch_id;

    const [banks] = await db.query(`
      SELECT 
        pm.id,
        pm.company AS name
      FROM payment_methods pm
      LEFT JOIN branch_payment_accounts bpa
        ON bpa.payment_method_id = pm.id
        AND bpa.branch_id = ?
      WHERE pm.is_active = 1
        AND (pm.branch_id IS NULL OR pm.branch_id = ?)
    `, [branchId, branchId]);

    res.json({
      success: true,
      banks
    });

  } catch (err) {
    console.error("Banks Error:", err);

    res.status(500).json({
      success: false
    });
  }
});


/* ==============================================
   3️⃣ جلب جميع الطلبات
============================================== */
router.get("/", async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT 
        w.*,
        c.name AS customer_name,
        cap.name AS captain_name,
        u1.name AS creator_name,
        u2.name AS updater_name
      FROM wassel_orders w
      LEFT JOIN customers c ON c.id = w.customer_id
      LEFT JOIN captains cap ON cap.id = w.captain_id
      LEFT JOIN users u1 ON u1.id = w.user_id
      LEFT JOIN users u2 ON u2.id = w.updated_by
      ORDER BY w.id DESC
    `);

    res.json({
      success: true,
      orders: rows
    });

  } catch (err) {
    console.error("Orders Error:", err);

    res.status(500).json({
      success: false
    });
  }
});


/* ==============================================
   4️⃣ إضافة طلب جديد
============================================== */
router.post("/", async (req, res) => {
  try {
    const {
      customer_id,
      order_type,
      from_address,
      to_address,
      delivery_fee,
      extra_fee,
      notes,
      payment_method,
      bank_id
    } = req.body;

    const totalAmount =
      Number(delivery_fee || 0) +
      Number(extra_fee || 0);


    /* فحص الرصيد */
    if (payment_method === "wallet" && customer_id) {

      const [[wallet]] = await db.query(`
        SELECT 
          cg.credit_limit,
          IFNULL((
            SELECT SUM(m.amount_base)
            FROM customer_guarantee_moves m
            WHERE m.guarantee_id = cg.id
          ), 0) AS balance
        FROM customer_guarantees cg
        WHERE cg.customer_id = ?
      `, [customer_id]);

      const availableFunds = wallet
        ? Number(wallet.balance) + Number(wallet.credit_limit)
        : 0;

      if (availableFunds < totalAmount) {
        return res.status(400).json({
          success: false,
          message: "الرصيد غير كافٍ"
        });
      }
    }


    /* إضافة الطلب */
    const [result] = await db.query(`
      INSERT INTO wassel_orders (
        customer_id,
        order_type,
        from_address,
        to_address,
        delivery_fee,
        extra_fee,
        notes,
        status,
        payment_method,
        bank_id,
        user_id,
        created_at
      )
      VALUES (
        ?,?,?,?,?,?,
        ?, 'pending',
        ?,?,?, NOW()
      )
    `, [
      customer_id || null,
      order_type,
      from_address,
      to_address,
      delivery_fee || 0,
      extra_fee || 0,
      notes || "",
      payment_method,
      bank_id || null,
      req.user.id
    ]);

    res.json({
      success: true,
      order_id: result.insertId
    });

  } catch (err) {
    console.error("Create Order Error:", err);

    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});


/* ==============================================
   5️⃣ تحديث حالة الطلب
============================================== */
router.put("/status/:id", async (req, res) => {
  const conn = await db.getConnection();

  try {
    const { status } = req.body;
    const orderId = req.params.id;

    await conn.beginTransaction();

    // تحديث الحالة
    await conn.query(
      `
      UPDATE wassel_orders
      SET status = ?, updated_by = ?
      WHERE id = ?
    `,
      [status, req.user.id, orderId]
    );

    if (status === "delivering") {
      // الإعدادات
      const [[settings]] = await conn.query(
        "SELECT * FROM settings LIMIT 1"
      );

      // بيانات الطلب + المحفظة
      const [orderRows] = await conn.query(
        `
        SELECT
          w.*,
          cg.id AS guarantee_id,
          c.name AS customer_name,
          cap.account_id AS cap_acc_id,
          pm.account_id AS bank_acc,
          comm.commission_value,
          comm.commission_type
        FROM wassel_orders w

        LEFT JOIN customer_guarantees cg
          ON cg.customer_id = w.customer_id

        LEFT JOIN customers c
          ON c.id = w.customer_id

        LEFT JOIN captains cap
          ON cap.id = w.captain_id

        LEFT JOIN payment_methods pm
          ON pm.id = w.bank_id

        LEFT JOIN commissions comm
          ON comm.account_id = cap.id
          AND comm.account_type = 'captain'
          AND comm.is_active = 1

        WHERE w.id = ?
      `,
        [orderId]
      );

      const o = orderRows[0];

      if (!o) {
        throw new Error("الطلب غير موجود");
      }

      if (!o.cap_acc_id) {
        throw new Error("الكابتن غير مرتبط بحساب محاسبي");
      }

      if (!o.guarantee_id && o.payment_method === "wallet") {
        throw new Error("العميل لا يملك محفظة تأمين");
      }

      const totalCharge =
        Number(o.delivery_fee) + Number(o.extra_fee);

      const commission =
        o.commission_type === "percent"
          ? (totalCharge * o.commission_value) / 100
          : Number(o.commission_value || 0);

      const note = `طلب #${orderId} - ${o.customer_name}`;

      /* =========================
         الدفع عند الاستلام
      ========================= */
      if (o.payment_method === "cod") {
        await insertEntry(
          conn,
          o.cap_acc_id,
          commission,
          0,
          `خصم عمولة ${note}`,
          orderId,
          req
        );

        await insertEntry(
          conn,
          settings.courier_commission_account,
          0,
          commission,
          `إيراد عمولة ${note}`,
          orderId,
          req
        );
      }

      /* =========================
         الدفع من التأمين
      ========================= */
      else {
        if (!settings.customer_guarantee_account) {
          throw new Error("حساب وسيط التأمين غير مربوط في الإعدادات");
        }

        /* ===== القيد المحاسبي ===== */

        // التأمين: مدين
        await insertEntry(
          conn,
          settings.customer_guarantee_account,
          totalCharge,
          0,
          `سداد من تأمين العميل - ${note}`,
          orderId,
          req
        );

        // الكابتن: دائن
        await insertEntry(
          conn,
          o.cap_acc_id,
          0,
          totalCharge,
          `استلام من تأمين العميل - ${note}`,
          orderId,
          req
        );

        /* ===== حركة المحفظة (خصم) ===== */

        await conn.query(
          `
          INSERT INTO customer_guarantee_moves
          (guarantee_id, currency_id, rate, amount, amount_base)
          VALUES (?, ?, ?, ?, ?)
        `,
          [
            o.guarantee_id,
            1, // العملة المحلية
            1,
            -totalCharge,
            -totalCharge,
          ]
        );

        /* ===== العمولة ===== */

        // خصم عمولة من الكابتن
        await insertEntry(
          conn,
          o.cap_acc_id,
          commission,
          0,
          `خصم عمولة ${note}`,
          orderId,
          req
        );

        // إيراد عمولة
        await insertEntry(
          conn,
          settings.courier_commission_account,
          0,
          commission,
          `إيراد عمولة ${note}`,
          orderId,
          req
        );
      }
    }

    await conn.commit();

    res.json({
      success: true,
    });
  } catch (err) {
    await conn.rollback();

    console.error("Status Error:", err);

    res.status(500).json({
      success: false,
      message: err.message,
    });
  } finally {
    conn.release();
  }
});


/* ==============================================
   6️⃣ إسناد كابتن
============================================== */
router.post("/assign", async (req, res) => {
  try {
    const { orderId, captainId } = req.body;

    await db.query(`
      UPDATE wassel_orders
      SET captain_id = ?, updated_by = ?
      WHERE id = ?
    `, [
      captainId,
      req.user.id,
      orderId
    ]);

    res.json({
      success: true
    });

  } catch (err) {
    console.error("Assign Error:", err);

    res.status(500).json({
      success: false
    });
  }
});


/* ==============================================
   دالة إدراج قيد محاسبي
============================================== */
async function insertEntry(
  conn,
  acc,
  deb,
  cre,
  notes,
  ref,
  req
) {
  return conn.query(`
    INSERT INTO journal_entries (
      journal_type_id,
      account_id,
      debit,
      credit,
      notes,
      reference_type,
      reference_id,
      journal_date,
      currency_id,
      created_by,
      branch_id
    )
    VALUES (
      1, ?, ?, ?, ?,
      'wassel_order', ?,
      CURDATE(), 1,
      ?, ?
    )
  `, [
    acc,
    deb || 0,
    cre || 0,
    notes,
    ref,
    req.user.id,
    req.user.branch_id
  ]);
}


export default router;
