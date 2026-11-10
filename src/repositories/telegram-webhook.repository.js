const pool = require("../config/database");
const { randomUUID } = require("node:crypto");

async function checkSchema() {
  await pool.query("SELECT id, lease_token FROM telegram_webhook_updates LIMIT 0");
}

async function enqueue(botId, update) {
  // Autocommit must finish before the HTTP handler acknowledges this update.
  await pool.query(
    `INSERT INTO telegram_webhook_updates (bot_id, update_id, payload) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE update_id = VALUES(update_id)`,
    [botId, update.update_id, JSON.stringify(update)],
  );
}

async function claim(botId, lane) {
  // Keep data ordered without letting a failed admin command/getMe block new orders.
  const control = `(JSON_CONTAINS_PATH(payload, 'one', '$.callback_query') OR
    LOWER(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(payload, '$.message.text')), '')) REGEXP
    '^/(setgrup|help|alarmnodeb|alarmdatin|stopalarmnodeb|stopalarmdatin|alarmstatus)(@[^[:space:]]+)?([[:space:]]|$)|^/config@[^[:space:]]+([[:space:]]|$)' OR
    COALESCE(JSON_UNQUOTE(JSON_EXTRACT(payload, '$.message.chat.type')), '') NOT IN ('group', 'supergroup'))`;
  const laneFilter = lane ? ` AND (${control}) = ?` : "";
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    // Keep the oldest unfinished update first, including during retry, so replies
    // do not overtake a failed parent. A restarted worker reclaims expired leases.
    const [[row]] = await connection.query(
      `SELECT *, TIMESTAMPDIFF(MICROSECOND, received_at, NOW(3)) DIV 1000 AS inbox_wait_ms,
       (next_attempt_at <= NOW(3) AND (lease_until IS NULL OR lease_until <= NOW(3))) AS ready
       FROM telegram_webhook_updates WHERE bot_id = ? AND status <> 'done'${laneFilter}
       ORDER BY update_id LIMIT 1 FOR UPDATE`, lane ? [botId, Number(lane === 'control')] : [botId],
    );
    if (!row || Number(row.ready) !== 1) { await connection.commit(); return null; }
    const lease = randomUUID();
    await connection.query(
      `UPDATE telegram_webhook_updates SET status = 'processing', attempts = attempts + 1,
       lease_token = ?, lease_until = DATE_ADD(NOW(3), INTERVAL 120 SECOND) WHERE id = ?`, [lease, row.id],
    );
    await connection.commit();
    return { ...row, lease_token: lease, attempts: Number(row.attempts) + 1 };
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
}

async function renew(job) {
  const [result] = await pool.query(
    `UPDATE telegram_webhook_updates SET lease_until = DATE_ADD(NOW(3), INTERVAL 120 SECOND)
     WHERE id = ? AND lease_token = ? AND status = 'processing'`, [job.id, job.lease_token],
  );
  return result.affectedRows === 1;
}

async function complete(job) {
  const [result] = await pool.query(
    `UPDATE telegram_webhook_updates SET status = 'done', processed_at = NOW(3), last_error = NULL,
     lease_token = NULL, lease_until = NULL WHERE id = ? AND lease_token = ? AND status = 'processing'`, [job.id, job.lease_token],
  );
  if (result.affectedRows !== 1) throw new Error("Lease pesan webhook berubah sebelum selesai.");
}

async function retry(job, error, seconds) {
  await pool.query(
    `UPDATE telegram_webhook_updates SET status = 'pending', lease_token = NULL, lease_until = NULL,
     last_error = ?, next_attempt_at = DATE_ADD(NOW(3), INTERVAL ? SECOND)
     WHERE id = ? AND lease_token = ? AND status = 'processing'`,
    [error.slice(0, 500), seconds, job.id, job.lease_token],
  );
}
module.exports = { checkSchema, enqueue, claim, renew, complete, retry };
