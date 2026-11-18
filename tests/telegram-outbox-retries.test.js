const test = require('node:test');
const assert = require('node:assert/strict');
const { createOutbox } = require('../src/services/telegram-outbox.service');

for (const kind of ['claim', 'result', 'reply']) {
  test(`outbox ${kind} uses the agreed delays and stops after twenty safe failures`, async () => {
    let attempts = 0;
    const outcomes = [];
    let resolveDone;
    const done = new Promise(resolve => { resolveDone = resolve; });
    const repo = {
      checkSchema: async () => {},
      claim: async () => {
        if (attempts === 20) return null;
        return { id: 1, job_key: `${kind}:test`, kind, attempts: ++attempts, payload: {} };
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
      send: async () => ({ delivered: false, retry_safe: true }),
      onSettled: async job => cleaned.push(job.attempts),
    });
    try {
      await outbox.start();
      await done;
    } finally { await outbox.stop(); }

    assert.deepEqual(outcomes, [
      ...Array.from({ length: 3 }, () => ['pending', 2]),
      ...Array.from({ length: 2 }, () => ['pending', 4]),
      ['pending', 6],
      ...Array.from({ length: 13 }, () => ['pending', 8]),
      ['failed', 0],
    ]);
    assert.equal(attempts, 20);
    assert.deepEqual(cleaned, [20]);
  });
}

test('Telegram retry_after takes precedence and confirmed success stops retries', async () => {
  let attempts = 0;
  let claimed = false;
  const outcomes = [];
  const repo = {
    enqueue: async () => ({ id: 1, status: 'pending' }),
    claim: async () => {
      if (claimed) return null;
      claimed = true;
      return { id: 1, kind: 'reply', payload: {}, attempts: ++attempts };
    },
    isTargetCurrent: async () => true,
    settle: async (_job, status, _delivery, seconds) => { outcomes.push([status, seconds]); },
  };
  const outbox = createOutbox({
    repo, botId: '123', log: { warn() {}, error() {} },
    send: async () => attempts === 1
      ? { delivered: false, retry_safe: true, retry_after: 25 }
      : { delivered: true, message_id: 77 },
  });
  await outbox.deliver('reply:test', 'reply', {});
  claimed = false;
  await outbox.deliver('reply:test', 'reply', {});
  await outbox.deliver('reply:test', 'reply', {});
  assert.deepEqual(outcomes, [['pending', 25], ['sent', 0]]);
});
