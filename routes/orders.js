import express from "express";
import db from "../db.js";
import auth from "../middlewares/auth.js";

const router = express.Router();
router.use(auth);


/* =========================
   GET /orders
========================= */
router.get("/", async (req, res) => {
  try {
    const user = req.user;

    // تحديث الاستعلام ليشمل انضمام جدول المستخدمين وجدول الأحياء
  const baseQuery = `
  SELECT 
    o.id,
    c.name AS customer_name,
    c.phone AS customer_phone,
    u.name AS user_name,
    o.status,
    o.total_amount,
    o.delivery_fee,
    o.extra_store_fee,
    o.stores_count,
    o.created_at,
    cap.name AS captain_name,
    o.payment_method,
    n.name AS neighborhood_name,
    b.name AS branch_name,         -- اسم الفرع

    CASE o.payment_method
      WHEN 'cod' THEN 'الدفع عند الاستلام'
      WHEN 'bank' THEN 'إيداع بنكي'
      WHEN 'wallet' THEN 'من الرصيد'
      WHEN 'online' THEN 'دفع إلكتروني'
      ELSE '-'
    END AS payment_method_label

  FROM orders o
  JOIN customers c ON c.id = o.customer_id
  LEFT JOIN captains cap ON cap.id = o.captain_id
  LEFT JOIN users u ON o.user_id = u.id
  LEFT JOIN customer_addresses ca ON o.address_id = ca.id 
  LEFT JOIN neighborhoods n ON ca.district = n.id
  LEFT JOIN branches b ON b.id = o.branch_id   -- ربط الفرع
`;


    let rows;
    if (user.is_admin_branch) {
      [rows] = await db.query(`${baseQuery} ORDER BY o.id DESC LIMIT 50`);
    } else {
      [rows] = await db.query(
        `${baseQuery} WHERE o.branch_id = ? ORDER BY o.id DESC LIMIT 50`,
        [user.branch_id]
      );
    }

    res.json({ success: true, orders: rows || [] });
  } catch (err) {
    console.error("GET ORDERS ERROR:", err);
    res.status(500).json({ success: false, orders: [] });
  }
});
/*============================
   POST /orders (المعدل)
=============================*/
router.post("/", async (req, res) => {
  try {
    const {
      customer_id,
      address_id,
      gps_link,
      restaurants,
      payment_method,
      bank_id,
    } = req.body;

    // إصلاح مشكلة user_id is not defined: تأكدنا من وجود كائن المستخدم
    const user = req.user || {}; 

    if (!restaurants || !restaurants.length) {
      return res.json({ success: false, message: "لا توجد مطاعم" });
    }

    const products = restaurants.flatMap((r) =>
      (r.products || []).map((p) => ({
        restaurant_id: r.restaurant_id,
        product_id: p.product_id,
        quantity: p.quantity,
      }))
    );

    if (!products.length) {
      return res.json({ success: false, message: "لا توجد منتجات" });
    }

    const storeIds = [...new Set(products.map((p) => p.restaurant_id))];
    const storesCount = storeIds.length;
    const mainRestaurantId = storeIds[0];

    const headerBranch = req.headers["x-branch-id"];
    let branchId = headerBranch ? Number(headerBranch) : user.branch_id || null;

    if (!branchId && address_id) {
      const [addrBranch] = await db.query(
        "SELECT branch_id FROM customer_addresses WHERE id=?",
        [address_id]
      );
      if (addrBranch.length && addrBranch[0].branch_id) {
        branchId = addrBranch[0].branch_id;
      }
    }

    let deliveryFee = 0;
    let extraStoreFee = 0;

    if (branchId) {
      const [settingsRows] = await db.query(
        "SELECT * FROM branch_delivery_settings WHERE branch_id=? LIMIT 1",
        [branchId]
      );

      if (settingsRows.length) {
        const settings = settingsRows[0];

        if (settings.method === "neighborhood" && address_id) {
          const [addr] = await db.query(
            "SELECT district FROM customer_addresses WHERE id=?",
            [address_id]
          );

          if (addr.length && addr[0].district) {
            // تصحيح: البحث بـ id الحي وليس name لأن الحقل يحتوي على ID
            const [n] = await db.query(
              "SELECT delivery_fee, extra_store_fee FROM neighborhoods WHERE id=?", 
              [addr[0].district]
            );

            if (n.length) {
              deliveryFee = Number(n[0].delivery_fee) || 0;
              if (storesCount > 1) {
                extraStoreFee = (storesCount - 1) * (Number(n[0].extra_store_fee) || 0);
              }
            }
          }
        }

        if (settings.method === "distance") {
          deliveryFee = Number(settings.km_price_single) || 0;
          if (storesCount > 1) {
            extraStoreFee = (storesCount - 1) * (Number(settings.km_price_multi) || 0);
          }
        }
      }
    }

    const [result] = await db.query(
      `
      INSERT INTO orders 
        (
          customer_id,
          address_id,
          restaurant_id,
          gps_link,
          stores_count,
          branch_id,
          user_id,
          delivery_fee,
          extra_store_fee,
          payment_method,
          bank_id
        )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        customer_id,
        address_id,
        mainRestaurantId,
        gps_link || null,
        storesCount,
        branchId,
        user.id || null, // استخدام الارتباط الاختياري لمنع خطأ ReferenceError
        deliveryFee,
        extraStoreFee,
        payment_method || null,
        bank_id || null,
      ]
    );

    const orderId = result.insertId;
    let total = 0;

    for (const p of products) {
      const [[prod]] = await db.query(
        "SELECT name, price FROM products WHERE id=?",
        [p.product_id]
      );

      const subtotal = prod.price * p.quantity;
      total += subtotal;

      await db.query(
        `
        INSERT INTO order_items
          (order_id, product_id, restaurant_id, name, price, quantity)
        VALUES (?, ?, ?, ?, ?, ?)
        `,
        [
          orderId,
          p.product_id,
          p.restaurant_id,
          prod.name,
          prod.price,
          p.quantity,
        ]
      );
    }

    const grandTotal = total + deliveryFee + extraStoreFee;

    await db.query(
      "UPDATE orders SET total_amount=? WHERE id=?",
      [grandTotal, orderId]
    );

    res.json({
      success: true,
      order_id: orderId,
      total: grandTotal,
    });
  } catch (err) {
    console.error("ADD ORDER ERROR:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});
/* =========================
   GET /orders/:id
========================= */
router.get("/:id", async (req, res) => {
  try {
    const orderId = req.params.id;

    const [[order]] = await db.query(
      `
      SELECT 
        o.id,
        c.name AS customer_name,
        c.phone AS customer_phone,
        a.district AS neighborhood_name,
        a.address AS customer_address,
        a.latitude,
        a.longitude,
        o.delivery_fee,
        o.extra_store_fee,
        o.total_amount,
        o.payment_method,
        o.bank_id
      FROM orders o
      JOIN customers c ON c.id = o.customer_id
      JOIN customer_addresses a ON a.id = o.address_id
      WHERE o.id=?
      `,
      [orderId]
    );

    const [items] = await db.query(
      `
      SELECT 
        oi.id,
        oi.name,
        oi.price,
        oi.quantity,
        oi.restaurant_id,
        r.name AS restaurant_name,
        r.phone AS restaurant_phone,
        r.map_url
      FROM order_items oi
      JOIN restaurants r ON r.id = oi.restaurant_id
      WHERE oi.order_id=?
      ORDER BY oi.restaurant_id
      `,
      [orderId]
    );

    const restaurants = [];
    const map = {};

    for (const it of items) {
      if (!map[it.restaurant_id]) {
        map[it.restaurant_id] = {
          id: it.restaurant_id,
          name: it.restaurant_name,
          phone: it.restaurant_phone,
          map_url: it.map_url,
          items: [],
          total: 0,
        };
        restaurants.push(map[it.restaurant_id]);
      }

      const subtotal = it.price * it.quantity;
      map[it.restaurant_id].total += subtotal;

      map[it.restaurant_id].items.push({
        id: it.id,
        name: it.name,
        price: it.price,
        quantity: it.quantity,
        subtotal,
      });
    }

    order.restaurants = restaurants;

    res.json({ success: true, order });
  } catch (err) {
    console.error("ORDER DETAILS ERROR:", err);
    res.status(500).json({ success: false });
  }
});


/* =====================================================
   PUT /orders/:id/status
   تحديث حالة الطلب وتوليد القيود المحاسبية لجميع المطاعم المشاركة
===================================================== */
router.put("/:id/status", async (req, res) => {
  const conn = await db.getConnection();
  try {
    const { status } = req.body; 
    const orderId = req.params.id;

    if (!status) return res.status(400).json({ success: false, message: "الحالة غير محددة" });

    await conn.beginTransaction();

    // 1. تحديث حالة الطلب
    await conn.query("UPDATE orders SET status=? WHERE id=?", [status, orderId]);

    // 2. توليد القيود عند الانتقال لحالة "قيد التوصيل"
    if (status === "delivering") {
      const [[settings]] = await conn.query("SELECT * FROM settings LIMIT 1");
      const [[baseCur]] = await conn.query("SELECT id FROM currencies WHERE is_local=1 LIMIT 1");
      const journalTypeId = 5; 

      // جلب بيانات الطلب العامة (العميل، الكابتن، طرق الدفع)
      const [orderRows] = await conn.query(`
        SELECT 
          o.*,
          pm.account_id AS bank_account_id,
          cap.name AS captain_name,
          cg.type AS guarantee_type, cg.account_id AS direct_acc_id,
          c_comm.agent_account_id AS cap_acc_id, 
          c_comm.commission_type AS cap_comm_type, 
          c_comm.commission_value AS cap_comm_val
        FROM orders o
        LEFT JOIN customer_guarantees cg ON cg.customer_id = o.customer_id
        LEFT JOIN payment_methods pm ON o.bank_id = pm.id
        LEFT JOIN captains cap ON cap.id = o.captain_id
        LEFT JOIN commissions c_comm ON (c_comm.account_id = o.captain_id AND c_comm.account_type = 'captain' AND c_comm.is_active = 1)
        WHERE o.id = ?
      `, [orderId]);

      const order = orderRows[0];
      if (!order) throw new Error("الطلب غير موجود");

      // تحديد الحساب المدين الرئيسي (من سيتحمل التكلفة الكلية)
      let mainDebitAccount = null;
      if (order.guarantee_type === 'account' && order.direct_acc_id) {
        mainDebitAccount = order.direct_acc_id;
      } else {
        const pMethod = String(order.payment_method).toLowerCase();
        if (pMethod === "cod") mainDebitAccount = order.cap_acc_id;
        else if (pMethod === "bank") mainDebitAccount = order.bank_account_id || 10;
        else mainDebitAccount = settings.customer_guarantee_account || 51;
      }

      // --- أ: جلب جميع المطاعم المشاركة في هذا الطلب وحساب مبالغها ---
      const [restaurantItems] = await conn.query(`
SELECT 
  oi.restaurant_id, 
  MAX(r.name) AS restaurant_name,
  MAX(r_comm.agent_account_id) AS res_acc_id, 
  MAX(r_comm.commission_type) AS res_comm_type, 
  MAX(r_comm.commission_value) AS res_comm_val,
  SUM(oi.price * oi.quantity) AS net_amount
FROM order_items oi
JOIN restaurants r ON oi.restaurant_id = r.id
LEFT JOIN commissions r_comm 
  ON (r_comm.account_id = r.agent_id 
      AND r_comm.account_type = 'agent' 
      AND r_comm.is_active = 1)
WHERE oi.order_id = ?
GROUP BY oi.restaurant_id

      `, [orderId]);

      for (const res of restaurantItems) {
        if (res.res_acc_id && res.net_amount > 0) {
          // قيد مبيعات المطعم (من حساب المديونية إلى حساب المطعم)
          await insertJournalEntry(conn, journalTypeId, orderId, baseCur.id, mainDebitAccount, res.net_amount, 0, `قيمة وجبات من ${res.restaurant_name} طلب #${orderId}`, req);
          await insertJournalEntry(conn, journalTypeId, orderId, baseCur.id, res.res_acc_id, 0, res.net_amount, `صافي مبيعات طلب #${orderId}`, req);

          // خصم عمولة المطعم لكل مطعم على حدة
          if (settings.commission_income_account && res.res_comm_val > 0) {
            let resComm = (res.res_comm_type === 'percent') ? (res.net_amount * Number(res.res_comm_val)) / 100 : Number(res.res_comm_val);
            await insertJournalEntry(conn, journalTypeId, orderId, baseCur.id, res.res_acc_id, resComm, 0, `خصم عمولة ${res.restaurant_name} طلب #${orderId}`, req);
            await insertJournalEntry(conn, journalTypeId, orderId, baseCur.id, settings.commission_income_account, 0, resComm, `إيراد عمولة مطعم #${orderId}`, req);
          }
        }
      }

      // --- ب: قيود رسوم التوصيل (تتم مرة واحدة للطلب) ---
      const deliveryTotal = Number(order.delivery_fee || 0) + Number(order.extra_store_fee || 0);
      if (deliveryTotal > 0 && order.cap_acc_id) {
        await insertJournalEntry(conn, journalTypeId, orderId, baseCur.id, mainDebitAccount, deliveryTotal, 0, `إجمالي رسوم توصيل طلب #${orderId}`, req);
        await insertJournalEntry(conn, journalTypeId, orderId, baseCur.id, order.cap_acc_id, 0, deliveryTotal, `إيراد توصيل كابتن طلب #${orderId}`, req);

        // عمولة الشركة من الكابتن
        if (settings.courier_commission_account && order.cap_comm_val > 0) {
          let capComm = (order.cap_comm_type === 'percent') ? (deliveryTotal * Number(order.cap_comm_val)) / 100 : Number(order.cap_comm_val);
          await insertJournalEntry(conn, journalTypeId, orderId, baseCur.id, order.cap_acc_id, capComm, 0, `خصم عمولة شركة من الكابتن طلب #${orderId}`, req);
          await insertJournalEntry(conn, journalTypeId, orderId, baseCur.id, settings.courier_commission_account, 0, capComm, `إيراد عمولة كابتن #${orderId}`, req);
        }
      }
    }

    await conn.commit();
    res.json({ success: true });
  } catch (err) {
    if (conn) await conn.rollback();
    console.error("FINALIZE ORDER ERROR:", err.message);
    res.status(500).json({ success: false, message: err.message });
  } finally {
    if (conn) conn.release();
  }
});
/* =====================================================
   دالة مساعدة لإدراج القيود (insertJournalEntry)
===================================================== */
async function insertJournalEntry(conn, type, refId, cur, acc, debit, credit, notes, req) {
  return conn.query(
    `INSERT INTO journal_entries 
     (journal_type_id, reference_type, reference_id, journal_date, currency_id, account_id, debit, credit, notes, created_by, branch_id)
     VALUES (?, 'order', ?, CURDATE(), ?, ?, ?, ?, ?, ?, ?)`,
    [type, refId, cur, acc, debit || 0, credit || 0, notes, req.user.id, req.user.branch_id]
  );
}
/* =========================
   POST /orders/:id/assign
========================= */
router.post("/:id/assign", async (req, res) => {
  try {
    const { captain_id } = req.body;

    await db.query(
      "UPDATE orders SET captain_id=? WHERE id=?",
      [captain_id, req.params.id]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("ASSIGN CAPTAIN ERROR:", err);
    res.status(500).json({ success: false });
  }
});

export default router;
