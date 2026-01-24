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

    const baseQuery = `
     SELECT 
  o.id,
  c.name AS customer_name,
  c.phone AS customer_phone,
  o.status,
  o.total_amount,
  o.delivery_fee,
  o.extra_store_fee,
  o.stores_count,
  o.created_at,
  cap.name AS captain_name,
  o.payment_method,

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

    `;

    let rows;

    if (user.is_admin_branch) {
      [rows] = await db.query(`
        ${baseQuery}
        ORDER BY o.id DESC
        LIMIT 50
      `);
    } else {
      [rows] = await db.query(
        `
        ${baseQuery}
        WHERE o.branch_id = ?
        ORDER BY o.id DESC
        LIMIT 50
        `,
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
   POST /orders
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

    const user = req.user;

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
            const [n] = await db.query(
              "SELECT delivery_fee, extra_store_fee FROM neighborhoods WHERE name=?",
              [addr[0].district]
            );

            if (n.length) {
              deliveryFee = Number(n[0].delivery_fee) || 0;

              if (storesCount > 1) {
                extraStoreFee =
                  (storesCount - 1) * (Number(n[0].extra_store_fee) || 0);
              }
            }
          }
        }

        if (settings.method === "distance") {
          deliveryFee = Number(settings.km_price_single) || 0;

          if (storesCount > 1) {
            extraStoreFee =
              (storesCount - 1) * (Number(settings.km_price_multi) || 0);
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
          delivery_fee,
          extra_store_fee,
          payment_method,
          bank_id
        )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        customer_id,
        address_id,
        mainRestaurantId,
        gps_link || null,
        storesCount,
        branchId,
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
    res.status(500).json({ success: false });
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
   PUT /orders/:id/status - النسخة النهائية المضمونة
===================================================== */
router.put("/:id/status", async (req, res) => {
  const conn = await db.getConnection();
  try {
    const { status } = req.body; 
    const orderId = req.params.id;

    if (!status) return res.status(400).json({ success: false, message: "الحالة غير محددة" });

    await conn.beginTransaction();

    // 1. تحديث حالة الطلب أولاً
    await conn.query("UPDATE orders SET status=? WHERE id=?", [status, orderId]);

    // 2. القيود المحاسبية عند الانتقال لـ "قيد التوصيل"
    if (status === "delivering") {
      const [[settings]] = await conn.query("SELECT * FROM settings LIMIT 1");

      // ملاحظة: تأكد من مسميات الجداول (customers, payment_methods, restaurants, captains, commissions)
      const [orderRows] = await conn.query(`
        SELECT 
          o.*,
          pm.company AS bank_name, pm.account_id AS bank_account_id,
          r.name AS restaurant_name, cap.name AS captain_name,
          c.name AS customer_name, 
          c.account_id AS cust_personal_acc, -- حساب العميل الشخصي (للحساب المباشر)
          r_comm.agent_account_id AS res_acc_id, r_comm.commission_type AS res_comm_type, r_comm.commission_value AS res_comm_val,
          c_comm.agent_account_id AS cap_acc_id, c_comm.commission_type AS cap_comm_type, c_comm.commission_value AS cap_comm_val
        FROM orders o
        LEFT JOIN customers c ON o.customer_id = c.id
        LEFT JOIN payment_methods pm ON o.bank_id = pm.id
        LEFT JOIN restaurants r ON r.id = o.restaurant_id
        LEFT JOIN captains cap ON cap.id = o.captain_id
        LEFT JOIN commissions r_comm ON (r_comm.account_id = r.agent_id AND r_comm.account_type = 'agent' AND r_comm.is_active = 1)
        LEFT JOIN commissions c_comm ON (c_comm.account_id = o.captain_id AND c_comm.account_type = 'captain' AND c_comm.is_active = 1)
        WHERE o.id = ?
      `, [orderId]);

      const order = orderRows[0];

      if (order && order.res_acc_id) {
        const restaurantAmount = Number(order.total_amount || 0) - Number(order.delivery_fee || 0) - Number(order.extra_store_fee || 0);
        const deliveryFee = Number(order.delivery_fee || 0);
        const [[baseCur]] = await conn.query("SELECT id FROM currencies WHERE is_local=1 LIMIT 1");
        const journalTypeId = 5; 

        // --- تحديد الحساب المدين (توجيه القيد) ---
        let debitAccount = null;
        const pMethod = String(order.payment_method).toLowerCase();

        // فحص "الحساب المباشر": إذا كان العميل يملك حساباً شخصياً مربوطاً
        if (order.cust_personal_acc) {
          debitAccount = order.cust_personal_acc;
        } else {
          // الحسابات الوسيطة حسب طريقة الدفع
          if (pMethod === "cod") debitAccount = order.cap_acc_id; 
          else if (pMethod === "bank") debitAccount = order.bank_account_id || 10;
          else debitAccount = settings.customer_guarantee_account || 51;
        }

        if (debitAccount) {
          // أ: مبيعات المطعم (قيد منفصل)
          if (restaurantAmount > 0) {
            await insertJournalEntry(conn, journalTypeId, order.id, baseCur.id, debitAccount, restaurantAmount, 0, `قيمة طلب #${order.id} - ${order.restaurant_name}`, req);
            await insertJournalEntry(conn, journalTypeId, order.id, baseCur.id, order.res_acc_id, 0, restaurantAmount, `صافي مبيعات طلب #${order.id}`, req);
          }

          // ب: رسوم التوصيل (قيد منفصل)
          if (deliveryFee > 0 && order.cap_acc_id) {
            await insertJournalEntry(conn, journalTypeId, order.id, baseCur.id, debitAccount, deliveryFee, 0, `توصيل طلب #${order.id}`, req);
            await insertJournalEntry(conn, journalTypeId, order.id, baseCur.id, order.cap_acc_id, 0, deliveryFee, `إيراد توصيل كابتن: ${order.captain_name}`, req);
          }

          // ج: عمولة الوكيل (المطعم) - تعتمد "percent"
          if (settings.commission_income_account && order.res_comm_val > 0) {
            let resComm = (order.res_comm_type === 'percent' || order.res_comm_type === 'percentage') 
              ? (restaurantAmount * Number(order.res_comm_val)) / 100 : Number(order.res_comm_val);
            
            await insertJournalEntry(conn, journalTypeId, order.id, baseCur.id, order.res_acc_id, resComm, 0, `عمولة وكيل طلب #${order.id}`, req);
            await insertJournalEntry(conn, journalTypeId, order.id, baseCur.id, settings.commission_income_account, 0, resComm, `إيراد عمولة #${order.id}`, req);
          }

          // د: عمولة الكابتن
          if (settings.courier_commission_account && order.cap_comm_val > 0 && order.cap_acc_id) {
            let capComm = (order.cap_comm_type === 'percent' || order.cap_comm_type === 'percentage') 
              ? (deliveryFee * Number(order.cap_comm_val)) / 100 : Number(order.cap_comm_val);

            await insertJournalEntry(conn, journalTypeId, order.id, baseCur.id, order.cap_acc_id, capComm, 0, `عمولة شركة طلب #${order.id}`, req);
            await insertJournalEntry(conn, journalTypeId, order.id, baseCur.id, settings.courier_commission_account, 0, capComm, `إيراد عمولة كابتن #${order.id}`, req);
          }
        }
      }
    }

    await conn.commit();
    res.json({ success: true });
  } catch (err) {
    if (conn) await conn.rollback();
    console.error("Server Error:", err.message); // سيظهر لك الخطأ بالضبط في Console السيرفر
    res.status(500).json({ success: false, message: err.message });
  } finally {
    if (conn) conn.release();
  }
});
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
