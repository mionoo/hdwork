const { Client } = require("ssh2");
const { createHostVerifier } = require("./ssh.service");

const COMMAND_TIMEOUT_MS = 45_000;

function removeAnsi(value) {
  return String(value || "").replace(/\x1B\[[0-?]*[ -\/]*[@-~]/g, "");
}

function cleanCapturedOutput(value) {
  return String(value || "")
    .replace(/--More--(?:\x08 \x08|\x08)+/g, "")
    .replace(/--More--[\x08 ]*/g, "");
}

function hasPrompt(output) {
  return /(?:^|\n)[^\r\n]*[>#]\s*$/.test(removeAnsi(output).replace(/\r/g, ""));
}

function openTerminal(socket, sessions, payload, acknowledge) {
  const { session_id: sessionId, host, port = 22, username, password, trust_host: trustHost = false } = payload;
  const connection = new Client();
  let verification = null;
  let acknowledged = false;
  const respond = (result) => { if (!acknowledged && typeof acknowledge === "function") { acknowledged = true; acknowledge(result); } };
  const close = (reason = "Sesi ditutup") => {
    const session = sessions.get(sessionId);
    if (session) {
      if (session.command) {
        clearTimeout(session.command.timeout);
        session.command.acknowledge({ success: false, message: reason, raw_output: cleanCapturedOutput(session.command.rawOutput) });
      }
      sessions.delete(sessionId);
      session.connection.end();
    }
    socket.emit("terminal:closed", { session_id: sessionId, reason });
  };

  connection.on("ready", () => {
    if (!socket.connected) { connection.end(); return; }
    connection.shell({ term: "xterm-256color", cols: 120, rows: 30 }, (error, stream) => {
      if (!socket.connected) { connection.end(); return; }
      if (error) {
        respond({ success: false, connected: false, message: "Login berhasil, tetapi perangkat menolak membuka terminal SSH" });
        connection.end();
        return;
      }
      const session = { connection, stream, command: null };
      sessions.set(sessionId, session);
      stream.on("data", (data) => {
        const chunk = data.toString("utf8");
        if (socket.connected) socket.emit("terminal:data", { session_id: sessionId, data: chunk });
        const command = session.command;
        if (!command) return;

        command.rawOutput += chunk;
        const pagerMatches = removeAnsi(chunk).match(/--More--/g) || [];
        for (let index = 0; index < pagerMatches.length; index += 1) stream.write(" ");

        if (hasPrompt(command.rawOutput)) {
          clearTimeout(command.timeout);
          session.command = null;
          command.acknowledge({ success: true, raw_output: cleanCapturedOutput(command.rawOutput) });
        }
      });
      stream.on("close", () => close("Sesi SSH ditutup oleh perangkat"));
      respond({ success: true, connected: true, host, port: Number(port), session_id: sessionId });
    });
  });
  connection.on("error", () => {
    if (acknowledged) close("Koneksi SSH terputus.");
    else respond({ success: false, connected: false, ...(verification || { message: "Koneksi atau autentikasi SSH gagal" }) });
  });
  connection.on("close", () => close("Koneksi SSH ditutup."));
  try {
    connection.connect({ host, port: Number(port), username: username || "host-verification", password, readyTimeout: 10_000, hostVerifier: createHostVerifier({ host, port, trustHost, setVerification: (result) => { verification = result; } }) });
  } catch { respond({ success: false, connected: false, message: "Konfigurasi SSH tidak valid" }); }
}

function runTerminalCommand(sessions, payload, acknowledge) {
  const sessionId = payload?.session_id;
  const command = String(payload?.command || "").trim();
  const session = sessions.get(sessionId);
  if (!session?.stream) return acknowledge?.({ success: false, message: "Sesi SSH tidak aktif" });
  if (!command) return acknowledge?.({ success: false, message: "Command tidak tersedia" });
  if (session.command) return acknowledge?.({ success: false, message: "Command lain masih berjalan" });

  const execution = {
    rawOutput: "",
    acknowledge: (result) => acknowledge?.(result),
    timeout: null,
  };
  execution.timeout = setTimeout(() => {
    if (session.command !== execution) return;
    session.command = null;
    acknowledge?.({ success: false, message: "Waktu tunggu output OLT habis", raw_output: cleanCapturedOutput(execution.rawOutput) });
  }, COMMAND_TIMEOUT_MS);
  session.command = execution;
  session.stream.write(`${command}\n`);
}

module.exports = { openTerminal, runTerminalCommand };
