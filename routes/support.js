import express from "express";
import db from "../db.js";
import auth from "../middlewares/auth.js";
import {
  emitAdminNotification,
  resolveRequestBranchId,
  isHqAdminUser,
} from "../utils/adminRealtime.js";
import {
  generateSupportAiReply,
  insertSupportEvent,
  shouldAiReply,
} from "../utils/supportAi.js";

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

function getIO(req) {
  return req.app?.get("io") || null;
}

function emitSupportEvent(req, eventName, payload = {}) {
  const io = getIO(req);
  if (!io) return;

  const branchId =
    payload.branch_id != null
      ? payload.branch_id
      : resolveRequestBranchId(req);

  emitAdminNotification(io, {
    type: eventName,
    ...payload,
    branch_id: branchId,
  });
}

function canAccessChat(req, chat) {
  if (!chat) return false;
  if (isCustomer(req.user)) {
    return Number(chat.customer_id) === Number(req.user.id);
  }
  if (!isAdmin(req.user)) return false;
  const branchId = resolveRequestBranchId(req);
  if (!branchId) return Boolean(isHqAdminUser(req.user));
  return Number(chat.branch_id) === Number(branchId);
}

function normalizeMessageStatus(message) {
  if (message.sender_type !== "admin" && message.sender_type !== "ai") return null;
  return Number(message.is_read) === 1 ? "read" : "sent";
}

function publicChatStatus(status) {
  if (status === "pending") return "WAITING_AGENT";
  if (status === "open") return "AGENT_ACTIVE";
  if (status === "closed") return "CLOSED";
  return status || "AI_ACTIVE";
}

function needsAgentAttention(status) {
  const value = publicChatStatus(status);
  return value === "WAITING_AGENT" || value === "AGENT_ACTIVE";
}

async function insertChatMessage({
  chatId,
  senderType,
  senderId,
  message,
  isRead = 0,
}) {
  const [result] = await db.query(
    `
    INSERT INTO support_chat_messages
      (chat_id, sender_type, sender_id, message, is_read)
    VALUES (?, ?, ?, ?, ?)
    `,
    [chatId, senderType, senderId, message, isRead]
  );
  return result.insertId;
}

async function getChatById(chatId) {
  const [rows] = await db.query(
    `
    SELECT
      c.id,
      c.customer_id,
      c.customer_name,
      c.customer_phone,
      c.branch_id,
      c.order_id,
      c.status,
      c.handler_mode,
      c.assigned_agent_id,
      c.assigned_agent_name,
      c.handoff_reason,
      c.handed_off_at,
      c.agent_claimed_at,
      c.closed_at,
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
    WHERE c.id = ?
    LIMIT 1
    `,
    [chatId]
  );

  const chat = rows[0] || null;
  if (!chat) return null;
  return {
    ...chat,
    status: publicChatStatus(chat.status),
    waiting_seconds: chat.handed_off_at
      ? Math.max(
          0,
          Math.floor((Date.now() - new Date(chat.handed_off_at).getTime()) / 1000)
        )
      : 0,
  };
}

