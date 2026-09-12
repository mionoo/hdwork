const { io } = require("socket.io-client");
const crypto = require("crypto");
const os = require("os");
const { pingHost } = require("../services/ping.service");
const { testSshConnection } = require("../services/ssh.service");
const { openTerminal, runTerminalCommand } = require("../services/ssh-terminal.service");
const { loadAgentConfig, saveAgentConfig } = require("../config/agent-config");

const serverUrl = (process.env.HD_WORK_SERVER_URL || "http://127.0.0.1:3090").replace(/\/$/, "");
const pairingCode = crypto.randomBytes(4).toString("hex").toUpperCase().match(/.{1,4}/g).join("-");

function connectAgent() {
  const savedConfig = loadAgentConfig();
  const agentId = savedConfig?.agent_id || process.env.HD_WORK_AGENT_ID;
  const agentToken = savedConfig?.agent_token || process.env.HD_WORK_AGENT_TOKEN;
  const isPaired = Boolean(agentId && agentToken);
  const auth = isPaired
    ? { agent_id: agentId, agent_token: agentToken }
    : { pairing_code: pairingCode, device_name: os.hostname() };

  if (!isPaired) console.log(`\nPairing code: ${pairingCode}\nMasukkan kode ini di HD Work → Network Tools. Kode berlaku selama agent tetap berjalan.\n`);

  const socket = io(`${serverUrl}/agent`, {
    transports: ["websocket", "polling"],
    reconnection: true,
    auth,
  });
  const terminalSessions = new Map();

  socket.on("connect", () => {
    console.log(isPaired ? `Connected to HD Work Agent Gateway: ${socket.id}` : "Menunggu pairing dari HD Work...");
  });

  socket.on("disconnect", (reason) => {
    console.log(`Disconnected from HD Work Agent Gateway: ${reason}`);
    // Browser refresh does not disconnect this agent socket. Gateway loss does.
    for (const session of terminalSessions.values()) {
      if (session.command) {
        clearTimeout(session.command.timeout);
        session.command.acknowledge({ success: false, message: "Agent Gateway terputus." });
      }
      session.connection.end();
    }
    terminalSessions.clear();
  });

  socket.on("connect_error", (error) => {
    console.error(`HD Work Agent Gateway unavailable: ${error.message}`);
  });

  socket.on("agent:paired", (credentials) => {
    if (!credentials?.agent_id || !credentials?.agent_token) return;
    saveAgentConfig(credentials);
    console.log("Pairing berhasil. Local Agent terhubung ke akun HD.");
    socket.disconnect();
    connectAgent();
  });

  socket.on("network:ping", async ({ host }, acknowledge) => {
    //console.log(`Ping command received for ${host}`);
    try {
      const result = await pingHost(host);
      if (typeof acknowledge === "function") acknowledge(result);
    } catch (error) {
      if (typeof acknowledge === "function") acknowledge({
        success: false,
        reachable: false,
        host,
        message: error.message || "Ping gagal dijalankan",
      });
    }
  });

  socket.on("network:ssh-test", async (payload, acknowledge) => {
    try {
      const result = await testSshConnection(payload);
      if (typeof acknowledge === "function") acknowledge(result);
    } catch {
      if (typeof acknowledge === "function") acknowledge({ success: false, connected: false, message: "SSH test gagal dijalankan" });
    }
  });

  socket.on("terminal:open", (payload, acknowledge) => openTerminal(socket, terminalSessions, payload, acknowledge));
  socket.on("terminal:command", (payload, acknowledge) => runTerminalCommand(terminalSessions, payload, acknowledge));
  socket.on("terminal:input", ({ session_id: sessionId, data }) => terminalSessions.get(sessionId)?.stream.write(data));
  socket.on("terminal:resize", ({ session_id: sessionId, cols, rows }) => terminalSessions.get(sessionId)?.stream.setWindow(rows, cols, 0, 0));
  socket.on("terminal:close", ({ session_id: sessionId }) => terminalSessions.get(sessionId)?.connection.end());

  return socket;
}

module.exports = { connectAgent };
