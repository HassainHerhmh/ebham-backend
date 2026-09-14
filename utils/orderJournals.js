import db from "../db.js";

const JOB_TABLE = `
CREATE TABLE IF NOT EXISTS \`journal_posting_jobs\` (
  \`id\` INT NOT NULL AUTO_INCREMENT,
  \`source_type\` VARCHAR(30) NOT NULL DEFAULT 'order',
  \`source_id\` INT NOT NULL,
  \`order_number\` VARCHAR(50) NULL,
  \`status\` VARCHAR(20) NOT NULL DEFAULT 'pending',
  \`error_code\` VARCHAR(80) NULL,
  \`error_message\` TEXT NULL,
  \`retry_count\` INT NOT NULL DEFAULT 0,
  \`posted_at\` DATETIME NULL,
  \`last_attempt_at\` DATETIME NULL,
  \`created_at\` DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
  \`updated_at\` DATETIME NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`uniq_journal_job_source\` (\`source_type\`, \`source_id\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`;

let tableReady = false;

export async function ensureJournalJobsTable() {
  if (tableReady) return;
  await db.query(JOB_TABLE);
  tableReady = true;
}

async function accountExists(conn, id) {
  if (!id) return false;
  const [[row]] = await conn.query(
    "SELECT id FROM accounts WHERE id=? LIMIT 1",
    [id]
  );
  return !!row;
}

function humanizeSqlError(err) {
  const message = String(err?.sqlMessage || err?.message || "خطأ غير معروف");
  if (/cannot be null|ER_BAD_NULL_ERROR/i.test(message)) {
    return "حساب القيد فارغ — حدّد الحساب الناقص ثم ستُعالج القيود تلقائياً";
  }
  if (/foreign key|ER_NO_REFERENCED_ROW/i.test(message)) {
    return "الحساب غير موجود في دليل الحسابات";
  }
  if (/unknown column|ER_BAD_FIELD_ERROR/i.test(message)) {
    return "عمود ناقص في قاعدة البيانات: " + message;
  }
  return message;
}

export async function upsertJournalJob({
  sourceType = "order",
  sourceId,
  orderNumber,
  status,
  errorCode = null,
  errorMessage = null,
}) {
  await ensureJournalJobsTable();
  await db.query(
    `
    INSERT INTO journal_posting_jobs
      (source_type, source_id, order_number, status, error_code, error_message, last_attempt_at, retry_count, posted_at)
    VALUES (?, ?, ?, ?, ?, ?, NOW(), 0, IF(? = 'posted', NOW(), NULL))
    ON DUPLICATE KEY UPDATE
      order_number = VALUES(order_number),
      status = VALUES(status),
      error_code = VALUES(error_code),
      error_message = VALUES(error_message),
      last_attempt_at = NOW(),
      retry_count = retry_count + 1,
      posted_at = IF(VALUES(status) = 'posted', COALESCE(posted_at, NOW()), posted_at)
    `,
    [
      sourceType,
      sourceId,
      orderNumber != null ? String(orderNumber) : null,
      status,
      errorCode,
      errorMessage,
      status,
    ]
  );
}

export async function insertJournalEntry(
  conn,
  type,
  refId,
  cur,
  acc,
  debit,
  credit,
  notes,
  req
) {
  if (!acc || !cur) {
    throw new Error("حساب القيد أو العملة غير محددين");
  }

  try {
    return await conn.query(
      `INSERT INTO journal_entries
       (journal_type_id, reference_type, reference_id, journal_date, currency_id, account_id, debit, credit, notes, created_by, branch_id)
       VALUES (?, 'order', ?, CURDATE(), ?, ?, ?, ?, ?, ?, ?)`,
      [
        type,
        refId,
        cur,
        acc,
        debit || 0,
        credit || 0,
        notes,
        req?.user?.id || null,
        req?.user?.branch_id || null,
      ]
    );
  } catch (err) {
    if (err?.code !== "ER_BAD_FIELD_ERROR") throw err;
    return conn.query(
      `INSERT INTO journal_entries
       (journal_type_id, reference_type, reference_id, journal_date, currency_id, account_id, debit, credit, notes)
       VALUES (?, 'order', ?, CURDATE(), ?, ?, ?, ?, ?)`,
      [type, refId, cur, acc, debit || 0, credit || 0, notes]
    );
  }
}