async function handleAiAfterCustomerMessage(req, chat, customerMessage) {
  if (!shouldAiReply(chat)) return null;

  const messages = await getChatMessages(chat.id);
  const history = messages.slice(-16).map((msg) => ({
    role: msg.sender_type === "customer" ? "user" : "assistant",
    content: msg.message,
  }));

  let result;
  try {
    result = await generateSupportAiReply({
      customerId: chat.customer_id,
      branchId: chat.branch_id,
      history,
    });
  } catch (error) {
    console.error("AI reply error:", error?.message || error);
    result = {
      handoff: true,
      reason: "فشل توليد رد الذكاء الاصطناعي",
      text: "أعتذر منك، يبدو أن مشكلتك تحتاج متابعة من فريق خدمة العملاء. حولت محادثتك إلى أحد الموظفين، وسيتم الرد عليك قريباً.",
    };
  }

  const aiText = String(result?.text || "").trim();
  if (aiText) {
    try {
      await insertChatMessage({
        chatId: chat.id,
        senderType: "ai",
        senderId: null,
        message: aiText,
        isRead: 0,
      });
    } catch (error) {
      console.error("AI message insert as ai failed:", error?.message || error);
      await insertChatMessage({
        chatId: chat.id,
        senderType: "admin",
        senderId: null,
        message: aiText,
        isRead: 0,
      });
    }
  }

  if (result?.handoff) {
    await db.query(
      `
      UPDATE support_chats
      SET
        status = 'WAITING_AGENT',
        handler_mode = 'HUMAN',
        handoff_reason = ?,
        handed_off_at = NOW(),
        assigned_agent_id = NULL,
        assigned_agent_name = NULL,
        last_message_at = NOW(),
        updated_at = NOW()
      WHERE id = ?
      `,
      [result.reason || customerMessage, chat.id]
    );
    await insertSupportEvent({
      chatId: chat.id,
      eventType: "handoff",
      actorType: "ai",
      details: { reason: result.reason || null },
    });
    const updated = await getChatById(chat.id);
    emitSupportEvent(req, "support_chat_handoff", {
      chat_id: chat.id,
      status: "WAITING_AGENT",
      needs_agent: true,
      customer_id: chat.customer_id,
      customer_name: chat.customer_name,
      customer_phone: chat.customer_phone,
      branch_id: chat.branch_id,
      handoff_reason: result.reason,
      last_message: customerMessage,
      waiting_seconds: updated?.waiting_seconds || 0,
      notification_title: "محادثة بانتظار موظف",
      notification_message: `العميل ${chat.customer_name} يحتاج موظفاً — محادثة #${chat.id}`,
    });
    return updated;
  }

  await db.query(
    `
    UPDATE support_chats
    SET status = 'AI_ACTIVE', handler_mode = 'AI', last_message_at = NOW(), updated_at = NOW()
    WHERE id = ?
    `,
    [chat.id]
  );
  return getChatById(chat.id);
}

async function getChatMessages(chatId) {
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

  return messages.map((msg) => ({
    ...msg,
    status: normalizeMessageStatus(msg),
  }));
}

