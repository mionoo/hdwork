let agentNamespace = null;
const agentRepository = require("../repositories/agent.repository");
const socketsByUserId = new Map();
const pendingPairings = new Map();
let terminalEventHandlers = null;

function agentUnavailableError(message) {
  const error = new Error(message);
  error.statusCode = 503;
  return error;
}

function initialize(socketServer) {
  agentNamespace = socketServer.of("/agent");

  agentNamespace.use(async (socket, next) => {
    try {
      if (socket.handshake.auth?.pairing_code) {
        socket.data.pairing = { code: socket.handshake.auth.pairing_code, deviceName: socket.handshake.auth.device_name || "Local Agent" };
        return next();
      }
      const agent = await agentRepository.authenticate(
        socket.handshake.auth?.agent_id,
        socket.handshake.auth?.agent_token,
      );
      if (!agent) return next(new Error("Unauthorized agent"));
      socket.data.agent = agent;
      return next();
    } catch (error) {
      return next(error);
    }
  });

  agentNamespace.on("connection", async (socket) => {
    if (socket.data.pairing) {
      const pairing = socket.data.pairing;
      pendingPairings.set(pairing.code, { socket, deviceName: pairing.deviceName, expiresAt: Date.now() + 10 * 60 * 1000 });
      console.log(`🤖 Local Agent menunggu pairing: ${pairing.deviceName}`);
      socket.on("disconnect", () => pendingPairings.delete(pairing.code));
      return;
    }
    const { agent } = socket.data;
    socketsByUserId.set(Number(agent.user_id), socket);
    await agentRepository.markConnected(agent.id);
    console.log(`🤖 Local Agent connected: ${agent.name} (${socket.id})`);

    socket.on("disconnect", async (reason) => {
      if (socketsByUserId.get(Number(agent.user_id))?.id === socket.id) {
        socketsByUserId.delete(Number(agent.user_id));
        terminalEventHandlers?.disconnected?.(agent);
        await agentRepository.markDisconnected(agent.id);
      }
      console.log(`🤖 Local Agent disconnected: ${agent.name} (${reason})`);
    });
    socket.on("terminal:data", (payload) => terminalEventHandlers?.data(agent, payload));
    socket.on("terminal:closed", (payload) => terminalEventHandlers?.closed(agent, payload));
  });
}

function emitToUserAgent(userId, event, payload) {
  socketsByUserId.get(Number(userId))?.emit(event, payload);
}

function isUserAgentConnected(userId) {
  return socketsByUserId.has(Number(userId));
}

function setTerminalEventHandlers(handlers) { terminalEventHandlers = handlers; }

async function pairAgent(userId, pairingCode) {
  const pending = pendingPairings.get(String(pairingCode || "").trim().toUpperCase());
  if (!pending || pending.expiresAt < Date.now()) { const error = new Error("Kode pairing tidak valid atau sudah kedaluwarsa"); error.statusCode = 400; throw error; }
  const credentials = await agentRepository.createForHd(userId, pending.deviceName);
  pending.socket.emit("agent:paired", credentials);
  pendingPairings.delete(String(pairingCode).trim().toUpperCase());
  return { name: credentials.name };
}

function getNamespace() {
  return agentNamespace;
}

async function requestAgentCommand(userId, event, payload, timeout = 10_000) {
  if (!agentNamespace) {
    throw agentUnavailableError("Agent Gateway belum siap");
  }

  const socket = socketsByUserId.get(Number(userId));
  if (!socket) {
    throw agentUnavailableError("Local Agent untuk akun ini tidak terhubung");
  }

  try {
    return await socket.timeout(timeout).emitWithAck(event, payload);
  } catch (cause) {
    const error = new Error("Local Agent tidak merespons tepat waktu");
    error.statusCode = 504;
    error.cause = cause;
    throw error;
  }
}

async function requestPing(userId, host) {
  return requestAgentCommand(userId, "network:ping", { host });
}

async function requestSshTest(userId, payload) {
  return requestAgentCommand(userId, "network:ssh-test", payload, 15_000);
}

module.exports = { initialize, getNamespace, requestPing, requestSshTest, requestAgentCommand, emitToUserAgent, setTerminalEventHandlers, pairAgent, isUserAgentConnected };
