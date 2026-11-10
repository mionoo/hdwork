const { readTelegramConfig } = require("../config/telegram");
const telegram = require("./telegram.service");
let webhook;

function start() {
  const config = readTelegramConfig();
  // Delivery recovery must not prevent receiving orders if its migration is missing.
  Promise.resolve().then(() => telegram.startOutbox?.()).catch(error => {
    console.error("Antrean pengiriman Telegram belum siap; periksa migrasi outbox:", error.message);
  });
  if (config.mode === "webhook") {
    webhook ??= require("./telegram-webhook.service");
    return webhook.start();
  }
  return telegram.startPolling();
}
function stop(reason) {
  return Promise.all([webhook ? webhook.stop() : telegram.stopPolling(reason), telegram.stopOutbox?.()]);
}
module.exports = { start, stop };