/* =========================================================
   CUSTOMER
   GET /support/my-chat
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
    const branchId = resolveRequestBranchId(req);

    const [chatRows] = await db.query(
      branchId
        ? `
      SELECT id
      FROM support_chats
      WHERE customer_id = ?
        AND branch_id = ?
      ORDER BY id DESC
      LIMIT 1
      `
        : `
      SELECT id
      FROM support_chats
      WHERE customer_id = ?
        AND branch_id IS NULL
      ORDER BY id DESC
      LIMIT 1
      `,
      branchId ? [customerId, branchId] : [customerId]
    );

    if (!chatRows.length) {
      return res.json({
        success: true,
        chat: null,
      });
    }

    const chatId = chatRows[0].id;

    const [readResult] = await db.query(
      `
      UPDATE support_chat_messages
      SET is_read = 1
      WHERE chat_id = ?
        AND sender_type IN ('admin', 'ai')
        AND is_read = 0
      `,
      [chatId]
    );

    let chat = await getChatById(chatId);
    if (
      chat &&
      !chat.assigned_agent_id &&
      !chat.handed_off_at &&
      (chat.status === "WAITING_AGENT" || chat.status === "pending" || chat.status === "AI_ACTIVE")
    ) {
      if (chat.status !== "AI_ACTIVE") {
        await db.query(
          `
          UPDATE support_chats
          SET status = 'AI_ACTIVE', handler_mode = 'AI', updated_at = NOW()
          WHERE id = ?
          `,
          [chatId]
        );
        chat = await getChatById(chatId);
      }
    }
    const messages = await getChatMessages(chatId);

    if (readResult.affectedRows > 0) {
      emitSupportEvent(req, "support_chat_updated", {
        chat_id: chatId,
        action: "customer_read_admin_messages",
      });
    }

    return res.json({
      success: true,
      chat: {
        ...chat,
        messages,
      },
    });
  } catch (error) {
    console.error("GET /support/my-chat error:", error?.message || error);
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
    const cleanMessage = String(message).trim();
    const chatBranchId =
      Number(branch_id) || resolveRequestBranchId(req) || null;

    const [existingRows] = await db.query(
      chatBranchId
        ? `
      SELECT id FROM support_chats
      WHERE customer_id = ? AND branch_id = ? AND status <> 'closed'
      ORDER BY id DESC LIMIT 1
      `
        : `
      SELECT id FROM support_chats
      WHERE customer_id = ? AND branch_id IS NULL AND status <> 'closed'
      ORDER BY id DESC LIMIT 1
      `,
      chatBranchId ? [customer_id, chatBranchId] : [customer_id]
    );

    if (existingRows.length) {
      const existingChatId = existingRows[0].id;
      await insertChatMessage({
        chatId: existingChatId,
        senderType: "customer",
        senderId: customer_id,
        message: cleanMessage,
        isRead: 0,
      });
      let existingChat = await getChatById(existingChatId);
      if (existingChat.status === "CLOSED" || existingChat.status === "RESOLVED") {
        await db.query(
          `
          UPDATE support_chats
          SET status = 'AI_ACTIVE', handler_mode = 'AI', closed_at = NULL, updated_at = NOW()
          WHERE id = ?
          `,
          [existingChatId]
        );
        existingChat = await getChatById(existingChatId);
      }
      const afterAi = await handleAiAfterCustomerMessage(req, existingChat, cleanMessage);
      existingChat = afterAi || (await getChatById(existingChatId));
      if (needsAgentAttention(existingChat.status)) {
        emitSupportEvent(req, "support_chat_message", {
          chat_id: existingChatId,
          sender_type: "customer",
          needs_agent: true,
          customer_id,
          customer_name,
          customer_phone,
          branch_id: chatBranchId,
          order_id: order_id || null,
          message: cleanMessage,
          notification_title: "رسالة جديدة",
          notification_message: `العميل ${customer_name} أرسل لك رسالة`,
        });
      }
      return res.status(201).json({
        success: true,
        message: "تم إرسال الرسالة",
        chat: {
          ...existingChat,
          messages: await getChatMessages(existingChatId),
        },
      });
    }

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
        handler_mode,
        last_message_at
      )
      VALUES (?, ?, ?, ?, ?, 'AI_ACTIVE', 'AI', NOW())
      `,
      [
        customer_id,
        customer_name,
        customer_phone,
        chatBranchId,
        order_id || null,
      ]
    );

    const chatId = chatInsert.insertId;

    await insertChatMessage({
      chatId,
      senderType: "customer",
      senderId: customer_id,
      message: cleanMessage,
      isRead: 0,
    });

    let chat = await getChatById(chatId);
    const afterAi = await handleAiAfterCustomerMessage(req, chat, cleanMessage);
    chat = afterAi || chat;

    if (needsAgentAttention(chat.status)) {
      emitSupportEvent(req, "support_chat_created", {
        chat_id: chatId,
        sender_type: "customer",
        needs_agent: true,
        customer_id,
        customer_name,
        customer_phone,
        branch_id: chatBranchId,
        order_id: order_id || null,
        message: cleanMessage,
        notification_title: "محادثة بانتظار موظف",
        notification_message: `العميل ${customer_name} أرسل لك رسالة`,
      });
    }

    return res.status(201).json({
      success: true,
      message: "تم إنشاء المحادثة بنجاح",
      chat: {
        ...chat,
        messages: await getChatMessages(chatId),
      },
    });
  } catch (error) {
    console.error("POST /support/chats error:", error?.message || error);
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

    const chat = await getChatById(chatId);

    if (!chat) {
      return res.status(404).json({
        success: false,
        message: "المحادثة غير موجودة",
      });
    }

    if (!canAccessChat(req, chat)) {
      return res.status(403).json({
        success: false,
        message: "لا يمكنك الإرسال في هذه المحادثة",
      });
    }

    let senderType = "customer";
    let senderId = req.user?.id || null;

    if (isAdmin(req.user)) {
      senderType = "admin";
    } else if (isCustomer(req.user)) {
      senderType = "customer";
    } else {
      return res.status(403).json({
        success: false,
        message: "غير مصرح",
      });
    }

    const cleanMessage = String(message).trim();

    const messageInsertId = await insertChatMessage({
      chatId,
      senderType,
      senderId,
      message: cleanMessage,
      isRead: 0,
    });

    if (senderType === "admin") {
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
      await db.query(
        `
        UPDATE support_chats
        SET
          status = 'AGENT_ACTIVE',
          handler_mode = 'HUMAN',
          last_message_at = NOW(),
          updated_at = NOW()
        WHERE id = ?
        `,
        [chatId]
      );
    } else if (chat.status === "CLOSED" || chat.status === "RESOLVED") {
      await db.query(
        `
        UPDATE support_chats
        SET
          status = 'AI_ACTIVE',
          handler_mode = 'AI',
          closed_at = NULL,
          last_message_at = NOW(),
          updated_at = NOW()
        WHERE id = ?
        `,
        [chatId]
      );
    } else {
      await db.query(
        `
        UPDATE support_chats
        SET last_message_at = NOW(), updated_at = NOW()
        WHERE id = ?
        `,
        [chatId]
      );
    }

    let latestChat = await getChatById(chatId);
    if (senderType === "customer") {
      const afterAi = await handleAiAfterCustomerMessage(
        req,
        latestChat,
        cleanMessage
      );
      if (afterAi) latestChat = afterAi;
    }

    const messages = await getChatMessages(chatId);

    if (senderType === "admin" || needsAgentAttention(latestChat.status)) {
      emitSupportEvent(req, "support_chat_message", {
        chat_id: chatId,
        message_id: messageInsertId,
        sender_type: senderType,
        needs_agent: needsAgentAttention(latestChat.status),
        customer_id: chat.customer_id,
        customer_name: chat.customer_name,
        customer_phone: chat.customer_phone,
        branch_id: chat.branch_id,
        order_id: chat.order_id,
        message: cleanMessage,
        notification_title:
          senderType === "customer" ? "رسالة جديدة من عميل" : "رد من الإدارة",
        notification_message:
          senderType === "customer"
            ? `العميل ${chat.customer_name} أرسل لك رسالة`
            : `تم الرد على العميل ${chat.customer_name}`,
      });
    }

    return res.json({
      success: true,
      message: "تم إرسال الرسالة",
      chat: latestChat,
      messages,
    });
  } catch (error) {
    console.error("POST /support/chats/:id/messages error:", error?.message || error);
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
    const userBranchId = resolveRequestBranchId(req);
    const filterBranchId = userBranchId || (isHqAdminUser(req.user) ? (branch_id || null) : null);

    if (!userBranchId && !isHqAdminUser(req.user)) {
      return res.status(403).json({
        success: false,
        message: "غير مصرح",
      });
    }

    let sql = `
      SELECT
        c.id,
        c.customer_id,
        c.customer_name,
        c.customer_phone,
        c.branch_id,
        c.order_id,
        c.status,
        c.handler_mode,
        c.assigned_agent_id,
        c.assigned_agent_name,
        c.handoff_reason,
        c.handed_off_at,
        c.agent_claimed_at,
        c.closed_at,
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

    if (filterBranchId) {
      sql += ` AND c.branch_id = ? `;
      params.push(filterBranchId);
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
          WHEN c.status IN ('WAITING_AGENT', 'pending') THEN 0
          WHEN c.status IN ('AGENT_ACTIVE', 'open') THEN 1
          WHEN c.status = 'AI_ACTIVE' THEN 2
          ELSE 3
        END,
        CASE WHEN c.last_message_at IS NULL THEN 1 ELSE 0 END,
        c.last_message_at DESC,
        c.id DESC
    `;

    const [rows] = await db.query(sql, params);

    return res.json({
      success: true,
      chats: rows.map((row) => ({
        ...row,
        status: publicChatStatus(row.status),
        handled_by_name: row.assigned_agent_name,
        waiting_seconds: row.handed_off_at
          ? Math.max(
              0,
              Math.floor((Date.now() - new Date(row.handed_off_at).getTime()) / 1000)
            )
          : 0,
      })),
    });
  } catch (error) {
    console.error("GET /support/chats error:", error?.message || error);
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

    const chat = await getChatById(chatId);

    if (!chat) {
      return res.status(404).json({
        success: false,
        message: "المحادثة غير موجودة",
      });
    }

    if (!canAccessChat(req, chat)) {
      return res.status(403).json({
        success: false,
        message: "هذه المحادثة تتبع فرعاً آخر",
      });
    }

    const messages = await getChatMessages(chatId);

    return res.json({
      success: true,
      chat: {
        ...chat,
        messages,
      },
    });
  } catch (error) {
    console.error("GET /support/chats/:id error:", error?.message || error);
    return res.status(500).json({
      success: false,
      message: "حدث خطأ أثناء جلب تفاصيل المحادثة",
      error: error.message,
    });
  }
});

/* =========================================================
   ADMIN
   POST /support/chats/:id/claim
========================================================= */
router.post("/chats/:id/claim", auth, async (req, res) => {
  try {
    if (!isAdmin(req.user)) {
      return res.status(403).json({ success: false, message: "غير مصرح" });
    }

    const chatId = Number(req.params.id);
    if (!chatId) {
      return res.status(400).json({ success: false, message: "رقم المحادثة غير صحيح" });
    }

    const chat = await getChatById(chatId);
    if (!chat) {
      return res.status(404).json({ success: false, message: "المحادثة غير موجودة" });
    }
    if (!canAccessChat(req, chat)) {
      return res.status(403).json({ success: false, message: "هذه المحادثة تتبع فرعاً آخر" });
    }

    await db.query(
      `
      UPDATE support_chats
      SET
        status = 'AGENT_ACTIVE',
        handler_mode = 'HUMAN',
        assigned_agent_id = ?,
        assigned_agent_name = ?,
        agent_claimed_at = NOW(),
        updated_at = NOW()
      WHERE id = ?
      `,
      [req.user.id, req.user.name || "موظف", chatId]
    );

    await insertSupportEvent({
      chatId,
      eventType: "claimed",
      actorType: "admin",
      actorId: req.user.id,
      actorName: req.user.name || "موظف",
    });

    const updated = await getChatById(chatId);
    emitSupportEvent(req, "support_chat_updated", {
      chat_id: chatId,
      status: "AGENT_ACTIVE",
      action: "claimed",
      customer_name: chat.customer_name,
      customer_phone: chat.customer_phone,
      branch_id: chat.branch_id,
      assigned_agent_name: req.user.name || "موظف",
    });

    return res.json({
      success: true,
      message: "تم استلام المحادثة",
      chat: {
        ...updated,
        messages: await getChatMessages(chatId),
      },
    });
  } catch (error) {
    console.error("POST /support/chats/:id/claim error:", error?.message || error);
    return res.status(500).json({
      success: false,
      message: "حدث خطأ أثناء استلام المحادثة",
      error: error.message,
    });
  }
});

