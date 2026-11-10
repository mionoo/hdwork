const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const express = require('express');
const { readTelegramConfig } = require('../src/config/telegram');
const config = readTelegramConfig({ TELEGRAM_UPDATE_MODE: 'webhook', TELEGRAM_BOT_TOKEN: '123:fake', TELEGRAM_WEBHOOK_SECRET: 'a'.repeat(32), TELEGRAM_WEBHOOK_URL: 'https://example.test/api/telegram/webhook' });
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }

async function fixture(t, enqueue, settings = config) {
  const module = { exports: {} };
  new Function('require', 'module', fs.readFileSync(require.resolve('../src/routes/telegram-webhook.routes'), 'utf8'))(name => ({
    express, 'node:crypto': require('node:crypto'), '../config/telegram': { readTelegramConfig: () => settings },
    '../repositories/telegram-webhook.repository': { enqueue },
  })[name], module);
  const app = express(); app.use('/api/telegram', module.exports);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  t.after(() => new Promise(r => server.close(r)));
  return (body, secret = config.secret) => fetch(`http://127.0.0.1:${server.address().port}/api/telegram/webhook`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(secret === null ? {} : { 'X-Telegram-Bot-Api-Secret-Token': secret }) }, body,
  });
}

test('webhook configuration is opt-in and rejects unsafe or incomplete settings', () => {
  assert.equal(readTelegramConfig({}).mode, 'polling');
  assert.throws(() => readTelegramConfig({ TELEGRAM_UPDATE_MODE: 'both' }));
  const env = { TELEGRAM_UPDATE_MODE: 'webhook', TELEGRAM_BOT_TOKEN: '123:fake', TELEGRAM_WEBHOOK_SECRET: config.secret };
  for (const url of ['http://example.test/api/telegram/webhook', 'https://example.test/login', 'https://user:password@example.test/api/telegram/webhook', 'https://example.test/api/telegram/webhook?secret=abc']) {
    assert.throws(() => readTelegramConfig({ ...env, TELEGRAM_WEBHOOK_URL: url }));
  }
  assert.throws(() => readTelegramConfig({ ...env, TELEGRAM_WEBHOOK_SECRET: 'short', TELEGRAM_WEBHOOK_URL: config.url }));
});

test('webhook rejects missing/wrong secrets before parsing or DB access; polling mode refuses webhook delivery', async t => {
  const post = await fixture(t, () => assert.fail('unauthorized requests must not touch DB'));
  for (const secret of [null, 'wrong', 'b'.repeat(32)]) assert.equal((await post('bad JSON', secret)).status, 403);
  const polling = await fixture(t, () => assert.fail('disabled route must not touch DB'), { mode: 'polling' });
  assert.equal((await polling('{}')).status, 503);
});

test('200 is returned only after durable enqueue, duplicate deliveries retain the original payload', async t => {
  const ready = deferred(), saved = deferred(); let received;
  const entries = new Map();
  const post = await fixture(t, async (botId, update) => {
    received = { botId, update }; ready.resolve(); await saved.promise;
    if (!entries.has(update.update_id)) entries.set(update.update_id, update);
  });
  let acknowledged = false;
  const body = { update_id: 7, message: { caption: '#req 123, foto', photo: [{ file_id: 'large' }] } };
  const response = post(JSON.stringify(body)).then(r => { acknowledged = true; return r; });
  await ready.promise;
  assert.equal(acknowledged, false);
  assert.deepEqual(received, { botId: '123', update: body });
  saved.resolve(); assert.equal((await response).status, 200);
  assert.equal((await post(JSON.stringify({ update_id: 7, message: { text: 'duplicate' } }))).status, 200);
  assert.equal(entries.size, 1);
  assert.deepEqual(entries.get(7), body);
});

test('DB failure returns 503 and invalid/oversized payloads are not accepted', async t => {
  const post = await fixture(t, async () => { throw Object.assign(new Error('database unavailable'), { code: 'ECONNREFUSED' }); });
  assert.equal((await post('{"update_id":42}')).status, 503);
  for (const body of ['bad JSON', '{}', '[]', '{"update_id":-1}', '{"update_id":"42"}']) assert.equal((await post(body)).status, 400);
  assert.equal((await post(JSON.stringify({ update_id: 9, data: 'x'.repeat(1024 * 1024) }))).status, 413);
});
