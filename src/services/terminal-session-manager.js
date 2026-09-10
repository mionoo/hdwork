const crypto = require("crypto");
const digest = (value) => crypto.createHash("sha256").update(String(value || "")).digest("hex");

// Memory only: server/agent restarts intentionally cannot restore SSH sessions.
function createTerminalSessionManager({ agent, executeTool, graceMs = 60_000, outputBytes = 256 * 1024, maxManualSessions = 5 }) {
  const sessions = new Map();
  const loginKey = (socket) => digest(socket.handshake.auth?.token);
  const validLogin = (socket) => socket.data.user?.role === "HD" && Number(socket.data.user.exp) * 1000 > Date.now();
  const reply = (ack, value) => { if (typeof ack === "function") ack(value); };
  const fail = (ack, code, message) => reply(ack, { success: false, code, message });
  const ownSocket = (socket, session) => validLogin(socket) && session?.socket === socket;

  function destroy(session, reason, notifyAgent = true) {
    if (sessions.get(session.id) !== session) return;
    sessions.delete(session.id);
    clearTimeout(session.graceTimer);
    clearTimeout(session.expiryTimer);
    session.socket?.emit("terminal:closed", { session_id: session.id, reason });
    if (notifyAgent) agent.emitToUserAgent(session.userId, "terminal:close", { session_id: session.id });
    session.history = "";
    session.toolResult = null;
  }

  function append(session, data) {
    session.history += data;
    if (Buffer.byteLength(session.history, "utf8") > outputBytes) {
      const bytes = Buffer.from(session.history, "utf8");
      let start = bytes.length - outputBytes;
      while (start < bytes.length && (bytes[start] & 0xc0) === 0x80) start++;
      const newline = bytes.indexOf(10, start);
      session.history = bytes.subarray(newline >= 0 ? newline + 1 : start).toString("utf8");
      session.truncated = true;
    }
  }

  function snapshot(session) {
    return {
      success: true, session_id: session.id,
      host: session.host, port: session.port, username: session.username,
      kind: session.kind,
      output: session.history, output_truncated: session.truncated,
      cols: session.cols, rows: session.rows,
      busy: session.busy, tool: session.tool, tool_result: session.toolResult, grace_ms: graceMs,
    };
  }

  function closeLoginSessions(token) {
    const key = digest(token);
    for (const session of sessions.values()) {
      if (session.loginKey === key) destroy(session, "Sesi login berakhir atau logout.");
    }
  }

  function initialize(io) {
    agent.setTerminalEventHandlers({
      data: (source, payload) => {
        const session = sessions.get(payload?.session_id);
        if (!session || Number(source.user_id) !== session.userId || typeof payload.data !== "string") return;
        append(session, payload.data);
        if (!session.pending) session.socket?.emit("terminal:data", payload);
      },
      closed: (source, payload) => {
        const session = sessions.get(payload?.session_id);
        if (session && Number(source.user_id) === session.userId) destroy(session, payload.reason || "Sesi SSH ditutup.", false);
      },
      disconnected: (source) => {
        for (const session of sessions.values()) {
          if (session.userId === Number(source.user_id)) destroy(session, "Local Agent terputus. Hubungkan ulang SSH.", false);
        }
      },
    });

    io.on("connection", (socket) => {
      socket.on("terminal:open", async (payload = {}, ack) => {
        if (!validLogin(socket)) return fail(ack, "UNAUTHORIZED", "Sesi login HD tidak valid.");
        if ([...sessions.values()].some((session) => session.socket === socket)) return fail(ack, "SESSION_EXISTS", "Tutup sesi SSH sebelumnya terlebih dahulu.");
        const kind = payload.kind || "manual";
        if (!["manual", "quick"].includes(kind)) return fail(ack, "INVALID_KIND", "Jenis terminal tidak valid.");
        const owned = [...sessions.values()].filter((session) => session.userId === Number(socket.data.user.id) && session.kind === kind);
        if (owned.length >= (kind === "quick" ? 1 : maxManualSessions)) return fail(ack, "SESSION_LIMIT", kind === "quick" ? "Sesi Quick Action sudah aktif. Pulihkan atau tutup sesi sebelumnya." : `Maksimal ${maxManualSessions} sesi manual per HD. Tutup salah satu sesi terlebih dahulu.`);
        const resumeToken = crypto.randomBytes(32).toString("hex");
        const session = {
          id: crypto.randomUUID(), kind, socket, userId: Number(socket.data.user.id), loginKey: loginKey(socket),
          resumeHash: digest(resumeToken), expiresAt: Number(socket.data.user.exp) * 1000,
          host: String(payload.host || "").trim(), port: Number(payload.port) || 22, username: String(payload.username || ""),
          history: "", truncated: false, cols: 120, rows: 30, pending: true, busy: false, tool: null, toolResult: null,
        };
        sessions.set(session.id, session);
        session.expiryTimer = setTimeout(() => destroy(session, "Sesi login sudah habis."), Math.min(session.expiresAt - Date.now(), 2_147_483_647));
        session.expiryTimer.unref?.();
        try {
          const result = await agent.requestAgentCommand(session.userId, "terminal:open", { ...payload, session_id: session.id }, 15_000);
          if (sessions.get(session.id) !== session || !socket.connected || !validLogin(socket)) {
            destroy(session, "Pembukaan sesi dibatalkan.");
            agent.emitToUserAgent(session.userId, "terminal:close", { session_id: session.id });
            return;
          }
          if (!result.success) {
            destroy(session, result.message || "Koneksi SSH belum terbentuk.", false);
            return reply(ack, result);
          }
          session.pending = false;
          reply(ack, { ...snapshot(session), resume_token: resumeToken });
        } catch (error) {
          destroy(session, "Pembukaan sesi gagal.");
          fail(ack, "OPEN_FAILED", error.message);
        }
      });

      socket.on("terminal:resume", (payload = {}, ack) => {
        const session = sessions.get(payload.session_id);
        if (!validLogin(socket) || !session || session.pending || session.userId !== Number(socket.data.user.id) ||
            session.loginKey !== loginKey(socket) || session.resumeHash !== digest(payload.resume_token)) {
          return fail(ack, "SESSION_UNAVAILABLE", "Sesi SSH tidak tersedia atau sudah kedaluwarsa. Silakan hubungkan ulang.");
        }
        if (session.socket && session.socket !== socket) return fail(ack, "SESSION_ATTACHED", "Sesi masih digunakan tab lain atau menunggu koneksi lama terlepas.");
        if (Date.now() >= session.expiresAt || (session.detachedUntil && Date.now() >= session.detachedUntil)) {
          destroy(session, "Waktu pemulihan sesi sudah habis.");
          return fail(ack, "SESSION_EXPIRED", "Waktu pemulihan sesi sudah habis.");
        }
        if (!agent.isUserAgentConnected(session.userId)) {
          destroy(session, "Local Agent tidak terhubung.", false);
          return fail(ack, "AGENT_OFFLINE", "Local Agent tidak terhubung. Hubungkan ulang SSH.");
        }
        clearTimeout(session.graceTimer);
        session.detachedUntil = null;
        session.socket = socket;
        // Snapshot and subsequent data are ordered on the same socket.
        reply(ack, snapshot(session));
      });

      socket.on("terminal:input", (payload = {}) => {
        const session = sessions.get(payload.session_id);
        if (ownSocket(socket, session) && !session.pending && !session.busy && typeof payload.data === "string") agent.emitToUserAgent(session.userId, "terminal:input", payload);
      });
      socket.on("terminal:resize", (payload = {}) => {
        const session = sessions.get(payload.session_id);
        if (!ownSocket(socket, session) || !Number.isInteger(payload.cols) || !Number.isInteger(payload.rows)) return;
        session.cols = Math.max(2, Math.min(500, payload.cols));
        session.rows = Math.max(2, Math.min(300, payload.rows));
        agent.emitToUserAgent(session.userId, "terminal:resize", { session_id: session.id, cols: session.cols, rows: session.rows });
      });
      socket.on("terminal:close", (payload = {}) => {
        const session = sessions.get(payload.session_id);
        if (ownSocket(socket, session)) destroy(session, "Sesi terminal ditutup.");
      });
      socket.on("terminal:logout", () => closeLoginSessions(socket.handshake.auth?.token));

      socket.on("terminal:tool", async ({ session_id: id, tool, input } = {}, ack) => {
        const session = sessions.get(id);
        if (!ownSocket(socket, session) || session.pending) return fail(ack, "SESSION_UNAVAILABLE", "Sesi SSH tidak aktif.");
        if (session.busy) return fail(ack, "BUSY", "Pemeriksaan lain masih berjalan.");
        session.busy = true;
        session.tool = { id: tool, input: input || {} };
        session.toolResult = null;
        let result;
        try {
          result = await executeTool(tool, input || {}, (command) => agent.requestAgentCommand(session.userId, "terminal:command", { session_id: id, command }, 55_000));
        } catch (error) {
          result = { success: false, message: error.message || "Pemeriksaan OLT gagal", rawOutput: error.rawOutput || "" };
        }
        if (sessions.get(id) !== session) return;
        session.busy = false;
        session.toolResult = { ...result, rawOutput: String(result.rawOutput || "").slice(-outputBytes) };
        session.socket?.emit("terminal:tool-result", { session_id: id, result: session.toolResult });
        reply(ack, session.toolResult);
      });

      socket.on("disconnect", () => {
        for (const session of sessions.values()) {
          if (session.socket !== socket) continue;
          if (session.pending) { destroy(session, "Pembukaan sesi dibatalkan."); continue; }
          session.socket = null;
          session.detachedUntil = Math.min(Date.now() + graceMs, session.expiresAt);
          session.graceTimer = setTimeout(() => destroy(session, "Waktu pemulihan sesi sudah habis."), session.detachedUntil - Date.now());
          session.graceTimer.unref?.();
        }
      });
    });
  }
  return { initialize, closeLoginSessions };
}
module.exports = { createTerminalSessionManager };