async function fetchGuarantee(conn, customerId) {
  if (!customerId) return { type: null, account_id: null };
  try {
    const [[row]] = await conn.query(
      "SELECT type, account_id FROM customer_guarantees WHERE customer_id=? LIMIT 1",
      [customerId]
    );
    return { type: row?.type || null, account_id: row?.account_id || null };
  } catch {
    return { type: null, account_id: null };
  }
}

async function prepareOrderJournalContext(conn, orderId) {
  const reasons = [];
  let errorCode = "missing_accounts";

  const [[settings]] = await conn.query("SELECT * FROM settings LIMIT 1");
  let [[baseCur]] = await conn.query(
    "SELECT id FROM currencies WHERE is_local=1 LIMIT 1"
  );
  if (!baseCur?.id) {
    [[baseCur]] = await conn.query(
      "SELECT id FROM currencies ORDER BY id ASC LIMIT 1"
    );
  }

  const [orderRows] = await conn.query(
    `
    SELECT
      o.*,
      bpa.account_id AS bank_account_id,
      cap.name AS captain_name,
      COALESCE(c_comm.agent_account_id, cap.account_id) AS cap_acc_id,
      c_comm.commission_type AS cap_comm_type,
      c_comm.commission_value AS cap_comm_val
    FROM orders o
    LEFT JOIN branch_payment_accounts bpa
      ON bpa.payment_method_id = o.bank_id
      AND bpa.branch_id = o.branch_id
    LEFT JOIN captains cap ON cap.id = o.captain_id
    LEFT JOIN commissions c_comm
      ON c_comm.account_id = o.captain_id
      AND c_comm.account_type = 'captain'
      AND c_comm.is_active = 1
    WHERE o.id = ?
    LIMIT 1
    `,
    [orderId]
  );

  const order = orderRows[0];
  if (!order) {
    return {
      ok: false,
      errorCode: "order_missing",
      reasons: ["الطلب غير موجود"],
      orderDisplayNumber: orderId,
    };
  }

  const orderDisplayNumber = order.order_number || orderId;
  const guarantee = await fetchGuarantee(conn, order.customer_id);

  if (!settings) {
    reasons.push("إعدادات الحسابات الوسيطة غير موجودة");
    errorCode = "missing_settings";
  }
  if (!baseCur?.id) {
    reasons.push("لا توجد عملة في النظام");
    errorCode = "missing_currency";
  }

  const pMethod = String(order.payment_method || "").toLowerCase();
  const isBankPayment = pMethod === "bank";
  let mainDebitAccount = null;
  if (isBankPayment) {
    mainDebitAccount = order.cap_acc_id;
  } else if (guarantee.type === "account" && guarantee.account_id) {
    mainDebitAccount = guarantee.account_id;
  } else if (pMethod === "cod") {
    mainDebitAccount = order.cap_acc_id;
  } else {
    mainDebitAccount = settings?.customer_guarantee_account || null;
  }

  if (!order.captain_id) {
    reasons.push("لم يتم تعيين كابتن للطلب");
    errorCode = "missing_captain";
  }
  if (!order.cap_acc_id) {
    reasons.push("حساب الكابتن غير محدد في عقد العمولة");
    errorCode = "missing_captain_account";
  }
  if (!(await accountExists(conn, mainDebitAccount))) {
    reasons.push("حساب تحميل القيد (المدين) غير محدد أو غير موجود");
    errorCode = "missing_debit_account";
  }

  const [restaurantItems] = await conn.query(
    `
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
      ON r_comm.account_id = r.agent_id
      AND r_comm.account_type = 'agent'
      AND r_comm.is_active = 1
    WHERE oi.order_id = ?
    GROUP BY oi.restaurant_id
    `,
    [orderId]
  );

  for (const resItem of restaurantItems) {
    if (Number(resItem.net_amount || 0) <= 0) continue;
    if (!resItem.res_acc_id) {
      reasons.push(
        `حساب المطعم غير محدد في عقد العمولة: ${resItem.restaurant_name}`
      );
      errorCode = "missing_restaurant_account";
    }
    if (
      Number(resItem.res_comm_val || 0) > 0 &&
      !settings?.commission_income_account
    ) {
      reasons.push("حساب إيراد عمولة المطاعم غير محدد في الحسابات الوسيطة");
      errorCode = "missing_commission_income_account";
    }
  }

  const deliveryTotal =
    Number(order.delivery_fee || 0) + Number(order.extra_store_fee || 0);

  if (
    deliveryTotal > 0 &&
    Number(order.cap_comm_val || 0) > 0 &&
    !settings?.courier_commission_account
  ) {
    reasons.push("حساب عمولة الكباتن غير محدد في الحسابات الوسيطة");
    errorCode = "missing_courier_commission_account";
  }

  if (Number(order.discount_amount || 0) > 0 && !settings?.coupon_discount_account) {
    reasons.push("حساب خصم الكوبون غير محدد في الحسابات الوسيطة");
    errorCode = "missing_coupon_account";
  }

  if (isBankPayment && deliveryTotal + restaurantItems.reduce((s, i) => s + Number(i.net_amount || 0), 0) > 0) {
    if (!order.bank_account_id) {
      reasons.push("حساب البنك غير مرتبط بطريقة الدفع");
      errorCode = "missing_bank_account";
    }
  }

  const uniqueReasons = [...new Set(reasons)];
  return {
    ok: uniqueReasons.length === 0,
    errorCode: uniqueReasons.length ? errorCode : null,
    reasons: uniqueReasons,
    settings,
    baseCur,
    order,
    orderDisplayNumber,
    isBankPayment,
    mainDebitAccount,
    restaurantItems,
    deliveryTotal,
    journalTypeId: 5,
  };
}

