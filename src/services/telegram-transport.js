const { Agent } = require("node:https");

// Limit connection establishment independently from Telegram's long-poll duration.
// Idle sockets expire early; active polls/uploads keep their request-level deadlines.
class TelegramAgent extends Agent {
  constructor({ connectTimeoutMs = 5000, idleTimeoutMs = 4000, maxSockets }) {
    super({ family: 4, keepAlive: true, keepAliveMsecs: 1000, maxSockets, maxFreeSockets: 2, scheduling: "lifo" });
    this.connectTimeoutMs = connectTimeoutMs;
    this.idleTimeoutMs = idleTimeoutMs;
    this.idleTimers = new Map();
  }

  createConnection(options, callback) {
    const socket = super.createConnection({ ...options, family: 4 }, callback);
    const timer = setTimeout(() => {
      socket.destroy(Object.assign(new Error("Koneksi TLS Telegram melewati batas waktu."), { code: "ETIMEDOUT" }));
    }, this.connectTimeoutMs);
    timer.unref();
    const clear = () => clearTimeout(timer);
    socket.once("secureConnect", clear);
    socket.once("error", clear);
    socket.once("close", () => { clear(); this.clearIdleTimer(socket); });
    return socket;
  }

  clearIdleTimer(socket) {
    clearTimeout(this.idleTimers.get(socket));
    this.idleTimers.delete(socket);
  }

  keepSocketAlive(socket) {
    if (!super.keepSocketAlive(socket)) return false;
    this.clearIdleTimer(socket);
    const timer = setTimeout(() => { this.clearIdleTimer(socket); socket.destroy(); }, this.idleTimeoutMs);
    timer.unref();
    this.idleTimers.set(socket, timer);
    return true;
  }

  reuseSocket(socket, request) {
    this.clearIdleTimer(socket);
    super.reuseSocket(socket, request);
  }

  destroy() {
    for (const socket of this.idleTimers.keys()) this.clearIdleTimer(socket);
    super.destroy();
  }
}

function createTelegramTransport(options = {}) {
  const polling = new TelegramAgent({ ...options, maxSockets: 1 });
  const api = new TelegramAgent({ ...options, maxSockets: 8 });
  return {
    // node-fetch (used by Telegraf) supports an agent selector per URL.
    agent: (url) => url.pathname.endsWith("/getUpdates") ? polling : api,
    destroy() { polling.destroy(); api.destroy(); },
  };
}

module.exports = { createTelegramTransport };
