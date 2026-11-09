// Read-only: getMe/root checks never poll updates or send Telegram messages.
require("dotenv").config({ path: require("node:path").resolve(__dirname, "../.env"), quiet: true });
const https = require("node:https");
const { performance } = require("node:perf_hooks");
const { createTelegramTransport } = require("../src/services/telegram-transport");

async function main() {
  const transport = createTelegramTransport();
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const url = new URL(token ? `https://api.telegram.org/bot${token}/getMe` : "https://api.telegram.org/");
  let failures = 0;
  try {
    for (const lane of ["polling", "api"]) {
      // Test both pools using getMe, never getUpdates (which would conflict with PM2).
      const selector = new URL(`https://api.telegram.org/${lane === "polling" ? "getUpdates" : "getMe"}`);
      const agent = transport.agent(selector);
      for (let attempt = 1; attempt <= 3; attempt++) {
        const start = performance.now();
        const result = { lane, attempt, operation: token ? "getMe" : "root", family: "IPv4" };
        await new Promise(resolve => {
          const request = https.get(url, { agent, signal: AbortSignal.timeout(10000) }, response => {
            result.http = response.statusCode;
            response.resume();
            response.once("end", () => finish());
            response.once("error", error => finish(error));
          });
          let finished = false;
          function finish(error) {
            if (finished) return;
            finished = true;
            result.total_ms = Math.round(performance.now() - start);
            result.reused_socket = request.reusedSocket;
            if (error) result.error_code = error.code || error.name;
            if (error || result.http >= 400) failures++;
            // No URLs, response bodies, or error messages: the path can contain a bot token.
            console.log(JSON.stringify(result));
            resolve();
          }
          request.on("socket", socket => {
            const connected = () => { result.ip = socket.remoteAddress; };
            if (!socket.connecting) connected();
            socket.once("lookup", () => { result.dns_ms = Math.round(performance.now() - start); });
            socket.once("connect", () => { connected(); result.tcp_ms = Math.round(performance.now() - start); });
            socket.once("secureConnect", () => { result.tls_ms = Math.round(performance.now() - start); });
          });
          request.once("error", error => finish(error));
        });
      }
    }
  } finally {
    transport.destroy();
  }
  if (failures) process.exitCode = 1;
}
main().catch(() => { console.error("Pemeriksaan koneksi gagal. Periksa konfigurasi backend."); process.exitCode = 1; });