async function writeOrderJournals(conn, ctx, req) {
  const {
    settings,
    baseCur,
    order,
    orderId,
    orderDisplayNumber,
    isBankPayment,
    mainDebitAccount,
    restaurantItems,
    deliveryTotal,
    journalTypeId,
  } = ctx;
  const id = orderId || order.id;

  if (order.discount_amount > 0 && settings.coupon_discount_account) {
    const discount = Number(order.discount_amount);
    await insertJournalEntry(
      conn,
      journalTypeId,
      id,
      baseCur.id,
      settings.coupon_discount_account,
      discount,
      0,
      `دعم كوبون طلب #${orderDisplayNumber}`,
      req
    );
    await insertJournalEntry(
      conn,
      journalTypeId,
      id,
      baseCur.id,
      order.cap_acc_id,
      0,
      discount,
      `تعويض خصم الكوبون للكابتن #${orderDisplayNumber}`,
      req
    );
  }

  const restaurantTotal = restaurantItems.reduce(
    (sum, item) => sum + Number(item.net_amount || 0),
    0
  );

  for (const resItem of restaurantItems) {
    if (!resItem.res_acc_id || resItem.net_amount <= 0) continue;
    let discountText = "";
    const [original] = await conn.query(
      `SELECT SUM(p.price * oi.quantity) AS original_total
       FROM order_items oi
       JOIN products p ON p.id = oi.product_id
       WHERE oi.order_id=? AND oi.restaurant_id=?`,
      [id, resItem.restaurant_id]
    );
    const originalTotal = Number(original[0]?.original_total || 0);
    if (originalTotal > resItem.net_amount) {
      const diff = originalTotal - resItem.net_amount;
      const percent = Math.round((diff / originalTotal) * 100);
      discountText = ` عرض خصم ${percent}%`;
    }

    await insertJournalEntry(
      conn,
      journalTypeId,
      id,
      baseCur.id,
      mainDebitAccount,
      resItem.net_amount,
      0,
      `قيمة وجبات من ${resItem.restaurant_name} طلب #${orderDisplayNumber}${discountText}`,
      req
    );
    await insertJournalEntry(
      conn,
      journalTypeId,
      id,
      baseCur.id,
      resItem.res_acc_id,
      0,
      resItem.net_amount,
      `صافي مبيعات طلب #${orderDisplayNumber}${discountText}`,
      req
    );

    if (settings.commission_income_account && resItem.res_comm_val > 0) {
      const resComm =
        resItem.res_comm_type === "percent"
          ? (resItem.net_amount * Number(resItem.res_comm_val)) / 100
          : Number(resItem.res_comm_val);
      await insertJournalEntry(
        conn,
        journalTypeId,
        id,
        baseCur.id,
        resItem.res_acc_id,
        resComm,
        0,
        `خصم عمولة ${resItem.restaurant_name} طلب #${orderDisplayNumber}`,
        req
      );
      await insertJournalEntry(
        conn,
        journalTypeId,
        id,
        baseCur.id,
        settings.commission_income_account,
        0,
        resComm,
        `إيراد عمولة مطعم #${orderDisplayNumber}`,
        req
      );
    }
  }

  if (deliveryTotal > 0 && mainDebitAccount) {
    await insertJournalEntry(
      conn,
      journalTypeId,
      id,
      baseCur.id,
      mainDebitAccount,
      deliveryTotal,
      0,
      `رسوم توصيل طلب #${orderDisplayNumber}`,
      req
    );
    await insertJournalEntry(
      conn,
      journalTypeId,
      id,
      baseCur.id,
      order.cap_acc_id,
      0,
      deliveryTotal,
      `إيراد توصيل للكابتن طلب #${orderDisplayNumber}`,
      req
    );
  }

  if (
    deliveryTotal > 0 &&
    order.cap_comm_val > 0 &&
    order.cap_acc_id &&
    settings.courier_commission_account
  ) {
    const captainCommission =
      order.cap_comm_type === "percent"
        ? (deliveryTotal * Number(order.cap_comm_val)) / 100
        : Number(order.cap_comm_val);
    await insertJournalEntry(
      conn,
      journalTypeId,
      id,
      baseCur.id,
      order.cap_acc_id,
      captainCommission,
      0,
      `خصم عمولة الكابتن طلب #${orderDisplayNumber}`,
      req
    );
    await insertJournalEntry(
      conn,
      journalTypeId,
      id,
      baseCur.id,
      settings.courier_commission_account,
      0,
      captainCommission,
      `وسيط عمولات الكباتن طلب #${orderDisplayNumber}`,
      req
    );
  }

  if (isBankPayment && order.bank_account_id && order.cap_acc_id) {
    const bankCompensationTotal = restaurantTotal + deliveryTotal;
    if (bankCompensationTotal > 0) {
      await insertJournalEntry(
        conn,
        journalTypeId,
        id,
        baseCur.id,
        order.bank_account_id,
        bankCompensationTotal,
        0,
        `تعويض الكابتن من البنك عن فاتورة المطعم والرسوم طلب #${orderDisplayNumber}`,
        req
      );
      await insertJournalEntry(
        conn,
        journalTypeId,
        id,
        baseCur.id,
        order.cap_acc_id,
        0,
        bankCompensationTotal,
        `تعويض البنك للكابتن طلب #${orderDisplayNumber}`,
        req
      );
    }
  }
}

