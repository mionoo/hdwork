const { test } = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const { Server } = require("socket.io");
const { io: client } = require("socket.io-client");
const { once } = require("node:events");
const { createTerminalSessionManager } = require("../src/services/terminal-session-manager");

test("real Socket.IO restores manual and quick sessions independently without opening SSH again", { timeout: 5000 }, async (t) => {
  let handlers;
  let opens = 0;
  let closes = 0;
  const httpServer = http.createServer();
  const io = new Server(httpServer);
  const manager = createTerminalSessionManager({
    agent: {
      setTerminalEventHandlers: (value) => { handlers = value; },
      requestAgentCommand: async () => { opens++; return { success: true }; },
      emitToUserAgent: (_, event) => { if (event === "terminal:close") closes++; },
      isUserAgentConnected: () => true,
    },
    executeTool: async () => ({ success: true }),
  });
  io.use((socket, next) => {
    socket.data.user = { id: 1, role: "HD", exp: Math.floor(Date.now() / 1000) + 3600 };
    next();
  });
  manager.initialize(io);
  const clients = [];
  t.after(async () => {
    manager.closeLoginSessions("integration-test-only");
    for (const socket of clients) socket.disconnect();
    await new Promise((resolve) => io.close(resolve));
  });
  await new Promise((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${httpServer.address().port}`;
  async function connect() {
    const socket = client(url, { autoConnect: false, transports: ["websocket"], auth: { token: "integration-test-only" } });
    clients.push(socket);
    const ready = once(socket, "connect");
    socket.connect();
    await ready;
    return socket;
  }
  const first = await connect();
  const saved = await first.timeout(1000).emitWithAck("terminal:open", { host: "test-device", username: "test" });
  const additional = [];
  for (const kind of ["manual", "quick"]) {
    const socket = await connect();
    const session = await socket.timeout(1000).emitWithAck("terminal:open", { host: "test-device", kind });
    assert.equal(session.success, true);
    handlers.data({ user_id: 1 }, { session_id: session.session_id, data: `${kind}-output` });
    const detachedExtra = once(io.sockets.sockets.get(socket.id), "disconnect");
    socket.disconnect();
    await detachedExtra;
    additional.push({ session, kind });
  }
  const originalServerSocket = io.sockets.sockets.get(first.id);
  const detached = once(originalServerSocket, "disconnect");
  first.disconnect();
  await detached;
  assert.equal(closes, 0);
  handlers.data({ user_id: 1 }, { session_id: saved.session_id, data: "output while refreshing\r\nprompt#" });
  const second = await connect();
  const restored = await second.timeout(1000).emitWithAck("terminal:resume", saved);
  assert.equal(restored.session_id, saved.session_id);
  assert.equal(restored.output, "output while refreshing\r\nprompt#");
  assert.equal(opens, 3);
  for (const { session, kind } of additional) {
    const socket = await connect();
    const restoredExtra = await socket.timeout(1000).emitWithAck("terminal:resume", session);
    assert.equal(restoredExtra.output, `${kind}-output`);
    assert.equal(restoredExtra.kind, kind);
  }
  const nextData = once(second, "terminal:data");
  handlers.data({ user_id: 1 }, { session_id: saved.session_id, data: "more" });
  assert.equal((await nextData)[0].data, "more");
  const closed = once(second, "terminal:closed");
  second.emit("terminal:logout");
  await closed;
  assert.equal(closes, 3);
});
