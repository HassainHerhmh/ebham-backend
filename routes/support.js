import express from "express";
import db from "../db.js";
import auth from "../middlewares/auth.js";

const router = express.Router();

/* =========================================================
   Helpers
========================================================= */
function isAdmin(user) {
  if (!user) return false;
  return ["admin", "super_admin", "staff", "employee"].includes(user.role);
}

function isCustomer(user) {
  if (!user) return false;
  return user.role === "customer";
}

/* =========================================================
   CUSTOMER
   GET /support/my-chat
   جلب آخر محادثة للعميل الحالي مع الرسائل
========================================================= */
router.get("/my-chat", auth, async (req, res) => {
  try {
    if (!isCustomer(req.user)) {
      return res.status(403).json({
        success: false,
        message: "غير مصرح",
      });
    }

    const customerId = req.user.id;

    const [chatRows] = await db.query(
      `
      SELECT
        c.id,
        c.customer_id,
        c.customer_name,
        c.customer_phone,
        c.branch_id,
        c.order_id,
        c.status,
        c.last_message_at,
        c.created_at,
        c.updated_at
      FROM support_chats c
      WHERE c.customer_id = ?
      ORDER BY c.id DESC
      LIMIT 1
      `,
      [customerId]
    );

    if (!chatRows.length) {
      return res.json({
        success: true,
        chat: null,
      });
    }

    const chat = chatRows[0];

    const [messages] = await db.query(
      `
      SELECT
        id,
        chat_id,
        sender_type,
        sender_id,
        message,
        is_read,
        created_at
      FROM support_chat_messages
      WHERE chat_id = ?
      ORDER BY id ASC
      `,
      [chat.id]
    );

    // عند فتح العميل للمحادثة يتم اعتبار رسائل الأدمن كمقروءة
    await db.query(
      `
      UPDATE support_chat_messages
      SET is_read = 1
      WHERE chat_id = ?
        AND sender_type = 'admin'
        AND is_read = 0
      `,
      [chat.id]
    );

    return res.json({
      success: true,
      chat: {
        ...chat,
        messages,
      },
    });
  } catch (error) {
    console.error("GET /support/my-chat error:", error);
    return res.status(500).json({
      success: false,
      message: "حدث خطأ أثناء جلب محادثة العميل",
      error: error.message,
    });
  }
});

/* =========================================================
   CUSTOMER
   POST /support/chats
   إنشاء محادثة جديدة من تطبيق العميل
========================================================= */
router.post("/chats", auth, async (req, res) => {
  try {
    if (!isCustomer(req.user)) {
      return res.status(403).json({
        success: false,
        message: "غير مصرح",
      });
    }

    const {
      branch_id = null,
      order_id = null,
      message,
    } = req.body;

    if (!message || !String(message).trim()) {
      return res.status(400).json({
        success: false,
        message: "نص الرسالة مطلوب",
      });
    }

    const customer_id = req.user.id;
    const customer_name = req.user.name || "عميل";
    const customer_phone = req.user.phone || null;

    const [chatInsert] = await db.query(
      `
      INSERT INTO support_chats
      (
        customer_id,
        customer_name,
        customer_phone,
        branch_id,
        order_id,
        status,
        last_message_at
      )
      VALUES (?, ?, ?, ?, ?, 'pending', NOW())
      `,
      [
        customer_id,
        customer_name,
        customer_phone,
        branch_id || null,
        order_id || null,
      ]
    );

    const chatId = chatInsert.insertId;

    await db.query(
      `
      INSERT INTO support_chat_messages
      (
        chat_id,
        sender_type,
        sender_id,
        message,
        is_read
      )
      VALUES (?, 'customer', ?, ?, 0)
      `,
      [chatId, customer_id, String(message).trim()]
    );

    const [chatRows] = await db.query(
      `
      SELECT
        id,
        customer_id,
        customer_name,
        customer_phone,
        branch_id,
        order_id,
        status,
        last_message_at,
        created_at,
        updated_at
      FROM support_chats
      WHERE id = ?
      LIMIT 1
      `,
      [chatId]
    );

    return res.status(201).json({
      success: true,
      message: "تم إنشاء المحادثة بنجاح",
      chat: chatRows[0],
    });
  } catch (error) {
    console.error("POST /support/chats error:", error);
    return res.status(500).json({
      success: false,
      message: "حدث خطأ أثناء إنشاء المحادثة",
      error: error.message,
    });
  }
});

