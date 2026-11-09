const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');

function load(file, dependencies, env = {}) {
  const module = { exports: {} };
  new Function('require', 'module', 'process', '__dirname', fs.readFileSync(path.join(__dirname, '..', file), 'utf8'))(
    name => {
      if (Object.hasOwn(dependencies, name)) return dependencies[name];
      if (name.startsWith('node:')) return require(name);
      throw new Error(`Unexpected dependency: ${name}`);
    }, module, { env }, path.join(__dirname, '..', path.dirname(file)),
  );
  return module.exports;
}

test('Cacti requires explicit opt-in', () => {
  for (const value of [undefined, '', 'false', '0', 'TRUE']) {
    assert.equal(load('src/config/features.js', {}, { CACTI_ENABLED: value }).CACTI_ENABLED, false);
  }
  assert.equal(load('src/config/features.js', {}, { CACTI_ENABLED: 'true' }).CACTI_ENABLED, true);
});

for (const enabled of [false, true]) {
  test(`Cacti HTTP routes ${enabled ? 'can be restored explicitly' : 'return 503 before payload parsing and load no integration services'}`, async t => {
    const deps = { express, cors: require('cors'), path, './config/features': { CACTI_ENABLED: enabled } };
    for (const name of ['order', 'attendance', 'dashboard', 'auth', 'user', 'group', 'agent', 'network']) {
      deps[`./routes/${name}.routes`] = express.Router().get('/', (req, res) => res.json({ ok: true }));
    }
    if (enabled) for (const name of ['cacty', 'datin-cacti', 'datin-sheet-sync']) {
      deps[`./routes/${name}.routes`] = express.Router().post('/test', (req, res) => res.json({ body: req.body }));
    }
    const app = load('src/app.js', deps);
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    const base = `http://127.0.0.1:${server.address().port}`;
    for (const route of ['/api/cactys', '/api/datin-cacti', '/api/datin-sheet']) {
      const response = await fetch(`${base}${route}/test`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: enabled ? '{"test":true}' : 'invalid json' });
      assert.equal(response.status, enabled ? 200 : 503);
      const body = await response.json();
      if (!enabled) assert.equal(body.code, 'CACTI_DISABLED');
      // The sheet route normally installs its own parser.
      else if (route !== '/api/datin-sheet') assert.deepEqual(body.body, { test: true });
    }
    assert.equal((await fetch(`${base}/api/orders`)).status, 200);
    assert.equal((await fetch(`${base}/api/auth`)).status, 200);
  });
}

test('paused scheduler starts no jobs and makes no database or Telegram calls', async () => {
  const scheduler = load('src/services/cacti-scheduler.service.js', {
    '../config/features': { CACTI_ENABLED: false },
    '../config/database': { query() { assert.fail('Cacti must not query MySQL'); } },
    '../repositories/telegram.repository': {}, './telegram.service': {}, './cacti-alarm.service': {},
  });
  scheduler.startCactiScheduler();
  await scheduler.runScheduledNotifications();
  scheduler.stopCactiScheduler();
});

test('alarm commands, old callbacks and notification senders are paused while order commands and claim notifications remain active', async () => {
  const commands = new Map(), actions = [], sent = [];
  const service = load('src/services/telegram.service.js', {
    '../config/features': { CACTI_ENABLED: false },
    telegraf: { Telegraf: class {
      telegram = { callApi: async () => ({}), sendMessage: async (...args) => { sent.push(args); return { message_id: 9 }; } };
      use() {} on() {} catch() {}
      command(name, handler) { commands.set(name, handler); }
      action(pattern) { actions.push(pattern); }
      async startPolling() {}
    } },
    '../repositories/telegram.repository': {}, '../repositories/order.repository': {}, '../services/realtime.service': {},
    '../repositories/order-source.repository': {}, '../repositories/order-conversation.repository': { recordOutgoing: async () => {} },
    './order-source-photo.service': {},
  }, { TELEGRAM_BOT_TOKEN: 'test-only' });
  await service.startPolling();
  assert.ok(commands.has('setgrup'));
  assert.ok(commands.has('config'));
  assert.ok(![...commands.keys()].some(name => name.includes('alarm')));
  assert.ok(!actions.some(pattern => String(pattern).includes('alarmdatin')));
  let help;
  await commands.get('help')({ message: {}, reply: async text => { help = text; } });
  assert.ok(help.includes('#req'));
  assert.ok(!help.includes('/alarm'));
  assert.equal((await service.sendMessage(-100, 'Cacti alarm')).skipped, true);
  assert.equal((await service.sendPersonalAlarmMessage(1, 'Cacti personal')).skipped, true);
  assert.equal(sent.length, 0);
  await service.notifyOrderClaim({ order_id: 1, telegram_chat_id: -100, telegram_message_id: 2, user_name: 'HD Test' });
  assert.equal(sent.length, 1);
  assert.match(sent[0][1], /On progress oleh HD Test/);
});
