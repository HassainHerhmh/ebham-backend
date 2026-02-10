import express from "express";
import db from "../db.js";
import auth from "../middlewares/auth.js";

const router = express.Router();
router.use(auth);

/* ==============================================
   جلب الطلبات اليدوية
============================================== */
router.get("/manual-list", async (req, res) => {
  try {

    const [rows] = await db.query(`
      SELECT 
        w.id,
        ANY_VALUE(w.customer_id) AS customer_id,
        ANY_VALUE(w.restaurant_id) AS restaurant_id,
        ANY_VALUE(w.captain_id) AS captain_id,
        ANY_VALUE(w.total_amount) AS total_amount,
        ANY_VALUE(w.delivery_fee) AS delivery_fee,
        ANY_VALUE(w.payment_method) AS payment_method,
        ANY_VALUE(w.status) AS status,
        ANY_VALUE(w.notes) AS notes,
        ANY_VALUE(w.to_address) AS to_address,
        ANY_VALUE(w.created_at) AS created_at,

        ANY_VALUE(c.name) AS customer_name,
        ANY_VALUE(r.name) AS restaurant_name,
        ANY_VALUE(cap.name) AS captain_name,
        ANY_VALUE(u.name) AS user_name,

        JSON_ARRAYAGG(
          JSON_OBJECT(
            'name', i.product_name,
            'qty', i.qty,
            'price', i.price,
            'total', i.total
          )
        ) AS items

      FROM wassel_orders w

      LEFT JOIN customers c ON c.id=w.customer_id
      LEFT JOIN restaurants r ON r.id=w.restaurant_id
      LEFT JOIN captains cap ON cap.id=w.captain_id
      LEFT JOIN users u ON u.id=w.user_id
      LEFT JOIN wassel_order_items i ON i.order_id=w.id

      WHERE w.display_type='manual'

      GROUP BY w.id
      ORDER BY w.id DESC
    `);

    res.json({ success:true, orders:rows });

  } catch (err) {

    console.error(err);

    res.status(500).json({
      success:false,
      message:"فشل في جلب الطلبات"
    });
  }
});


/* ==============================================
   حفظ طلب يدوي
============================================== */
router.post("/", async (req, res) => {

  const conn = await db.getConnection();

  try {

    const {
      customer_id,
      restaurant_id,
      to_address,
      delivery_fee,
      notes,
      payment_method,
      items,
      total_amount
    } = req.body;

    if (!customer_id || !items?.length) {
      return res.status(400).json({
        success:false,
        message:"البيانات ناقصة"
      });
    }

    await conn.beginTransaction();

    const [orderRes] = await conn.query(`
      INSERT INTO wassel_orders (
        customer_id,
        restaurant_id,
        to_address,
        delivery_fee,
        total_amount,
        payment_method,
        notes,
        status,
        display_type,
        user_id,
        created_at
      )
      VALUES (?,?,?,?,?,?,?, 'pending','manual',?,NOW())
    `,[
      customer_id,
      restaurant_id||null,
      to_address,
      delivery_fee,
      total_amount,
      payment_method,
      notes,
      req.user.id
    ]);

    const orderId = orderRes.insertId;

    for (const item of items){

      await conn.query(`
        INSERT INTO wassel_order_items
        (order_id,product_name,qty,price,total)
        VALUES (?,?,?,?,?)
      `,[
        orderId,
        item.name,
        item.qty,
        item.price,
        item.qty*item.price
      ]);
    }

    await conn.commit();

    res.json({ success:true, order_id:orderId });

  } catch (err){

    await conn.rollback();

    console.error(err);

    res.status(500).json({ success:false });

  } finally {
    conn.release();
  }
});