/* =========================================================
   ADMIN
   POST /support/chats/:id/release
========================================================= */
router.post("/chats/:id/release", auth, async (req, res) => {
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

    const chat = await getChatById(chatId);

    if (!chat) {
      return res.status(404).json({
        success: false,
        message: "المحادثة غير موجودة",
      });
    }

    if (!canAccessChat(req, chat)) {
      return res.status(403).json({
        success: false,
        message: "هذه المحادثة تتبع فرعاً آخر",
      });
    }

    const nextStatus =
      chat.status === "CLOSED" || chat.status === "closed" ? "CLOSED" : "WAITING_AGENT";

    await db.query(
      `
      UPDATE support_chats
      SET
        status = ?,
        handler_mode = 'HUMAN',
        assigned_agent_id = NULL,
        assigned_agent_name = NULL,
        updated_at = NOW()
      WHERE id = ?
      `,
      [nextStatus, chatId]
    );

    await insertSupportEvent({
      chatId,
      eventType: "released",
      actorType: "admin",
      actorId: req.user.id,
      actorName: req.user.name || "موظف",
    });

    emitSupportEvent(req, "support_chat_updated", {
      chat_id: chatId,
      status: nextStatus,
      action: "released",
      customer_name: chat.customer_name,
      customer_phone: chat.customer_phone,
      branch_id: chat.branch_id,
    });

    return res.json({
      success: true,
      message: "تم تحرير المحادثة",
      status: nextStatus,
    });
  } catch (error) {
    console.error("POST /support/chats/:id/release error:", error?.message || error);
    return res.status(500).json({
      success: false,
      message: "حدث خطأ أثناء تحرير المحادثة",
      error: error.message,
    });
  }
});

