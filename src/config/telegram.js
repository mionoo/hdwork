const WEBHOOK_PATH = "/api/telegram/webhook";

function readTelegramConfig(env = process.env) {
  const mode = env.TELEGRAM_UPDATE_MODE || "polling";
  if (!["polling", "webhook"].includes(mode)) throw new Error("TELEGRAM_UPDATE_MODE harus polling atau webhook.");
  if (mode === "polling") return { mode };
  const secret = env.TELEGRAM_WEBHOOK_SECRET || "";
  if (!/^[A-Za-z0-9_-]{32,256}$/.test(secret)) throw new Error("TELEGRAM_WEBHOOK_SECRET harus 32–256 karakter A-Z, a-z, 0-9, _ atau -.");
  let url;
  try { url = new URL(env.TELEGRAM_WEBHOOK_URL); } catch { throw new Error("TELEGRAM_WEBHOOK_URL wajib berupa URL HTTPS endpoint webhook."); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== WEBHOOK_PATH) {
    throw new Error(`TELEGRAM_WEBHOOK_URL harus HTTPS dengan path ${WEBHOOK_PATH}, tanpa credential/query/fragment.`);
  }
  const botId = env.TELEGRAM_BOT_TOKEN?.match(/^(\d+):[^\s]+$/)?.[1];
  if (!botId) throw new Error("Token bot diperlukan untuk mode webhook.");
  return { mode, secret, url: url.href, botId };
}
module.exports = { readTelegramConfig, WEBHOOK_PATH };
