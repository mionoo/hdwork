const repository = require('../repositories/telegram-outbox.repository');
const { setTimeout: pause } = require('node:timers/promises');
const safeError = error => String(error?.message || error || 'Pengiriman belum terkonfirmasi')
  .replace(/bot\d+:[A-Za-z0-9_-]+/g, 'bot[REDACTED]').slice(0, 2000);

function createOutbox({ repo = repository, send, botId, log = console, delay = pause }) {
  let controller, worker, startup;
  async function attempt(job) {
    let leaseLost = false;
    const heartbeat = setInterval(() => {
      repo.renew(job).then(ok => { if (!ok) leaseLost = true; }).catch(() => { leaseLost = true; });
    }, 30000);
    heartbeat.unref();
    try {
      let delivery;
      try {
        const payload = typeof job.payload === 'string' ? JSON.parse(job.payload) : job.payload;
        delivery = await repo.isTargetCurrent(job.kind, payload)
          ? await send(job.kind, payload)
          : { delivered: false, rejected: true, error: 'Order atau tujuan Telegram sudah berubah.' };
      } catch (error) { delivery = { delivered: false, error: safeError(error) }; }
      delivery = { ...delivery, error: delivery.error ? safeError(delivery.error) : null };
      if (leaseLost) throw new Error('Lease pengiriman Telegram belum terkonfirmasi.');
      // Only explicit pre-TLS failures / 429 can retry. Resets after sending and
      // partial albums are uncertain and must never be blindly sent again.
      const retry = !delivery.delivered && delivery.retry_safe === true && Number(job.attempts) < 5;
      const status = delivery.delivered ? 'sent' : retry ? 'pending'
        : delivery.retry_safe || delivery.rejected ? 'failed' : 'unknown';
      const seconds = Math.max(Number(delivery.retry_after) || 0, 2 ** Number(job.attempts));
      await repo.settle(job, status, delivery, retry ? seconds : 0);
      if (status !== 'sent') log.warn('Pengiriman Telegram belum selesai', {
        outbox_id: job.id, job_key: job.job_key, status, attempts: job.attempts,
        ...(retry ? { retry_seconds: seconds } : {}),
      });
      return { ...delivery, outbox_id: job.id, delivery_status: status, pending: retry };
    } catch (error) {
      log.error('Status pengiriman Telegram perlu diperiksa', { outbox_id: job.id, job_key: job.job_key, error: safeError(error) });
      return { delivered: false, outbox_id: job.id, delivery_status: 'unknown', error: safeError(error) };
    } finally { clearInterval(heartbeat); }
  }
  async function deliver(key, kind, payload) {
    const stored = await repo.enqueue(botId, key, kind, payload);
    if (!stored) throw new Error('Entri pengiriman Telegram tidak ditemukan.');
    if (stored.status !== 'pending') {
      const delivery = typeof stored.delivery === 'string' ? JSON.parse(stored.delivery) : stored.delivery;
      return { ...delivery, delivered: stored.status === 'sent', pending: stored.status === 'sending',
        outbox_id: stored.id, delivery_status: stored.status };
    }
    const job = await repo.claim(botId, stored.id);
    if (job) return attempt(job);
    return { delivered: false, pending: true, delivery_status: 'pending', outbox_id: stored.id };
  }
  function start() {
    if (startup) return startup;
    controller = new AbortController();
    const signal = controller.signal;
    startup = repo.checkSchema().then(() => {
      if (signal.aborted) return;
      worker = (async () => {
        while (!signal.aborted) {
          try {
            const job = await repo.claim(botId);
            if (job) await attempt(job);
            else await delay(1000, undefined, { signal });
          } catch (error) {
            if (signal.aborted) break;
            log.error('Worker pengiriman Telegram terganggu:', safeError(error));
            await delay(1000, undefined, { signal }).catch(() => {});
          }
        }
      })();
    });
    return startup;
  }
  async function stop() {
    controller?.abort();
    await Promise.allSettled([startup, worker]);
    controller = startup = worker = undefined;
  }

  return { deliver, start, stop };
}
module.exports = { createOutbox };
