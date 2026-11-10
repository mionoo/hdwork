const { readTelegramConfig } = require("../config/telegram");
const telegram = require("./telegram.service");
let webhook;

function start() {
  const config = readTelegramConfig();
  if (config.mode === "webhook") {
    webhook ??= require("./telegram-webhook.service");
    return webhook.start();
  }
  return telegram.startPolling();
}
function stop(reason) {
  return webhook ? webhook.stop() : telegram.stopPolling(reason);
}
module.exports = { start, stop };