/* ==============================================
   تحديث الحالة + القيود
============================================== */
router.put("/status/:id", async (req, res)=>{

  console.log("🔥 MANUAL STATUS HIT:", req.params.id, req.body.status);

  const orderId = req.params.id;
  const { status } = req.body;

  const conn = await db.getConnection();

  try {

    await conn.beginTransaction();

    /* تحديث الحالة */
    await conn.query(
      "UPDATE wassel_orders SET status=? WHERE id=?",
      [status, orderId]
    );


    /* فقط عند التوصيل */
    if (status === "delivering") {

      /* منع التكرار */
      const [[old]] = await conn.query(`
        SELECT id FROM journal_entries
        WHERE reference_type='manual_order'
        AND reference_id=?
        LIMIT 1
      `,[orderId]);

      if (old){
        throw new Error("تم الترحيل سابقاً");
      }


      /* الإعدادات */
      const [[settings]] = await conn.query(`
        SELECT * FROM settings LIMIT 1
      `);


      /* جلب بيانات الطلب */
      const [rows] = await conn.query(`
        SELECT 
          w.*,

          c.name AS customer_name,

          cap.account_id AS cap_acc_id,

          cg.id   AS guarantee_id,
          cg.type AS guarantee_type,
          cg.account_id AS customer_acc_id,

          comA.commission_type  AS agent_comm_type,
          comA.commission_value AS agent_comm_value,

          comm.commission_type,
          comm.commission_value

        FROM wassel_orders w

        LEFT JOIN customers c 
          ON c.id = w.customer_id

        LEFT JOIN captains cap 
          ON cap.id = w.captain_id


        /* محفظة العميل */
        LEFT JOIN customer_guarantees cg
          ON cg.customer_id = w.customer_id


        /* ربط المطعم بالوكيل */
        LEFT JOIN restaurants r 
          ON r.id = w.restaurant_id

        LEFT JOIN agents ag 
          ON ag.id = r.agent_id


        /* عقد الوكيل */
        LEFT JOIN commissions comA
          ON comA.account_type = 'agent'
         AND comA.account_id = ag.id
         AND comA.is_active = 1


        /* عقد الكابتن */
        LEFT JOIN commissions comm 
          ON comm.account_type = 'captain'
         AND comm.account_id = cap.id
         AND comm.is_active = 1

        WHERE w.id = ?
      `,[orderId]);


      const o = rows[0];

      if (!o) throw new Error("الطلب غير موجود");
      if (!o.cap_acc_id) throw new Error("الكابتن بدون حساب محاسبي");


      /* مبلغ العملية */
      const totalAmount = Number(o.total_amount);


      /* عمولة الكابتن */
      const captainCommission =
        o.commission_type === "percent"
          ? (totalAmount * o.commission_value) / 100
          : Number(o.commission_value || 0);


      /* عمولة الوكيل */
      const agentCommission =
        o.agent_comm_type === "percent"
          ? (totalAmount * o.agent_comm_value) / 100
          : Number(o.agent_comm_value || 0);


      const note = `طلب يدوي #${orderId} - ${o.customer_name}`;



      /* ============================
         1) حساب السداد
      ============================ */

      let fromAccount = null;


      /* من حساب العميل */
      if (
        o.payment_method === "wallet" &&
        o.guarantee_type === "account" &&
        o.customer_acc_id
      ){
        fromAccount = o.customer_acc_id;
      }

      /* من الوسيط */
      else {
        fromAccount = settings.customer_guarantee_account;
      }


      if (!fromAccount)
        throw new Error("حساب السداد غير معرف");



      /* ============================
         2) السداد إلى الكابتن
      ============================ */

      await insertJournal(
        conn,
        fromAccount,
        totalAmount,
        0,
        `سداد طلب - ${note}`,
        orderId,
        req
      );


      await insertJournal(
        conn,
        o.cap_acc_id,
        0,
        totalAmount,
        `استلام طلب - ${note}`,
        orderId,
        req
      );



      /* ============================
         3) عمولة الكابتن
      ============================ */

      if (captainCommission > 0){

        await insertJournal(
          conn,
          o.cap_acc_id,
          captainCommission,
          0,
          `خصم عمولة كابتن - ${note}`,
          orderId,
          req
        );


        await insertJournal(
          conn,
          settings.courier_commission_account,
          0,
          captainCommission,
          `إيراد عمولة كابتن - ${note}`,
          orderId,
          req
        );
      }



      /* ============================
         4) عمولة الوكيل
      ============================ */

      if (agentCommission > 0 && settings.commission_income_account){

        await insertJournal(
          conn,
          o.cap_acc_id,
          agentCommission,
          0,
          `خصم عمولة وكيل - ${note}`,
          orderId,
          req
        );


        await insertJournal(
          conn,
          settings.commission_income_account,
          0,
          agentCommission,
          `إيراد عمولة وكيل - ${note}`,
          orderId,
          req
        );
      }

    }


    await conn.commit();

    res.json({ success:true });


  } catch(err){

    await conn.rollback();

    console.error("❌ MANUAL STATUS ERROR:", err);

    res.status(500).json({
      success:false,
      error: err.message
    });

  } finally {

    conn.release();

  }
});


/* ==============================================
   إدخال قيد
============================================== */
async function insertJournal(
  conn,
  accId,
  debit,
  credit,
  notes,
  refId,
  req
) {

  if (!accId) {
    throw new Error("❌ حساب غير مرتبط: " + notes);
  }

  return conn.query(`
    INSERT INTO journal_entries 
    (
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
    VALUES
    (
      1,
      ?, ?, ?, ?,
      'manual_order',
      ?,
      CURDATE(),
      1,
      ?,
      ?
    )
  `, [

    accId,
    debit || 0,
    credit || 0,
    notes,
    refId,
    req.user.id,
    req.user.branch_id || 1

  ]);
}


export default router;
