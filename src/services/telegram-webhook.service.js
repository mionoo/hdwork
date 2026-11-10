const { setTimeout: delay } = require("node:timers/promises");
const { readTelegramConfig } = require("../config/telegram");
const inbox = require("../repositories/telegram-webhook.repository");
const telegram = require("./telegram.service");

function createWebhookService({ repository = inbox, bot = telegram, config = readTelegramConfig, pause = delay, log = console } = {}) {
  let controller, startupTask, workerTask;
  let status = { state: "stopped", registration: "not_started", last_processed_at: null };
  const safeError = error => String(error?.message || "Webhook error").replace(/bot\d+:[A-Za-z0-9_-]+/g, "bot[REDACTED]").slice(0, 500);

  async function processJob(job) {
    let leaseLost = false;
    const heartbeat = setInterval(() => {
      repository.renew(job).then(ok => { if (!ok) leaseLost = true; }).catch(() => { leaseLost = true; });
    }, 30000);
    heartbeat.unref();
    try {
      const update = typeof job.payload === "string" ? JSON.parse(job.payload) : job.payload;
      await bot.handleWebhookUpdate(update);
      if (leaseLost) throw new Error("Lease pesan webhook tidak lagi terkonfirmasi.");
      await repository.complete(job);
      status.last_processed_at = new Date().toISOString();
      log.log("Update webhook diproses", { update_id: job.update_id, attempts: job.attempts });
    } catch (error) {
      const seconds = Math.min(300, 2 ** Math.min(job.attempts, 8));
      await repository.retry(job, safeError(error), seconds);
      log.error("Update webhook menunggu retry", { update_id: job.update_id, retry_seconds: seconds, error: safeError(error) });
    } finally { clearInterval(heartbeat); }
  }

  async function runWorker(botId, signal) {
    while (!signal.aborted) {
      try {
        const job = await repository.claim(botId);
        if (job) await processJob(job);
        else await pause(1000, undefined, { signal });
      } catch (error) {
        if (signal.aborted) break;
        log.error("Worker webhook terganggu", { error: safeError(error) });
        await pause(1000, undefined, { signal }).catch(() => {});
      }
    }
  }

  async function initialize(settings, signal) {
    await repository.checkSchema();
    if (signal.aborted) return;
    status.state = "running";
    workerTask = runWorker(settings.botId, signal);
    log.log("Inbox webhook dan worker aktif; menunggu pendaftaran Telegram. Polling tidak dijalankan.");
    const retries = [2000, 4000, 8000, 16000, 30000];
    for (let attempt = 0; !signal.aborted; attempt++) {
      try {
        status.registration = "registering";
        const accepted = await bot.configureWebhook(settings, signal);
        if (!accepted) throw new Error("Telegram belum mengonfirmasi pendaftaran webhook.");
        status.registration = "registered";
        log.log("Webhook Telegram terdaftar", { url: settings.url });
        return;
      } catch (error) {
        if (signal.aborted) return;
        const code = Number(error.response?.error_code || error.code);
        if (attempt === retries.length || (code >= 400 && code < 500 && code !== 429)) {
          status.registration = "failed";
          log.error("Pendaftaran webhook gagal; inbox/worker tetap aktif. Periksa konfigurasi dan koneksi Telegram.", { error: safeError(error) });
          return;
        }
        const retryAfter = Number(error.response?.parameters?.retry_after || error.parameters?.retry_after || 0) * 1000;
        log.warn(`Pendaftaran webhook gagal; retry ${attempt + 1}/${retries.length}.`, { error: safeError(error) });
        await pause(Math.max(retries[attempt], retryAfter), undefined, { signal }).catch(() => {});
      }
    }
  }

  function start() {
    if (startupTask) return startupTask;
    const settings = config();
    if (settings.mode !== "webhook") throw new Error("Worker webhook hanya boleh berjalan dalam mode webhook.");
    controller = new AbortController();
    status = { ...status, state: "starting", registration: "not_started" };
    startupTask = initialize(settings, controller.signal).catch(error => {
      status.state = "failed";
      log.error("Webhook belum siap; periksa migrasi inbox.", { error: safeError(error) });
      throw error;
    });
    return startupTask;
  }
  async function stop() {
    controller?.abort();
    await Promise.allSettled([startupTask, workerTask]);
    controller = startupTask = workerTask = undefined;
    status.state = "stopped";
    // Keep the remote webhook registered so Telegram queues/retries during restarts.
  }
  return { start, stop, getStatus: () => ({ ...status }) };
}
module.exports = { ...createWebhookService(), createWebhookService };
