const pool = require("../config/database");

async function findParent({ groupId, chatId, threadId, replyId, albumId }) {
  if (!replyId && !albumId) return null;
  const [rows] = await pool.query(replyId ? `
    SELECT o.id AS order_id, ? AS reply_to_message_id
    FROM orders o WHERE o.telegram_group_id = ? AND o.telegram_chat_id = ? AND o.telegram_message_id = ?
    UNION ALL
    SELECT m.order_id, m.message_id
    FROM order_telegram_messages m JOIN orders o ON o.id = m.order_id
    WHERE o.telegram_group_id = ? AND m.chat_id = ? AND m.thread_id = ? AND m.message_id = ?
    UNION ALL
    SELECT r.order_id, r.telegram_message_id
    FROM order_results r JOIN orders o ON o.id = r.order_id
    WHERE o.telegram_group_id = ? AND r.telegram_chat_id = ?
      AND COALESCE(r.telegram_thread_id, 0) = ? AND r.telegram_message_id = ?
    UNION ALL
    SELECT p.order_id, p.telegram_message_id
    FROM order_source_photos p JOIN orders o ON o.id = p.order_id
    WHERE o.telegram_group_id = ? AND p.telegram_group_id = ? AND p.telegram_chat_id = ? AND p.telegram_message_id = ?
    LIMIT 1
  ` : `
    SELECT m.order_id, m.reply_to_message_id, m.reply_excerpt
    FROM order_telegram_messages m JOIN orders o ON o.id = m.order_id
    WHERE o.telegram_group_id = ? AND m.chat_id = ? AND m.thread_id = ?
      AND m.album_id = ? AND m.kind = 'reply'
    ORDER BY m.message_id LIMIT 1
  `, replyId ? [
    replyId, groupId, chatId, replyId,
    groupId, chatId, threadId, replyId,
    groupId, chatId, threadId, replyId,
    groupId, groupId, chatId, replyId,
  ] : [groupId, chatId, threadId, albumId]);
  return rows[0] || null;
}

async function recordReply({ parent, chatId, threadId, message, sender, content, excerpt, media }) {
  await pool.query(`
    INSERT INTO order_telegram_messages
      (order_id, chat_id, thread_id, message_id, kind, reply_to_message_id, reply_excerpt,
       sender_name, content, album_id, media_kind, file_id, file_name, mime_type, file_size, sent_at)
    VALUES (?, ?, ?, ?, 'reply', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, TIMESTAMPADD(SECOND, ?, '1970-01-01 00:00:00'))
    ON DUPLICATE KEY UPDATE id = order_telegram_messages.id
  `, [
    parent.order_id, chatId, threadId, message.message_id, parent.reply_to_message_id, excerpt,
    sender, content, message.media_group_id || null, media?.kind || null, media?.file.file_id || null,
    media?.file.file_name?.slice(0, 255) || null, media?.file.mime_type?.slice(0, 127) || null,
    media?.file.file_size ?? null, message.date,
  ]);
}

async function recordOutgoing({ orderId, chatId, threadId, messageIds, kind }) {
  if (!orderId || !messageIds.length) return;
  const values = messageIds.map(() => "(?, ?, ?, ?, ?, UTC_TIMESTAMP())").join(", ");
  await pool.query(`
    INSERT INTO order_telegram_messages (order_id, chat_id, thread_id, message_id, kind, sent_at)
    VALUES ${values}
    ON DUPLICATE KEY UPDATE id = order_telegram_messages.id
  `, messageIds.flatMap((id) => [orderId, chatId, threadId || 0, id, kind]));
}

async function list(orderId) {
  const [rows] = await pool.query(`
    SELECT id, sender_name, content, reply_excerpt, album_id, media_kind, file_name, file_size,
      DATE_FORMAT(sent_at, '%Y-%m-%dT%H:%i:%sZ') AS sent_at
    FROM order_telegram_messages
    WHERE order_id = ? AND kind = 'reply'
    ORDER BY sent_at, message_id
  `, [orderId]);
  return rows;
}

async function findMedia(orderId, messageId) {
  const [rows] = await pool.query(`
    SELECT id, media_kind, file_id, file_name, mime_type, file_size
    FROM order_telegram_messages WHERE order_id = ? AND id = ? AND kind = 'reply' AND file_id IS NOT NULL
  `, [orderId, messageId]);
  return rows[0] || null;
}

module.exports = { findParent, recordReply, recordOutgoing, list, findMedia };