/* =========================================================
   CUSTOMER + ADMIN
   POST /support/chats/:id/messages
   إرسال رسالة داخل المحادثة
========================================================= */
router.post("/chats/:id/messages", auth, async (req, res) => {
  try {
    const chatId = Number(req.params.id);
    const { message } = req.body;

    if (!chatId) {
      return res.status(400).json({
        success: false,
        message: "رقم المحادثة غير صحيح",
      });
    }

    if (!message || !String(message).trim()) {
      return res.status(400).json({
        success: false,
        message: "الرسالة مطلوبة",
      });
    }

    const [chatRows] = await db.query(
      `
      SELECT
        id,
        customer_id,
        customer_name,
        customer_phone,
        branch_id,
        order_id,
        status,
        last_message_at,
        created_at,
        updated_at
      FROM support_chats
      WHERE id = ?
      LIMIT 1
      `,
      [chatId]
    );

    if (!chatRows.length) {
      return res.status(404).json({
        success: false,
        message: "المحادثة غير موجودة",
      });
    }

    const chat = chatRows[0];

    let senderType = "customer";
    let senderId = req.user?.id || null;

    if (isAdmin(req.user)) {
      senderType = "admin";
    } else if (isCustomer(req.user)) {
      if (Number(chat.customer_id) !== Number(req.user.id)) {
        return res.status(403).json({
          success: false,
          message: "لا يمكنك الإرسال في هذه المحادثة",
        });
      }
      senderType = "customer";
    } else {
      return res.status(403).json({
        success: false,
        message: "غير مصرح",
      });
    }

    await db.query(
      `
      INSERT INTO support_chat_messages
      (
        chat_id,
        sender_type,
        sender_id,
        message,
        is_read
      )
      VALUES (?, ?, ?, ?, ?)
      `,
      [
        chatId,
        senderType,
        senderId,
        String(message).trim(),
        senderType === "admin" ? 1 : 0,
      ]
    );

    await db.query(
      `
      UPDATE support_chats
      SET
        status = ?,
        last_message_at = NOW(),
        updated_at = NOW()
      WHERE id = ?
      `,
      [senderType === "admin" ? "open" : "pending", chatId]
    );

    const [messages] = await db.query(
      `
      SELECT
        id,
        chat_id,
        sender_type,
        sender_id,
        message,
        is_read,
        created_at
      FROM support_chat_messages
      WHERE chat_id = ?
      ORDER BY id ASC
      `,
      [chatId]
    );

    return res.json({
      success: true,
      message: "تم إرسال الرسالة",
      messages,
    });
  } catch (error) {
    console.error("POST /support/chats/:id/messages error:", error);
    return res.status(500).json({
      success: false,
      message: "حدث خطأ أثناء إرسال الرسالة",
      error: error.message,
    });
  }
});

/* =========================================================
   ADMIN
   GET /support/chats
   جلب قائمة كل المحادثات للوحة التحكم
========================================================= */
router.get("/chats", auth, async (req, res) => {
  try {
    if (!isAdmin(req.user)) {
      return res.status(403).json({
        success: false,
        message: "غير مصرح",
      });
    }

    const { status, branch_id, search } = req.query;

    let sql = `
      SELECT
        c.id,
        c.customer_id,
        c.customer_name,
        c.customer_phone,
        c.branch_id,
        c.order_id,
        c.status,
        c.last_message_at,
        c.created_at,
        c.updated_at,

        (
          SELECT COUNT(*)
          FROM support_chat_messages m_unread
          WHERE m_unread.chat_id = c.id
            AND m_unread.sender_type = 'customer'
            AND m_unread.is_read = 0
        ) AS unread_count,

        (
          SELECT m_last.message
          FROM support_chat_messages m_last
          WHERE m_last.chat_id = c.id
          ORDER BY m_last.id DESC
          LIMIT 1
        ) AS last_message
      FROM support_chats c
      WHERE 1 = 1
    `;

    const params = [];

    if (status) {
      sql += ` AND c.status = ? `;
      params.push(status);
    }

    if (branch_id) {
      sql += ` AND c.branch_id = ? `;
      params.push(branch_id);
    }

    if (search) {
      sql += `
        AND (
          c.customer_name LIKE ?
          OR c.customer_phone LIKE ?
          OR CAST(c.id AS CHAR) LIKE ?
          OR CAST(c.order_id AS CHAR) LIKE ?
        )
      `;
      params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
    }

    sql += `
      ORDER BY
        CASE
          WHEN c.last_message_at IS NULL THEN 1
          ELSE 0
        END,
        c.last_message_at DESC,
        c.id DESC
    `;

    const [rows] = await db.query(sql, params);

    return res.json({
      success: true,
      chats: rows,
    });
  } catch (error) {
    console.error("GET /support/chats error:", error);
    return res.status(500).json({
      success: false,
      message: "حدث خطأ أثناء جلب المحادثات",
      error: error.message,
    });
  }
});

