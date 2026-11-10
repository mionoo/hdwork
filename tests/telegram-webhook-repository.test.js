const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');

test('inbox inserts do not replace payload on duplicate; claims commit leases and all mutations fence their lease token', async () => {
  const queries = []; let commits = 0, released = 0, row = { id: 1, update_id: 7, ready: 1, attempts: 2, payload: '{}' };
  const connection = { beginTransaction: async () => {}, commit: async () => { commits++; }, rollback: async () => {}, release: () => { released++; }, query: async (sql, params) => { queries.push({ sql, params }); return sql.includes('SELECT *') ? [[row]] : [{ affectedRows: 1 }]; } };
  const pool = { getConnection: async () => connection, query: async (sql, params) => { queries.push({ sql, params }); return [{ affectedRows: 1 }]; } };
  const module = { exports: {} };
  new Function('require', 'module', fs.readFileSync(require.resolve('../src/repositories/telegram-webhook.repository'), 'utf8'))(name => name === '../config/database' ? pool : { randomUUID }, module);
  const repo = module.exports;
  await repo.enqueue('123', { update_id: 7, message: { text: 'original' } });
  assert.match(queries[0].sql, /ON DUPLICATE KEY UPDATE update_id/);
  assert.ok(!queries[0].sql.includes('UPDATE payload'));
  assert.equal(queries[0].params[0], '123');
  const job = await repo.claim('123');
  assert.equal(job.attempts, 3);
  assert.equal(commits, 1);
  assert.equal(released, 1);
  assert.ok(job.lease_token);
  const query = queries.find(q => q.sql.includes('SELECT *')).sql;
  assert.match(query, /ORDER BY update_id LIMIT 1 FOR UPDATE/);
  assert.match(query, /status <> 'done'/);
  await repo.renew(job); await repo.complete(job); await repo.retry(job, 'temporary', 2);
  for (const q of queries.slice(-3)) {
    assert.match(q.sql, /lease_token = \? AND status = 'processing'/);
    assert.ok(q.params.includes(job.lease_token));
  }
  row = { ...row, ready: 0 };
  assert.equal(await repo.claim('123'), null);
  assert.equal(released, 2);
});
