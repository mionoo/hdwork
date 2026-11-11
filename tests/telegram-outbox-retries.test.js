const test = require('node:test');
const assert = require('node:assert/strict');
const { createOutbox } = require('../src/services/telegram-outbox.service');

test('outbox retries safe failures ten times and caps the default delay at sixteen seconds', async () => {
  let attempts = 0;
  const outcomes = [];
  let resolveDone;
  const done = new Promise(resolve => { resolveDone = resolve; });
  const repo = {
    checkSchema: async () => {},
    claim: async () => {
      if (attempts === 10) return null;
      return { id: 1, job_key: 'reply:test', kind: 'reply', attempts: ++attempts, payload: {} };
    },
    isTargetCurrent: async () => true,
    settle: async (_job, status, _delivery, seconds) => {
      outcomes.push([status, seconds]);
      if (status === 'failed') resolveDone();
    },
  };
  const cleaned = [];
  const outbox = createOutbox({
    repo, botId: '123', log: { warn() {}, error() {} },
    send: async () => ({ delivered: false, retry_safe: true, retry_after: attempts === 1 ? 25 : 0 }),
    onSettled: async job => cleaned.push(job.attempts),
  });
  await outbox.start();
  await done;
  await outbox.stop();
  assert.deepEqual(outcomes, [
    ['pending', 25], ['pending', 4], ['pending', 8],
    ...Array.from({ length: 6 }, () => ['pending', 16]),
    ['failed', 0],
  ]);
  assert.deepEqual(cleaned, [10]);
});
