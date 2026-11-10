require("dotenv").config({ path: require("node:path").resolve(__dirname, "../.env"), quiet: true });
const { Telegram } = require("telegraf");
const { createTelegramTransport } = require("../src/services/telegram-transport");

async function main() {
  if (!process.env.TELEGRAM_BOT_TOKEN) throw new Error("TOKEN_MISSING");
  const transport = createTelegramTransport();
  try {
    const client = new Telegram(process.env.TELEGRAM_BOT_TOKEN, { agent: transport.agent });
    const info = await client.callApi("getWebhookInfo", {}, { signal: AbortSignal.timeout(10000) });
    console.log(JSON.stringify({
      mode: process.env.TELEGRAM_UPDATE_MODE || "polling", url: info.url,
      pending_update_count: info.pending_update_count, max_connections: info.max_connections,
      last_error_at: info.last_error_date ? new Date(info.last_error_date * 1000).toISOString() : null,
      last_error_message: info.last_error_message?.replace(/bot\d+:[A-Za-z0-9_-]+/g, "bot[REDACTED]"),
    }, null, 2));
  } finally { transport.destroy(); }
}
main().catch(error => {
  console.error("Pemeriksaan webhook gagal", { code: error.response?.error_code || error.code || error.name });
  process.exitCode = 1;
});
