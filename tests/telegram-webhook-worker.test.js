const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
function factory() {
  const module = { exports: {} };
  new Function('require', 'module', fs.readFileSync(require.resolve('../src/services/telegram-webhook.service'), 'utf8'))(name => ({
    'node:timers/promises': require('node:timers/promises'), '../config/telegram': {}, '../repositories/telegram-webhook.repository': {}, './telegram.service': {},
  })[name], module);
  return module.exports.createWebhookService;
}
const config = () => ({ mode: 'webhook', botId: '123', secret: 'a'.repeat(32), url: 'https://example.test/api/telegram/webhook' });
const log = { log() {}, warn() {}, error() {} };
const paused = (ms, value, { signal }) => new Promise(resolve => { if (signal.aborted) resolve(); else signal.addEventListener('abort', resolve, { once: true }); });

test('persisted jobs retry after handler failure and a new worker resumes the remaining inbox after restart', async () => {
  const jobs = [{ id: 1, update_id: 7, payload: { update_id: 7 }, attempts: 0, lease_token: 'lease' }];
  let fail = true, claimed = false;
  const failed = deferred(), done = deferred();
  const repository = {
    checkSchema: async () => {},
    claim: async () => {
      if (claimed || !jobs.length) return null;
      claimed = true; jobs[0].attempts++; return jobs[0];
    },
    renew: async () => true,
    complete: async job => { assert.equal(job.update_id, 7); jobs.shift(); done.resolve(); },
    retry: async (job, message, seconds) => { assert.equal(seconds, 2); assert.match(message, /database down/); failed.resolve(); },
  };
  const bot = { configureWebhook: async () => true, handleWebhookUpdate: async update => { assert.equal(update.update_id, 7); if (fail) throw new Error('database down'); } };
  const create = factory();
  const first = create({ repository, bot, config, pause: paused, log });
  assert.equal(first.start(), first.start());
  await failed.promise; await first.stop();
  assert.equal(jobs.length, 1);
  fail = false; claimed = false;
  const second = create({ repository, bot, config, pause: paused, log });
  await second.start(); await done.promise; await second.stop();
  assert.equal(jobs.length, 0);
});

test('missing migration prevents registration; registration network retries do not stop the durable worker', async () => {
  const create = factory(); let registrations = 0;
  const broken = create({ repository: { checkSchema: async () => { throw new Error('missing migration'); } }, bot: { configureWebhook: async () => { registrations++; } }, config, log });
  await assert.rejects(broken.start(), /missing migration/); await broken.stop();
  assert.equal(registrations, 0);
  const delays = [];
  const service = create({
    repository: { checkSchema: async () => {}, claim: async () => null }, config, log,
    bot: { configureWebhook: async () => { registrations++; throw Object.assign(new Error('network down'), { code: 'ETIMEDOUT' }); } },
    pause: async (ms, value, options) => { if (ms === 1000) return paused(ms, value, options); delays.push(ms); },
  });
  await service.start();
  assert.equal(registrations, 6);
  assert.deepEqual(delays, [2000, 4000, 8000, 16000, 30000]);
  assert.equal(service.getStatus().state, 'running');
  assert.equal(service.getStatus().registration, 'failed');
  await service.stop();
});


test('a pending identity lookup for a control update does not block the order worker', async () => {
  const controlStarted = deferred(), releaseControl = deferred(), saved = deferred();
  const claimed = new Set();
  const service = factory()({ config, log, pause: paused,
    repository: {
      checkSchema: async () => {},
      claim: async (botId, lane) => {
        if (claimed.has(lane)) return null;
        claimed.add(lane);
        const updateId = lane === 'control' ? 6 : 7;
        return { update_id: updateId, payload: { update_id: updateId }, attempts: 1 };
      },
      complete: async job => { if (job.update_id === 7) saved.resolve(); },
    },
    bot: {
      configureWebhook: async () => true,
      handleWebhookUpdate: async update => {
        if (update.update_id === 6) { controlStarted.resolve(); await releaseControl.promise; }
        else await controlStarted.promise;
      },
    },
  });
  try { await service.start(); await saved.promise; }
  finally { releaseControl.resolve(); await service.stop(); }
  assert.deepEqual([...claimed].sort(), ['control', 'data']);
});
