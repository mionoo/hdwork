const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { randomUUID, randomBytes } = require('node:crypto');
const { setTimeout: sleep } = require('node:timers/promises');
const mysql = require('mysql2/promise');
const { createOutbox } = require('../src/services/telegram-outbox.service');

const socketPath = process.env.HDWORK_RECONCILE_MYSQL_SOCKET;
test('outbox migration, retry after restart, duplicate fencing and ambiguous delivery on real MySQL', { skip: !socketPath, timeout: 15000 }, async t => {
  assert.ok(socketPath.startsWith('/tmp/hdwork-reconcile-mysql.'));
  const admin = await mysql.createConnection({ socketPath, user: 'root' });
  const schema = 'hdwork_outbox_test_' + randomBytes(6).toString('hex');
  let pool, recovery;
  t.after(async () => {
    await recovery?.stop();
    if (pool) await pool.end();
    await admin.query(`DROP DATABASE IF EXISTS \`${schema}\``);
    await admin.end();
  });
  await admin.query(`CREATE DATABASE \`${schema}\``);
  pool = mysql.createPool({ socketPath, user: 'root', database: schema, connectionLimit: 4 });
  const migration = fs.readFileSync(require.resolve('../database/migrations/20261111_telegram_outbox.sql'), 'utf8');
  await pool.query(migration);
  await pool.query(migration);
  await pool.query(`CREATE TABLE telegram_groups (id BIGINT PRIMARY KEY, is_active BOOL, archived_at DATETIME,
    telegram_chat_id BIGINT, telegram_thread_id BIGINT)`);
  await pool.query(`CREATE TABLE orders (id BIGINT PRIMARY KEY, telegram_group_id BIGINT,
    telegram_chat_id BIGINT, status VARCHAR(20), performance_owner_id BIGINT)`);
  await pool.query(`CREATE TABLE order_results (id BIGINT PRIMARY KEY, order_id BIGINT)`);
  await pool.query('INSERT INTO telegram_groups VALUES (1, 1, NULL, -100, 7)');
  await pool.query("INSERT INTO orders VALUES (42, 1, -100, 'IN_PROGRESS', 18)");
  await pool.query('INSERT INTO order_results VALUES (2, 42), (3, 42), (4, 42)');
  const loaded = { exports: {} };
  new Function('require', 'module', 'process', fs.readFileSync(require.resolve('../src/repositories/telegram-outbox.repository'), 'utf8'))(
    name => name === '../config/database' ? pool : name === 'node:crypto' ? { randomUUID } : require(name), loaded, { env: { TELEGRAM_BOT_TOKEN: '123:test' } });
  const repo = loaded.exports;
  const botId = '123';
  const payload = { order_id: 42, result_id: 2, chat_id: -100, thread_id: 7, content: 'Hasil' };
  const log = { warn() {}, error() {} };
  let attempts = 0;
  const outbox = createOutbox({ repo, botId, log, send: async () => {
    attempts++;
    return { delivered: false, error: 'TLS belum tersambung', retry_safe: true, retry_after: 30 };
  } });
  const transaction = await pool.getConnection();
  try {
    await transaction.beginTransaction();
    await repo.enqueueWithOrder(transaction, 'result:2', 'result', payload, 30);
    await transaction.rollback();
    assert.equal(await repo.find(botId, 'result:2'), undefined);
    await transaction.beginTransaction();
    await repo.enqueueWithOrder(transaction, 'result:2', 'result', payload, 30);
    await transaction.commit();
  } finally { transaction.release(); }
  const first = await outbox.deliver('result:2', 'result', payload);
  assert.equal(first.delivery_status, 'pending');
  assert.equal(attempts, 1);
  assert.equal(await repo.claim(botId), null, 'backoff holds the job');
  await outbox.deliver('result:2', 'result', { ...payload, content: 'Duplikat' });
  assert.equal(attempts, 1);
  await pool.query('UPDATE telegram_outbox SET next_attempt_at = NOW(3) WHERE id = ?', [first.outbox_id]);
  recovery = createOutbox({ repo, botId, log, send: async (kind, message) => {
    assert.equal(kind, 'result');
    assert.equal(message.content, 'Hasil', 'the original payload is kept');
    attempts++;
    return { delivered: true, message_id: 77 };
  } });
  await recovery.start();
  let row;
  for (let i = 0; i < 100; i++) {
    [[row]] = await pool.query('SELECT status, attempts FROM telegram_outbox WHERE id = ?', [first.outbox_id]);
    if (row.status === 'sent') break;
    await sleep(20);
  }
  assert.equal(row.status, 'sent');
  assert.equal(row.attempts, 2);
  assert.equal(attempts, 2);
  await recovery.stop();
  const duplicate = await outbox.deliver('result:2', 'result', payload);
  assert.equal(duplicate.message_id, 77);
  assert.equal(attempts, 2);
  const uncertain = createOutbox({ repo, botId, log, send: async () => { throw new Error('connection reset after upload'); } });
  assert.equal((await uncertain.deliver('result:3', 'result', { ...payload, result_id: 3 })).delivery_status, 'unknown');
  assert.equal(await repo.claim(botId), null, 'ambiguous delivery is never retried');
  const interrupted = await repo.enqueue(botId, 'result:4', 'result', { ...payload, result_id: 4 });
  const contenders = await Promise.all(Array.from({ length: 4 }, () => repo.claim(botId, interrupted.id)));
  assert.equal(contenders.filter(Boolean).length, 1);
  const lease = contenders.find(Boolean);
  await pool.query('UPDATE telegram_outbox SET lease_until = DATE_SUB(NOW(3), INTERVAL 1 SECOND) WHERE id = ?', [lease.id]);
  assert.equal(await repo.claim(botId), null);
  await assert.rejects(repo.settle(lease, 'sent', { delivered: true }), /Lease/);
  const [[expired]] = await pool.query('SELECT status FROM telegram_outbox WHERE id = ?', [lease.id]);
  assert.equal(expired.status, 'unknown');
  await pool.query("UPDATE orders SET status = 'DONE' WHERE id = 42");
  const oldClaim = await outbox.deliver('claim:42', 'claim', { order_id: 42, user_id: 18, telegram_chat_id: -100, telegram_thread_id: 7 });
  assert.equal(oldClaim.delivery_status, 'failed');
  assert.equal(attempts, 2, 'old claim does not notify after completion');
});
