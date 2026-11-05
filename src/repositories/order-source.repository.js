const pool = require("../config/database");

async function record(group, message) {
  const photo = message.photo?.at(-1);
  if (!photo) return;
  await pool.query(
    `INSERT INTO order_source_photos
     (telegram_group_id, telegram_chat_id, telegram_message_id, media_group_id, file_id)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE file_id = VALUES(file_id)`,
    [group.id, message.chat.id, message.message_id, message.media_group_id || null, photo.file_id],
  );
}

async function link(group, message) {
  const album = message.media_group_id || null;
  const [[order]] = await pool.query(
    `SELECT id FROM orders WHERE telegram_group_id = ? AND telegram_chat_id = ?
       AND ${album ? "telegram_media_group_id" : "telegram_message_id"} = ? LIMIT 1`,
    [group.id, message.chat.id, album || message.message_id],
  );
  if (!order) return null;
  await pool.query(
    `UPDATE order_source_photos SET order_id = ?
     WHERE telegram_group_id = ? AND telegram_chat_id = ?
       AND ${album ? "media_group_id" : "telegram_message_id"} = ? AND order_id IS NULL`,
    [order.id, group.id, message.chat.id, album || message.message_id],
  );
  return order.id;
}

async function list(orderId) {
  // Recover a committed order whose worker stopped before linking the photos.
  await pool.query(
    `UPDATE order_source_photos p JOIN orders o
       ON o.telegram_group_id = p.telegram_group_id AND o.telegram_chat_id = p.telegram_chat_id
       AND ((o.telegram_media_group_id IS NOT NULL AND o.telegram_media_group_id = p.media_group_id)
         OR (o.telegram_media_group_id IS NULL AND o.telegram_message_id = p.telegram_message_id))
     SET p.order_id = o.id WHERE o.id = ? AND p.order_id IS NULL`, [orderId],
  );
  const [rows] = await pool.query(
    "SELECT id FROM order_source_photos WHERE order_id = ? ORDER BY telegram_message_id, id", [orderId],
  );
  return rows.map(({ id }) => ({ id: Number(id) }));
}

async function find(orderId, photoId) {
  const [[photo]] = await pool.query(
    "SELECT id, file_id FROM order_source_photos WHERE order_id = ? AND id = ?", [orderId, photoId],
  );
  return photo;
}

async function pending(orderId) {
  const [rows] = await pool.query("SELECT id, file_id FROM order_source_photos WHERE order_id = ?", [orderId]);
  return rows;
}

module.exports = { record, link, list, find, pending };
