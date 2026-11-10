const pool = require('../config/database');
const { randomUUID } = require('node:crypto');

async function checkSchema() { await pool.query('SELECT id, lease_token FROM telegram_outbox LIMIT 0'); }
async function enqueue(botId, key, kind, payload) {
  await pool.query(`INSERT INTO telegram_outbox (bot_id, job_key, kind, payload, next_attempt_at)
    VALUES (?, ?, ?, ?, DATE_ADD(NOW(3), INTERVAL 30 SECOND))
    ON DUPLICATE KEY UPDATE job_key = VALUES(job_key)`, [botId, key, kind, JSON.stringify(payload)]);
  const [[job]] = await pool.query('SELECT * FROM telegram_outbox WHERE bot_id = ? AND job_key = ?', [botId, key]);
  return job;
}
async function claim(botId, id) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    // Never resend a request interrupted after sending started: Telegram may have accepted it.
    await connection.query(`UPDATE telegram_outbox SET status = 'unknown', lease_token = NULL,
      last_error = 'Proses pengiriman terputus; periksa grup sebelum mengirim ulang.'
      WHERE bot_id = ? AND status = 'sending' AND lease_until < NOW(3)`, [botId]);
    const [[job]] = await connection.query(`SELECT * FROM telegram_outbox
      WHERE bot_id = ? AND status = 'pending'
      AND (next_attempt_at <= NOW(3) ${id ? 'OR attempts = 0' : ''}) ${id ? 'AND id = ?' : ''}
      ORDER BY id LIMIT 1 FOR UPDATE`, id ? [botId, id] : [botId]);
    if (!job) { await connection.commit(); return null; }
    const lease = randomUUID();
    await connection.query(`UPDATE telegram_outbox SET status = 'sending', attempts = attempts + 1,
      lease_token = ?, lease_until = DATE_ADD(NOW(3), INTERVAL 120 SECOND) WHERE id = ?`, [lease, job.id]);
    await connection.commit();
    return { ...job, lease_token: lease, attempts: Number(job.attempts) + 1 };
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
}
async function renew(job) {
  const [result] = await pool.query(`UPDATE telegram_outbox SET lease_until = DATE_ADD(NOW(3), INTERVAL 120 SECOND)
    WHERE id = ? AND lease_token = ? AND status = 'sending'`, [job.id, job.lease_token]);
  return result.affectedRows === 1;
}
async function settle(job, status, delivery, seconds = 0) {
  const [result] = await pool.query(`UPDATE telegram_outbox SET status = ?, delivery = ?, last_error = ?,
    next_attempt_at = DATE_ADD(NOW(3), INTERVAL ? SECOND), lease_token = NULL, lease_until = NULL
    WHERE id = ? AND lease_token = ? AND status = 'sending'`,
  [status, JSON.stringify(delivery), delivery.error || null, seconds, job.id, job.lease_token]);
  if (result.affectedRows !== 1) throw new Error('Lease pengiriman Telegram tidak lagi berlaku.');
}
async function isTargetCurrent(kind, payload) {
  const claim = kind === 'claim';
  const [[row]] = await pool.query(`SELECT o.id FROM orders o
    JOIN telegram_groups g ON g.id = o.telegram_group_id
    ${claim ? '' : 'JOIN order_results r ON r.order_id = o.id AND r.id = ?'}
    WHERE o.id = ? AND g.is_active = 1 AND g.archived_at IS NULL
      AND o.telegram_chat_id = ? AND g.telegram_chat_id = o.telegram_chat_id
      AND COALESCE(g.telegram_thread_id, 0) = ?
      ${claim ? "AND o.status = 'IN_PROGRESS' AND o.performance_owner_id = ?" : ''}`,
  claim ? [payload.order_id, payload.telegram_chat_id, payload.telegram_thread_id || 0, payload.user_id]
    : [payload.result_id, payload.order_id, payload.chat_id, payload.thread_id || 0]);
  return Boolean(row);
}
module.exports = { checkSchema, enqueue, claim, renew, settle, isTargetCurrent };