/* =========================================================
   ADMIN
   GET /support/chats/:id
   جلب تفاصيل محادثة واحدة للوحة التحكم
========================================================= */
router.get("/chats/:id", auth, async (req, res) => {
  try {
    if (!isAdmin(req.user)) {
      return res.status(403).json({
        success: false,
        message: "غير مصرح",
      });
    }

    const chatId = Number(req.params.id);
    if (!chatId) {
      return res.status(400).json({
        success: false,
        message: "رقم المحادثة غير صحيح",
      });
    }

    const [chatRows] = await db.query(
      `
      SELECT
        c.id,
        c.customer_id,
        c.customer_name,
        c.customer_phone,
        c.branch_id,
        c.order_id,
        c.status,
        c.last_message_at,
        c.created_at,
        c.updated_at
      FROM support_chats c
      WHERE c.id = ?
      LIMIT 1
      `,
      [chatId]
    );

    if (!chatRows.length) {
      return res.status(404).json({
        success: false,
        message: "المحادثة غير موجودة",
      });
    }

    const chat = chatRows[0];

    const [messages] = await db.query(
      `
      SELECT
        id,
        chat_id,
        sender_type,
        sender_id,
        message,
        is_read,
        created_at
      FROM support_chat_messages
      WHERE chat_id = ?
      ORDER BY id ASC
      `,
      [chatId]
    );

    // عند فتح الأدمن للمحادثة يتم اعتبار رسائل العميل كمقروءة
    await db.query(
      `
      UPDATE support_chat_messages
      SET is_read = 1
      WHERE chat_id = ?
        AND sender_type = 'customer'
        AND is_read = 0
      `,
      [chatId]
    );

    return res.json({
      success: true,
      chat: {
        ...chat,
        messages,
      },
    });
  } catch (error) {
    console.error("GET /support/chats/:id error:", error);
    return res.status(500).json({
      success: false,
      message: "حدث خطأ أثناء جلب تفاصيل المحادثة",
      error: error.message,
    });
  }
});

/* =========================================================
   ADMIN
   PATCH /support/chats/:id/status
   تحديث حالة المحادثة
========================================================= */
router.patch("/chats/:id/status", auth, async (req, res) => {
  try {
    if (!isAdmin(req.user)) {
      return res.status(403).json({
        success: false,
        message: "غير مصرح",
      });
    }

    const chatId = Number(req.params.id);
    const { status } = req.body;

    if (!chatId) {
      return res.status(400).json({
        success: false,
        message: "رقم المحادثة غير صحيح",
      });
    }

    const allowedStatuses = ["pending", "open", "closed"];
    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: "الحالة غير صحيحة",
      });
    }

    const [result] = await db.query(
      `
      UPDATE support_chats
      SET status = ?, updated_at = NOW()
      WHERE id = ?
      `,
      [status, chatId]
    );

    if (!result.affectedRows) {
      return res.status(404).json({
        success: false,
        message: "المحادثة غير موجودة",
      });
    }

    const [rows] = await db.query(
      `
      SELECT
        id,
        customer_id,
        customer_name,
        customer_phone,
        branch_id,
        order_id,
        status,
        last_message_at,
        created_at,
        updated_at
      FROM support_chats
      WHERE id = ?
      LIMIT 1
      `,
      [chatId]
    );

    return res.json({
      success: true,
      message: "تم تحديث حالة المحادثة",
      chat: rows[0],
    });
  } catch (error) {
    console.error("PATCH /support/chats/:id/status error:", error);
    return res.status(500).json({
      success: false,
      message: "حدث خطأ أثناء تحديث الحالة",
      error: error.message,
    });
  }
});

/* =========================================================
   ADMIN
   PATCH /support/chats/:id/read
   تعليم رسائل العميل كمقروءة
========================================================= */
router.patch("/chats/:id/read", auth, async (req, res) => {
  try {
    if (!isAdmin(req.user)) {
      return res.status(403).json({
        success: false,
        message: "غير مصرح",
      });
    }

    const chatId = Number(req.params.id);

    if (!chatId) {
      return res.status(400).json({
        success: false,
        message: "رقم المحادثة غير صحيح",
      });
    }

    await db.query(
      `
      UPDATE support_chat_messages
      SET is_read = 1
      WHERE chat_id = ?
        AND sender_type = 'customer'
        AND is_read = 0
      `,
      [chatId]
    );

    return res.json({
      success: true,
      message: "تم تعليم الرسائل كمقروءة",
    });
  } catch (error) {
    console.error("PATCH /support/chats/:id/read error:", error);
    return res.status(500).json({
      success: false,
      message: "حدث خطأ أثناء تحديث حالة القراءة",
      error: error.message,
    });
  }
});

export default router;
