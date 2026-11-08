const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

function fixture({ active = true, albumExists = false, insertError, affectedRows = 1 } = {}) {
  const state = { queries: [], commits: 0, rollbacks: 0, released: 0 };
  const connection = {
    beginTransaction: async () => {},
    query: async (sql, params) => {
      state.queries.push({ sql, params });
      if (sql.includes('FROM telegram_groups')) return [active ? [{ id: 8 }] : []];
      if (sql.includes('SELECT id FROM orders')) return [albumExists ? [{ id: 4 }] : []];
      assert.match(sql, /INSERT INTO orders/);
      if (insertError) throw insertError;
      return [{ insertId: 42, affectedRows }];
    },
    commit: async () => { state.commits++; },
    rollback: async () => { state.rollbacks++; },
    release: () => { state.released++; },
  };
  const module = { exports: {} };
  new Function('require', 'module', fs.readFileSync(require.resolve('../src/repositories/order.repository'), 'utf8'))(
    () => ({ getConnection: async () => connection }), module,
  );
  const payload = { group: { id: 8 }, message: { chat: { id: -100 }, message_id: 7, text: '#req 123, cek' }, orderType: 'REQ', serviceNumber: '123', description: 'cek' };
  return { state, payload, run: () => module.exports.createIncomingOrder(payload) };
}

test('incoming order copies active type and points in the insert, commits before returning and reports phase timings', async () => {
  const { state, run } = fixture();
  const result = await run();
  assert.equal(result.id, 42);
  assert.equal(state.queries.length, 2);
  const insert = state.queries[1];
  assert.match(insert.sql, /ot.id, ot.point_value/);
  assert.match(insert.sql, /ot.code = \? AND ot.is_active = 1/);
  assert.equal((insert.sql.match(/\?/g) || []).length, insert.params.length);
  assert.deepEqual(insert.params.slice(-3), [8, null, 'REQ']);
  assert.equal(state.commits, 1);
  assert.equal(state.rollbacks, 0);
  assert.equal(state.released, 1);
  for (const phase of ['pool_wait_ms', 'begin_ms', 'group_lock_ms', 'insert_ms', 'commit_ms']) {
    assert.equal(typeof result.timings[phase], 'number');
  }
});

test('missing active type rolls back, duplicate messages are harmless, and transient errors remain retryable', async () => {
  const missing = fixture({ affectedRows: 0 });
  await assert.rejects(missing.run, { statusCode: 400 });
  assert.equal(missing.state.commits, 0);
  assert.equal(missing.state.rollbacks, 1);
  assert.equal(missing.state.released, 1);
  const duplicate = fixture({ insertError: Object.assign(new Error('duplicate'), { code: 'ER_DUP_ENTRY' }) });
  assert.equal(await duplicate.run(), null);
  assert.equal(duplicate.state.rollbacks, 1);
  const transient = fixture({ insertError: Object.assign(new Error('connection lost'), { code: 'ECONNRESET' }) });
  await assert.rejects(transient.run, { code: 'ECONNRESET' });
  assert.equal(transient.state.released, 1);
});

test('archived groups and existing albums create no new order', async () => {
  const inactive = fixture({ active: false });
  assert.equal(await inactive.run(), null);
  assert.equal(inactive.state.queries.length, 1);
  const album = fixture({ albumExists: true });
  album.payload.message.media_group_id = 'album';
  assert.equal(await album.run(), null);
  assert.equal(album.state.queries.length, 2);
  assert.equal(album.state.commits, 1);
});
