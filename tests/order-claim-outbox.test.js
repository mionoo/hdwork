const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('claim commits with its Telegram job or rolls back if enqueue fails', async () => {
  for (const enqueueFails of [false, true]) {
    const events = [];
    const connection = {
      beginTransaction: async () => events.push('begin'),
      commit: async () => events.push('commit'),
      rollback: async () => events.push('rollback'),
      release: () => events.push('release'),
      query: async sql => {
        if (sql.includes('FROM orders o')) return [[{
          status: 'WAITING', city_id: 1, segment_id: 2,
          telegram_chat_id: -123, telegram_message_id: 9, telegram_thread_id: 7,
        }]];
        if (sql.includes('FROM users')) return [[{ role: 'HD', city_id: 1, is_active: 1, name: 'HD' }]];
        if (sql.includes('FROM user_segments')) return [[{ allowed: 1 }]];
        if (sql.includes('COUNT(*)')) return [[{ total_active: 0 }]];
        if (sql.includes('UPDATE orders')) events.push('update');
        return [{ affectedRows: 1 }];
      },
    };
    const deps = {
      '../config/database': { getConnection: async () => connection },
      '../config/telegram': require('../src/config/telegram'),
      './telegram-outbox.repository': { enqueueWithOrder: async (db, key, kind, payload) => {
        assert.equal(db, connection);
        assert.equal(key, 'claim:42');
        assert.equal(kind, 'claim');
        assert.equal(payload.telegram_message_id, 9);
        events.push('enqueue');
        if (enqueueFails) throw new Error('outbox write failed');
      } },
    };
    const module = { exports: {} };
    new Function('require', 'module', 'process', fs.readFileSync(require.resolve('../src/repositories/order.repository'), 'utf8'))(
      name => deps[name], module, { env: { TELEGRAM_OUTBOX_ENABLED: 'true' } });
    const claim = module.exports.claimOrder(42, 18);
    if (enqueueFails) await assert.rejects(claim, /outbox write failed/);
    else assert.equal((await claim).telegram_queued, true);
    assert.deepEqual(events, ['begin', 'update', 'enqueue', enqueueFails ? 'rollback' : 'commit', 'release']);
  }
});