async function ensureBankCaptainCompensationEntry(conn, orderId, req) {
  const [[order]] = await conn.query(
    `SELECT
      o.id,
      COALESCE(o.order_number, o.id) AS order_number,
      o.payment_method,
      o.delivery_fee,
      o.extra_store_fee,
      bpa.account_id AS bank_account_id,
      COALESCE(c_comm.agent_account_id, cap.account_id) AS cap_acc_id
    FROM orders o
    LEFT JOIN branch_payment_accounts bpa
      ON bpa.payment_method_id = o.bank_id
      AND bpa.branch_id = o.branch_id
    LEFT JOIN captains cap ON cap.id = o.captain_id
    LEFT JOIN commissions c_comm
      ON c_comm.account_id = o.captain_id
      AND c_comm.account_type = 'captain'
      AND c_comm.is_active = 1
    WHERE o.id = ?
    LIMIT 1`,
    [orderId]
  );

  if (!order || String(order.payment_method || "").toLowerCase() !== "bank") return;
  if (!order.bank_account_id || !order.cap_acc_id) return;

  const [[totals]] = await conn.query(
    `SELECT COALESCE(SUM(price * quantity), 0) AS restaurant_total
     FROM order_items WHERE order_id = ?`,
    [orderId]
  );

  const compensationTotal =
    Number(totals?.restaurant_total || 0) +
    Number(order.delivery_fee || 0) +
    Number(order.extra_store_fee || 0);
  if (compensationTotal <= 0) return;

  const [[existing]] = await conn.query(
    `SELECT COUNT(*) AS count
     FROM journal_entries
     WHERE reference_type = 'order'
       AND reference_id = ?
       AND (
         (account_id = ? AND ABS(debit - ?) < 0.01)
         OR
         (account_id = ? AND ABS(credit - ?) < 0.01)
       )`,
    [
      orderId,
      order.bank_account_id,
      compensationTotal,
      order.cap_acc_id,
      compensationTotal,
    ]
  );
  if (Number(existing?.count || 0) >= 2) return;

  let [[baseCur]] = await conn.query(
    "SELECT id FROM currencies WHERE is_local=1 LIMIT 1"
  );
  if (!baseCur?.id) {
    [[baseCur]] = await conn.query(
      "SELECT id FROM currencies ORDER BY id ASC LIMIT 1"
    );
  }
  if (!baseCur?.id) return;

  const orderDisplayNumber = order.order_number || orderId;
  await insertJournalEntry(
    conn,
    5,
    orderId,
    baseCur.id,
    order.bank_account_id,
    compensationTotal,
    0,
    `تعويض الكابتن من البنك عن فاتورة المطعم والرسوم طلب #${orderDisplayNumber}`,
    req
  );
  await insertJournalEntry(
    conn,
    5,
    orderId,
    baseCur.id,
    order.cap_acc_id,
    0,
    compensationTotal,
    `تعويض البنك للكابتن طلب #${orderDisplayNumber}`,
    req
  );
}