/* =========================================================
   ADMIN
   PATCH /support/chats/:id/status
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

    const allowedStatuses = [
      "pending",
      "open",
      "closed",
      "AI_ACTIVE",
      "WAITING_AGENT",
      "AGENT_ACTIVE",
      "RESOLVED",
      "CLOSED",
    ];
    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: "الحالة غير صحيحة",
      });
    }

    const existing = await getChatById(chatId);
    if (!existing) {
      return res.status(404).json({
        success: false,
        message: "المحادثة غير موجودة",
      });
    }
    if (!canAccessChat(req, existing)) {
      return res.status(403).json({
        success: false,
        message: "هذه المحادثة تتبع فرعاً آخر",
      });
    }

    const closedAtSql =
      status === "CLOSED" || status === "closed" || status === "RESOLVED"
        ? ", closed_at = NOW()"
        : "";
    const [result] = await db.query(
      `
      UPDATE support_chats
      SET status = ?, updated_at = NOW() ${closedAtSql}
      WHERE id = ?
      `,
      [status, chatId]
    );

    await insertSupportEvent({
      chatId,
      eventType: "status_changed",
      actorType: "admin",
      actorId: req.user.id,
      actorName: req.user.name || "موظف",
      details: { status },
    });

    if (!result.affectedRows) {
      return res.status(404).json({
        success: false,
        message: "المحادثة غير موجودة",
      });
    }

    const chat = await getChatById(chatId);

    emitSupportEvent(req, "support_chat_updated", {
      chat_id: chatId,
      status,
      action: "status_changed",
      customer_name: chat.customer_name,
      customer_phone: chat.customer_phone,
      branch_id: chat.branch_id,
    });

    return res.json({
      success: true,
      message: "تم تحديث حالة المحادثة",
      chat,
    });
  } catch (error) {
    console.error("PATCH /support/chats/:id/status error:", error?.message || error);
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

    const chat = await getChatById(chatId);

    if (!chat) {
      return res.status(404).json({
        success: false,
        message: "المحادثة غير موجودة",
      });
    }

    if (!canAccessChat(req, chat)) {
      return res.status(403).json({
        success: false,
        message: "هذه المحادثة تتبع فرعاً آخر",
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

    emitSupportEvent(req, "support_chat_updated", {
      chat_id: chatId,
      action: "marked_read",
      customer_name: chat.customer_name,
      customer_phone: chat.customer_phone,
      branch_id: chat.branch_id,
    });

    return res.json({
      success: true,
      message: "تم تعليم الرسائل كمقروءة",
    });
  } catch (error) {
    console.error("PATCH /support/chats/:id/read error:", error?.message || error);
    return res.status(500).json({
      success: false,
      message: "حدث خطأ أثناء تحديث حالة القراءة",
      error: error.message,
    });
  }
});

export default router;
