import db from "../db.js";
import { emitAdminNotification } from "./adminRealtime.js";
import {
  AI_RESUME_TEXT,
  insertSupportEvent,
} from "./supportAi.js";

async function insertResumeMessage(chatId) {
  const [lastRows] = await db.query(
    `
    SELECT message, sender_type
    FROM support_chat_messages
    WHERE chat_id = ?
    ORDER BY id DESC
    LIMIT 1
    `,
    [chatId]
  );
  if (lastRows[0]?.message === AI_RESUME_TEXT) return;

  try {
    await db.query(
      `
      INSERT INTO support_chat_messages
        (chat_id, sender_type, sender_id, message, is_read)
      VALUES (?, 'ai', NULL, ?, 0)
      `,
      [chatId, AI_RESUME_TEXT]
    );
  } catch (error) {
    console.error("AI resume message insert failed:", error?.message || error);
    await db.query(
      `
      INSERT INTO support_chat_messages
        (chat_id, sender_type, sender_id, message, is_read)
      VALUES (?, 'admin', NULL, ?, 0)
      `,
      [chatId, AI_RESUME_TEXT]
    );
  }
}

export async function endHumanSession({
  chatId,
  io = null,
  actorType = "system",
  actorId = null,
  actorName = null,
  eventType = "end_human",
}) {
  const [rows] = await db.query(
    `
    SELECT id, customer_name, customer_phone, branch_id, status
    FROM support_chats
    WHERE id = ?
    LIMIT 1
    `,
    [chatId]
  );
  const chat = rows[0];
  if (!chat) return null;

  await db.query(
    `
    UPDATE support_chats
    SET
      status = 'AI_ACTIVE',
      handler_mode = 'AI',
      assigned_agent_id = NULL,
      assigned_agent_name = NULL,
      agent_claimed_at = NULL,
      handed_off_at = NULL,
      handoff_reason = NULL,
      closed_at = NULL,
      last_message_at = NOW(),
      updated_at = NOW()
    WHERE id = ?
    `,
    [chatId]
  );

  await insertResumeMessage(chatId);
  await insertSupportEvent({
    chatId,
    eventType,
    actorType,
    actorId,
    actorName,
  });

  if (io) {
    emitAdminNotification(io, {
      type: "support_chat_updated",
      chat_id: chatId,
      status: "AI_ACTIVE",
      action: eventType,
      customer_name: chat.customer_name,
      customer_phone: chat.customer_phone,
      branch_id: chat.branch_id,
    });
  }

  return chat;
}

export async function expireIdleHumanChats(io = null, onlyChatId = null) {
  try {
  const minutesValue = Number(process.env.SUPPORT_HUMAN_IDLE_MINUTES || 40);
  const minutes =
    Number.isFinite(minutesValue) && minutesValue > 0 ? minutesValue : 40;

  const params = [];
  let chatFilter = "";
  if (onlyChatId) {
    chatFilter = " AND c.id = ? ";
    params.push(onlyChatId);
  }
  params.push(minutes);

  const [rows] = await db.query(
    `
    SELECT c.id
    FROM support_chats c
    WHERE c.status NOT IN ('CLOSED', 'closed', 'AI_ACTIVE')
      AND (
        c.status IN ('AGENT_ACTIVE', 'open')
        OR c.agent_claimed_at IS NOT NULL
      )
      ${chatFilter}
      AND TIMESTAMPDIFF(
        MINUTE,
        GREATEST(
          COALESCE(c.agent_claimed_at, c.updated_at),
          COALESCE((
            SELECT MAX(m.created_at)
            FROM support_chat_messages m
            WHERE m.chat_id = c.id
              AND m.sender_type = 'admin'
          ), c.agent_claimed_at, c.updated_at)
        ),
        NOW()
      ) >= ?
    `,
    params
  );

  for (const row of rows) {
    await endHumanSession({
      chatId: row.id,
      io,
      actorType: "system",
      actorName: "timeout",
      eventType: "human_idle_timeout",
    });
  }

  return rows.length;
  } catch (error) {
    console.error("expireIdleHumanChats:", error?.message || error);
    return 0;
  }
}