export async function postDeliveringJournals(conn, orderId, req) {
  const [[meta]] = await conn.query(
    "SELECT COALESCE(order_number, id) AS order_number FROM orders WHERE id=? LIMIT 1",
    [orderId]
  );
  const orderNumber = meta?.order_number || orderId;

  try {
    await conn.query("SAVEPOINT delivering_journals");

    const [[existsEntry]] = await conn.query(
      `SELECT id FROM journal_entries
       WHERE reference_type='order' AND reference_id=? LIMIT 1`,
      [orderId]
    );

    if (existsEntry) {
      await conn.query("RELEASE SAVEPOINT delivering_journals");
      return {
        ok: true,
        alreadyPosted: true,
        reasons: [],
        orderNumber,
      };
    }

    const prepared = await prepareOrderJournalContext(conn, orderId);
    prepared.orderId = Number(orderId);
    if (!prepared.ok) {
      await conn.query("ROLLBACK TO SAVEPOINT delivering_journals");
      return { ...prepared, orderNumber: prepared.orderDisplayNumber || orderNumber };
    }

    await writeOrderJournals(conn, prepared, req);
    await ensureBankCaptainCompensationEntry(conn, orderId, req);
    await conn.query("RELEASE SAVEPOINT delivering_journals");
    return {
      ok: true,
      alreadyPosted: false,
      reasons: [],
      orderNumber: prepared.orderDisplayNumber || orderNumber,
    };
  } catch (err) {
    try {
      await conn.query("ROLLBACK TO SAVEPOINT delivering_journals");
    } catch {
      // ignore
    }
    return {
      ok: false,
      errorCode: "sql_error",
      reasons: [humanizeSqlError(err)],
      orderNumber,
    };
  }
}

