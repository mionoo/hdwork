const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { Telegraf } = require('telegraf');

test('webhook records orders without getMe, propagates DB failures and keeps identity checks for commands', async () => {
  let failIdentity = true, failDatabase = true, saved = 0;
  const calls = [];
  class LocalBot extends Telegraf {
    constructor(token, options) {
      super(token, options);
      assert.equal(options.handlerTimeout, Infinity);
      this.telegram.callApi = async (method, payload) => {
        calls.push({ method, payload });
        if (method === 'getMe') {
          if (failIdentity) { failIdentity = false; throw new Error('identity unavailable'); }
          return { id: 123, is_bot: true, username: 'hdwork_test' };
        }
        if (method === 'setWebhook') return true;
        assert.fail(`Unexpected API call: ${method}`);
      };
    }
  }
  const deps = {
    telegraf: { Telegraf: LocalBot }, '../config/features': {},
    './telegram-transport': require('../src/services/telegram-transport'),
    '../repositories/telegram.repository': { getGroupByChatThread: async () => ({ id: 8, is_active: 1, category: 'PENGAWALAN' }) },
    '../repositories/order.repository': { createIncomingOrder: async () => { if (failDatabase) { failDatabase = false; throw new Error('database unavailable'); } saved++; return { id: 42 }; } },
    '../services/realtime.service': { emitOrdersChanged() {} },
    '../repositories/order-source.repository': { record: async () => {}, link: async () => 42 },
    '../repositories/order-conversation.repository': {}, './order-source-photo.service': {},
  };
  const module = { exports: {} };
  new Function('require', 'module', 'process', fs.readFileSync(require.resolve('../src/services/telegram.service'), 'utf8'))(
    name => deps[name] || (name.startsWith('node:') ? require(name) : {}), module,
    { env: { TELEGRAM_BOT_TOKEN: '123:fake', TELEGRAM_UPDATE_MODE: 'webhook' } },
  );
  const service = module.exports;
  await assert.rejects(service.startPolling(), /webhook/);
  await service.configureWebhook({ url: 'https://example.test/api/telegram/webhook', secret: 'a'.repeat(32) }, new AbortController().signal);
  const registration = calls.find(c => c.method === 'setWebhook').payload;
  assert.equal(registration.drop_pending_updates, false);
  assert.equal(registration.max_connections, 1);
  assert.deepEqual(registration.allowed_updates, ['message', 'callback_query']);
  const update = { update_id: 7, message: { message_id: 9, date: Math.floor(Date.now() / 1000), chat: { id: -100, type: 'supergroup' }, from: { id: 5, first_name: 'Pelapor' }, caption: '#req 123, cek', photo: [{ file_id: 'large' }] } };
  const admin = { update_id: 6, message: { ...update.message, caption: undefined,
    photo: undefined, text: '/setgrup@hdwork_test', entities: [{ offset: 0, length: 20, type: 'bot_command' }] } };
  await assert.rejects(service.handleWebhookUpdate(admin), /identity unavailable/);
  await assert.rejects(service.handleWebhookUpdate(update), /database unavailable/);
  await service.handleWebhookUpdate(update);
  assert.equal(saved, 1);
  assert.equal(calls.filter(c => c.method === 'getMe').length, 1);
  assert.ok(!calls.some(c => ['getUpdates', 'deleteWebhook'].includes(c.method)));
});

test('runtime selects exactly one receiver and stops the same receiver', async () => {
  for (const mode of ['polling', 'webhook']) {
    const calls = [];
    const module = { exports: {} };
    const deps = {
      '../config/telegram': { readTelegramConfig: () => ({ mode }) },
      './telegram.service': { startPolling: () => calls.push('polling:start'), stopPolling: () => calls.push('polling:stop') },
      './telegram-webhook.service': { start: () => calls.push('webhook:start'), stop: () => calls.push('webhook:stop') },
    };
    new Function('require', 'module', fs.readFileSync(require.resolve('../src/services/telegram-runtime.service'), 'utf8'))(name => deps[name], module);
    module.exports.start(); module.exports.stop();
    assert.deepEqual(calls, [`${mode}:start`, `${mode}:stop`]);
  }
});
