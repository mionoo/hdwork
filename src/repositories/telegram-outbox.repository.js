const pool = require('../config/database');
const { randomUUID } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');

async function write(sql, params) {
  for (let attempt = 0; ; attempt++) {
    try { return await pool.query(sql, params); }
    catch (error) {
      if (error.code !== 'ER_LOCK_DEADLOCK' || attempt >= 2) throw error;
      await delay(25 * (attempt + 1) + Math.random() * 25);
    }
  }
}

async function checkSchema() { await pool.query('SELECT id, lease_token FROM telegram_outbox LIMIT 0'); }
function insertJob(query, botId, key, kind, payload, delaySeconds) {
  return query(`INSERT INTO telegram_outbox (bot_id, job_key, kind, payload, next_attempt_at)
    VALUES (?, ?, ?, ?, DATE_ADD(NOW(3), INTERVAL ? SECOND))
    ON DUPLICATE KEY UPDATE job_key = VALUES(job_key)`,
  [botId, key, kind, JSON.stringify(payload), delaySeconds]);
}

async function enqueue(botId, key, kind, payload) {
  await insertJob(write, botId, key, kind, payload, 30);
  return find(botId, key);
}

async function find(botId, key) {
  const [[job]] = await pool.query('SELECT * FROM telegram_outbox WHERE bot_id = ? AND job_key = ?', [botId, key]);
  return job;
}

async function enqueueWithOrder(connection, key, kind, payload, delaySeconds = 0) {
  const botId = process.env.TELEGRAM_BOT_TOKEN?.match(/^(\d+):/)?.[1];
  if (!botId) throw new Error('Token bot tidak valid untuk antrean pengiriman.');
  // A deadlock rolls back the entire order transaction. Let its owner handle it.
  await insertJob(connection.query.bind(connection), botId, key, kind, payload, delaySeconds);
}

async function expireInterruptedJobs(botId) {
  const [jobs] = await pool.query(`SELECT id FROM telegram_outbox
    WHERE bot_id = ? AND status = 'sending' AND lease_until < NOW(3) LIMIT 20`, [botId]);
  for (const job of jobs) {
    // Telegram may already have accepted the message. Keep it for inspection.
    await write(`UPDATE telegram_outbox SET status = 'unknown', lease_token = NULL, lease_until = NULL,
      last_error = 'Proses pengiriman terputus; periksa grup sebelum mengirim ulang.'
      WHERE id = ? AND status = 'sending' AND lease_until < NOW(3)`, [job.id]);
  }
}

async function claim(botId, id) {
  if (!id) await expireInterruptedJobs(botId);
  const ready = id ? '(next_attempt_at <= NOW(3) OR attempts = 0)' : 'next_attempt_at <= NOW(3)';
  const [[job]] = await pool.query(`SELECT * FROM telegram_outbox
    WHERE bot_id = ? AND status = 'pending' AND ${ready} ${id ? 'AND id = ?' : ''}
    ORDER BY id LIMIT 1`, id ? [botId, id] : [botId]);
  if (!job) return null;

  // Competing workers can read the same candidate. Only one can claim its current version.
  const lease = randomUUID();
  const [result] = await write(`UPDATE telegram_outbox SET status = 'sending', attempts = attempts + 1,
    lease_token = ?, lease_until = DATE_ADD(NOW(3), INTERVAL 120 SECOND)
    WHERE id = ? AND status = 'pending' AND attempts = ? AND ${ready}`,
  [lease, job.id, job.attempts]);
  if (result.affectedRows !== 1) return null;
  return { ...job, lease_token: lease, attempts: Number(job.attempts) + 1 };
}
async function renew(job) {
  const [result] = await write(`UPDATE telegram_outbox SET lease_until = DATE_ADD(NOW(3), INTERVAL 120 SECOND)
    WHERE id = ? AND lease_token = ? AND status = 'sending'`, [job.id, job.lease_token]);
  return result.affectedRows === 1;
}
async function settle(job, status, delivery, seconds = 0) {
  const [result] = await write(`UPDATE telegram_outbox SET status = ?, delivery = ?, last_error = ?,
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
module.exports = { checkSchema, enqueue, find, enqueueWithOrder, claim, renew, settle, isTargetCurrent };