async function enqueueMissingOrderJobs() {
  await ensureJournalJobsTable();

  await db.query(`
    UPDATE journal_posting_jobs j
    INNER JOIN journal_entries je
      ON je.reference_type = 'order' AND je.reference_id = j.source_id
    SET j.status = 'posted',
        j.error_code = NULL,
        j.error_message = NULL,
        j.posted_at = COALESCE(j.posted_at, NOW())
    WHERE j.source_type = 'order'
      AND j.status IN ('pending', 'failed')
  `);

  await db.query(`
    UPDATE journal_posting_jobs j
    LEFT JOIN journal_entries je
      ON je.reference_type = 'order' AND je.reference_id = j.source_id
    SET j.status = 'pending',
        j.error_message = COALESCE(j.error_message, 'لم تُرحّل قيود الطلب بعد')
    WHERE j.source_type = 'order'
      AND j.status = 'posted'
      AND je.id IS NULL
  `);

  await db.query(`
    INSERT IGNORE INTO journal_posting_jobs
      (source_type, source_id, order_number, status, error_code, error_message, last_attempt_at)
    SELECT
      'order',
      o.id,
      COALESCE(o.order_number, o.id),
      'pending',
      'not_posted',
      'لم تُرحّل قيود الطلب بعد',
      NOW()
    FROM orders o
    LEFT JOIN journal_entries je
      ON je.reference_type = 'order' AND je.reference_id = o.id
    LEFT JOIN journal_posting_jobs j
      ON j.source_type = 'order' AND j.source_id = o.id
    WHERE o.status IN ('delivering', 'completed')
      AND je.id IS NULL
      AND j.id IS NULL
  `);
}

export async function processOpenJournalJobs(req) {
  await enqueueMissingOrderJobs();

  const [jobs] = await db.query(
    `SELECT * FROM journal_posting_jobs
     WHERE status IN ('pending', 'failed')
     ORDER BY id ASC
     LIMIT 80`
  );

  let posted = 0;
  let failed = 0;

  for (const job of jobs) {
    if (job.source_type !== "order") continue;

    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      const result = await postDeliveringJournals(conn, job.source_id, req);
      await conn.commit();
      await upsertJournalJob({
        sourceType: job.source_type,
        sourceId: job.source_id,
        orderNumber: result.orderNumber || job.order_number,
        status: result.ok ? "posted" : "failed",
        errorCode: result.errorCode || null,
        errorMessage: result.ok ? null : (result.reasons || []).join(" — "),
      });
      if (result.ok) posted += 1;
      else failed += 1;
    } catch (err) {
      try {
        await conn.rollback();
      } catch {
        // ignore
      }
      await upsertJournalJob({
        sourceType: job.source_type,
        sourceId: job.source_id,
        orderNumber: job.order_number,
        status: "failed",
        errorCode: "sql_error",
        errorMessage: humanizeSqlError(err),
      });
      failed += 1;
    } finally {
      conn.release();
    }
  }

  return { posted, failed };
}

export async function listJournalJobs() {
  await enqueueMissingOrderJobs();
  const [rows] = await db.query(
    `SELECT *
     FROM journal_posting_jobs
     ORDER BY FIELD(status, 'failed', 'pending', 'posted'), updated_at DESC, id DESC
     LIMIT 200`
  );
  const [[counts]] = await db.query(
    `SELECT
       SUM(status = 'failed') AS failed,
       SUM(status = 'pending') AS pending,
       SUM(status = 'posted') AS posted
     FROM journal_posting_jobs`
  );
  return {
    list: rows,
    counts: {
      failed: Number(counts?.failed || 0),
      pending: Number(counts?.pending || 0),
      posted: Number(counts?.posted || 0),
    },
  };
}
